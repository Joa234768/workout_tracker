// The Calendar tab. Routes:
//   #/calendar                        month view
//   #/calendar/history                list of finished workouts
//   #/calendar/plan                   weekly plan and routines
//   #/calendar/plan/edit              change the weekly plan
//   #/calendar/routines/<id>          edit a routine
//   #/calendar/routines/<id>/add      pick an exercise for a routine
//   #/calendar/<workoutId>            a workout's summary
//   #/calendar/<workoutId>/edit       edit that workout
//   #/calendar/<workoutId>/edit/add   pick an exercise to add to it
// Workout ids are UUIDs, so they never collide with the words above.

import { el, section } from '../ui/dom.js';
import { getLibrary } from '../exercises.js';
import { getWorkout, listCompletedWorkouts } from '../workouts.js';
import { workoutStats } from '../logic/workout.js';
import { formatDate, weekdayName } from '../logic/dates.js';
import { formatWhole } from '../logic/sets.js';
import { mountEditor } from './workout-editor.js';
import { mountWorkoutExercisePicker } from './exercise-picker.js';
import * as summary from './workout-summary.js';
import * as month from './calendar-month.js';
import * as plan from './plan.js';
import * as routineEditor from './routine-editor.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function mountHistory(container) {
  let alive = true;
  const body = el('div', { class: 'stack-lg' }, el('p', { class: 'muted', text: 'Loading…' }));
  container.append(month.viewSwitch('list'), body);

  Promise.all([listCompletedWorkouts(), getLibrary()])
    .then(([workouts, library]) => {
      if (!alive) return;
      if (!workouts.length) {
        body.replaceChildren(
          section('History', el('p', { class: 'muted', text: 'Finished workouts appear here. Start one from the Today screen.' }))
        );
        return;
      }
      const nameOf = new Map(library.map((exercise) => [exercise.id, exercise.name]));
      body.replaceChildren(
        el('p', { class: 'muted', text: plural(workouts.length, 'workout', 'workouts') }),
        el('ul', { class: 'list' },
          workouts.map((workout) => {
            const stats = workoutStats(workout);
            const facts = [
              workout.routineName,
              plural(stats.exercises, 'exercise', 'exercises'),
              plural(stats.sets, 'set', 'sets'),
              stats.volume > 0 ? `${formatWhole(stats.volume)} kg` : null,
            ].filter(Boolean).join(' · ');
            const names = workout.exercises.map((entry) => nameOf.get(entry.exerciseId) || entry.exerciseId).join(', ');
            return el('li', { class: 'list-row' },
              el('a', { class: 'list-link padded', href: `#/calendar/${encodeURIComponent(workout.id)}` },
                el('span', { class: 'list-title', text: `${weekdayName(workout.date)} ${formatDate(workout.date)}` }),
                el('span', { class: 'muted', text: facts }),
                el('span', { class: 'muted one-line', text: names })
              )
            );
          })
        )
      );
    })
    .catch((err) => {
      console.error(err);
      if (alive) body.replaceChildren(el('p', { class: 'muted', text: 'The history could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}

function mountWorkoutEdit(container, id, adding) {
  let alive = true;
  let cleanup = null;
  const editPath = `#/calendar/${encodeURIComponent(id)}/edit`;
  container.append(el('p', { class: 'muted', text: 'Loading…' }));

  getWorkout(id)
    .then((workout) => {
      if (!alive) return;
      container.replaceChildren();
      if (!workout) {
        container.append(summary.notFound());
      } else if (workout.status === 'active') {
        location.replace(adding ? '#/workout/add' : '#/workout'); // the workout in progress has its own screen
      } else {
        cleanup = adding
          ? mountWorkoutExercisePicker(container, { workout, returnPath: editPath })
          : mountEditor(container, { workout, mode: 'edit', basePath: editPath });
      }
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The workout could not be loaded.' }));
    });

  return () => {
    alive = false;
    if (cleanup) cleanup();
  };
}

// The back arrow goes up one level, which can land on an address that is
// only a prefix (e.g. #/calendar/routines). Send those to the right screen.
function redirect(container, hash) {
  location.replace(hash);
  return () => {};
}

export function mount(container, params = {}) {
  const [first, second, third] = params.segments || [];
  if (!first) return month.mount(container);
  if (first === 'history') return mountHistory(container);
  if (first === 'plan') return plan.mount(container, { edit: second === 'edit' });
  if (first === 'routines') {
    if (!second) return redirect(container, '#/calendar/plan');
    return routineEditor.mount(container, { id: second, adding: third === 'add' });
  }
  if (second === 'edit') return mountWorkoutEdit(container, first, third === 'add');
  return summary.mount(container, { id: first });
}
