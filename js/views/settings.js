import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { exportButton } from '../ui/export-button.js';
import { getAppVersion } from '../sw-client.js';
import { db } from '../db.js';
import { SCHEMA_VERSION } from '../logic/schema.js';
import { formatTimestampDate } from '../logic/dates.js';
import { confirmDialog } from '../ui/dialog.js';
import * as selfcheck from './selfcheck.js';
import * as volumeSettings from './volume-settings.js';
import { BackupError } from '../logic/backup.js';
import {
  BACKUP_CHANGED, notifyBackupChanged, getBackupStatus,
  prepareBackupFile, prepareCsvFile, preparePremigrationFile, getPremigrationDate,
  readBackupFile, importBackup,
} from '../backup.js';

const MIN_REMINDER_DAYS = 1;
const MAX_REMINDER_DAYS = 365;

// [store, singular, plural] — what the import confirmation calls each store.
const STORE_LABELS = [
  ['workouts', 'workout', 'workouts'],
  ['routines', 'routine', 'routines'],
  ['planRules', 'plan', 'plans'],
  ['planExceptions', 'plan change', 'plan changes'],
  ['plannedOneOffs', 'one-off planned workout', 'one-off planned workouts'],
  ['customExercises', 'custom exercise', 'custom exercises'],
  ['exerciseOverrides', 'edited exercise', 'edited exercises'],
  ['bodyWeights', 'body-weight entry', 'body-weight entries'],
  ['settings', 'setting', 'settings'],
];

export function mount(container, params = {}) {
  // Sub-screen: #/settings/selfcheck
  if (params.segments && params.segments[0] === 'selfcheck') return selfcheck.mount(container);
  // Sub-screen: #/settings/volume
  if (params.segments && params.segments[0] === 'volume') return volumeSettings.mount(container);

  let alive = true;

  function showError(err) {
    console.error(err);
    toast('Something went wrong. Nothing was changed.');
  }

  // ----- Backup: export and "last backup" line -----
  const lastBackupLine = el('p', { class: 'muted', text: 'Last backup: …' });

  async function refreshStatus() {
    const status = await getBackupStatus();
    if (!alive) return;
    let text = status.date ? `${status.label} · ${status.date}` : status.label;
    if (status.due) text += status.date ? ' — time for a new one' : ' — make your first one';
    lastBackupLine.textContent = text;
    lastBackupLine.classList.toggle('attention', status.due);
  }
  const onBackupChanged = () => refreshStatus().catch(showError);
  window.addEventListener(BACKUP_CHANGED, onBackupChanged);

  // ----- Backup: import -----
  const fileInput = el('input', {
    class: 'visually-hidden',
    type: 'file',
    accept: '.json,application/json',
    'aria-label': 'Import backup',
  });
  const importLabel = el('label', { class: 'btn secondary' }, 'Import backup', fileInput);

  async function handleFile(file) {
    let checked;
    try {
      checked = await readBackupFile(file);
    } catch (err) {
      const message = err instanceof BackupError ? err.message : 'This file could not be read.';
      if (!(err instanceof BackupError)) console.error(err);
      await confirmDialog({ title: 'Not imported', lines: [message, 'Nothing was changed.'], cancelLabel: null });
      return;
    }

    const { summary } = checked;
    const contents = STORE_LABELS.filter(([name]) => summary.counts[name] > 0).map(
      ([name, one, many]) => `${summary.counts[name]} ${summary.counts[name] === 1 ? one : many}`
    );
    const confirmed = await confirmDialog({
      title: 'Replace all data?',
      lines: [
        `This backup is from ${formatTimestampDate(summary.exportedAt)}.`,
        contents.length ? `It contains ${contents.join(', ')}.` : 'It contains no data.',
        'Everything currently in the app will be replaced by the backup. This cannot be undone.',
      ],
      confirmLabel: 'Replace my data',
      danger: true,
      extra: exportButton({ label: 'Export current data first', prepare: prepareBackupFile, secondary: true }),
    });
    if (!confirmed) return;

    try {
      await importBackup(checked);
    } catch (err) {
      console.error(err);
      await confirmDialog({
        title: 'Not imported',
        lines: ['The backup could not be restored.', 'Nothing was changed.'],
        cancelLabel: null,
      });
      return;
    }
    await Promise.all([refreshStatus(), loadReminder()]);
    toast('Backup restored.');
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // so the same file can be picked again
    if (file) handleFile(file).catch(showError);
  });

  // ----- Backup: reminder interval -----
  const reminderInput = el('input', {
    class: 'input short',
    id: 'reminder-days',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
  });
  let savedReminder = null;

  async function loadReminder() {
    const days = await db.getSetting('backupReminderDays');
    if (!alive) return;
    savedReminder = days;
    reminderInput.value = String(days);
  }

  async function saveReminder() {
    const days = Number(reminderInput.value.trim());
    if (!Number.isInteger(days) || days < MIN_REMINDER_DAYS || days > MAX_REMINDER_DAYS) {
      reminderInput.value = savedReminder ?? '';
      toast(`Enter a whole number of days from ${MIN_REMINDER_DAYS} to ${MAX_REMINDER_DAYS}.`);
      return;
    }
    if (days === savedReminder) return;
    await db.setSetting('backupReminderDays', days);
    savedReminder = days;
    reminderInput.value = String(days);
    notifyBackupChanged();
  }
  reminderInput.addEventListener('change', () => saveReminder().catch(showError));
  reminderInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') reminderInput.blur();
  });

  // ----- Backup: copy kept from before the last data-format update -----
  const premigrationSlot = el('div', { class: 'stack', hidden: true });
  getPremigrationDate()
    .then((savedAt) => {
      if (!alive || !savedAt) return;
      premigrationSlot.append(
        el('hr', { class: 'divider' }),
        el('p', {
          class: 'muted',
          text: `A copy of your data from before the last update of the data format (${formatTimestampDate(savedAt)}) is kept on this phone.`,
        }),
        exportButton({ label: 'Export that copy', prepare: preparePremigrationFile, secondary: true })
      );
      premigrationSlot.hidden = false;
    })
    .catch((err) => console.error(err));

  const backupCard = section(
    'Backup',
    exportButton({ label: 'Export backup', prepare: prepareBackupFile }),
    lastBackupLine,
    importLabel,
    el('hr', { class: 'divider' }),
    el('div', { class: 'row' },
      el('label', { for: 'reminder-days', text: 'Remind me after (days)' }),
      reminderInput
    ),
    el('p', {
      class: 'muted',
      text: 'Your data lives only on this phone. Deleting the app icon from the home screen deletes it, so a backup is the only protection. Choose "Save to Files" to keep it in iCloud Drive.',
    }),
    premigrationSlot
  );

  // ----- About -----
  const storageValue = el('span', { class: 'value', text: '…' });
  const versionValue = el('span', { class: 'value', text: '…' });
  const aboutCard = section(
    'About',
    el('div', { class: 'row' }, el('span', { text: 'Version' }), versionValue),
    el('hr', { class: 'divider' }),
    el('div', { class: 'row' }, el('span', { text: 'Storage' }), storageValue),
    el('hr', { class: 'divider' }),
    el('div', { class: 'row' }, el('span', { text: 'Data format' }), el('span', { class: 'value', text: `version ${SCHEMA_VERSION}` })),
    el('a', { class: 'btn secondary', href: '#/settings/selfcheck', text: 'Run database self-check' })
  );

  const volumeCard = section(
    'Muscle volume',
    el('p', { class: 'muted', text: 'Weekly set targets per muscle group, and how sets are counted.' }),
    el('a', { class: 'btn secondary', href: '#/settings/volume', text: 'Targets and counting' })
  );

  const csvCard = section(
    'Spreadsheet export',
    el('p', { class: 'muted', text: 'Every set you have logged as a CSV file, one row per set, for Numbers or Excel. It cannot be imported again; use the backup for that.' }),
    exportButton({ label: 'Export sets as CSV', prepare: prepareCsvFile, secondary: true, noun: 'File' })
  );

  container.append(backupCard, volumeCard, csvCard, aboutCard);

  refreshStatus().catch(showError);
  loadReminder().catch(showError);

  getAppVersion().then((version) => {
    if (alive) versionValue.textContent = version || 'unknown';
  });

  const persisted = navigator.storage && navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false);
  persisted
    .catch(() => false)
    .then((granted) => {
      if (alive) storageValue.textContent = granted ? 'persistent' : 'not granted';
    });

  return () => {
    alive = false;
    window.removeEventListener(BACKUP_CHANGED, onBackupChanged);
  };
}
