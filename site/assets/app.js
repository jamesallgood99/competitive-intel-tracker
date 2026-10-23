// Small progressive enhancements. Every page works without this file.

// Home: filter the roster as you type.
const find = document.getElementById('find');
if (find) {
  const rows = [...document.querySelectorAll('#roster li[data-search]')];
  const sections = [...document.querySelectorAll('#roster .category')];
  const none = document.getElementById('no-match');
  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const hit = !q || r.dataset.search.includes(q);
      r.hidden = !hit;
      if (hit) shown++;
    }
    for (const s of sections) s.hidden = Boolean(q) && !s.querySelector('li[data-search]:not([hidden])');
    none.hidden = shown > 0;
  });
  // Enter jumps straight to the card when only one matches.
  find.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const visible = rows.filter((r) => !r.hidden);
    if (visible.length === 1) location.href = visible[0].querySelector('a').href;
  });
}

// Battlecard: copy link and print.
document.querySelector('[data-copy-link]')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  try {
    await navigator.clipboard.writeText(location.href.split('#')[0]);
    btn.textContent = 'Link copied';
  } catch {
    btn.textContent = 'Copy failed: use the address bar';
  }
  setTimeout(() => (btn.textContent = 'Copy link'), 2000);
});
document.querySelector('[data-print]')?.addEventListener('click', () => window.print());

// Changes: filters.
const feed = document.getElementById('feed');
if (feed) {
  const selects = [...document.querySelectorAll('[data-filter]')];
  const items = [...feed.children];
  const empty = document.getElementById('feed-empty');
  const apply = () => {
    const f = Object.fromEntries(selects.map((s) => [s.dataset.filter, s.value]));
    let shown = 0;
    for (const li of items) {
      const hit = (!f.cat || li.dataset.cat === f.cat) && (!f.type || li.dataset.type === f.type) && (!f.sev || li.dataset.sev === f.sev);
      li.hidden = !hit;
      if (hit) shown++;
    }
    empty.hidden = shown > 0;
  };
  selects.forEach((s) => s.addEventListener('change', apply));
}
