#!/usr/bin/env node
/**
 * Build-time data fetcher.
 *
 * Pulls live Codeforces + GitHub data and writes data/snapshot.json, which the
 * site loads instantly on first paint. The browser then revalidates the
 * keyless endpoints in the background, so the page is never stale by more than
 * one visit.
 *
 * Credentials (all optional — see .env.example):
 *   GITHUB_TOKEN              raises the GitHub REST limit from 60/hr to 5000/hr
 *                             and unlocks the real contributions calendar via
 *                             the GraphQL API. Without it we fall back to a
 *                             keyless public mirror.
 *   CF_API_KEY / CF_API_SECRET  signs Codeforces calls (codeforces.com/settings/api).
 *                             Only needed for private/group contest data; every
 *                             endpoint used here works unauthenticated too.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeAnchors, estimateTime, thinAnchors, bracket, problemKey, firstAccepted } from '../assets/js/solve-dates.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'omar-ali-portfolio-build/1.0 (+https://github.com/Omar-Ayman-Ali)';

/* ---------------------------------------------------------------- env ---- */

async function loadEnv() {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return;
  const text = await readFile(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}

/* --------------------------------------------------------------- utils --- */

const log = (...a) => console.log('  ', ...a);
const warn = (...a) => console.warn('  !', ...a);

async function getJSON(url, { headers = {}, tries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
      if (res.status === 403 || res.status === 429) throw new Error(`rate limited (${res.status})`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------------------------------------------------------- codeforces --- */

/**
 * Codeforces authorized-request signing.
 * apiSig = <rand><sha512Hex(`<rand>/<method>?<params sorted>#<secret>`)>
 * Unsigned when no key pair is configured — every method used here is public.
 */
const cfSigned = () => Boolean(process.env.CF_API_KEY && process.env.CF_API_SECRET);

function cfUrl(method, params = {}, { sign = true } = {}) {
  const key = process.env.CF_API_KEY;
  const secret = process.env.CF_API_SECRET;
  const base = `https://codeforces.com/api/${method}`;
  if (!sign || !key || !secret) {
    const qs = new URLSearchParams(params).toString();
    return qs ? `${base}?${qs}` : base;
  }
  const full = { ...params, apiKey: key, time: Math.floor(Date.now() / 1000) };
  const sorted = Object.keys(full).sort().map(k => `${k}=${full[k]}`).join('&');
  const rand = randomBytes(3).toString('hex');
  const hash = createHash('sha512').update(`${rand}/${method}?${sorted}#${secret}`).digest('hex');
  return `${base}?${sorted}&apiSig=${rand}${hash}`;
}

// Codeforces allows one call per two seconds; space every call out.
let cfLast = 0;

async function cf(method, params, options) {
  const wait = cfLast + 2100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  cfLast = Date.now();
  const body = await getJSON(cfUrl(method, params, options));
  if (body.status !== 'OK') throw new Error(`Codeforces ${method}: ${body.comment || body.status}`);
  return body.result;
}

async function fetchCodeforces(handle, groupCodes = []) {
  const signed = cfSigned();
  log(`Codeforces @${handle} ${signed ? '(signed — private groups included)' : '(public, no key required)'}`);

  const [info] = await cf('user.info', { handles: handle });
  const rating = await cf('user.rating', { handle });
  let submissions = [];
  try {
    submissions = await cf('user.status', { handle, from: 1, count: 100000 });
  } catch (err) {
    warn(`user.status failed (${err.message}) — activity calendar will be empty`);
  }

  // Signed, user.status also returns private-group submissions with their
  // exact times. Ask once more unsigned to know which solves are public, and
  // look up the groups the archive links to so group solves get real URLs.
  let publicKeys = null;
  const groups = new Map();
  if (signed) {
    try {
      const open = await cf('user.status', { handle, from: 1, count: 100000 }, { sign: false });
      publicKeys = new Set(firstAccepted(open).map(a => a.key));
    } catch (err) {
      warn(`public user.status failed (${err.message})`);
    }
    for (const code of groupCodes) {
      try {
        for (const c of await cf('contest.list', { groupCode: code })) groups.set(c.id, code);
      } catch (err) {
        warn(`group ${code}: ${err.message}`);
      }
    }
  }

  // Distinct accepted problems, each dated by its first accepted submission.
  const accepted = firstAccepted(submissions, { groups, handle: info.handle }).map(a =>
    publicKeys ? { ...a, public: publicKeys.has(a.key) } : a,
  );
  const publicCount = publicKeys ? publicKeys.size : accepted.length;

  log(`  rating ${info.rating} (max ${info.maxRating}) · ${rating.length} rated rounds · ` +
      `${submissions.length} submissions · ${accepted.length} distinct AC (${publicCount} public)`);

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
    contests: rating.map(r => ({
      contestId: r.contestId,
      name: r.contestName,
      rank: r.rank,
      oldRating: r.oldRating,
      newRating: r.newRating,
      at: r.ratingUpdateTimeSeconds,
    })),
    submissionCount: submissions.length,
    acceptedCount: publicCount,
    accepted,
    // Every public submission is an exact id → time anchor for solve-dates.js.
    anchors: submissions.map(s => [s.id, s.creationTimeSeconds]),
  };
}

/* -------------------------------------------------------------- github --- */

function ghHeaders() {
  const h = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchGitHub(login) {
  const token = Boolean(process.env.GITHUB_TOKEN);
  log(`GitHub @${login} ${token ? '(token)' : '(unauthenticated, 60 req/hr)'}`);

  const user = await getJSON(`https://api.github.com/users/${login}`, { headers: ghHeaders() });
  const repos = await getJSON(
    `https://api.github.com/users/${login}/repos?per_page=100&sort=updated&type=owner`,
    { headers: ghHeaders() },
  );

  // Real language distribution, weighted by bytes across every public repo.
  const bytes = {};
  for (const repo of repos) {
    if (repo.fork) continue;
    try {
      const langs = await getJSON(repo.languages_url, { headers: ghHeaders(), tries: 2 });
      for (const [name, n] of Object.entries(langs)) bytes[name] = (bytes[name] || 0) + n;
    } catch (err) {
      warn(`languages for ${repo.name}: ${err.message}`);
    }
  }
  const totalBytes = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const languages = Object.entries(bytes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ name, bytes: n, share: n / totalBytes }));

  const contributions = await fetchContributions(login);

  log(`  ${user.public_repos} public repos · ${languages.length} languages · ` +
      `${contributions.total} contributions (${contributions.source})`);

  return {
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
    languages,
    contributions,
  };
}

/**
 * The contributions calendar is the one figure GitHub does not expose publicly.
 * With a token we ask the GraphQL API directly; without one we fall back to a
 * keyless public mirror of the same numbers.
 */
async function fetchContributions(login) {
  if (process.env.GITHUB_TOKEN) {
    const query = `query($login:String!){
      user(login:$login){
        contributionsCollection{
          contributionCalendar{
            totalContributions
            weeks{ contributionDays{ date contributionCount } }
          }
        }
      }
    }`;
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'user-agent': UA,
          authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { login } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.errors?.length) throw new Error(body.errors[0].message);
      const cal = body.data.user.contributionsCollection.contributionCalendar;
      const days = {};
      for (const week of cal.weeks) {
        for (const day of week.contributionDays) {
          if (day.contributionCount) days[day.date] = day.contributionCount;
        }
      }
      return { total: cal.totalContributions, days, source: 'github-graphql' };
    } catch (err) {
      warn(`GraphQL contributions failed (${err.message}) — falling back to public mirror`);
    }
  }
  try {
    const body = await getJSON(`https://github-contributions-api.jogruber.de/v4/${login}?y=last`);
    const days = {};
    for (const d of body.contributions ?? []) if (d.count) days[d.date] = d.count;
    return { total: body.total?.lastYear ?? 0, days, source: 'public-mirror' };
  } catch (err) {
    warn(`contributions unavailable: ${err.message}`);
    return { total: 0, days: {}, source: 'unavailable' };
  }
}

/* ------------------------------------------------------------- archive --- */

/**
 * The solutions repository's cf_sync.py keeps a problems.json at its root —
 * including the private-group problems the public Codeforces API never
 * returns. Mirror it into data/problems.json so the archive's count is always
 * the repository's. Returns null (keep the local copy) if it can't be read.
 */
async function fetchArchive({ owner, name, branch }) {
  const url = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/problems.json`;
  log(`Archive ${owner}/${name}@${branch}`);
  try {
    const list = await getJSON(url);
    if (!Array.isArray(list) || !list.length) throw new Error('empty or malformed');
    log(`  ${list.length} accepted problems`);
    return list;
  } catch (err) {
    warn(`archive sync failed (${err.message}) — keeping local data/problems.json`);
    return null;
  }
}

/* ------------------------------------------------------- solve dates --- */

/**
 * Exact (submission id → time) pairs from public Codeforces activity, used to
 * date the private-group submissions the API will not show us (see
 * assets/js/solve-dates.js). The busiest handles in the live feed each return
 * months of history in one call. Anchors are history, so the snapshot keeps
 * them and every daily run only adds to the pile.
 */
async function fetchAnchors({ handles = 10 } = {}) {
  const pause = () => new Promise(r => setTimeout(r, 2100)); // CF: 1 call / 2s
  const pairs = [];
  let recent = [];
  try {
    recent = await cf('problemset.recentStatus', { count: 1000 });
    for (const s of recent) pairs.push([s.id, s.creationTimeSeconds]);
  } catch (err) {
    warn(`recentStatus failed (${err.message})`);
    return pairs;
  }

  const tally = new Map();
  for (const s of recent) {
    for (const m of s.author?.members ?? []) tally.set(m.handle, (tally.get(m.handle) ?? 0) + 1);
  }
  const busiest = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, handles).map(e => e[0]);

  for (const handle of busiest) {
    await pause();
    try {
      const subs = await cf('user.status', { handle, from: 1, count: 10000 });
      for (const s of subs) pairs.push([s.id, s.creationTimeSeconds]);
    } catch (err) {
      warn(`anchors from ${handle}: ${err.message}`);
    }
  }
  return pairs;
}

/**
 * Tighten the widest brackets around archive submissions.
 *
 * Contest 4 (Watermelon) takes a steady stream of practice submissions every
 * day, newest first, so `from=N` reaches back in time monotonically. For the
 * archive ID with the widest anchor gap, aim an offset at its estimated time
 * (interpolating from earlier probes), read 20 submissions there, and repeat.
 * Every probe is a real anchor. Capped per run; the snapshot keeps the
 * anchors, so later runs start where this one stopped.
 */
async function fillGaps(anchors, ids, { maxProbes = 40, maxGap = 6 * 3600, contestId = 4 } = {}) {
  const pause = () => new Promise(r => setTimeout(r, 2100));
  const now = Math.floor(Date.now() / 1000);
  const aimed = [[1, now]]; // (offset, time) pairs, newest first
  const stuck = new Set();
  let probes = 0;

  const aim = target => {
    aimed.sort((a, b) => a[0] - b[0]);
    const older = aimed.findIndex(([, t]) => t <= target);
    if (older < 0) {
      // Nothing that old yet: extrapolate from the overall rate so far.
      const [f, t] = aimed.length > 1 ? aimed[aimed.length - 1] : [2000, now - 86400];
      return Math.max(1, Math.round((f * (now - target)) / Math.max(1, now - t)));
    }
    if (older === 0) return aimed[0][0];
    const [fa, ta] = aimed[older - 1];
    const [fb, tb] = aimed[older];
    return Math.max(1, Math.round(fa + ((fb - fa) * (ta - target)) / Math.max(1, ta - tb)));
  };

  while (probes < maxProbes) {
    let worst = null;
    for (const id of ids) {
      if (stuck.has(id)) continue;
      const [lo, hi] = bracket(anchors, id);
      if (!lo || !hi) continue;
      const gap = hi[1] - lo[1];
      if (gap > maxGap && (!worst || gap > worst.gap)) worst = { id, gap };
    }
    if (!worst) break;

    const target = estimateTime(anchors, worst.id);
    const from = aim(target);
    probes += 1;
    await pause();
    let subs = [];
    try {
      subs = await cf('contest.status', { contestId, from, count: 20 });
    } catch (err) {
      warn(`gap probe at ${from}: ${err.message}`);
      break;
    }
    if (!subs.length) {
      aimed.push([from, 0]); // past the start of the contest
      continue;
    }
    aimed.push([from, subs[0].creationTimeSeconds]);
    anchors = mergeAnchors(anchors, subs.map(s => [s.id, s.creationTimeSeconds]));

    const [lo, hi] = bracket(anchors, worst.id);
    if (hi[1] - lo[1] >= worst.gap) stuck.add(worst.id);
  }

  const left = ids.filter(id => {
    const [lo, hi] = bracket(anchors, id);
    return lo && hi && hi[1] - lo[1] > maxGap;
  }).length;
  log(`  ${probes} gap probe${probes === 1 ? '' : 's'} · ${left} solve date${left === 1 ? '' : 's'} still in a gap over ${maxGap / 3600}h`);
  return anchors;
}

/**
 * Solve time for every archive problem, as [submissionId, epochSeconds, key]:
 * the real submission time when the public API has it, interpolated otherwise.
 */
function dateProblems(problems, codeforces, anchors) {
  const exact = new Map(codeforces?.anchors ?? []);
  const solved = [];
  let estimated = 0;
  for (const p of problems) {
    const id = p.submissionId;
    const at = exact.get(id) ?? (id ? estimateTime(anchors, id) : null);
    if (at == null) continue;
    if (!exact.has(id)) estimated += 1;
    solved.push([id, at, problemKey(p)]);
  }
  return { solved, estimated };
}

/* --------------------------------------------------------------- build --- */

async function main() {
  await loadEnv();
  const config = JSON.parse(await readFile(resolve(ROOT, 'site.config.json'), 'utf8'));
  const problemsPath = resolve(ROOT, 'data/problems.json');
  const localProblems = existsSync(problemsPath) ? await readFile(problemsPath, 'utf8') : '[]';

  // Group codes the archive already links to, for group-contest URLs.
  const groupCodes = [...new Set(
    JSON.parse(localProblems).map(p => p.url?.match(/\/group\/([^/]+)\//)?.[1]).filter(Boolean),
  )];

  console.log('Fetching live data…');
  const [archive, codeforces, github] = await Promise.all([
    fetchArchive(config.archiveRepo),
    fetchCodeforces(config.handles.codeforces, groupCodes).catch(err => {
      warn(`Codeforces failed: ${err.message}`);
      return null;
    }),
    fetchGitHub(config.handles.github).catch(err => {
      warn(`GitHub failed: ${err.message}`);
      return null;
    }),
  ]);

  if (!codeforces && !github) {
    console.error('Both providers failed — refusing to overwrite the existing snapshot.');
    process.exit(1);
  }

  let problems = JSON.parse(localProblems);
  if (archive) {
    const text = JSON.stringify(archive, null, 2) + '\n';
    if (text !== localProblems) {
      await writeFile(problemsPath, text);
      log(`Updated data/problems.json (${problems.length} → ${archive.length})`);
    }
    problems = archive;
  }

  const previous = existsSync(resolve(ROOT, 'data/snapshot.json'))
    ? JSON.parse(await readFile(resolve(ROOT, 'data/snapshot.json'), 'utf8'))
    : {};

  // Dates for the archive. Runs after the parallel fetches so the extra
  // Codeforces calls respect its one-call-per-two-seconds limit.
  const cfNow = codeforces ?? previous.codeforces;
  const since = (cfNow?.registeredAt ?? 0) - 3 * 86400;
  const exactIds = new Set((cfNow?.anchors ?? []).map(([id]) => id));
  const undated = problems.map(p => p.submissionId).filter(id => id && !exactIds.has(id));

  // With a Codeforces key every archive submission usually has its real time,
  // and the whole estimation pass (a few minutes of API calls) is skipped.
  let anchors = mergeAnchors(previous.archive?.anchors, cfNow?.anchors);
  if (undated.length) {
    log(`Codeforces submission-id anchors (${undated.length} solve dates to estimate)`);
    const harvested = codeforces ? await fetchAnchors() : [];
    anchors = await fillGaps(
      mergeAnchors(anchors, harvested.filter(([, at]) => at >= since)),
      undated,
      { maxProbes: Number(process.env.CF_GAP_PROBES ?? 40) },
    );
  }
  const { solved, estimated } = dateProblems(problems, cfNow, anchors);
  const kept = thinAnchors(anchors, problems.map(p => p.submissionId));
  log(`  ${anchors.length} anchors (${kept.length} kept) · ${problems.length - estimated} exact, ${estimated} estimated solve dates`);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    archive: { total: problems.length, solved, anchors: kept },
    codeforces: codeforces ?? previous.codeforces ?? null,
    github: github ?? previous.github ?? null,
  };

  // Hourly runs should not commit a new snapshot just because the clock moved.
  // Fields that change on their own (last-online time) don't count either.
  const comparable = snap => JSON.stringify({
    ...snap,
    generatedAt: null,
    codeforces: snap.codeforces && { ...snap.codeforces, lastOnlineAt: null },
  });
  if (previous.generatedAt && comparable(previous) === comparable(snapshot)) {
    console.log('\nNo changes — data/snapshot.json left as it was.');
    return;
  }

  await writeFile(resolve(ROOT, 'data/snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`\nWrote data/snapshot.json (${snapshot.generatedAt})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
