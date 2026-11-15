// Checks the vendored exercise dataset against what the app relies on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSCLES, MUSCLE_GROUPS, groupOfMuscle } from '../js/logic/muscles.js';
import { EQUIPMENT, CUSTOM_PREFIX, mergeExercises, isImagePath, imageUrl } from '../js/logic/exercises.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(readFileSync(join(root, 'data', 'exercises.json'), 'utf8'));
const shippedIds = JSON.parse(readFileSync(join(root, 'tests', 'fixtures', 'exercise-ids.json'), 'utf8'));

test('every exercise has a usable id, name and instruction list', () => {
  assert.ok(Array.isArray(dataset) && dataset.length > 800);
  for (const exercise of dataset) {
    assert.equal(typeof exercise.id, 'string');
    assert.ok(exercise.id.length > 0);
    assert.equal(typeof exercise.name, 'string');
    assert.ok(exercise.name.trim().length > 0, `${exercise.id} has no name`);
    assert.ok(Array.isArray(exercise.instructions) && exercise.instructions.every((s) => typeof s === 'string'));
  }
});

test('ids are unique and can never collide with custom exercises', () => {
  const ids = dataset.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.filter((id) => id.startsWith(CUSTOM_PREFIX)), []);
  // Ids go into the address (#/exercises/<id>), so no slashes or spaces.
  assert.deepEqual(ids.filter((id) => /[\/\s#?]/.test(id)), []);
});

test('no exercise id that has ever shipped is missing', () => {
  // Logged sets refer to these ids forever. If the dataset is updated and an
  // id is gone, this fails: keep the old exercise instead of dropping it.
  const present = new Set(dataset.map((e) => e.id));
  const missing = shippedIds.filter((id) => !present.has(id));
  assert.deepEqual(missing, []);
  // New ids must be added to the list, so they are protected from then on.
  const known = new Set(shippedIds);
  const unlisted = dataset.map((e) => e.id).filter((id) => !known.has(id));
  assert.deepEqual(unlisted, [], 'add new ids to tests/fixtures/exercise-ids.json');
});

test('the dataset uses exactly the 17 known muscles', () => {
  const used = new Set(dataset.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]));
  assert.deepEqual([...used].sort(), [...MUSCLES].sort());
  for (const exercise of dataset) {
    assert.ok(exercise.primaryMuscles.length >= 1, `${exercise.id} has no primary muscle`);
  }
});

test('the dataset uses only known equipment values (or none)', () => {
  const used = new Set(dataset.map((e) => e.equipment).filter((v) => v !== null));
  for (const value of used) assert.ok(EQUIPMENT.includes(value), `unknown equipment: ${value}`);
});

test('every muscle belongs to exactly one display group', () => {
  assert.equal(MUSCLES.length, 17);
  assert.equal(MUSCLE_GROUPS.length, 16);
  const grouped = MUSCLE_GROUPS.flatMap((g) => g.muscles);
  assert.deepEqual([...grouped].sort(), [...MUSCLES].sort());
  assert.equal(new Set(grouped).size, grouped.length);
  assert.equal(groupOfMuscle('lats').id, 'back');
  assert.equal(groupOfMuscle('middle back').id, 'back');
  assert.equal(groupOfMuscle('lower back').id, 'lowerBack');
  assert.equal(groupOfMuscle('unknown'), null);
  assert.deepEqual(MUSCLE_GROUPS.filter((g) => g.defaultTarget === 10).map((g) => g.id),
    ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'abs', 'calves', 'lowerBack']);
  assert.deepEqual(MUSCLE_GROUPS.filter((g) => g.defaultTarget === null).map((g) => g.id),
    ['traps', 'forearms', 'adductors', 'abductors', 'neck']);
});

test('the whole dataset merges into the library', () => {
  const library = mergeExercises(dataset, [], []);
  assert.equal(library.length, dataset.length);
  assert.ok(library.every((e) => EQUIPMENT.includes(e.equipment)));
  assert.ok(library.every((e) => !e.custom && !e.favourite && !e.musclesEdited));
});

test('every photo the dataset lists is in images/exercises, and is a real JPEG', () => {
  let count = 0;
  for (const exercise of dataset) {
    for (const path of exercise.images || []) {
      assert.ok(isImagePath(path), `${exercise.id}: unexpected photo path ${path}`);
      const file = join(root, imageUrl(path));
      assert.ok(existsSync(file), `${path} is missing; run tools/make_images.py`);
      const head = readFileSync(file).subarray(0, 3);
      assert.deepEqual([...head], [0xff, 0xd8, 0xff], `${path} is not a JPEG`);
      assert.ok(statSync(file).size < 150000, `${path} is larger than expected for a 640 px photo`);
      count += 1;
    }
  }
  assert.ok(count > 1700);
});

test('photos reach the merged library, but only safe paths, and never for custom exercises', () => {
  const custom = [{ id: `${CUSTOM_PREFIX}x`, name: 'Mine', equipment: 'other', primaryMuscles: ['chest'], secondaryMuscles: [], images: ['a/0.jpg'] }];
  const odd = [{ ...dataset[0], id: 'Odd', images: ['Odd/0.jpg', '../secret/0.jpg', 'https://example.com/x.jpg', 42] }];
  const merged = mergeExercises([dataset[0], ...odd], custom, []);
  assert.deepEqual(merged[0].images, dataset[0].images);
  assert.deepEqual(merged[1].images, ['Odd/0.jpg']);
  assert.deepEqual(merged[2].images, []);
  assert.equal(imageUrl('Barbell_Squat/0.jpg'), './images/exercises/Barbell_Squat/0.jpg');
});
