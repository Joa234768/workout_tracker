import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION, STORES, MIGRATIONS, SETTING_DEFAULTS,
  storeNames, migrateSnapshot, droppedStores,
} from '../js/logic/schema.js';

test('schema v1 declares the nine stores with their keys', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(
    Object.fromEntries(STORES.map((s) => [s.name, s.keyPath])),
    {
      settings: 'key',
      workouts: 'id',
      routines: 'id',
      planRules: 'id',
      planExceptions: 'id',
      plannedOneOffs: 'id',
      exerciseOverrides: 'exerciseId',
      customExercises: 'id',
      bodyWeights: 'date',
    }
  );
  assert.equal(new Set(storeNames()).size, STORES.length);
});

test('indexes are declared as documented', () => {
  const indexes = (name) => STORES.find((s) => s.name === name).indexes;
  assert.deepEqual(indexes('workouts').map((i) => i.name), ['date', 'status', 'exerciseIds', 'plannedRef']);
  assert.equal(indexes('workouts').find((i) => i.name === 'exerciseIds').multiEntry, true);
  assert.equal(indexes('planExceptions').find((i) => i.name === 'originalDate').unique, true);
  for (const store of STORES) {
    const names = store.indexes.map((i) => i.name);
    assert.equal(new Set(names).size, names.length, `${store.name} has duplicate index names`);
  }
});

test('there is exactly one migration step per version, in order', () => {
  assert.equal(MIGRATIONS.length, SCHEMA_VERSION - 1);
  MIGRATIONS.forEach((step, i) => {
    assert.equal(step.from, i + 1);
    assert.equal(step.to, i + 2);
  });
});

test('setting defaults are JSON-safe', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(SETTING_DEFAULTS)), SETTING_DEFAULTS);
  assert.equal(SETTING_DEFAULTS.backupReminderDays, 14);
  assert.equal(SETTING_DEFAULTS.lastBackupAt, null);
});

// The migration framework, exercised with made-up steps.
const steps = [
  {
    from: 1,
    to: 2,
    migrate(s) {
      s.items = s.items.map((item) => ({ ...item, tag: 'new' }));
      s.extra = [{ id: 'x' }];
      return s;
    },
  },
  {
    from: 2,
    to: 3,
    dropStores: ['legacy'],
    migrate(s) {
      s.items = s.items.map((item) => ({ ...item, count: (item.count || 0) + 1 }));
      return s;
    },
  },
];

test('migrateSnapshot with no pending steps returns an equal copy', () => {
  const input = { items: [{ id: 1 }] };
  const out = migrateSnapshot(input, 3, 3, steps);
  assert.deepEqual(out, input);
  assert.notEqual(out, input);
});

test('migrateSnapshot runs steps in order and does not modify its input', () => {
  const input = { items: [{ id: 1 }, { id: 2, count: 4 }], legacy: [{ id: 'old' }] };
  const frozen = JSON.stringify(input);
  const out = migrateSnapshot(input, 1, 3, steps);
  assert.deepEqual(out, {
    items: [{ id: 1, tag: 'new', count: 1 }, { id: 2, count: 5, tag: 'new' }],
    extra: [{ id: 'x' }],
  });
  assert.equal(JSON.stringify(input), frozen);
});

test('migrateSnapshot can run a single step', () => {
  const out = migrateSnapshot({ items: [{ id: 1 }], legacy: [] }, 1, 2, steps);
  assert.deepEqual(out, { items: [{ id: 1, tag: 'new' }], extra: [{ id: 'x' }], legacy: [] });
});

test('a store may only disappear when the step declares it', () => {
  assert.deepEqual(droppedStores(1, 3, steps), ['legacy']);
  assert.deepEqual(droppedStores(1, 2, steps), []);
  const careless = [{ from: 1, to: 2, migrate: (s) => ({ items: s.items }) }];
  assert.throws(() => migrateSnapshot({ items: [], workouts: [{ id: 1 }] }, 1, 2, careless), /lost stores/);
});

test('migrateSnapshot refuses missing steps, downgrades and bad versions', () => {
  assert.throws(() => migrateSnapshot({}, 1, 4, steps), /No migration step from version 3 to 4/);
  assert.throws(() => migrateSnapshot({}, 3, 1, steps), /backwards/);
  assert.throws(() => migrateSnapshot({}, 0, 1, steps), /Invalid/);
  assert.throws(() => migrateSnapshot({}, 1.5, 2, steps), /Invalid/);
});
