// The workout editor: set rows per exercise, notes and duration. Used for
// the workout in progress (#/workout) and for editing a past workout
// (#/calendar/<id>/edit). Every change is saved to the database immediately,
// so closing the app never loses anything.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { confirmDialog, actionSheet } from '../ui/dialog.js';
import { getLibrary } from '../exercises.js';
import {
  saveWorkout, finishWorkout, deleteWorkout, getAllWorkouts, newSet, takePendingScroll,
} from '../workouts.js';
import {
  setLabels, placeholdersFor, tickSet, copyFromAbove, moveItem, untickedCount, lastSessionBefore,
} from '../logic/workout.js';
import { formatKg, formatSetCompact, parseKg, parseReps, isDoneSet } from '../logic/sets.js';
import { formatDate, formatShortDate, isValidDateStr, todayStr, weekdayName } from '../logic/dates.js';

const MAX_DURATION_MIN = 600;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * mode 'active': the workout in progress, with Finish and Discard.
 * mode 'edit':   a completed workout, with an editable date and Done.
 * basePath: this screen's address ('#/workout' or '#/calendar/<id>/edit').
 */
export function mountEditor(container, { workout, mode, basePath }) {
  let alive = true;
  let exerciseById = new Map();
  let allWorkouts = [];
  const cards = el('div', { class: 'stack-lg' });

  // ----- Saving: every change is written; writes never overlap -----
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
          await saveWorkout(workout);
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

  const nameOf = (exerciseId) => exerciseById.get(exerciseId)?.name || exerciseId;
  const lastSessionOf = (exerciseId) => lastSessionBefore(allWorkouts, exerciseId, workout);

  // ----- One exercise card -----
  function renderEntry(entry) {
    const index = workout.exercises.indexOf(entry);
    const last = lastSessionOf(entry.exerciseId);
    const labels = setLabels(entry.sets);
    const placeholders = placeholdersFor(entry.sets, last ? last.sets : []);
    const name = nameOf(entry.exerciseId);

    const refresh = () => {
      const current = cards.querySelector(`[data-entry="${entry.id}"]`);
      if (current) current.replaceWith(renderEntry(entry));
    };

    const menu = el('button', { class: 'icon-button', type: 'button', 'aria-label': `Options for ${name}`, text: '⋯' });
    menu.addEventListener('click', async () => {
      const choice = await actionSheet({
        title: name,
        actions: [
          index > 0 ? { label: 'Move up', value: 'up' } : null,
          index < workout.exercises.length - 1 ? { label: 'Move down', value: 'down' } : null,
          { label: 'Exercise details', value: 'details' },
          { label: 'Remove from workout', value: 'remove', danger: true },
        ].filter(Boolean),
      });
      if (choice === 'up' || choice === 'down') {
        workout.exercises = moveItem(workout.exercises, index, choice === 'up' ? -1 : 1);
        save();
        renderCards();
        cards.querySelector(`[data-entry="${entry.id}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (choice === 'details') {
        await save();
        location.hash = `#/exercises/${encodeURIComponent(entry.exerciseId)}`;
      } else if (choice === 'remove') {
        const ticked = entry.sets.filter(isDoneSet).length;
        if (ticked) {
          const confirmed = await confirmDialog({
            title: `Remove ${name}?`,
            lines: [`${plural(ticked, 'ticked set', 'ticked sets')} will be removed with it.`],
            confirmLabel: 'Remove',
            danger: true,
          });
          if (!confirmed) return;
        }
        workout.exercises = workout.exercises.filter((e) => e !== entry);
        save();
        renderCards();
      }
    });

    const rows = entry.sets.map((set, i) => {
      const placeholder = placeholders[i];
      const label = labels[i];
      const spoken = set.warmup ? 'Warm-up set' : `Set ${label}`;

      const badge = el('button', {
        class: set.warmup ? 'set-badge warmup' : 'set-badge',
        type: 'button',
        'aria-pressed': String(set.warmup),
        'aria-label': `${spoken}. Tap to ${set.warmup ? 'make it a normal set' : 'mark as warm-up'}`,
        text: label,
      });
      badge.addEventListener('click', () => {
        entry.sets[i] = { ...entry.sets[i], warmup: !set.warmup }; // entry.sets[i] holds what was typed since
        save();
        refresh();
      });

      const kg = el('input', {
        class: 'input set-input',
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        enterkeyhint: 'next',
        'aria-label': `${spoken}, weight in kg`,
        placeholder: placeholder ? formatKg(placeholder.kg) : '',
        value: set.kg === null ? '' : formatKg(set.kg),
      });
      const reps = el('input', {
        class: 'input set-input',
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        autocomplete: 'off',
        enterkeyhint: 'done',
        'aria-label': `${spoken}, reps`,
        placeholder: placeholder ? String(placeholder.reps) : '',
        value: set.reps === null ? '' : String(set.reps),
      });

      // Typing updates the stored set straight away. The row is not rebuilt
      // while typing, so the keyboard and the cursor stay put.
      const bind = (input, field, parse, format) => {
        input.addEventListener('input', () => {
          const value = parse(input.value);
          input.classList.toggle('invalid', input.value.trim() !== '' && value === null);
          entry.sets[i] = { ...entry.sets[i], [field]: value };
          save();
        });
        input.addEventListener('blur', () => {
          const current = entry.sets[i];
          if (!current) return;
          if (current[field] !== null) input.value = format(current[field]);
          // A ticked row whose reps were cleared is no longer a set.
          if (current.done && !isDoneSet(current)) {
            entry.sets[i] = { ...current, done: false, doneAt: null };
            save();
            refresh();
          }
        });
      };
      bind(kg, 'kg', parseKg, formatKg);
      bind(reps, 'reps', parseReps, String);
      kg.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') reps.focus();
      });
      reps.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') reps.blur();
      });

      const more = el('button', { class: 'icon-button', type: 'button', 'aria-label': `Options for ${spoken.toLowerCase()}`, text: '⋯' });
      more.addEventListener('click', async () => {
        const choice = await actionSheet({
          title: `${name} · ${spoken.toLowerCase()}`,
          actions: [
            i > 0 ? { label: 'Copy previous set', value: 'copy' } : null,
            { label: 'Delete set', value: 'delete', danger: true },
          ].filter(Boolean),
        });
        if (choice === 'copy') entry.sets = copyFromAbove(entry.sets, i);
        else if (choice === 'delete') entry.sets = entry.sets.filter((_, n) => n !== i);
        else return;
        save();
        refresh();
      });

      const tick = el('button', {
        class: 'tick',
        type: 'button',
        'aria-pressed': String(set.done),
        'aria-label': set.done ? `${spoken} done. Tap to untick` : `Mark ${spoken.toLowerCase()} done`,
        text: '✓',
      });
      tick.addEventListener('click', () => {
        const { set: next, result } = tickSet(entry.sets[i], placeholder, new Date().toISOString());
        if (result === 'need-kg') return kg.focus();
        if (result === 'need-reps') return reps.focus();
        entry.sets[i] = next;
        save();
        refresh();
      });

      return el('div', { class: set.done ? 'set-row done' : 'set-row' }, badge, kg, reps, more, tick);
    });

    const addSet = el('button', { class: 'btn plain', type: 'button', text: '+ Add set' });
    addSet.addEventListener('click', () => {
      entry.sets = [...entry.sets, newSet()];
      save();
      refresh();
    });

    return el('section', { class: 'card', dataset: { entry: entry.id } },
      el('div', { class: 'entry-head' },
        el('div', { class: 'entry-title' },
          el('h2', { class: 'card-title', text: name }),
          // Last time's numbers: muted, never in the way.
          last
            ? el('p', { class: 'muted', text: `Last · ${formatShortDate(last.date, todayStr())}: ${last.sets.map(formatSetCompact).join(' · ')}` })
            : null
        ),
        menu
      ),
      entry.sets.length
        ? el('div', { class: 'set-head', 'aria-hidden': 'true' },
            el('span', { text: 'Set' }), el('span', { text: 'kg' }), el('span', { text: 'Reps' }), el('span'), el('span'))
        : null,
      rows,
      addSet
    );
  }

  function renderCards() {
    cards.replaceChildren(
      ...workout.exercises.map(renderEntry),
      workout.exercises.length
        ? el('p', { class: 'muted hint', text: 'Tap a set number to mark it as a warm-up. ⋯ copies the previous set or deletes one.' })
        : el('p', { class: 'muted hint', text: 'Add your first exercise to start logging.' })
    );
  }

  // ----- Date (past workouts only), notes, duration -----
  const dateRow = mode === 'edit'
    ? (() => {
        const input = el('input', { class: 'input', id: 'workout-date', type: 'date', value: workout.date });
        input.addEventListener('change', () => {
          if (!isValidDateStr(input.value)) {
            input.value = workout.date;
            return;
          }
          workout.date = input.value;
          save();
          renderCards(); // "last time" depends on the date
        });
        return el('div', { class: 'stack' }, el('label', { class: 'field-label', for: 'workout-date', text: 'Date' }), input);
      })()
    : null;

  const notes = el('textarea', {
    class: 'input',
    id: 'workout-notes',
    rows: '3',
    placeholder: 'How did it go?',
    autocapitalize: 'sentences',
  });
  notes.value = workout.notes || '';
  notes.addEventListener('input', () => {
    workout.notes = notes.value;
    save();
  });

  const duration = el('input', {
    class: 'input short',
    id: 'workout-duration',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    autocomplete: 'off',
    enterkeyhint: 'done',
    value: workout.durationMin === null || workout.durationMin === undefined ? '' : String(workout.durationMin),
  });
  duration.addEventListener('input', () => {
    const minutes = parseReps(duration.value);
    const valid = minutes !== null && minutes > 0 && minutes <= MAX_DURATION_MIN;
    duration.classList.toggle('invalid', duration.value.trim() !== '' && !valid);
    workout.durationMin = valid ? minutes : null;
    save();
  });
  duration.addEventListener('blur', () => {
    duration.value = workout.durationMin === null ? '' : String(workout.durationMin);
    duration.classList.remove('invalid');
  });
  duration.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') duration.blur();
  });

  const details = section(null,
    dateRow,
    el('label', { class: dateRow ? 'field-label spaced' : 'field-label', for: 'workout-notes', text: 'Notes' }),
    notes,
    el('div', { class: 'row' }, el('label', { for: 'workout-duration', text: 'Duration (minutes)' }), duration)
  );

  // ----- Finish / done / discard -----
  async function finish() {
    await save();
    const unticked = untickedCount(workout);
    const ticked = workout.exercises.reduce((n, e) => n + e.sets.filter(isDoneSet).length, 0);
    const what = mode === 'active' ? 'workout' : 'changes';

    if (!ticked) {
      const confirmed = await confirmDialog({
        title: mode === 'active' ? 'Nothing is ticked' : 'No sets left',
        lines: [mode === 'active'
          ? 'No sets are ticked, so there is nothing to save. Discard this workout?'
          : 'This workout has no ticked sets left. Delete it?'],
        confirmLabel: mode === 'active' ? 'Discard workout' : 'Delete workout',
        danger: true,
      });
      if (!confirmed) return;
    } else if (unticked) {
      const confirmed = await confirmDialog({
        title: mode === 'active' ? 'Finish workout?' : 'Save changes?',
        lines: [`${plural(unticked, 'set is', 'sets are')} not ticked and will be removed.`],
        confirmLabel: mode === 'active' ? 'Finish' : 'Save',
      });
      if (!confirmed) return;
    }

    try {
      const stored = await finishWorkout(workout);
      if (!stored) {
        toast(mode === 'active' ? 'Workout discarded.' : 'Workout deleted.');
        location.replace(mode === 'active' ? '#/today' : '#/calendar');
        return;
      }
      toast(mode === 'active' ? 'Workout saved.' : 'Changes saved.');
      location.replace(`#/calendar/${encodeURIComponent(stored.id)}`);
    } catch (err) {
      console.error(err);
      toast(`The ${what} could not be saved.`);
    }
  }

  async function discard() {
    const confirmed = await confirmDialog({
      title: 'Discard workout?',
      lines: ['Everything logged in this workout will be deleted. This cannot be undone.'],
      confirmLabel: 'Discard workout',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await save();
      await deleteWorkout(workout.id);
      toast('Workout discarded.');
      location.replace('#/today');
    } catch (err) {
      console.error(err);
      toast('The workout could not be discarded.');
    }
  }

  const heading = el('p', {
    class: 'muted',
    text: mode === 'active'
      ? `${workout.routineName ? `${workout.routineName} · ` : ''}${weekdayName(workout.date)} ${formatDate(workout.date)} · saved as you go`
      : 'Changes are saved as you make them.',
  });
  const actions = el('div', { class: 'stack' },
    el('a', { class: 'btn secondary', href: `${basePath}/add`, text: '+ Add exercise' }),
    details,
    el('button', { class: 'btn', type: 'button', text: mode === 'active' ? 'Finish workout' : 'Done', onclick: finish }),
    mode === 'active'
      ? el('button', { class: 'btn plain danger-text', type: 'button', text: 'Discard workout', onclick: discard })
      : null
  );
  container.append(heading, cards, actions);

  // Exercise names and "last time" need the library and the other workouts.
  renderCards();
  Promise.all([getLibrary(), getAllWorkouts()])
    .then(([library, workouts]) => {
      if (!alive) return;
      exerciseById = new Map(library.map((exercise) => [exercise.id, exercise]));
      allWorkouts = workouts;
      renderCards();
      const scrollTo = takePendingScroll();
      if (scrollTo) cards.querySelector(`[data-entry="${scrollTo}"]`)?.scrollIntoView({ block: 'start' });
    })
    .catch((err) => {
      console.error(err);
      if (alive) toast('Exercise names could not be loaded.');
    });

  return () => {
    alive = false;
  };
}
