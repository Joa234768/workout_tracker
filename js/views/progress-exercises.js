// #/progress/exercises — the exercises I have logged, and
// #/progress/exercises/<id> — one exercise over time: estimated 1RM, top set
// and volume per session. Tapping a point opens that workout.

import { el, section } from '../ui/dom.js';
import { chartBox, baseOptions, dayNumber, dateOfDay } from '../ui/chart.js';
import { getExercise, getExerciseHistory, getLibrary } from '../exercises.js';
import { getAllWorkouts } from '../workouts.js';
import { progressNav, choiceChips } from './progress-nav.js';
import { exerciseSeries, metricsFor, loggedExercises, inRange, RANGES, formatOneDecimal } from '../logic/stats.js';
import { formatDate, todayStr } from '../logic/dates.js';
import { formatKg, formatWhole } from '../logic/sets.js';

// Kept while the app is open.
const state = { metric: 'e1rm', range: '3m' };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function mountList(container) {
  let alive = true;
  const body = el('div', { class: 'stack-lg' }, el('p', { class: 'muted', text: 'Loading…' }));
  container.append(progressNav('exercises'), body);

  Promise.all([getAllWorkouts(), getLibrary()])
    .then(([workouts, library]) => {
      if (!alive) return;
      const logged = loggedExercises(workouts);
      if (!logged.length) {
        body.replaceChildren(section('Exercises', el('p', { class: 'muted', text: 'Exercises you have logged appear here, each with charts of your progress.' })));
        return;
      }
      const nameOf = new Map(library.map((exercise) => [exercise.id, exercise.name]));
      body.replaceChildren(
        el('p', { class: 'muted', text: `${plural(logged.length, 'exercise', 'exercises')} logged, latest first. Tap one for its charts.` }),
        el('ul', { class: 'list' },
          logged.map((item) =>
            el('li', { class: 'list-row' },
              el('a', { class: 'list-link padded', href: `#/progress/exercises/${encodeURIComponent(item.exerciseId)}` },
                el('span', { class: 'list-title', text: nameOf.get(item.exerciseId) || item.exerciseId }),
                el('span', { class: 'muted', text: `${plural(item.sessions, 'session', 'sessions')} · last ${formatDate(item.lastDate)}` })
              )
            )
          )
        )
      );
    })
    .catch((err) => {
      console.error(err);
      if (alive) body.replaceChildren(el('p', { class: 'muted', text: 'The exercises could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}

// How each number is written: on the axis/tooltip and in the summary line.
const FORMAT = {
  e1rm: (point) => `${formatOneDecimal(point.e1rm)} kg`,
  top: (point) => `${formatKg(point.top)} kg × ${point.topReps}`,
  volume: (point) => `${formatWhole(point.volume)} kg`,
  bestReps: (point) => plural(point.bestReps, 'rep', 'reps'),
  reps: (point) => plural(point.reps, 'rep', 'reps'),
};
const NOTES = {
  e1rm: 'Estimated 1RM is a guess at the most you could lift once, worked out from your best set of up to 12 reps: weight × (1 + reps ÷ 30). It is an estimate, best used to see the direction over time.',
  top: 'The heaviest working set of each session.',
  volume: 'Weight × reps, added up over the working sets of each session.',
  bestReps: 'The most reps in one set of each session.',
  reps: 'All reps of the working sets of each session, added up.',
};

export function mountCharts(container, { id }) {
  let alive = true;
  const box = chartBox('Progress chart');
  const title = el('h2', { class: 'detail-title', text: '…' });
  const metricSlot = el('div');
  const summary = el('p', { class: 'muted', 'aria-live': 'polite' });
  const note = el('p', { class: 'muted hint' });
  const empty = el('p', { class: 'muted', hidden: true });
  const today = todayStr();

  container.append(
    section(null, title, metricSlot,
      choiceChips({ label: 'Time range', options: RANGES, even: true, current: state.range, onChange: (range) => { state.range = range; draw(); } }),
      box.node, empty, summary
    ),
    note,
    el('a', { class: 'btn secondary', href: `#/exercises/${encodeURIComponent(id)}`, text: 'Exercise details' })
  );

  let series = [];
  let metrics = [];

  function draw() {
    const metric = metrics.find((m) => m.id === state.metric) || metrics[0];
    if (!metric) return;
    const points = inRange(series, state.range, today).filter((point) => point[metric.id] !== null);
    note.textContent = `${NOTES[metric.id]} Warm-up sets are left out. Tap a point to open that workout.`;
    box.node.hidden = !points.length;
    empty.hidden = Boolean(points.length);
    if (!points.length) {
      empty.textContent = series.length ? 'No sessions in this period. Choose a longer one.' : 'No logged sets yet.';
      summary.textContent = '';
      return;
    }
    const best = points.reduce((a, b) => (b[metric.id] > a[metric.id] ? b : a));
    const latest = points[points.length - 1];
    summary.textContent = `Latest: ${FORMAT[metric.id](latest)} (${formatDate(latest.date)}) · Best: ${FORMAT[metric.id](best)} (${formatDate(best.date)})`;

    box.show((colors) => {
      const options = baseOptions(colors, { dates: true, yTitle: metric.unit, from: points[0].date, to: latest.date });
      options.plugins.tooltip.callbacks = {
        title: (items) => formatDate(dateOfDay(items[0].parsed.x)),
        label: (item) => FORMAT[metric.id](points[item.dataIndex]),
      };
      options.onClick = (event, elements) => {
        if (!elements.length) return;
        location.hash = `#/calendar/${encodeURIComponent(points[elements[0].index].workoutId)}`;
      };
      return {
        type: 'line',
        data: {
          datasets: [{
            label: metric.label,
            data: points.map((point) => ({ x: dayNumber(point.date), y: point[metric.id] })),
            borderColor: colors.accent,
            backgroundColor: colors.accent,
            borderWidth: 2,
            pointRadius: points.length > 40 ? 2 : 4,
            pointHoverRadius: 6,
            pointHitRadius: 18,
            pointBorderColor: colors.surface,
            pointBorderWidth: points.length > 40 ? 0 : 2,
            tension: 0,
          }],
        },
        options,
      };
    });
  }

  Promise.all([getExercise(id), getExerciseHistory(id)])
    .then(([exercise, history]) => {
      if (!alive) return;
      title.textContent = exercise ? exercise.name : id;
      series = exerciseSeries(history);
      metrics = metricsFor(series);
      if (!metrics.some((m) => m.id === state.metric)) state.metric = metrics[0].id;
      metricSlot.replaceChildren(
        choiceChips({ label: 'What to show', options: metrics, current: state.metric, onChange: (metric) => { state.metric = metric; draw(); } })
      );
      draw();
    })
    .catch((err) => {
      console.error(err);
      if (alive) summary.textContent = 'This exercise could not be loaded.';
    });

  return () => {
    alive = false;
    box.destroy();
  };
}
