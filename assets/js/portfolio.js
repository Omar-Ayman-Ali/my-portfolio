/**
 * Portfolio page — renders every figure from live Codeforces + GitHub data,
 * then hands the finished DOM to the shared GSAP/Lenis motion engine.
 */

import { liveData, buildCalendar, streaks, solveTimes, daysFrom, solvedCount } from './data.js';
import {
  startMotion, waitForLibs, drawIcons, heatmapHover, countUp, revealBatch, keepCounts, boxHover, heatFocus,
} from './motion.js';

/* --------------------------------------------------------------- utils --- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
};

const icon = name => el('i', { 'data-lucide': name });
const fmt = n => Number(n).toLocaleString('en');

/** Inclusive [start, end] → every index in between; null stays null. */
const range = r => (r ? Array.from({ length: r[1] - r[0] + 1 }, (_, k) => r[0] + k) : null);

/* --------------------------------------------------- static page content -- */

const PILLARS = [
  {
    num: '01',
    icon: 'gauge',
    title: 'Algorithmic optimization',
    body: 'Reducing time and space complexity through DP state compression, greedy exchange arguments and amortized analysis.',
    tags: ['DP optimization', 'Divide & conquer', 'Branch & bound'],
  },
  {
    num: '02',
    icon: 'network',
    title: 'High-performance data structures',
    body: 'Tree structures, persistent tries and range-query engines built for sub-millisecond updates across millions of elements.',
    tags: ['Lazy segment trees', 'DSU with rollback', 'Fenwick trees'],
  },
];

const ARSENAL = [
  {
    label: 'Languages',
    icon: 'braces',
    items: [
      { name: 'C++20', note: 'Concepts, templates, STL internals, fast I/O' },
      { name: 'C', note: 'Pointers, memory layout, manual buffers' },
    ],
  },
  {
    label: 'Structures',
    icon: 'layers',
    items: [
      { name: 'Segment trees', note: 'Lazy propagation, point updates' },
      { name: 'DSU & sparse tables', note: 'Path compression, O(1) static RMQ' },
      { name: 'Treaps & HLD', note: 'Implicit keys, heavy-light decomposition' },
    ],
  },
  {
    label: 'Graphs & math',
    icon: 'sigma',
    items: [
      { name: 'Tarjan’s & 2-SAT', note: 'SCCs, implication graphs' },
      { name: 'Max-flow / min-cut', note: 'Dinic’s, bipartite matching' },
      { name: 'Number theory', note: 'Matrix exponentiation, modular inverse' },
    ],
  },
];

const MARQUEE = [
  'C++20', 'Segment trees', 'Dynamic programming', 'DSU', 'Max-flow',
  'Treaps & HLD', 'Number theory', '2-SAT', 'Codeforces',
];

/** Repository presentation, keyed by the language GitHub reports. */
const REPO_KIND = {
  'C++': { kind: 'C++ systems', icon: 'code' },
  C: { kind: 'C systems', icon: 'code' },
  JavaScript: { kind: 'Motion & web', icon: 'monitor' },
  TypeScript: { kind: 'Motion & web', icon: 'monitor' },
  HTML: { kind: 'Web interface', icon: 'layout' },
  CSS: { kind: 'Web interface', icon: 'layout' },
  Python: { kind: 'Tooling', icon: 'terminal' },
  Shell: { kind: 'Tooling', icon: 'terminal' },
};

/** Colours for the language bar, reused by index so the key always matches. */
const LANG_COLORS = [
  'var(--color-accent)',       // vivid red
  'var(--color-text)',         // near-black
  'var(--color-accent-700)',   // deep red
  'var(--color-neutral-500)',  // mid grey
  'var(--color-accent-400)',   // salmon
  'var(--color-neutral-700)',  // dark grey
];

/* ------------------------------------------------------------- renderers -- */

function renderStats(state) {
  const cf = state.codeforces;
  const stats = [
    { icon: 'cpu', value: 'C++20', label: 'Primary systems language' },
    { icon: 'check-check', value: fmt(solvedCount(state)), label: 'Problems solved on Codeforces' },
    {
      icon: 'trending-up',
      value: cf ? fmt(cf.maxRating) : '—',
      label: cf ? `Peak rating · ${cf.contests.length} rated round${cf.contests.length === 1 ? '' : 's'}` : 'Peak rating',
    },
    { icon: 'graduation-cap', value: 'ASU', label: 'AI Department, Year 2' },
  ];

  keepCounts($('[data-stats]'), root => root.replaceChildren(
    ...stats.map(s =>
      el('div', { class: 'stat', 'data-reveal': '', 'data-box': '' }, [
        icon(s.icon),
        el('p', { class: 'stat__value', 'data-count': '', text: s.value }),
        el('p', { class: 'stat__label', text: s.label }),
      ]),
    ),
  ));
}

function renderFacts(state) {
  const cf = state.codeforces;
  const facts = [
    { icon: 'map-pin', k: 'Based in', v: cf?.country ? `${cf.country} · Cairo & Banha` : 'Cairo & Banha, Egypt' },
    { icon: 'crosshair', k: 'Focus', v: 'C++ system architecture & CP' },
    { icon: 'at-sign', k: 'Handle', v: cf?.handle ?? state.config.handles.codeforces },
    { icon: 'building-2', k: 'Organization', v: cf?.organization || state.config.identity.university },
  ];

  $('[data-facts]').replaceChildren(
    ...facts.map(f =>
      el('div', { class: 'fact' }, [
        icon(f.icon),
        el('span', { class: 'k', text: f.k }),
        el('span', { class: 'v', text: f.v }),
      ]),
    ),
  );
}

function renderPillars() {
  $('[data-pillars]').replaceChildren(
    ...PILLARS.map(p =>
      el('article', { class: 'pillar', 'data-reveal': '' }, [
        el('div', { class: 'pillar__top' }, [
          el('span', { class: 'pillar__icon' }, [icon(p.icon)]),
          el('span', { class: 'pillar__num', text: p.num }),
        ]),
        el('h3', { text: p.title }),
        el('p', { text: p.body }),
        el('div', { class: 'tags' }, p.tags.map(t => el('span', { class: 'tag tag-outline', text: t }))),
      ]),
    ),
  );
}

function renderArsenal() {
  $('[data-arsenal]').replaceChildren(
    ...ARSENAL.map(g =>
      el('div', { class: 'arsenal', 'data-reveal': '' }, [
        el('div', { class: 'arsenal__head' }, [icon(g.icon), g.label]),
        el('div', { class: 'arsenal__list' },
          g.items.map(it =>
            el('div', { class: 'arsenal__item' }, [
              el('div', { class: 'n', text: it.name }),
              el('div', { class: 'note', text: it.note }),
            ]),
          ),
        ),
      ]),
    ),
  );
}

function renderCodeforces(state) {
  const cf = state.codeforces;
  const handle = cf?.handle ?? state.config.handles.codeforces;
  const profile = `https://codeforces.com/profile/${handle}`;

  $$('[data-cf-profile]').forEach(a => { a.href = profile; });
  $$('[data-cf-handle]').forEach(s => { s.textContent = handle; });
  $('[data-cf-solved-cta]').textContent = `Codeforces — ${fmt(solvedCount(state))} solved`;

  renderSolvedCalendar(state);
  if (!cf) return;

  const target = state.config.targets;
  $('[data-cf-target]').textContent = `Target: ${target.nextRank} ${target.nextRating}`;

  const best = cf.contests.length ? Math.min(...cf.contests.map(c => c.rank)) : 0;
  const stats = [
    { value: fmt(cf.rating), label: `Current rating · ${cf.rank}` },
    { value: fmt(cf.maxRating), label: `Peak rating · ${cf.maxRank}` },
    { value: fmt(cf.contests.length), label: 'Rated rounds' },
    { value: fmt(target.nextRating), label: `Next target · ${target.nextRank}` },
  ];
  if (best) stats[2] = { value: fmt(best), label: 'Best contest rank' };

  keepCounts($('[data-cf-stats]'), root => root.replaceChildren(
    ...stats.map(s =>
      el('div', { class: 'kv', 'data-reveal': '', 'data-box': '' }, [
        el('div', { class: 'kv__value', 'data-count': '', text: s.value }),
        el('div', { class: 'kv__label', text: s.label }),
      ]),
    ),
  ));

  // Rating trajectory — one bar per rated round, scaled against the next target.
  const ceiling = Math.max(target.nextRating, cf.maxRating * 1.1);
  const bars = $('[data-cf-bars]');
  const labels = $('[data-cf-bar-labels]');
  const columns = `repeat(${Math.max(1, cf.contests.length)}, 1fr)`;
  bars.style.gridTemplateColumns = columns;
  labels.style.gridTemplateColumns = columns;

  bars.replaceChildren(
    ...cf.contests.map((c, i) =>
      el('div', { class: 'bar' }, [
        el('div', { class: 'bar__value', text: fmt(c.newRating) }),
        el('div', {
          class: 'bar__fill',
          'data-grow': '',
          style: `height: calc(${(c.newRating / ceiling) * 100}% - 28px); ` +
                 `background: ${i === cf.contests.length - 1 ? 'var(--color-accent)' : 'var(--color-text)'}`,
          title: `${c.name} — rank ${fmt(c.rank)}, ${c.oldRating} → ${c.newRating}`,
        }),
      ]),
    ),
  );

  labels.replaceChildren(
    ...cf.contests.map(c =>
      el('span', {
        // "Codeforces Round 1114 (Div. 3)" → "Round 1114"
        text: (c.name.match(/Round\s+#?\d+/i) || [c.name])[0].replace('#', ''),
        title: c.name,
      }),
    ),
  );
}

/**
 * Problems solved, last 12 months — every archive problem at its solve time
 * (exact for public submissions, estimated from the submission ID for private
 * groups), plus public accepted problems the archive has not picked up yet.
 */
function renderSolvedCalendar(state) {
  const cf = state.codeforces;
  const box = $$('[data-heat-box]')[0];
  const calendar = buildCalendar(daysFrom(solveTimes(state)), { unit: 'problems' });
  // Streaks follow Codeforces' own profile: a day counts if anything was
  // submitted, accepted or not. cf.anchors holds every submission time
  // (private groups included when the build has a key).
  const activity = buildCalendar(daysFrom((cf?.anchors ?? []).map(([, at]) => at)), { unit: 'submissions' });
  const run = streaks(activity.cells);
  const last = calendar.cells.length - 1;
  const lastMonth = calendar.cells.slice(-30).reduce((a, c) => a + c.count, 0);
  const publicSolves = (cf?.accepted ?? []).filter(a => a.public !== false);
  const publicDays = new Set(Object.keys(daysFrom(publicSolves.map(a => a.at))));

  paintCalendar(box, calendar);
  paintHeatStats(box, calendar, [
    { value: fmt(solvedCount(state)), label: 'Problems solved', focus: 'active' },
    {
      value: fmt(cf?.acceptedCount ?? 0),
      label: 'Accepted on public Codeforces',
      focus: calendar.cells.flatMap((c, i) => (publicDays.has(c.date) ? [i] : [])),
    },
    { value: fmt(calendar.total), label: 'Solved, last 12 months', focus: 'active' },
    { value: fmt(lastMonth), label: 'Solved, last 30 days', focus: range([last - 29, last]) },
    {
      value: `${fmt(run.best)} days`,
      label: 'Longest streak',
      focus: range(run.bestRange),
      readout: (idx, when) => `Longest streak · ${when} · a submission every day`,
    },
    {
      value: `${fmt(run.current)} days`,
      label: 'Current streak',
      focus: range(run.currentRange),
      readout: (idx, when) => `Current streak · ${when} · a submission every day`,
    },
  ]);
}

function renderGitHub(state) {
  const gh = state.github;
  const login = gh?.login ?? state.config.handles.github;

  $$('[data-gh-profile]').forEach(a => { a.href = `https://github.com/${login}`; });
  $$('[data-gh-handle]').forEach(s => { s.textContent = `@${login}`; });

  if (!gh) return;

  $('[data-gh-repo-count]').textContent =
    `${fmt(gh.publicRepos)} public repositor${gh.publicRepos === 1 ? 'y' : 'ies'}`;

  // Language bar — top five by bytes, remainder folded into "Other".
  const top = gh.languages.slice(0, 5);
  const rest = gh.languages.slice(5).reduce((a, l) => a + l.share, 0);
  const slices = rest > 0.001 ? [...top, { name: 'Other', share: rest }] : top;

  $('[data-langs-bar]').replaceChildren(
    ...slices.map((l, i) =>
      el('span', {
        'data-grow-x': '',
        style: `width: ${(l.share * 100).toFixed(2)}%; background: ${LANG_COLORS[i % LANG_COLORS.length]}`,
        title: `${l.name} — ${(l.share * 100).toFixed(1)}%`,
      }),
    ),
  );

  $('[data-langs-key]').replaceChildren(
    ...slices.map((l, i) =>
      el('span', {}, [
        el('i', { style: `background: ${LANG_COLORS[i % LANG_COLORS.length]}` }),
        el('strong', { text: l.name }),
        ` ${(l.share * 100).toFixed(1)}%`,
      ]),
    ),
  );

  const box = $$('[data-heat-box]')[1];
  const calendar = buildCalendar(gh.contributions.days, { unit: 'contributions' });
  const run = streaks(calendar.cells);

  const created = new Set(Object.keys(daysFrom(gh.repos.map(r => Date.parse(r.createdAt) / 1000))));

  paintCalendar(box, calendar);
  paintHeatStats(box, calendar, [
    { value: fmt(gh.contributions.total || calendar.total), label: 'Contributions, past year', focus: 'active' },
    {
      value: fmt(gh.publicRepos),
      label: 'Public repositories',
      focus: calendar.cells.flatMap((c, i) => (created.has(c.date) ? [i] : [])),
      readout: idx => `${idx.length} repositor${idx.length === 1 ? 'y' : 'ies'} created in the last 12 months`,
    },
    { value: fmt(gh.repos.reduce((a, r) => a + r.stars, 0)), label: 'Stars earned' },
    { value: fmt(gh.languages.length), label: 'Languages used' },
    { value: `${fmt(run.best)} days`, label: 'Longest streak', focus: range(run.bestRange) },
    { value: `${fmt(run.current)} days`, label: 'Current streak', focus: range(run.currentRange) },
  ]);

  renderProjects(state, gh);
}

function renderProjects(state, gh) {
  // Only the repositories named in site.config.json, in that order. Live data
  // still fills in their descriptions, pushes and stars.
  const featured = (state.config.featuredRepos ?? []).map(name => name.toLowerCase());
  const byName = new Map(gh.repos.map(r => [r.name.toLowerCase(), r]));
  const repos = featured.map(name => byName.get(name)).filter(Boolean);

  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  $('[data-projects-title]').textContent =
    `${words[repos.length] ?? fmt(repos.length)} repositories.`;

  $('[data-projects]').replaceChildren(
    ...repos.map((r, i) => {
      const preset = REPO_KIND[r.language] ?? { kind: 'Repository', icon: 'folder-git-2' };
      const pushed = new Date(r.pushedAt);
      const tags = (r.topics?.length ? r.topics : [r.language].filter(Boolean)).slice(0, 4);

      return el('article', { class: 'project', 'data-reveal': '' }, [
        el('div', { class: 'project__head' }, [
          el('span', { class: 'project__kind', text: `${String(i + 1).padStart(2, '0')} · ${preset.kind}` }),
          icon(preset.icon),
        ]),
        el('div', { class: 'project__body' }, [
          el('h3', { text: r.name }),
          el('p', { text: r.description || 'No description on GitHub yet.' }),
          el('div', { class: 'tags' }, tags.map(t => el('span', { class: 'tag tag-neutral', text: t }))),
        ]),
        el('div', { class: 'project__meta' }, [
          el('div', {}, [
            el('div', { class: 'k', text: 'Language' }),
            el('div', { class: 'v', text: r.language || '—' }),
          ]),
          el('div', {}, [
            el('div', { class: 'k', text: 'Last push' }),
            el('div', {
              class: 'v',
              text: pushed.toLocaleDateString('en', { month: 'short', year: 'numeric' }),
              title: pushed.toLocaleString('en'),
            }),
          ]),
          el('div', {}, [
            el('div', { class: 'k', text: 'Stars' }),
            el('div', { class: 'v', text: fmt(r.stars) }),
          ]),
          el('div', {}, [
            el('div', { class: 'k', text: 'License' }),
            el('div', { class: 'v', text: r.license || '—' }),
          ]),
        ]),
        el('a', {
          class: 'project__link',
          href: r.url,
          target: '_blank',
          rel: 'noopener',
        }, ['View repository', icon('arrow-up-right')]),
      ]);
    }),
  );
}

function renderContacts(state) {
  const { identity, handles } = state.config;
  const contacts = [
    { icon: 'mail', label: 'Email', value: identity.email, url: `mailto:${identity.email}` },
    { icon: 'git-branch', label: 'GitHub', value: handles.github, url: `https://github.com/${handles.github}` },
    { icon: 'trophy', label: 'Codeforces', value: handles.codeforces, url: `https://codeforces.com/profile/${handles.codeforces}` },
    { icon: 'briefcase', label: 'LinkedIn', value: identity.linkedin.replace(/.*\/in\/|\/$/g, ''), url: identity.linkedin },
  ];

  $('[data-contacts]').replaceChildren(
    ...contacts.map(c =>
      el('a', {
        class: 'contact-item',
        href: c.url,
        'data-reveal': '',
        ...(c.url.startsWith('mailto:') ? {} : { target: '_blank', rel: 'noopener' }),
      }, [
        el('span', { class: 'contact-item__icon' }, [icon(c.icon)]),
        el('span', { class: 'contact-item__text' }, [
          el('span', { class: 'contact-item__label', text: c.label }),
          el('span', { class: 'contact-item__value', text: c.value }),
        ]),
      ]),
    ),
  );
}

function renderMarquee() {
  const track = $('[data-marquee]');
  // Two identical halves so the -50% loop is seamless.
  const half = MARQUEE.map(m => el('span', { class: 'marquee__item', text: m }));
  track.replaceChildren(...half, ...half.map(n => n.cloneNode(true)));
}

/* ------------------------------------------------------------ calendars -- */

function paintCalendar(box, calendar) {
  const months = box.querySelector('[data-heat-months]');
  const grid = box.querySelector('[data-heat]');

  months.replaceChildren(
    ...calendar.months.map(m => el('span', { style: `grid-column: ${m.col} / span 3`, text: m.name })),
  );

  // A live refresh usually covers the same 371 days: recolour the existing
  // cells rather than replace them, so their entrance animation and hover
  // bindings survive the update.
  if (grid.children.length === calendar.cells.length) {
    calendar.cells.forEach((c, i) => {
      const cell = grid.children[i];
      cell.style.background = `var(--h${c.level})`;
      cell.dataset.label = c.label;
      cell.title = c.label;
    });
    return;
  }

  grid.replaceChildren(
    ...calendar.cells.map((c, i) =>
      el('span', {
        // --i staggers the CSS entrance (see .heat-grid in site.css).
        style: `background: var(--h${c.level}); --i: ${i}`,
        'data-label': c.label,
        title: c.label,
      }),
    ),
  );
}

/**
 * The stat row under a heatmap. A stat can carry a `focus` — 'active' (every
 * day with activity) or a list of cell indexes — which hovering it lights up
 * on the calendar (see heatFocus in motion.js), and a `readout(cells, span)`
 * for the line shown meanwhile.
 */
function paintHeatStats(box, calendar, stats) {
  const cells = calendar.cells;
  const toIndexes = focus =>
    focus === 'active' ? cells.flatMap((c, i) => (c.count ? [i] : [])) : focus;
  const span = idx => {
    if (!idx?.length) return 'none in the last 12 months';
    const day = i => new Date(`${cells[i].date}T00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' });
    return idx.length === 1 ? day(idx[0]) : `${day(idx[0])} – ${day(idx[idx.length - 1])}`;
  };

  keepCounts(box.querySelector('[data-heat-stats]'), root => root.replaceChildren(
    ...stats.map(s => {
      const idx = toIndexes(s.focus);
      const node = el('div', { 'data-box': '' }, [
        el('div', { class: 'v', 'data-count': '', text: s.value }),
        el('div', { class: 'k', text: s.label }),
      ]);
      if (idx) {
        node.heatFocus = {
          cells: idx,
          readout: s.readout?.(idx, span(idx)) ??
            (s.focus === 'active'
              ? `${idx.length} active day${idx.length === 1 ? '' : 's'}`
              : `${s.label} · ${span(idx)}`),
        };
      }
      return node;
    }),
  ));
}

/* -------------------------------------------------------------- freshness -- */

function renderFreshness(state) {
  const stamp = state.refreshedAt ?? state.generatedAt;
  if (!stamp) return;
  const when = new Date(stamp);
  $('[data-freshness]').textContent =
    `Data ${state.refreshedAt ? 'live' : 'synced'} · ${when.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  $('[data-year]').textContent = String(new Date().getFullYear());
}

/* ------------------------------------------------------------ page motion -- */

/**
 * The compile-sequence preloader. Resolves once the page is revealed.
 *
 * Kept cheap per frame so it holds 60fps: only transforms and opacity are
 * tweened (the exit slides the panel away instead of animating a full-screen
 * clip-path, which repaints every pixel each frame), text nodes are only
 * written when their value actually changes, and the timeline is started a
 * frame after the heavy page setup so its first frames are not a jump.
 */
function playIntro(gsap, lenis, ease) {
  const intro = $('[data-intro]');
  if (!intro) return Promise.resolve();
  // Already seen this session (flag read in <head>): straight to the hero.
  if (document.documentElement.classList.contains('intro-played')) {
    intro.remove();
    return Promise.resolve();
  }

  lenis?.stop();
  const count = intro.querySelector('[data-intro-count]');
  const log = intro.querySelector('[data-intro-log]');
  const steps = ['Linking modules', 'Building segment trees', 'Optimizing O(log N)', 'Ready'];
  const progress = { p: 0 };
  let shownCount = -1;
  let shownStep = -1;

  const LOAD = 2.4; // counter + rail duration, seconds
  const EXIT = 1;

  const tl = gsap.timeline({ paused: true, defaults: { ease } })
    .from('[data-intro-kicker]', { y: 16, opacity: 0, duration: 0.7 })
    .from('[data-intro-word]', { yPercent: 110, duration: 1.3, stagger: 0.14 }, 0.1)
    .to(progress, {
      p: 100,
      duration: LOAD,
      ease: 'power2.inOut',
      onUpdate: () => {
        const n = Math.round(progress.p);
        if (n !== shownCount) {
          shownCount = n;
          count.textContent = String(n).padStart(3, '0');
        }
        const step = Math.min(3, Math.floor(progress.p / 34));
        if (step !== shownStep) {
          shownStep = step;
          log.textContent = steps[step];
        }
      },
    }, 0.2)
    .to('[data-intro-bar]', { scaleX: 1, duration: LOAD, ease: 'power2.inOut' }, 0.2)
    .to('[data-intro-word]', { yPercent: -110, duration: 0.7, stagger: 0.06, ease: 'power3.in' }, '+=0.15')
    .to(intro, { yPercent: -100, duration: EXIT, ease: 'expo.inOut' }, '-=0.2')
    .add(() => {
      intro.remove();
      lenis?.start();
      window.ScrollTrigger?.refresh();
    });

  // Hand the hero its cue as the panel starts to leave.
  const exitAt = tl.duration() - EXIT;

  return new Promise(resolve => {
    tl.call(resolve, null, exitAt);
    // Wait for webfonts (so the name never reflows mid-animation) and for two
    // frames, so the page setup that ran this tick has been painted.
    const fonts = Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 1200))]);
    fonts.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      // Marked on start, so refreshing mid-intro skips it too.
      try { sessionStorage.setItem('intro-played', '1'); } catch {}
      tl.play();
    })));
  });
}

function pageMotion({ gsap, ScrollTrigger, lenis, ease }) {
  const heroTimeline = gsap.timeline({ paused: true, defaults: { ease } })
    .from('[data-hero-kicker]', { y: 20, opacity: 0, duration: 0.6 })
    .from('[data-line]', { yPercent: 110, duration: 1.2, stagger: 0.12 }, '-=0.3')
    .from('[data-hero-sub]', { y: 24, opacity: 0, duration: 0.8 }, '-=0.8')
    .from('[data-hero-cta] > *', { y: 20, opacity: 0, duration: 0.6, stagger: 0.08 }, '-=0.6')
    .from('[data-hero-fig]', { clipPath: 'inset(0 100% 0 0)', duration: 1.3, ease: 'expo.inOut' }, 0.5)
    .from('[data-hero-fig] pre', { opacity: 0, y: 10, duration: 0.6 }, '-=0.3');
  // The from-states are applied now, so the CSS hold on the hero can lift.
  document.documentElement.classList.add('hero-ready');

  gsap.to('[data-hero-fig]', {
    yPercent: -10,
    ease: 'none',
    scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  gsap.to('[data-cursor]', { opacity: 0, repeat: -1, yoyo: true, duration: 0.5, ease: 'steps(1)' });

  // Marquee, sped up by scroll velocity and eased back to rest.
  const marquee = gsap.to('[data-marquee]', { xPercent: -50, repeat: -1, duration: 40, ease: 'none' });
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate: self => {
      const boost = 1 + Math.min(5, Math.abs(self.getVelocity()) / 500);
      gsap.to(marquee, {
        timeScale: boost,
        duration: 0.2,
        overwrite: true,
        onComplete: () => gsap.to(marquee, { timeScale: 1, duration: 1.2 }),
      });
    },
  });

  gsap.from('[data-grow]', {
    scaleY: 0,
    duration: 1.4,
    stagger: 0.18,
    ease: 'expo.out',
    scrollTrigger: { trigger: '[data-chart]', start: 'top 80%' },
  });

  // The calendars' ~740 cells pop in as a CSS animation: a GSAP tween per
  // cell cost ~400ms of main thread at load, which stalled the hero entrance.
  // The animation is dropped once it ends, so the hover tweens' inline
  // transforms are not overridden by its fill.
  gsap.utils.toArray('[data-heat]').forEach(grid =>
    ScrollTrigger.create({
      trigger: grid,
      start: 'top 85%',
      once: true,
      onEnter: () => {
        grid.dataset.shown = 'in';
        setTimeout(() => (grid.dataset.shown = 'done'), 2000);
      },
    }),
  );

  manifesto(gsap, ScrollTrigger, ease);

  // Triggers were created in several passes (shared reveals first, page
  // effects after); put them back in page order so the manifesto pin's
  // spacing is accounted for by everything below it.
  ScrollTrigger.sort();
  ScrollTrigger.refresh();

  // Last, so none of the setup above lands inside the intro's frames.
  // With the intro skipped, still wait two frames so the setup above is
  // painted before the hero's first frame.
  heroTimeline.call(settleHero); // releases queued live updates
  playIntro(gsap, lenis, ease).then(() =>
    requestAnimationFrame(() => requestAnimationFrame(() => heroTimeline.play())),
  );
}

/**
 * "Code is temporary. Time complexity is eternal."
 *
 * Two phases, because they answer to different things:
 *   1. Entrance — plays on a clock as the section arrives, so the words are
 *      already legible by the time it is on screen. Characters rise out of
 *      per-word masks.
 *   2. The argument — the section pins and scroll drives it: "temporary."
 *      comes apart and falls away, then a rule draws under "eternal.".
 *      Scrubbed, so scrolling back up reassembles it.
 */
function manifesto(gsap, ScrollTrigger, ease) {
  const heading = $('[data-manifesto]');
  const SplitText = window.SplitText;
  if (!heading) return;
  if (!SplitText) {
    // Plugin blocked: the text is already in place, just show the rule.
    gsap.set('[data-eternal]', { '--rule': 1 });
    return;
  }
  gsap.registerPlugin(SplitText);

  // Words and chars only — no line split, so nothing depends on font metrics
  // and a late webfont swap cannot leave stale lines behind.
  const split = SplitText.create(heading, {
    type: 'words,chars',
    mask: 'words',
    wordsClass: 'm-word',
    charsClass: 'm-char',
  });

  const [first, second] = $$('.poster__line', heading);
  const decay = $('[data-decay]', heading);
  const decayChars = $$('.m-char', decay);
  const decayMasks = split.masks.filter(m => decay.contains(m));

  gsap.timeline({
    defaults: { ease },
    scrollTrigger: { trigger: '#manifesto', start: 'top 72%', toggleActions: 'play none none reverse' },
  })
    .from('[data-manifesto-label]', { opacity: 0, y: 12, duration: 0.5 })
    .from($$('.m-char', first), { yPercent: 115, duration: 0.9, stagger: 0.022 }, 0.05)
    .from($$('.m-char', second), { yPercent: 115, duration: 0.9, stagger: 0.022 }, 0.3);

  const scatter = gsap.utils.random(-1, 1, true);

  gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '#manifesto',
      start: 'center center',
      end: '+=85%',
      pin: true,
      scrub: 0.6,
    },
  })
    // Let the falling letters leave their word masks instead of being clipped.
    .set(decayMasks, { overflow: 'visible' }, 0)
    .to(decayChars, {
      y: () => `${0.5 + Math.random() * 0.9}em`,
      x: () => `${scatter() * 0.15}em`,
      rotation: () => scatter() * 28,
      opacity: 0.1,
      filter: 'blur(3px)',
      duration: 1,
      ease: 'power2.in',
      stagger: { each: 0.06, from: 'random' },
    }, 0.1)
    .to('[data-eternal]', { '--rule': 1, duration: 0.7, ease: 'power3.out' }, 0.75)
    // A short hold so the finished line sits still before the pin releases.
    .to({}, { duration: 0.3 });
}

/* ---------------------------------------------------------------- boot ---- */

/** Repaint what a source feeds; with no source, everything (first paint). */
function paint(state, source) {
  if (!source || source === 'codeforces') {
    renderStats(state);
    renderFacts(state);
    renderCodeforces(state);
  }
  if (!source || source === 'github') renderGitHub(state);
  renderFreshness(state);
  drawIcons();
}

async function main() {
  renderPillars();
  renderArsenal();
  renderMarquee();

  // Something shown on the page changed (polls that bring back the same
  // numbers never get here). Repainting replaces nodes the motion layer had
  // already bound, so re-arm the reveals and counters for the new ones —
  // both calls skip anything they have handled before. The repaint and
  // refresh cost a few frames, so they wait out the intro and hero entrance.
  const state = await liveData((next, source) => heroSettled.then(() => {
    paint(next, source);
    $$('[data-heat-box]').forEach(heatmapHover);
    revealBatch();
    countUp();
    window.ScrollTrigger?.refresh();
  }));

  renderContacts(state);
  paint(state);

  await waitForLibs();
  if (!startMotion({ onContext: pageMotion }).lenis) settleHero(); // nothing to wait for
  $$('[data-heat-box]').forEach(heatmapHover);
  $$('[data-heat-box]').forEach(heatFocus);
  boxHover('[data-stats], [data-cf-stats], [data-heat-stats]');
}

let settleHero;
const heroSettled = new Promise(resolve => (settleHero = resolve));

main().catch(err => {
  console.error('[portfolio]', err);
  document.querySelector('[data-intro]')?.remove();
  document.documentElement.classList.add('hero-ready');
  settleHero();
});
