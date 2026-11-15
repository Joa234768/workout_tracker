// #/exercises — browse, search and filter the exercise library.

import { el } from '../ui/dom.js';
import { chip } from '../ui/chips.js';
import { toast } from '../ui/banner.js';
import { getLibrary, getLastUsed, setFavourite } from '../exercises.js';
import { EQUIPMENT, equipmentLabel, filterExercises, sortExercises } from '../logic/exercises.js';
import { MUSCLE_GROUPS, groupsOfMuscles } from '../logic/muscles.js';

const PAGE_SIZE = 60;

// Kept while the app is open, so coming back from an exercise shows the same
// search, filters and scroll position.
const state = {
  query: '',
  group: null,
  includeSecondary: false,
  equipment: new Set(),
  mineOnly: false,
  shown: PAGE_SIZE,
  scrollY: 0,
};

/** One line under the name: 'Chest · Barbell'. */
export function exerciseSummary(exercise) {
  const groups = groupsOfMuscles(exercise.primaryMuscles).map((g) => g.label).join(', ');
  return [groups, equipmentLabel(exercise.equipment), exercise.custom ? 'Custom' : null].filter(Boolean).join(' · ');
}

export function mount(container) {
  let alive = true;
  let library = [];
  let lastUsed = {};

  const search = el('input', {
    class: 'input grow',
    type: 'search',
    placeholder: 'Search exercises',
    'aria-label': 'Search exercises',
    autocomplete: 'off',
    autocorrect: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    value: state.query,
  });
  const addButton = el('a', { class: 'btn icon', href: '#/exercises/new', 'aria-label': 'New custom exercise', text: '+' });
  const muscleRow = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filter by muscle' });
  const equipmentRow = el('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filter by equipment' });
  const count = el('p', { class: 'muted', 'aria-live': 'polite' });
  const rows = el('ul', { class: 'list' });
  const more = el('button', { class: 'btn secondary', type: 'button', hidden: true });

  container.append(el('div', { class: 'search-row' }, search, addButton), muscleRow, equipmentRow, count, rows, more);

  function changed() {
    state.shown = PAGE_SIZE;
    syncChips();
    renderList();
  }

  // The chips are built once and only their pressed state is updated, so a
  // row scrolled sideways stays where it is when a chip is tapped.
  const mineChip = chip({ label: '★ My exercises', onToggle: (on) => { state.mineOnly = on; changed(); } });
  // Also match exercises that train the chosen muscle as a secondary muscle.
  // Sits after the muscle chips and only works once a muscle is chosen.
  const secondaryChip = chip({ label: '+ Secondary', onToggle: (on) => { state.includeSecondary = on; changed(); } });
  const groupChips = MUSCLE_GROUPS.map((group) => ({
    id: group.id,
    node: chip({
      label: group.label,
      onToggle: (on) => {
        state.group = on ? group.id : null;
        if (!on) state.includeSecondary = false; // starts off again for the next muscle
        changed();
      },
    }),
  }));
  const equipmentChips = EQUIPMENT.map((key) => ({
    key,
    node: chip({
      label: equipmentLabel(key),
      onToggle: (on) => { if (on) state.equipment.add(key); else state.equipment.delete(key); changed(); },
    }),
  }));
  muscleRow.append(mineChip, ...groupChips.map((c) => c.node), secondaryChip);
  equipmentRow.append(...equipmentChips.map((c) => c.node));

  function syncChips() {
    const press = (node, on) => node.setAttribute('aria-pressed', String(Boolean(on)));
    press(mineChip, state.mineOnly);
    for (const { id, node } of groupChips) press(node, state.group === id);
    for (const { key, node } of equipmentChips) press(node, state.equipment.has(key));
    press(secondaryChip, state.group && state.includeSecondary);
    secondaryChip.disabled = !state.group;
  }

  function row(exercise) {
    const star = el('button', {
      class: 'star',
      type: 'button',
      'aria-pressed': String(exercise.favourite),
      'aria-label': exercise.favourite ? `Remove ${exercise.name} from favourites` : `Add ${exercise.name} to favourites`,
      text: exercise.favourite ? '★' : '☆',
    });
    star.addEventListener('click', async () => {
      const next = !exercise.favourite;
      try {
        await setFavourite(exercise.id, next);
        exercise.favourite = next;
        renderList();
      } catch (err) {
        console.error(err);
        toast('The favourite could not be saved.');
      }
    });
    return el('li', { class: 'list-row' },
      el('a', { class: 'list-link', href: `#/exercises/${encodeURIComponent(exercise.id)}` },
        el('span', { class: 'list-title', text: exercise.name }),
        el('span', { class: 'muted', text: exerciseSummary(exercise) })
      ),
      star
    );
  }

  function renderList() {
    const total = library.filter((e) => !e.archived).length;
    const matches = sortExercises(
      filterExercises(library, {
        query: state.query,
        group: state.group,
        includeSecondary: Boolean(state.group) && state.includeSecondary,
        equipment: [...state.equipment],
        mineOnly: state.mineOnly,
      }),
      lastUsed
    );
    const filtered = matches.length !== total;
    if (!matches.length) {
      count.textContent = state.mineOnly && !state.query && !state.group && !state.equipment.size
        ? 'No favourites or custom exercises yet. Tap ☆ on an exercise to add it here.'
        : 'No exercises match.';
    } else {
      count.textContent = filtered ? `${matches.length} of ${total} exercises` : `${total} exercises`;
    }
    rows.replaceChildren(...matches.slice(0, state.shown).map(row));
    const remaining = matches.length - state.shown;
    more.hidden = remaining <= 0;
    more.textContent = `Show ${Math.min(remaining, PAGE_SIZE)} more`;
  }

  search.addEventListener('input', () => {
    state.query = search.value;
    state.shown = PAGE_SIZE;
    renderList();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') search.blur(); // closes the keyboard
  });
  more.addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    renderList();
  });

  syncChips();
  count.textContent = 'Loading…';
  Promise.all([getLibrary(), getLastUsed()])
    .then(([loadedLibrary, loadedLastUsed]) => {
      if (!alive) return;
      library = loadedLibrary;
      lastUsed = loadedLastUsed;
      renderList();
      if (state.scrollY) window.scrollTo(0, state.scrollY);
    })
    .catch((err) => {
      console.error(err);
      if (alive) count.textContent = 'The exercise list could not be loaded. Close the app and open it again.';
    });

  return () => {
    alive = false;
    state.scrollY = window.scrollY;
  };
}
