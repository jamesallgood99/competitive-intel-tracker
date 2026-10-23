// Compares two scraper extractions for one competitor and turns the differences into change records.
// An extraction looks like:
// { products: [{name, description}], messaging: [string], compliance: [{area, claim}] }

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function keyed(list, key) {
  const m = new Map();
  for (const item of list ?? []) m.set(norm(typeof item === 'string' ? item : item[key]), item);
  return m;
}

export function diffExtraction(prev, next, { slug, date, source } = {}) {
  const changes = [];
  const add = (type, severity, summary, before = null, after = null, src = source) =>
    changes.push({ id: `c-${date.replace(/-/g, '')}-${slug}-${changes.length + 1}`, date, slug, type, severity, summary, before, after, source: src });

  if (!prev) return changes; // first run is the baseline, not news

  // Products: a new or dropped product is always worth a rep's attention.
  const pa = keyed(prev.products, 'name');
  const pb = keyed(next.products, 'name');
  for (const [k, p] of pb) if (!pa.has(k)) add('product', 'major', `New product: ${p.name}${p.description ? ` (${p.description})` : ''}.`, null, p.name, p.source);
  for (const [k, p] of pa) if (!pb.has(k)) add('product', 'major', `Product no longer listed: ${p.name}.`, p.name, null, p.source);

  // Messaging: report the set change once, not one record per line.
  const ma = keyed(prev.messaging);
  const mb = keyed(next.messaging);
  const added = [...mb.keys()].filter((k) => !ma.has(k)).map((k) => mb.get(k));
  const removed = [...ma.keys()].filter((k) => !mb.has(k)).map((k) => ma.get(k));
  if (added.length || removed.length) {
    const severity = added.length + removed.length >= 3 ? 'major' : 'minor';
    const parts = [];
    if (added.length) parts.push(`new: "${added.join('", "')}"`);
    if (removed.length) parts.push(`dropped: "${removed.join('", "')}"`);
    add('messaging', severity, `Messaging changed (${parts.join('; ')}).`, removed.join(' | ') || null, added.join(' | ') || null);
  }

  // Compliance, security and privacy claims: a dropped claim is major, a new or changed one is minor.
  const ca = keyed(prev.compliance, 'area');
  const cb = keyed(next.compliance, 'area');
  for (const [k, c] of cb) {
    const old = ca.get(k);
    if (!old) add('compliance', 'minor', `New claim: ${c.area} (${c.claim}).`, null, c.claim, c.source);
    else if (norm(old.claim) !== norm(c.claim)) add('compliance', 'minor', `${c.area} claim changed.`, old.claim, c.claim, c.source);
  }
  for (const [k, c] of ca) if (!cb.has(k)) add('compliance', 'major', `Claim no longer published: ${c.area}.`, c.claim, null, c.source);

  return changes;
}

// Review and employee sentiment: flag rating moves of a tenth of a point or more.
export function diffRatings(prev, next, { slug, date, type, label }) {
  const out = [];
  if (!prev || !next) return out;
  const before = Number(prev.rating);
  const after = Number(next.rating);
  const delta = Math.round(Math.abs(after - before) * 10) / 10;
  if (Number.isFinite(before) && Number.isFinite(after) && delta >= 0.1) {
    out.push({
      id: `c-${date.replace(/-/g, '')}-${slug}-${type}`,
      date, slug, type,
      severity: delta >= 0.4 ? 'major' : 'minor',
      summary: `${label} rating moved from ${before.toFixed(1)} to ${after.toFixed(1)}.`,
      before: before.toFixed(1),
      after: after.toFixed(1),
      source: label,
    });
  }
  return out;
}
