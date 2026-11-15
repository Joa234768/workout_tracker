// Sets per muscle group. Pure module. See docs/DATA_MODEL.md, "Derived values".
//
// Only working sets count (ticked, not warm-up). Each set is weighted per
// muscle by the counting mode, muscles roll up into display groups, and one
// set adds at most 1 to a group: a row that is primary for lats and secondary
// for middle back adds 1 to Back, not 1.5.

import { MUSCLE_GROUPS, groupOfMuscle } from './muscles.js';
import { isWorkingSet } from './sets.js';

export const COUNTING_MODES = {
  fractional: { primary: 1, secondary: 0.5 },
  primary: { primary: 1, secondary: 0 },
  all: { primary: 1, secondary: 1 },
};
export const DEFAULT_COUNTING_MODE = 'fractional';

/** { groupId: weight } — what one set of this exercise adds to each group. */
export function groupWeights(exercise, mode = DEFAULT_COUNTING_MODE) {
  const weights = COUNTING_MODES[mode] || COUNTING_MODES[DEFAULT_COUNTING_MODE];
  const result = {};
  const add = (muscles, weight) => {
    if (!weight) return;
    for (const muscle of muscles || []) {
      const group = groupOfMuscle(muscle);
      if (group) result[group.id] = Math.max(result[group.id] || 0, weight);
    }
  };
  add(exercise.primaryMuscles, weights.primary);
  add(exercise.secondaryMuscles, weights.secondary);
  return result;
}

/**
 * { groupId: sets } for one workout. exerciseById is a Map of merged
 * exercises (see mergeExercises); an exercise missing from it adds nothing.
 */
export function workoutVolume(workout, exerciseById, mode = DEFAULT_COUNTING_MODE) {
  const totals = {};
  for (const entry of workout.exercises || []) {
    const exercise = exerciseById.get(entry.exerciseId);
    if (!exercise) continue;
    const sets = entry.sets.filter(isWorkingSet).length;
    if (!sets) continue;
    for (const [groupId, weight] of Object.entries(groupWeights(exercise, mode))) {
      totals[groupId] = (totals[groupId] || 0) + weight * sets;
    }
  }
  return totals;
}

/** { groupId: sets } summed over several workouts. */
export function totalVolume(workouts, exerciseById, mode = DEFAULT_COUNTING_MODE) {
  const totals = {};
  for (const workout of workouts) {
    for (const [groupId, sets] of Object.entries(workoutVolume(workout, exerciseById, mode))) {
      totals[groupId] = (totals[groupId] || 0) + sets;
    }
  }
  return totals;
}

/**
 * The weekly target per group: my stored value where I set one (a number, or
 * null for "no target"), otherwise the group's default.
 */
export function resolveTargets(stored = {}) {
  const targets = {};
  for (const group of MUSCLE_GROUPS) {
    const mine = stored ? stored[group.id] : undefined;
    targets[group.id] = mine === null || (typeof mine === 'number' && mine > 0) ? mine : group.defaultTarget;
  }
  return targets;
}

/**
 * How one workout moved each muscle group toward its weekly target.
 * otherWorkouts: the other workouts of the same Monday–Sunday week.
 * Returns the groups this workout trained, in display order:
 * [{ id, label, added, before, after, target }].
 */
export function weekProgress(workout, otherWorkouts, exerciseById, { mode = DEFAULT_COUNTING_MODE, targets = resolveTargets() } = {}) {
  const added = workoutVolume(workout, exerciseById, mode);
  const before = totalVolume(otherWorkouts, exerciseById, mode);
  return MUSCLE_GROUPS.filter((group) => added[group.id] > 0).map((group) => ({
    id: group.id,
    label: group.label,
    added: added[group.id],
    before: before[group.id] || 0,
    after: (before[group.id] || 0) + added[group.id],
    target: targets[group.id] ?? null,
  }));
}

/** Groups without a target are coloured as if their target were this. */
export const BASELINE_TARGET = 10;
export const MAX_TARGET = 50;

/** { muscle: sets } — like totalVolume, but per dataset muscle (Back splits into lats and middle back). */
export function muscleVolume(workouts, exerciseById, mode = DEFAULT_COUNTING_MODE) {
  const weights = COUNTING_MODES[mode] || COUNTING_MODES[DEFAULT_COUNTING_MODE];
  const totals = {};
  for (const workout of workouts) {
    for (const entry of workout.exercises || []) {
      const exercise = exerciseById.get(entry.exerciseId);
      if (!exercise) continue;
      const sets = entry.sets.filter(isWorkingSet).length;
      if (!sets) continue;
      const perMuscle = {};
      for (const muscle of exercise.secondaryMuscles || []) if (weights.secondary) perMuscle[muscle] = weights.secondary;
      for (const muscle of exercise.primaryMuscles || []) perMuscle[muscle] = weights.primary;
      for (const [muscle, weight] of Object.entries(perMuscle)) {
        if (groupOfMuscle(muscle)) totals[muscle] = (totals[muscle] || 0) + weight * sets;
      }
    }
  }
  return totals;
}

/** How full a group is, 0…1: sets relative to its target (or to the baseline when it has none). */
export function fillLevel(sets, target) {
  if (!(sets > 0)) return 0;
  return Math.min(1, sets / (target || BASELINE_TARGET));
}

/**
 * Everything the weekly view shows, for every group in display order:
 * [{ id, label, sets, target, level, exercises: [{ exerciseId, sets }], muscles: [{ muscle, sets }] }].
 * `exercises` lists what contributed, most sets first; `muscles` is only
 * filled for groups made of several muscles (Back).
 */
export function weekVolume(workouts, exerciseById, { mode = DEFAULT_COUNTING_MODE, targets = resolveTargets() } = {}) {
  const totals = totalVolume(workouts, exerciseById, mode);
  const perMuscle = muscleVolume(workouts, exerciseById, mode);
  const contributions = {}; // groupId → Map(exerciseId → sets), in the order first trained
  for (const workout of workouts) {
    for (const entry of workout.exercises || []) {
      const exercise = exerciseById.get(entry.exerciseId);
      if (!exercise) continue;
      const sets = entry.sets.filter(isWorkingSet).length;
      if (!sets) continue;
      for (const [groupId, weight] of Object.entries(groupWeights(exercise, mode))) {
        const map = (contributions[groupId] ||= new Map());
        map.set(entry.exerciseId, (map.get(entry.exerciseId) || 0) + weight * sets);
      }
    }
  }
  return MUSCLE_GROUPS.map((group) => {
    const sets = totals[group.id] || 0;
    const target = targets[group.id] ?? null;
    return {
      id: group.id,
      label: group.label,
      sets,
      target,
      level: fillLevel(sets, target),
      exercises: [...(contributions[group.id] || [])]
        .map(([exerciseId, n]) => ({ exerciseId, sets: n }))
        .sort((a, b) => b.sets - a.sets),
      muscles: group.muscles.length > 1 ? group.muscles.map((muscle) => ({ muscle, sets: perMuscle[muscle] || 0 })) : [],
    };
  });
}

/**
 * What a typed target means: '' → null (no target), a whole number from 1 to
 * MAX_TARGET → that number, anything else → undefined (invalid).
 */
export function parseTarget(text) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_TARGET ? value : undefined;
}

/**
 * The stored `muscleTargets` after setting one group. Only what differs from
 * the group's default is kept, so later changes to the defaults still reach
 * the groups I never touched.
 */
export function withTarget(stored, groupId, value) {
  const next = { ...(stored || {}) };
  const group = MUSCLE_GROUPS.find((g) => g.id === groupId);
  if (!group) return next;
  if (value === group.defaultTarget) delete next[groupId];
  else next[groupId] = value;
  return next;
}
