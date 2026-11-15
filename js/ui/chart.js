// Charts. Chart.js (vendored in lib/, see lib/README.md) is loaded the first
// time a chart is shown, not at startup. The charts follow the app's colours
// and are redrawn when the phone switches between light and dark.
//
// Dates are plotted on a plain number axis as day numbers (dayNumber), so no
// date library is needed; ticks and tooltips turn them back into dates.

import { el } from './dom.js';
import { addDays, diffDays, formatShortDate, todayStr } from '../logic/dates.js';

const EPOCH = '2000-01-01';
export const dayNumber = (dateStr) => diffDays(EPOCH, dateStr);
export const dateOfDay = (n) => addDays(EPOCH, Math.round(n));

let chartPromise = null;

/** Resolves to the Chart constructor. The service worker serves the file offline. */
export function loadChart() {
  if (!chartPromise) {
    chartPromise = new Promise((resolve, reject) => {
      if (window.Chart) return resolve(window.Chart);
      const script = document.createElement('script');
      script.src = './lib/chart.umd.min.js';
      script.onload = () => (window.Chart ? resolve(window.Chart) : reject(new Error('Chart.js did not load.')));
      script.onerror = () => reject(new Error('Chart.js could not be loaded.'));
      document.head.append(script);
    }).catch((err) => {
      chartPromise = null; // allow a retry
      throw err;
    });
  }
  return chartPromise;
}

/** The app's current colours, as the canvas needs real colour values. */
export function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const read = (name) => style.getPropertyValue(name).trim();
  return {
    accent: read('--accent'),
    accentSoft: read('--accent-soft'),
    text: read('--text'),
    muted: read('--muted'),
    grid: read('--border'),
    surface: read('--surface'),
    font: read('--font') || 'system-ui, sans-serif',
  };
}

/**
 * Options shared by every chart: quiet grid and axes, no animation, a tooltip
 * for the nearest point. `dates: true` makes the x-axis a day-number axis;
 * `from` and `to` (dates) then keep the axis to the days that have data.
 */
export function baseOptions(colors, { dates = false, legend = false, yTitle = null, integerY = false, zeroY = false, from = null, to = null } = {}) {
  const today = todayStr();
  const tick = { color: colors.muted, font: { family: colors.font, size: 12 } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    layout: { padding: { top: 8, right: 8 } },
    plugins: {
      legend: {
        display: legend,
        position: 'bottom',
        labels: { color: colors.text, font: { family: colors.font, size: 13 }, usePointStyle: true, boxHeight: 7, padding: 14 },
      },
      tooltip: {
        displayColors: legend,
        titleFont: { family: colors.font, size: 13 },
        bodyFont: { family: colors.font, size: 13 },
        padding: 10,
      },
    },
    scales: {
      x: {
        type: dates ? 'linear' : 'category',
        ...(dates && from && to ? { min: dayNumber(from) - 1, max: dayNumber(to) + 1 } : {}),
        grid: { display: false },
        border: { color: colors.grid },
        ticks: {
          ...tick,
          maxRotation: 0,
          autoSkipPadding: 16,
          maxTicksLimit: 5,
          includeBounds: false, // the axis ends a day outside the data; don't label those days
          ...(dates ? { callback: (value) => (Number.isInteger(value) ? formatShortDate(dateOfDay(value), today) : '') } : {}),
        },
      },
      y: {
        beginAtZero: zeroY,
        grace: zeroY ? 0 : '8%',
        grid: { color: colors.grid },
        border: { display: false },
        ticks: { ...tick, maxTicksLimit: 6, precision: integerY ? 0 : undefined },
        title: { display: Boolean(yTitle), text: yTitle || '', color: colors.muted, font: { family: colors.font, size: 12 } },
      },
    },
  };
}

/**
 * A box holding one chart. Append `node` to the page, then call
 * show((colors) => chartJsConfig). Calling show again replaces the chart.
 * destroy() must be called when the screen is left.
 */
export function chartBox(ariaLabel) {
  const canvas = el('canvas', { role: 'img', 'aria-label': ariaLabel });
  const message = el('p', { class: 'muted chart-message', hidden: true });
  const node = el('div', { class: 'chart-box' }, canvas, message);
  let chart = null;
  let build = null;
  let dead = false;

  async function draw() {
    let Chart;
    try {
      Chart = await loadChart();
    } catch (err) {
      console.error(err);
      message.textContent = 'The chart could not be shown.';
      message.hidden = false;
      return;
    }
    if (dead || !build) return;
    if (chart) chart.destroy();
    chart = new Chart(canvas, build(themeColors()));
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onTheme = () => {
    if (build) draw();
  };
  media.addEventListener('change', onTheme);

  return {
    node,
    show(buildConfig) {
      build = buildConfig;
      return draw();
    },
    destroy() {
      dead = true;
      media.removeEventListener('change', onTheme);
      if (chart) chart.destroy();
      chart = null;
    },
  };
}
