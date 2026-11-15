// The exercise library: merging the dataset with my custom exercises and
// overrides, then searching, filtering and sorting it. Pure module.
// See docs/DATA_MODEL.md, "exerciseOverrides and customExercises".

import { MUSCLES, groupById } from './muscles.js';
import { isDoneSet, isWorkingSet } from './sets.js';

export const CUSTOM_PREFIX = 'custom-';
export const isCustomId = (id) => typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);

/** Equipment values, as in the dataset, in the order the filter shows them. */
export const EQUIPMENT = [
  'barbell', 'dumbbell', 'body only', 'machine', 'cable', 'kettlebells', 'bands',
  'e-z curl bar', 'medicine ball', 'exercise ball', 'foam roll', 'other',
];

const EQUIPMENT_LABELS = {
  'body only': 'Bodyweight',
  'e-z curl bar': 'EZ curl bar',
};

export function equipmentLabel(key) {
  if (EQUIPMENT_LABELS[key]) return EQUIPMENT_LABELS[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : '';
}

/** The dataset leaves equipment empty for some exercises; those count as 'other'. */
function equipmentKey(value) {
  return EQUIPMENT.includes(value) ? value : 'other';
}

const cleanMuscles = (list) => (Array.isArray(list) ? list.filter((m) => MUSCLES.includes(m)) : []);

/**
 * One list of everything the app knows: (dataset + custom exercises) with my
 * overrides applied on top. Archived custom exercises are included (flagged),
 * so old workouts can still show their name.
 */
/** Photo paths as the dataset writes them: '<exercise id>/<n>.jpg'. Anything else is ignored. */
export function isImagePath(path) {
  return typeof path === 'string' && /^[A-Za-z0-9_.\-]+\/[0-9]+\.jpg$/.test(path) && !path.includes('..');
}

/** Where the app fetches a photo from (relative to the app's own folder). */
export function imageUrl(path) {
  return `./images/exercises/${path}`;
}

export function mergeExercises(dataset, customExercises = [], overrides = []) {
  const overrideById = new Map(overrides.map((o) => [o.exerciseId, o]));

  const build = (source, custom) => {
    const override = overrideById.get(source.id) || {};
    const datasetPrimary = cleanMuscles(source.primaryMuscles);
    const datasetSecondary = cleanMuscles(source.secondaryMuscles);
    const musclesEdited = Array.isArray(override.primaryMuscles) || Array.isArray(override.secondaryMuscles);
    return {
      id: source.id,
      name: source.name,
      equipment: equipmentKey(source.equipment),
      category: source.category || null,
      level: source.level || null,
      instructions: Array.isArray(source.instructions) ? source.instructions : [],
      images: !custom && Array.isArray(source.images) ? source.images.filter(isImagePath) : [],
      primaryMuscles: Array.isArray(override.primaryMuscles) ? cleanMuscles(override.primaryMuscles) : datasetPrimary,
      secondaryMuscles: Array.isArray(override.secondaryMuscles) ? cleanMuscles(override.secondaryMuscles) : datasetSecondary,
      originalPrimaryMuscles: datasetPrimary,
      originalSecondaryMuscles: datasetSecondary,
      musclesEdited,
      favourite: override.favourite === true,
      increment: typeof override.increment === 'number' ? override.increment : null,
      custom,
      archived: custom && Boolean(source.archivedAt),
    };
  };

  return [...dataset.map((e) => build(e, false)), ...customExercises.map((e) => build(e, true))];
}

/** Lower-case, accents removed, punctuation turned into spaces: '3/4 Sit-Up' → '3 4 sit up'. */
export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Filters the merged list.
 * - query: every word must appear somewhere in the name.
 * - group: a display group id; matches primary muscles, plus secondary if includeSecondary.
 * - equipment: list of equipment values; an exercise matches if it uses any of them.
 * - mineOnly: favourites and custom exercises.
 * Archived custom exercises are always left out.
 */
export function filterExercises(list, { query = '', group = null, includeSecondary = false, equipment = [], mineOnly = false } = {}) {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const groupMuscles = group ? (groupById(group)?.muscles ?? []) : null;
  const equipmentSet = new Set(equipment);

  return list.filter((exercise) => {
    if (exercise.archived) return false;
    if (mineOnly && !exercise.favourite && !exercise.custom) return false;
    if (equipmentSet.size && !equipmentSet.has(exercise.equipment)) return false;
    if (groupMuscles) {
      const muscles = includeSecondary ? [...exercise.primaryMuscles, ...exercise.secondaryMuscles] : exercise.primaryMuscles;
      if (!muscles.some((m) => groupMuscles.includes(m))) return false;
    }
    if (words.length) {
      const name = normalizeText(exercise.name);
      if (!words.every((word) => name.includes(word))) return false;
    }
    return true;
  });
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });

/**
 * Recently used exercises first (most recent on top), then everything else by name.
 * lastUsed: { exerciseId: 'YYYY-MM-DD' }.
 */
export function sortExercises(list, lastUsed = {}) {
  return [...list].sort((a, b) => {
    const usedA = lastUsed[a.id] || '';
    const usedB = lastUsed[b.id] || '';
    if (usedA !== usedB) return usedA < usedB ? 1 : -1; // later date first; '' (never) last
    return byName(a, b);
  });
}

/** { exerciseId: latest workout date } for every exercise with at least one done set. */
export function lastUsedByExercise(workouts) {
  const lastUsed = {};
  for (const workout of workouts) {
    for (const entry of workout.exercises || []) {
      if (!(entry.sets || []).some(isDoneSet)) continue;
      if (!lastUsed[entry.exerciseId] || workout.date > lastUsed[entry.exerciseId]) {
        lastUsed[entry.exerciseId] = workout.date;
      }
    }
  }
  return lastUsed;
}

/**
 * My history for one exercise: completed workouts, newest first, each with
 * its working sets. Sessions where only warm-ups were done are left out.
 */
export function exerciseHistory(workouts, exerciseId) {
  const sessions = [];
  for (const workout of workouts) {
    if (workout.status !== 'completed') continue;
    const sets = (workout.exercises || [])
      .filter((entry) => entry.exerciseId === exerciseId)
      .flatMap((entry) => entry.sets || [])
      .filter(isWorkingSet)
      .map((set) => ({ kg: set.kg, reps: set.reps }));
    if (sets.length) sessions.push({ workoutId: workout.id, date: workout.date, startedAt: workout.startedAt || '', sets });
  }
  sessions.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.startedAt < b.startedAt ? 1 : -1));
  return sessions.map(({ workoutId, date, sets }) => ({ workoutId, date, sets }));
}

/** True when an override record no longer says anything and can be deleted. */
export function overrideIsEmpty(override) {
  return (
    override.favourite !== true &&
    !Array.isArray(override.primaryMuscles) &&
    !Array.isArray(override.secondaryMuscles) &&
    typeof override.increment !== 'number'
  );
}

/**
 * Checks a muscle selection. A muscle is never both primary and secondary
 * (primary wins), and at least one primary muscle is required so the
 * exercise can count toward weekly volume.
 */
export function validateMuscles(primaryMuscles, secondaryMuscles) {
  const primary = MUSCLES.filter((m) => (primaryMuscles || []).includes(m));
  const secondary = MUSCLES.filter((m) => (secondaryMuscles || []).includes(m) && !primary.includes(m));
  if (!primary.length) return { ok: false, error: 'Choose at least one primary muscle.' };
  return { ok: true, primaryMuscles: primary, secondaryMuscles: secondary };
}

export const MAX_EXERCISE_NAME = 60;

/** Checks the fields of a custom exercise. Returns { ok, error } or { ok, value }. */
export function validateCustomExercise({ name, equipment, primaryMuscles, secondaryMuscles }) {
  const cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanName) return { ok: false, error: 'Give the exercise a name.' };
  if (cleanName.length > MAX_EXERCISE_NAME) return { ok: false, error: `Keep the name under ${MAX_EXERCISE_NAME} characters.` };
  if (!EQUIPMENT.includes(equipment)) return { ok: false, error: 'Choose the equipment.' };
  const muscles = validateMuscles(primaryMuscles, secondaryMuscles);
  if (!muscles.ok) return muscles;
  return {
    ok: true,
    value: { name: cleanName, equipment, primaryMuscles: muscles.primaryMuscles, secondaryMuscles: muscles.secondaryMuscles },
  };
}
