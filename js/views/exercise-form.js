// #/exercises/new and #/exercises/<id>/edit — create or edit a custom exercise.

import { el, section } from '../ui/dom.js';
import { musclePicker } from '../ui/chips.js';
import { toast } from '../ui/banner.js';
import { getExercise, saveCustomExercise } from '../exercises.js';
import { EQUIPMENT, MAX_EXERCISE_NAME, equipmentLabel } from '../logic/exercises.js';

export function mount(container, { id }) {
  let alive = true;
  const editing = Boolean(id);
  const cancelPath = editing ? `#/exercises/${encodeURIComponent(id)}` : '#/exercises';

  function render(exercise) {
    const name = el('input', {
      class: 'input',
      id: 'exercise-name',
      type: 'text',
      maxlength: String(MAX_EXERCISE_NAME),
      autocomplete: 'off',
      autocapitalize: 'sentences',
      enterkeyhint: 'done',
      value: exercise ? exercise.name : '',
    });
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') name.blur();
    });

    const equipment = el('select', { class: 'input', id: 'exercise-equipment' },
      el('option', { value: '', text: 'Choose…' }),
      EQUIPMENT.map((key) => el('option', { value: key, text: equipmentLabel(key) }))
    );
    equipment.value = exercise ? exercise.equipment : '';

    const picker = musclePicker(exercise || {});

    const save = el('button', { class: 'btn', type: 'button', text: editing ? 'Save' : 'Create exercise' });
    let saving = false;
    save.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      try {
        const savedId = await saveCustomExercise({ name: name.value, equipment: equipment.value, ...picker.getValue() }, id);
        toast(editing ? 'Exercise saved.' : 'Exercise created.');
        location.replace(`#/exercises/${encodeURIComponent(savedId)}`);
      } catch (err) {
        toast(err.message || 'The exercise could not be saved.');
      } finally {
        saving = false;
      }
    });

    container.replaceChildren(
      section(editing ? 'Edit exercise' : 'New exercise',
        el('label', { class: 'field-label', for: 'exercise-name', text: 'Name' }),
        name,
        el('label', { class: 'field-label spaced', for: 'exercise-equipment', text: 'Equipment' }),
        equipment
      ),
      section('Muscles', picker.node),
      el('div', { class: 'stack' }, save, el('a', { class: 'btn secondary', href: cancelPath, text: 'Cancel' }))
    );
  }

  if (!editing) {
    render(null);
  } else {
    container.append(el('p', { class: 'muted', text: 'Loading…' }));
    getExercise(id)
      .then((exercise) => {
        if (!alive) return;
        if (!exercise || !exercise.custom || exercise.archived) {
          location.replace(cancelPath); // only custom exercises can be edited here
          return;
        }
        render(exercise);
      })
      .catch((err) => {
        console.error(err);
        if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'This exercise could not be loaded.' }));
      });
  }

  return () => {
    alive = false;
  };
}
