# data/

## exercises.json

A vendored, unmodified copy of `dist/exercises.json` from **free-exercise-db**.

- Source: https://github.com/yuhonas/free-exercise-db
- Commit: `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (27 September 2026)
- Licence: The Unlicense (public domain)
- SHA-256: `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`
- Contents: 876 exercises. Data only; no code from the dataset is used.

Each exercise has `id`, `name`, `equipment`, `primaryMuscles`, `secondaryMuscles`, `instructions`, `category`, `level`, `force`, `mechanic` and `images` (paths only; the image files are not vendored yet, see Phase 6).

## Rules

- **Never edit this file by hand.** My changes to exercises (muscle tags, favourites) are stored on the phone as overrides.
- **Exercise IDs must never disappear.** Logged sets refer to them forever. `tests/fixtures/exercise-ids.json` lists every ID that has ever shipped, and `tests/dataset.test.js` fails if one is missing.
- **To update the dataset:** replace the file with a newer `dist/exercises.json`, update the commit and checksum above, run `node --test tests/`, and add any new IDs to `tests/fixtures/exercise-ids.json`. If an ID was removed or renamed upstream, keep the old entry in the file.
