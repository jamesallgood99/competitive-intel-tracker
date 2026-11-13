// Product tour for the public demo: an intro screen and the four features worth seeing.
// It opens on a first visit to the home page (or with ?tour in the URL), and the "Take the tour"
// button in the project ribbon reopens it from any page. Forks with their own data never load this file.
(() => {
  const script = document.currentScript;
  const base = script?.dataset.base ?? '';
  const autostart = script?.dataset.autostart === 'true';
  let data;
  try {
    data = JSON.parse(document.getElementById('tour-data')?.textContent || 'null');
  } catch {
    data = null;
  }
  if (!data) return;

  const SEEN_KEY = 'cit-tour-seen';
  const store = {
    get: () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } },
    set: () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode: fine */ } },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const mark = (v) => `<span class="mark mark-${v}" aria-hidden="true"></span>`;
  const VERDICT = { win: 'Win', parity: 'Parity', loss: 'Loss' };
  const initials = (name) => name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const card = data.card;
  const cardUrl = `${base}battlecards/${card.slug}/`;

  // ---------- the visuals, one per step ----------
  const introVisual = `<div class="tv-split" aria-hidden="true">
  <div class="tv-half"><span class="tv-label">In Slack</span>
    <ul><li>Reps post what they hear</li><li>The admin approves every change</li><li><code>/battlecard</code> gets the link</li><li>The monthly update lands in the channel</li></ul>
    <span class="tv-note">You can't click around in this half. The tour shows you what it does.</span></div>
  <div class="tv-arrow">→</div>
  <div class="tv-half tv-half-site"><span class="tv-label">On this site</span>
    <ul><li>${data.competitors} battlecards in ${data.categories} categories</li><li>Every change, filterable</li><li>Each month's update</li></ul>
    <span class="tv-note">This half is live. Explore it after the tour.</span></div>
</div>`;

  const intel = data.intel;
  const slackVisual = intel
    ? `<div class="tv-slack" aria-label="Example Slack thread">
  <div class="tv-chan"># ${esc(data.intelChannel)}</div>
  <div class="tv-msg"><span class="tv-av">${esc(initials(intel.author))}</span><div><b>${esc(intel.author)}</b><p>${esc(intel.text)}</p></div></div>
  <div class="tv-msg tv-bot"><span class="tv-av tv-av-bot" aria-hidden="true"></span><div><b>Intel Tracker <span class="tv-app">APP</span></b><p>Tagged <b>${esc(card.name)}</b> and rewrote it for the card. Sent to the admin for review.</p></div></div>
  <div class="tv-msg tv-bot tv-later"><span class="tv-av tv-av-bot" aria-hidden="true"></span><div><b>Intel Tracker <span class="tv-app">APP</span></b><p>✅ Approved. It's on the <span class="tv-link">${esc(card.name)} battlecard</span> now.</p></div></div>
</div>`
    : '';

  const cardVisual = `<div class="tv-card" aria-label="Example battlecard">
  <div class="tv-card-name">${esc(card.name)}</div>
  <div class="tv-sign">${esc(card.positioning)}</div>
  <div class="tv-score">${card.scorecard
    .map((s) => `<div class="tv-row"><span>${esc(s.capability)}</span><span class="verdict verdict-${s.verdict}">${mark(s.verdict)}${VERDICT[s.verdict] ?? s.verdict}</span></div>`)
    .join('')}</div>
</div>`;

  const ch = data.change;
  const changeVisual = ch
    ? `<div class="tv-change" aria-label="Example change from the weekly scan">
  <div class="tv-scan"><span class="tv-pulse" aria-hidden="true"></span>Weekly scan · ${esc(ch.date)}</div>
  <div class="tv-change-body">
    <div class="tv-change-who"><b>${esc(ch.name)}</b><span>${esc(ch.type)}, <span class="sev-major">major</span></span></div>
    <p>${esc(ch.summary)}</p>
    ${ch.before || ch.after ? `<div class="tv-diff">${ch.before ? `<span class="tv-was">Was: ${esc(ch.before)}</span>` : '<span class="tv-was">Was: not on their site</span>'}<span class="tv-now">Now: ${esc(ch.after ?? '')}</span></div>` : ''}
  </div>
  <div class="tv-dm">Sent to the admin's DMs the day it was found</div>
</div>`
    : '';

  const up = data.update;
  const updateVisual = up
    ? `<div class="tv-update" aria-label="Example monthly update">
  <div class="tv-update-head"><span># ${esc(data.updatesChannel)}</span><span>First Tuesday · ${esc(up.month)}</span></div>
  <div class="tv-update-title">${esc(up.title)}</div>
  <div class="tv-tldr-label">Three things to know</div>
  <ol>${up.tldr.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
</div>`
    : '';

  // ---------- the steps ----------
  const steps = [
    {
      intro: true,
      kicker: 'Product tour',
      title: 'Battlecards that keep themselves current',
      body: `Most competitive programs build forty battlecards in a sprint and watch them go stale. This one is fed by the reps in Slack, checks competitors' sites every week, and writes the monthly update. ${esc(data.company)} and every competitor here are fictional.`,
      visual: introVisual,
    },
    {
      kicker: 'Feature 1 of 4',
      title: 'Reps add intel without leaving Slack',
      body: `A rep posts what they heard in #${esc(data.intelChannel)}. Claude tags the competitor and rewrites it neutrally, and the admin approves, edits or rejects it from their DMs. Nothing reaches a card without a human signing off.`,
      visual: slackVisual,
      cta: { label: `See the intel on the ${card.name} card`, href: `${cardUrl}#intel-h` },
    },
    {
      kicker: 'Feature 2 of 4',
      title: 'A battlecard a rep can read in sixty seconds',
      body: 'The positioning statement sits on a hi-vis sign so nobody misses it. The quick look marks every capability win, parity or loss, using safety-sign shapes so it reads without color. Objections, landmine questions and the reference material sit below.',
      visual: cardVisual,
      cta: { label: `Open the ${card.name} battlecard`, href: cardUrl },
    },
    {
      kicker: 'Feature 3 of 4',
      title: 'It notices when competitors change',
      body: 'Every week the tracker checks the pages and searches the admin approved for each competitor: products, pricing, messaging, compliance claims, reviews and news. Major changes go to the admin the same day, and everything lands in one filterable feed.',
      visual: changeVisual,
      cta: { label: 'Browse the changes feed', href: `${base}changes/` },
    },
    {
      kicker: 'Feature 4 of 4',
      title: 'The monthly update writes its first draft',
      body: `On the first Tuesday of each month, the admin gets a draft: three things to know, the market, and the biggest movers in each category so one busy category can't drown out the rest. One button publishes it to #${esc(data.updatesChannel)}.`,
      visual: updateVisual,
      cta: up ? { label: `Read the ${up.month} update`, href: `${base}updates/${up.id}/` } : null,
    },
  ].filter((s) => s.intro || s.visual);

  // ---------- the dialog ----------
  const root = document.createElement('div');
  root.className = 'tour';
  root.hidden = true;
  root.innerHTML = `<div class="tour-backdrop" data-tour-close></div>
<div class="tour-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" tabindex="-1">
  <div class="tour-bar">
    <span class="tour-kicker" id="tour-kicker"></span>
    <button class="tour-x" type="button" data-tour-close aria-label="Close the tour">×</button>
  </div>
  <div class="tour-visual" id="tour-visual"></div>
  <div class="tour-copy">
    <h2 id="tour-title"></h2>
    <p id="tour-body"></p>
    <a class="tour-cta" id="tour-cta" hidden></a>
  </div>
  <div class="tour-foot">
    <ol class="tour-dots" id="tour-dots" aria-label="Tour steps"></ol>
    <div class="tour-buttons">
      <button class="tour-btn tour-ghost" type="button" id="tour-back"></button>
      <button class="tour-btn tour-primary" type="button" id="tour-next"></button>
    </div>
  </div>
  <p class="visually-hidden" aria-live="polite" id="tour-status"></p>
</div>`;
  document.body.appendChild(root);

  const $ = (id) => root.querySelector(`#${id}`);
  const dialog = root.querySelector('.tour-dialog');
  const dots = $('tour-dots');
  dots.innerHTML = steps
    .map((s, i) => `<li><button type="button" data-step="${i}" aria-label="${i === 0 ? 'Intro' : esc(s.title)}"></button></li>`)
    .join('');

  let current = 0;
  let opener = null;

  function render() {
    const s = steps[current];
    const last = current === steps.length - 1;
    dialog.classList.toggle('is-intro', Boolean(s.intro));
    $('tour-kicker').textContent = s.kicker;
    $('tour-title').textContent = s.title;
    $('tour-body').innerHTML = s.body;
    $('tour-visual').innerHTML = s.visual;
    const cta = $('tour-cta');
    if (s.cta) {
      cta.hidden = false;
      cta.textContent = `${s.cta.label} →`;
      cta.href = s.cta.href;
    } else {
      cta.hidden = true;
    }
    const back = $('tour-back');
    const next = $('tour-next');
    back.textContent = s.intro ? "Skip, I'll explore" : 'Back';
    next.textContent = s.intro ? 'Show me around' : last ? 'Start exploring' : 'Next';
    [...dots.querySelectorAll('button')].forEach((b, i) => {
      b.setAttribute('aria-current', i === current ? 'step' : 'false');
    });
    dialog.scrollTop = 0;
    $('tour-status').textContent = s.intro ? '' : `${s.kicker}: ${s.title}`;
    // Replay the entrance animation on each step.
    dialog.classList.remove('is-stepping');
    void dialog.offsetWidth;
    dialog.classList.add('is-stepping');
  }

  function open(at = 0) {
    opener = document.activeElement;
    current = at;
    render();
    root.hidden = false;
    document.documentElement.classList.add('tour-open');
    requestAnimationFrame(() => root.classList.add('is-open'));
    $('tour-next').focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }

  function close() {
    store.set();
    root.classList.remove('is-open');
    document.documentElement.classList.remove('tour-open');
    root.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
  }

  function go(i) {
    current = Math.max(0, Math.min(steps.length - 1, i));
    render();
  }

  $('tour-next').addEventListener('click', () => (current === steps.length - 1 ? close() : go(current + 1)));
  $('tour-back').addEventListener('click', () => (steps[current].intro ? close() : go(current - 1)));
  $('tour-cta').addEventListener('click', () => store.set());
  dots.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) go(Number(b.dataset.step));
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-tour-close]')) close();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowRight' && !e.target.closest('a, input')) { e.preventDefault(); if (current < steps.length - 1) go(current + 1); return; }
    if (e.key === 'ArrowLeft' && !e.target.closest('a, input')) { e.preventDefault(); go(current - 1); return; }
    if (e.key !== 'Tab') return;
    // Keep focus inside the dialog.
    const focusable = [...dialog.querySelectorAll('button, a[href]:not([hidden])')].filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  });

  document.querySelectorAll('[data-tour-open]').forEach((b) => b.addEventListener('click', () => open(0)));

  const forced = new URLSearchParams(location.search).has('tour');
  if (forced || (autostart && !store.get())) open(0);
})();
