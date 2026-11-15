import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupWeights, workoutVolume, totalVolume, resolveTargets, weekProgress,
} from '../js/logic/volume.js';

const exercises = new Map([
  ['Bench', { id: 'Bench', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'] }],
  ['Pullups', { id: 'Pullups', primaryMuscles: ['lats'], secondaryMuscles: ['biceps', 'middle back'] }],
  ['Row', { id: 'Row', primaryMuscles: ['middle back'], secondaryMuscles: ['biceps', 'lats', 'shoulders'] }],
  ['Squat', { id: 'Squat', primaryMuscles: ['quadriceps'], secondaryMuscles: ['calves', 'glutes', 'hamstrings', 'lower back'] }],
]);
const set = (extra = {}) => ({ kg: 40, reps: 10, warmup: false, done: true, ...extra });
const workout = (entries) => ({ exercises: entries.map(([exerciseId, sets]) => ({ exerciseId, sets })) });

test('groupWeights: fractional by default, primary 1 and secondary 0.5', () => {
  assert.deepEqual(groupWeights(exercises.get('Bench')), { chest: 1, shoulders: 0.5, triceps: 0.5 });
  assert.deepEqual(groupWeights(exercises.get('Bench'), 'primary'), { chest: 1 });
  assert.deepEqual(groupWeights(exercises.get('Bench'), 'all'), { chest: 1, shoulders: 1, triceps: 1 });
  assert.deepEqual(groupWeights(exercises.get('Bench'), 'nonsense'), { chest: 1, shoulders: 0.5, triceps: 0.5 });
});

test('one set adds at most 1 to a group: lats + middle back is 1 Back, not 1.5', () => {
  assert.deepEqual(groupWeights(exercises.get('Pullups')), { back: 1, biceps: 0.5 });
  assert.deepEqual(groupWeights(exercises.get('Row')), { back: 1, biceps: 0.5, shoulders: 0.5 });
  assert.equal(groupWeights(exercises.get('Row'), 'all').back, 1);
});

test('workoutVolume counts working sets only', () => {
  const w = workout([
    ['Bench', [set({ warmup: true }), set(), set(), set({ done: false }), set({ reps: 0 })]],
    ['Pullups', [set({ kg: 0 })]],
    ['Unknown_Exercise', [set(), set()]],
  ]);
  assert.deepEqual(workoutVolume(w, exercises), { chest: 2, shoulders: 1, triceps: 1, back: 1, biceps: 0.5 });
  assert.deepEqual(workoutVolume(w, exercises, 'primary'), { chest: 2, back: 1 });
  assert.deepEqual(workoutVolume(workout([]), exercises), {});
  assert.deepEqual(workoutVolume(workout([['Bench', [set({ done: false })]]]), exercises), {});
});

test('totalVolume sums workouts', () => {
  const a = workout([['Bench', [set(), set(), set()]]]);
  const b = workout([['Bench', [set()]], ['Row', [set(), set()]]]);
  assert.deepEqual(totalVolume([a, b], exercises), { chest: 4, shoulders: 3, triceps: 2, back: 2, biceps: 1 });
  assert.deepEqual(totalVolume([], exercises), {});
});

test('resolveTargets: defaults, my numbers, and "no target"', () => {
  const defaults = resolveTargets();
  assert.equal(defaults.chest, 10);
  assert.equal(defaults.abs, 10);
  assert.equal(defaults.calves, 10);
  assert.equal(defaults.lowerBack, 10);
  assert.equal(defaults.neck, null);
  assert.equal(defaults.traps, null);
  const mine = resolveTargets({ chest: 12, neck: 4, back: null, quads: 0, glutes: 'lots' });
  assert.equal(mine.chest, 12);
  assert.equal(mine.neck, 4);
  assert.equal(mine.back, null); // switched off
  assert.equal(mine.quads, 10); // nonsense values fall back to the default
  assert.equal(mine.glutes, 10);
  assert.deepEqual(resolveTargets(null), defaults);
});

test('weekProgress: what this workout added, on top of the rest of the week', () => {
  const thisWorkout = workout([['Bench', [set(), set(), set()]], ['Squat', [set()]]]);
  const earlier = [workout([['Bench', [set(), set()]], ['Pullups', [set()]]])];
  const progress = weekProgress(thisWorkout, earlier, exercises);
  assert.deepEqual(progress.map((p) => p.id), ['chest', 'shoulders', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'lowerBack']);
  assert.deepEqual(progress[0], { id: 'chest', label: 'Chest', added: 3, before: 2, after: 5, target: 10 });
  assert.deepEqual(progress[1], { id: 'shoulders', label: 'Shoulders', added: 1.5, before: 1, after: 2.5, target: 10 });
  assert.deepEqual(progress.at(-1), { id: 'lowerBack', label: 'Lower back', added: 0.5, before: 0, after: 0.5, target: 10 });
  // Back was trained earlier this week but not in this workout: not listed.
  assert.ok(!progress.some((p) => p.id === 'back'));
});

test('weekProgress respects the counting mode and my targets', () => {
  const thisWorkout = workout([['Bench', [set(), set()]]]);
  const progress = weekProgress(thisWorkout, [], exercises, { mode: 'primary', targets: resolveTargets({ chest: 6 }) });
  assert.deepEqual(progress, [{ id: 'chest', label: 'Chest', added: 2, before: 0, after: 2, target: 6 }]);
});
