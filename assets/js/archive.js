/**
 * Problems archive — a searchable index of every accepted solution.
 *
 * problems.json in the solutions repository is the source of truth: it carries
 * every accepted problem, including the ~230 from private training groups that
 * never appear in the public Codeforces API. Live Codeforces data adds to it —
 * a public solve the repository has not synced yet is listed straight from its
 * Codeforces submission — so the count never collapses to the public subset
 * and never lags behind a new accept. The page keeps itself current while it
 * is open (see liveData).
 */

import { liveData, pendingSolves } from './data.js';
import { startMotion, waitForLibs, drawIcons, revealBatch, countUp, keepCounts, boxHover } from './motion.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
};

const icon = name => el('i', { 'data-lucide': name });
const fmt = n => Number(n).toLocaleString('en');

/* ------------------------------------------------------------ taxonomy --- */

/** Training sources, matched against the first path segment in the repository. */
const SOURCES = {
  I: { label: 'IEEE CodeRefine', match: f => f === 'IEEE - CodeRefine V2.0' },
  Q: { label: 'Level 1 Qualification', match: f => f.startsWith('Level 1 Qualification') },
  A: { label: 'acmASCIS Level 1', match: f => f.startsWith('acmASCIS') },
  Z: { label: 'Level Zero 2025', match: f => f.startsWith('Level Zero') },
  N: { label: 'Assiut Newcomers', match: f => f.startsWith('Assiut') },
  C: { label: 'Codeforces rounds', match: f => /^(contest|Rating)-/.test(f) },
};

/** Codeforces rating tiers, used for the per-row rating dot. */
const TIERS = [
  { name: 'Newbie', max: 1199, color: 'oklch(0.62 0 0)' },
  { name: 'Pupil', max: 1399, color: 'oklch(0.6 0.17 145)' },
  { name: 'Specialist', max: 1599, color: 'oklch(0.64 0.11 195)' },
  { name: 'Expert', max: 1899, color: 'oklch(0.5 0.2 262)' },
  { name: 'Candidate master', max: 2099, color: 'oklch(0.52 0.2 315)' },
  { name: 'Master', max: 2399, color: 'oklch(0.72 0.16 65)' },
  { name: 'Grandmaster', max: 9999, color: 'oklch(0.58 0.22 27)' },
];

const tierFor = r => (r ? TIERS.find(t => r <= t.max) : null);

const BANDS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'rated', label: 'Rated only', test: r => r > 0 },
  { id: 'unrated', label: 'Unrated', test: r => !r },
  { id: '800', label: '800', test: r => r === 800 },
  { id: '900-1000', label: '900–1000', test: r => r >= 900 && r <= 1000 },
  { id: '1100+', label: '1100+', test: r => r >= 1100 },
];

const SORTS = [
  { id: 'newest', label: 'Newest first', key: 'n', dir: 1 },
  { id: 'r-desc', label: 'Rating: high → low', key: 'rating', dir: -1 },
  { id: 'r-asc', label: 'Rating: low → high', key: 'rating', dir: 1 },
  { id: 'ms-asc', label: 'Fastest runtime', key: 'ms', dir: 1 },
  { id: 'name', label: 'Name A–Z', key: 'name', dir: 1 },
];

const HEADS = [
  { key: 'n', label: '#' },
  { key: 'code', label: 'Problem' },
  { key: 'name', label: 'Name' },
  { key: null, label: 'Source' },
  { key: 'rating', label: 'Rating' },
  { key: null, label: 'Tags' },
  { key: 'ms', label: 'Runtime' },
];

const DONUT_PALETTE = [
  'oklch(0.68 0.19 30)', 'oklch(0.66 0.22 355)', 'oklch(0.6 0.24 318)',
  'oklch(0.56 0.21 285)', 'oklch(0.58 0.18 255)', 'oklch(0.7 0.13 225)',
  'oklch(0.7 0.14 190)', 'oklch(0.72 0.17 150)', 'oklch(0.8 0.17 120)',
  'oklch(0.78 0.16 75)',
];

/* ------------------------------------------------------------- shaping --- */

const decode = s =>
  String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

function shape(raw, i, repoBase) {
  const top = (raw.relativeFolder || '').split('/')[0];
  const source = Object.keys(SOURCES).find(k => SOURCES[k].match(top)) || 'C';
  const tags = (raw.tags || []).filter(t => t !== 'untagged');
  const std = String(raw.language || '').match(/C\+\+\s?(\d+)/)?.[1] ?? '';

  return {
    n: i + 1,
    source,
    code: `${raw.contestId}${raw.index}`,
    name: decode(raw.name),
    rating: raw.rating || 0,
    tags,
    lang: std ? `C++${std}` : 'C++',
    ms: typeof raw.timeConsumedMillis === 'number' ? raw.timeConsumedMillis : -1,
    url: raw.relativeFolder ? repoBase + encodePath(raw.relativeFolder) : raw.submissionUrl ?? raw.url,
    codeforcesUrl: raw.url,
    // Accepted on Codeforces, not yet in the repository (it syncs daily).
    pending: !raw.relativeFolder && Boolean(raw.submissionUrl),
  };
}

/* --------------------------------------------------------------- state --- */

const state = {
  problems: [],
  query: '',
  source: 'all',
  band: 'all',
  tag: null,
  sortKey: 'n',
  sortDir: 1,
  page: 0,
  donutMode: 'all',
  hovered: null,
};

const hasFilters = () =>
  Boolean(state.query || state.tag || state.source !== 'all' || state.band !== 'all');

function resetFilters() {
  Object.assign(state, { query: '', source: 'all', band: 'all', tag: null, page: 0 });
  $('[data-search]').value = '';
  render('swap');
}

/**
 * Any change to the filter set goes back to the first page.
 *
 * `motion` is decided by how often the change happens, not by what it is:
 *   'quiet'  typing and header sorts — fired constantly, so a 150ms fade only
 *   'swap'   a chip click — occasional, a short cascade confirms the new set
 *   'swap'   also a page change — the new page cascades in
 */
function update(patch, { resetPaging = true, motion = 'swap' } = {}) {
  Object.assign(state, patch, resetPaging ? { page: 0 } : {});
  render(motion);
}

function matching() {
  const needle = state.query.trim().toLowerCase();
  const band = BANDS.find(b => b.id === state.band) ?? BANDS[0];

  return state.problems.filter(p =>
    (state.source === 'all' || p.source === state.source) &&
    band.test(p.rating) &&
    (!state.tag || p.tags.includes(state.tag)) &&
    (!needle || `${p.name} ${p.code} ${p.tags.join(' ')}`.toLowerCase().includes(needle)),
  );
}

function sorted(list) {
  const { sortKey, sortDir } = state;
  return [...list].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];

    // Missing ratings and runtimes sink to the bottom of either direction.
    if (sortKey === 'ms' || sortKey === 'rating') {
      const ah = sortKey === 'ms' ? av >= 0 : av > 0;
      const bh = sortKey === 'ms' ? bv >= 0 : bv > 0;
      if (ah !== bh) return ah ? -1 : 1;
      if (!ah) return a.n - b.n;
      return (av - bv) * sortDir || a.n - b.n;
    }
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sortDir;
  });
}

/* ----------------------------------------------------------- rendering --- */

function chip(label, active, onClick) {
  return el('button', {
    type: 'button',
    class: `btn ${active ? 'btn-primary' : 'btn-secondary'} chip`,
    'aria-pressed': String(active),
    onClick,
    text: label,
  });
}

function renderStats() {
  const rated = state.problems.filter(p => p.rating);
  const tags = new Set(state.problems.flatMap(p => p.tags));
  const peak = rated.length ? Math.max(...rated.map(p => p.rating)) : 0;

  const stats = [
    { icon: 'check-check', value: fmt(state.problems.length), label: 'Problems accepted' },
    { icon: 'bar-chart-3', value: fmt(rated.length), label: 'Rated problems' },
    { icon: 'flame', value: fmt(peak), label: 'Hardest rating solved' },
    { icon: 'tags', value: fmt(tags.size), label: 'Algorithm tags covered' },
  ];

  keepCounts($('[data-stats]'), root => root.replaceChildren(
    ...stats.map(s =>
      el('div', { class: 'stat', 'data-reveal': true, 'data-box': true }, [
        icon(s.icon),
        el('p', { class: 'stat__value', 'data-count': true, text: s.value }),
        el('p', { class: 'stat__label', text: s.label }),
      ]),
    ),
  ));
}

function renderDonut() {
  const rated = state.problems.filter(p => p.rating);
  const byRating = {};
  for (const p of rated) byRating[p.rating] = (byRating[p.rating] || 0) + 1;

  const items = Object.keys(byRating)
    .map(Number)
    .sort((a, b) => a - b)
    .map((r, i) => ({
      key: `r${r}`,
      label: `${r} rating`,
      count: byRating[r],
      color: DONUT_PALETTE[i % DONUT_PALETTE.length],
    }));

  const unrated = state.problems.length - rated.length;
  if (state.donutMode === 'all' && unrated) {
    items.push({ key: 'u', label: 'Unrated', title: 'Private training groups — Codeforces does not rate these', count: unrated, color: 'var(--color-neutral-400)' });
  }

  const total = Math.max(1, items.reduce((a, b) => a + b.count, 0));
  const circumference = 2 * Math.PI * 78;
  const gap = items.length > 1 ? 1.6 : 0;

  let offset = 0;
  const segments = items.map(item => {
    const length = (item.count / total) * circumference;
    const seg = {
      ...item,
      pct: `${((item.count / total) * 100).toFixed(1)}%`,
      dash: `${Math.max(0.5, length - gap).toFixed(2)} ${circumference.toFixed(2)}`,
      offset: (-offset).toFixed(2),
    };
    offset += length;
    return seg;
  });

  // Hover never re-renders: replacing the slice under the cursor would swallow
  // its mouseleave and strand the previous slice's number in the centre.
  const group = $('[data-donut-segments]');
  const svgNS = 'http://www.w3.org/2000/svg';
  const circles = segments.map(s => {
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('data-seg', '');
    c.setAttribute('cx', '100');
    c.setAttribute('cy', '100');
    c.setAttribute('r', '78');
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', s.color);
    c.setAttribute('stroke-width', '34');
    c.setAttribute('stroke-dasharray', s.dash);
    c.setAttribute('stroke-dashoffset', s.offset);
    c.setAttribute('transform', 'rotate(-90 100 100)');
    c.addEventListener('mouseenter', () => donutHover(s.key));
    c.addEventListener('mouseleave', () => donutHover(null));
    return c;
  });
  group.replaceChildren(...circles);

  const rows = segments.map(s =>
    el('div', {
      class: 'legend__row',
      'data-on': '0',
      onMouseEnter: () => donutHover(s.key),
      onMouseLeave: () => donutHover(null),
    }, [
      el('span', { class: 'legend__swatch', style: `background: ${s.color}` }),
      el('span', { class: 'legend__name', text: s.label, title: s.title ?? s.label }),
      el('span', { class: 'legend__count', text: fmt(s.count) }),
      el('span', { class: 'legend__pct', text: s.pct }),
    ]),
  );
  $('[data-legend]').replaceChildren(...rows);

  donut = { segments, circles, rows, total };
  state.hovered = null;
  paintDonutCenter(null, false);

  $('[data-donut-modes]').replaceChildren(
    ...[['all', 'All problems'], ['rated', 'Rated only']].map(([id, label]) =>
      chip(label, state.donutMode === id, () => {
        state.donutMode = id;
        state.hovered = null;
        renderDonut();
      }),
    ),
  );

  const peak = rated.length ? Math.max(...rated.map(p => p.rating)) : 0;
  const floor = rated.length ? Math.min(...rated.map(p => p.rating)) : 0;
  $('[data-difficulty-title]').textContent = rated.length ? `From ${floor} to ${peak}.` : 'Difficulty.';
  $('[data-difficulty-note]').textContent =
    `${fmt(rated.length)} rated problems out of ${fmt(state.problems.length)}. ` +
    `Hover a slice for details. The other ${fmt(unrated)} come from private training groups, which aren’t rated.`;
}

/* ------------------------------------------------------- donut hover ---- */

let donut = null;
let leaveTimer = null;

/**
 * Point the donut at one slice, or `null` for the total. Leaving waits a
 * beat, so sliding from one slice straight onto the next doesn't flash the
 * total in between.
 */
function donutHover(key) {
  if (!donut) return;
  const gsap = window.gsap;

  if (leaveTimer) {
    if (gsap) leaveTimer.kill();
    else clearTimeout(leaveTimer);
    leaveTimer = null;
  }

  if (key === null) {
    const settle = () => { leaveTimer = null; setDonutActive(null); };
    leaveTimer = gsap ? gsap.delayedCall(0.08, settle) : setTimeout(settle, 80);
  } else {
    setDonutActive(key);
  }
}

function setDonutActive(key) {
  if (key === state.hovered) return;
  state.hovered = key;

  donut.segments.forEach((s, i) => {
    const on = s.key === key;
    donut.circles[i].setAttribute('stroke-width', on ? '42' : '34');
    donut.rows[i].dataset.on = on ? '1' : '0';
  });

  paintDonutCenter(donut.segments.find(s => s.key === key) ?? null, true);
}

/** Write the centre readout; with `animate`, the old value lifts out first. */
function paintDonutCenter(active, animate) {
  const parts = ['[data-donut-k]', '[data-donut-v]', '[data-donut-sub]'].map(sel => $(sel));
  const [k, v, sub] = parts;

  const write = () => {
    k.textContent = active ? active.label : (state.donutMode === 'all' ? 'Problems' : 'Rated');
    v.textContent = active ? fmt(active.count) : fmt(donut.total);
    v.style.color = active ? active.color : 'var(--color-text)';
    sub.textContent = active
      ? `${active.pct} of shown`
      : (state.donutMode === 'all' ? 'accepted' : 'with a CF rating');
  };

  const gsap = window.gsap;
  if (!animate || !gsap || document.documentElement.classList.contains('no-motion')) {
    gsap?.killTweensOf(parts);
    if (gsap) gsap.set(parts, { clearProps: 'opacity,transform' });
    write();
    return;
  }

  gsap.killTweensOf(parts);
  gsap.timeline()
    .to(parts, { y: -10, opacity: 0, duration: 0.14, ease: 'power2.in', stagger: 0.02 })
    .add(write)
    .fromTo(parts,
      { y: 10, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.32, ease: 'power3.out', stagger: 0.03 });
}

function renderTagBars() {
  const counts = {};
  for (const p of state.problems) for (const t of p.tags) counts[t] = (counts[t] || 0) + 1;

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const peak = Math.max(1, ...top.map(t => t[1]));

  $('[data-tag-bars]').replaceChildren(
    ...top.map(([name, count]) =>
      el('button', {
        type: 'button',
        class: 'tag-bar',
        'aria-pressed': String(state.tag === name),
        onClick: () => {
          update({ tag: state.tag === name ? null : name });
          scrollToIndex();
        },
      }, [
        el('span', { class: 'tag-bar__name', text: name }),
        el('span', { class: 'tag-bar__rail' }, [
          el('span', {
            class: 'tag-bar__fill',
            'data-grow-x': true,
            style: `width: ${(count / peak) * 100}%`,
          }),
        ]),
        el('span', { class: 'tag-bar__count', text: fmt(count) }),
      ]),
    ),
  );
}

function renderControls() {
  $('[data-source-opts]').replaceChildren(
    ...[{ id: 'all', label: 'All sources' },
        ...Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label }))]
      .map(o => chip(o.label, state.source === o.id, () => update({ source: o.id }))),
  );

  $('[data-band-opts]').replaceChildren(
    ...BANDS.map(b => chip(b.label, state.band === b.id, () => update({ band: b.id }))),
  );

  $('[data-sort-opts]').replaceChildren(
    ...SORTS.map(s =>
      chip(s.label, state.sortKey === s.key && state.sortDir === s.dir, () =>
        update({ sortKey: s.key, sortDir: s.dir }),
      ),
    ),
  );

  const chipEl = $('[data-tag-chip]');
  chipEl.hidden = !state.tag;
  if (state.tag) {
    chipEl.textContent = `Tag: ${state.tag} ×`;
    chipEl.onclick = () => update({ tag: null });
  }

  $('[data-clear]').hidden = !hasFilters();
}

function renderHeads() {
  $('[data-heads]').replaceChildren(
    ...HEADS.map(h => {
      const active = h.key && h.key === state.sortKey;
      const arrow = active ? (state.sortDir > 0 ? ' ↑' : ' ↓') : '';
      return el('button', {
        type: 'button',
        text: h.label + arrow,
        disabled: !h.key,
        ...(active ? { 'aria-sort': state.sortDir > 0 ? 'ascending' : 'descending' } : {}),
        onClick: () => {
          if (!h.key) return;
          update(
            { sortKey: h.key, sortDir: h.key === state.sortKey ? -state.sortDir : 1 },
            { resetPaging: false, motion: 'quiet' },
          );
        },
      });
    }),
  );
}

const PAGE_SIZE = 20;

function renderRows(list) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const start = state.page * PAGE_SIZE;
  const rows = list.slice(start, start + PAGE_SIZE);
  // Log scale — most solutions land under 100ms, so a linear bar says nothing.
  const msScale = ms => Math.max(2, Math.min(100, (Math.log10(ms + 1) / Math.log10(4000)) * 100));

  $('[data-rows]').replaceChildren(
    ...rows.map(p => {
      const tier = tierFor(p.rating);
      return el('div', { class: 'row row--body', 'data-row': true }, [
        el('span', { class: 'row__n', text: String(p.n).padStart(2, '0') }),
        el('span', { class: 'row__code', text: p.code }),
        el('a', {
          class: 'row__name',
          href: p.url,
          target: '_blank',
          rel: 'noopener',
          title: p.pending
            ? 'Open the accepted submission on Codeforces — syncing to the repository'
            : 'Open the solution on GitHub',
        }, [`${p.name} ↗`]),
        el('span', { class: 'row__source', text: SOURCES[p.source].label }),
        el('span', {
          class: 'row__rating',
          title: tier ? `${tier.name} tier` : 'Unrated — private training group',
        }, [
          el('span', {
            class: 'row__dot',
            style: `background: ${tier ? tier.color : 'var(--color-neutral-300)'}`,
          }),
          p.rating || 'Unrated',
        ]),
        el('span', { class: 'row__tags' },
          (p.tags.length ? p.tags.slice(0, 3) : ['untagged'])
            .map(t => el('span', { class: 'tag tag-neutral', text: t })),
        ),
        el('span', { class: 'row__runtime' }, [
          el('span', {}, [el('strong', { text: p.ms >= 0 ? `${p.ms} ms` : '—' }), ` · ${p.lang}`]),
          el('span', { class: 'row__rail' }, [
            el('span', {
              class: 'row__fill',
              style: `width: ${p.ms >= 0 ? msScale(p.ms) : 0}%; ` +
                     `background: ${p.ms > 1000 ? 'var(--color-text)' : 'var(--color-accent)'}`,
            }),
          ]),
        ]),
      ]);
    }),
  );

  $('[data-empty]').hidden = list.length > 0;
  $$('[data-match-count]').forEach(n => { n.textContent = fmt(list.length); });
  $('[data-shown]').textContent = rows.length ? `${fmt(start + 1)}–${fmt(start + rows.length)}` : '0';
  $('[data-more]').hidden = list.length === 0;
  renderPager(pages);
}

/** Page numbers to show: first, last, and the current page's neighbours. */
function pageList(pages, current) {
  const keep = new Set([0, pages - 1, current - 1, current, current + 1]);
  const out = [];
  for (let i = 0; i < pages; i++) {
    if (keep.has(i)) out.push(i);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

function renderPager(pages) {
  const go = page => () => {
    if (page === state.page || page < 0 || page >= pages) return;
    update({ page }, { resetPaging: false, motion: 'swap' });
    scrollToIndex();
  };

  const pager = $('[data-pager]');
  pager.hidden = pages < 2;
  pager.replaceChildren(
    el('button', {
      type: 'button',
      class: 'btn btn-secondary chip pager__step',
      disabled: state.page === 0,
      'aria-label': 'Previous page',
      onClick: go(state.page - 1),
    }, [icon('chevron-left'), 'Prev']),
    ...pageList(pages, state.page).map(i =>
      i === '…'
        ? el('span', { class: 'pager__gap', 'aria-hidden': 'true', text: '…' })
        : el('button', {
            type: 'button',
            class: `btn ${i === state.page ? 'btn-primary' : 'btn-secondary'} chip`,
            'aria-label': `Page ${i + 1}`,
            'aria-current': i === state.page ? 'page' : null,
            onClick: go(i),
            text: String(i + 1),
          }),
    ),
    el('button', {
      type: 'button',
      class: 'btn btn-secondary chip pager__step',
      disabled: state.page === pages - 1,
      'aria-label': 'Next page',
      onClick: go(state.page + 1),
    }, ['Next', icon('chevron-right')]),
  );
}

function render(motion = 'none') {
  renderControls();
  renderHeads();
  const list = sorted(matching());
  renderRows(list);
  drawIcons();

  // Re-animate the rows the change produced, not the whole table.
  const gsap = window.gsap;
  if (gsap && motion !== 'none' && !document.documentElement.classList.contains('no-motion')) {
    const rows = $$('[data-row]');
    if (motion === 'swap') {
      // The whole cascade lands inside ~450ms however many rows there are.
      gsap.fromTo(rows, { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', stagger: { amount: 0.16 }, overwrite: true });
    } else {
      gsap.fromTo(rows, { opacity: 0.35 }, { opacity: 1, duration: 0.15, ease: 'power1.out', overwrite: true });
    }
  }
  window.ScrollTrigger?.refresh();
}

/* ------------------------------------------------------------- bindings -- */

function bind() {
  let debounce;
  $('[data-search]').addEventListener('input', event => {
    const value = event.target.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => update({ query: value }, { motion: 'quiet' }), 120);
  });

  $('[data-clear]').addEventListener('click', resetFilters);
  $('[data-reset]').addEventListener('click', resetFilters);
}

/* ---------------------------------------------------------- page motion -- */

function pageMotion({ gsap, ease }) {
  const heroTimeline = gsap.timeline({ paused: true, defaults: { ease } })
    .from('[data-hero-kicker]', { y: 20, opacity: 0, duration: 0.6 })
    .from('[data-line]', { yPercent: 110, duration: 1.2, stagger: 0.12 }, '-=0.3')
    .from('[data-hero-sub]', { y: 24, opacity: 0, duration: 0.8 }, '-=0.8')
    .from('[data-hero-cta] > *', { y: 20, opacity: 0, duration: 0.6, stagger: 0.08 }, '-=0.6');
  // The from-states are applied now, so the CSS hold on the header can lift.
  document.documentElement.classList.add('hero-ready');
  heroTimeline.call(settleHero); // releases queued live updates
  // Two frames, so the setup this tick has been painted before the first
  // frame of the entrance (otherwise it opens with a jump).
  requestAnimationFrame(() => requestAnimationFrame(() => heroTimeline.play()));

  gsap.from('[data-donut]', {
    rotate: -120,
    scale: 0.85,
    opacity: 0,
    transformOrigin: '50% 50%',
    duration: 1.4,
    ease: 'expo.out',
    scrollTrigger: { trigger: '[data-chart]', start: 'top 80%' },
  });

  gsap.from('[data-seg]', {
    strokeDasharray: '0 490',
    duration: 1.1,
    stagger: 0.12,
    ease: 'power3.out',
    clearProps: 'strokeDasharray',
    scrollTrigger: { trigger: '[data-chart]', start: 'top 80%' },
  });

  gsap.fromTo('[data-word]',
    { opacity: 0.2, y: 20 },
    {
      opacity: 1,
      y: 0,
      stagger: 0.15,
      ease: 'none',
      scrollTrigger: { trigger: '[data-word]', start: 'top 85%', end: 'top 45%', scrub: 0.5 },
    },
  );
}

/* ---------------------------------------------------------------- boot --- */

async function main() {
  let repoBase = '';

  // Newest first, like problems.json: public solves still on their way to
  // the repository go on top.
  const rows = data => [
    ...pendingSolves(data).map(ac => ac.entry).sort((a, b) => b.submissionId - a.submissionId),
    ...(data.problems ?? []),
  ].map((p, i) => shape(p, i, repoBase));

  // A live update re-renders the table and refreshes every ScrollTrigger —
  // a few frames' work — so hold it until the header entrance has landed.
  const data = await liveData((next, source) => heroSettled.then(() => {
    applyIdentity(next.config, next.codeforces);
    drawIcons();
    if (source !== 'codeforces') return;
    // Only reached when the solved set actually changed.
    state.problems = rows(next);
    renderArchive();
    render();
    revealBatch();
    countUp();
    $('[data-freshness]').textContent =
      `Archive live · ${new Date().toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }), { problems: true });

  const { config, codeforces, generatedAt } = data;
  const repo = config.archiveRepo;
  repoBase = `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/`;
  state.problems = rows(data);

  applyIdentity(config, codeforces);
  $('[data-year]').textContent = String(new Date().getFullYear());
  if (generatedAt) {
    $('[data-freshness]').textContent =
      `Archive synced ${new Date(generatedAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  renderArchive();
  bind();
  render();

  await waitForLibs();
  engine = startMotion({ onContext: pageMotion });
  if (!engine.lenis) settleHero(); // unanimated: no entrance to wait for
  boxHover('[data-stats]');
  introRows();
}

let engine = null;

let settleHero;
const heroSettled = new Promise(resolve => (settleHero = resolve));

/** The stuck nav's bottom edge: its sticky `top` plus its height. */
function navBottom() {
  const nav = $('[data-nav]');
  return nav ? nav.offsetHeight + (parseFloat(getComputedStyle(nav).top) || 0) : 0;
}

/** Scroll through Lenis when it owns the page, natively otherwise. */
function scrollToIndex() {
  const target = document.getElementById('index');
  if (!target) return;
  if (engine?.lenis) engine.lenis.scrollTo(target, { offset: -navBottom() });
  else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Everything derived from the full problem list, independent of filters. */
function renderArchive() {
  $('[data-total]').textContent = fmt(state.problems.length);
  renderStats();
  renderDonut();
  renderTagBars();
}

/**
 * One-off entrance for the rows already on screen when the page boots.
 *
 * `immediateRender: false` is the important part: the rows stay visible until
 * the trigger actually fires, so a ScrollTrigger that never fires can only cost
 * an animation, never the table itself. Every later render animates its own
 * rows in `render()`.
 */
function introRows() {
  const gsap = window.gsap;
  if (!gsap || document.documentElement.classList.contains('no-motion')) return;

  gsap.fromTo('[data-row]',
    { opacity: 0, x: -16 },
    {
      opacity: 1,
      x: 0,
      duration: 0.5,
      stagger: 0.03,
      ease: 'power3.out',
      immediateRender: false,
      scrollTrigger: { trigger: '#index', start: 'top 80%', once: true },
    },
  );
}

function applyIdentity(config, cf) {
  const handle = cf?.handle ?? config.handles.codeforces;
  $$('[data-cf-profile]').forEach(a => { a.href = `https://codeforces.com/profile/${handle}`; });
  $$('[data-cf-handle]').forEach(s => { s.textContent = handle; });
  $('[data-repo-slug]').textContent = `${config.archiveRepo.owner} / ${config.archiveRepo.name}`;
  $('[data-repo-link]').href = `https://github.com/${config.archiveRepo.owner}/${config.archiveRepo.name}`;
}

main().catch(err => {
  console.error('[archive]', err);
  document.documentElement.classList.add('hero-ready');
  settleHero();
});
