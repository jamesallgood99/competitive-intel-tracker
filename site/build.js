#!/usr/bin/env node
// Builds the static site into dist/: one page per battlecard at /battlecards/<slug>/, the monthly updates,
// and the changes feed. GitHub Pages serves it; every approved change in Slack triggers a rebuild.
import { mkdirSync, writeFileSync, copyFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, categoryById, PATHS } from '../src/lib/config.js';
import { listCompetitors, readChanges, listUpdates } from '../src/lib/kb.js';
import { prettyDate, prettyMonth, isStale, daysBetween, isoDate } from '../src/lib/dates.js';

const config = loadConfig();
const today = process.env.BUILD_DATE || isoDate();
const competitors = listCompetitors();
const live = competitors.filter((c) => c.status === 'active');
const changes = readChanges();
const updates = listUpdates();
const isDemo = updates.some((u) => u.demo) || competitors.some((c) => c.website?.endsWith('.example'));

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const VERDICT = { win: 'Win', parity: 'Parity', loss: 'Loss' };
const mark = (v) => `<span class="mark mark-${v}" aria-hidden="true"></span>`;
const verdict = (v) => `<span class="verdict verdict-${v}">${mark(v)}${VERDICT[v] ?? v}</span>`;
const strip = (card) =>
  `<span class="strip" role="img" aria-label="${esc(tallyText(card))}">${card.scorecard.map((s) => `<span class="s-${s.verdict}" title="${esc(s.capability)}: ${VERDICT[s.verdict]}"></span>`).join('')}</span>`;
const tally = (card) => card.scorecard.reduce((t, s) => ((t[s.verdict] = (t[s.verdict] ?? 0) + 1), t), { win: 0, parity: 0, loss: 0 });
function tallyText(card) {
  const t = tally(card);
  return `${t.win} win, ${t.parity} parity, ${t.loss} loss`;
}
const cardHref = (prefix, slug) => `${prefix}battlecards/${slug}/`;
const changeTypeLabel = {
  product: 'Product', pricing: 'Pricing', messaging: 'Messaging', compliance: 'Compliance and security',
  news: 'News', intel: 'Field intel', reviews: 'Customer reviews', employees: 'Employee reviews',
};

function freshness(card) {
  if (card.status !== 'active') return `<span class="tag tag-draft">${card.status === 'review' ? 'Waiting for admin review' : 'Draft'}</span>`;
  if (isStale(card.lastConfirmed, config.site.staleAfterDays, today)) {
    return `<span class="tag tag-stale">Not confirmed in ${config.site.staleAfterDays}+ days: check before using</span>`;
  }
  return `<span class="tag">Confirmed ${prettyDate(card.lastConfirmed)}</span>`;
}

function page({ title, body, depth, active, description }) {
  const prefix = '../'.repeat(depth);
  const nav = [
    ['Battlecards', '', 'home'],
    ['Monthly updates', 'updates/', 'updates'],
    ['Changes', 'changes/', 'changes'],
  ]
    .map(([label, href, key]) => `<a href="${prefix}${href}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n<meta property="og:description" content="${esc(description)}">` : ''}
<meta property="og:title" content="${esc(title)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@500;600;700&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${prefix}assets/style.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='3' y='3' width='10' height='10' transform='rotate(45 8 8)' fill='%23ffd200' stroke='%2322303a' stroke-width='1.5'/%3E%3C/svg%3E">
</head>
<body>
${isDemo ? `<div class="demo-note"><div class="wrap">Demo data. ${esc(config.company.name)} and every competitor here are fictional.</div></div>` : ''}
<header class="topbar"><div class="wrap">
<a class="brand" href="${prefix}">${esc(config.site.title)}</a>
<nav aria-label="Main">${nav}</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">Built from the ${esc(config.company.name)} competitive knowledge base. Reps add intel in #${esc(config.slack.intelChannel)}; an admin approves every change. Page built ${prettyDate(today)}.</div></footer>
<script src="${prefix}assets/app.js" defer></script>
</body>
</html>`;
}

// ---------- home ----------
function homePage() {
  const recentCount = (slug) => changes.filter((c) => c.slug === slug && daysBetween(c.date, today) <= 30).length;
  const categories = config.categories
    .map((cat) => {
      const members = live.filter((c) => c.category === cat.id);
      const rows = members
        .map((c) => {
          const stale = isStale(c.lastConfirmed, config.site.staleAfterDays, today);
          const recent = recentCount(c.slug);
          return `<li data-search="${esc(`${c.name} ${cat.name} ${c.products.map((p) => p.name).join(' ')}`.toLowerCase())}">
<a href="${cardHref('', c.slug)}">
<span class="name">${esc(c.name)}</span>
${strip(c)}
<span class="meta">${stale ? '<span class="stale">Needs a check</span>' : `Confirmed ${prettyDate(c.lastConfirmed)}`}${recent ? `<br>${recent} change${recent > 1 ? 's' : ''} in 30 days` : ''}</span>
</a></li>`;
        })
        .join('');
      return `<section class="category" aria-labelledby="cat-${cat.id}">
<h2 id="cat-${cat.id}">${esc(cat.name)} <small>${members.length} tracked</small></h2>
<p>${esc(cat.description)}</p>
<ul class="roster">${rows || '<li class="muted" style="padding:12px 0">No battlecards in this category yet. Ask for one in Slack with /battlecard request.</li>'}</ul>
</section>`;
    })
    .join('');

  const latest = updates.find((u) => u.status === 'published');
  const latestBox = latest
    ? `<aside class="latest" aria-labelledby="latest-h">
<h2 id="latest-h">${esc(prettyMonth(latest.id))} update</h2>
<p class="muted" style="margin-top:4px">The three things to know</p>
<ol>${latest.tldr.map((t) => `<li>${esc(t.text)}${t.slug ? ` <a href="${cardHref('', t.slug)}">Card</a>` : ''}</li>`).join('')}</ol>
<a class="more" href="updates/${latest.id}/">Read the full update</a>
</aside>`
    : '<aside class="latest"><h2>Monthly update</h2><p>The first one is posted on the first Tuesday of next month.</p></aside>';

  const body = `<section class="finder">
<label for="find">Who are you up against?</label>
<input id="find" type="search" placeholder="Company or product name" autocomplete="off" aria-describedby="find-help">
<p id="find-help" class="muted">${live.length} competitors across ${config.categories.length} categories. In Slack, type <code>/battlecard</code> and a name to get the link.</p>
</section>
<div class="home-grid">
<div>
<div class="categories" id="roster">${categories}</div>
<p class="no-match" id="no-match" hidden>No battlecard matches that name. Ask for one in Slack: <code>/battlecard request Company name</code>.</p>
<div class="legend" aria-label="Scorecard key"><span>${mark('win')} We win</span><span>${mark('parity')} Parity</span><span>${mark('loss')} They win</span><span>One mark per capability on the card's quick-look scorecard.</span></div>
</div>
${latestBox}
</div>`;
  return page({ title: config.site.title, body, depth: 0, active: 'home', description: `Battlecards for ${live.length} competitors.` });
}

// ---------- battlecard ----------
function battlecardPage(card) {
  const cat = categoryById(config, card.category);
  const t = tally(card);
  const cardChanges = changes.filter((c) => c.slug === card.slug).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const pos = card.positioning
    ? card.positioning.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => `<p>${esc(s)}</p>`).join('')
    : '<p class="empty">Positioning statement not written yet.</p>';

  const section = (id, title, inner, lede) =>
    inner ? `<section class="section" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}${inner}</section>` : '';

  const scorecard = `<section class="quicklook" aria-labelledby="ql">
<div class="quicklook-head"><h2 id="ql">Quick look</h2>
<div class="tally" aria-label="${esc(tallyText(card))}"><span>${mark('win')}${t.win} win</span><span>${mark('parity')}${t.parity} parity</span><span>${mark('loss')}${t.loss} loss</span></div></div>
<table class="scorecard"><thead><tr><th scope="col">Capability</th><th scope="col">Us vs. them</th><th scope="col">Why</th></tr></thead>
<tbody>${card.scorecard.map((s) => `<tr><td>${esc(s.capability)}</td><td>${verdict(s.verdict)}</td><td>${esc(s.note)}</td></tr>`).join('')}</tbody></table>
</section>`;

  const whyWin = card.whyWeWin.length
    ? `<ul class="points">${card.whyWeWin.map((w) => `<li>${mark('win')}<strong>${esc(w.point)}</strong><span>${esc(w.proof)}</span></li>`).join('')}</ul>`
    : '';
  const theyWin = card.whereTheyWin.length
    ? `<ul class="points">${card.whereTheyWin.map((w) => `<li>${mark('loss')}<strong>${esc(w)}</strong></li>`).join('')}</ul>`
    : '';

  const objections = card.objections.length
    ? `<div class="objections">${card.objections
        .map((o) => `<div class="objection"><div><span class="who">They'll say</span><span class="they">“${esc(o.theySay)}”</span></div><div><span class="who">You say</span>${esc(o.youSay)}</div></div>`)
        .join('')}</div>`
    : '';
  const landmines = card.landmines.length ? `<ul class="landmines">${card.landmines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '';

  const messaging = card.messaging.length
    ? `<ul class="chips">${card.messaging.map((m) => `<li>“${esc(m)}”</li>`).join('')}</ul>${
        cardChanges.length
          ? `<h3 style="margin-top:22px">Recent changes</h3><ul class="changelog">${cardChanges
              .map((c) => `<li><time datetime="${c.date}">${prettyDate(c.date)}</time><span>${c.severity === 'major' ? '<span class="sev-major">Major: </span>' : ''}${esc(c.summary)}</span></li>`)
              .join('')}</ul>`
          : ''
      }`
    : '';
  const products = card.products.length
    ? `<table><thead><tr><th scope="col">Product</th><th scope="col">What it is</th></tr></thead><tbody>${card.products.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.description)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const compliance = card.compliance.length
    ? `<div class="table-scroll"><table><thead><tr><th scope="col">Area</th><th scope="col">${esc(card.name)} claims</th><th scope="col">${esc(config.company.name)}</th></tr></thead><tbody>${card.compliance
        .map((c) => `<tr><td><b>${esc(c.area)}</b></td><td>${esc(c.them)}</td><td>${esc(c.us)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '';

  const themes = (s) =>
    s && (s.positive?.length || s.negative?.length)
      ? `<div class="two-col themes" style="margin-bottom:0">
<div><h3>${mark('win')}What they like</h3><ul>${(s.positive ?? []).map((p) => `<li><b>${esc(p.theme)}</b>${p.mentions ? ` <small>${p.mentions} mentions</small>` : ''}<br>${esc(p.detail)}</li>`).join('') || '<li class="muted">Nothing notable.</li>'}</ul></div>
<div><h3>${mark('loss')}What they complain about</h3><ul>${(s.negative ?? []).map((p) => `<li><b>${esc(p.theme)}</b>${p.mentions ? ` <small>${p.mentions} mentions</small>` : ''}<br>${esc(p.detail)}</li>`).join('') || '<li class="muted">Nothing notable.</li>'}</ul></div>
</div>`
      : '';
  const cs = card.customerSentiment;
  const customer =
    cs && (cs.sources?.length || cs.positive?.length)
      ? `<div class="ratings">${cs.sources.map((s) => `<div class="rating"><b>${s.rating ?? '–'}</b><small>${esc(s.name)}${s.reviews ? `, ${s.reviews} reviews` : ''}</small></div>`).join('')}</div>${themes(cs)}`
      : '<p class="muted">No review data yet. It refreshes on the first scrape of each month.</p>';

  const es = card.employeeSentiment;
  const employees =
    config.site.showEmployeeSentiment && es
      ? section(
          'employees',
          'Employee sentiment',
          `<div class="ratings"><div class="rating"><b>${es.rating ?? '–'}</b><small>Overall rating</small></div><div class="rating"><b>${es.ceoApproval ?? '–'}%</b><small>CEO approval</small></div><div class="rating"><b>${es.recommendToFriend ?? '–'}%</b><small>Would recommend</small></div></div>${themes(es)}`,
          'For your read on stability and roadmap risk. Don’t quote this to prospects.',
        )
      : '';

  const intel = card.fieldIntel.length
    ? `<ul class="intel">${[...card.fieldIntel]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((i) => `<li>${esc(i.text)}<div class="by">${esc(i.author)}, ${prettyDate(i.date)}${i.source ? `. Source: ${esc(i.source)}` : ''}</div></li>`)
        .join('')}</ul>`
    : `<p class="muted">Nothing yet. Heard something? Post it in #${esc(config.slack.intelChannel)}.</p>`;

  const s = card.snapshot ?? {};
  const facts = [
    ['Founded', s.founded], ['Headquarters', s.hq], ['Employees', s.employees], ['Funding', s.funding], ['Leadership', s.leadership],
  ].filter(([, v]) => v);
  const snapshot = `${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${
    s.news?.length ? `<h3 style="margin-top:20px">News</h3><ul class="changelog">${s.news.map((n) => `<li><time datetime="${n.date}">${prettyDate(n.date)}</time><span>${esc(n.headline)}</span></li>`).join('')}</ul>` : ''
  }`;

  const methodLabel = { fetch: 'Page monitored', search: 'Web search', api: 'Licensed API', upload: 'Admin upload' };
  const sources = card.sources.length
    ? `<div class="table-scroll"><table class="sources"><thead><tr><th scope="col">Watching</th><th scope="col">How</th><th scope="col">For</th><th scope="col">Approved</th></tr></thead><tbody>${card.sources
        .map((src) => `<tr><td>${src.method === 'fetch' ? `<a href="${esc(src.url)}" rel="nofollow noopener">${esc(src.url.replace(/^https?:\/\//, ''))}</a>` : esc(src.url)}</td><td class="method">${methodLabel[src.method] ?? src.method}</td><td>${esc(src.purpose)}</td><td>${esc(src.approvedBy)}, ${prettyDate(src.approvedAt)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '';

  const body = `<p class="crumbs"><a href="../../">Battlecards</a> / <a href="../../#cat-${cat?.id}">${esc(cat?.name ?? card.category)}</a></p>
<div class="card-head">
<div><h1>${esc(card.name)}</h1>
<div class="card-meta">${freshness(card)}<a href="${esc(card.website)}" rel="noopener">${esc(card.website.replace(/^https?:\/\//, ''))}</a><span class="muted">Owner: ${esc(card.owner)}</span></div></div>
<div class="actions"><button class="btn" type="button" data-copy-link>Copy link</button><button class="btn" type="button" data-print>Print</button></div>
</div>
<div class="sign" role="note" aria-label="Positioning statement">${pos}</div>
${scorecard}
<div class="two-col">
${section('why', 'Why we win', whyWin) || '<div></div>'}
${section('where', 'Where they win', theyWin, 'Know these before the call so they don’t surprise you.') || '<div></div>'}
</div>
${section('objections-h', 'Objection handling', objections)}
${section('landmines-h', 'Questions to ask the prospect', landmines, 'Each one points at a gap in their offer. Ask, then listen.')}
${section('intel-h', 'Field intel', intel, 'From reps, approved by the admin. Newest first.')}
<div class="reference-divider">Reference</div>
${section('messaging-h', 'What they say', messaging, 'Their current headline claims, from their own site.')}
${section('products-h', 'Product lineup', products)}
${section('compliance-h', 'Compliance, security and privacy claims', compliance, 'As published on their site, next to ours.')}
${section('customers-h', 'What customers say', customer, cs?.asOf ? `Public reviews on G2, Capterra and Gartner Peer Insights, as of ${prettyDate(cs.asOf)}.` : '')}
${employees}
${section('snapshot-h', 'Company snapshot', snapshot)}
${section('sources-h', 'Approved sources', sources, 'The only pages and searches the tracker is allowed to use for this competitor.')}`;

  return page({ title: `${card.name} battlecard`, body, depth: 2, active: 'home', description: card.positioning });
}

// ---------- monthly updates ----------
function updatePage(u) {
  const ind = config.monthly.industryQuestions;
  const titles = { trends: 'Industry trends', regulatory: 'Regulatory updates', mna: 'Mergers and acquisitions', health: 'Industry health' };
  const industry = Object.keys(ind)
    .map((k) => {
      const s = u.industry?.[k];
      if (!s) return '';
      return `<section><h3>${titles[k] ?? k}</h3><p>${esc(s.summary)}</p>${
        s.items?.length ? `<ul>${s.items.map((i) => `<li>${esc(i.text)}${i.url ? ` <a href="${esc(i.url)}" rel="noopener">Source</a>` : ''}</li>`).join('')}</ul>` : ''
      }</section>`;
    })
    .join('');
  const n = config.monthly.topMoversPerCategory;
  const cats = u.categories
    .map(
      (c) => `<section class="section" aria-labelledby="m-${c.id}"><h2 id="m-${c.id}">${esc(c.name)}</h2>
<p class="lede">Top ${Math.min(n, c.movers.length)} mover${c.movers.length === 1 ? '' : 's'} of ${c.tracked} tracked.</p>
${c.movers.length ? `<ol class="movers">${c.movers
        .map(
          (m, i) => `<li><div><h3><a href="../../battlecards/${m.slug}/">${esc(m.name)}</a></h3><span class="rank">Biggest mover${i ? ` #${i + 1}` : ''}</span></div>
<div><p>${esc(m.whatChanged)}</p><p class="so"><b>What to do:</b> ${esc(m.soWhat)}</p></div></li>`,
        )
        .join('')}</ol>` : '<p>No meaningful movement this month.</p>'}
${c.quiet?.length ? `<p class="quiet">Also tracked, quiet this month: ${c.quiet.map(esc).join(', ')}.</p>` : ''}
</section>`,
    )
    .join('');
  const body = `<p class="crumbs"><a href="../">Monthly updates</a></p>
<div class="update-head">${u.status === 'draft' ? '<span class="tag tag-draft">Draft: not yet published to Slack</span>' : ''}
<h1>${esc(u.title)}</h1>
<p class="muted">${prettyMonth(u.id)} update, covering ${prettyDate(u.window.from)} to ${prettyDate(u.window.to)}${u.publishedAt ? `. Published ${prettyDate(u.publishedAt)}.` : '.'}</p></div>
<section class="tldr" aria-labelledby="tldr-h"><h2 id="tldr-h">TL;DR: three things to know</h2>
<ol>${u.tldr.map((t) => `<li>${esc(t.text)}${t.slug ? ` <a href="../../battlecards/${t.slug}/">Battlecard</a>` : ''}</li>`).join('')}</ol></section>
<section class="section" aria-labelledby="ind-h"><h2 id="ind-h">The market</h2><div class="industry">${industry}</div></section>
<h2 style="margin:8px 0 18px">Competitor movers</h2>
${cats}
${u.sources?.length ? `<section class="section"><h2>Sources</h2><ul>${u.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ul></section>` : ''}`;
  return page({ title: u.title, body, depth: 2, active: 'updates', description: u.tldr.map((t) => t.text).join(' ') });
}

function updatesIndex() {
  const published = updates.filter((u) => u.status === 'published');
  const next = nextFirstWeekday();
  const body = `<h1 style="font-size:clamp(2rem,5vw,3rem)">Monthly updates</h1>
<p class="muted" style="margin:8px 0 24px;max-width:var(--measure)">Posted in #${esc(config.slack.updatesChannel)} on the first Tuesday of each month: the top three things to know, the market, and the biggest movers in each category. Next one: ${prettyDate(next)}.</p>
<ul class="update-list">${published
    .map((u) => `<li><a href="${u.id}/">${esc(u.title)}</a><p class="muted" style="margin-top:4px">${prettyMonth(u.id)}. ${esc(u.tldr[0]?.text ?? '')}</p></li>`)
    .join('') || '<li>The first update will appear here after it’s published.</li>'}</ul>`;
  return page({ title: 'Monthly updates', body, depth: 1, active: 'updates' });
}

function nextFirstWeekday() {
  const d = new Date(`${today}T12:00:00Z`);
  for (let m = 0; m < 3; m++) {
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + m;
    const first = new Date(Date.UTC(y, mo, 1));
    const offset = (config.monthly.weekday - first.getUTCDay() + 7) % 7;
    const cand = new Date(Date.UTC(y, mo, 1 + offset)).toISOString().slice(0, 10);
    if (cand >= today) return cand;
  }
  return today;
}

// ---------- changes feed ----------
function changesPage() {
  const byslug = new Map(competitors.map((c) => [c.slug, c]));
  const items = [...changes]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((c) => byslug.get(c.slug)?.status === 'active')
    .map((c) => {
      const comp = byslug.get(c.slug);
      return `<li data-cat="${comp.category}" data-type="${c.type}" data-sev="${c.severity}">
<time datetime="${c.date}">${prettyDate(c.date)}</time>
<div class="who"><a href="../battlecards/${c.slug}/">${esc(comp.name)}</a><span class="kind">${changeTypeLabel[c.type] ?? c.type}${c.severity === 'major' ? ', <span class="sev-major">major</span>' : ''}</span></div>
<div>${esc(c.summary)}${c.before || c.after ? `<div class="ba">${c.before ? `Was: ${esc(c.before)}` : ''}${c.before && c.after ? '. ' : ''}${c.after ? `Now: ${esc(c.after)}` : ''}</div>` : ''}</div>
</li>`;
    })
    .join('');
  const opt = (pairs) => pairs.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  const body = `<h1 style="font-size:clamp(2rem,5vw,3rem)">Changes</h1>
<p class="muted" style="margin-top:8px;max-width:var(--measure)">Everything the tracker has noticed: website changes from the weekly scan, review and rating moves, news, and field intel approved from Slack.</p>
<div class="filters" role="group" aria-label="Filter changes">
<label>Category<select data-filter="cat"><option value="">All</option>${opt(config.categories.map((c) => [c.id, c.name]))}</select></label>
<label>Type<select data-filter="type"><option value="">All</option>${opt(Object.entries(changeTypeLabel))}</select></label>
<label>Severity<select data-filter="sev"><option value="">All</option><option value="major">Major only</option></select></label>
</div>
<ul class="feed" id="feed">${items}</ul>
<p id="feed-empty" hidden>No changes match those filters.</p>`;
  return page({ title: 'Changes', body, depth: 1, active: 'changes' });
}

// ---------- write ----------
function out(rel, html) {
  const file = path.join(PATHS.dist, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
}

rmSync(PATHS.dist, { recursive: true, force: true });
mkdirSync(path.join(PATHS.dist, 'assets'), { recursive: true });
for (const f of readdirSync(path.join(PATHS.site, 'assets'))) copyFileSync(path.join(PATHS.site, 'assets', f), path.join(PATHS.dist, 'assets', f));
writeFileSync(path.join(PATHS.dist, '.nojekyll'), '');

out('index.html', homePage());
// Draft and review cards get pages too, so the admin can preview them; they aren't linked from the home page.
for (const c of competitors) out(`battlecards/${c.slug}/index.html`, battlecardPage(c));
out('updates/index.html', updatesIndex());
for (const u of updates) out(`updates/${u.id}/index.html`, updatePage(u));
out('changes/index.html', changesPage());
// A small JSON index the Slack bot and others can read.
out('index.json', JSON.stringify(live.map((c) => ({ slug: c.slug, name: c.name, category: c.category, positioning: c.positioning, url: `battlecards/${c.slug}/` })), null, 2));
console.log(`Built ${competitors.length} battlecards, ${updates.length} update(s) and the changes feed into dist/`);
