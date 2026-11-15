// The Calendar tab. For now it is the workout history; the month view and
// planning arrive in Phase 3. Routes:
//   #/calendar                    history list
//   #/calendar/<id>               a workout's summary
//   #/calendar/<id>/edit          edit that workout
//   #/calendar/<id>/edit/add      pick an exercise to add to it

import { el, section } from '../ui/dom.js';
import { getLibrary } from '../exercises.js';
import { getWorkout, listCompletedWorkouts } from '../workouts.js';
import { workoutStats } from '../logic/workout.js';
import { formatDate, weekdayName } from '../logic/dates.js';
import { formatWhole } from '../logic/sets.js';
import { mountEditor } from './workout-editor.js';
import { mountExercisePicker } from './exercise-picker.js';
import * as summary from './workout-summary.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function mountHistory(container) {
  let alive = true;
  container.append(el('p', { class: 'muted', text: 'Loading…' }));

  Promise.all([listCompletedWorkouts(), getLibrary()])
    .then(([workouts, library]) => {
      if (!alive) return;
      if (!workouts.length) {
        container.replaceChildren(
          section('History', el('p', { class: 'muted', text: 'Finished workouts appear here. Start one from the Today screen.' }))
        );
        return;
      }
      const nameOf = new Map(library.map((exercise) => [exercise.id, exercise.name]));
      container.replaceChildren(
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
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The history could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}

function mountEdit(container, id, adding) {
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
          ? mountExercisePicker(container, { workout, returnPath: editPath })
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

export function mount(container, params = {}) {
  const [id, action, sub] = params.segments || [];
  if (!id) return mountHistory(container);
  if (action === 'edit') return mountEdit(container, id, sub === 'add');
  return summary.mount(container, { id });
}
