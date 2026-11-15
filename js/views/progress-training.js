// #/progress/training — how often I train: finished workouts per week, with
// the number planned for each week marked on top. No streaks.

import { el, section } from '../ui/dom.js';
import { chartBox, baseOptions } from '../ui/chart.js';
import { loadPlanData } from '../plan.js';
import { progressNav, choiceChips } from './progress-nav.js';
import { weeklyTraining, trainingSummary, rangeStart, RANGES, formatOneDecimal } from '../logic/stats.js';
import { addDays, formatDate, formatShortDate, todayStr } from '../logic/dates.js';

// Kept while the app is open.
const state = { range: '3m' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mount(container) {
  let alive = true;
  let data = null;
  const today = todayStr();
  const box = chartBox('Workouts per week');
  const facts = el('div', { class: 'stats' });
  const empty = el('p', { class: 'muted', hidden: true });

  container.append(
    progressNav('training'),
    section('Workouts per week',
      choiceChips({ label: 'Time range', options: RANGES, even: true, current: state.range, onChange: (range) => { state.range = range; draw(); } }),
      box.node, empty, facts
    ),
    el('p', { class: 'muted hint', text: 'Bars are finished workouts in each Monday–Sunday week. The short line marks how many were planned that week; cancelled workouts are not counted as planned.' })
  );

  const stat = (value, label) => el('div', { class: 'stat' }, el('span', { class: 'stat-value', text: value }), el('span', { class: 'muted', text: label }));

  function draw() {
    if (!data) return;
    const weeks = weeklyTraining(rangeStart(state.range, today), today, data);
    const hasAnything = weeks.some((week) => week.done || week.planned);
    box.node.hidden = !hasAnything;
    empty.hidden = hasAnything;
    if (!hasAnything) {
      empty.textContent = 'Nothing finished or planned in this period yet.';
      facts.replaceChildren();
      return;
    }
    const totals = trainingSummary(weeks);
    facts.replaceChildren(
      stat(String(totals.done), totals.done === 1 ? 'workout' : 'workouts'),
      stat(formatOneDecimal(totals.perWeek), 'a week on average'),
      totals.due ? stat(`${totals.plannedDone} of ${totals.due}`, 'planned workouts done') : null
    );
    const anyPlanned = weeks.some((week) => week.planned);

    box.show((colors) => {
      const options = baseOptions(colors, { legend: anyPlanned, integerY: true, zeroY: true });
      options.scales.y.suggestedMax = 4;
      options.plugins.tooltip.callbacks = {
        title: (items) => `${formatDate(weeks[items[0].dataIndex].week)} – ${formatDate(addDays(weeks[items[0].dataIndex].week, 6))}`,
        label: (item) => (item.dataset.label === 'Done' ? `${plural(item.parsed.y, 'workout', 'workouts')} done` : `${item.parsed.y} planned`),
      };
      const datasets = [{
        label: 'Done',
        data: weeks.map((week) => week.done),
        backgroundColor: colors.accent,
        borderRadius: 4,
        maxBarThickness: 28,
        categoryPercentage: 0.8,
        barPercentage: 0.9,
        pointStyle: 'rectRounded',
        order: 2,
      }];
      if (anyPlanned) {
        // Planned is a reference mark, not a second colour: a short dark line per week.
        datasets.push({
          type: 'line',
          label: 'Planned',
          data: weeks.map((week) => week.planned || null), // no mark in weeks with nothing planned
          showLine: false,
          pointStyle: 'line',
          pointRadius: weeks.length > 30 ? 4 : 9,
          pointHoverRadius: weeks.length > 30 ? 5 : 10,
          pointBorderWidth: 2.5,
          pointBorderColor: colors.text,
          borderColor: colors.text,
          backgroundColor: colors.text,
          order: 1,
        });
      }
      return { type: 'bar', data: { labels: weeks.map((week) => formatShortDate(week.week, today)), datasets }, options };
    });
  }

  loadPlanData()
    .then((loaded) => {
      if (!alive) return;
      data = loaded;
      draw();
    })
    .catch((err) => {
      console.error(err);
      if (alive) {
        box.node.hidden = true;
        empty.hidden = false;
        empty.textContent = 'The workouts could not be loaded.';
      }
    });

  return () => {
    alive = false;
    box.destroy();
  };
}
