// #/today — start or continue a workout. (Planned workouts arrive with the calendar.)

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { BACKUP_CHANGED, getBackupStatus } from '../backup.js';
import { WORKOUT_CHANGED, getActiveWorkout, startWorkout } from '../workouts.js';
import { formatDate, todayStr, weekdayName } from '../logic/dates.js';
import { isDoneSet } from '../logic/sets.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mount(container) {
  let alive = true;
  const workoutSlot = el('div', { class: 'stack-lg' });
  const reminder = el('p', { class: 'muted reminder', hidden: true });
  container.append(workoutSlot, reminder);

  async function refreshWorkout() {
    const active = await getActiveWorkout();
    if (!alive) return;
    if (active) {
      const ticked = active.exercises.reduce((n, entry) => n + entry.sets.filter(isDoneSet).length, 0);
      workoutSlot.replaceChildren(
        section('Workout in progress',
          el('p', {
            class: 'muted',
            text: [
              active.date === todayStr() ? 'Started today' : `Started ${formatDate(active.date)}`,
              plural(active.exercises.length, 'exercise', 'exercises'),
              `${plural(ticked, 'set', 'sets')} done`,
            ].join(' · '),
          }),
          el('a', { class: 'btn', href: '#/workout', text: 'Continue workout' })
        )
      );
      return;
    }
    const start = el('button', { class: 'btn', type: 'button', text: 'Start workout' });
    start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        await startWorkout();
        location.hash = '#/workout';
      } catch (err) {
        console.error(err);
        toast('The workout could not be started.');
        start.disabled = false;
      }
    });
    const today = todayStr();
    workoutSlot.replaceChildren(
      section(`${weekdayName(today)} ${formatDate(today)}`,
        el('p', { class: 'muted', text: 'Nothing is planned yet. Start an empty workout and add exercises as you go.' }),
        start
      )
    );
  }
  const onWorkoutChanged = () => refreshWorkout().catch((err) => console.error(err));
  window.addEventListener(WORKOUT_CHANGED, onWorkoutChanged);
  onWorkoutChanged();

  // A gentle backup reminder: one muted line, only when a backup is due.
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
    window.removeEventListener(WORKOUT_CHANGED, onWorkoutChanged);
    window.removeEventListener(BACKUP_CHANGED, onBackupChanged);
  };
}
