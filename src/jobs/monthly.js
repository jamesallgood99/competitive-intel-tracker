#!/usr/bin/env node
// The monthly competitive update. Runs every Tuesday from GitHub Actions and only does work on the
// first Tuesday of the month (cron can't express "first Tuesday").
//
// It covers everything since the last update: a TL;DR of the top three things to know, then industry
// trends, regulatory updates, M&A and industry health, then the top movers in each competitive category.
// The result is saved as a draft and sent to the admin, who publishes it to the channel from Slack.
//
//   node src/jobs/monthly.js                run if today is the first Tuesday
//   node src/jobs/monthly.js --force        run regardless of the date
//   node src/jobs/monthly.js --date 2026-11-03
import { parseArgs } from 'node:util';
import { loadConfig, updateUrl, cardUrl } from '../lib/config.js';
import { listCompetitors, readChanges, listUpdates, writeUpdate } from '../lib/kb.js';
import { isoDate, monthId, isFirstWeekdayOfMonth, prettyMonth } from '../lib/dates.js';
import { topMovers } from '../lib/movers.js';
import { askJson, hasKey } from '../lib/claude.js';
import { industryPrompt, moverPrompt, tldrPrompt } from '../lib/prompts.js';
import { hasSlack, dm } from '../lib/slack.js';

const { values: args } = parseArgs({ options: { force: { type: 'boolean', default: false }, date: { type: 'string' } } });

const config = loadConfig();
const runDate = args.date ? new Date(`${args.date}T16:00:00Z`) : new Date();
const today = isoDate(runDate);

if (!args.force && !isFirstWeekdayOfMonth(runDate, config.monthly.weekday)) {
  console.log(`${today} isn't the first ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][config.monthly.weekday]} of the month. Nothing to do.`);
  process.exit(0);
}

const id = monthId(runDate);
const previous = listUpdates().find((u) => u.id < id);
const firstOfLastMonth = `${monthId(new Date(Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth() - 1, 1)))}-01`;
const window = { from: previous?.window?.to ?? firstOfLastMonth, to: today };

const competitors = listCompetitors().filter((c) => c.status === 'active');
const changes = readChanges();
const ranked = topMovers(changes, competitors, config, window);

console.log(`Monthly update ${id}, covering ${window.from} to ${window.to}`);
for (const r of ranked) console.log(`  ${r.category.name}: ${r.movers.map((m) => `${m.name} (${m.score})`).join(', ') || 'no movement'}`);

if (!hasKey()) {
  console.log('Dry run (no ANTHROPIC_API_KEY): movers computed, nothing written.');
  process.exit(0);
}

// Industry sections, each researched with web search.
const industry = {};
const sources = new Map();
for (const [key, question] of Object.entries(config.monthly.industryQuestions)) {
  const { data, citations } = await askJson(config, { ...industryPrompt(config, key, question, window), webSearch: true });
  industry[key] = data;
  for (const c of citations) sources.set(c.url, c.title);
}

// Commentary on each mover. Everyone else is tracked but not discussed.
const categories = [];
for (const r of ranked) {
  const movers = [];
  for (const m of r.movers) {
    const card = competitors.find((c) => c.slug === m.slug);
    const { data } = await askJson(config, moverPrompt(config, card, m.changes));
    movers.push({ slug: m.slug, name: m.name, score: m.score, whatChanged: data.whatChanged, soWhat: data.soWhat, changeIds: m.changes.map((c) => c.id) });
  }
  categories.push({ id: r.category.id, name: r.category.name, tracked: r.tracked, movers, quiet: r.quiet });
}

const draft = { industry, categories };
const { data: top } = await askJson(config, tldrPrompt(config, draft, config.monthly.tldrItems));

const update = {
  id,
  title: top.title || `${prettyMonth(id)} competitive update`,
  status: 'draft',
  createdAt: today,
  publishedAt: null,
  window,
  tldr: top.tldr.slice(0, config.monthly.tldrItems),
  industry,
  categories,
  sources: [...sources].map(([url, title]) => ({ url, title })),
};
writeUpdate(update);
console.log(`Wrote data/updates/${id}.json`);

if (hasSlack()) {
  await dm(config.slack.adminUserIds[0], {
    text: `Draft: ${update.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `Draft monthly update: ${prettyMonth(id)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `*TL;DR*\n${update.tldr.map((t, i) => `${i + 1}. ${t.text}${t.slug ? ` <${cardUrl(config, t.slug)}|card>` : ''}`).join('\n')}` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `The full draft goes live at <${updateUrl(config, id)}|this link> after the next site build (a few minutes). Edit data/updates/${id}.json in GitHub if anything needs changing.` }] },
      {
        type: 'actions',
        elements: [
          { type: 'button', style: 'primary', text: { type: 'plain_text', text: `Publish to #${config.slack.updatesChannel}` }, action_id: 'publish_update', value: id },
          { type: 'button', text: { type: 'plain_text', text: 'Open draft' }, url: updateUrl(config, id), action_id: 'open_update' },
        ],
      },
    ],
  });
}
