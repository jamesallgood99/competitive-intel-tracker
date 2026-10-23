// The bot's view of the knowledge base: reads from GitHub, and every write is a commit.
// A short cache keeps /battlecard lookups fast.
import { REPO_PATHS, slugify } from '../lib/config.js';
import { readJsonFile, updateJsonFile, writeFile, readFile } from '../lib/github.js';

const API = 'https://api.github.com';
let cache = { at: 0, list: [] };

export async function listCompetitors({ fresh = false } = {}) {
  if (!fresh && Date.now() - cache.at < 5 * 60_000 && cache.list.length) return cache.list;
  const res = await fetch(`${API}/repos/${process.env.GITHUB_REPOSITORY}/contents/data/competitors?ref=${process.env.GITHUB_BRANCH || 'main'}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub list competitors: ${res.status}`);
  const files = (await res.json()).filter((f) => f.name.endsWith('.json'));
  const list = await Promise.all(files.map(async (f) => (await readJsonFile(f.path)).data));
  cache = { at: Date.now(), list: list.filter(Boolean) };
  return cache.list;
}

export function invalidate() {
  cache.at = 0;
}

const norm = (s) => slugify(s).replace(/-/g, '');

// Best match for what a rep typed: exact name or slug, then prefix, then substring, then product names.
export function findCompetitor(list, query) {
  const q = norm(query);
  if (!q) return null;
  const active = list.filter((c) => c.status === 'active');
  return (
    active.find((c) => norm(c.name) === q || norm(c.slug) === q) ??
    active.find((c) => norm(c.name).startsWith(q)) ??
    active.find((c) => norm(c.name).includes(q) || q.includes(norm(c.name))) ??
    active.find((c) => (c.products ?? []).some((p) => norm(p.name).includes(q))) ??
    null
  );
}

export async function addFieldIntel(slug, entry, approver) {
  await updateJsonFile(
    REPO_PATHS.competitor(slug),
    null,
    (card) => {
      if (!card) throw new Error(`No battlecard for ${slug}`);
      card.fieldIntel = [entry, ...(card.fieldIntel ?? [])];
      card.lastUpdated = entry.date;
      return card;
    },
    `Field intel for ${slug}, approved by ${approver}`,
  );
  await updateJsonFile(
    REPO_PATHS.changes,
    [],
    (all) => {
      all.push({
        id: `c-${entry.date.replace(/-/g, '')}-${slug}-intel-${Date.now().toString(36)}`,
        date: entry.date,
        slug,
        type: 'intel',
        severity: entry.severity ?? 'minor',
        summary: `Field intel: ${entry.text.length > 140 ? `${entry.text.slice(0, 137)}...` : entry.text}`,
        source: entry.source,
      });
      return all;
    },
    `Log field intel for ${slug}`,
  );
  invalidate();
}

export async function confirmCard(slug, date, approver) {
  await updateJsonFile(REPO_PATHS.competitor(slug), null, (card) => ({ ...card, lastConfirmed: date }), `Confirm ${slug} battlecard is current (${approver})`);
  invalidate();
}

export async function createDraftCard(card, request) {
  const existing = await readFile(REPO_PATHS.competitor(card.slug));
  if (existing) throw new Error(`A battlecard for ${card.slug} already exists`);
  await writeFile(REPO_PATHS.competitor(card.slug), `${JSON.stringify(card, null, 2)}\n`, `Start battlecard for ${card.name} (requested by ${request.requestedByName}, approved by ${request.decidedBy})`);
  await logRequest(request);
  invalidate();
}

export async function logRequest(request) {
  await updateJsonFile(REPO_PATHS.requests, [], (all) => [...all.filter((r) => r.id !== request.id), request], `Battlecard request for ${request.name}: ${request.status}`);
}

export async function readUpdate(id) {
  return readJsonFile(REPO_PATHS.update(id));
}

export async function publishUpdate(id, date) {
  return updateJsonFile(REPO_PATHS.update(id), null, (u) => ({ ...u, status: 'published', publishedAt: date }), `Publish ${id} monthly update`);
}
