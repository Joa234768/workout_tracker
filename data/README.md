# data/

## exercises.json

A vendored, unmodified copy of `dist/exercises.json` from **free-exercise-db**.

- Source: https://github.com/yuhonas/free-exercise-db
- Commit: `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (27 September 2026)
- Licence: The Unlicense (public domain)
- SHA-256: `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`
- Contents: 876 exercises. Data only; no code from the dataset is used.

Each exercise has `id`, `name`, `equipment`, `primaryMuscles`, `secondaryMuscles`, `instructions`, `category`, `level`, `force`, `mechanic` and `images` (paths such as `Barbell_Squat/0.jpg`; the files are in `images/exercises/`, see below).

## Exercise photos (`images/exercises/`)

- The same commit of free-exercise-db, folder `exercises/`: 1,746 photos, two per exercise (start and end position). Licence: The Unlicense (public domain).
- **Not the original files:** they are shrunk from 850 px to 640 px wide and re-saved as JPEG (quality 72) by `tools/make_images.py`, which takes them from 99 MB to 57 MB. Nothing else is changed.
- The app never downloads them all. A photo is fetched the first time its exercise is opened and then kept on the phone.
- `tests/dataset.test.js` fails if a photo listed in `exercises.json` is missing.
- **To regenerate** (only after updating the dataset): download `https://codeload.github.com/yuhonas/free-exercise-db/tar.gz/<commit>` and run `py tools/make_images.py <that file>`. It needs Pillow on this PC (`py -m pip install pillow`); the app itself still has no dependencies.

## Rules

- **Never edit this file by hand.** My changes to exercises (muscle tags, favourites) are stored on the phone as overrides.
- **Exercise IDs must never disappear.** Logged sets refer to them forever. `tests/fixtures/exercise-ids.json` lists every ID that has ever shipped, and `tests/dataset.test.js` fails if one is missing.
- **To update the dataset:** replace the file with a newer `dist/exercises.json`, update the commit and checksum above, run `node --test tests/`, and add any new IDs to `tests/fixtures/exercise-ids.json`. If an ID was removed or renamed upstream, keep the old entry in the file.
