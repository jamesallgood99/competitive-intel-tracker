#!/usr/bin/env node
// Weekly: fetch each competitor's approved pages, extract products, messaging and compliance claims,
// compare against last run, record changes, and alert the admin about major ones.
//
//   node src/jobs/scrape.js                  all active competitors
//   node src/jobs/scrape.js --slug watchpost-ai
//   node src/jobs/scrape.js --with-reviews   also refresh customer and employee sentiment
//
// Without ANTHROPIC_API_KEY it runs dry: it lists what it would fetch and exits.
import { parseArgs } from 'node:util';
import { loadConfig, cardUrl } from '../lib/config.js';
import { listCompetitors, writeCompetitor, appendChanges } from '../lib/kb.js';
import { hasKey } from '../lib/claude.js';
import { scrapeCompetitor } from '../lib/scraper.js';
import { isoDate, isStale } from '../lib/dates.js';
import { refreshReviews } from './reviews.js';
import { hasSlack, dm } from '../lib/slack.js';

const { values: args } = parseArgs({
  options: { slug: { type: 'string' }, 'with-reviews': { type: 'boolean', default: false } },
});

const config = loadConfig();
const today = isoDate();
const competitors = listCompetitors().filter((c) => c.status === 'active' && (!args.slug || c.slug === args.slug));

if (!hasKey()) {
  console.log('Dry run (no ANTHROPIC_API_KEY). Would fetch:');
  for (const c of competitors) {
    for (const s of c.sources.filter((s) => s.method === 'fetch')) console.log(`  ${c.slug.padEnd(28)} ${s.purpose.padEnd(11)} ${s.url}`);
  }
  process.exit(0);
}

const allChanges = [];
const majors = [];
for (const card of competitors) {
  try {
    const result = await scrapeCompetitor(config, card, today);
    let updated = result.card;
    if (args['with-reviews']) {
      const r = await refreshReviews(config, updated, today);
      updated = r.card;
      result.changes.push(...r.changes);
    }
    writeCompetitor(updated);
    allChanges.push(...result.changes);
    majors.push(...result.changes.filter((c) => config.scraper.alertAdminOn.includes(c.severity)).map((c) => ({ ...c, name: card.name })));
    console.log(`${card.slug}: ${result.changes.length} change(s)${result.skipped.length ? `, skipped ${result.skipped.length}` : ''}`);
    for (const s of result.skipped) console.log(`   skipped ${s}`);
  } catch (err) {
    console.error(`${card.slug}: ${err.message}`);
  }
}
appendChanges(allChanges);

if (hasSlack()) {
  const admin = config.slack.adminUserIds[0];
  if (majors.length) {
    await dm(admin, {
      text: `${majors.length} major competitor change(s) this week`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Major competitor changes this week' } },
        ...majors.map((c) => ({
          type: 'section',
          text: { type: 'mrkdwn', text: `*<${cardUrl(config, c.slug)}|${c.name}>* · ${c.type}\n${c.summary}` },
        })),
        { type: 'context', elements: [{ type: 'mrkdwn', text: 'These are on the battlecards now and will be in the monthly update.' }] },
      ],
    });
  }
  const stale = listCompetitors().filter((c) => c.status === 'active' && isStale(c.lastConfirmed, config.site.staleAfterDays));
  if (stale.length) {
    await dm(admin, {
      text: `${stale.length} battlecard(s) haven't been confirmed in ${config.site.staleAfterDays} days`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${stale.length} battlecard(s) haven't been confirmed in ${config.site.staleAfterDays} days.* Reps see a freshness warning until you confirm them.` } },
        ...stale.map((c) => ({
          type: 'section',
          text: { type: 'mrkdwn', text: `<${cardUrl(config, c.slug)}|${c.name}> · last confirmed ${c.lastConfirmed ?? 'never'}` },
          accessory: { type: 'button', text: { type: 'plain_text', text: 'Mark current' }, action_id: 'confirm_card', value: c.slug },
        })),
      ],
    });
  }
}
