// Backup export and import: the parts that touch the database, the share
// sheet and files. The format and all checks live in js/logic/backup.js.

import { db } from './db.js';
import { getAppVersion } from './sw-client.js';
import { SCHEMA_VERSION } from './logic/schema.js';
import { formatTimestampDate } from './logic/dates.js';
import { notifyWorkoutChanged } from './workouts.js';
import {
  buildBackup, backupFilename, backupStatus, parseBackup, prepareImport, summarizeBackup,
} from './logic/backup.js';

/** Fired on window whenever the "last backup" state may have changed. */
export const BACKUP_CHANGED = 'backup-changed';

export function notifyBackupChanged() {
  window.dispatchEvent(new Event(BACKUP_CHANGED));
}

/** { days, date, label, due } for the "Last backup" line and the reminder. */
export async function getBackupStatus() {
  const [lastBackupAt, reminderDays, hasData] = await Promise.all([
    db.getSetting('lastBackupAt'),
    db.getSetting('backupReminderDays'),
    db.hasUserData(),
  ]);
  return backupStatus({ lastBackupAt, reminderDays, hasData });
}

// The share sheet only opens shortly after a tap, so never wait long here.
function quickAppVersion() {
  return Promise.race([getAppVersion(), new Promise((resolve) => setTimeout(() => resolve(null), 300))]);
}

function toFile(backup, filename) {
  return new File([JSON.stringify(backup, null, 2)], filename, { type: 'application/json' });
}

/** Reads every store and builds the backup file. Returns { file, exportedAt, countsAsBackup }. */
export async function prepareBackupFile() {
  const now = new Date();
  const [stores, appVersion] = await Promise.all([db.exportStores(), quickAppVersion()]);
  const backup = buildBackup({ stores, appVersion, exportedAt: now.toISOString() });
  return { file: toFile(backup, backupFilename(now)), exportedAt: backup.exportedAt, countsAsBackup: true };
}

/** The copy saved before the last data-format update, as a backup file. Null if there is none. */
export async function preparePremigrationFile() {
  const copy = await db.getPremigrationCopy();
  if (!copy) return null;
  const backup = buildBackup({
    stores: copy.stores,
    appVersion: null,
    exportedAt: copy.savedAt,
    schemaVersion: copy.schemaVersion,
  });
  const filename = `workout-backup-before-update-${formatTimestampDate(copy.savedAt)}.json`;
  return { file: toFile(backup, filename), exportedAt: copy.savedAt, countsAsBackup: false };
}

/** When the pre-update copy was saved (ISO timestamp), or null. */
export async function getPremigrationDate() {
  const copy = await db.getPremigrationCopy();
  return copy ? copy.savedAt : null;
}

/**
 * Reads and fully checks a picked file, without changing anything.
 * Returns { backup, summary, data } where `data` is exactly what an import
 * would write. Throws BackupError (message is for the user) if it is refused.
 */
export async function readBackupFile(file) {
  const backup = parseBackup(await file.text());
  return { backup, summary: summarizeBackup(backup), data: prepareImport(backup) };
}

/** Replaces all data with a checked backup, in one transaction. */
export async function importBackup(checked) {
  await db.replaceAll(checked.data);
  notifyBackupChanged();
  notifyWorkoutChanged(); // the workout in progress may have appeared or gone
  window.dispatchEvent(new Event('plan-changed'));
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Hands a prepared file to the user. Returns:
 * - 'shared'     the share sheet completed (e.g. Save to Files → iCloud Drive)
 * - 'cancelled'  the share sheet was dismissed; nothing was saved
 * - 'needs-tap'  iOS refused because the tap is too old; call again from a fresh tap
 * - 'downloaded' sharing files isn't supported, so the file was downloaded instead
 */
export async function deliverBackupFile(prepared) {
  let outcome = null;
  const canShareFile = navigator.canShare && navigator.canShare({ files: [prepared.file] });
  if (canShareFile) {
    try {
      await navigator.share({ files: [prepared.file] });
      outcome = 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      if (err && err.name === 'NotAllowedError') return 'needs-tap';
      console.error(err); // fall back to a download
    }
  }
  if (!outcome) {
    download(prepared.file);
    outcome = 'downloaded';
  }
  if (prepared.countsAsBackup) {
    await db.setSetting('lastBackupAt', prepared.exportedAt);
    notifyBackupChanged();
  }
  return outcome;
}
