// Picks the top movers per competitive category.
// We track every competitor but only comment on the ones that moved most, so the monthly update
// stays short enough for reps to read.

export function scoreChange(change, weights) {
  const base = weights.severity?.[change.severity] ?? 1;
  const mult = weights.typeWeight?.[change.type] ?? 1;
  return base * mult;
}

/**
 * @param {object[]} changes   entries from data/changes.json
 * @param {object[]} competitors competitor cards (need slug, name, category)
 * @param {object} config      tracker config (categories, movers, monthly.topMoversPerCategory)
 * @param {{from: string, to: string}} window  ISO dates, from inclusive, to exclusive
 * @returns {{category: object, movers: {slug, name, score, changes}[], quiet: string[]}[]}
 */
export function topMovers(changes, competitors, config, window) {
  const n = config.monthly?.topMoversPerCategory ?? 3;
  const bySlug = new Map(competitors.map((c) => [c.slug, c]));
  const tallies = new Map();

  for (const ch of changes) {
    if (ch.date < window.from || ch.date >= window.to) continue;
    const comp = bySlug.get(ch.slug);
    if (!comp) continue;
    const t = tallies.get(ch.slug) ?? { slug: ch.slug, name: comp.name, score: 0, changes: [] };
    t.score += scoreChange(ch, config.movers ?? {});
    t.changes.push(ch);
    tallies.set(ch.slug, t);
  }

  return config.categories.map((category) => {
    const members = competitors.filter((c) => c.category === category.id);
    const ranked = members
      .map((c) => tallies.get(c.slug))
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.changes.length - a.changes.length ||
          a.name.localeCompare(b.name),
      );
    const movers = ranked.slice(0, n).map((m) => ({ ...m, score: Math.round(m.score * 100) / 100 }));
    const moved = new Set(movers.map((m) => m.slug));
    return {
      category,
      movers,
      tracked: members.length,
      quiet: members.filter((c) => !moved.has(c.slug)).map((c) => c.name),
    };
  });
}
