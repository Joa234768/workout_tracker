// #/settings/volume — how sets are counted per muscle group, and the weekly
// target of each group. Every change is saved immediately.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { confirmDialog } from '../ui/dialog.js';
import { getVolumeSettings, setCountingMode, setTarget, resetTargets } from '../volume.js';
import { MUSCLE_GROUPS } from '../logic/muscles.js';
import { MAX_TARGET, parseTarget } from '../logic/volume.js';

const MODES = [
  ['fractional', 'Main muscle 1, helping muscles ½', 'A set of bench press counts 1 for chest and ½ each for shoulders and triceps. The usual choice.'],
  ['primary', 'Main muscle only', 'A set of bench press counts for chest and nothing else.'],
  ['all', 'Every muscle 1', 'A set of bench press counts 1 for chest, shoulders and triceps alike.'],
];

export function mount(container) {
  let alive = true;
  const failed = (err) => {
    console.error(err);
    toast('That could not be saved.');
  };

  function render(settings) {
    // ----- Counting -----
    const counting = section('How sets are counted',
      el('div', { class: 'stack', role: 'radiogroup', 'aria-label': 'How sets are counted' },
        MODES.map(([mode, label, example]) => {
          const input = el('input', { type: 'radio', name: 'counting', value: mode, checked: settings.mode === mode });
          input.addEventListener('change', () => {
            setCountingMode(mode).then(() => toast('Counting changed.')).catch(failed);
          });
          return el('label', { class: 'option' }, input,
            el('span', { class: 'option-text' }, el('span', { text: label }), el('span', { class: 'muted', text: example })));
        })
      ),
      el('p', { class: 'muted', text: 'Only ticked sets count; warm-up sets never do. Changing this recounts earlier weeks too.' })
    );

    // ----- Targets -----
    const rows = MUSCLE_GROUPS.map((group) => {
      const id = `target-${group.id}`;
      const input = el('input', {
        class: 'input tiny',
        id,
        type: 'text',
        inputmode: 'numeric',
        pattern: '[0-9]*',
        autocomplete: 'off',
        enterkeyhint: 'done',
        placeholder: '–',
        value: settings.targets[group.id] === null ? '' : String(settings.targets[group.id]),
      });
      let saved = settings.targets[group.id];
      input.addEventListener('input', () => input.classList.toggle('invalid', parseTarget(input.value) === undefined));
      input.addEventListener('change', () => {
        const value = parseTarget(input.value);
        if (value === undefined) {
          input.value = saved === null ? '' : String(saved);
          input.classList.remove('invalid');
          toast(`Enter a whole number from 1 to ${MAX_TARGET}, or leave it empty for no target.`);
          return;
        }
        input.value = value === null ? '' : String(value);
        if (value === saved) return;
        saved = value;
        setTarget(group.id, value).catch(failed);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
      return el('div', { class: 'row' }, el('label', { for: id, text: group.label }), input);
    });

    const reset = el('button', { class: 'btn plain', type: 'button', text: 'Reset targets to the defaults' });
    reset.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Reset all targets?',
        lines: ['Every muscle group goes back to its default target.'],
        confirmLabel: 'Reset',
      });
      if (!confirmed) return;
      try {
        await resetTargets();
        toast('Targets reset.');
        await load();
      } catch (err) {
        failed(err);
      }
    });

    const targets = section('Weekly targets (sets)',
      el('p', {
        class: 'muted',
        text: 'About 10 sets a week per muscle group is a common starting point; research mostly points to somewhere between 10 and 20. Smaller muscles that get trained along with others (forearms, neck, inner and outer thigh) start without a target.',
      }),
      rows,
      el('p', { class: 'muted', text: 'Leave a field empty for no target. Groups without a target are listed under "Without a target" on Progress.' }),
      reset
    );

    container.replaceChildren(counting, targets);
  }

  async function load() {
    const settings = await getVolumeSettings();
    if (alive) render(settings);
  }
  container.append(el('p', { class: 'muted', text: 'Loading…' }));
  load().catch((err) => {
    console.error(err);
    if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The settings could not be loaded.' }));
  });

  return () => {
    alive = false;
  };
}
