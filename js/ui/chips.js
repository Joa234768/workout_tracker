// Tap chips: small toggle buttons for filters and selections.

import { el } from './dom.js';
import { MUSCLES, muscleLabel } from '../logic/muscles.js';

/** A toggle chip. onToggle(pressed) is called after each tap. */
export function chip({ label, pressed = false, onToggle }) {
  const button = el('button', { class: 'chip', type: 'button', 'aria-pressed': String(Boolean(pressed)), text: label });
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    if (onToggle) onToggle(next);
  });
  return button;
}

/** A non-interactive label in chip shape (e.g. a muscle on the detail screen). */
export function tag(label, { subtle = false } = {}) {
  return el('span', { class: subtle ? 'tag subtle' : 'tag', text: label });
}

/**
 * Two rows of chips for choosing primary and secondary muscles. A muscle is
 * never both: choosing it in one row clears it in the other.
 * Returns { node, getValue() → { primaryMuscles, secondaryMuscles } }.
 */
export function musclePicker({ primaryMuscles = [], secondaryMuscles = [] } = {}) {
  const primary = new Set(primaryMuscles);
  const secondary = new Set(secondaryMuscles.filter((m) => !primary.has(m)));
  const primaryRow = el('div', { class: 'chip-wrap', role: 'group', 'aria-label': 'Primary muscles' });
  const secondaryRow = el('div', { class: 'chip-wrap', role: 'group', 'aria-label': 'Secondary muscles' });

  function render() {
    const row = (mine, other) =>
      MUSCLES.map((muscle) =>
        chip({
          label: muscleLabel(muscle),
          pressed: mine.has(muscle),
          onToggle(pressed) {
            if (pressed) {
              mine.add(muscle);
              other.delete(muscle);
            } else {
              mine.delete(muscle);
            }
            render();
          },
        })
      );
    primaryRow.replaceChildren(...row(primary, secondary));
    secondaryRow.replaceChildren(...row(secondary, primary));
  }
  render();

  const node = el('div', { class: 'stack' },
    el('h3', { class: 'field-label', text: 'Primary muscles' }),
    el('p', { class: 'muted', text: 'Count as a full set.' }),
    primaryRow,
    el('h3', { class: 'field-label spaced', text: 'Secondary muscles' }),
    el('p', { class: 'muted', text: 'Count as half a set.' }),
    secondaryRow
  );
  return {
    node,
    getValue: () => ({ primaryMuscles: [...primary], secondaryMuscles: [...secondary] }),
  };
}
