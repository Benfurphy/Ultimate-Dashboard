# RESUME HERE

- **Working on:** Nothing in progress — last session shipped and pushed three new dashboard tabs (Caffeine, Fitness, Journal) plus removed Finance and Fitness Band. All clean.
- **Next step:** Wait for the user's next request; nothing queued.
- **Waiting on you:** nothing, keep going.

-----

## Done so far (all committed + pushed to `main`)

- `2f2d4e1` — Built out **Caffeine** tab (`caffeine.html`): dose peak/crash calculator, drink search DB, custom drinks, overconsumption warnings.
- `a12195d` — Replaced **Finance** with **Fitness** (`fitness.html`): Garmin running load, pace-at-144bpm trend, VO2max, manual time-trial benchmarks. Extended `api/garmin/index.js` with a new `?action=activities` branch (no new route file — Vercel Hobby plan is at the 12-function cap). Deleted `finance.html` and `whoop.html` ("Fitness Band" tab) per user request; underlying Whoop/Fitbit/Garmin vitals sync still lives in `index.html`'s own "Add vitals" modal, untouched.
- `75caaae` — Added **Journal** tab (`journal.html`): 5-min (3 fixed slots) / 10-min (+ up to 2 add-ons) guided journaling, deterministic daily prompt rotation, browsable/editable history, streak counter.

All three new tabs follow the same pattern: standalone HTML file linking `theme.css`/`theme.js`, own `localStorage` key (`caffeine_standalone_v1`, `fitness_standalone_v1`, `journal_standalone_v1`), registered in `index.html`'s `APPS` array + `statFor()` ticker hook, verified in a real headless-Chromium pass (Playwright) with no console errors before each push.

## Key files

- `index.html` — dashboard hub: `APPS` array (~line 261) and `statFor()` (~line 443) are where every tab's hub card + ticker stat are wired.
- `caffeine.html`, `fitness.html`, `journal.html` — the three new tabs, self-contained.
- `api/garmin/index.js` — consolidated Garmin serverless function (vitals + new `activities` action); do not add a new file under `/api`, the 12-function Hobby cap is already hit.
- `theme.css` / `theme.js` — shared design system every page links; reuse existing classes (`.card`, `.btn*`, `.overlay`/`.panel`, `.fieldInput`) rather than inventing new ones.

## Watch out

- Don't commit/push without being asked explicitly — that's been the standing instruction all session.
- There's an unrelated untracked `Ultimate-Dashboard/` subfolder (a stale nested copy with its own `.git`) and `.claude/` in the repo root — pre-existing, not part of any of this work, leave alone unless the user asks about it.
- Playwright + Chromium are already installed locally (used for browser verification) — no need to reinstall.
