// A modal confirmation dialog built on <dialog>.

import { el } from './dom.js';

/**
 * Shows a confirmation and resolves to true (confirmed) or false (cancelled).
 * - lines: strings shown as paragraphs (set with textContent).
 * - extra: an optional element (e.g. a button) shown above the confirm button.
 */
/**
 * A small menu of actions. Resolves to the chosen action's `value`, or null
 * if cancelled. actions: [{ label, value, danger }].
 */
export function actionSheet({ title, actions }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'dialog' });
    let chosen = null;
    const buttons = actions.map((action) =>
      el('button', {
        class: action.danger ? 'btn secondary danger-text' : 'btn secondary',
        type: 'button',
        text: action.label,
        onclick: () => {
          chosen = action.value;
          dialog.close();
        },
      })
    );
    const cancel = el('button', { class: 'btn plain', type: 'button', text: 'Cancel', onclick: () => dialog.close() });
    dialog.append(el('h2', { text: title }), el('div', { class: 'dialog-actions' }, buttons, cancel));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}

/**
 * Asks for a date. Resolves to 'YYYY-MM-DD', or null if cancelled.
 * min / max limit the choice (both optional).
 */
export function promptDate({ title, lines = [], value, min = null, max = null, confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'dialog' });
    const input = el('input', { class: 'input', type: 'date', value, min, max, 'aria-label': title });
    let chosen = null;
    const confirm = el('button', {
      class: 'btn',
      type: 'button',
      text: confirmLabel,
      onclick: () => {
        const picked = input.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(picked) || (min && picked < min) || (max && picked > max)) {
          input.classList.add('invalid');
          return;
        }
        chosen = picked;
        dialog.close();
      },
    });
    const cancel = el('button', { class: 'btn plain', type: 'button', text: 'Cancel', onclick: () => dialog.close() });
    dialog.append(
      el('h2', { text: title }),
      el('div', { class: 'dialog-body' }, lines.map((line) => el('p', { text: line })), input),
      el('div', { class: 'dialog-actions' }, confirm, cancel)
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(chosen);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function confirmDialog({ title, lines = [], confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, extra = null }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'dialog' });
    const confirm = el('button', {
      class: danger ? 'btn danger' : 'btn',
      type: 'button',
      text: confirmLabel,
      onclick: () => dialog.close('confirm'),
    });
    // cancelLabel: null gives a plain message with a single button.
    const cancel = cancelLabel === null ? null : el('button', {
      class: 'btn secondary',
      type: 'button',
      text: cancelLabel,
      onclick: () => dialog.close('cancel'),
    });
    dialog.append(
      el('h2', { text: title }),
      el('div', { class: 'dialog-body' }, lines.map((line) => el('p', { text: line }))),
      el('div', { class: 'dialog-actions' }, extra, confirm, cancel)
    );
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'confirm';
      dialog.remove();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
    (cancel || confirm).focus(); // the safe choice is the default
  });
}
