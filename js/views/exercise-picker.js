// Picking an exercise to add to a workout: the exercise library, where
// tapping a row adds the exercise and returns to the workout.

import { el } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { saveWorkout, getAllWorkouts, newEntry, setPendingScroll } from '../workouts.js';
import { lastSessionBefore, DEFAULT_SET_COUNT } from '../logic/workout.js';
import * as list from './exercise-list.js';

export function mountExercisePicker(container, { workout, returnPath }) {
  let busy = false;
  container.append(el('p', { class: 'muted', text: 'Tap an exercise to add it to the workout.' }));

  return list.mount(container, {
    async onPick(exercise) {
      if (busy) return;
      busy = true;
      try {
        // Start with as many rows as last time, so ticking down the list just works.
        const last = lastSessionBefore(await getAllWorkouts(), exercise.id, workout);
        const entry = newEntry(exercise.id, last ? last.sets.length : DEFAULT_SET_COUNT);
        workout.exercises = [...workout.exercises, entry];
        await saveWorkout(workout);
        setPendingScroll(entry.id);
        location.replace(returnPath);
      } catch (err) {
        console.error(err);
        toast('The exercise could not be added.');
        busy = false;
      }
    },
  });
}
