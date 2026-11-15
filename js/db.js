// The only module that talks to IndexedDB.
//
// The schema and the migration steps are data in js/logic/schema.js. This
// module applies them. An upgrade runs in a single transaction: if anything
// fails, IndexedDB rolls it back and the old version and its data stay.
// See docs/DATA_MODEL.md.

import {
  DB_NAME, PREMIGRATION_DB_NAME, SCHEMA_VERSION, STORES, MIGRATIONS, SETTING_DEFAULTS,
  migrateSnapshot, droppedStores,
} from './logic/schema.js';
import { deriveExerciseIds } from './logic/workout.js';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('The database transaction was aborted'));
    tx.onerror = () => {}; // the abort handler reports it
  });
}

/** Opens a database without the app schema (used for the pre-upgrade copy). */
function openRaw(name, version, onUpgrade) {
  return new Promise((resolve, reject) => {
    const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
    request.onupgradeneeded = () => onUpgrade && onUpgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Database ${name} is blocked by another open copy of the app`));
  });
}

async function readAllStores(db) {
  const names = [...db.objectStoreNames];
  const out = {};
  if (!names.length) return out;
  const tx = db.transaction(names, 'readonly');
  await Promise.all(
    names.map(async (name) => {
      out[name] = await requestToPromise(tx.objectStore(name).getAll());
    })
  );
  return out;
}

function sameIndex(index, spec) {
  return (
    JSON.stringify(index.keyPath) === JSON.stringify(spec.keyPath) &&
    index.unique === Boolean(spec.unique) &&
    index.multiEntry === Boolean(spec.multiEntry)
  );
}

/**
 * Makes the stores and indexes match the spec. Never deletes a store that
 * holds data without it being rewritten: returns the names of stores that
 * were created or re-created, which the caller must fill.
 */
function applySchema(db, tx, stores) {
  const created = new Set();
  for (const spec of stores) {
    let store;
    if (!db.objectStoreNames.contains(spec.name)) {
      store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
      created.add(spec.name);
    } else {
      store = tx.objectStore(spec.name);
      if (JSON.stringify(store.keyPath) !== JSON.stringify(spec.keyPath)) {
        db.deleteObjectStore(spec.name);
        store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
        created.add(spec.name);
      }
    }
    const wanted = spec.indexes || [];
    for (const indexName of [...store.indexNames]) {
      const indexSpec = wanted.find((i) => i.name === indexName);
      if (!indexSpec || !sameIndex(store.index(indexName), indexSpec)) store.deleteIndex(indexName);
    }
    for (const indexSpec of wanted) {
      if (!store.indexNames.contains(indexSpec.name)) {
        store.createIndex(indexSpec.name, indexSpec.keyPath, {
          unique: Boolean(indexSpec.unique),
          multiEntry: Boolean(indexSpec.multiEntry),
        });
      }
    }
  }
  return created;
}

/**
 * Creates a database handle. The app uses the default export `db`; the
 * self-check page passes its own names and schema to test in a scratch database.
 */
export function createDb({
  name = DB_NAME,
  version = SCHEMA_VERSION,
  stores = STORES,
  migrations = MIGRATIONS,
  premigrationName = PREMIGRATION_DB_NAME,
  settingDefaults = SETTING_DEFAULTS,
} = {}) {
  let dbPromise = null;

  async function savePremigrationCopy(schemaVersion, snapshot) {
    const pre = await openRaw(premigrationName, 1, (db) => {
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
    });
    try {
      const tx = pre.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({
        id: 'latest',
        schemaVersion,
        savedAt: new Date().toISOString(),
        stores: snapshot,
      });
      await transactionDone(tx);
    } finally {
      pre.close();
    }
  }

  /** The version currently on disk: 0 if the database doesn't exist, null if unknown. */
  async function versionOnDisk() {
    if (typeof indexedDB.databases !== 'function') return null;
    const list = await indexedDB.databases();
    const hit = list.find((entry) => entry.name === name);
    return hit ? hit.version : 0;
  }

  // Runs inside the upgrade transaction. Uses plain callbacks so the
  // transaction can never auto-commit between steps.
  function upgrade(db, tx, oldVersion, report) {
    if (oldVersion === 0) {
      applySchema(db, tx, stores);
      return;
    }
    const names = [...db.objectStoreNames];
    const snapshot = {};
    let pending = names.length;

    const proceed = () => {
      try {
        report.captured = { schemaVersion: oldVersion, stores: snapshot };
        const migrated = migrateSnapshot(snapshot, oldVersion, version, migrations);
        for (const dropped of droppedStores(oldVersion, version, migrations)) {
          if (db.objectStoreNames.contains(dropped)) db.deleteObjectStore(dropped);
        }
        const created = applySchema(db, tx, stores);
        for (const spec of stores) {
          const before = snapshot[spec.name] || [];
          const after = migrated[spec.name] || [];
          if (!created.has(spec.name) && JSON.stringify(before) === JSON.stringify(after)) continue;
          const store = tx.objectStore(spec.name);
          store.clear();
          for (const record of after) store.add(record);
        }
      } catch (err) {
        report.error = err;
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
      }
    };

    if (!pending) {
      proceed();
      return;
    }
    for (const storeName of names) {
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => {
        snapshot[storeName] = request.result;
        pending -= 1;
        if (pending === 0) proceed();
      };
    }
  }

  async function open() {
    const onDisk = await versionOnDisk();
    if (onDisk !== null && onDisk > version) {
      throw new Error('The saved data comes from a newer version of the app. Update the app.');
    }

    // Before an upgrade, keep a copy of the data exactly as it was.
    let copied = false;
    if (onDisk !== null && onDisk > 0 && onDisk < version) {
      const oldDb = await openRaw(name);
      let snapshot;
      const oldVersion = oldDb.version;
      try {
        snapshot = await readAllStores(oldDb);
      } finally {
        oldDb.close();
      }
      await savePremigrationCopy(oldVersion, snapshot);
      copied = true;
    }

    const report = { captured: null, error: null };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = (event) => {
        try {
          upgrade(request.result, request.transaction, event.oldVersion, report);
        } catch (err) {
          report.error = err;
          request.transaction.abort();
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(report.error || request.error);
      request.onblocked = () =>
        reject(new Error('The database is in use by another open copy of the app. Close it and try again.'));
    });

    // Fallback for browsers without indexedDB.databases(): the upgrade
    // captured the old data, so save the copy now.
    if (report.captured && !copied) {
      try {
        await savePremigrationCopy(report.captured.schemaVersion, report.captured.stores);
      } catch (err) {
        console.error('Could not save the pre-upgrade copy', err);
      }
    }

    // If another copy of the app needs to upgrade, let it.
    db.onversionchange = () => {
      db.close();
      dbPromise = null;
    };
    return db;
  }

  function ready() {
    if (!dbPromise) {
      dbPromise = open().catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function withStore(storeName, mode, work) {
    const db = await ready();
    const tx = db.transaction(storeName, mode);
    const done = transactionDone(tx);
    done.catch(() => {}); // a failed request is reported by the line below
    const result = await requestToPromise(work(tx.objectStore(storeName)));
    await done;
    return result;
  }

  const api = {
    /** Opens the database (creating or upgrading it if needed). */
    ready: () => ready().then(() => undefined),

    get: (storeName, key) => withStore(storeName, 'readonly', (s) => s.get(key)).then((r) => r ?? null),
    getAll: (storeName) => withStore(storeName, 'readonly', (s) => s.getAll()),
    put: (storeName, record) => withStore(storeName, 'readwrite', (s) => s.put(record)),
    remove: (storeName, key) => withStore(storeName, 'readwrite', (s) => s.delete(key)),

    /**
     * Records from an index. `query` is a single key, or { lower, upper }
     * (either may be omitted) for an inclusive range.
     */
    getAllFromIndex(storeName, indexName, query) {
      let range = query;
      if (query && typeof query === 'object' && !Array.isArray(query)) {
        const { lower, upper } = query;
        if (lower != null && upper != null) range = IDBKeyRange.bound(lower, upper);
        else if (lower != null) range = IDBKeyRange.lowerBound(lower);
        else if (upper != null) range = IDBKeyRange.upperBound(upper);
        else range = undefined;
      }
      return withStore(storeName, 'readonly', (s) => s.index(indexName).getAll(range));
    },

    /** A setting's stored value, or its default. */
    async getSetting(key) {
      const record = await api.get('settings', key);
      if (record) return record.value;
      return key in settingDefaults ? structuredClone(settingDefaults[key]) : null;
    },
    setSetting: (key, value) => api.put('settings', { key, value }),

    /**
     * Saves a workout. Two rules are enforced here, for every caller:
     * - `exerciseIds` (used by the index) is always derived from `exercises`.
     * - There is at most one workout with status 'active'. Saving a second
     *   one fails and changes nothing.
     * Returns the record as stored.
     */
    async saveWorkout(workout) {
      const db = await ready();
      const tx = db.transaction('workouts', 'readwrite');
      const done = transactionDone(tx);
      done.catch(() => {}); // failures are reported by the awaits below
      const store = tx.objectStore('workouts');
      const record = { ...workout, exerciseIds: deriveExerciseIds(workout) };
      if (record.status === 'active') {
        const active = await requestToPromise(store.index('status').getAll('active'));
        if (active.some((other) => other.id !== record.id)) {
          tx.abort();
          throw new Error('Another workout is already in progress.');
        }
      }
      await requestToPromise(store.put(record));
      await done;
      return record;
    },

    /** Every store's records: { storeName: records[] }. Loops over the real store list. */
    async exportStores() {
      return readAllStores(await ready());
    },

    /**
     * Replaces the contents of every store in one transaction. Stores missing
     * from `data` end up empty. If anything fails, nothing changes.
     */
    async replaceAll(data) {
      const db = await ready();
      const names = [...db.objectStoreNames];
      const unknown = Object.keys(data).filter((key) => !names.includes(key));
      if (unknown.length) throw new Error(`Unknown stores: ${unknown.join(', ')}`);
      const tx = db.transaction(names, 'readwrite');
      const done = transactionDone(tx);
      try {
        for (const storeName of names) {
          const store = tx.objectStore(storeName);
          store.clear();
          for (const record of data[storeName] || []) store.add(record);
        }
      } catch (err) {
        try {
          tx.abort();
        } catch {
          /* already aborting */
        }
        await done.catch(() => {});
        throw err;
      }
      await done;
    },

    /** True when any store other than settings holds a record. */
    async hasUserData() {
      const db = await ready();
      const names = [...db.objectStoreNames].filter((n) => n !== 'settings');
      if (!names.length) return false;
      const tx = db.transaction(names, 'readonly');
      const counts = await Promise.all(names.map((n) => requestToPromise(tx.objectStore(n).count())));
      return counts.some((count) => count > 0);
    },

    /** The copy saved before the last schema upgrade: { schemaVersion, savedAt, stores } or null. */
    async getPremigrationCopy() {
      const pre = await openRaw(premigrationName, 1, (db) => {
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'id' });
      });
      try {
        const tx = pre.transaction('snapshots', 'readonly');
        const record = await requestToPromise(tx.objectStore('snapshots').get('latest'));
        return record || null;
      } finally {
        pre.close();
      }
    },

    /** The live structure, for the self-check page. */
    async describe() {
      const db = await ready();
      const names = [...db.objectStoreNames];
      const out = { version: db.version, stores: {} };
      if (!names.length) return out;
      const tx = db.transaction(names, 'readonly');
      for (const storeName of names) {
        const store = tx.objectStore(storeName);
        out.stores[storeName] = {
          keyPath: store.keyPath,
          indexes: [...store.indexNames].map((indexName) => {
            const index = store.index(indexName);
            return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
          }),
        };
      }
      return out;
    },

    async close() {
      if (!dbPromise) return;
      const db = await dbPromise.catch(() => null);
      if (db) db.close();
      dbPromise = null;
    },

    /** Deletes this database and its pre-upgrade copy. Only the self-check page uses this. */
    async destroy() {
      await api.close();
      await requestToPromise(indexedDB.deleteDatabase(name));
      await requestToPromise(indexedDB.deleteDatabase(premigrationName));
    },
  };

  return api;
}

/** The app's database. */
export const db = createDb();
