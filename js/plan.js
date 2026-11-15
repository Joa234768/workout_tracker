// Routines and the calendar plan: data access. The rules live in
// js/logic/plan.js and js/logic/routines.js; shapes are in docs/DATA_MODEL.md.

import { db } from './db.js';
import { todayStr } from './logic/dates.js';
import { planChange, applyExceptionChange, routineUsage } from './logic/plan.js';
import {
  createRoutine, createRoutineExercise, cleanRoutineName, cleanRoutineExercise, duplicateRoutine,
} from './logic/routines.js';

/** Fired on window when routines or the plan change. */
export const PLAN_CHANGED = 'plan-changed';
const notify = () => window.dispatchEvent(new Event(PLAN_CHANGED));
const nowIso = () => new Date().toISOString();

/** Everything the calendar needs, in one read. `routines` includes archived ones (for old names). */
export async function loadPlanData() {
  const [rules, exceptions, oneOffs, routines, workouts] = await Promise.all([
    db.getAll('planRules'),
    db.getAll('planExceptions'),
    db.getAll('plannedOneOffs'),
    db.getAll('routines'),
    db.getAll('workouts'),
  ]);
  return { rules, exceptions, oneOffs, routines, workouts };
}

// ----- Routines -----

/** Routines that can be chosen (not archived), by name. */
export async function listRoutines() {
  const routines = (await db.getAll('routines')).filter((routine) => !routine.archivedAt);
  return routines.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' }));
}

export function getRoutine(id) {
  return db.get('routines', id);
}

/** Creates an empty routine and returns it. */
export async function createNewRoutine(name = 'New routine') {
  const routine = createRoutine({ id: crypto.randomUUID(), name: cleanRoutineName(name), now: nowIso() });
  await db.put('routines', routine);
  notify();
  return routine;
}

/** Saves a routine as edited (called on every change). Values are tidied on the way in. */
export async function saveRoutine(routine) {
  const record = {
    ...routine,
    name: cleanRoutineName(routine.name),
    exercises: routine.exercises.map(cleanRoutineExercise),
    updatedAt: nowIso(),
  };
  await db.put('routines', record);
  notify();
  return record;
}

/** A new exercise line for a routine: 3 sets of 8–12. */
export function newRoutineExercise(exerciseId) {
  return createRoutineExercise({ id: crypto.randomUUID(), exerciseId });
}

/** Copies a routine ("… copy") and returns the copy. */
export async function copyRoutine(id) {
  const routine = await db.get('routines', id);
  if (!routine) throw new Error('This routine no longer exists.');
  const copy = duplicateRoutine(routine, {
    id: crypto.randomUUID(),
    exerciseIds: routine.exercises.map(() => crypto.randomUUID()),
    now: nowIso(),
  });
  await db.put('routines', copy);
  notify();
  return copy;
}

/**
 * Deletes a routine. Returns:
 * - 'in-plan'  it is part of the current or a future weekly plan; nothing was changed
 * - 'archived' something refers to it (an old plan, a planned day, a workout), so it is
 *              hidden but kept, and old calendar days can still name it
 * - 'deleted'  nothing referred to it
 */
export async function deleteRoutine(id) {
  const routine = await db.get('routines', id);
  if (!routine) return 'deleted';
  const usage = routineUsage(id, { ...(await loadPlanData()), today: todayStr() });
  if (usage.inPlan) return 'in-plan';
  if (usage.referenced) {
    await db.put('routines', { ...routine, archivedAt: nowIso(), updatedAt: nowIso() });
    notify();
    return 'archived';
  }
  await db.remove('routines', id);
  notify();
  return 'deleted';
}

// ----- The weekly plan -----

/** The plan version running on a date (default today), or null. */
export async function getCurrentRule(date = todayStr()) {
  const rules = await db.getAll('planRules');
  return rules.find((rule) => rule.startDate <= date && (rule.endDate == null || date <= rule.endDate)) || null;
}

/**
 * Starts a new plan from `fromDate` (rule: { type, … } from validatePlan), or
 * stops planning from that date when rule is null. Earlier days keep the plan
 * they had. All changes are written together.
 */
export async function changePlan(rule, fromDate) {
  const rules = await db.getAll('planRules');
  const { put, remove } = planChange(rules, rule ? { id: crypto.randomUUID(), ...rule } : null, fromDate);
  await db.batch([
    ...remove.map((id) => ({ store: 'planRules', remove: id })),
    ...put.map((record) => ({ store: 'planRules', put: record })),
  ]);
  notify();
}

// ----- Single days -----

// Applies a change to one rule occurrence: cancel, move, change routine, or undo those.
async function changeOccurrence(originalDate, change) {
  const existing = (await db.getAllFromIndex('planExceptions', 'originalDate', originalDate))[0] || null;
  const next = applyExceptionChange(existing, originalDate, change, crypto.randomUUID());
  if (next) await db.put('planExceptions', next);
  else if (existing) await db.remove('planExceptions', existing.id);
  notify();
}

async function changeOneOff(id, change) {
  const oneOff = await db.get('plannedOneOffs', id);
  if (!oneOff) return;
  await db.put('plannedOneOffs', { ...oneOff, ...change });
  notify();
}

/** Cancels a planned occurrence (see occurrencesInRange for the occurrence shape). */
export function cancelOccurrence(occurrence) {
  return occurrence.kind === 'oneoff'
    ? changeOneOff(occurrence.oneOffId, { cancelled: true })
    : changeOccurrence(occurrence.originalDate, { cancelled: true });
}

/** Un-cancels a cancelled occurrence. */
export function restoreOccurrence(occurrence) {
  return occurrence.kind === 'oneoff'
    ? changeOneOff(occurrence.oneOffId, { cancelled: false })
    : changeOccurrence(occurrence.originalDate, { cancelled: false });
}

/** Moves an occurrence to another date. */
export function moveOccurrence(occurrence, toDate) {
  return occurrence.kind === 'oneoff'
    ? changeOneOff(occurrence.oneOffId, { date: toDate })
    : changeOccurrence(occurrence.originalDate, { movedTo: toDate });
}

/** Uses another routine for one occurrence only (null for a one-off means "no routine"). */
export function changeOccurrenceRoutine(occurrence, routineId) {
  return occurrence.kind === 'oneoff'
    ? changeOneOff(occurrence.oneOffId, { routineId: routineId || null })
    : changeOccurrence(occurrence.originalDate, { routineId });
}

/** Plans a single workout on a date, outside the weekly plan. */
export async function addOneOff(date, routineId = null) {
  const oneOff = { id: crypto.randomUUID(), date, routineId: routineId || null, cancelled: false };
  await db.put('plannedOneOffs', oneOff);
  notify();
  return oneOff;
}

/** Removes a one-off planned workout altogether. */
export async function deleteOneOff(id) {
  await db.remove('plannedOneOffs', id);
  notify();
}
