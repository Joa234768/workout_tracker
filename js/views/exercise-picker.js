// Picking an exercise: the exercise library, where tapping a row calls
// onPick(exercise) instead of opening the exercise.

import { el } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { saveWorkout, getAllWorkouts, newEntry, setPendingScroll } from '../workouts.js';
import { lastSessionBefore, DEFAULT_SET_COUNT } from '../logic/workout.js';
import * as list from './exercise-list.js';

/**
 * hint:   one muted line above the list.
 * onPick: async (exercise) => void. It saves the choice and navigates away.
 */
export function mountExercisePicker(container, { hint, onPick }) {
  let busy = false;
  container.append(el('p', { class: 'muted', text: hint }));
  return list.mount(container, {
    async onPick(exercise) {
      if (busy) return;
      busy = true;
      try {
        await onPick(exercise);
      } catch (err) {
        console.error(err);
        toast('The exercise could not be added.');
        busy = false;
      }
    },
  });
}

/** Picker for a workout: adds the exercise and returns to `returnPath`. */
export function mountWorkoutExercisePicker(container, { workout, returnPath }) {
  return mountExercisePicker(container, {
    hint: 'Tap an exercise to add it to the workout.',
    async onPick(exercise) {
      // Start with as many rows as last time, so ticking down the list just works.
      const last = lastSessionBefore(await getAllWorkouts(), exercise.id, workout);
      const entry = newEntry(exercise.id, last ? last.sets.length : DEFAULT_SET_COUNT);
      workout.exercises = [...workout.exercises, entry];
      await saveWorkout(workout);
      setPendingScroll(entry.id);
      location.replace(returnPath);
    },
  });
}
