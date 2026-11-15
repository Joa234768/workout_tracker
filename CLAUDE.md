# CLAUDE.md — Workout Tracker

## Project
A personal workout tracker for one user (me). It's a mobile-first Progressive Web App (PWA): installed on my iPhone home screen and used at the gym, often without internet. It's hosted free on GitHub Pages from this repo (`main` branch, root folder).

The full feature list and roadmap are in `SPEC.md`. Read it before starting any feature. The data model, backup format and the decisions behind them are in `docs/DATA_MODEL.md`. Read it before touching stored data.

## Hard constraints
- **No backend:** no accounts, no analytics, no runtime network calls except fetching the app's own files from this same site.
- **Fully offline after first load.** A service worker caches the app shell.
- **Plain HTML, CSS and JavaScript (ES modules).** No build step, no bundler, no framework, no npm dependencies. GitHub Pages must be able to serve the repo exactly as it is.
- **No CDNs.** Third-party code is vendored into `/lib/`, with its version and license noted in `/lib/README.md`. Currently approved: **Chart.js**. Ask before adding anything else.
- **Target device: iPhone, Safari, running as an installed home-screen app** (standalone mode). Design for 375–430 px width. 
- **All personal data lives on the device in IndexedDB.** Nothing personal is ever committed to the repo.

## Commands
- Local dev server: `py -m http.server 8000 --bind 127.0.0.1` (on this PC Python runs as `py`), then open `http://localhost:8000`. Always keep `--bind 127.0.0.1`: without it, every device on the same Wi-Fi could read everything in the repo folder, including `.git`. Service workers need a server, so double-clicking `index.html` won't work. On localhost the service worker prefers the network, so edits show up on reload.
- Logic tests: `node --test tests/`. This uses Node's built-in test runner and needs no installs.
- Database self-check: Settings → "Run database self-check" (`#/settings/selfcheck`), or `http://localhost:8000/tests/browser/` on the PC. It round-trips every store and tests upgrades in scratch databases, in a real browser.
- Browser checks: `node tools/browser/check.mjs`. Drives a headless Edge/Chrome at 375 px through the whole app: tabs, service worker and cache, self-check, backup export and import (with real files), the update banner, and offline use. It needs no installs, starts its own server, changes nothing in the repo, exits with 1 on failure, and prints a temp folder of light and dark screenshots. **Read the screenshots** (they are the visual check), and **add a check for each new feature** in the same style.
- **The service worker behaves differently on `localhost`** (network-first, for development) than on any other hostname (cache-first, like the phone). The browser checks therefore open the app at `http://app.localhost:<port>`. When testing a service worker change by hand, use `http://app.localhost:8000`, not `http://localhost:8000`. A phone-only bug shipped once because it was only tested on `localhost`.
- What no check on this PC can cover: the iOS share sheet and "Save to Files", `navigator.storage.persist()`, safe areas and the status bar. Say so plainly and list them for me to test on the phone.
- Icons: `py tools/make_icons.py` regenerates `icons/`.
- Exercise photos: `py tools/make_images.py <archive>` regenerates `images/exercises/` from the dataset's originals (needs Pillow on this PC; see `data/README.md`). Only needed when the dataset is updated.

## Structure (keep this section updated if it changes)
- `index.html`: the app shell (header, `<main id="view">`, banner slot, tab bar).
- `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll`: the PWA files. All URLs are relative (`./…`), because the site is served from a subpath.
- `css/tokens.css`: CSS variables (colours for light and dark, spacing, type). `css/app.css`: layout and shared components.
- `js/app.js`: startup (open the database, `persist()`, register the service worker, start the router).
- `js/router.js`: hash router (`#/today`, `#/settings`, later `#/exercises/<id>`). The first segment picks the tab.
- `js/sw-client.js`: service worker registration, update detection, app version lookup.
- `js/db.js`: the **only** module that talks to IndexedDB.
- `js/backup.js`: backup export/import orchestration (share sheet, files).
- `js/workouts.js`: workouts' data access (start, save on every change, finish, list, delete).
- `js/plan.js`: routines and the calendar plan (weekly plan versions, single-day changes, one-off workouts).
- `js/body.js`: the body-weight log's data access (one entry per day).
- `js/volume.js`: muscle volume's data access (a week's sets per muscle group, the counting mode and targets in `settings`).
- `js/exercises.js`: the exercise library's data access (loads `data/exercises.json`, merges it with my custom exercises and overrides, saves my changes).
- `js/ui/`: small DOM helpers (`el()`, banner/toast, confirm dialog, export button, chips and the muscle picker, the warm-up calculator in `warmup-dialog.js`, the weekly volume bars in `volume.js`, the body map in `body-map.js`: an original SVG whose shapes are listed as data at the top of the file, and `chart.js`: the only module that touches Chart.js).
- `js/views/`: one module per screen, each exporting `mount(container, params)` that returns a cleanup function. Sub-screens are routes inside the app (e.g. `#/settings/selfcheck`), never separate HTML pages: the installed app must not navigate away from `index.html`.
- `js/selfcheck.js`: the database self-check, shown by `js/views/selfcheck.js`.
- The Progress tab has four parts with a switch at the top: Muscles (`#/progress`), Exercises (`#/progress/exercises`, charts at `#/progress/exercises/<id>`), Training (`#/progress/training`) and Body (`#/progress/body`). `js/views/progress.js` routes between the `progress-*.js` views. Targets and the counting mode are edited at `#/settings/volume`.
- **Charts:** Chart.js is loaded by `js/ui/chart.js` the first time a chart is shown, never at startup. No date adapter is vendored: dates are plotted as day numbers on a plain number axis. Every chart has a single value axis (never two), no animation, and takes its colours from the CSS variables, so it is redrawn when the system theme changes. The browser checks read a chart's data with `Chart.getChart(canvas)`.
- Screens outside the five tabs: `#/workout` (the workout in progress, under the Today tab). Under the Calendar tab: the month view (`#/calendar`), the history list (`#/calendar/history`), plan and routines (`#/calendar/plan`, `#/calendar/routines/<id>`), and workout summaries and editing (`#/calendar/<workoutId>`). The full list is at the top of `js/views/calendar.js`. `js/views/workout-editor.js` is shared by the workout in progress and editing a past workout.
- `js/logic/`: pure functions with no DOM and no IndexedDB (`dates.js`, `schema.js`, `backup.js`, `muscles.js`, `exercises.js`, `sets.js`, `workout.js`, `volume.js`, `routines.js`, `plan.js`, `stats.js`, and `helpers.js` for progression suggestions, the warm-up ramp and the CSV export). `plan.js` computes every calendar day from the plan rules; nothing is pre-generated. `sets.js` defines what a working set is and how weights are written; use it everywhere.
- `data/exercises.json`: a vendored, unmodified copy of free-exercise-db (public domain / Unlicense). The source commit, checksum and update steps are in `data/README.md`. Never edit it by hand.
- `images/exercises/<exercise id>/<n>.jpg`: the dataset's photos, shrunk to 640 px (57 MB, 1,746 files). **Never added to `PRECACHE`.** The service worker fetches a photo the first time its exercise is opened and keeps it in its own cache (`exercise-images-v1`), which app updates do not clear. A photo that cannot be loaded is simply not shown.
- `lib/`: vendored third-party code (Chart.js). Version, source, checksum and licence are in `lib/README.md`.
- `tests/`: Node tests for `js/logic/` and the dataset, plus `fixtures/` (one backup per schema version, and `exercise-ids.json`, the list of every exercise ID that has shipped; both kept forever).
- `tests/browser/`: a standalone page running the same self-check on the PC. Not part of the app shell.
- `tools/make_icons.py`: one-off icon generator (Python standard library only). `tools/make_images.py`: one-off photo shrinker (needs Pillow).
- `tools/browser/`: the browser checks. `check.mjs` is the list of checks, `cdp.mjs` drives the headless browser (helpers: `goto`, `eval`, `waitFor`, `dark`, `pickFiles`, `screenshot`), `server.mjs` is a static server the checks can stop (offline) and that can serve `sw.js` with another version (update banner). Node built-ins only; not part of the app shell. The server must keep listening on `127.0.0.1` only and refusing hidden files.
- `docs/DATA_MODEL.md`: stores, backup format, migrations, and decisions for later phases.

## Data safety rules (most important)
My training history can't be replaced. Therefore:
- **The IndexedDB schema is versioned.** Every schema change bumps the version and ships a migration that keeps all existing data. Never delete or rename stored fields without a migration. The store list and migration steps live in `js/logic/schema.js`; each schema bump also adds a fixture backup of the old version to `tests/fixtures/` with a test that migrates it.
- **Ask me before changing the schema.**
- **Export/import must round-trip everything.** A backup contains every store, and import restores it exactly. Any change that adds a store or field updates export/import in the same commit.
- **Backups carry a `schemaVersion`.** Importing an older backup runs the migrations.
- **Before import overwrites data,** ask for confirmation and offer to export the current data first.
- **Exercise IDs referenced by logged sets must stay stable forever.** Built-in exercises use the dataset's `id`. My edits (muscle tags, favourites) are stored as overrides, not by modifying the dataset.
- **Call `navigator.storage.persist()` on startup.**
- **Checks must not depend on the day they run.** The fixture backup has fixed dates; the browser checks move its workout to "a week ago" and build their own plan relative to today.
- **Save an in-progress workout to IndexedDB on every change,** so closing the app never loses it.

## iPhone / Safari specifics
- No Vibration API and very limited background execution. Don't build features that depend on them.
- Inputs use `font-size` of at least 16 px, which stops iOS from auto-zooming.
- Weight/rep inputs use `inputmode="decimal"` / `"numeric"`. Accept both `,` and `.` as the decimal separator, because a Danish keyboard may give a comma.
- Respect safe areas (`env(safe-area-inset-*)`), especially for the bottom tab bar.
- Include `apple-touch-icon` and the standalone meta tags.
- **Backup export** uses the Web Share API with a file, so I can choose "Save to Files" → iCloud Drive. Fall back to a download link.
- **Backup import** uses `<input type="file" accept=".json,application/json">`, which opens the Files app (iCloud Drive included).
- The home-screen app and a Safari tab have separate storage. The app is meant to be used from the icon.

## Conventions
- **Weights:** kg only, stored as numbers (e.g. `12.5`). Display without trailing zeros.
- **Dates:** shown to me as `DD-MM-YYYY` everywhere, including the backup filename; always format with `formatDate()` from `js/logic/dates.js`. Stored as `YYYY-MM-DD` strings for calendar days (this order must stay: IndexedDB sorts and range-searches them as text) and full ISO timestamps for events. Build day strings from local time, never from `toISOString()`. **Weeks run Monday–Sunday.**
- **IDs:** `crypto.randomUUID()`.
- **Security:** render any user-entered or imported text with `textContent`, never `innerHTML`.
- **Never pass a bare `null` to `append()`, `prepend()` or `replaceChildren()`:** the browser prints it as the text "null". Build optional children inside `el()` (which skips null), or spread an array (`...(show ? [node] : [])`). The browser checks fail on any stray "null", "undefined" or "NaN" on screen.
- **Logic:** calculations live in pure functions in `js/logic/` and have tests.
- **Theme:** follows the system light/dark setting (`prefers-color-scheme`).
- **Design:** minimal but elegant. Generous spacing, one accent colour, clear type hierarchy, touch targets of at least 44 px. The most common actions are reachable with one thumb. Secondary information (like last session's numbers) is shown in muted grey, never in the way.
- **UI language:** English.

## Workflow
- Work through `SPEC.md` one item at a time, in phase order. Tick items off (`- [x]`) when done.
- For larger features, plan first. If a requirement is unclear, ask instead of guessing.
- Keep commits small and focused, with clear messages.
- **Every release bumps `APP_VERSION`,** defined only at the top of `sw.js`. It names the service worker's cache, and the Settings screen asks the service worker for it. Otherwise the phone keeps serving the old version.
- **Every new file under `css/`, `js/`, `icons/`, `lib/` or `data/` is added to `PRECACHE` in `sw.js`.** `tests/precache.test.js` fails if one is missing.
- I test on the iPhone through GitHub Pages (`https://joa234768.github.io/workout_tracker/`), so finished work is pushed to `main`.
- When a decision is made that future sessions need to know, update this file (or `docs/DATA_MODEL.md` for data model details).

## Definition of done
- Works at 375 px width, in both light and dark mode.
- Works offline after a reload.
- Data from the previous version still loads (migration tested if the schema changed).
- Export → import round-trip still restores everything.
- No console errors, and both `node --test tests/` and `node tools/browser/check.mjs` pass.
