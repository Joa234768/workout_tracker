// The warm-up calculator: from a working weight and a bar weight it shows a
// standard ramp, and offers to add it as warm-up rows.

import { el } from './dom.js';
import { warmupSets } from '../logic/helpers.js';
import { formatKg, parseKg } from '../logic/sets.js';

/**
 * Resolves to { sets: [{ kg, reps }], barKg } when "Add as warm-up sets" is
 * tapped, or null if cancelled. workKg may be null (nothing to start from).
 */
export function warmupDialog({ title, workKg, barKg }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'dialog' });
    let result = null;

    const field = (id, label, value) => {
      const input = el('input', {
        class: 'input short',
        id,
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        enterkeyhint: 'done',
        value: value === null || value === undefined ? '' : formatKg(value),
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
      return { input, row: el('div', { class: 'row' }, el('label', { for: id, text: label }), input) };
    };
    const work = field('warmup-work', 'Working weight (kg)', workKg);
    const bar = field('warmup-bar', 'Bar weight (kg)', barKg);

    const list = el('ul', { class: 'plain-list warmup-list', 'aria-live': 'polite' });
    const add = el('button', { class: 'btn', type: 'button', text: 'Add as warm-up sets' });
    let sets = [];

    function update() {
      const workValue = parseKg(work.input.value);
      const barValue = parseKg(bar.input.value);
      work.input.classList.toggle('invalid', work.input.value.trim() !== '' && workValue === null);
      bar.input.classList.toggle('invalid', barValue === null);
      sets = workValue !== null && barValue !== null ? warmupSets(workValue, barValue) : [];
      add.disabled = !sets.length;
      if (sets.length) {
        list.replaceChildren(...sets.map((set) => el('li', { text: `${formatKg(set.kg)} kg × ${set.reps}` })));
      } else {
        const why = workValue === null || barValue === null
          ? 'Enter the weight you will work with.'
          : 'This weight is too light to need a ramp.';
        list.replaceChildren(el('li', { class: 'muted', text: why }));
      }
    }
    work.input.addEventListener('input', update);
    bar.input.addEventListener('input', update);
    update();

    add.addEventListener('click', () => {
      result = { sets, barKg: parseKg(bar.input.value) };
      dialog.close();
    });
    const cancel = el('button', { class: 'btn secondary', type: 'button', text: 'Cancel', onclick: () => dialog.close() });

    dialog.append(
      el('h2', { text: title }),
      el('div', { class: 'dialog-body' },
        work.row, bar.row, list,
        el('p', { class: 'muted', text: 'Empty bar, then about 40 %, 60 % and 80 %, rounded to 2.5 kg. Use bar weight 0 for dumbbells and machines.' })
      ),
      el('div', { class: 'dialog-actions' }, add, cancel)
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
