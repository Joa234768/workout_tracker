// A modal confirmation dialog built on <dialog>.

import { el } from './dom.js';

/**
 * Shows a confirmation and resolves to true (confirmed) or false (cancelled).
 * - lines: strings shown as paragraphs (set with textContent).
 * - extra: an optional element (e.g. a button) shown above the confirm button.
 */
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
