// #/progress — sets per muscle group for one Monday–Sunday week: a body map,
// a bar per group toward its target, and what contributed to each group.
// The arrows step back through earlier weeks.

import { el, section } from '../ui/dom.js';
import { bodyMap } from '../ui/body-map.js';
import { weekBar, setsText } from '../ui/volume.js';
import { loadWeek, getVolumeSettings } from '../volume.js';
import { WORKOUT_CHANGED } from '../workouts.js';
import { muscleLabel } from '../logic/muscles.js';
import { formatKg } from '../logic/sets.js';
import { addDays, diffDays, endOfWeek, formatDate, startOfWeek, todayStr } from '../logic/dates.js';

// Kept while the app is open, so coming back shows the same week and group.
const state = { week: null, selected: null };

const MODE_NOTES = {
  fractional: 'A set counts 1 for the main muscle and ½ for each helping muscle.',
  primary: 'A set counts for the main muscle only.',
  all: 'A set counts 1 for every muscle it uses.',
};
const setWord = (n) => (n === 1 ? 'set' : 'sets');

export function mount(container) {
  let alive = true;
  let loadId = 0;
  const thisWeek = startOfWeek(todayStr());
  if (!state.week || state.week > thisWeek) state.week = thisWeek;

  const title = el('h2', { class: 'month-title', 'aria-live': 'polite' });
  const range = el('p', { class: 'muted' });
  const previous = el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Previous week', text: '‹', onclick: () => go(-7) });
  const next = el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Next week', text: '›', onclick: () => go(7) });
  const current = el('button', { class: 'btn plain compact', type: 'button', text: 'This week', onclick: () => go(0) });
  const body = el('div', { class: 'stack-lg' });

  container.append(
    el('div', { class: 'month-nav' }, previous, title, next),
    el('div', { class: 'month-legend' }, range, current),
    body
  );

  function go(days) {
    state.week = days ? addDays(state.week, days) : thisWeek;
    if (state.week > thisWeek) state.week = thisWeek;
    reload();
  }

  function header() {
    const weeksAgo = diffDays(state.week, thisWeek) / 7;
    title.textContent = weeksAgo === 0 ? 'This week' : weeksAgo === 1 ? 'Last week' : `Week of ${formatDate(state.week)}`;
    range.textContent = `${formatDate(state.week)} – ${formatDate(endOfWeek(state.week))}`;
    next.disabled = state.week >= thisWeek;
    current.hidden = state.week === thisWeek;
  }

  // What one group got this week, and from which exercises.
  function detail(group, nameOf) {
    return el('div', { class: 'group-detail', dataset: { detail: group.id } },
      el('p', { class: 'detail-head' },
        el('strong', { text: group.label }),
        el('span', { class: 'muted', text: group.target ? ` · ${setsText(group)} sets` : ` · ${setsText(group)} ${setWord(group.sets)} · no target` })
      ),
      group.muscles.length && group.sets > 0
        ? el('p', { class: 'muted', text: group.muscles.map((m) => `${muscleLabel(m.muscle)} ${formatKg(m.sets)}`).join(' · ') })
        : null,
      group.exercises.length
        ? el('ul', { class: 'plain-list' },
            group.exercises.map((item) =>
              el('li', { class: 'detail-row' },
                el('a', { class: 'plain-link', href: `#/exercises/${encodeURIComponent(item.exerciseId)}`, text: nameOf(item.exerciseId) }),
                el('span', { class: 'muted nums', text: `${formatKg(item.sets)} ${setWord(item.sets)}` })
              )
            )
          )
        : el('p', { class: 'muted', text: 'No sets this week.' })
    );
  }

  function render({ groups, nameOf, workouts }, settings) {
    const select = (groupId) => {
      state.selected = state.selected === groupId ? null : groupId;
      render({ groups, nameOf, workouts }, settings);
    };
    const selected = groups.find((group) => group.id === state.selected) || null;

    const barRow = (group) =>
      el('li', {},
        el('button', { class: 'bar-row', type: 'button', 'aria-expanded': String(selected === group), dataset: { group: group.id }, onclick: () => select(group.id) },
          el('span', { class: 'progress-head' },
            el('span', { text: group.label }),
            el('span', { class: 'muted nums', text: setsText(group) })
          ),
          weekBar(group)
        ),
        selected === group ? detail(group, nameOf) : null
      );

    const withTarget = groups.filter((group) => group.target);
    const without = groups.filter((group) => !group.target);
    const more = without.length
      ? el('details', { class: 'more', open: without.some((group) => group === selected || group.sets > 0) },
          el('summary', { text: `Without a target (${without.length})` }),
          el('ul', { class: 'progress-list' }, without.map(barRow))
        )
      : null;

    const total = workouts.reduce((n, workout) => n + (workout.status === 'completed' ? 1 : 0), 0);
    body.replaceChildren(
      section(null,
        bodyMap({ groups, selected: state.selected, onSelect: select }),
        selected
          ? detail(selected, nameOf)
          : el('p', { class: 'muted', text: 'Tap a muscle or a bar to see which exercises counted. Darker means closer to the target.' })
      ),
      section('Sets per muscle group',
        el('p', { class: 'muted', text: `${total} ${total === 1 ? 'workout' : 'workouts'} finished${workouts.some((w) => w.status === 'active') ? ', plus the one in progress' : ''}. The line on each bar is the target.` }),
        el('ul', { class: 'progress-list' }, withTarget.map(barRow)),
        more
      ),
      el('p', { class: 'muted hint', text: `${MODE_NOTES[settings.mode]} Warm-up sets are not counted.` }),
      el('a', { class: 'btn secondary', href: '#/settings/volume', text: 'Targets and counting' })
    );
  }

  function reload() {
    header();
    const id = ++loadId;
    Promise.all([loadWeek(state.week), getVolumeSettings()])
      .then(([week, settings]) => {
        if (alive && id === loadId) render(week, settings);
      })
      .catch((err) => {
        console.error(err);
        if (alive && id === loadId) body.replaceChildren(el('p', { class: 'muted', text: 'The week could not be loaded.' }));
      });
  }
  window.addEventListener(WORKOUT_CHANGED, reload);
  reload();

  return () => {
    alive = false;
    window.removeEventListener(WORKOUT_CHANGED, reload);
  };
}
