// Banners and toasts shown in the slot above the tab bar.

import { el } from './dom.js';

const slot = () => document.getElementById('banners');

/** A persistent, tappable banner. Showing the same id twice keeps one. Returns a remove function. */
export function showBanner({ id, text, onTap }) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const banner = el('button', { class: 'banner', id, type: 'button', text, onclick: onTap });
  slot().append(banner);
  return () => banner.remove();
}

/** A short message that disappears by itself. */
export function toast(text, ms = 3500) {
  const node = el('div', { class: 'toast', role: 'status', text });
  slot().prepend(node);
  setTimeout(() => node.remove(), ms);
}
