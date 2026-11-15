// The IndexedDB schema, described as data, plus the migration steps.
// Pure module: no DOM, no IndexedDB. See docs/DATA_MODEL.md.
//
// Changing anything here is a schema change: ask first, bump SCHEMA_VERSION,
// add a migration step, and add a fixture backup of the old version to
// tests/fixtures/.

export const DB_NAME = 'workout-tracker';
export const PREMIGRATION_DB_NAME = 'workout-tracker-premigration';
export const SCHEMA_VERSION = 1;

/** Every store, its key and its indexes, as of SCHEMA_VERSION. */
export const STORES = [
  { name: 'settings', keyPath: 'key', indexes: [] },
  {
    name: 'workouts',
    keyPath: 'id',
    indexes: [
      { name: 'date', keyPath: 'date' },
      { name: 'status', keyPath: 'status' },
      { name: 'exerciseIds', keyPath: 'exerciseIds', multiEntry: true },
      { name: 'plannedRef', keyPath: 'plannedRef' },
    ],
  },
  { name: 'routines', keyPath: 'id', indexes: [] },
  { name: 'planRules', keyPath: 'id', indexes: [{ name: 'startDate', keyPath: 'startDate' }] },
  {
    name: 'planExceptions',
    keyPath: 'id',
    indexes: [
      { name: 'originalDate', keyPath: 'originalDate', unique: true },
      { name: 'movedTo', keyPath: 'movedTo' },
    ],
  },
  { name: 'plannedOneOffs', keyPath: 'id', indexes: [{ name: 'date', keyPath: 'date' }] },
  { name: 'exerciseOverrides', keyPath: 'exerciseId', indexes: [] },
  { name: 'customExercises', keyPath: 'id', indexes: [] },
  { name: 'bodyWeights', keyPath: 'date', indexes: [] },
];

/** Settings are only stored once changed; these are the values until then. */
export const SETTING_DEFAULTS = {
  lastBackupAt: null,
  backupReminderDays: 14,
  volumeCounting: 'fractional',
  muscleTargets: {},
  barWeight: 20,
};

/**
 * Migration steps, in order. Each one turns a snapshot of version `from`
 * into a snapshot of version `to` (= from + 1):
 *
 *   { from: 1, to: 2,
 *     dropStores: ['oldStore'],          // optional; the only way a store is removed
 *     migrate(snapshot) { …; return snapshot; } }
 *
 * A snapshot is { storeName: records[] }. Steps must be pure: the same steps
 * run inside the database upgrade and on imported backups.
 */
export const MIGRATIONS = [];

export function storeNames(stores = STORES) {
  return stores.map((store) => store.name);
}

function stepsBetween(fromVersion, toVersion, migrations) {
  if (!Number.isInteger(fromVersion) || !Number.isInteger(toVersion) || fromVersion < 1) {
    throw new Error(`Invalid schema versions: ${fromVersion} → ${toVersion}`);
  }
  if (fromVersion > toVersion) {
    throw new Error(`Cannot migrate backwards from version ${fromVersion} to ${toVersion}`);
  }
  const steps = [];
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations.find((m) => m.from === v && m.to === v + 1);
    if (!step) throw new Error(`No migration step from version ${v} to ${v + 1}`);
    steps.push(step);
  }
  return steps;
}

/** Names of stores that the steps between two versions remove on purpose. */
export function droppedStores(fromVersion, toVersion = SCHEMA_VERSION, migrations = MIGRATIONS) {
  return stepsBetween(fromVersion, toVersion, migrations).flatMap((step) => step.dropStores || []);
}

/**
 * Runs the pending steps on a snapshot and returns the migrated snapshot.
 * The input is never modified. Throws if a step is missing, or if a step
 * loses a store without declaring it in dropStores.
 */
export function migrateSnapshot(snapshot, fromVersion, toVersion = SCHEMA_VERSION, migrations = MIGRATIONS) {
  let current = structuredClone(snapshot);
  for (const step of stepsBetween(fromVersion, toVersion, migrations)) {
    const before = Object.keys(current);
    const next = step.migrate ? step.migrate(current) : current;
    if (!next || typeof next !== 'object') {
      throw new Error(`Migration ${step.from} → ${step.to} returned no snapshot`);
    }
    const drops = step.dropStores || [];
    for (const name of drops) delete next[name];
    const lost = before.filter((name) => !(name in next) && !drops.includes(name));
    if (lost.length) {
      throw new Error(`Migration ${step.from} → ${step.to} lost stores without declaring it: ${lost.join(', ')}`);
    }
    current = next;
  }
  return current;
}
