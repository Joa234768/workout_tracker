// #/progress/body — the body-weight log: one entry per day, a chart of the
// entries with a 7-day average trend line, and the latest entries.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { confirmDialog } from '../ui/dialog.js';
import { chartBox, baseOptions, dayNumber, dateOfDay } from '../ui/chart.js';
import { getBodyWeights, saveBodyWeight, deleteBodyWeight } from '../body.js';
import { progressNav, choiceChips } from './progress-nav.js';
import { movingAverage, inRange, parseBodyKg, RANGES, formatOneDecimal, MIN_BODY_KG, MAX_BODY_KG } from '../logic/stats.js';
import { formatDate, isValidDateStr, todayStr, weekdayName } from '../logic/dates.js';
import { formatKg } from '../logic/sets.js';

// Kept while the app is open.
const state = { range: '3m' };
const LIST_SHOWN = 10;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatOneDecimal(Math.abs(n))}`;

export function mount(container) {
  let alive = true;
  let entries = [];
  const today = todayStr();
  const box = chartBox('Body weight');

  // ----- Adding an entry -----
  const dateInput = el('input', { class: 'input grow', id: 'body-date', type: 'date', value: today, max: today });
  const kgInput = el('input', {
    class: 'input short',
    id: 'body-kg',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'done',
    placeholder: 'kg',
    'aria-label': 'Weight in kg',
  });
  const save = el('button', { class: 'btn', type: 'button', text: 'Save weight' });
  const existing = el('p', { class: 'muted', hidden: true });

  function showExisting() {
    const entry = entries.find((e) => e.date === dateInput.value);
    existing.hidden = !entry;
    if (entry) existing.textContent = `${formatDate(entry.date)} already has ${formatKg(entry.kg)} kg. Saving replaces it.`;
  }
  dateInput.addEventListener('change', showExisting);
  kgInput.addEventListener('input', () => kgInput.classList.toggle('invalid', kgInput.value.trim() !== '' && parseBodyKg(kgInput.value) === null));
  kgInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save.click();
  });
  save.addEventListener('click', async () => {
    const kg = parseBodyKg(kgInput.value);
    if (kg === null) {
      toast(`Enter a weight between ${MIN_BODY_KG} and ${MAX_BODY_KG} kg.`);
      kgInput.focus();
      return;
    }
    if (!isValidDateStr(dateInput.value) || dateInput.value > today) {
      toast('Choose today or an earlier date.');
      return;
    }
    try {
      await saveBodyWeight(dateInput.value, kg);
      kgInput.value = '';
      kgInput.blur();
      toast('Weight saved.');
      await reload();
    } catch (err) {
      console.error(err);
      toast('The weight could not be saved.');
    }
  });

  // ----- Chart, summary, list -----
  const facts = el('div', { class: 'stats' });
  const empty = el('p', { class: 'muted', hidden: true });
  const list = el('div', { class: 'stack' });
  const stat = (value, label) => el('div', { class: 'stat' }, el('span', { class: 'stat-value', text: value }), el('span', { class: 'muted', text: label }));

  container.append(
    progressNav('body'),
    section('Body weight',
      el('div', { class: 'row' }, dateInput, kgInput),
      existing,
      save
    ),
    section('Trend',
      choiceChips({ label: 'Time range', options: RANGES, even: true, current: state.range, onChange: (range) => { state.range = range; draw(); } }),
      box.node, empty, facts
    ),
    list
  );

  function draw() {
    // The average is worked out over all entries, then cut to the period, so
    // its first point still uses the days just before the period.
    const points = inRange(entries, state.range, today);
    const trend = inRange(movingAverage(entries), state.range, today);
    box.node.hidden = !points.length;
    empty.hidden = Boolean(points.length);
    if (!points.length) {
      empty.textContent = entries.length ? 'No entries in this period. Choose a longer one.' : 'Save your weight now and then to see the trend here.';
      facts.replaceChildren();
      return;
    }
    const latest = points[points.length - 1];
    const change = trend[trend.length - 1].kg - trend[0].kg;
    facts.replaceChildren(
      stat(`${formatOneDecimal(latest.kg)} kg`, `latest · ${formatDate(latest.date)}`),
      stat(`${formatOneDecimal(trend[trend.length - 1].kg)} kg`, '7-day average'),
      points.length > 1 ? stat(`${signed(change)} kg`, 'change of the average') : null
    );

    box.show((colors) => {
      const options = baseOptions(colors, { dates: true, legend: true, yTitle: 'kg', from: points[0].date, to: latest.date });
      options.plugins.tooltip.callbacks = {
        title: (items) => formatDate(dateOfDay(items[0].parsed.x)),
        label: (item) => `${item.dataset.label}: ${formatOneDecimal(item.parsed.y)} kg`,
      };
      const xy = (items) => items.map((item) => ({ x: dayNumber(item.date), y: item.kg }));
      return {
        type: 'line',
        data: {
          datasets: [
            {
              label: '7-day average',
              data: xy(trend),
              borderColor: colors.accent,
              backgroundColor: colors.accent,
              borderWidth: 2,
              pointRadius: 0,
              pointHitRadius: 0,
              pointStyle: 'line',
              tension: 0,
              order: 1,
            },
            {
              label: 'Entries',
              data: xy(points),
              showLine: false,
              pointRadius: points.length > 60 ? 2.5 : 4,
              pointHoverRadius: 6,
              pointHitRadius: 14,
              pointStyle: 'circle',
              pointBackgroundColor: colors.surface,
              pointBorderColor: colors.muted,
              pointBorderWidth: 1.5,
              borderColor: colors.muted,
              backgroundColor: colors.surface,
              order: 2,
            },
          ],
        },
        options,
      };
    });
  }

  function renderList() {
    if (!entries.length) {
      list.replaceChildren();
      return;
    }
    const latestFirst = [...entries].reverse();
    list.replaceChildren(
      section('Entries',
        el('ul', { class: 'entry-list' },
          latestFirst.slice(0, LIST_SHOWN).map((entry) => {
            const remove = el('button', { class: 'icon-button', type: 'button', 'aria-label': `Delete the entry of ${formatDate(entry.date)}`, text: '×' });
            remove.addEventListener('click', async () => {
              const confirmed = await confirmDialog({
                title: 'Delete this entry?',
                lines: [`${formatKg(entry.kg)} kg on ${formatDate(entry.date)}.`],
                confirmLabel: 'Delete',
                danger: true,
              });
              if (!confirmed) return;
              try {
                await deleteBodyWeight(entry.date);
                toast('Entry deleted.');
                await reload();
              } catch (err) {
                console.error(err);
                toast('The entry could not be deleted.');
              }
            });
            return el('li', { dataset: { date: entry.date } },
              el('span', { class: 'entry-list-date' },
                el('span', { text: formatDate(entry.date) }),
                el('span', { class: 'muted', text: weekdayName(entry.date) })
              ),
              el('span', { class: 'nums', text: `${formatKg(entry.kg)} kg` }),
              remove
            );
          })
        ),
        entries.length > LIST_SHOWN
          ? el('p', { class: 'muted', text: `Showing the latest ${LIST_SHOWN} of ${entries.length} entries. To correct an older one, save that date again.` })
          : el('p', { class: 'muted', text: 'To correct an entry, save that date again.' })
      )
    );
  }

  async function reload() {
    const loaded = await getBodyWeights();
    if (!alive) return;
    entries = loaded;
    showExisting();
    draw();
    renderList();
  }
  reload().catch((err) => {
    console.error(err);
    if (alive) {
      box.node.hidden = true;
      empty.hidden = false;
      empty.textContent = 'The entries could not be loaded.';
    }
  });

  return () => {
    alive = false;
    box.destroy();
  };
}
