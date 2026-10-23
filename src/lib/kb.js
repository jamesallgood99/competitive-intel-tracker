// The knowledge base on disk: one JSON file per competitor, a changes feed, monthly updates and
// scraper snapshots. GitHub Actions read and write these directly; the Slack bot goes through github.js.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PATHS } from './config.js';

const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

export function listCompetitors() {
  if (!existsSync(PATHS.competitors)) return [];
  return readdirSync(PATHS.competitors)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(PATHS.competitors, f)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const readCompetitor = (slug) => readJson(path.join(PATHS.competitors, `${slug}.json`), null);
export const writeCompetitor = (card) => writeJson(path.join(PATHS.competitors, `${card.slug}.json`), card);

export const readSnapshot = (slug) => readJson(path.join(PATHS.snapshots, `${slug}.json`), null);
export const writeSnapshot = (slug, snap) => writeJson(path.join(PATHS.snapshots, `${slug}.json`), snap);

export const readChanges = () => readJson(PATHS.changes, []);
export function appendChanges(newChanges) {
  if (!newChanges.length) return readChanges();
  const all = readChanges();
  const seen = new Set(all.map((c) => c.id));
  for (const c of newChanges) if (!seen.has(c.id)) all.push(c);
  all.sort((a, b) => a.date.localeCompare(b.date));
  writeJson(PATHS.changes, all);
  return all;
}

export function listUpdates() {
  if (!existsSync(PATHS.updates)) return [];
  return readdirSync(PATHS.updates)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(PATHS.updates, f)))
    .sort((a, b) => b.id.localeCompare(a.id));
}
export const readUpdate = (id) => readJson(path.join(PATHS.updates, `${id}.json`), null);
export const writeUpdate = (u) => writeJson(path.join(PATHS.updates, `${u.id}.json`), u);

export const readRequests = () => readJson(PATHS.requests, []);

// A blank card for a newly approved competitor. Claude fills it in draft-card.js; the admin reviews the PR.
export function emptyCard({ slug, name, category, website, sources, requestedBy, approvedBy, capabilities }) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    slug, name, category, website,
    status: 'draft',
    lastConfirmed: null,
    owner: 'Product marketing',
    requestedBy: requestedBy ?? null,
    positioning: '',
    scorecard: (capabilities ?? []).map((capability) => ({ capability, verdict: 'parity', note: 'Not yet assessed.' })),
    whyWeWin: [],
    whereTheyWin: [],
    objections: [],
    landmines: [],
    messaging: [],
    products: [],
    compliance: [],
    customerSentiment: { asOf: null, sources: [], positive: [], negative: [] },
    employeeSentiment: null,
    fieldIntel: [],
    snapshot: { founded: null, hq: null, employees: null, funding: null, leadership: null, news: [] },
    sources: (sources ?? []).map((s) => ({ ...s, approvedBy, approvedAt: today })),
  };
}
