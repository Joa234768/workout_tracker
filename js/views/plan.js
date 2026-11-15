// Plan & routines. Routes:
//   #/calendar/plan         the weekly plan and the list of routines
//   #/calendar/plan/edit    change the weekly plan

import { el, section } from '../ui/dom.js';
import { chip } from '../ui/chips.js';
import { toast } from '../ui/banner.js';
import { confirmDialog } from '../ui/dialog.js';
import { listRoutines, getCurrentRule, changePlan, createNewRoutine } from '../plan.js';
import { validatePlan } from '../logic/plan.js';
import { routineSummary } from '../logic/routines.js';
import { formatDate, todayStr, isValidDateStr, weekdayShort } from '../logic/dates.js';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Lines describing a plan version, e.g. ['Monday · Push day', …]. */
export function describeRule(rule, nameOf) {
  if (rule.type === 'weekly') {
    return [1, 2, 3, 4, 5, 6, 7]
      .filter((day) => rule.days && rule.days[day])
      .map((day) => `${WEEKDAY_NAMES[day - 1]} · ${nameOf(rule.days[day])}`);
  }
  return [
    `Training days: ${rule.weekdays.map(weekdayShort).join(', ')}`,
    `Rotation: ${rule.routineIds.map(nameOf).join(' → ')}`,
  ];
}

function mountOverview(container) {
  let alive = true;
  container.append(el('p', { class: 'muted', text: 'Loading…' }));

  Promise.all([listRoutines(), getCurrentRule()])
    .then(([routines, rule]) => {
      if (!alive) return;
      const nameOf = (id) => routines.find((routine) => routine.id === id)?.name || 'Deleted routine';

      const plan = rule
        ? section('Weekly plan',
            el('ul', { class: 'plain-list' }, describeRule(rule, nameOf).map((line) => el('li', { text: line }))),
            el('p', { class: 'muted', text: `Since ${formatDate(rule.startDate)}.` }),
            el('a', { class: 'btn secondary', href: '#/calendar/plan/edit', text: 'Change plan' })
          )
        : section('Weekly plan',
            el('p', { class: 'muted', text: routines.length
              ? 'No plan yet. A plan puts your routines on the calendar, on fixed weekdays or as a rotation.'
              : 'No plan yet. Create a routine first, then plan your week with it.' }),
            routines.length ? el('a', { class: 'btn', href: '#/calendar/plan/edit', text: 'Create plan' }) : null
          );

      const create = el('button', { class: routines.length ? 'btn secondary' : 'btn', type: 'button', text: 'New routine' });
      create.addEventListener('click', async () => {
        create.disabled = true;
        try {
          const routine = await createNewRoutine();
          location.hash = `#/calendar/routines/${encodeURIComponent(routine.id)}`;
        } catch (err) {
          console.error(err);
          toast('The routine could not be created.');
          create.disabled = false;
        }
      });

      container.replaceChildren(
        plan,
        el('h2', { class: 'panel-title', text: 'Routines' }),
        routines.length
          ? el('ul', { class: 'list' },
              routines.map((routine) =>
                el('li', { class: 'list-row' },
                  el('a', { class: 'list-link padded', href: `#/calendar/routines/${encodeURIComponent(routine.id)}` },
                    el('span', { class: 'list-title', text: routine.name }),
                    el('span', { class: 'muted', text: routineSummary(routine) })
                  )
                )
              )
            )
          : el('p', { class: 'muted', text: 'A routine is a workout template: a named list of exercises with sets and a rep range.' }),
        create
      );
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The plan could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}

function mountEdit(container) {
  let alive = true;
  container.append(el('p', { class: 'muted', text: 'Loading…' }));

  function render(routines, rule) {
    if (!routines.length) {
      container.replaceChildren(
        section('Create a routine first',
          el('p', { class: 'muted', text: 'A plan is made of routines.' }),
          el('a', { class: 'btn secondary', href: '#/calendar/plan', text: 'Plan & routines' })
        )
      );
      return;
    }
    const exists = (id) => routines.some((routine) => routine.id === id);
    // What is being edited, starting from the current plan.
    const draft = {
      type: rule ? rule.type : 'weekly',
      days: {},
      weekdays: new Set(rule && rule.type === 'rotation' ? rule.weekdays : [1, 3, 5]),
      routineIds: rule && rule.type === 'rotation' ? rule.routineIds.filter(exists) : [],
    };
    if (rule && rule.type === 'weekly') {
      for (const [day, id] of Object.entries(rule.days || {})) if (exists(id)) draft.days[day] = id;
    }
    if (!draft.routineIds.length) draft.routineIds = [routines[0].id];

    const routineSelect = (value, { allowRest, label, onChange }) => {
      const select = el('select', { class: 'input', 'aria-label': label },
        allowRest ? el('option', { value: '', text: 'Rest' }) : null,
        routines.map((routine) => el('option', { value: routine.id, text: routine.name }))
      );
      select.value = value || '';
      select.addEventListener('change', () => onChange(select.value));
      return select;
    };

    const body = el('div', { class: 'stack' });
    const typeRow = el('div', { class: 'chip-wrap', role: 'group', 'aria-label': 'How to plan' });

    function renderBody() {
      typeRow.replaceChildren(
        chip({ label: 'Fixed weekdays', pressed: draft.type === 'weekly', onToggle: () => { draft.type = 'weekly'; renderBody(); } }),
        chip({ label: 'Rotation', pressed: draft.type === 'rotation', onToggle: () => { draft.type = 'rotation'; renderBody(); } })
      );
      if (draft.type === 'weekly') {
        body.replaceChildren(
          el('p', { class: 'muted', text: 'Choose a routine for each training day.' }),
          ...WEEKDAY_NAMES.map((name, i) =>
            el('div', { class: 'plan-row' },
              el('span', { text: name }),
              routineSelect(draft.days[i + 1], {
                allowRest: true,
                label: name,
                onChange: (id) => { if (id) draft.days[i + 1] = id; else delete draft.days[i + 1]; },
              })
            )
          )
        );
        return;
      }
      body.replaceChildren(
        el('p', { class: 'muted', text: 'Choose your training days. The routines take turns on them, in order.' }),
        el('div', { class: 'chip-wrap', role: 'group', 'aria-label': 'Training days' },
          [1, 2, 3, 4, 5, 6, 7].map((day) =>
            chip({
              label: weekdayShort(day),
              pressed: draft.weekdays.has(day),
              onToggle: (on) => { if (on) draft.weekdays.add(day); else draft.weekdays.delete(day); },
            })
          )
        ),
        el('h3', { class: 'field-label spaced', text: 'Rotation' }),
        ...draft.routineIds.map((id, i) =>
          el('div', { class: 'plan-row' },
            el('span', { class: 'muted', text: String(i + 1) }),
            routineSelect(id, { allowRest: false, label: `Rotation step ${i + 1}`, onChange: (value) => { draft.routineIds[i] = value; } }),
            draft.routineIds.length > 1
              ? el('button', {
                  class: 'icon-button', type: 'button', 'aria-label': `Remove step ${i + 1}`, text: '×',
                  onclick: () => { draft.routineIds.splice(i, 1); renderBody(); },
                })
              : null
          )
        ),
        el('button', {
          class: 'btn plain', type: 'button', text: '+ Add a step',
          onclick: () => { draft.routineIds.push(routines[0].id); renderBody(); },
        })
      );
    }
    renderBody();

    const today = todayStr();
    const starts = el('input', { class: 'input', id: 'plan-start', type: 'date', value: today, min: today });

    const save = el('button', { class: 'btn', type: 'button', text: 'Save plan' });
    save.addEventListener('click', async () => {
      const fromDate = starts.value;
      if (!isValidDateStr(fromDate) || fromDate < today) {
        toast('Choose a start date from today on.');
        return;
      }
      const checked = validatePlan(
        { type: draft.type, days: draft.days, weekdays: [...draft.weekdays], routineIds: draft.routineIds },
        routines.map((routine) => routine.id)
      );
      if (!checked.ok) {
        toast(checked.error);
        return;
      }
      try {
        await changePlan(checked.rule, fromDate);
        toast('Plan saved.');
        location.replace('#/calendar/plan');
      } catch (err) {
        console.error(err);
        toast('The plan could not be saved.');
      }
    });

    let stop = null;
    if (rule) {
      stop = el('button', { class: 'btn plain danger-text', type: 'button', text: 'Stop planning' });
      stop.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: 'Stop planning?',
          lines: ['From today, no workouts are planned by the weekly plan. Past days and one-off workouts are kept.'],
          confirmLabel: 'Stop planning',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await changePlan(null, today);
          toast('Planning stopped.');
          location.replace('#/calendar/plan');
        } catch (err) {
          console.error(err);
          toast('The plan could not be changed.');
        }
      });
    }

    container.replaceChildren(
      section('Weekly plan', typeRow, body),
      section(null,
        el('label', { class: 'field-label', for: 'plan-start', text: 'Starts' }),
        starts,
        el('p', { class: 'muted', text: 'The plan applies from this date. Earlier days keep the plan they had.' })
      ),
      el('div', { class: 'stack' }, save, stop, el('a', { class: 'btn secondary', href: '#/calendar/plan', text: 'Cancel' }))
    );
  }

  Promise.all([listRoutines(), getCurrentRule()])
    .then(([routines, rule]) => {
      if (alive) render(routines, rule);
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The plan could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}

export function mount(container, { edit = false } = {}) {
  return edit ? mountEdit(container) : mountOverview(container);
}
