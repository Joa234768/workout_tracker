// Muscle volume: reads the workouts of a week and my volume settings, and
// saves changes to those settings. The counting itself is in js/logic/volume.js.

import { db } from './db.js';
import { getLibrary } from './exercises.js';
import { getWeekWorkouts } from './workouts.js';
import { COUNTING_MODES, DEFAULT_COUNTING_MODE, resolveTargets, weekVolume, withTarget } from './logic/volume.js';

/** { mode, stored, targets }: the counting mode, my stored targets, and the targets in effect. */
export async function getVolumeSettings() {
  const [mode, stored] = await Promise.all([db.getSetting('volumeCounting'), db.getSetting('muscleTargets')]);
  return {
    mode: COUNTING_MODES[mode] ? mode : DEFAULT_COUNTING_MODE,
    stored: stored || {},
    targets: resolveTargets(stored),
  };
}

export async function setCountingMode(mode) {
  if (!COUNTING_MODES[mode]) throw new Error(`Unknown counting mode: ${mode}`);
  await db.setSetting('volumeCounting', mode);
}

/** Sets one group's weekly target: a number, or null for "no target". */
export async function setTarget(groupId, value) {
  await db.setSetting('muscleTargets', withTarget(await db.getSetting('muscleTargets'), groupId, value));
}

export async function resetTargets() {
  await db.setSetting('muscleTargets', {});
}

/**
 * The Monday–Sunday week containing `dateStr`:
 * { groups (see weekVolume), nameOf(exerciseId), workouts }.
 * The workout in progress counts too.
 */
export async function loadWeek(dateStr) {
  const [workouts, library, settings] = await Promise.all([getWeekWorkouts(dateStr), getLibrary(), getVolumeSettings()]);
  const exerciseById = new Map(library.map((exercise) => [exercise.id, exercise]));
  return {
    workouts,
    groups: weekVolume(workouts, exerciseById, settings),
    nameOf: (exerciseId) => exerciseById.get(exerciseId)?.name || exerciseId,
  };
}
