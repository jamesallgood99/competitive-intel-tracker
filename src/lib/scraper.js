// Fetches a competitor's approved pages, extracts products, messaging and compliance claims with Claude,
// and diffs against the last snapshot. Shared by the weekly scrape and new-card drafting.
import { readSnapshot, writeSnapshot } from './kb.js';
import { fetchPage } from './web.js';
import { askJson } from './claude.js';
import { extractPrompt } from './prompts.js';
import { diffExtraction } from './diff.js';

export async function scrapeCompetitor(config, card, today) {
  const fetchSources = card.sources.filter((s) => s.method === 'fetch').slice(0, config.scraper.maxPagesPerCompetitor);
  const pages = [];
  const skipped = [];
  for (const s of fetchSources) {
    const page = await fetchPage(s.url, { userAgent: config.scraper.userAgent, respectRobots: config.scraper.respectRobotsTxt });
    if (page.ok) pages.push(page);
    else skipped.push(`${s.url}: ${page.reason}`);
  }
  if (!pages.length) return { card, changes: [], skipped, extraction: null };

  const { data: extraction } = await askJson(config, extractPrompt(config, card, pages));
  const prev = readSnapshot(card.slug);
  const changes = diffExtraction(prev?.extraction, extraction, { slug: card.slug, date: today, source: pages[0].url });
  writeSnapshot(card.slug, { slug: card.slug, fetchedAt: today, pages: pages.map((p) => p.url), skipped, extraction });

  // The scraped sections of the card always reflect the latest run. Everything else is the admin's.
  card.products = (extraction.products ?? []).map(({ name, description }) => ({ name, description }));
  card.messaging = extraction.messaging ?? [];
  const ours = new Map((card.compliance ?? []).map((c) => [c.area.toLowerCase(), c.us]));
  card.compliance = (extraction.compliance ?? []).map((c) => ({ area: c.area, them: c.claim, us: ours.get(c.area.toLowerCase()) ?? 'Needs review' }));
  if (changes.length) card.lastUpdated = today;
  return { card, changes, skipped, extraction };
}
