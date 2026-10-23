// End-to-end paths with the network stubbed: scraping a competitor through Claude, and the bot's
// GitHub commit when an admin approves intel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, PATHS } from '../src/lib/config.js';
import { scrapeCompetitor } from '../src/lib/scraper.js';
import { updateJsonFile } from '../src/lib/github.js';

const config = loadConfig();
const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
  rmSync(path.join(PATHS.snapshots, 'test-co.json'), { force: true });
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('scrape: fetches approved pages, skips disallowed ones, extracts and diffs', async () => {
  process.env.ANTHROPIC_API_KEY = 'test';
  let extraction = {
    products: [{ name: 'Core', description: 'Hazard alerts', source: 'https://test.example/products' }],
    messaging: ['See every hazard'],
    compliance: [{ area: 'SOC 2 Type II', claim: 'Certified', source: 'https://test.example/security' }],
  };
  const fetched = [];
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /security');
    if (url.startsWith('https://api.anthropic.com')) {
      const body = JSON.parse(opts.body);
      assert.match(body.messages[0].content, /=== https:\/\/test\.example\/products ===/);
      return json({ content: [{ type: 'text', text: JSON.stringify(extraction) }], stop_reason: 'end_turn' });
    }
    fetched.push(url);
    return new Response('<html><body><h1>Test Co</h1><p>See every hazard</p></body></html>');
  };

  const card = {
    slug: 'test-co', name: 'Test Co', website: 'https://test.example',
    compliance: [{ area: 'SOC 2 Type II', them: 'old', us: 'Yes' }],
    sources: [
      { url: 'https://test.example/products', method: 'fetch', purpose: 'products' },
      { url: 'https://test.example/security', method: 'fetch', purpose: 'compliance' },
      { url: 'https://www.g2.com/products/test-co/reviews', method: 'fetch', purpose: 'reviews' },
      { url: 'Test Co reviews', method: 'search', purpose: 'reviews' },
    ],
  };

  const first = await scrapeCompetitor(config, structuredClone(card), '2026-10-01');
  assert.deepEqual(fetched, ['https://test.example/products'], 'robots.txt and review-site rules are respected');
  assert.equal(first.skipped.length, 2);
  assert.equal(first.changes.length, 0, 'the first run is a baseline');
  assert.equal(first.card.compliance[0].us, 'Yes', 'our side of the compliance table is kept');

  extraction = { ...extraction, products: [...extraction.products, { name: 'Ergo', description: 'Lift scoring' }] };
  const second = await scrapeCompetitor(config, structuredClone(card), '2026-10-08');
  assert.equal(second.changes.length, 1);
  assert.equal(second.changes[0].type, 'product');
  assert.equal(second.changes[0].severity, 'major');
  assert.equal(second.card.products.length, 2);
});

test('github: read-modify-write retries on a conflict', async () => {
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_TOKEN = 't';
  let version = 1;
  let stored = { fieldIntel: [] };
  let puts = 0;
  globalThis.fetch = async (url, opts = {}) => {
    if (!opts.method || opts.method === 'GET') {
      return json({ sha: `sha${version}`, content: Buffer.from(JSON.stringify(stored)).toString('base64') });
    }
    puts++;
    const body = JSON.parse(opts.body);
    if (puts === 1) {
      // Someone else committed between our read and write.
      version++;
      stored = { fieldIntel: [{ text: 'from someone else' }] };
      return json({ message: 'conflict' }, 409);
    }
    assert.equal(body.sha, `sha${version}`);
    stored = JSON.parse(Buffer.from(body.content, 'base64').toString());
    return json({ content: {} });
  };

  const result = await updateJsonFile('data/competitors/x.json', null, (card) => {
    card.fieldIntel.unshift({ text: 'ours' });
    return card;
  }, 'test');
  assert.equal(puts, 2);
  assert.deepEqual(result.fieldIntel.map((i) => i.text), ['ours', 'from someone else'], 'nothing is lost');
});
