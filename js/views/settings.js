import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { getAppVersion } from '../sw-client.js';
import { db } from '../db.js';
import { SCHEMA_VERSION } from '../logic/schema.js';

const MIN_REMINDER_DAYS = 1;
const MAX_REMINDER_DAYS = 365;

export function mount(container) {
  let alive = true;

  // ----- Backup -----
  const reminderInput = el('input', {
    class: 'input short',
    id: 'reminder-days',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    'aria-describedby': 'reminder-help',
  });
  let savedReminder = null;

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
    window.dispatchEvent(new Event('backup-changed'));
  }
  reminderInput.addEventListener('change', () => saveReminder().catch(showError));
  reminderInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') reminderInput.blur();
  });

  const backupCard = section(
    'Backup',
    el('div', { class: 'row' },
      el('label', { for: 'reminder-days', text: 'Remind me after (days)' }),
      reminderInput
    ),
    el('p', {
      class: 'muted',
      id: 'reminder-help',
      text: 'Your data lives only on this phone. Deleting the app icon from the home screen deletes it, so a backup is the only protection.',
    })
  );

  // ----- Storage and about -----
  const storageValue = el('span', { class: 'value', text: '…' });
  const versionValue = el('span', { class: 'value', text: '…' });
  const aboutCard = section(
    'About',
    el('div', { class: 'row' }, el('span', { text: 'Version' }), versionValue),
    el('hr', { class: 'divider' }),
    el('div', { class: 'row' }, el('span', { text: 'Storage' }), storageValue),
    el('hr', { class: 'divider' }),
    el('div', { class: 'row' }, el('span', { text: 'Data format' }), el('span', { class: 'value', text: `version ${SCHEMA_VERSION}` })),
    el('a', { class: 'btn secondary', href: './tests/browser/', text: 'Run database self-check' })
  );

  container.append(backupCard, aboutCard);

  function showError(err) {
    console.error(err);
    toast('Something went wrong. Nothing was changed.');
  }

  db.getSetting('backupReminderDays')
    .then((days) => {
      if (!alive) return;
      savedReminder = days;
      reminderInput.value = String(days);
    })
    .catch(showError);

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
  };
}
