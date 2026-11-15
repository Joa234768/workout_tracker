# Data model

The single source of truth for what the app stores, how backups look, and the decisions behind them. The code version of the store list is `js/logic/schema.js`; keep the two in step.

**Ask before changing the schema.** Every change bumps `SCHEMA_VERSION`, ships a migration step, adds a fixture backup of the old version to `tests/fixtures/`, and updates this file.

## Rules for every store

- Database name: `workout-tracker`. Current schema version: **1**.
- Records hold JSON-safe values only: strings, numbers, booleans, `null`, arrays, plain objects. No `Date` or `Blob` objects. This is what makes export → import exact.
- IDs come from `crypto.randomUUID()`.
- Calendar days are **stored** as local `YYYY-MM-DD` strings and **displayed** as `DD-MM-YYYY` (`formatDate()` in `js/logic/dates.js`). The stored order must not change: IndexedDB sorts and range-searches these strings as text.
- Events are full ISO timestamps.
- Weights are kg, stored as numbers.

## Stores

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `settings` | `key` | none | Key/value preferences |
| `workouts` | `id` | `date`, `status`, `exerciseIds` (multiEntry), `plannedRef` | Every workout, including the in-progress one |
| `routines` | `id` | none | Templates |
| `planRules` | `id` | `startDate` | The weekly plan, as dated rule versions |
| `planExceptions` | `id` | `originalDate` (unique), `movedTo` | Changes to single rule occurrences |
| `plannedOneOffs` | `id` | `date` | One-off planned workouts |
| `exerciseOverrides` | `exerciseId` | none | My edits to any exercise |
| `customExercises` | `id` | none | Exercises I create |
| `bodyWeights` | `date` | none | One body-weight entry per day |

All nine stores exist from version 1, although Phase 0 only uses `settings`.

### settings

`{ key, value }`. Defaults live in code (`SETTING_DEFAULTS` in `js/logic/schema.js`); a key is only stored once it is changed.

| Key | Default | Used from |
|---|---|---|
| `lastBackupAt` | `null` (ISO timestamp) | Phase 0 |
| `backupReminderDays` | `14` | Phase 0 |
| `volumeCounting` | `'fractional'` (or `'primary'`, `'all'`) | Phase 4 |
| `muscleTargets` | `{ groupId: number or null }` | Phase 4 |
| `barWeight` | `20` | Phase 6 |

### workouts

```js
{
  id,
  status: 'active' | 'completed',
  date: '2026-11-16',            // the day this workout counts for; editable
  startedAt, finishedAt,         // ISO; finishedAt is null while active
  durationMin: 55 | null,        // typed manually
  notes: '',
  routineId: '…' | null,
  routineName: 'Push day' | null,   // snapshot, survives routine edits
  plannedRef: 'rule:2026-11-16' | 'oneoff:<id>' | null,   // the planned occurrence this fulfils
  exerciseIds: ['Barbell_Squat', …],   // derived from exercises[] by db.js on every save
  exercises: [
    { id, exerciseId, repMin: 8, repMax: 12,    // rep range snapshot from the routine
      sets: [ { id, kg: 12.5, reps: 10, warmup: false, done: true, doneAt } ] }
  ],
  createdAt, updatedAt
}
```

- **Sets are embedded in the workout.** "Save on every change" is one atomic write, and set order is array order.
- **The in-progress workout is a normal record with `status: 'active'`.** Finishing flips the status. `db.js` enforces at most one active workout; startup finds it through the `status` index and resumes it.
- Finishing discards rows that are not ticked, after a confirmation.
- Editing a past workout edits the same record in place.
- `kg` and `reps` are numbers, or `null` while a row is empty. For bodyweight exercises `kg` is 0 or the added weight.
- Two workouts on the same date are allowed.

### routines

```js
{ id, name: 'Push day',
  exercises: [ { id, exerciseId, sets: 3, repMin: 8, repMax: 12 } ],
  archivedAt: null, createdAt, updatedAt }
```

Deleting a routine that a plan rule or workout refers to archives it instead, so old calendar days can still name it. The weight increment is not stored here; it is per exercise in `exerciseOverrides`.

### Calendar plan: a rule plus exceptions

Nothing is pre-generated. Rules carry date ranges so past days remember what the plan was then. Changing the plan closes the current rule and starts a new one.

**`planRules`** — one record per version of the weekly plan. Ranges never overlap.

```js
{ id, startDate: '2026-11-16', endDate: null,   // endDate inclusive; null = open-ended
  type: 'weekly',   days: { 1: routineIdA, 3: routineIdB, 5: routineIdC } }   // 1 = Monday … 7 = Sunday

{ id, startDate, endDate,
  type: 'rotation', weekdays: [1, 3, 5], routineIds: [A, B, C], offset: 0 }
```

For a rotation, the routine on a date is found by counting training-day slots since `startDate`: `routineIds[(slots + offset) % length]`. The rotation is **fixed to the calendar**: a missed workout does not shift later ones. Catching up is done with Move or Change routine.

**`planExceptions`** — at most one record per rule occurrence that deviates. It covers Cancel, Move and Change routine.

```js
{ id, originalDate: '2026-11-18', cancelled: false, movedTo: '2026-11-19' | null, routineId: '…' | null }
```

The `movedTo` index finds workouts moved into the visible month from outside it.

**`plannedOneOffs`** — one-off planned workouts. Moving one just edits its `date`.

```js
{ id, date: '2026-11-21', routineId: '…' | null, cancelled: false }
```

### exerciseOverrides and customExercises

Built-in exercises are read from `data/exercises.json` and never copied into IndexedDB.

```js
// exerciseOverrides — keyed by exerciseId, built-in or custom; only present fields apply
{ exerciseId: 'Barbell_Squat', favourite: true,
  primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes'],
  increment: 2.5, updatedAt }

// customExercises — same field names as the dataset
{ id: 'custom-<uuid>', name, equipment, primaryMuscles: [], secondaryMuscles: [],
  archivedAt: null, createdAt, updatedAt }
```

- The app sees one merged view: (dataset + custom exercises) with overrides applied on top.
- The `custom-` prefix means a custom ID can never collide with a dataset ID.
- Custom exercises used by a logged set are archived, never deleted.
- One weight `increment` per exercise (default 2.5), shared across routines. The rep range is per routine exercise.
- "Recently used" is computed from workouts, not stored: the latest date with a ticked set, the in-progress workout included.
- **"My exercises"** in the library means favourites plus custom exercises.
- An override record that no longer says anything (not a favourite, no muscle tags, no increment) is deleted instead of kept empty.
- Muscle tags always have at least one primary muscle, and a muscle is never both primary and secondary.
- Built-in exercises get their muscle tags edited as an override; a custom exercise is edited as a whole (name, equipment, muscles) in its own record.
- Deleting a custom exercise deletes the record and its override, unless a workout refers to it; then it is archived.
- The dataset leaves `equipment` empty for 77 exercises. The app treats those as `other`. Nothing is written back to the dataset.

### bodyWeights

`{ date: '2026-11-16', kg: 78.4, updatedAt }`. One entry per day; a second entry that day replaces the first.

## Migrations

`js/logic/schema.js` holds `SCHEMA_VERSION`, the declarative store/index list (`STORES`), and an ordered list of migration steps (`MIGRATIONS`). A step looks like:

```js
{ from: 1, to: 2,
  dropStores: [],                       // optional; the only way a store is ever removed
  migrate(snapshot) { return snapshot; } }   // { storeName: records[] } in, next version's snapshot out
```

Steps are pure functions, so the same ones serve both paths:

- **Database upgrade.** Inside the `onupgradeneeded` transaction, `db.js` reads every store into a snapshot, runs the pending steps, creates missing stores and indexes, and rewrites the stores that changed. If anything throws, the transaction aborts and the database stays at the old version with its data intact.
- **Backup import.** The same steps run on the backup's `stores` object before it is written.

Safety around upgrades:

- Before an upgrade, `db.js` copies the current data into a second database, `workout-tracker-premigration` (one record holding the old `schemaVersion` and all stores). It stays until the next upgrade, and Settings can export it as a normal backup file.
- Each schema bump adds a fixture backup of the old version to `tests/fixtures/`, plus a Node test that migrates it. Fixtures are kept forever.
- A step never drops a store or field unless it says so explicitly and the change was approved.

## Backup format

```json
{
  "app": "workout-tracker",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "exportedAt": "2026-11-15T10:00:00.000Z",
  "stores": {
    "settings": [], "workouts": [], "routines": [], "planRules": [], "planExceptions": [],
    "plannedOneOffs": [], "exerciseOverrides": [], "customExercises": [], "bodyWeights": []
  }
}
```

Filename: `workout-backup-DD-MM-YYYY.json`. Dates inside the file stay `YYYY-MM-DD`.

- **Export** loops over the database's actual store list, so a store added later is included automatically.
- **Import** validates the file, refuses a backup newer than the app ("Update the app first"), asks for confirmation (offering to export current data first), migrates an older backup, refuses unknown stores, treats a missing store as empty, then replaces every store in one transaction. Any failure aborts it and leaves the current data untouched.
- After an import, `lastBackupAt` is set to the backup's `exportedAt`, since the data now matches a backup of that age. This is the only value an import changes.
- `lastBackupAt` is set on export only when the share completes; cancelling the share sheet does not count.
- The backup reminder shows when the last backup is more than `backupReminderDays` old, or when there has never been a backup and any store other than `settings` holds data.

Checks: `tests/backup.test.js` and `tests/schema.test.js` (Node), and the self-check page `tests/browser/` which round-trips every store in a scratch database in a real browser.

## Derived values (not stored)

A **working set** is a set with `done === true`, `warmup === false` and `reps > 0`.

- **Weekly muscle volume (Phase 4).** Workouts of the Monday–Sunday week via the `date` index. Each working set's muscles are weighted by `volumeCounting` (`fractional`: primary 1, secondary 0.5; `primary`: 1 / 0; `all`: 1 / 1), rolled up into display groups, with one set adding at most 1 to a group. Ticked sets in the in-progress workout count immediately. History is computed from current muscle tags.
- **e1RM, top set, volume (Phase 5).** Via the `exerciseIds` index. e1RM per set is `kg × (1 + reps / 30)` for working sets with `reps ≤ 12` and `kg > 0`; best per completed workout. Bodyweight exercises (all `kg` = 0) chart reps instead.
- **Progression (Phase 6).** From the last two completed workouts containing the exercise, the `repMin`/`repMax` snapshot and the exercise's `increment`. With mixed weights, the heaviest working weight is judged.
- **Calendar states (Phase 3).** Rule occurrences + exceptions + one-offs, then: *completed* (a completed workout has the occurrence's `plannedRef`, or any completed workout exists on its date), *cancelled*, *missed* (before today, neither completed nor cancelled), *planned*. Nothing is generated before the first rule's `startDate`.

## Muscle groups (Phase 4)

16 display groups from the dataset's 17 muscles; only lats and middle back merge into **Back**.

- Default target 10 sets/week: Chest, Back, Shoulders, Biceps, Triceps, Quads, Hamstrings, Glutes, Abs, Calves.
- No default target: Traps, Lower back, Forearms, Adductors, Abductors, Neck (shown under "More"; giving one a target promotes it).

## Smaller decisions for later phases

- ✓ on an empty row with no "last time" focuses the kg field instead of saving an empty set. (Phase 2)
- Moving a workout onto a day that already has one is allowed. (Phase 3)
- CSV export repeats the workout note on every set row. (Phase 6)
- Exercise images: decided in Phase 6.
