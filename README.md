# Omar Ayman Ali — portfolio & problems archive

Two static pages built from the Claude Design handoff, running on GSAP +
ScrollTrigger + Lenis, with every number pulled from a live API.

| Page | File | What it shows |
| --- | --- | --- |
| Portfolio | `index.html` | Hero, capabilities, live Codeforces stats, live GitHub activity, repositories, contact |
| Problems archive | `archive.html` | All 256 accepted solutions — searchable, filterable, sortable |

No framework and no build step: open `index.html` from any static host.

## Run it

```bash
npm run fetch    # refresh data/snapshot.json from the live APIs
npm run dev      # serve at http://localhost:5173
```

`npm start` does both.

## Where the data comes from

Nothing on either page is invented. The design prototype filled both heatmaps
with a seeded random number generator and hard-coded the rating figures; all of
that is now real.

| Figure | Source | Key needed |
| --- | --- | --- |
| Rating, rank, contest history | `codeforces.com/api/user.info`, `user.rating` | none |
| Codeforces activity calendar | The archive's solve dates (see below) plus `user.status` | none |
| Profile, repositories, stars, licenses | `api.github.com/users/…` | none (60 req/hr) |
| Language distribution | GitHub `languages_url`, weighted by bytes | none |
| Contributions calendar | GitHub GraphQL at build time; the keyless public mirror live in the browser | **token for the GraphQL path** |
| The 256 solved problems | `problems.json` in the solutions repo, written by its `cf_sync.py` | none |

Each page paints instantly from `data/snapshot.json` and `data/problems.json`,
then revalidates in the browser: Codeforces and GitHub REST, the contributions
mirror, and `raw.githubusercontent.com/…/codeforces-solutions/main/problems.json`
for the archive count and heatmap. All of them send
`Access-Control-Allow-Origin: *`, so a static host needs no server of its own.

Pages stay current while they are open: Codeforces and the archive are
re-checked every minute, GitHub every ten (its anonymous API allows 60 calls an
hour per visitor), polling pauses in a hidden tab and catches up when it is
shown again, and nothing repaints unless a number on the page actually moved.
A public solve the solutions repository has not synced yet is counted and
listed immediately, straight from its Codeforces submission; private-group
solves appear once they reach the repository's `problems.json`. `npm run fetch` mirrors the repository's
`problems.json` into `data/` as well, so the local copy never drifts.

### Why the archive says 256 and Codeforces says 25

231 of the solutions come from private training groups (acmASCIS, Assiut
Newcomers, Level Zero, IEEE CodeRefine). Those never appear in the public
Codeforces API, so `data/problems.json` — synced from the solutions repository —
stays the source of truth for the archive. Live Codeforces data supplements it
rather than replacing it, which is why the count never collapses to the public
subset. Only 50 problems carry a rating for the same reason; the Codeforces
problemset API has no entry for a group contest.

### Dating the private solves

The "Problems solved" heatmap plots all 256, which needs a date for each —
and neither the public API nor the solutions repository records one for a
private-group submission. The submission ID does the job instead: Codeforces
numbers every submission, public or private, from one global counter, so any
public submission is an exact *(id → time)* anchor, and a private one is
interpolated between the two anchors around its ID
(`assets/js/solve-dates.js`).

With a Codeforces key set (see Credentials) none of this is needed: signed
calls return every private submission with its real time. Without one,
`npm run fetch` gathers anchors from your own public submissions, the live
feed, the histories of the busiest current submitters, and targeted reads of
contest 4's practice stream aimed at the widest remaining gaps
(`CF_GAP_PROBES`, default 40 per run — each takes several seconds). Anchors
are history, so the snapshot keeps them and every run only narrows the gaps;
each solve's date is stored as `[submissionId, epochSeconds, problemKey]` in
`archive.solved`. Public solves always use their real time. A solve that
appears after the last build is dated in the browser from the same anchors.
Dates are bucketed in the visitor's time zone.

## Credentials

Copy `.env.example` to `.env`. **Every figure above already works with no key
set** — the credentials only raise limits and fidelity, and none of them is ever
bundled into the pages. `scripts/fetch-data.mjs` runs on your machine or in CI
and writes plain data to `data/snapshot.json`.

- **`GITHUB_TOKEN`** — [github.com/settings/tokens](https://github.com/settings/tokens).
  A fine-grained token with public read-only access, or a classic token with no
  scopes at all. Raises the REST limit from 60/hr to 5,000/hr and swaps the
  public contributions mirror for GitHub's own GraphQL calendar (add `read:user`
  for that). Without it the fetch falls back automatically.
- **`CF_API_KEY` / `CF_API_SECRET`** — [codeforces.com/settings/api](https://codeforces.com/settings/api).
  Recommended. Signed with the documented `apiSig` scheme, `user.status` also
  returns your private-group submissions, with their exact times. The fetch
  then dates every solve exactly (skipping the estimation pass entirely),
  counts and lists private solves the solutions repository has not synced yet,
  and links group problems to their real group pages. The browser can never
  hold the secret, so this reaches the site through the snapshot: add both as
  repository secrets and the hourly workflow picks up a private solve within
  the hour. The key never leaves `.env` / the Actions secret store.

If you are signed in to the GitHub CLI you don't need a `.env` at all for a
local run:

```bash
GITHUB_TOKEN="$(gh auth token)" npm run fetch
```

`.github/workflows/refresh-data.yml` re-runs the fetch hourly and commits the
snapshot and archive only when the numbers move. It uses the token GitHub Actions mints for the
run, so there is no secret to create for the default setup.

## Motion

Pinned CDN versions: GSAP 3.15.0 + ScrollTrigger + SplitText, Lenis 1.3.26,
Lucide 1.49.0.
Lenis' stylesheet is inlined at the top of `site.css`. Lucide 1.x dropped brand
icons, so GitHub links use `git-branch`.

`assets/js/motion.js` is the shared engine. Lenis owns the scroll position,
GSAP's ticker drives its RAF loop, and ScrollTrigger updates from Lenis' scroll
event, so the two never fight over frames.

Per page: a compile-sequence preloader and velocity-reactive marquee, a pinned
manifesto (SplitText characters rise in, then scroll breaks "temporary." apart
and draws a rule under "eternal."), magnetic buttons,
batched reveals, and counters that animate to their real values — when live
data lands, a number that has already counted tweens from its old value to the
new one instead of restarting. Stat boxes lift and draw an accent rule on hover;
hovering a heatmap stat lights up the days it counts (a streak, the last 30
days, every active day) and names the span. The archive adds a drawn-on donut
and row transitions scaled to how often they fire: typing and header sorts get
a 150ms fade, and a filter chip or page change gets a cascade that finishes
inside ~450ms.

Everything degrades. Under `prefers-reduced-motion: reduce`, or if the CDN
fails, `no-motion` is set, native scrolling takes over and both pages stay fully
readable — the reveal and counter helpers are re-render safe and never leave an
element stuck at `opacity: 0`.

## Layout

```
index.html / archive.html      the two pages
site.config.json               handles, repo, targets, the three featured repositories
assets/css/tokens.css          the Modernist design system, unmodified
assets/css/site.css            the prototype's inline styles as real classes
assets/js/motion.js            shared GSAP + Lenis engine
assets/js/data.js              snapshot load + live revalidation + calendars
assets/js/solve-dates.js       submission-ID → solve-time estimation (browser + build)
assets/js/portfolio.js         portfolio rendering and page motion
assets/js/archive.js           archive filtering, sorting, donut, table
data/problems.json             256 accepted solutions
data/snapshot.json             generated — do not edit by hand
scripts/fetch-data.mjs         the build-time fetcher
```

The original handoff bundle is kept under `Portfolio website project-handoff/`
for reference.
