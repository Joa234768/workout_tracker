// #/today — today's planned workout with a big Start button, or a rest day
// with the option to train anyway. Also continues a workout in progress.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { actionSheet } from '../ui/dialog.js';
import { BACKUP_CHANGED, getBackupStatus } from '../backup.js';
import { WORKOUT_CHANGED, startWorkout } from '../workouts.js';
import { PLAN_CHANGED, loadPlanData } from '../plan.js';
import { getLibrary } from '../exercises.js';
import { calendarDays, nextPlanned } from '../logic/plan.js';
import { workoutStats } from '../logic/workout.js';
import { formatDate, todayStr, weekdayName } from '../logic/dates.js';
import { isDoneSet } from '../logic/sets.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mount(container) {
  let alive = true;
  const slot = el('div', { class: 'stack-lg' });
  const reminder = el('p', { class: 'muted reminder', hidden: true });
  container.append(slot, reminder);

  async function begin(options) {
    try {
      await startWorkout(options);
      location.hash = '#/workout';
    } catch (err) {
      console.error(err);
      toast('The workout could not be started.');
    }
  }

  async function refresh() {
    const [data, library] = await Promise.all([loadPlanData(), getLibrary()]);
    if (!alive) return;
    const today = todayStr();
    const dateLine = `${weekdayName(today)} ${formatDate(today)}`;
    const routines = data.routines.filter((routine) => !routine.archivedAt);
    const routineById = new Map(data.routines.map((routine) => [routine.id, routine]));
    const exerciseName = new Map(library.map((exercise) => [exercise.id, exercise.name]));

    // Starting something that is not planned: choose a routine, or go empty.
    async function startUnplanned() {
      if (!routines.length) return begin({});
      const choice = await actionSheet({
        title: 'Start a workout',
        actions: [
          ...routines.map((routine) => ({ label: routine.name, value: routine.id })),
          { label: 'Empty workout', value: 'empty' },
        ],
      });
      if (choice === null) return undefined;
      return begin(choice === 'empty' ? {} : { routine: routineById.get(choice) });
    }
    const otherButton = (label, style = 'btn plain') => el('button', { class: style, type: 'button', text: label, onclick: startUnplanned });

    const active = data.workouts.find((workout) => workout.status === 'active');
    const cards = [];

    if (active) {
      const ticked = active.exercises.reduce((n, entry) => n + entry.sets.filter(isDoneSet).length, 0);
      cards.push(
        section(active.routineName ? `In progress: ${active.routineName}` : 'Workout in progress',
          el('p', {
            class: 'muted',
            text: [
              active.date === today ? 'Started today' : `For ${formatDate(active.date)}`,
              plural(active.exercises.length, 'exercise', 'exercises'),
              `${plural(ticked, 'set', 'sets')} done`,
            ].join(' · '),
          }),
          el('a', { class: 'btn', href: '#/workout', text: 'Continue workout' })
        )
      );
    } else {
      const entries = calendarDays(today, today, { ...data, today })[today] || [];
      const planned = entries.filter((entry) => entry.state === 'planned');
      const done = entries.filter((entry) => entry.state === 'completed');
      const cancelled = entries.some((entry) => entry.state === 'cancelled');

      for (const entry of done) {
        const stats = workoutStats(entry.workout);
        cards.push(
          section(`Done today: ${entry.workout.routineName || 'Workout'}`,
            el('p', { class: 'muted', text: `${plural(stats.exercises, 'exercise', 'exercises')} · ${plural(stats.sets, 'set', 'sets')}` }),
            el('a', { class: 'btn secondary', href: `#/calendar/${encodeURIComponent(entry.workout.id)}`, text: 'View workout' })
          )
        );
      }

      for (const { occurrence } of planned) {
        const routine = routineById.get(occurrence.routineId) || null;
        const start = el('button', { class: 'btn big', type: 'button', text: 'Start workout' });
        start.addEventListener('click', () => begin({ routine, plannedRef: occurrence.ref }));
        cards.push(
          section(routine ? routine.name : 'Planned workout',
            el('p', { class: 'muted', text: `Planned for today · ${dateLine}` }),
            routine && routine.exercises.length
              ? el('ul', { class: 'plain-list muted' },
                  routine.exercises.map((exercise) =>
                    el('li', { text: `${exerciseName.get(exercise.exerciseId) || exercise.exerciseId} · ${exercise.sets} × ${exercise.repMin}–${exercise.repMax}` })
                  )
                )
              : null,
            start
          )
        );
      }

      if (planned.length) {
        cards.push(otherButton('Start a different workout'));
      } else if (done.length) {
        cards.push(otherButton('Start another workout'));
      } else {
        cards.push(
          section('Rest day',
            el('p', { class: 'muted', text: cancelled ? `Today's workout is cancelled · ${dateLine}` : `Nothing planned · ${dateLine}` }),
            otherButton('Start a workout anyway', 'btn secondary')
          )
        );
      }
    }

    const next = nextPlanned(today, data);
    if (next) {
      const routine = routineById.get(next.routineId);
      cards.push(el('p', { class: 'muted hint', text: `Next: ${weekdayName(next.date)} ${formatDate(next.date)}${routine ? ` · ${routine.name}` : ''}` }));
    } else if (!data.rules.length && !active) {
      cards.push(el('p', { class: 'muted hint' }, 'Plan your week under ', el('a', { href: '#/calendar/plan', text: 'Plan & routines' }), '.'));
    }

    slot.replaceChildren(...cards);
  }
  const onChange = () => refresh().catch((err) => console.error(err));
  window.addEventListener(WORKOUT_CHANGED, onChange);
  window.addEventListener(PLAN_CHANGED, onChange);
  onChange();

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
    window.removeEventListener(WORKOUT_CHANGED, onChange);
    window.removeEventListener(PLAN_CHANGED, onChange);
    window.removeEventListener(BACKUP_CHANGED, onBackupChanged);
  };
}
