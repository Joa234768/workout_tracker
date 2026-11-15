// #/exercises/<id> — one exercise: muscles, equipment, instructions, my history.

import { el, section } from '../ui/dom.js';
import { tag } from '../ui/chips.js';
import { toast } from '../ui/banner.js';
import { confirmDialog } from '../ui/dialog.js';
import { getExercise, getExerciseHistory, setFavourite, deleteCustomExercise } from '../exercises.js';
import { equipmentLabel } from '../logic/exercises.js';
import { muscleLabel } from '../logic/muscles.js';
import { formatDate } from '../logic/dates.js';
import { formatSet } from '../logic/sets.js';

const HISTORY_SHOWN = 10;
const capitalize = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : '');

export function mount(container, { id }) {
  let alive = true;
  const path = `#/exercises/${encodeURIComponent(id)}`;

  function render(exercise, history) {
    if (!exercise || exercise.archived) {
      container.replaceChildren(
        section(exercise ? exercise.name : 'Exercise not found',
          el('p', { class: 'muted', text: exercise ? 'This custom exercise was deleted. Old workouts still show it.' : `There is no exercise with the id "${id}".` }),
          el('a', { class: 'btn secondary', href: '#/exercises', text: 'All exercises' })
        )
      );
      return;
    }

    // ----- Name, facts, favourite -----
    const facts = exercise.custom
      ? ['Custom exercise', equipmentLabel(exercise.equipment)]
      : [equipmentLabel(exercise.equipment), capitalize(exercise.category), capitalize(exercise.level)];
    const star = el('button', { class: 'btn secondary', type: 'button', 'aria-pressed': String(exercise.favourite) });
    const paintStar = () => {
      star.textContent = exercise.favourite ? '★ Favourite' : '☆ Add to favourites';
      star.setAttribute('aria-pressed', String(exercise.favourite));
    };
    paintStar();
    star.addEventListener('click', async () => {
      try {
        await setFavourite(exercise.id, !exercise.favourite);
        exercise.favourite = !exercise.favourite;
        paintStar();
      } catch (err) {
        console.error(err);
        toast('The favourite could not be saved.');
      }
    });
    const header = section(null,
      el('h2', { class: 'detail-title', text: exercise.name }),
      el('p', { class: 'muted', text: facts.filter(Boolean).join(' · ') }),
      star
    );

    // ----- Muscles -----
    const muscles = section('Muscles',
      el('h3', { class: 'field-label', text: 'Primary' }),
      el('div', { class: 'chip-wrap' }, exercise.primaryMuscles.map((m) => tag(muscleLabel(m)))),
      el('h3', { class: 'field-label spaced', text: 'Secondary' }),
      exercise.secondaryMuscles.length
        ? el('div', { class: 'chip-wrap' }, exercise.secondaryMuscles.map((m) => tag(muscleLabel(m), { subtle: true })))
        : el('p', { class: 'muted', text: 'None' }),
      exercise.musclesEdited ? el('p', { class: 'muted', text: 'Edited by you.' }) : null,
      exercise.custom ? null : el('a', { class: 'btn secondary', href: `${path}/muscles`, text: 'Edit muscles' })
    );

    // ----- Instructions (built-in exercises only) -----
    let instructions = null;
    if (!exercise.custom) {
      instructions = section('Instructions',
        exercise.instructions.length
          ? el('ol', { class: 'steps' }, exercise.instructions.map((step) => el('li', { text: step })))
          : el('p', { class: 'muted', text: 'No instructions for this exercise.' })
      );
    }

    // ----- My history -----
    const historyCard = section('My history',
      history.length
        ? el('ul', { class: 'history' },
            history.slice(0, HISTORY_SHOWN).map((session) =>
              el('li', {},
                el('span', { class: 'history-date', text: formatDate(session.date) }),
                el('span', { class: 'muted', text: session.sets.map(formatSet).join(' · ') })
              )
            )
          )
        : el('p', { class: 'muted', text: 'No logged sets yet.' }),
      history.length > HISTORY_SHOWN
        ? el('p', { class: 'muted', text: `Showing the latest ${HISTORY_SHOWN} of ${history.length} sessions.` })
        : null,
      history.length
        ? el('a', { class: 'btn secondary', href: `#/progress/exercises/${encodeURIComponent(exercise.id)}`, text: 'Progress charts' })
        : null
    );

    // ----- Custom exercise: edit and delete -----
    let manage = null;
    if (exercise.custom) {
      const remove = el('button', { class: 'btn secondary danger-text', type: 'button', text: 'Delete exercise' });
      remove.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: `Delete "${exercise.name}"?`,
          lines: [
            history.length
              ? 'It will be removed from the library. Workouts you have logged with it stay as they are.'
              : 'It will be removed from the library.',
          ],
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await deleteCustomExercise(exercise.id);
          toast('Exercise deleted.');
          location.replace('#/exercises');
        } catch (err) {
          console.error(err);
          toast('The exercise could not be deleted.');
        }
      });
      manage = section(null, el('a', { class: 'btn secondary', href: `${path}/edit`, text: 'Edit exercise' }), remove);
    }

    container.replaceChildren(...[header, muscles, instructions, historyCard, manage].filter(Boolean));
  }

  container.append(el('p', { class: 'muted', text: 'Loading…' }));
  Promise.all([getExercise(id), getExerciseHistory(id)])
    .then(([exercise, history]) => {
      if (alive) render(exercise, history);
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'This exercise could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}
