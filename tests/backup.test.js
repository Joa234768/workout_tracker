import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BackupError, buildBackup, backupFilename, parseBackup, validateBackup,
  summarizeBackup, prepareImport, backupStatus,
} from '../js/logic/backup.js';
import { SCHEMA_VERSION, STORES, storeNames } from '../js/logic/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureText = readFileSync(join(here, 'fixtures', 'backup-v1.json'), 'utf8');
const fixture = () => JSON.parse(fixtureText);

const withoutLastBackup = (stores) => ({
  ...stores,
  settings: stores.settings.filter((r) => r.key !== 'lastBackupAt'),
});

test('the v1 fixture covers every store and is a valid backup', () => {
  const backup = parseBackup(fixtureText);
  assert.equal(backup.schemaVersion, 1);
  assert.deepEqual(Object.keys(backup.stores).sort(), storeNames().sort());
  for (const name of storeNames()) {
    assert.ok(backup.stores[name].length > 0, `fixture has no records in ${name}`);
  }
});

test('the v1 fixture imports into the current schema', () => {
  const prepared = prepareImport(fixture());
  assert.deepEqual(Object.keys(prepared), storeNames());
  // Everything is preserved exactly, except lastBackupAt (see below).
  assert.deepEqual(withoutLastBackup(prepared), withoutLastBackup(fixture().stores));
});

test('import sets lastBackupAt to the backup date, exactly once', () => {
  const prepared = prepareImport(fixture());
  const records = prepared.settings.filter((r) => r.key === 'lastBackupAt');
  assert.deepEqual(records, [{ key: 'lastBackupAt', value: '2026-11-20T18:30:00.000Z' }]);
});

test('export → file → import round-trips every store', () => {
  const stores = withoutLastBackup(fixture().stores);
  const backup = buildBackup({ stores, appVersion: '9.9.9', exportedAt: '2026-12-01T10:00:00.000Z' });
  assert.equal(backup.app, 'workout-tracker');
  assert.equal(backup.schemaVersion, SCHEMA_VERSION);
  const text = JSON.stringify(backup, null, 2);
  const prepared = prepareImport(parseBackup(text));
  assert.deepEqual(withoutLastBackup(prepared), stores);
});

test('prepareImport does not modify the backup object', () => {
  const backup = fixture();
  prepareImport(backup);
  assert.deepEqual(backup, fixture());
});

test('backupFilename uses DD-MM-YYYY of the local day', () => {
  assert.equal(backupFilename(new Date(2026, 10, 16, 23, 50)), 'workout-backup-16-11-2026.json');
  assert.equal(backupFilename(new Date(2027, 0, 5, 0, 5)), 'workout-backup-05-01-2027.json');
});

test('files that are not backups are refused with a clear message', () => {
  const refuse = (text, pattern) =>
    assert.throws(() => parseBackup(text), (err) => err instanceof BackupError && pattern.test(err.message));
  refuse('hello', /could not be read/);
  refuse('', /could not be read/);
  refuse('[]', /not a Workout Tracker backup/);
  refuse('null', /not a Workout Tracker backup/);
  refuse('{"app":"something-else","schemaVersion":1,"stores":{}}', /not a Workout Tracker backup/);
});

test('damaged backups are refused', () => {
  const broken = (change, pattern) => {
    const backup = fixture();
    change(backup);
    assert.throws(() => prepareImport(backup), (err) => err instanceof BackupError && pattern.test(err.message));
  };
  broken((b) => delete b.schemaVersion, /version is missing/);
  broken((b) => (b.schemaVersion = '1'), /version is missing/);
  broken((b) => (b.schemaVersion = 0), /version is missing/);
  broken((b) => delete b.exportedAt, /date is missing/);
  broken((b) => (b.exportedAt = 'yesterday'), /date is missing/);
  broken((b) => (b.stores = []), /no data section/);
  broken((b) => (b.stores.workouts = {}), /"workouts" is not a list/);
  broken((b) => b.stores.workouts.push('text'), /"workouts" is not a list/);
  broken((b) => delete b.stores.workouts[0].id, /"workouts" has no id/);
  broken((b) => (b.stores.bodyWeights[0].date = ''), /"bodyWeights" has no date/);
  broken((b) => b.stores.routines.push({ ...b.stores.routines[0] }), /"routines" contains .* twice/);
});

test('a backup from a newer app version is refused', () => {
  const backup = fixture();
  backup.schemaVersion = SCHEMA_VERSION + 1;
  assert.throws(() => validateBackup(backup), /Update the app first/);
  assert.throws(() => prepareImport(backup), /Update the app first/);
});

test('unknown stores are refused, missing stores become empty', () => {
  const extra = fixture();
  extra.stores.meals = [{ id: 'm1' }];
  assert.throws(() => prepareImport(extra), /doesn't know: meals/);

  const partial = fixture();
  delete partial.stores.bodyWeights;
  delete partial.stores.settings;
  const prepared = prepareImport(partial);
  assert.deepEqual(prepared.bodyWeights, []);
  assert.deepEqual(prepared.settings, [{ key: 'lastBackupAt', value: partial.exportedAt }]);
});

test('an older backup is migrated on import', () => {
  // A made-up future: schema 2 adds a `tag` field and a new store.
  const v2Stores = [...STORES, { name: 'extra', keyPath: 'id', indexes: [] }];
  const migrations = [
    {
      from: 1,
      to: 2,
      migrate(s) {
        s.bodyWeights = s.bodyWeights.map((r) => ({ ...r, tag: 'migrated' }));
        s.extra = [{ id: 'e1' }];
        return s;
      },
    },
  ];
  const prepared = prepareImport(fixture(), { schemaVersion: 2, stores: v2Stores, migrations });
  assert.ok(prepared.bodyWeights.every((r) => r.tag === 'migrated'));
  assert.deepEqual(prepared.extra, [{ id: 'e1' }]);
  assert.deepEqual(prepared.workouts, fixture().stores.workouts);

  // Without the step, the import is refused instead of guessing.
  assert.throws(
    () => prepareImport(fixture(), { schemaVersion: 2, stores: v2Stores, migrations: [] }),
    /could not be converted/
  );
});

test('summarizeBackup counts records', () => {
  const summary = summarizeBackup(fixture());
  assert.equal(summary.counts.workouts, 2);
  assert.equal(summary.counts.bodyWeights, 2);
  assert.equal(summary.total, 17);
  assert.equal(summary.exportedAt, '2026-11-20T18:30:00.000Z');
});

test('backupStatus: label, date and reminder', () => {
  const now = new Date(2026, 10, 30, 12, 0);
  const at = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();

  assert.deepEqual(backupStatus({ lastBackupAt: null, reminderDays: 14, hasData: false, now }),
    { days: null, date: null, label: 'Last backup: never', due: false });
  assert.equal(backupStatus({ lastBackupAt: null, reminderDays: 14, hasData: true, now }).due, true);

  const today = backupStatus({ lastBackupAt: at(2026, 10, 30, 8), reminderDays: 14, now });
  assert.deepEqual(today, { days: 0, date: '30-11-2026', label: 'Last backup: today', due: false });

  // Late yesterday evening is "yesterday", not "today".
  assert.equal(backupStatus({ lastBackupAt: at(2026, 10, 29, 23), reminderDays: 14, now }).label, 'Last backup: yesterday');

  const fourteen = backupStatus({ lastBackupAt: at(2026, 10, 16), reminderDays: 14, now });
  assert.equal(fourteen.label, 'Last backup: 14 days ago');
  assert.equal(fourteen.date, '16-11-2026');
  assert.equal(fourteen.due, false); // exactly 14 days is not yet "more than 14"

  assert.equal(backupStatus({ lastBackupAt: at(2026, 10, 15), reminderDays: 14, now }).due, true);
  assert.equal(backupStatus({ lastBackupAt: at(2026, 10, 15), reminderDays: 30, now }).due, false);

  // A clock set back never produces negative days.
  assert.equal(backupStatus({ lastBackupAt: at(2026, 11, 5), reminderDays: 14, now }).days, 0);
});
