// Workouts: data access for logging, finishing, listing and deleting.
// The rules live in js/logic/workout.js; the record shape is in docs/DATA_MODEL.md.

import { db } from './db.js';
import { todayStr, startOfWeek, endOfWeek } from './logic/dates.js';
import { createWorkout, createEntry, createSet, completeWorkout, DEFAULT_SET_COUNT } from './logic/workout.js';

/** Fired on window when a workout is started, finished, discarded or deleted. */
export const WORKOUT_CHANGED = 'workout-changed';

export function notifyWorkoutChanged() {
  window.dispatchEvent(new Event(WORKOUT_CHANGED));
}

const nowIso = () => new Date().toISOString();

/** The workout in progress, or null. There is never more than one. */
export async function getActiveWorkout() {
  return (await db.getAllFromIndex('workouts', 'status', 'active'))[0] || null;
}

/** Starts an empty workout for today. If one is already in progress, that one is returned instead. */
export async function startWorkout() {
  const existing = await getActiveWorkout();
  if (existing) return existing;
  const workout = await db.saveWorkout(createWorkout({ id: crypto.randomUUID(), date: todayStr(), now: nowIso() }));
  notifyWorkoutChanged();
  return workout;
}

/** Saves a workout as it is (called on every change while logging). */
export function saveWorkout(workout) {
  workout.updatedAt = nowIso();
  return db.saveWorkout(workout);
}

export function getWorkout(id) {
  return db.get('workouts', id);
}

export function getAllWorkouts() {
  return db.getAll('workouts');
}

/** Completed workouts, newest first. */
export async function listCompletedWorkouts() {
  const completed = await db.getAllFromIndex('workouts', 'status', 'completed');
  return completed.sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.startedAt || '') < (b.startedAt || '') ? 1 : -1
  );
}

/** All workouts in the Monday–Sunday week of `dateStr`. */
export function getWeekWorkouts(dateStr) {
  return db.getAllFromIndex('workouts', 'date', { lower: startOfWeek(dateStr), upper: endOfWeek(dateStr) });
}

/**
 * Finishes a workout: unticked rows are removed and it becomes completed.
 * If nothing was ticked there is nothing to keep, so it is deleted and null
 * is returned. Otherwise returns the stored record.
 */
export async function finishWorkout(workout) {
  const finished = completeWorkout(workout, nowIso());
  if (!finished) {
    await db.remove('workouts', workout.id);
    notifyWorkoutChanged();
    return null;
  }
  finished.updatedAt = nowIso();
  const stored = await db.saveWorkout(finished);
  notifyWorkoutChanged();
  return stored;
}

/** Deletes a workout (in progress or completed) for good. */
export async function deleteWorkout(id) {
  await db.remove('workouts', id);
  notifyWorkoutChanged();
}

/** A new exercise entry with `setCount` empty rows. */
export function newEntry(exerciseId, setCount = DEFAULT_SET_COUNT) {
  return createEntry({
    id: crypto.randomUUID(),
    exerciseId,
    setIds: Array.from({ length: Math.max(1, setCount) }, () => crypto.randomUUID()),
  });
}

/** A new empty set row. */
export function newSet() {
  return createSet(crypto.randomUUID());
}

// After adding an exercise on the picker screen, the workout screen scrolls
// to it. The id is handed over through here.
let pendingScrollEntryId = null;
export function setPendingScroll(entryId) {
  pendingScrollEntryId = entryId;
}
export function takePendingScroll() {
  const id = pendingScrollEntryId;
  pendingScrollEntryId = null;
  return id;
}
