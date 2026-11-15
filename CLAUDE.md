# CLAUDE.md — Workout Tracker

## Project
A personal workout tracker for one user (me). It's a mobile-first Progressive Web App (PWA): installed on my iPhone home screen and used at the gym, often without internet. It's hosted free on GitHub Pages from this repo (`main` branch, root folder).

The full feature list and roadmap are in `SPEC.md`. Read it before starting any feature.

## Hard constraints
- **No backend:** no accounts, no analytics, no runtime network calls except fetching the app's own files from this same site.
- **Fully offline after first load.** A service worker caches the app shell.
- **Plain HTML, CSS and JavaScript (ES modules).** No build step, no bundler, no framework, no npm dependencies. GitHub Pages must be able to serve the repo exactly as it is.
- **No CDNs.** Third-party code is vendored into `/lib/`, with its version and license noted in `/lib/README.md`. Currently approved: **Chart.js**. Ask before adding anything else.
- **Target device: iPhone, Safari, running as an installed home-screen app** (standalone mode). Design for 375–430 px width. 
- **All personal data lives on the device in IndexedDB.** Nothing personal is ever committed to the repo.

## Commands
- Local dev server: `python3 -m http.server 8000`, then open `http://localhost:8000`. Service workers need a server, so double-clicking `index.html` won't work.
- Logic tests: `node --test tests/`. This uses Node's built-in test runner and needs no installs.

## Proposed structure (keep this section updated if it changes)
- `index.html`: the app shell.
- `manifest.webmanifest`, `sw.js`, `icons/`: the PWA files.
- `css/`: styles. Theming goes through CSS variables.
- `js/app.js`: startup and tab routing.
- `js/db.js`: the **only** module that talks to IndexedDB.
- `js/views/`: one module per screen.
- `js/logic/`: pure functions with no DOM access (muscle volume, e1RM, progression, warm-up sets, calendar plan).
- `data/exercises.json`: a vendored copy of free-exercise-db (public domain / Unlicense). The source commit is noted in `data/README.md`.
- `lib/`: vendored third-party code.
- `tests/`: tests for `js/logic/`.

## Data safety rules (most important)
My training history can't be replaced. Therefore:
- **The IndexedDB schema is versioned.** Every schema change bumps the version and ships a migration that keeps all existing data. Never delete or rename stored fields without a migration.
- **Ask me before changing the schema.**
- **Export/import must round-trip everything.** A backup contains every store, and import restores it exactly. Any change that adds a store or field updates export/import in the same commit.
- **Backups carry a `schemaVersion`.** Importing an older backup runs the migrations.
- **Before import overwrites data,** ask for confirmation and offer to export the current data first.
- **Exercise IDs referenced by logged sets must stay stable forever.** Built-in exercises use the dataset's `id`. My edits (muscle tags, favourites) are stored as overrides, not by modifying the dataset.
- **Call `navigator.storage.persist()` on startup.**
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
- **Dates:** `YYYY-MM-DD` strings for calendar days, full ISO timestamps for events. **Weeks run Monday–Sunday.**
- **IDs:** `crypto.randomUUID()`.
- **Security:** render any user-entered or imported text with `textContent`, never `innerHTML`.
- **Logic:** calculations live in pure functions in `js/logic/` and have tests.
- **Theme:** follows the system light/dark setting (`prefers-color-scheme`).
- **Design:** minimal but elegant. Generous spacing, one accent colour, clear type hierarchy, touch targets of at least 44 px. The most common actions are reachable with one thumb. Secondary information (like last session's numbers) is shown in muted grey, never in the way.
- **UI language:** English.

## Workflow
- Work through `SPEC.md` one item at a time, in phase order. Tick items off (`- [x]`) when done.
- For larger features, plan first. If a requirement is unclear, ask instead of guessing.
- Keep commits small and focused, with clear messages.
- **Every release bumps `APP_VERSION`,** defined in one place and used by both the service worker's cache name and the Settings screen. Otherwise the phone keeps serving the old version.
- When a decision is made that future sessions need to know, update this file (or `docs/DATA_MODEL.md` for data model details).

## Definition of done
- Works at 375 px width, in both light and dark mode.
- Works offline after a reload.
- Data from the previous version still loads (migration tested if the schema changed).
- Export → import round-trip still restores everything.
- No console errors, and logic tests pass.
