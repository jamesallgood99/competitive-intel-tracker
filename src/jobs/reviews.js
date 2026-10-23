// Customer sentiment (G2, Capterra, Gartner Peer Insights) and employee sentiment (Glassdoor, CEO approval).
//
// These sites don't permit automated scraping, so each source declares a method the admin approved:
//   search  Claude web search summarizes what's publicly indexed (default)
//   upload  an export the admin drops in data/uploads/<slug>-<purpose>.csv (columns: source,rating,date,text)
//   api     reserved for a licensed API (e.g. G2's); add a fetcher in API_FETCHERS when you have access
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../lib/config.js';
import { askJson } from '../lib/claude.js';
import { customerReviewsPrompt, employeeReviewsPrompt } from '../lib/prompts.js';
import { diffRatings } from '../lib/diff.js';

const API_FETCHERS = {
  // g2: async (card, source) => { ... return { asOf, sources, positive, negative } },
};

function uploadText(slug, purpose) {
  const file = path.join(ROOT, 'data', 'uploads', `${slug}-${purpose}.csv`);
  return existsSync(file) ? readFileSync(file, 'utf8').slice(0, 60_000) : null;
}

async function collect(config, card, source, promptFn) {
  if (source.method === 'search') {
    const p = promptFn(card, source.url);
    return (await askJson(config, { ...p, webSearch: true })).data;
  }
  if (source.method === 'upload') {
    const csv = uploadText(card.slug, source.purpose);
    if (!csv) return null;
    const p = promptFn(card, 'use only the exported reviews below');
    return (await askJson(config, { ...p, prompt: `${p.prompt}\n\nExported reviews (CSV):\n${csv}` })).data;
  }
  if (source.method === 'api') {
    const fetcher = API_FETCHERS[source.provider];
    if (!fetcher) throw new Error(`No API fetcher configured for ${source.provider ?? 'this source'}`);
    return fetcher(card, source);
  }
  return null;
}

// Average the per-site ratings so the diff has one number to compare.
const blended = (s) => {
  const rated = (s?.sources ?? []).filter((x) => Number.isFinite(x.rating));
  return rated.length ? { rating: rated.reduce((a, x) => a + x.rating, 0) / rated.length } : null;
};

export async function refreshReviews(config, card, today) {
  const changes = [];
  for (const source of card.sources) {
    try {
      if (source.purpose === 'reviews') {
        const next = await collect(config, card, source, customerReviewsPrompt);
        if (next) {
          changes.push(...diffRatings(blended(card.customerSentiment), blended(next), { slug: card.slug, date: today, type: 'reviews', label: 'Customer review' }));
          card.customerSentiment = next;
        }
      } else if (source.purpose === 'employees') {
        const next = await collect(config, card, source, employeeReviewsPrompt);
        if (next) {
          changes.push(...diffRatings(card.employeeSentiment, next, { slug: card.slug, date: today, type: 'employees', label: 'Employee review' }));
          card.employeeSentiment = next;
        }
      }
    } catch (err) {
      console.error(`${card.slug} ${source.purpose}: ${err.message}`);
    }
  }
  return { card, changes };
}
