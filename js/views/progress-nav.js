// The switch at the top of every part of the Progress tab.

import { el } from '../ui/dom.js';

const PARTS = [
  ['muscles', 'Muscles', '#/progress'],
  ['exercises', 'Exercises', '#/progress/exercises'],
  ['training', 'Training', '#/progress/training'],
  ['body', 'Body', '#/progress/body'],
];

export function progressNav(current) {
  return el('nav', { class: 'segmented four', 'aria-label': 'Progress' },
    PARTS.map(([key, label, href]) =>
      el('a', { class: 'segment', href, 'aria-current': current === key ? 'page' : null, text: label })
    )
  );
}

/**
 * A row of chips where exactly one is chosen. onChange(id) is called when
 * another is tapped. `even` lays them out as equal columns on one line, using
 * each option's `short` text.
 */
export function choiceChips({ label, options, current, onChange, even = false }) {
  const row = el('div', { class: even ? 'chip-even' : 'chip-wrap', role: 'group', 'aria-label': label });
  const paint = (chosen) => {
    for (const button of row.children) button.setAttribute('aria-pressed', String(button.dataset.choice === chosen));
  };
  for (const option of options) {
    row.append(el('button', {
      class: 'chip',
      type: 'button',
      text: even && option.short ? option.short : option.label,
      'aria-label': even && option.short ? option.label : null,
      dataset: { choice: option.id },
      onclick: () => {
        if (row.querySelector('[aria-pressed="true"]')?.dataset.choice === option.id) return;
        paint(option.id);
        onChange(option.id);
      },
    }));
  }
  paint(current);
  return row;
}
