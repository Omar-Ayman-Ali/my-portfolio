/**
 * Runtime data layer.
 *
 * Every page paints immediately from data/snapshot.json (written by
 * `npm run fetch`), then revalidates in the background against the live
 * Codeforces and GitHub APIs. Both of those send `Access-Control-Allow-Origin: *`
 * and need no credentials, so the refresh works from a static host with no
 * server and no key in the bundle.
 *
 * Anything that *does* need a secret — the GitHub contributions calendar via
 * GraphQL — is resolved at build time by scripts/fetch-data.mjs and only ever
 * reaches the browser as data. No token is ever shipped to the client.
 */

import { mergeAnchors, estimateTime, problemKey, firstAccepted, unsynced } from './solve-dates.js';

const CF_API = 'https://codeforces.com/api';
const GH_API = 'https://api.github.com';

let configPromise;
let snapshotPromise;

export function loadConfig() {
  configPromise ??= fetch('site.config.json').then(r => r.json());
  return configPromise;
}

export function loadSnapshot() {
  snapshotPromise ??= fetch('data/snapshot.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(err => {
      console.warn('[data] snapshot unavailable:', err.message);
      return { generatedAt: null, codeforces: null, github: null, archive: { total: 0 } };
    });
  return snapshotPromise;
}

export function loadProblems() {
  return fetch('data/problems.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(err => {
      console.warn('[data] problems.json unavailable:', err.message);
      return [];
    });
}

/**
 * The solutions repository keeps its own problems.json, written by its
 * cf_sync.py on every sync. raw.githubusercontent.com serves it with
 * `Access-Control-Allow-Origin: *` and it does not count against the API
 * rate limit, so the archive can revalidate against it on every visit.
 * Resolves to null when the repo copy is unreachable or malformed.
 */
export async function refreshProblems({ owner, name, branch }) {
  try {
    const list = await json(`https://raw.githubusercontent.com/${owner}/${name}/${branch}/problems.json`);
    return Array.isArray(list) && list.length ? list : null;
  } catch (err) {
    console.warn('[data] problems.json refresh skipped:', err.message);
    return null;
  }
}

/* ------------------------------------------------------- live refresh ---- */

async function json(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Codeforces allows one call per two seconds per IP. Calls here run one after
 * another, and a "Call limit exceeded" reply waits out the window once.
 */
async function cf(method, params, retry = true) {
  const res = await fetch(`${CF_API}/${method}?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({ status: `HTTP ${res.status}` }));
  if (body.status === 'OK') return body.result;
  if (retry && /limit/i.test(body.comment ?? '')) {
    await new Promise(r => setTimeout(r, 2100));
    return cf(method, params, false);
  }
  throw new Error(body.comment || body.status);
}

/** Re-fetch the keyless Codeforces endpoints and rebuild the same shape the snapshot uses. */
export async function refreshCodeforces(handle) {
  const [info] = await cf('user.info', { handles: handle });
  const contests = await cf('user.rating', { handle });

  let submissions = [];
  try {
    submissions = await cf('user.status', { handle, from: 1, count: 100000 });
  } catch (err) {
    console.warn('[data] user.status:', err.message);
  }

  // The newest submission on the whole site: a "right now" anchor, so a
  // private solve made since the last build is interpolated, not guessed.
  let now = null;
  try {
    const [latest] = await cf('problemset.recentStatus', { count: 1 });
    if (latest) now = [latest.id, latest.creationTimeSeconds];
  } catch (err) {
    console.warn('[data] recentStatus:', err.message);
  }

  const accepted = firstAccepted(submissions);

  return {
    handle: info.handle,
    rating: info.rating ?? 0,
    maxRating: info.maxRating ?? 0,
    rank: info.rank ?? 'unrated',
    maxRank: info.maxRank ?? 'unrated',
    organization: info.organization ?? '',
    country: info.country ?? '',
    avatar: info.titlePhoto || info.avatar || '',
    registeredAt: info.registrationTimeSeconds ?? null,
    lastOnlineAt: info.lastOnlineTimeSeconds ?? null,
    contests: contests.map(r => ({
      contestId: r.contestId,
      name: r.contestName,
      rank: r.rank,
      oldRating: r.oldRating,
      newRating: r.newRating,
      at: r.ratingUpdateTimeSeconds,
    })),
    submissionCount: submissions.length,
    acceptedCount: accepted.length,
    accepted,
    anchors: submissions.map(s => [s.id, s.creationTimeSeconds]),
    now,
  };
}

/**
 * The contributions calendar via a keyless public mirror of GitHub's own
 * (CORS-open, cached upstream for about an hour). Same shape the build writes.
 */
export async function refreshContributions(login) {
  const body = await json(`https://github-contributions-api.jogruber.de/v4/${login}?y=last`);
  const days = {};
  for (const d of body.contributions ?? []) if (d.count) days[d.date] = d.count;
  return { total: body.total?.lastYear ?? 0, days, source: 'public-mirror' };
}

/**
 * Rebuild the archive's solve list from a fresh problems.json: known solves
 * keep their time, public ones use the real submission time, and anything
 * new is dated from its submission ID (see solve-dates.js).
 */
export function dateArchive(problems, archive = {}, codeforces = null) {
  const exact = new Map(codeforces?.anchors ?? []);
  const known = new Map((archive.solved ?? []).map(([id, at]) => [id, at]));
  const anchors = mergeAnchors(archive.anchors, codeforces?.anchors, codeforces?.now ? [codeforces.now] : []);

  const solved = [];
  for (const p of problems) {
    const id = p.submissionId;
    const at = exact.get(id) ?? known.get(id) ?? (id ? estimateTime(anchors, id) : null);
    if (at != null) solved.push([id, at, problemKey(p)]);
  }
  return { ...archive, total: problems.length, solved };
}

/** Problem keys the solutions repository already holds. */
const archiveKeys = state =>
  new Set(state.problems ? state.problems.map(problemKey) : (state.archive?.solved ?? []).map(([, , key]) => key));

/** Public solves the repository has not synced yet (they sync daily). */
export const pendingSolves = state => unsynced(state.codeforces?.accepted, archiveKeys(state));

/** Everything solved: the archive plus public solves still on their way to it. */
export const solvedCount = state => (state.archive?.total ?? 0) + pendingSolves(state).length;

/**
 * Every solve we can date, as epoch seconds: the whole archive, plus any
 * public accepted problem the archive does not hold yet.
 */
export function solveTimes(state) {
  const exact = new Map(state.codeforces?.anchors ?? []);
  const times = (state.archive?.solved ?? []).map(([id, at]) => exact.get(id) ?? at);
  for (const ac of pendingSolves(state)) times.push(ac.at);
  return times;
}

/** Epoch seconds → { 'YYYY-MM-DD' (viewer's local date): count }. */
export function daysFrom(times) {
  const days = {};
  for (const at of times) {
    const d = new Date(at * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days[key] = (days[key] || 0) + 1;
  }
  return days;
}

/**
 * Re-fetch the public GitHub profile and repositories. Unauthenticated calls
 * are capped at 60/hr per IP, so this is best-effort: on a 403 we simply keep
 * the build-time snapshot. Per-repo language byte counts are deliberately not
 * refetched here — that is N extra requests against a small budget, and the
 * snapshot already carries them.
 */
export async function refreshGitHub(login, snapshot) {
  const [user, repos] = await Promise.all([
    json(`${GH_API}/users/${login}`),
    json(`${GH_API}/users/${login}/repos?per_page=100&sort=updated&type=owner`),
  ]);

  return {
    ...snapshot,
    login: user.login,
    name: user.name ?? user.login,
    bio: user.bio ?? '',
    avatar: user.avatar_url,
    publicRepos: user.public_repos,
    followers: user.followers,
    createdAt: user.created_at,
    repos: repos.filter(r => !r.fork).map(r => ({
      name: r.name,
      description: r.description ?? '',
      url: r.html_url,
      homepage: r.homepage ?? '',
      language: r.language ?? '',
      stars: r.stargazers_count,
      forks: r.forks_count,
      size: r.size,
      topics: r.topics ?? [],
      license: r.license?.spdx_id ?? '',
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
    })),
  };
}

/**
 * Paint from the snapshot, then keep the page current for as long as it is
 * open: Codeforces and the archive every minute, GitHub every ten (its
 * anonymous API allows 60 calls an hour per visitor). Polling pauses while
 * the tab is hidden and catches up the moment it is shown again.
 *
 * `onUpdate(state, source)` fires only when something the page shows has
 * actually changed — never on a poll that brought back the same numbers.
 * With `{ problems: true }` the full problems.json list is kept on
 * `state.problems` too (the archive page renders every row).
 */
export async function liveData(onUpdate, { problems: withProblems = false } = {}) {
  const [config, snapshot, problems] = await Promise.all([
    loadConfig(),
    loadSnapshot(),
    withProblems ? loadProblems() : null,
  ]);
  const state = { config, ...snapshot };
  if (withProblems) state.problems = problems;

  // What each source contributes to the page, minus fields that change on
  // their own (last-online time, the "right now" anchor).
  const shown = {
    codeforces: () => JSON.stringify([
      state.archive?.total,
      state.archive?.solved?.map(([id, at]) => id + at),
      state.problems?.length,
      state.codeforces && [
        state.codeforces.rating, state.codeforces.maxRating, state.codeforces.contests,
        state.codeforces.accepted?.map(a => a.key), state.codeforces.organization,
      ],
    ]),
    github: () => JSON.stringify(state.github && [
      state.github.publicRepos,
      state.github.repos?.map(r => [r.name, r.pushedAt, r.stars, r.description]),
      state.github.contributions,
    ]),
  };
  const last = { codeforces: shown.codeforces(), github: shown.github() };

  const report = source => {
    const now = shown[source]();
    if (now === last[source]) return;
    last[source] = now;
    state.refreshedAt = new Date().toISOString();
    onUpdate?.(state, source);
  };

  // Codeforces and the archive feed the same heatmap and counts: fetch both,
  // then report once, so the numbers never flash an in-between state.
  const refreshSolved = async () => {
    const [cfResult, list] = await Promise.allSettled([
      refreshCodeforces(config.handles.codeforces),
      refreshProblems(config.archiveRepo),
    ]);
    if (cfResult.status === 'fulfilled') state.codeforces = withPrivate(cfResult.value, snapshot.codeforces);
    else console.warn('[data] Codeforces refresh skipped:', cfResult.reason?.message);
    if (list.status === 'fulfilled' && list.value) {
      if (withProblems) state.problems = list.value;
      state.archive = dateArchive(list.value, state.archive, state.codeforces);
    }
    report('codeforces');
  };

  const refreshCode = async () => {
    const [gh, contributions] = await Promise.allSettled([
      refreshGitHub(config.handles.github, state.github ?? {}),
      refreshContributions(config.handles.github),
    ]);
    if (gh.status === 'fulfilled') state.github = gh.value;
    else console.warn('[data] GitHub refresh skipped:', gh.reason?.message);
    if (contributions.status === 'fulfilled' && state.github) {
      state.github = { ...state.github, contributions: contributions.value };
    }
    report('github');
  };

  const start = () => {
    poll(refreshSolved, 60 * 1000);
    poll(refreshCode, 10 * 60 * 1000);
  };

  // Let the first frame land before spending network on revalidation.
  if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 1200);

  return state;
}

/**
 * The browser can only make anonymous Codeforces calls, which never include
 * private-group submissions. The build signs its calls (when a key is set)
 * and records those in the snapshot, marked `public: false` — carry them
 * over so a live refresh adds to what the build saw instead of dropping it.
 */
function withPrivate(live, built) {
  const privateSolves = (built?.accepted ?? []).filter(a => a.public === false);
  if (!privateSolves.length) return live;
  const seen = new Set(live.accepted.map(a => a.key));
  return {
    ...live,
    accepted: [...live.accepted, ...privateSolves.filter(a => !seen.has(a.key))],
    anchors: mergeAnchors(live.anchors, built.anchors),
  };
}

/**
 * Run `task` now and then every `interval` ms while the tab is visible; when
 * a hidden tab comes back after more than `interval`, run it straight away.
 * Never overlaps itself.
 */
function poll(task, interval) {
  let lastRun = 0;
  let running = false;

  const run = async () => {
    if (running || document.hidden) return;
    running = true;
    lastRun = Date.now();
    try {
      await task();
    } catch (err) {
      console.warn('[data] refresh failed:', err.message);
    } finally {
      running = false;
    }
  };

  run();
  setInterval(run, interval);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastRun >= interval) run();
  });
}

/* ----------------------------------------------------------- calendars --- */

// toLocale*String builds a fresh Intl formatter on every call; over 371 cells
// and several calendars per paint that was most of buildCalendar's time.
const MONTH = new Intl.DateTimeFormat('en', { month: 'short' });
const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Turn a `{ 'YYYY-MM-DD': count }` map into the 53-column grid both heatmaps
 * render. Weeks start on Sunday, matching GitHub's own calendar.
 */
export function buildCalendar(days = {}, { unit = 'contributions', today = new Date() } = {}) {
  // Noon, not midnight: where daylight saving switches at midnight (Egypt
  // does) a midnight date drifts to 01:00 after the switch, the `d <= end`
  // test then fails a day early and today's cell is never drawn.
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - start.getDay());

  const counts = Object.values(days).filter(Boolean);
  const peak = counts.length ? Math.max(...counts) : 0;
  const level = n => {
    if (!n) return 0;
    if (!peak) return 1;
    return Math.min(4, 1 + Math.floor((n / peak) * 3.999));
  };

  const cells = [];
  const months = [];
  let lastMonth = -1;

  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const n = days[iso] ?? 0;
    const col = Math.floor(i / 7) + 1;

    if (d.getDay() === 0 && d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth();
      const prev = months[months.length - 1];
      if (col < 51 && (!prev || col - prev.col >= 3)) {
        months.push({ col, name: MONTH.format(d) });
      }
    }

    cells.push({
      date: iso,
      count: n,
      level: level(n),
      label: `${n ? `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}` : `No ${unit}`} · ` +
             DAY.format(d),
    });
  }

  return { cells, months, total: counts.reduce((a, b) => a + b, 0), peak };
}

/**
 * Longest and current run of consecutive active days in a calendar, with the
 * cell index ranges ([start, end], inclusive) so the page can point at them.
 */
export function streaks(cells) {
  let best = 0;
  let bestRange = null;
  let run = 0;
  cells.forEach((c, i) => {
    run = c.count > 0 ? run + 1 : 0;
    if (run > best) {
      best = run;
      bestRange = [i - run + 1, i];
    }
  });

  // Today may simply not have happened yet, so a run ending yesterday counts.
  let end = cells.length - 1;
  if (end >= 0 && cells[end].count === 0) end -= 1;
  let current = 0;
  for (let i = end; i >= 0 && cells[i].count > 0; i--) current += 1;

  return { best, bestRange, current, currentRange: current ? [end - current + 1, end] : null };
}
