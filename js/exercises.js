// The exercise library's data access: loads the dataset, merges it with my
// custom exercises and overrides from the database, and saves my changes.
// The rules (merging, filtering, validation) live in js/logic/exercises.js.

import { db } from './db.js';
import {
  CUSTOM_PREFIX, isCustomId, mergeExercises, lastUsedByExercise, exerciseHistory,
  overrideIsEmpty, validateMuscles, validateCustomExercise,
} from './logic/exercises.js';
import { DEFAULT_INCREMENT } from './logic/helpers.js';

let datasetPromise = null;

/** The built-in exercises. Fetched once (the service worker serves it offline), never copied into the database. */
export function loadDataset() {
  if (!datasetPromise) {
    datasetPromise = fetch('./data/exercises.json')
      .then((response) => {
        if (!response.ok) throw new Error(`The exercise list could not be loaded (${response.status}).`);
        return response.json();
      })
      .catch((err) => {
        datasetPromise = null; // allow a retry
        throw err;
      });
  }
  return datasetPromise;
}

/** Every exercise (built-in and custom, archived ones flagged) with my overrides applied. */
export async function getLibrary() {
  const [dataset, custom, overrides] = await Promise.all([
    loadDataset(),
    db.getAll('customExercises'),
    db.getAll('exerciseOverrides'),
  ]);
  return mergeExercises(dataset, custom, overrides);
}

/** One merged exercise, or null if the id is unknown. */
export async function getExercise(id) {
  return (await getLibrary()).find((exercise) => exercise.id === id) || null;
}

/** { exerciseId: latest date used }, for sorting recently used exercises to the top. */
export async function getLastUsed() {
  return lastUsedByExercise(await db.getAll('workouts'));
}

/** My logged sessions of one exercise, newest first. */
export async function getExerciseHistory(id) {
  return exerciseHistory(await db.getAllFromIndex('workouts', 'exerciseIds', id), id);
}

// Reads the override for an exercise, lets `change` modify it, and saves it.
// An override that no longer says anything is deleted instead of kept empty.
async function updateOverride(exerciseId, change) {
  const override = (await db.get('exerciseOverrides', exerciseId)) || { exerciseId };
  change(override);
  if (overrideIsEmpty(override)) {
    await db.remove('exerciseOverrides', exerciseId);
    return;
  }
  override.updatedAt = new Date().toISOString();
  await db.put('exerciseOverrides', override);
}

export function setFavourite(exerciseId, favourite) {
  return updateOverride(exerciseId, (override) => {
    if (favourite) override.favourite = true;
    else delete override.favourite;
  });
}

/**
 * Sets the weight step used for progression suggestions on one exercise.
 * The default step is not stored, so the override disappears again.
 */
export function setIncrement(exerciseId, kg) {
  return updateOverride(exerciseId, (override) => {
    if (typeof kg === 'number' && kg > 0 && kg !== DEFAULT_INCREMENT) override.increment = kg;
    else delete override.increment;
  });
}

/** Stores my muscle tags for an exercise as an override. Throws with a message for the user if invalid. */
export async function saveMuscleOverride(exerciseId, primaryMuscles, secondaryMuscles) {
  const checked = validateMuscles(primaryMuscles, secondaryMuscles);
  if (!checked.ok) throw new Error(checked.error);
  await updateOverride(exerciseId, (override) => {
    override.primaryMuscles = checked.primaryMuscles;
    override.secondaryMuscles = checked.secondaryMuscles;
  });
}

/** Removes my muscle tags, so the exercise uses the dataset's again. */
export function resetMuscleOverride(exerciseId) {
  return updateOverride(exerciseId, (override) => {
    delete override.primaryMuscles;
    delete override.secondaryMuscles;
  });
}

/**
 * Creates a custom exercise, or updates the one with `existingId`.
 * Returns its id. Throws with a message for the user if the input is invalid.
 */
export async function saveCustomExercise(input, existingId = null) {
  const checked = validateCustomExercise(input);
  if (!checked.ok) throw new Error(checked.error);
  const now = new Date().toISOString();
  const existing = existingId ? await db.get('customExercises', existingId) : null;
  if (existingId && !existing) throw new Error('This exercise no longer exists.');
  const record = existing
    ? { ...existing, ...checked.value, updatedAt: now }
    : { id: `${CUSTOM_PREFIX}${crypto.randomUUID()}`, ...checked.value, archivedAt: null, createdAt: now, updatedAt: now };
  await db.put('customExercises', record);
  return record.id;
}

/**
 * Removes a custom exercise from the library. If any workout refers to it, it
 * is archived (hidden, but old workouts keep its name); otherwise it is
 * deleted along with its override. Returns 'archived' or 'deleted'.
 */
export async function deleteCustomExercise(id) {
  if (!isCustomId(id)) throw new Error('Only custom exercises can be deleted.');
  const record = await db.get('customExercises', id);
  if (!record) return 'deleted';
  const used = (await db.getAllFromIndex('workouts', 'exerciseIds', id)).length > 0;
  if (used) {
    await db.put('customExercises', { ...record, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return 'archived';
  }
  await db.remove('customExercises', id);
  await db.remove('exerciseOverrides', id);
  return 'deleted';
}
