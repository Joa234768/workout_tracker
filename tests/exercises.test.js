import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeExercises, normalizeText, filterExercises, sortExercises, lastUsedByExercise,
  exerciseHistory, overrideIsEmpty, validateMuscles, validateCustomExercise,
  equipmentLabel, isCustomId,
} from '../js/logic/exercises.js';
import { isDoneSet, isWorkingSet, formatKg, formatSet } from '../js/logic/sets.js';
import { muscleLabel, groupsOfMuscles } from '../js/logic/muscles.js';

const dataset = [
  { id: 'Barbell_Squat', name: 'Barbell Squat', equipment: 'barbell', category: 'strength', level: 'beginner',
    primaryMuscles: ['quadriceps'], secondaryMuscles: ['calves', 'glutes', 'hamstrings', 'lower back'], instructions: ['Step one.', 'Step two.'] },
  { id: 'Bench', name: 'Barbell Bench Press - Medium Grip', equipment: 'barbell', category: 'strength', level: 'beginner',
    primaryMuscles: ['chest'], secondaryMuscles: ['shoulders', 'triceps'], instructions: [] },
  { id: 'Pullups', name: 'Pullups', equipment: 'body only', category: 'strength', level: 'beginner',
    primaryMuscles: ['lats'], secondaryMuscles: ['biceps', 'middle back'], instructions: [] },
  { id: 'Seated_Row', name: 'Seated Cable Rows', equipment: 'cable', category: 'strength', level: 'beginner',
    primaryMuscles: ['middle back'], secondaryMuscles: ['biceps', 'lats', 'shoulders'], instructions: [] },
  { id: '3_4_Sit-Up', name: '3/4 Sit-Up', equipment: 'body only', category: 'strength', level: 'beginner',
    primaryMuscles: ['abdominals'], secondaryMuscles: [], instructions: [] },
  { id: 'Stretch', name: 'Chest Stretch on Stability Ball', equipment: null, category: 'stretching', level: 'beginner',
    primaryMuscles: ['chest'], secondaryMuscles: [], instructions: [] },
];
const custom = [
  { id: 'custom-1', name: 'Ring rows', equipment: 'other', primaryMuscles: ['middle back'], secondaryMuscles: ['biceps'], archivedAt: null },
  { id: 'custom-2', name: 'Old thing', equipment: 'dumbbell', primaryMuscles: ['biceps'], secondaryMuscles: [], archivedAt: '2026-11-17T08:00:00.000Z' },
];
const ids = (list) => list.map((e) => e.id);
const find = (list, id) => list.find((e) => e.id === id);

test('mergeExercises: dataset plus custom, with defaults', () => {
  const library = mergeExercises(dataset, custom, []);
  assert.equal(library.length, 8);
  const squat = find(library, 'Barbell_Squat');
  assert.deepEqual(
    { name: squat.name, equipment: squat.equipment, favourite: squat.favourite, custom: squat.custom, musclesEdited: squat.musclesEdited, increment: squat.increment },
    { name: 'Barbell Squat', equipment: 'barbell', favourite: false, custom: false, musclesEdited: false, increment: null }
  );
  assert.deepEqual(squat.instructions, ['Step one.', 'Step two.']);
  assert.equal(find(library, 'Stretch').equipment, 'other'); // empty in the dataset
  assert.equal(find(library, 'custom-1').custom, true);
  assert.equal(find(library, 'custom-1').archived, false);
  assert.equal(find(library, 'custom-2').archived, true);
  assert.deepEqual(find(library, 'custom-1').instructions, []);
});

test('mergeExercises: overrides apply on top and leave the dataset untouched', () => {
  const frozen = JSON.stringify(dataset);
  const library = mergeExercises(dataset, custom, [
    { exerciseId: 'Barbell_Squat', favourite: true, primaryMuscles: ['glutes'], secondaryMuscles: ['quadriceps'], increment: 5 },
    { exerciseId: 'Bench', favourite: true },
    { exerciseId: 'custom-1', favourite: true },
    { exerciseId: 'Gone_From_Dataset', favourite: true },
  ]);
  const squat = find(library, 'Barbell_Squat');
  assert.deepEqual(squat.primaryMuscles, ['glutes']);
  assert.deepEqual(squat.secondaryMuscles, ['quadriceps']);
  assert.deepEqual(squat.originalPrimaryMuscles, ['quadriceps']);
  assert.equal(squat.musclesEdited, true);
  assert.equal(squat.increment, 5);
  const bench = find(library, 'Bench');
  assert.equal(bench.favourite, true);
  assert.equal(bench.musclesEdited, false);
  assert.deepEqual(bench.primaryMuscles, ['chest']);
  assert.equal(find(library, 'custom-1').favourite, true);
  assert.equal(library.length, 8); // an override for an unknown id adds nothing
  assert.equal(JSON.stringify(dataset), frozen);
});

test('mergeExercises ignores muscle names it does not know', () => {
  const library = mergeExercises(dataset, [], [{ exerciseId: 'Bench', primaryMuscles: ['chest', 'wings'], secondaryMuscles: [] }]);
  assert.deepEqual(find(library, 'Bench').primaryMuscles, ['chest']);
});

test('normalizeText', () => {
  assert.equal(normalizeText('3/4 Sit-Up'), '3 4 sit up');
  assert.equal(normalizeText('  Barbell   Bench Press - Medium Grip '), 'barbell bench press medium grip');
  assert.equal(normalizeText('Curl (Édouard’s)'), 'curl edouard s');
});

test('search: every word must match, in any order, ignoring case and punctuation', () => {
  const library = mergeExercises(dataset, custom, []);
  const search = (query) => ids(filterExercises(library, { query }));
  assert.deepEqual(search('squat'), ['Barbell_Squat']);
  assert.deepEqual(search('BARBELL'), ['Barbell_Squat', 'Bench']);
  assert.deepEqual(search('press barbell'), ['Bench']);
  assert.deepEqual(search('sit up'), ['3_4_Sit-Up']);
  assert.deepEqual(search('situp'), []);
  assert.deepEqual(search('pull'), ['Pullups']);
  assert.deepEqual(search('ring'), ['custom-1']);
  assert.deepEqual(search('zzz'), []);
  assert.equal(search('').length, 7);
  assert.equal(search('   ').length, 7);
});

test('archived custom exercises never show in the library', () => {
  const library = mergeExercises(dataset, custom, []);
  assert.ok(!ids(filterExercises(library, {})).includes('custom-2'));
  assert.deepEqual(ids(filterExercises(library, { query: 'old' })), []);
});

test('muscle filter: primary by default, secondary on request, Back = lats + middle back', () => {
  const library = mergeExercises(dataset, custom, []);
  const by = (group, includeSecondary = false) => ids(filterExercises(library, { group, includeSecondary }));
  assert.deepEqual(by('back'), ['Pullups', 'Seated_Row', 'custom-1']);
  assert.deepEqual(by('chest'), ['Bench', 'Stretch']);
  assert.deepEqual(by('biceps'), []);
  assert.deepEqual(by('biceps', true), ['Pullups', 'Seated_Row', 'custom-1']);
  assert.deepEqual(by('glutes', true), ['Barbell_Squat']);
  assert.deepEqual(by('lowerBack', true), ['Barbell_Squat']);
  assert.deepEqual(by('neck', true), []);
});

test('muscle filter follows my edited muscle tags', () => {
  const library = mergeExercises(dataset, [], [{ exerciseId: 'Barbell_Squat', primaryMuscles: ['glutes'], secondaryMuscles: [] }]);
  assert.deepEqual(ids(filterExercises(library, { group: 'glutes' })), ['Barbell_Squat']);
  assert.deepEqual(ids(filterExercises(library, { group: 'quads', includeSecondary: true })), []);
});

test('equipment filter matches any of the chosen equipment', () => {
  const library = mergeExercises(dataset, custom, []);
  const by = (equipment) => ids(filterExercises(library, { equipment }));
  assert.deepEqual(by(['barbell']), ['Barbell_Squat', 'Bench']);
  assert.deepEqual(by(['body only', 'cable']), ['Pullups', 'Seated_Row', '3_4_Sit-Up']);
  assert.deepEqual(by(['other']), ['Stretch', 'custom-1']);
  assert.equal(by([]).length, 7);
});

test('"My exercises" shows favourites and custom exercises', () => {
  const library = mergeExercises(dataset, custom, [{ exerciseId: 'Bench', favourite: true }]);
  assert.deepEqual(ids(filterExercises(library, { mineOnly: true })), ['Bench', 'custom-1']);
});

test('filters combine', () => {
  const library = mergeExercises(dataset, custom, [{ exerciseId: 'Pullups', favourite: true }]);
  assert.deepEqual(
    ids(filterExercises(library, { query: 'pull', group: 'back', equipment: ['body only'], mineOnly: true })),
    ['Pullups']
  );
  assert.deepEqual(ids(filterExercises(library, { query: 'pull', group: 'chest' })), []);
});

test('sort: recently used first (newest on top), then by name', () => {
  const library = filterExercises(mergeExercises(dataset, custom, []), {});
  assert.deepEqual(ids(sortExercises(library)),
    ['3_4_Sit-Up', 'Bench', 'Barbell_Squat', 'Stretch', 'Pullups', 'custom-1', 'Seated_Row']);
  const sorted = sortExercises(library, { Pullups: '2026-11-10', custom_x: '2026-11-20', Seated_Row: '2026-11-16' });
  assert.deepEqual(ids(sorted).slice(0, 3), ['Seated_Row', 'Pullups', '3_4_Sit-Up']);
  assert.equal(ids(library)[0], 'Barbell_Squat'); // the input list is not reordered
});

const set = (kg, reps, extra = {}) => ({ id: 's', kg, reps, warmup: false, done: true, doneAt: null, ...extra });
const workouts = [
  { id: 'w1', status: 'completed', date: '2026-11-16', startedAt: '2026-11-16T16:00:00.000Z', exercises: [
    { exerciseId: 'Bench', sets: [set(20, 10, { warmup: true }), set(42.5, 10), set(42.5, 8), set(40, null, { done: false })] },
    { exerciseId: 'Pullups', sets: [set(0, 12)] },
  ] },
  { id: 'w2', status: 'completed', date: '2026-11-18', startedAt: '2026-11-18T16:00:00.000Z', exercises: [
    { exerciseId: 'Bench', sets: [set(45, 9)] },
    { exerciseId: 'Barbell_Squat', sets: [set(20, 10, { warmup: true })] }, // warm-ups only
    { exerciseId: 'Seated_Row', sets: [set(30, 10, { done: false })] }, // nothing ticked
  ] },
  { id: 'w3', status: 'active', date: '2026-11-20', startedAt: '2026-11-20T16:00:00.000Z', exercises: [
    { exerciseId: 'Bench', sets: [set(47.5, 8)] },
  ] },
  { id: 'w0', status: 'completed', date: '2026-11-18', startedAt: '2026-11-18T07:00:00.000Z', exercises: [
    { exerciseId: 'Bench', sets: [set(40, 12)] },
  ] },
];

test('lastUsedByExercise: latest date with a done set, in-progress workout included', () => {
  assert.deepEqual(lastUsedByExercise(workouts), {
    Bench: '2026-11-20',
    Pullups: '2026-11-16',
    Barbell_Squat: '2026-11-18',
  });
  assert.deepEqual(lastUsedByExercise([]), {});
});

test('exerciseHistory: completed workouts, newest first, working sets only', () => {
  assert.deepEqual(exerciseHistory(workouts, 'Bench'), [
    { workoutId: 'w2', date: '2026-11-18', sets: [{ kg: 45, reps: 9 }] },
    { workoutId: 'w0', date: '2026-11-18', sets: [{ kg: 40, reps: 12 }] },
    { workoutId: 'w1', date: '2026-11-16', sets: [{ kg: 42.5, reps: 10 }, { kg: 42.5, reps: 8 }] },
  ]);
  assert.deepEqual(exerciseHistory(workouts, 'Barbell_Squat'), []); // only warm-ups
  assert.deepEqual(exerciseHistory(workouts, 'Seated_Row'), []);
  assert.deepEqual(exerciseHistory(workouts, 'Unknown'), []);
});

test('sets: done, working and formatting', () => {
  assert.equal(isDoneSet(set(40, 8)), true);
  assert.equal(isDoneSet(set(40, 8, { done: false })), false);
  assert.equal(isDoneSet(set(40, 0)), false);
  assert.equal(isDoneSet(set(40, null)), false);
  assert.equal(isWorkingSet(set(40, 8, { warmup: true })), false);
  assert.equal(isWorkingSet(set(0, 12)), true); // bodyweight
  assert.equal(formatKg(12.5), '12.5');
  assert.equal(formatKg(40), '40');
  assert.equal(formatKg(42.50), '42.5');
  assert.equal(formatKg(0.1 + 0.2), '0.3');
  assert.equal(formatSet({ kg: 42.5, reps: 10 }), '42.5 kg × 10');
  assert.equal(formatSet({ kg: 0, reps: 12 }), '12 reps');
  assert.equal(formatSet({ kg: null, reps: 1 }), '1 rep');
});

test('overrideIsEmpty', () => {
  assert.equal(overrideIsEmpty({ exerciseId: 'x', updatedAt: 't' }), true);
  assert.equal(overrideIsEmpty({ exerciseId: 'x', favourite: false }), true);
  assert.equal(overrideIsEmpty({ exerciseId: 'x', favourite: true }), false);
  assert.equal(overrideIsEmpty({ exerciseId: 'x', primaryMuscles: [] }), false);
  assert.equal(overrideIsEmpty({ exerciseId: 'x', increment: 2.5 }), false);
});

test('validateMuscles: needs a primary; a muscle is never both', () => {
  assert.deepEqual(validateMuscles([], ['biceps']), { ok: false, error: 'Choose at least one primary muscle.' });
  assert.deepEqual(validateMuscles(['lats', 'biceps'], ['biceps', 'forearms', 'wings']),
    { ok: true, primaryMuscles: ['biceps', 'lats'], secondaryMuscles: ['forearms'] });
});

test('validateCustomExercise', () => {
  const base = { name: '  Ring   rows ', equipment: 'other', primaryMuscles: ['middle back'], secondaryMuscles: ['biceps'] };
  assert.deepEqual(validateCustomExercise(base), {
    ok: true,
    value: { name: 'Ring rows', equipment: 'other', primaryMuscles: ['middle back'], secondaryMuscles: ['biceps'] },
  });
  assert.equal(validateCustomExercise({ ...base, name: '   ' }).error, 'Give the exercise a name.');
  assert.match(validateCustomExercise({ ...base, name: 'x'.repeat(61) }).error, /under 60/);
  assert.equal(validateCustomExercise({ ...base, equipment: 'spaceship' }).error, 'Choose the equipment.');
  assert.equal(validateCustomExercise({ ...base, equipment: null }).error, 'Choose the equipment.');
  assert.equal(validateCustomExercise({ ...base, primaryMuscles: [] }).error, 'Choose at least one primary muscle.');
});

test('labels', () => {
  assert.equal(equipmentLabel('body only'), 'Bodyweight');
  assert.equal(equipmentLabel('e-z curl bar'), 'EZ curl bar');
  assert.equal(equipmentLabel('barbell'), 'Barbell');
  assert.equal(muscleLabel('middle back'), 'Middle back');
  assert.deepEqual(groupsOfMuscles(['lats', 'middle back', 'biceps', 'chest']).map((g) => g.label), ['Chest', 'Back', 'Biceps']);
  assert.equal(isCustomId('custom-abc'), true);
  assert.equal(isCustomId('Barbell_Squat'), false);
});
