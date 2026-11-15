// Routines (workout templates). Pure module: ids and timestamps are passed in.
// The record shape is in docs/DATA_MODEL.md.

import { DEFAULT_REP_MIN, DEFAULT_REP_MAX, DEFAULT_SET_COUNT, createEntry } from './workout.js';

export const MAX_ROUTINE_NAME = 40;
export const MAX_ROUTINE_SETS = 10;
export const MAX_REPS = 100;

export function createRoutine({ id, name, now }) {
  return { id, name, exercises: [], archivedAt: null, createdAt: now, updatedAt: now };
}

/** An exercise line in a routine, with the defaults: 3 sets of 8–12. */
export function createRoutineExercise({ id, exerciseId }) {
  return { id, exerciseId, sets: DEFAULT_SET_COUNT, repMin: DEFAULT_REP_MIN, repMax: DEFAULT_REP_MAX };
}

/** A routine name as stored: trimmed, single spaces, never empty, at most 40 characters. */
export function cleanRoutineName(name, fallback = 'Routine') {
  const cleaned = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROUTINE_NAME).trim();
  return cleaned || fallback;
}

const clampInt = (value, min, max, fallback) => {
  if (value === null || value === undefined || value === '') return fallback; // an empty field means "the default"
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Sets and rep range as stored: whole numbers in range, with min never above max. */
export function cleanRoutineExercise(exercise) {
  const sets = clampInt(exercise.sets, 1, MAX_ROUTINE_SETS, DEFAULT_SET_COUNT);
  let repMin = clampInt(exercise.repMin, 1, MAX_REPS, DEFAULT_REP_MIN);
  let repMax = clampInt(exercise.repMax, 1, MAX_REPS, DEFAULT_REP_MAX);
  if (repMin > repMax) [repMin, repMax] = [repMax, repMin];
  return { ...exercise, sets, repMin, repMax };
}

/** A copy of a routine with new ids and "copy" added to the name. */
export function duplicateRoutine(routine, { id, exerciseIds, now }) {
  return {
    ...routine,
    id,
    name: cleanRoutineName(`${routine.name} copy`),
    exercises: routine.exercises.map((exercise, i) => ({ ...exercise, id: exerciseIds[i] })),
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The exercise entries a workout starts with when begun from a routine: one
 * per routine exercise, with the routine's number of empty rows and its rep
 * range as a snapshot. newId() must return a fresh id each call.
 */
export function entriesFromRoutine(routine, newId) {
  return routine.exercises.map((exercise) => {
    const clean = cleanRoutineExercise(exercise);
    return createEntry({
      id: newId(),
      exerciseId: clean.exerciseId,
      setIds: Array.from({ length: clean.sets }, () => newId()),
      repMin: clean.repMin,
      repMax: clean.repMax,
    });
  });
}

/** '5 exercises · 15 sets'. */
export function routineSummary(routine) {
  const count = routine.exercises.length;
  const sets = routine.exercises.reduce((n, exercise) => n + (Number(exercise.sets) || 0), 0);
  return `${count} ${count === 1 ? 'exercise' : 'exercises'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`;
}
