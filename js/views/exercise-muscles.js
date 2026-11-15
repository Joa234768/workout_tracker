// #/exercises/<id>/muscles — edit which muscles a built-in exercise trains.
// The change is stored as an override; the dataset itself is never modified.

import { el, section } from '../ui/dom.js';
import { musclePicker } from '../ui/chips.js';
import { toast } from '../ui/banner.js';
import { getExercise, saveMuscleOverride, resetMuscleOverride } from '../exercises.js';

export function mount(container, { id }) {
  let alive = true;
  const detailPath = `#/exercises/${encodeURIComponent(id)}`;

  function render(exercise) {
    if (!exercise || exercise.custom || exercise.archived) {
      // Custom exercises are edited as a whole on their own form.
      location.replace(exercise && exercise.custom && !exercise.archived ? `${detailPath}/edit` : detailPath);
      return;
    }
    const picker = musclePicker(exercise);
    const save = el('button', { class: 'btn', type: 'button', text: 'Save' });
    save.addEventListener('click', async () => {
      const { primaryMuscles, secondaryMuscles } = picker.getValue();
      try {
        await saveMuscleOverride(exercise.id, primaryMuscles, secondaryMuscles);
        toast('Muscles saved.');
        location.replace(detailPath);
      } catch (err) {
        toast(err.message || 'The muscles could not be saved.');
      }
    });

    let reset = null;
    if (exercise.musclesEdited) {
      reset = el('button', { class: 'btn secondary', type: 'button', text: 'Reset to original' });
      reset.addEventListener('click', async () => {
        try {
          await resetMuscleOverride(exercise.id);
          toast('Muscles reset.');
          location.replace(detailPath);
        } catch (err) {
          console.error(err);
          toast('The muscles could not be reset.');
        }
      });
    }

    container.replaceChildren(
      section(null,
        el('h2', { class: 'detail-title', text: exercise.name }),
        el('p', { class: 'muted', text: 'Your choice applies to past and future workouts. The original can always be restored.' })
      ),
      section('Muscles', picker.node),
      el('div', { class: 'stack' }, save, reset, el('a', { class: 'btn secondary', href: detailPath, text: 'Cancel' }))
    );
  }

  container.append(el('p', { class: 'muted', text: 'Loading…' }));
  getExercise(id)
    .then((exercise) => {
      if (alive) render(exercise);
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'This exercise could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}
