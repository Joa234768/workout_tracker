# SPEC.md — Features and roadmap

Tick items off (`- [x]`) as they're completed. Build in phase order. Each phase should end in something I can test on my iPhone.

**About me as a user:** a beginner, training 3× per week in a regular gym. I'm likely moving to a smaller gym with basic equipment in early 2027, so filtering by equipment and editing routines easily both matter.

---

## Phase 0 — Foundation
- [ ] PWA shell: `manifest.webmanifest`, app icons, `apple-touch-icon`, standalone mode, service worker caching the app shell for offline use.
- [ ] `APP_VERSION` shown in Settings. When a new version is waiting, show a small **"Update available — tap to reload"** banner.
- [ ] Bottom tab bar, always visible, thumb-friendly. Proposed tabs: **Today · Calendar · Progress · Exercises · Settings**. The plan may propose a better split.
- [ ] Theme follows the system light/dark setting.
- [ ] IndexedDB layer (`js/db.js`) with a versioned schema and a migration framework.
- [ ] Request persistent storage on startup.
- [ ] **Backup export:** a full JSON backup (all stores plus `schemaVersion`), saved via the share sheet → "Save to Files" (iCloud Drive). Filename: `workout-backup-YYYY-MM-DD.json`.
- [ ] **Backup import:** pick a file from the Files app, validate it, ask for confirmation (offering to export current data first), migrate if older, then restore.
- [ ] "Last backup: N days ago" shown under the backup button. A gentle reminder when it's been more than 14 days (interval adjustable).

## Phase 1 — Exercise library
- [ ] Vendor free-exercise-db's `exercises.json` into `data/`, noting the source commit. It's data only, with no code from the dataset.
- [ ] Browse and search exercises by name.
- [ ] **Filter by muscle group** with easy tap chips (primary muscle, with an option to include secondary). Also filter by equipment.
- [ ] **Favourites** (a star) plus a "My exercises" filter. Recently used exercises sort to the top.
- [ ] Exercise detail screen: muscles (primary/secondary), equipment, instructions from the dataset, and my history for that exercise.
- [ ] **Edit an exercise's muscle tags.** Stored as an override, so the dataset itself is never modified.
- [ ] Create custom exercises (name, equipment, primary/secondary muscles).

## Phase 2 — Logging workouts
- [ ] Start a workout: from a planned/routine workout, or as an empty workout.
- [ ] Per exercise, a list of set rows: **set # · kg · reps · warm-up toggle · done ✓**. A "+ Add set" button. A routine pre-fills the number of sets. Each set can have its own weight and reps (e.g. 10 kg × 10, 8 kg × 12, 6 kg × 10).
- [ ] **Last time's numbers, shown unobtrusively:**
  - A muted grey line under the exercise name, e.g. `Last · 12 Nov: 10×10 · 8×12 · 6×10`.
  - Last time's matching set appears as grey **placeholder text** in the kg/reps fields.
  - Tapping ✓ on an empty row accepts the placeholder values. "Copy previous set" fills a row with the set above it.
- [ ] Warm-up toggle per set. Warm-up sets are excluded from volume, e1RM and progression.
- [ ] Notes: per workout, per exercise and per set.
- [ ] Add, remove and reorder exercises during a workout.
- [ ] **An in-progress workout survives closing the app** (saved on every change). On reopening, the app resumes it.
- [ ] Optional **manual duration** field (typed in minutes). No running timer.
- [ ] **End-of-workout summary:** exercises and sets completed, total volume, muscle groups trained and how far this pushed each toward its weekly target, and a per-exercise comparison with last time.
- [ ] Workout history list. Open any past workout to **edit or delete** it.

## Phase 3 — Routines and calendar planning
- [ ] **Routines (templates):** a name (e.g. "Push day"), an ordered list of exercises, the number of sets per exercise, and an optional target rep range per exercise (default 8–12). Create, edit, duplicate and delete them.
- [ ] **Weekly plan:** map out training in advance, e.g. assign routines to weekdays (Mon = Push, Wed = Pull, Fri = Legs), or a rotation A/B/C over chosen training days.
- [ ] **Calendar month view** that navigates freely, **years ahead and back**. Each day shows: planned, completed, cancelled, or missed (planned but neither done nor cancelled).
  - Design hint: store the plan as a rule plus exceptions (moves, cancellations, one-off additions) instead of pre-generating years of entries. The plan phase decides.
- [ ] Tapping a planned day offers: **Start**, **Move to another date**, **Cancel**, or **Change routine** for that day.
- [ ] Add a one-off planned workout on any date. Log an unplanned workout on any day.
- [ ] The Today screen shows today's planned workout with a big Start button (or "Rest day", with an option to start a workout anyway).

## Phase 4 — Muscle volume
- [ ] **Weekly sets per muscle group** (Monday–Sunday), as progress bars toward a target. Counts only completed working sets.
- [ ] **Fractional counting by default:** primary muscle = 1 set, secondary = 0.5. A setting switches to "primary only" or "all muscles = 1".
- [ ] **Targets:** a **recommended baseline of 10 sets/week** for major muscle groups, shown as a marker on each bar. Each group's target is adjustable, and minor groups (e.g. forearms, neck, adductors/abductors) default to no target. The settings screen explains the baseline briefly (≈10 sets/week is a common starting point, research range ≈10–20).
- [ ] Muscle groups: the dataset's 17 muscles, possibly merged into display groups (e.g. lats + middle back → "Back"). Propose a grouping in the plan.
- [ ] **During a workout:** a compact indicator of which muscles this session is hitting, and how many sets so far.
- [ ] **Body map, front and back:** an original, simplified SVG made for this project. Each region maps to dataset muscles and is coloured by this week's sets relative to target. Tapping a region shows its set count and the exercises that contributed.
- [ ] Look back at previous weeks.

## Phase 5 — Progress and stats (Chart.js, vendored)
- [ ] Per-exercise charts: **estimated 1RM** (best per session), **top set weight**, **volume** (kg × reps over working sets).
  - e1RM uses the Epley formula: `weight × (1 + reps / 30)`, only for sets with reps ≤ 12, warm-ups excluded. A small info note explains that it's an estimate.
- [ ] Time range filters: 1 month · 3 months · 1 year · all.
- [ ] Tapping a chart point opens that workout.
- [ ] Training frequency: workouts per week over time, and planned vs. completed. No streaks.
- [ ] **Body weight log** with a chart and a 7-day moving average trend line.

## Phase 6 — Smart helpers and extras
- [ ] **Progression suggestions (double progression):** each routine exercise has a rep range (default 8–12) and a weight increment (default 2.5 kg, editable per exercise).
  - If all working sets last time reached the top of the range → suggest +increment and aim for the bottom of the range.
  - Otherwise → suggest the same weight and aim for one more rep.
  - If reps dropped below the range two sessions in a row → suggest keeping or reducing the weight.
  - Show it as a subtle muted hint (e.g. `Suggestion: 32.5 kg`). Never apply it automatically.
- [ ] **Warm-up set calculator:** from a working weight, suggest a sensible standard ramp (e.g. empty bar ×10, ~40% ×5, ~60% ×3, ~80% ×2), rounded to 2.5 kg, with an adjustable bar weight (default 20 kg). Available inside a workout, with a one-tap "add as warm-up sets".
- [ ] **CSV export** of all sets (date, exercise, set #, kg, reps, warm-up, notes).
- [ ] **Exercise images:** stored in the repo, downloaded only when an exercise is first opened, then cached for offline use. Never pre-cache the whole set.
- [ ] *(Optional, low priority)* Body measurements log (waist, arms and so on).

---

## Not now / maybe later
- Supersets.
- RPE/RIR per set (could become an optional field once I'm more experienced).
- **Food tracking and meal planning:** a likely future tab. Keep the architecture modular (separate stores and views per feature) so it can be added later without restructuring. It would probably use an open food database (e.g. Open Food Facts) with online lookup and caching of foods I use.

## Explicitly not wanted
- Rest timer / workout timer · plate calculator · 1RM calculator · PR celebrations · streaks · progress photos · keep-screen-awake.
