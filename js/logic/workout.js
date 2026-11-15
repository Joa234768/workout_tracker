// Rules for a workout while it is being logged or edited. Pure module: ids
// and timestamps are passed in. The record shape is in docs/DATA_MODEL.md.

import { isDoneSet, isWorkingSet, setVolume } from './sets.js';
import { exerciseHistory } from './exercises.js';

export const DEFAULT_REP_MIN = 8;
export const DEFAULT_REP_MAX = 12;
/** Rows a newly added exercise starts with when there is no "last time" to copy the count from. */
export const DEFAULT_SET_COUNT = 3;

/** A new in-progress workout. */
export function createWorkout({ id, date, now }) {
  return {
    id,
    status: 'active',
    date,
    startedAt: now,
    finishedAt: null,
    durationMin: null,
    notes: '',
    routineId: null,
    routineName: null,
    plannedRef: null,
    exerciseIds: [],
    exercises: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** An empty set row. */
export function createSet(id) {
  return { id, kg: null, reps: null, warmup: false, done: false, doneAt: null };
}

/** An exercise in a workout, with one empty row per id in setIds. */
export function createEntry({ id, exerciseId, setIds, repMin = DEFAULT_REP_MIN, repMax = DEFAULT_REP_MAX }) {
  return { id, exerciseId, repMin, repMax, sets: setIds.map(createSet) };
}

/** The exercise ids used by a workout, without duplicates. Stored on the record for the index. */
export function deriveExerciseIds(workout) {
  return [...new Set((workout.exercises || []).map((entry) => entry.exerciseId))];
}

/** What each row shows as its number: warm-ups are 'W', the rest count 1, 2, 3. */
export function setLabels(sets) {
  let number = 0;
  return sets.map((set) => (set.warmup ? 'W' : String(++number)));
}

/**
 * Last time's matching set for every row, or null. Rows are matched by
 * position among the non-warm-up rows; warm-up rows get nothing.
 * lastSets: last session's working sets, [{ kg, reps }].
 */
export function placeholdersFor(sets, lastSets = []) {
  let position = 0;
  return sets.map((set) => (set.warmup ? null : lastSets[position++] || null));
}

/**
 * What tapping ✓ on a row does. Returns { set, result }:
 * - 'undone'    the row was ticked; it is now unticked (values kept)
 * - 'done'      ticked, with empty fields filled from last time's matching set
 * - 'need-kg'   nothing typed and no "last time": the kg field should get focus
 * - 'need-reps' reps are missing: the reps field should get focus
 * A row with reps but no weight and no "last time" counts as bodyweight (0 kg).
 */
export function tickSet(set, placeholder, now) {
  if (set.done) return { set: { ...set, done: false, doneAt: null }, result: 'undone' };
  const kg = set.kg ?? (placeholder ? placeholder.kg : null);
  const reps = set.reps ?? (placeholder ? placeholder.reps : null);
  if (!(reps > 0)) {
    const nothingToGoOn = set.kg === null && set.reps === null && !placeholder;
    return { set, result: nothingToGoOn ? 'need-kg' : 'need-reps' };
  }
  return { set: { ...set, kg: kg ?? 0, reps, done: true, doneAt: now }, result: 'done' };
}

/** "Copy previous set": the row at `index` takes the weight and reps of the row above it. */
export function copyFromAbove(sets, index) {
  if (index <= 0 || index >= sets.length) return sets;
  const above = sets[index - 1];
  return sets.map((set, i) => (i === index ? { ...set, kg: above.kg, reps: above.reps } : set));
}

/** A copy of `list` with the item at `index` moved by `delta` places (ignored at the ends). */
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

/** How many rows are not ticked. Finishing removes them, after a confirmation. */
export function untickedCount(workout) {
  return (workout.exercises || []).reduce((n, entry) => n + entry.sets.filter((set) => !isDoneSet(set)).length, 0);
}

/** The workout with only its ticked sets; exercises left without any are removed. */
export function pruneWorkout(workout) {
  const exercises = (workout.exercises || [])
    .map((entry) => ({ ...entry, sets: entry.sets.filter(isDoneSet) }))
    .filter((entry) => entry.sets.length > 0);
  return { ...workout, exercises, exerciseIds: deriveExerciseIds({ exercises }) };
}

/**
 * Finishes a workout: prunes it and marks it completed. Returns null when
 * nothing was ticked (there is nothing to keep). An already completed
 * workout keeps its original finishedAt.
 */
export function completeWorkout(workout, now) {
  const pruned = pruneWorkout(workout);
  if (!pruned.exercises.length) return null;
  return { ...pruned, status: 'completed', finishedAt: workout.finishedAt || now };
}

/** Totals for the summary: exercises and working sets done, warm-ups, reps and volume (kg × reps). */
export function workoutStats(workout) {
  const stats = { exercises: 0, sets: 0, warmups: 0, reps: 0, volume: 0 };
  for (const entry of workout.exercises || []) {
    const working = entry.sets.filter(isWorkingSet);
    if (working.length) stats.exercises += 1;
    stats.sets += working.length;
    stats.warmups += entry.sets.filter((set) => isDoneSet(set) && set.warmup).length;
    for (const set of working) {
      stats.reps += set.reps;
      stats.volume += setVolume(set);
    }
  }
  return stats;
}

const startedBefore = (a, b) =>
  a.date < b.date || (a.date === b.date && (a.startedAt || '') < (b.startedAt || ''));

/**
 * "Last time" for an exercise, seen from `current` workout: the most recent
 * completed workout before it that has working sets of the exercise.
 * Returns { workoutId, date, sets: [{ kg, reps }] } or null.
 */
export function lastSessionBefore(workouts, exerciseId, current) {
  const earlier = workouts.filter((w) => w.id !== current.id && startedBefore(w, current));
  return exerciseHistory(earlier, exerciseId)[0] || null;
}

/**
 * The latest `count` sessions of an exercise before `current`, newest first:
 * [{ workoutId, date, sets }]. Used for progression suggestions.
 */
export function sessionsBefore(workouts, exerciseId, current, count = 2) {
  const earlier = workouts.filter((w) => w.id !== current.id && startedBefore(w, current));
  return exerciseHistory(earlier, exerciseId).slice(0, count);
}

/**
 * Compares this session's working sets with last time's.
 * - kind 'first':  no last time
 * - kind 'volume': both have weight; now/last/delta are kg × reps
 * - kind 'reps':   bodyweight on either side; now/last/delta are total reps
 */
export function compareSessions(nowSets, lastSets) {
  if (!lastSets || !lastSets.length) return { kind: 'first', now: null, last: null, delta: null };
  const volume = (sets) => sets.reduce((sum, set) => sum + setVolume(set), 0);
  const reps = (sets) => sets.reduce((sum, set) => sum + (set.reps || 0), 0);
  const [volumeNow, volumeLast] = [volume(nowSets), volume(lastSets)];
  if (volumeNow > 0 && volumeLast > 0) {
    return { kind: 'volume', now: volumeNow, last: volumeLast, delta: volumeNow - volumeLast };
  }
  return { kind: 'reps', now: reps(nowSets), last: reps(lastSets), delta: reps(nowSets) - reps(lastSets) };
}
