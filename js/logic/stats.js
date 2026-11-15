// Numbers behind the charts: per-exercise progress, training frequency and
// the body-weight trend. Pure module. See docs/DATA_MODEL.md, "Derived values".

import { addDays, startOfWeek } from './dates.js';
import { occurrencesInRange } from './plan.js';
import { isWorkingSet, parseKg, setVolume } from './sets.js';

export const E1RM_MAX_REPS = 12;

/**
 * Estimated one-rep maximum (Epley): kg × (1 + reps / 30). Only for sets of
 * 1–12 reps with a weight; the estimate gets poor beyond that. A single rep
 * is its own weight. Returns null when it does not apply.
 */
export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/**
 * One point per session, oldest first, from exerciseHistory() (working sets only):
 * { workoutId, date, e1rm (best of the session, or null), top (heaviest kg),
 *   topReps (reps at that weight), volume (Σ kg × reps), reps (Σ reps), bestReps }.
 */
export function exerciseSeries(history) {
  return [...history].reverse().map((session) => {
    const point = { workoutId: session.workoutId, date: session.date, e1rm: null, top: 0, topReps: 0, volume: 0, reps: 0, bestReps: 0 };
    for (const set of session.sets) {
      const kg = typeof set.kg === 'number' ? set.kg : 0;
      const estimate = e1rm(kg, set.reps);
      if (estimate !== null && (point.e1rm === null || estimate > point.e1rm)) point.e1rm = estimate;
      if (kg > point.top || (kg === point.top && set.reps > point.topReps)) {
        point.top = kg;
        point.topReps = set.reps;
      }
      point.volume += setVolume(set);
      point.reps += set.reps;
      point.bestReps = Math.max(point.bestReps, set.reps);
    }
    return point;
  });
}

/** True when no session ever used a weight: such exercises chart reps instead. */
export function isBodyweightSeries(series) {
  return series.length > 0 && series.every((point) => point.top === 0);
}

/** The charts an exercise offers: [{ id, label, unit, note? }]. */
export function metricsFor(series) {
  if (isBodyweightSeries(series)) {
    return [
      { id: 'bestReps', label: 'Best set', unit: 'reps' },
      { id: 'reps', label: 'Total reps', unit: 'reps' },
    ];
  }
  return [
    { id: 'e1rm', label: 'Est. 1RM', unit: 'kg' },
    { id: 'top', label: 'Top set', unit: 'kg' },
    { id: 'volume', label: 'Volume', unit: 'kg' },
  ];
}

export const RANGES = [
  { id: '1m', label: '1 month', short: '1 mo', days: 30 },
  { id: '3m', label: '3 months', short: '3 mo', days: 91 },
  { id: '1y', label: '1 year', short: '1 year', days: 365 },
  { id: 'all', label: 'All', short: 'All', days: null },
];

/** The first day of a time range ending today, or null for 'all'. */
export function rangeStart(rangeId, today) {
  const range = RANGES.find((r) => r.id === rangeId);
  return range && range.days ? addDays(today, -range.days) : null;
}

/** The items (anything with a `date`) on or after the start of the range. */
export function inRange(items, rangeId, today) {
  const from = rangeStart(rangeId, today);
  return from ? items.filter((item) => item.date >= from) : items;
}

/**
 * Workouts per Monday–Sunday week, oldest first, up to the current week:
 * [{ week (its Monday), done, planned, due, plannedDone }].
 * - done: completed workouts dated in the week (planned or not)
 * - planned: planned workouts in the week that were not cancelled
 * - due: the planned ones that are done or whose day has passed (today's and
 *   later ones are not held against me yet)
 * - plannedDone: how many of the planned ones were done (same rule as the calendar)
 * `from` is the first day to include; null starts at the first completed
 * workout or the start of the first plan, whichever is earlier.
 */
export function weeklyTraining(from, today, { rules = [], exceptions = [], oneOffs = [], workouts = [] }) {
  const completed = workouts.filter((workout) => workout.status === 'completed');
  let first = from;
  if (!first) {
    const starts = [...completed.map((w) => w.date), ...rules.map((r) => r.startDate)].filter((d) => d && d <= today).sort();
    if (!starts.length) return [];
    first = starts[0];
  }
  const doneRefs = new Set(completed.map((workout) => workout.plannedRef).filter(Boolean));
  const doneDates = new Set(completed.map((workout) => workout.date));
  const isDone = (o) => doneRefs.has(o.ref) || doneDates.has(o.date);
  const lastWeek = startOfWeek(today);
  const weeks = [];
  for (let week = startOfWeek(first); week <= lastWeek; week = addDays(week, 7)) {
    const end = addDays(week, 6);
    const occurrences = occurrencesInRange(week, end, { rules, exceptions, oneOffs }).filter((o) => !o.cancelled);
    weeks.push({
      week,
      done: completed.filter((workout) => workout.date >= week && workout.date <= end).length,
      planned: occurrences.length,
      due: occurrences.filter((o) => o.date < today || isDone(o)).length,
      plannedDone: occurrences.filter(isDone).length,
    });
  }
  return weeks;
}

/** Totals over weeklyTraining(): { weeks, done, perWeek, due, plannedDone }. */
export function trainingSummary(weeks) {
  const sum = (key) => weeks.reduce((n, week) => n + week[key], 0);
  const done = sum('done');
  return { weeks: weeks.length, done, perWeek: weeks.length ? done / weeks.length : 0, due: sum('due'), plannedDone: sum('plannedDone') };
}

/**
 * The exercises I have logged, most recently used first:
 * [{ exerciseId, sessions, lastDate }]. Only completed workouts and working sets count.
 */
export function loggedExercises(workouts) {
  const byId = new Map();
  for (const workout of workouts) {
    if (workout.status !== 'completed') continue;
    const used = new Set((workout.exercises || []).filter((entry) => (entry.sets || []).some(isWorkingSet)).map((entry) => entry.exerciseId));
    for (const exerciseId of used) {
      const item = byId.get(exerciseId) || { exerciseId, sessions: 0, lastDate: '' };
      item.sessions += 1;
      if (workout.date > item.lastDate) item.lastDate = workout.date;
      byId.set(exerciseId, item);
    }
  }
  return [...byId.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

/**
 * The trend line of the body-weight log: for each entry, the average of all
 * entries in the 7 days ending on its date. entries: [{ date, kg }], any order.
 * Returns [{ date, kg }], oldest first.
 */
export function movingAverage(entries, days = 7) {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let start = 0;
  let sum = 0;
  return sorted.map((entry, i) => {
    sum += entry.kg;
    const from = addDays(entry.date, -(days - 1));
    while (sorted[start].date < from) sum -= sorted[start++].kg;
    return { date: entry.date, kg: sum / (i - start + 1) };
  });
}

export const MIN_BODY_KG = 20;
export const MAX_BODY_KG = 400;

/** Text typed into the body-weight field → kg (comma or dot), or null if it is not a plausible body weight. */
export function parseBodyKg(text) {
  const kg = parseKg(text);
  return kg !== null && kg >= MIN_BODY_KG && kg <= MAX_BODY_KG ? kg : null;
}

/** One decimal, without a trailing '.0': 78.44 → '78.4', 80 → '80'. */
export function formatOneDecimal(value) {
  return String(Math.round(value * 10) / 10);
}
