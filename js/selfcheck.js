// Self-check for js/db.js, run in a real browser. It works entirely in
// scratch databases ("selfcheck-…"), never in the app's real database.
// Shown inside the app at #/settings/selfcheck and at tests/browser/ on the PC.

import { createDb } from './db.js';
import { STORES, SCHEMA_VERSION } from './logic/schema.js';
import { buildBackup, parseBackup, prepareImport } from './logic/backup.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(a, b, message) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  if (left !== right) throw new Error(`${message}\n  got:      ${left.slice(0, 300)}\n  expected: ${right.slice(0, 300)}`);
}

const withoutLastBackup = (stores) => ({
  ...stores,
  settings: (stores.settings || []).filter((r) => r.key !== 'lastBackupAt'),
});

const MAIN = { name: 'selfcheck-main', premigrationName: 'selfcheck-main-pre' };
const MIG = { name: 'selfcheck-migrate', premigrationName: 'selfcheck-migrate-pre' };

async function wipeScratch() {
  await createDb(MAIN).destroy();
  await createDb(MIG).destroy();
}

async function run(fixtureUrl, report) {
  const response = await fetch(fixtureUrl);
  if (!response.ok) throw new Error(`could not load the test data (${response.status})`);
  const fixture = await response.json();
  const checks = [];
  const check = (name, fn) => checks.push({ name, fn });

  const main = createDb(MAIN);

  check('A fresh database has every store and index', async () => {
    const info = await main.describe();
    assert(info.version === SCHEMA_VERSION, `version is ${info.version}`);
    same(Object.keys(info.stores).sort(), STORES.map((s) => s.name).sort(), 'store list differs');
    for (const spec of STORES) {
      const live = info.stores[spec.name];
      same(live.keyPath, spec.keyPath, `${spec.name} key differs`);
      same(
        live.indexes.map((i) => [i.name, i.keyPath, i.unique, i.multiEntry]).sort(),
        spec.indexes.map((i) => [i.name, i.keyPath, Boolean(i.unique), Boolean(i.multiEntry)]).sort(),
        `${spec.name} indexes differ`
      );
    }
  });

  check('Settings: default, then write and read back', async () => {
    same(await main.getSetting('backupReminderDays'), 14, 'default differs');
    await main.setSetting('backupReminderDays', 30);
    same(await main.getSetting('backupReminderDays'), 30, 'stored value differs');
    await main.close(); // as if the app was closed
    same(await main.getSetting('backupReminderDays'), 30, 'value lost after reopening');
  });

  let seeded;
  check('Import of the fixture fills every store exactly', async () => {
    await main.replaceAll(fixture.stores);
    seeded = await main.exportStores();
    for (const spec of STORES) {
      const sort = (records) => [...records].sort((a, b) => (a[spec.keyPath] < b[spec.keyPath] ? -1 : 1));
      same(sort(seeded[spec.name]), sort(fixture.stores[spec.name]), `${spec.name} differs`);
      assert(seeded[spec.name].length > 0, `${spec.name} is empty`);
    }
  });

  check('Round trip: export → file → wipe → import → export is identical', async () => {
    const text = JSON.stringify(buildBackup({ stores: seeded, appVersion: 'selfcheck' }), null, 2);
    await main.replaceAll({});
    const empty = await main.exportStores();
    assert(Object.values(empty).every((records) => records.length === 0), 'wipe left records behind');
    const backup = parseBackup(text);
    await main.replaceAll(prepareImport(backup));
    const after = await main.exportStores();
    same(withoutLastBackup(after), withoutLastBackup(seeded), 'data differs after the round trip');
    same(await main.getSetting('lastBackupAt'), backup.exportedAt, 'lastBackupAt was not set to the backup date');
    seeded = after;
  });

  check('A failed import leaves the existing data untouched', async () => {
    const bad = structuredClone(seeded);
    bad.workouts = []; // would be lost if the import half-applied
    bad.planExceptions = [
      { id: 'a', originalDate: '2026-12-01', cancelled: true, movedTo: null, routineId: null },
      { id: 'b', originalDate: '2026-12-01', cancelled: true, movedTo: null, routineId: null }, // breaks the unique index
    ];
    let failed = false;
    try {
      await main.replaceAll(bad);
    } catch {
      failed = true;
    }
    assert(failed, 'the bad import was accepted');
    same(await main.exportStores(), seeded, 'data changed although the import failed');

    let refused = false;
    try {
      await main.replaceAll({ meals: [] });
    } catch {
      refused = true;
    }
    assert(refused, 'an unknown store was accepted');
  });

  check('Indexes answer date-range and exercise queries', async () => {
    const week = await main.getAllFromIndex('workouts', 'date', { lower: '2026-11-16', upper: '2026-11-22' });
    same(week.map((w) => w.date), ['2026-11-16', '2026-11-18'], 'date range differs');
    const squat = await main.getAllFromIndex('workouts', 'exerciseIds', 'Barbell_Squat');
    same(squat.map((w) => w.date), ['2026-11-18'], 'exercise lookup differs');
    const active = await main.getAllFromIndex('workouts', 'status', 'active');
    same(active.length, 1, 'active workout lookup differs');
    assert((await main.hasUserData()) === true, 'hasUserData should be true');
  });

  // --- Upgrades, with a made-up schema ---
  const v1 = { ...MIG, version: 1, stores: [{ name: 'items', keyPath: 'id', indexes: [] }], migrations: [] };
  const step12 = {
    from: 1,
    to: 2,
    migrate(s) {
      s.items = s.items.map((item) => ({ ...item, tag: `tag-${item.id}` }));
      s.extra = [{ id: 'made-by-migration' }];
      return s;
    },
  };
  const v2 = {
    ...MIG,
    version: 2,
    stores: [
      { name: 'items', keyPath: 'id', indexes: [{ name: 'tag', keyPath: 'tag' }] },
      { name: 'extra', keyPath: 'id', indexes: [] },
    ],
    migrations: [step12],
  };
  const originalItems = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];

  check('Upgrade v1 → v2 keeps the data, runs the migration and saves a pre-upgrade copy', async () => {
    const old = createDb(v1);
    for (const item of originalItems) await old.put('items', item);
    await old.close();

    const upgraded = createDb(v2);
    const info = await upgraded.describe();
    assert(info.version === 2, `version is ${info.version}`);
    same(await upgraded.getAll('items'), [{ id: 'a', n: 1, tag: 'tag-a' }, { id: 'b', n: 2, tag: 'tag-b' }], 'items differ');
    same(await upgraded.getAll('extra'), [{ id: 'made-by-migration' }], 'new store differs');
    same((await upgraded.getAllFromIndex('items', 'tag', 'tag-b')).map((i) => i.id), ['b'], 'new index differs');
    const copy = await upgraded.getPremigrationCopy();
    assert(copy, 'no pre-upgrade copy was saved');
    same(copy.schemaVersion, 1, 'copy has the wrong version');
    same(copy.stores, { items: originalItems }, 'copy differs from the original data');
    await upgraded.close();
  });

  check('A failing migration changes nothing', async () => {
    const before = createDb(v2);
    const dataBefore = await before.exportStores();
    await before.close();

    const broken = createDb({
      ...v2,
      version: 3,
      migrations: [step12, { from: 2, to: 3, migrate() { throw new Error('deliberate failure'); } }],
    });
    let message = '';
    try {
      await broken.ready();
    } catch (err) {
      message = String(err && err.message);
    }
    assert(message.includes('deliberate failure'), `upgrade did not fail as expected (${message || 'no error'})`);

    const after = createDb(v2);
    const info = await after.describe();
    assert(info.version === 2, `version is ${info.version} after the failed upgrade`);
    same(await after.exportStores(), dataBefore, 'data changed although the upgrade failed');
    await after.close();
  });

  check('A database newer than the app is refused, not downgraded', async () => {
    let message = '';
    try {
      await createDb(v1).ready();
    } catch (err) {
      message = String(err && err.message);
    }
    assert(message !== '', 'opening an older schema on newer data succeeded');
    const still = createDb(v2);
    same((await still.getAll('items')).length, 2, 'data changed');
    await still.close();
  });

  let failed = 0;
  for (const { name, fn } of checks) {
    try {
      await fn();
      report(true, name);
    } catch (err) {
      failed += 1;
      report(false, name, String((err && err.message) || err));
    }
  }
  await main.close();
  return { total: checks.length, failed };
}

/**
 * Runs every check. `report(ok, name, detail)` is called once per check.
 * `fixtureUrl` points at tests/fixtures/backup-v1.json.
 * Returns { total, failed }; throws if the checks could not run at all.
 */
export async function runSelfCheck({ fixtureUrl, report }) {
  await wipeScratch();
  try {
    return await run(fixtureUrl, report);
  } finally {
    await wipeScratch().catch(() => {});
  }
}
