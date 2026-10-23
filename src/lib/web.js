// Fetches approved competitor pages politely: our own user agent, robots.txt respected, and only URLs
// the admin approved for that competitor. Review and employee sites are never fetched directly;
// those sources use the "search" method (see jobs/reviews.js).

const robotsCache = new Map();

// Domains whose terms prohibit automated collection. The scraper refuses them even if someone approves one.
export const NEVER_FETCH = ['g2.com', 'capterra.com', 'gartner.com', 'glassdoor.com', 'linkedin.com', 'indeed.com'];

export function isBlockedDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return NEVER_FETCH.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return true;
  }
}

export function robotsAllows(robotsTxt, pathname, agent = '*') {
  // Small robots.txt reader: honours the group for our agent, else "*". Longest matching rule wins.
  const groups = [];
  let current = null;
  for (const raw of robotsTxt.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (key.toLowerCase() === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (current && /^(allow|disallow)$/i.test(key)) {
      current.rules.push({ allow: key.toLowerCase() === 'allow', path: value });
    }
  }
  const name = agent.toLowerCase().split('/')[0];
  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && name.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;
  let best = null;
  for (const r of group.rules) {
    if (!r.path) continue;
    const pattern = new RegExp(`^${r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    if (pattern.test(pathname) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best ? best.allow : true;
}

async function allowedByRobots(url, userAgent) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'user-agent': userAgent } });
      robotsCache.set(u.origin, res.ok ? await res.text() : '');
    } catch {
      robotsCache.set(u.origin, '');
    }
  }
  return robotsAllows(robotsCache.get(u.origin), u.pathname, userAgent);
}

export function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchPage(url, { userAgent, respectRobots = true } = {}) {
  if (isBlockedDomain(url)) return { url, ok: false, reason: 'Domain does not permit automated collection; use the search method' };
  if (respectRobots && !(await allowedByRobots(url, userAgent))) return { url, ok: false, reason: 'Disallowed by robots.txt' };
  try {
    const res = await fetch(url, { headers: { 'user-agent': userAgent, accept: 'text/html' }, redirect: 'follow' });
    if (!res.ok) return { url, ok: false, reason: `HTTP ${res.status}` };
    const text = htmlToText(await res.text()).slice(0, 40_000);
    return { url, ok: true, text };
  } catch (err) {
    return { url, ok: false, reason: err.message };
  }
}
