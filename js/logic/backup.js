// Building, checking and migrating backup files. Pure functions: no DOM, no
// IndexedDB. The file format is described in docs/DATA_MODEL.md.

import { SCHEMA_VERSION, STORES, MIGRATIONS, migrateSnapshot } from './schema.js';
import { formatDate, toDateStr, diffDays } from './dates.js';

export const BACKUP_APP_ID = 'workout-tracker';

/** An error whose message is written for the user and safe to show as is. */
export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Wraps a snapshot of every store in the backup envelope. */
export function buildBackup({ stores, appVersion = null, exportedAt = new Date().toISOString(), schemaVersion = SCHEMA_VERSION }) {
  return { app: BACKUP_APP_ID, schemaVersion, appVersion, exportedAt, stores };
}

/** 'workout-backup-DD-MM-YYYY.json' for the local day of `now`. */
export function backupFilename(now = new Date()) {
  return `workout-backup-${formatDate(toDateStr(now))}.json`;
}

/** Parses the text of a backup file and checks its structure. Throws BackupError. */
export function parseBackup(text, options) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a backup: it could not be read.');
  }
  return validateBackup(data, options);
}

/**
 * Checks that an object is a backup this app can import. Returns it unchanged.
 * Throws BackupError with a message for the user.
 */
export function validateBackup(data, { currentVersion = SCHEMA_VERSION } = {}) {
  if (!isPlainObject(data) || data.app !== BACKUP_APP_ID) {
    throw new BackupError('This file is not a Workout Tracker backup.');
  }
  if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    throw new BackupError('This backup is damaged: its version is missing.');
  }
  if (data.schemaVersion > currentVersion) {
    throw new BackupError('This backup was made by a newer version of the app. Update the app first.');
  }
  if (typeof data.exportedAt !== 'string' || Number.isNaN(Date.parse(data.exportedAt))) {
    throw new BackupError('This backup is damaged: its date is missing.');
  }
  if (!isPlainObject(data.stores)) {
    throw new BackupError('This backup is damaged: it contains no data section.');
  }
  for (const [name, records] of Object.entries(data.stores)) {
    if (!Array.isArray(records) || !records.every(isPlainObject)) {
      throw new BackupError(`This backup is damaged: "${name}" is not a list of records.`);
    }
  }
  return data;
}

/** Record counts for the confirmation dialog. */
export function summarizeBackup(backup) {
  const counts = {};
  let total = 0;
  for (const [name, records] of Object.entries(backup.stores)) {
    counts[name] = records.length;
    total += records.length;
  }
  return { exportedAt: backup.exportedAt, schemaVersion: backup.schemaVersion, counts, total };
}

/**
 * Turns a validated backup into the exact data to write: migrates an older
 * backup, refuses stores this app doesn't know, treats a missing store as
 * empty, and checks every record has its store's key.
 *
 * The one deliberate change: `lastBackupAt` is set to the backup's own
 * `exportedAt`, because after the import the data matches a backup of that age.
 */
export function prepareImport(backup, { schemaVersion = SCHEMA_VERSION, stores = STORES, migrations = MIGRATIONS } = {}) {
  validateBackup(backup, { currentVersion: schemaVersion });

  let data;
  try {
    data = migrateSnapshot(backup.stores, backup.schemaVersion, schemaVersion, migrations);
  } catch (err) {
    throw new BackupError(`This backup could not be converted to the current version (${err.message}).`);
  }

  const known = new Set(stores.map((store) => store.name));
  const unknown = Object.keys(data).filter((name) => !known.has(name));
  if (unknown.length) {
    throw new BackupError(`This backup contains data this app version doesn't know: ${unknown.join(', ')}.`);
  }

  const result = {};
  for (const spec of stores) {
    const records = data[spec.name] || [];
    const seen = new Set();
    for (const record of records) {
      const key = record[spec.keyPath];
      const valid = (typeof key === 'string' && key !== '') || (typeof key === 'number' && Number.isFinite(key));
      if (!valid) {
        throw new BackupError(`This backup is damaged: a record in "${spec.name}" has no ${spec.keyPath}.`);
      }
      if (seen.has(key)) {
        throw new BackupError(`This backup is damaged: "${spec.name}" contains ${key} twice.`);
      }
      seen.add(key);
    }
    result[spec.name] = records;
  }

  if (known.has('settings')) {
    result.settings = result.settings.filter((record) => record.key !== 'lastBackupAt');
    result.settings.push({ key: 'lastBackupAt', value: backup.exportedAt });
  }
  return result;
}

/**
 * The "Last backup" line and whether to show the reminder.
 * - Backed up before: due when it is more than `reminderDays` days ago.
 * - Never backed up: due as soon as there is any data worth protecting.
 */
export function backupStatus({ lastBackupAt, reminderDays, hasData = false, now = new Date() }) {
  if (!lastBackupAt || Number.isNaN(Date.parse(lastBackupAt))) {
    return { days: null, date: null, label: 'Last backup: never', due: Boolean(hasData) };
  }
  const day = toDateStr(lastBackupAt);
  const days = Math.max(0, diffDays(day, toDateStr(now)));
  let ago;
  if (days === 0) ago = 'today';
  else if (days === 1) ago = 'yesterday';
  else ago = `${days} days ago`;
  return {
    days,
    date: formatDate(day),
    label: `Last backup: ${ago}`,
    due: days > reminderDays,
  };
}
