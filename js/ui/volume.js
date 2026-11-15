// Shared pieces for showing weekly sets per muscle group: the bar toward a
// target, and the compact grid used on Today.

import { el } from './dom.js';
import { formatKg } from '../logic/sets.js';
import { BASELINE_TARGET } from '../logic/volume.js';

/** '6 / 10' with a target, '6' without. */
export function setsText({ sets, target }) {
  return target ? `${formatKg(sets)} / ${formatKg(target)}` : formatKg(sets);
}

/**
 * A bar toward the weekly target. The target sits two thirds along, so going
 * past it still shows; the bar is full at one and a half times the target.
 */
export function weekBar({ label, sets, target }) {
  const scale = Math.max((target || BASELINE_TARGET) * 1.5, sets);
  const percent = (n) => `${Math.min(100, (n / scale) * 100).toFixed(2)}%`;
  return el('div', {
    class: target && sets >= target ? 'bar reached' : 'bar',
    role: 'img',
    'aria-label': target ? `${label}: ${formatKg(sets)} of ${formatKg(target)} sets` : `${label}: ${formatKg(sets)} sets`,
  },
    el('span', { class: 'bar-fill', style: `width:${percent(sets)}` }),
    target ? el('span', { class: 'bar-marker', style: `left:${percent(target)}` }) : null
  );
}

/** Two columns of small bars: the groups that have a target. */
export function compactBars(groups) {
  return el('ul', { class: 'mini-bars' },
    groups.filter((group) => group.target).map((group) =>
      el('li', { dataset: { group: group.id } },
        el('div', { class: 'progress-head' },
          el('span', { class: 'one-line', text: group.label }),
          el('span', { class: 'muted nums', text: setsText(group) })
        ),
        weekBar(group)
      )
    )
  );
}
