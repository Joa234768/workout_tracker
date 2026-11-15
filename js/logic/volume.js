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
