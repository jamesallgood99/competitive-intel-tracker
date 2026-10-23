import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstWeekdayOfMonth, isFirstWeekdayOfMonth, isStale } from '../src/lib/dates.js';
import { topMovers, scoreChange } from '../src/lib/movers.js';
import { diffExtraction, diffRatings } from '../src/lib/diff.js';
import { robotsAllows, isBlockedDomain, htmlToText } from '../src/lib/web.js';
import { parseJson } from '../src/lib/claude.js';
import { parseSources, suggestedSources, pack, unpack } from '../src/bot/blocks.js';
import { findCompetitor } from '../src/bot/kb-remote.js';
import { slugify, validateConfig } from '../src/lib/config.js';

test('first Tuesday of the month', () => {
  assert.equal(firstWeekdayOfMonth(2026, 9, 2).toISOString().slice(0, 10), '2026-10-06');
  assert.equal(firstWeekdayOfMonth(2026, 10, 2).toISOString().slice(0, 10), '2026-11-03');
  assert.equal(firstWeekdayOfMonth(2026, 11, 2).toISOString().slice(0, 10), '2026-12-01');
  assert.ok(isFirstWeekdayOfMonth('2026-11-03T15:23:00Z', 2));
  assert.ok(!isFirstWeekdayOfMonth('2026-11-10T15:23:00Z', 2));
  assert.ok(!isFirstWeekdayOfMonth('2026-11-02T15:23:00Z', 2));
});

test('freshness', () => {
  assert.ok(isStale('2026-06-30', 90, '2026-10-23'));
  assert.ok(!isStale('2026-10-01', 90, '2026-10-23'));
  assert.ok(isStale(null, 90, '2026-10-23'));
});

const config = {
  categories: [
    { id: 'a', name: 'A', capabilities: ['x'] },
    { id: 'b', name: 'B', capabilities: ['x'] },
  ],
  monthly: { topMoversPerCategory: 3 },
  movers: { severity: { major: 3, minor: 1 }, typeWeight: { product: 1.5, news: 1 } },
};
const comps = [
  { slug: 'a1', name: 'A1', category: 'a' }, { slug: 'a2', name: 'A2', category: 'a' },
  { slug: 'a3', name: 'A3', category: 'a' }, { slug: 'a4', name: 'A4', category: 'a' },
  { slug: 'b1', name: 'B1', category: 'b' },
];

test('movers: top three per category, only inside the window, ranked by weighted score', () => {
  const changes = [
    { date: '2026-09-02', slug: 'a1', type: 'news', severity: 'minor' },
    { date: '2026-09-03', slug: 'a2', type: 'product', severity: 'major' },
    { date: '2026-09-04', slug: 'a3', type: 'news', severity: 'major' },
    { date: '2026-09-05', slug: 'a4', type: 'news', severity: 'minor' },
    { date: '2026-09-05', slug: 'a4', type: 'news', severity: 'minor' },
    { date: '2026-08-30', slug: 'a1', type: 'product', severity: 'major' }, // before the window
    { date: '2026-10-06', slug: 'b1', type: 'news', severity: 'major' }, // on the end date: excluded
  ];
  const [a, b] = topMovers(changes, comps, config, { from: '2026-09-01', to: '2026-10-06' });
  assert.deepEqual(a.movers.map((m) => m.slug), ['a2', 'a3', 'a4']);
  assert.deepEqual(a.quiet, ['A1']);
  assert.equal(a.movers[0].score, 4.5);
  assert.equal(b.movers.length, 0);
  assert.equal(scoreChange({ severity: 'minor', type: 'unknown' }, config.movers), 1);
});

test('diff: baseline run produces no changes', () => {
  assert.deepEqual(diffExtraction(null, { products: [{ name: 'X' }] }, { slug: 's', date: '2026-10-01' }), []);
});

test('diff: products, messaging and compliance', () => {
  const prev = {
    products: [{ name: 'Core' }, { name: 'Old' }],
    messaging: ['Fast setup', 'Trusted by safety teams'],
    compliance: [{ area: 'SOC 2 Type II', claim: 'Certified' }, { area: 'HIPAA', claim: 'BAA available' }],
  };
  const next = {
    products: [{ name: 'core' }, { name: 'Ergo', description: 'Lift scoring' }],
    messaging: ['Fast setup', 'Live in hours'],
    compliance: [{ area: 'SOC 2 Type II', claim: 'Certified, Type II' }],
  };
  const out = diffExtraction(prev, next, { slug: 's', date: '2026-10-01', source: 'u' });
  const kinds = out.map((c) => `${c.type}:${c.severity}`).sort();
  assert.deepEqual(kinds, ['compliance:major', 'compliance:minor', 'messaging:minor', 'product:major', 'product:major']);
  assert.ok(out.some((c) => c.summary.includes('Ergo')));
  assert.ok(out.some((c) => c.summary.includes('no longer published: HIPAA')));
  assert.equal(new Set(out.map((c) => c.id)).size, out.length);
});

test('diff: ratings move only when it matters', () => {
  assert.equal(diffRatings({ rating: 4.5 }, { rating: 4.45 }, { slug: 's', date: '2026-10-01', type: 'reviews', label: 'G2' }).length, 0);
  const [c] = diffRatings({ rating: 3.4 }, { rating: 3.0 }, { slug: 's', date: '2026-10-01', type: 'employees', label: 'Employee review' });
  assert.equal(c.severity, 'major');
});

test('robots.txt and review-site guardrails', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/press\n\nUser-agent: BadBot\nDisallow: /';
  assert.ok(robotsAllows(robots, '/products', 'CompetitiveIntelTracker/1.0'));
  assert.ok(!robotsAllows(robots, '/private/pricing', 'CompetitiveIntelTracker/1.0'));
  assert.ok(robotsAllows(robots, '/private/press/2026', 'CompetitiveIntelTracker/1.0'));
  assert.ok(!robotsAllows(robots, '/anything', 'BadBot/2'));
  assert.ok(isBlockedDomain('https://www.g2.com/products/x/reviews'));
  assert.ok(isBlockedDomain('https://www.glassdoor.com/Reviews/x'));
  assert.ok(!isBlockedDomain('https://watchpost.example/trust'));
  assert.equal(htmlToText('<p>Hi&nbsp;there</p><script>x()</script><b>SOC&amp;2</b>'), 'Hi there\nSOC&2');
});

test('parseJson tolerates fences and lead-in text', () => {
  assert.deepEqual(parseJson('Here you go:\n```json\n{"a": "b}"}\n```'), { a: 'b}' });
  assert.deepEqual(parseJson('[1, {"x": [2]}] trailing'), [1, { x: [2] }]);
});

test('source lists the admin approves in Slack', () => {
  const { sources, errors } = parseSources(suggestedSources('Acme Safety', 'https://acme.example/'));
  assert.equal(errors.length, 0);
  assert.equal(sources.length, 5);
  assert.equal(sources[0].url, 'https://acme.example/');
  assert.equal(parseSources('fetch products acme.example').errors.length, 1);
  assert.equal(parseSources('grab products https://acme.example').errors.length, 1);
});

test('button payloads stay under Slack limits', () => {
  const p = { sum: 'x'.repeat(5000) };
  assert.ok(pack(p).length <= 2000);
  assert.deepEqual(unpack(pack({ a: 1 })), { a: 1 });
});

test('finding a card from what a rep typed', () => {
  const list = [
    { slug: 'watchpost-ai', name: 'Watchpost AI', status: 'active', products: [{ name: 'Watchpost Ergo' }] },
    { slug: 'tally-comp', name: 'Tally Comp', status: 'active', products: [{ name: 'Tally Insights' }] },
    { slug: 'draft-co', name: 'Draft Co', status: 'review', products: [] },
  ];
  assert.equal(findCompetitor(list, 'watchpost')?.slug, 'watchpost-ai');
  assert.equal(findCompetitor(list, 'Tally')?.slug, 'tally-comp');
  assert.equal(findCompetitor(list, 'insights')?.slug, 'tally-comp');
  assert.equal(findCompetitor(list, 'draft co'), null);
  assert.equal(findCompetitor(list, ''), null);
});

test('slugs and config validation', () => {
  assert.equal(slugify('Ferncliff Insurance Group, Inc.'), 'ferncliff-insurance-group-inc');
  assert.equal(slugify('Mākusafe & Co'), 'makusafe-and-co');
  assert.throws(() => validateConfig({ company: { name: 'X' }, categories: [] }), /category/);
});
