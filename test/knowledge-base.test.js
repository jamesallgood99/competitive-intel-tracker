// Checks every battlecard against the config, so a bad edit in GitHub fails CI instead of breaking a page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { loadConfig, categoryById, PATHS } from '../src/lib/config.js';
import { listCompetitors, readChanges, listUpdates } from '../src/lib/kb.js';

const config = loadConfig();
const cards = listCompetitors();
const VERDICTS = new Set(['win', 'parity', 'loss']);
const METHODS = new Set(['fetch', 'search', 'upload', 'api']);

test('config is valid', () => {
  assert.ok(config.categories.length > 0);
});

test('file names match slugs', () => {
  const files = readdirSync(PATHS.competitors).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(files, cards.map((c) => c.slug).sort());
});

for (const card of cards) {
  test(`battlecard: ${card.slug}`, () => {
    const cat = categoryById(config, card.category);
    assert.ok(cat, `unknown category "${card.category}"`);
    assert.ok(['draft', 'review', 'active'].includes(card.status));
    assert.deepEqual(card.scorecard.map((s) => s.capability), cat.capabilities, 'scorecard must use the category capabilities, in order');
    for (const s of card.scorecard) assert.ok(VERDICTS.has(s.verdict), `bad verdict ${s.verdict}`);
    for (const s of card.sources) {
      assert.ok(METHODS.has(s.method), `bad source method ${s.method}`);
      assert.ok(s.approvedBy && s.approvedAt, 'every source needs an approver and date');
    }
    if (card.status === 'active') {
      const sentences = card.positioning.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
      assert.equal(sentences.length, 2, `positioning should be two sentences, got ${sentences.length}`);
      assert.ok(card.whyWeWin.length >= 1 && card.objections.length >= 1 && card.landmines.length >= 1);
    }
  });
}

test('changes reference known competitors and have unique ids', () => {
  const slugs = new Set(cards.map((c) => c.slug));
  const changes = readChanges();
  for (const c of changes) assert.ok(slugs.has(c.slug), `change ${c.id} references ${c.slug}`);
  assert.equal(new Set(changes.map((c) => c.id)).size, changes.length);
});

test('monthly updates cover each category with at most the configured number of movers', () => {
  for (const u of listUpdates()) {
    assert.ok(u.tldr.length <= config.monthly.tldrItems);
    for (const c of u.categories) assert.ok(c.movers.length <= config.monthly.topMoversPerCategory);
    assert.deepEqual(u.categories.map((c) => c.id), config.categories.map((c) => c.id));
  }
});
