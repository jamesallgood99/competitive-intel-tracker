#!/usr/bin/env node
// Runs after each site deploy. Finds battlecards that just went live (a new card, or one moved from
// "review" to "active" by merging its pull request) and announces them in the channel, replying to the
// rep who asked for it when there is one.
//
//   node src/jobs/announce.js --before <sha>
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { loadConfig, cardUrl } from '../lib/config.js';
import { readCompetitor, readRequests } from '../lib/kb.js';
import { hasSlack, slackApi, channelId } from '../lib/slack.js';

const { values: args } = parseArgs({ options: { before: { type: 'string' } } });
const config = loadConfig();

function changedCards(before) {
  if (!before || /^0+$/.test(before)) return [];
  const out = execFileSync('git', ['diff', '--name-only', `${before}..HEAD`, '--', 'data/competitors'], { encoding: 'utf8' });
  return out.split('\n').filter((f) => f.endsWith('.json')).map((f) => f.replace(/^.*\/|\.json$/g, ''));
}

function statusAt(ref, slug) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:data/competitors/${slug}.json`], { encoding: 'utf8' })).status;
  } catch {
    return null; // didn't exist
  }
}

const launched = changedCards(args.before).filter((slug) => {
  const now = readCompetitor(slug);
  return now?.status === 'active' && statusAt(args.before, slug) !== 'active';
});

if (!launched.length) {
  console.log('No new battlecards to announce.');
  process.exit(0);
}
if (!hasSlack()) {
  console.log(`Would announce: ${launched.join(', ')}`);
  process.exit(0);
}

const channel = await channelId(config.slack.intelChannel);
const requests = readRequests();
for (const slug of launched) {
  const card = readCompetitor(slug);
  const text = `New battlecard: *<${cardUrl(config, slug)}|${card.name}>*\n>${card.positioning}`;
  // Let the rep who asked for it know directly.
  const req = requests.find((r) => r.slug === slug && r.status === 'approved' && /^U[A-Z0-9]+$/.test(r.requestedBy ?? ''));
  if (req) {
    await slackApi('chat.postMessage', { channel: req.requestedBy, text: `The battlecard you asked for is live. ${text}`, unfurl_links: false });
  }
  await slackApi('chat.postMessage', { channel, text, unfurl_links: false });
  console.log(`Announced ${slug}`);
}
