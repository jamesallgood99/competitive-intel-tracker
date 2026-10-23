// Loads tracker.config.json and resolves repo paths. Everything company-specific comes from the config.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  config: path.join(ROOT, 'config', 'tracker.config.json'),
  competitors: path.join(ROOT, 'data', 'competitors'),
  snapshots: path.join(ROOT, 'data', 'snapshots'),
  updates: path.join(ROOT, 'data', 'updates'),
  changes: path.join(ROOT, 'data', 'changes.json'),
  requests: path.join(ROOT, 'data', 'requests.json'),
  site: path.join(ROOT, 'site'),
  dist: path.join(ROOT, 'dist'),
};

// Repo-relative versions of the same paths, used when the bot commits through the GitHub API.
export const REPO_PATHS = {
  config: 'config/tracker.config.json',
  competitor: (slug) => `data/competitors/${slug}.json`,
  snapshot: (slug) => `data/snapshots/${slug}.json`,
  update: (id) => `data/updates/${id}.json`,
  changes: 'data/changes.json',
  requests: 'data/requests.json',
};

let cached;
export function loadConfig(file = PATHS.config) {
  if (cached && file === PATHS.config) return cached;
  const config = JSON.parse(readFileSync(file, 'utf8'));
  validateConfig(config);
  if (file === PATHS.config) cached = config;
  return config;
}

export function validateConfig(config) {
  const problems = [];
  if (!config.company?.name) problems.push('company.name is missing');
  if (!Array.isArray(config.categories) || config.categories.length === 0) {
    problems.push('at least one competitive category is required');
  }
  const ids = new Set();
  for (const c of config.categories ?? []) {
    if (!c.id || !c.name) problems.push('every category needs an id and a name');
    if (ids.has(c.id)) problems.push(`duplicate category id: ${c.id}`);
    ids.add(c.id);
    if (!Array.isArray(c.capabilities) || c.capabilities.length === 0) {
      problems.push(`category ${c.id} needs a list of capabilities for the quick-look scorecard`);
    }
  }
  if (problems.length) throw new Error(`tracker.config.json: ${problems.join('; ')}`);
}

export function categoryById(config, id) {
  return config.categories.find((c) => c.id === id);
}

export function cardUrl(config, slug) {
  return `${config.site.baseUrl.replace(/\/$/, '')}/battlecards/${slug}/`;
}

export function updateUrl(config, id) {
  return `${config.site.baseUrl.replace(/\/$/, '')}/updates/${id}/`;
}

export function model(config) {
  return process.env.CLAUDE_MODEL || config.claude?.model || 'claude-sonnet-5-5';
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
