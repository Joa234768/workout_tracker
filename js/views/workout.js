// The workout in progress. Routes:
//   #/workout        log sets
//   #/workout/add    pick an exercise to add

import { el, section } from '../ui/dom.js';
import { getActiveWorkout } from '../workouts.js';
import { mountEditor } from './workout-editor.js';
import { mountWorkoutExercisePicker } from './exercise-picker.js';

export function mount(container, params = {}) {
  let alive = true;
  let cleanup = null;
  const adding = (params.segments || [])[0] === 'add';

  container.append(el('p', { class: 'muted', text: 'Loading…' }));
  getActiveWorkout()
    .then((workout) => {
      if (!alive) return;
      container.replaceChildren();
      if (!workout) {
        container.append(
          section('No workout in progress',
            el('p', { class: 'muted', text: 'Start one from the Today screen.' }),
            el('a', { class: 'btn', href: '#/today', text: 'Go to Today' })
          )
        );
        return;
      }
      cleanup = adding
        ? mountWorkoutExercisePicker(container, { workout, returnPath: '#/workout' })
        : mountEditor(container, { workout, mode: 'active', basePath: '#/workout' });
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
