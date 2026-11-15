// A routine (workout template). Routes:
//   #/calendar/routines/<id>        edit: name, exercises, sets and rep range
//   #/calendar/routines/<id>/add    pick an exercise to add
// Like a workout, every change is saved immediately.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { actionSheet, confirmDialog } from '../ui/dialog.js';
import { getLibrary } from '../exercises.js';
import { getRoutine, saveRoutine, newRoutineExercise, copyRoutine, deleteRoutine } from '../plan.js';
import { getActiveWorkout, startWorkout } from '../workouts.js';
import { moveItem } from '../logic/workout.js';
import { MAX_ROUTINE_NAME, MAX_ROUTINE_SETS, MAX_REPS, cleanRoutineExercise } from '../logic/routines.js';
import { parseReps } from '../logic/sets.js';
import { mountExercisePicker } from './exercise-picker.js';

function notFound() {
  return section('Routine not found',
    el('p', { class: 'muted', text: 'It may have been deleted.' }),
    el('a', { class: 'btn secondary', href: '#/calendar/plan', text: 'Plan & routines' })
  );
}

function mountEditor(container, routine) {
  let alive = true;
  let nameOf = (exerciseId) => exerciseId;
  const path = `#/calendar/routines/${encodeURIComponent(routine.id)}`;

  let saving = false;
  let dirty = false;
  let idle = Promise.resolve();
  function save() {
    dirty = true;
    if (saving) return idle;
    saving = true;
    idle = (async () => {
      try {
        while (dirty) {
          dirty = false;
          await saveRoutine(routine);
        }
      } catch (err) {
        console.error(err);
        toast('The last change could not be saved.');
      } finally {
        saving = false;
      }
    })();
    return idle;
  }

  const name = el('input', {
    class: 'input',
    id: 'routine-name',
    type: 'text',
    maxlength: String(MAX_ROUTINE_NAME),
    autocomplete: 'off',
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    value: routine.name,
  });
  name.addEventListener('input', () => {
    routine.name = name.value;
    save();
  });
  name.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') name.blur();
  });

  const rows = el('div', { class: 'stack-lg' });

  // The three number fields of one exercise. `fields` collects them so that
  // tidying up on blur can update the others in place. The rows are not
  // rebuilt on blur: that would close the keyboard when moving between fields.
  function numberField(exercise, field, label, max, fields) {
    const input = el('input', {
      class: 'input tiny',
      type: 'text',
      inputmode: 'numeric',
      pattern: '[0-9]*',
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': label,
      value: String(exercise[field]),
    });
    input.addEventListener('input', () => {
      const value = parseReps(input.value);
      const valid = value !== null && value >= 1 && value <= max;
      input.classList.toggle('invalid', !valid);
      if (valid) {
        exercise[field] = value;
        save();
      }
    });
    input.addEventListener('blur', () => {
      // Tidy up: empty or out-of-range values fall back, and min never exceeds max.
      Object.assign(exercise, cleanRoutineExercise(exercise));
      save();
      for (const [name, other] of Object.entries(fields)) {
        if (document.activeElement === other) continue; // don't change a field being typed in
        other.value = String(exercise[name]);
        other.classList.remove('invalid');
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
    fields[field] = input;
    return input;
  }

  function renderRows() {
    rows.replaceChildren(
      ...routine.exercises.map((exercise, index) => {
        const title = nameOf(exercise.exerciseId);
        const menu = el('button', { class: 'icon-button', type: 'button', 'aria-label': `Options for ${title}`, text: '⋯' });
        menu.addEventListener('click', async () => {
          const choice = await actionSheet({
            title,
            actions: [
              index > 0 ? { label: 'Move up', value: 'up' } : null,
              index < routine.exercises.length - 1 ? { label: 'Move down', value: 'down' } : null,
              { label: 'Remove from routine', value: 'remove', danger: true },
            ].filter(Boolean),
          });
          if (choice === 'up' || choice === 'down') routine.exercises = moveItem(routine.exercises, index, choice === 'up' ? -1 : 1);
          else if (choice === 'remove') routine.exercises = routine.exercises.filter((e) => e !== exercise);
          else return;
          save();
          renderRows();
        });
        const fields = {};
        return el('section', { class: 'card', dataset: { routineExercise: exercise.id } },
          el('div', { class: 'entry-head' }, el('h2', { class: 'card-title entry-title', text: title }), menu),
          el('div', { class: 'routine-fields' },
            numberField(exercise, 'sets', `${title}, sets`, MAX_ROUTINE_SETS, fields),
            el('span', { text: 'sets ×' }),
            numberField(exercise, 'repMin', `${title}, minimum reps`, MAX_REPS, fields),
            el('span', { text: '–' }),
            numberField(exercise, 'repMax', `${title}, maximum reps`, MAX_REPS, fields),
            el('span', { text: 'reps' })
          )
        );
      }),
      // An array, not a bare null: replaceChildren() would print "null" as text.
      ...(routine.exercises.length ? [] : [el('p', { class: 'muted hint', text: 'Add the exercises this routine consists of.' })])
    );
  }

  const start = el('button', { class: 'btn secondary', type: 'button', text: 'Start a workout with this routine' });
  start.addEventListener('click', async () => {
    try {
      await save();
      if (await getActiveWorkout()) {
        toast('Finish the workout in progress first.');
        return;
      }
      await startWorkout({ routine });
      location.hash = '#/workout';
    } catch (err) {
      console.error(err);
      toast('The workout could not be started.');
    }
  });

  const duplicate = el('button', { class: 'btn plain', type: 'button', text: 'Duplicate routine' });
  duplicate.addEventListener('click', async () => {
    try {
      await save();
      const copy = await copyRoutine(routine.id);
      toast('Routine duplicated.');
      location.replace(`#/calendar/routines/${encodeURIComponent(copy.id)}`);
    } catch (err) {
      console.error(err);
      toast('The routine could not be duplicated.');
    }
  });

  const remove = el('button', { class: 'btn plain danger-text', type: 'button', text: 'Delete routine' });
  remove.addEventListener('click', async () => {
    const confirmed = await confirmDialog({
      title: `Delete "${routine.name}"?`,
      lines: ['Workouts already logged with it are kept.'],
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await save();
      const result = await deleteRoutine(routine.id);
      if (result === 'in-plan') {
        await confirmDialog({
          title: 'Still in your weekly plan',
          lines: ['This routine is part of your weekly plan. Change the plan first, then delete the routine.'],
          cancelLabel: null,
        });
        return;
      }
      toast('Routine deleted.');
      location.replace('#/calendar/plan');
    } catch (err) {
      console.error(err);
      toast('The routine could not be deleted.');
    }
  });

  container.append(
    section(null, el('label', { class: 'field-label', for: 'routine-name', text: 'Routine name' }), name),
    rows,
    el('div', { class: 'stack' },
      el('a', { class: 'btn secondary', href: `${path}/add`, text: '+ Add exercise' }),
      start, duplicate, remove
    )
  );
  renderRows();

  getLibrary()
    .then((library) => {
      if (!alive) return;
      const names = new Map(library.map((exercise) => [exercise.id, exercise.name]));
      nameOf = (exerciseId) => names.get(exerciseId) || exerciseId;
      renderRows();
    })
    .catch((err) => console.error(err));

  return () => {
    alive = false;
  };
}

export function mount(container, { id, adding = false }) {
  let alive = true;
  let cleanup = null;
  const path = `#/calendar/routines/${encodeURIComponent(id)}`;
  container.append(el('p', { class: 'muted', text: 'Loading…' }));

  getRoutine(id)
    .then((routine) => {
      if (!alive) return;
      container.replaceChildren();
      if (!routine || routine.archivedAt) {
        container.append(notFound());
      } else if (adding) {
        cleanup = mountExercisePicker(container, {
          hint: `Tap an exercise to add it to ${routine.name}.`,
          async onPick(exercise) {
            routine.exercises = [...routine.exercises, newRoutineExercise(exercise.id)];
            await saveRoutine(routine);
            location.replace(path);
          },
        });
      } else {
        cleanup = mountEditor(container, routine);
      }
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The routine could not be loaded.' }));
    });

  return () => {
    alive = false;
    if (cleanup) cleanup();
  };
}
