// #/calendar — the month view. Each day shows what is planned, done, missed
// or cancelled; tapping a day shows its details and actions underneath.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { actionSheet, confirmDialog, promptDate } from '../ui/dialog.js';
import {
  PLAN_CHANGED, loadPlanData, cancelOccurrence, restoreOccurrence, moveOccurrence,
  changeOccurrenceRoutine, addOneOff, deleteOneOff,
} from '../plan.js';
import { WORKOUT_CHANGED, startWorkout } from '../workouts.js';
import { calendarDays } from '../logic/plan.js';
import { routineSummary } from '../logic/routines.js';
import { workoutStats } from '../logic/workout.js';
import {
  addMonths, formatDate, monthGrid, monthLabel, monthStart, todayStr, weekdayName, weekdayShort,
} from '../logic/dates.js';

// Kept while the app is open, so coming back shows the same month and day.
const state = { month: null, selected: null };

const MARKS = { completed: '●', active: '◐', planned: '○', missed: '×', cancelled: '–' };
const STATE_WORDS = { completed: 'done', active: 'in progress', planned: 'planned', missed: 'missed', cancelled: 'cancelled' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The Month / List switch shared by the month view and the history list. */
export function viewSwitch(current) {
  const link = (key, label, href) =>
    el('a', { class: 'segment', href, 'aria-current': current === key ? 'page' : null, text: label });
  return el('nav', { class: 'segmented', 'aria-label': 'Calendar view' },
    link('month', 'Month', '#/calendar'),
    link('list', 'List', '#/calendar/history')
  );
}

export function mount(container) {
  let alive = true;
  let data = null;
  const today = todayStr();
  if (!state.month) state.month = monthStart(today);
  if (!state.selected) state.selected = today;

  const title = el('h2', { class: 'month-title', 'aria-live': 'polite' });
  const grid = el('div', { class: 'month-grid' });
  const panel = el('div', { class: 'stack-lg' });
  const todayButton = el('button', { class: 'btn plain compact', type: 'button', text: 'Today' });

  const go = (months) => {
    state.month = addMonths(state.month, months);
    render();
  };
  const navButton = (label, text, months) =>
    el('button', { class: 'icon-button', type: 'button', 'aria-label': label, text, onclick: () => go(months) });
  todayButton.addEventListener('click', () => {
    state.month = monthStart(today);
    state.selected = today;
    render();
  });

  container.append(
    viewSwitch('month'),
    el('div', { class: 'month-nav' },
      navButton('Previous year', '«', -12), navButton('Previous month', '‹', -1),
      title,
      navButton('Next month', '›', 1), navButton('Next year', '»', 12)
    ),
    el('div', { class: 'month-weekdays', 'aria-hidden': 'true' }, [1, 2, 3, 4, 5, 6, 7].map((d) => el('span', { text: weekdayShort(d) }))),
    grid,
    el('div', { class: 'month-legend' },
      el('p', { class: 'muted', text: '● done   ○ planned   × missed   – cancelled' }),
      todayButton
    ),
    panel,
    el('a', { class: 'btn secondary', href: '#/calendar/plan', text: 'Plan & routines' })
  );

  const routineName = (routineId) => {
    if (!routineId) return 'Workout';
    return data.routines.find((routine) => routine.id === routineId)?.name || 'Deleted routine';
  };
  const entryName = (entry) =>
    entry.workout ? entry.workout.routineName || 'Workout' : routineName(entry.occurrence.routineId);

  // ----- The grid -----
  function render() {
    if (!data) return;
    const cells = monthGrid(state.month);
    const days = calendarDays(cells[0].date, cells[41].date, { ...data, today });
    title.textContent = monthLabel(state.month);
    todayButton.hidden = state.month === monthStart(today) && state.selected === today;

    grid.replaceChildren(
      ...cells.map(({ date, inMonth }) => {
        const entries = days[date] || [];
        const classes = ['day'];
        if (!inMonth) classes.push('outside');
        if (date === today) classes.push('today');
        const spoken = [
          `${weekdayName(date)} ${formatDate(date)}`,
          ...entries.map((entry) => `${STATE_WORDS[entry.state]}: ${entryName(entry)}`),
        ].join(', ');
        const button = el('button', {
          class: classes.join(' '),
          type: 'button',
          'aria-label': spoken,
          'aria-pressed': String(date === state.selected),
          dataset: { date },
        },
          el('span', { class: 'day-number', text: String(Number(date.slice(8))) }),
          el('span', { class: 'day-marks', 'aria-hidden': 'true' },
            entries.slice(0, 3).map((entry) => el('span', { class: `mark ${entry.state}`, text: MARKS[entry.state] }))
          )
        );
        button.addEventListener('click', () => {
          state.selected = date;
          if (!inMonth) state.month = monthStart(date);
          render();
          // The day's details are below the grid. Bring them into view, leaving
          // the lower weeks of the grid visible above them.
          const top = panel.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45;
          if (top > window.scrollY) window.scrollTo({ top, behavior: 'smooth' });
        });
        return button;
      })
    );
    renderPanel(days[state.selected] || []);
  }

  // ----- The selected day -----
  async function act(work, done) {
    try {
      await work();
      if (done) toast(done);
    } catch (err) {
      console.error(err);
      toast('That could not be saved.');
    }
  }

  async function pickRoutine(titleText, { allowNone = false } = {}) {
    const routines = data.routines.filter((routine) => !routine.archivedAt);
    if (!routines.length && !allowNone) {
      toast('Create a routine first, under Plan & routines.');
      return undefined;
    }
    const choice = await actionSheet({
      title: titleText,
      actions: [
        ...routines.map((routine) => ({ label: routine.name, value: routine.id })),
        allowNone ? { label: 'No routine (empty workout)', value: 'none' } : null,
      ].filter(Boolean),
    });
    if (choice === null) return undefined;
    return choice === 'none' ? null : choice;
  }

  async function begin(options) {
    await act(async () => {
      await startWorkout(options);
      location.hash = '#/workout';
    });
  }

  function occurrenceCard(entry, busy) {
    const occurrence = entry.occurrence;
    const routine = data.routines.find((r) => r.id === occurrence.routineId) || null;
    const name = routineName(occurrence.routineId);
    const heading = { planned: 'Planned', missed: 'Missed', cancelled: 'Cancelled' }[entry.state];
    const facts = [
      routine ? routineSummary(routine) : null,
      occurrence.moved ? `moved from ${formatDate(occurrence.originalDate)}` : null,
      occurrence.kind === 'oneoff' ? 'one-off' : null,
    ].filter(Boolean).join(' · ');

    const button = (label, onClick, style = 'btn secondary') => el('button', { class: style, type: 'button', text: label, onclick: onClick });

    if (entry.state === 'cancelled') {
      return section(`${heading}: ${name}`,
        facts ? el('p', { class: 'muted', text: facts }) : null,
        button('Restore', () => act(() => restoreOccurrence(occurrence), 'Workout restored.')),
        occurrence.kind === 'oneoff' ? button('Delete', () => act(() => deleteOneOff(occurrence.oneOffId), 'Planned workout deleted.'), 'btn plain danger-text') : null
      );
    }

    const start = button('Start', () => begin({ routine, plannedRef: occurrence.ref }), 'btn');
    start.disabled = busy;
    const move = button('Move to another date', async () => {
      const date = await promptDate({
        title: `Move ${name}`,
        lines: [`Currently on ${formatDate(occurrence.date)}.`],
        value: occurrence.date,
        confirmLabel: 'Move',
      });
      if (!date || date === occurrence.date) return;
      await act(() => moveOccurrence(occurrence, date), `Moved to ${formatDate(date)}.`);
    });
    const change = button('Change routine', async () => {
      const routineId = await pickRoutine('Routine for this day', { allowNone: occurrence.kind === 'oneoff' });
      if (routineId === undefined) return;
      await act(() => changeOccurrenceRoutine(occurrence, routineId), 'Routine changed for this day.');
    });
    const cancel = occurrence.kind === 'oneoff'
      ? button('Delete', async () => {
          const confirmed = await confirmDialog({ title: 'Delete this planned workout?', lines: [`${name} on ${formatDate(occurrence.date)}.`], confirmLabel: 'Delete', danger: true });
          if (confirmed) await act(() => deleteOneOff(occurrence.oneOffId), 'Planned workout deleted.');
        }, 'btn plain danger-text')
      : button('Cancel this workout', () => act(() => cancelOccurrence(occurrence), 'Workout cancelled.'), 'btn plain danger-text');

    return section(`${heading}: ${name}`,
      facts ? el('p', { class: 'muted', text: facts }) : null,
      busy ? el('p', { class: 'muted', text: 'Finish the workout in progress before starting another.' }) : null,
      start, move, change, cancel
    );
  }

  function renderPanel(entries) {
    const date = state.selected;
    const busy = data.workouts.some((workout) => workout.status === 'active');
    const cards = entries.map((entry) => {
      if (entry.state === 'completed') {
        const stats = workoutStats(entry.workout);
        return section(`Done: ${entryName(entry)}`,
          el('p', { class: 'muted', text: `${plural(stats.exercises, 'exercise', 'exercises')} · ${plural(stats.sets, 'set', 'sets')}` }),
          el('a', { class: 'btn secondary', href: `#/calendar/${encodeURIComponent(entry.workout.id)}`, text: 'View workout' })
        );
      }
      if (entry.state === 'active') {
        return section(`In progress: ${entryName(entry)}`, el('a', { class: 'btn', href: '#/workout', text: 'Continue workout' }));
      }
      return occurrenceCard(entry, busy);
    });

    const planOne = el('button', { class: 'btn secondary', type: 'button', text: 'Plan a workout on this day' });
    planOne.addEventListener('click', async () => {
      const routineId = await pickRoutine('Plan a workout', { allowNone: true });
      if (routineId === undefined) return;
      await act(() => addOneOff(date, routineId), 'Workout planned.');
    });

    let logNow = null;
    if (date <= today && !busy) {
      logNow = el('button', { class: 'btn plain', type: 'button', text: date === today ? 'Start an empty workout' : 'Log a workout for this day' });
      logNow.addEventListener('click', () => begin({ date }));
    }

    panel.replaceChildren(
      el('h2', { class: 'panel-title', text: `${weekdayName(date)} ${formatDate(date)}${date === today ? ' · today' : ''}` }),
      ...cards,
      // An array, not a bare null: replaceChildren() would print "null" as text.
      ...(cards.length ? [] : [el('p', { class: 'muted', text: 'Nothing planned or logged.' })]),
      el('div', { class: 'stack' }, planOne, logNow)
    );
  }

  async function reload() {
    const loaded = await loadPlanData();
    if (!alive) return;
    data = loaded;
    render();
  }
  const onChange = () => reload().catch((err) => console.error(err));
  window.addEventListener(PLAN_CHANGED, onChange);
  window.addEventListener(WORKOUT_CHANGED, onChange);
  title.textContent = monthLabel(state.month);
  reload().catch((err) => {
    console.error(err);
    if (alive) panel.replaceChildren(el('p', { class: 'muted', text: 'The calendar could not be loaded.' }));
  });

  return () => {
    alive = false;
    window.removeEventListener(PLAN_CHANGED, onChange);
    window.removeEventListener(WORKOUT_CHANGED, onChange);
  };
}
