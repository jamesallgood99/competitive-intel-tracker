#!/usr/bin/env node
// Drafts a new battlecard after the admin approves a request in Slack.
// The bot has already committed a blank card (status "draft") with the admin-approved source list.
// This job scrapes those sources, gathers customer and employee sentiment, has Claude draft every section,
// and leaves the card at status "review". The workflow then opens a pull request; merging it publishes the card.
//
//   node src/jobs/draft-card.js --slug acme-safety
import { parseArgs } from 'node:util';
import { loadConfig, categoryById } from '../lib/config.js';
import { readCompetitor, writeCompetitor } from '../lib/kb.js';
import { scrapeCompetitor } from '../lib/scraper.js';
import { refreshReviews } from './reviews.js';
import { askJson, hasKey } from '../lib/claude.js';
import { draftCardPrompt } from '../lib/prompts.js';
import { isoDate } from '../lib/dates.js';

const { values: args } = parseArgs({ options: { slug: { type: 'string' } } });
if (!args.slug) throw new Error('--slug is required');

const config = loadConfig();
const today = isoDate();
let card = readCompetitor(args.slug);
if (!card) throw new Error(`No card at data/competitors/${args.slug}.json`);
const category = categoryById(config, card.category);
if (!category) throw new Error(`Unknown category "${card.category}"`);

if (!hasKey()) {
  console.log(`Dry run: would scrape ${card.sources.length} approved source(s) for ${card.name} and draft the card.`);
  process.exit(0);
}

const scraped = await scrapeCompetitor(config, card, today);
card = scraped.card;
for (const s of scraped.skipped) console.log(`skipped ${s}`);
card = (await refreshReviews(config, card, today)).card;

const { data } = await askJson(config, {
  ...draftCardPrompt(config, category, card, scraped.extraction ?? {}, card.customerSentiment),
  maxTokens: 6000,
});

// Keep the scorecard to the category's capabilities, in order, whatever came back.
const byCap = new Map((data.scorecard ?? []).map((s) => [s.capability.toLowerCase(), s]));
card.scorecard = category.capabilities.map(
  (capability) => byCap.get(capability.toLowerCase()) ?? { capability, verdict: 'parity', note: 'Not yet assessed.' },
);
Object.assign(card, {
  positioning: data.positioning ?? '',
  whyWeWin: data.whyWeWin ?? [],
  whereTheyWin: data.whereTheyWin ?? [],
  objections: data.objections ?? [],
  landmines: data.landmines ?? [],
  snapshot: { ...card.snapshot, ...(data.snapshot ?? {}) },
  status: 'review',
  lastUpdated: today,
});
writeCompetitor(card);
console.log(`Drafted data/competitors/${card.slug}.json for admin review`);
