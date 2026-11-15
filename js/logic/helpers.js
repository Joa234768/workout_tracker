// The smart helpers: progression suggestions, the warm-up ramp and the CSV
// export. Pure module. See docs/DATA_MODEL.md, "Derived values".

import { formatDate } from './dates.js';
import { formatKg, isDoneSet, parseKg } from './sets.js';

// ----- Progression (double progression) -----

export const DEFAULT_INCREMENT = 2.5;
export const MAX_INCREMENT = 50;

/** Text typed into the weight-step field → kg (above 0, at most MAX_INCREMENT), or null. */
export function parseIncrement(text) {
  const kg = parseKg(text);
  return kg !== null && kg > 0 && kg <= MAX_INCREMENT ? kg : null;
}

// The sets that are judged: those at the session's heaviest weight.
function topSets(sets) {
  const kgOf = (set) => (typeof set.kg === 'number' ? set.kg : 0);
  const top = sets.reduce((max, set) => Math.max(max, kgOf(set)), 0);
  return { kg: top, reps: sets.filter((set) => kgOf(set) === top).map((set) => set.reps) };
}

/**
 * What to try this time, from the last sessions of the exercise.
 * sessions: working sets of the latest sessions, newest first: [[{ kg, reps }], …].
 * Returns null without a last session, otherwise one of
 * - { kind: 'increase', kg, reps }  every set reached the top of the range:
 *                                   add the increment, aim for the bottom
 * - { kind: 'hold', kg }            below the range two sessions in a row:
 *                                   keep the weight or reduce it
 * - { kind: 'more-reps', kg }       otherwise: same weight, one more rep
 * - { kind: 'add-load' }            a bodyweight exercise at the top of the range
 * With mixed weights, the sets at the heaviest weight are the ones judged.
 */
export function suggestProgression({ sessions = [], repMin, repMax, increment = DEFAULT_INCREMENT }) {
  const [last, previous] = sessions;
  if (!last || !last.length) return null;
  const now = topSets(last);
  if (now.reps.every((reps) => reps >= repMax)) {
    return now.kg > 0
      ? { kind: 'increase', kg: Math.round((now.kg + increment) * 100) / 100, reps: repMin }
      : { kind: 'add-load' };
  }
  const below = (session) => Boolean(session && session.length) && topSets(session).reps.some((reps) => reps < repMin);
  if (below(last) && below(previous)) return { kind: 'hold', kg: now.kg };
  return { kind: 'more-reps', kg: now.kg };
}

/** The suggestion as the muted hint shown under "Last time". */
export function suggestionText(suggestion, { repMin, repMax }) {
  if (!suggestion) return null;
  const weight = (kg) => (kg > 0 ? `${formatKg(kg)} kg` : 'bodyweight');
  switch (suggestion.kind) {
    case 'increase':
      return `Suggestion: ${weight(suggestion.kg)}, aim for ${suggestion.reps} reps (you reached ${repMax} on every set)`;
    case 'hold':
      return `Suggestion: stay at ${weight(suggestion.kg)} or go lighter (under ${repMin} reps two sessions in a row)`;
    case 'add-load':
      return `Suggestion: add weight, or more reps (you reached ${repMax} on every set)`;
    default:
      return `Suggestion: ${weight(suggestion.kg)}, aim for one more rep`;
  }
}

// ----- Warm-up sets -----

export const DEFAULT_BAR_KG = 20;
export const WARMUP_STEP_KG = 2.5;
const RAMP = [
  { share: 0.4, reps: 5 },
  { share: 0.6, reps: 3 },
  { share: 0.8, reps: 2 },
];

/**
 * A standard ramp up to a working weight: the empty bar × 10, then about
 * 40 % × 5, 60 % × 3 and 80 % × 2, rounded to 2.5 kg. Steps that would not
 * be heavier than the one before, or not lighter than the working weight,
 * are left out. With a bar weight of 0 (dumbbells, machines) there is no
 * empty-bar set. Returns [{ kg, reps }], lightest first.
 */
export function warmupSets(workKg, barKg = DEFAULT_BAR_KG) {
  if (!(workKg > 0) || !(barKg >= 0)) return [];
  const sets = [];
  if (barKg > 0 && barKg < workKg) sets.push({ kg: barKg, reps: 10 });
  for (const { share, reps } of RAMP) {
    const kg = Math.round((workKg * share) / WARMUP_STEP_KG) * WARMUP_STEP_KG;
    const lightest = sets.length ? sets[sets.length - 1].kg : barKg;
    if (kg > lightest && kg < workKg) sets.push({ kg, reps });
  }
  return sets;
}

// ----- CSV export -----

export const CSV_COLUMNS = ['Date', 'Exercise', 'Set', 'Kg', 'Reps', 'Warm-up', 'Notes'];
export const CSV_SEPARATOR = ';';

// A cell is quoted when it contains the separator, a quote or a line break.
// Text starting with = + - or @ gets a leading apostrophe, so a spreadsheet
// shows it as text instead of running it as a formula.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Every ticked set of every finished workout, oldest first, as CSV text.
 * - Semicolons between cells and a comma as the decimal mark, which is what
 *   a spreadsheet set to Danish expects.
 * - Dates as DD-MM-YYYY. "Set" counts the rows of the exercise in that
 *   workout, warm-ups included. The workout's note repeats on each of its rows.
 * nameOf(exerciseId) gives the exercise's name.
 */
export function buildSetsCsv(workouts, nameOf) {
  const completed = workouts
    .filter((workout) => workout.status === 'completed')
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.startedAt || '') < (b.startedAt || '') ? -1 : 1));
  const lines = [CSV_COLUMNS.join(CSV_SEPARATOR)];
  for (const workout of completed) {
    for (const entry of workout.exercises || []) {
      let number = 0;
      for (const set of entry.sets || []) {
        if (!isDoneSet(set)) continue;
        number += 1;
        lines.push([
          formatDate(workout.date),
          csvCell(nameOf(entry.exerciseId)),
          number,
          formatKg(typeof set.kg === 'number' ? set.kg : 0).replace('.', ','),
          set.reps,
          set.warmup ? 'yes' : 'no',
          csvCell(workout.notes || ''),
        ].join(CSV_SEPARATOR));
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** 'workout-sets-16-11-2026.csv' */
export function csvFilename(dateStr) {
  return `workout-sets-${formatDate(dateStr)}.csv`;
}
