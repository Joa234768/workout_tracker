import { el, placeholder } from '../ui/dom.js';
import { BACKUP_CHANGED, getBackupStatus } from '../backup.js';

export function mount(container) {
  let alive = true;

  placeholder(container, 'No workout yet', 'Planned workouts and the Start button arrive with workout logging.');

  // A gentle backup reminder: one muted line, only when a backup is due.
  const reminder = el('p', { class: 'muted reminder', hidden: true });
  container.append(reminder);

  async function refreshReminder() {
    const status = await getBackupStatus();
    if (!alive) return;
    reminder.hidden = !status.due;
    if (!status.due) return;
    const lead = status.days === null ? "You haven't made a backup yet." : `${status.label}.`;
    reminder.replaceChildren(`${lead} `, el('a', { href: '#/settings', text: 'Back up in Settings' }));
  }
  const onBackupChanged = () => refreshReminder().catch((err) => console.error(err));
  window.addEventListener(BACKUP_CHANGED, onBackupChanged);
  onBackupChanged();

  return () => {
    alive = false;
    window.removeEventListener(BACKUP_CHANGED, onBackupChanged);
  };
}
