/**
 * When was each archive problem solved?
 *
 * Most of the archive comes from private Codeforces groups, which the public
 * API never returns — so there is no timestamp for those submissions anywhere
 * we can read. What we do have is the submission ID, and Codeforces hands out
 * submission IDs from one global, ever-increasing counter shared by every
 * contest, gym and group. Any public submission is therefore an exact
 * (id → time) anchor, and a private submission's time can be interpolated
 * between the two anchors that bracket its ID.
 *
 * Accuracy depends on anchor density: with anchors a few hours apart the
 * estimate lands on the right calendar day almost always. Submissions we can
 * see directly (the public ones) always use their real time.
 *
 * Pure functions only — imported by the browser and by scripts/fetch-data.mjs.
 */

/** Sort by ID, drop duplicates and any point that would make time run backwards. */
export function mergeAnchors(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const pair of list ?? []) {
      const [id, at] = pair;
      if (Number.isFinite(id) && Number.isFinite(at)) byId.set(id, at);
    }
  }

  const sorted = [...byId.entries()].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const pair of sorted) {
    if (out.length && pair[1] < out[out.length - 1][1]) continue;
    out.push(pair);
  }
  return out;
}

/** Index of the last anchor whose ID is <= id, or -1. */
function floorIndex(anchors, id) {
  let lo = 0;
  let hi = anchors.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid][0] <= id) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Estimated creation time (epoch seconds) of submission `id`.
 * Outside the anchored range it extrapolates from the nearest stretch of
 * anchors, and never returns a time in the future.
 */
export function estimateTime(anchors, id, now = Date.now() / 1000) {
  if (!anchors.length) return null;
  if (anchors.length === 1) return Math.min(anchors[0][1], now);

  let i = floorIndex(anchors, id);
  if (i >= 0 && anchors[i][0] === id) return anchors[i][1];

  // Pick the bracketing pair, or the closest pair at either end.
  if (i < 0) i = 0;
  else if (i >= anchors.length - 1) i = anchors.length - 2;

  const [a, ta] = anchors[i];
  const [b, tb] = anchors[i + 1];
  const t = ta + ((id - a) * (tb - ta)) / (b - a || 1);
  return Math.min(Math.round(t), now);
}

/** The anchors either side of `id` (either may be undefined at the ends). */
export function bracket(anchors, id) {
  const i = floorIndex(anchors, id);
  return [anchors[i], anchors[i + 1]];
}

/**
 * Keep the snapshot small: every anchor that brackets an ID we care about,
 * plus at most one per `spacing` seconds so future IDs still have a frame.
 */
export function thinAnchors(anchors, keepIds = [], spacing = 12 * 3600) {
  const keep = new Set();
  for (const id of keepIds) {
    const i = floorIndex(anchors, id);
    if (i >= 0) keep.add(i);
    if (i + 1 < anchors.length) keep.add(i + 1);
  }

  let last = -Infinity;
  anchors.forEach(([, at], i) => {
    if (at - last >= spacing) {
      keep.add(i);
      last = at;
    }
  });
  if (anchors.length) keep.add(anchors.length - 1);

  return [...keep].sort((a, b) => a - b).map(i => anchors[i]);
}

/** Stable key for a problem, whichever source it came from. */
export const problemKey = p =>
  `${p.contestId ?? p.problem?.contestId ?? '?'}${p.index ?? p.problem?.index ?? ''}`;

/**
 * Where a contest lives on codeforces.com: regular rounds under /contest,
 * gyms (ids 100000–199999) under /gym, and group contests under
 * /group/<code>/contest — which needs the group's code, looked up from
 * `groups` (contest id → code) when known.
 */
function contestPath(contestId, groups) {
  if (contestId < 100000) return `contest/${contestId}`;
  if (contestId < 200000) return `gym/${contestId}`;
  const code = groups?.get(contestId);
  return code ? `group/${code}/contest/${contestId}` : null;
}

/**
 * First accepted submission per problem from a `user.status` list, each with
 * an `entry` shaped like a problems.json record — so a solve the solutions
 * repository has not synced yet can be shown and counted as-is. A group
 * contest whose code is unknown links to the handle's submissions page.
 */
export function firstAccepted(submissions, { groups, handle } = {}) {
  const first = new Map();
  for (const s of submissions) {
    if (s.verdict !== 'OK' || !s.problem) continue;
    const key = problemKey(s);
    if (first.has(key) && first.get(key).at <= s.creationTimeSeconds) continue;

    const contestId = s.problem.contestId ?? s.contestId;
    const path = contestPath(contestId, groups);
    const fallback = `https://codeforces.com/submissions/${handle ?? s.author?.members?.[0]?.handle ?? ''}`;
    first.set(key, {
      key,
      id: s.id,
      at: s.creationTimeSeconds,
      entry: {
        contestId,
        index: s.problem.index,
        name: s.problem.name,
        ...(s.problem.rating ? { rating: s.problem.rating } : {}),
        tags: s.problem.tags?.length ? s.problem.tags : ['untagged'],
        url: path ? `https://codeforces.com/${path}/problem/${s.problem.index}` : fallback,
        submissionUrl: path ? `https://codeforces.com/${path}/submission/${s.id}` : fallback,
        submissionId: s.id,
        language: s.programmingLanguage ?? '',
        timeConsumedMillis: s.timeConsumedMillis ?? -1,
        memoryConsumedBytes: s.memoryConsumedBytes ?? 0,
      },
    });
  }
  return [...first.values()];
}

/** Public solves that the archive (by problem key) does not hold yet. */
export function unsynced(accepted = [], archiveKeys) {
  return accepted.filter(ac => !archiveKeys.has(ac.key));
}
