import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkout, createSet, createEntry, deriveExerciseIds, setLabels, placeholdersFor,
  tickSet, copyFromAbove, moveItem, untickedCount, pruneWorkout, completeWorkout,
  workoutStats, lastSessionBefore, compareSessions,
} from '../js/logic/workout.js';
import {
  parseKg, parseReps, formatSetCompact, formatWhole, setVolume,
} from '../js/logic/sets.js';
import { formatShortDate, weekdayName } from '../js/logic/dates.js';

const NOW = '2026-11-20T16:00:00.000Z';
const done = (kg, reps, extra = {}) => ({ id: 's', kg, reps, warmup: false, done: true, doneAt: NOW, ...extra });
const open = (kg = null, reps = null, extra = {}) => ({ id: 's', kg, reps, warmup: false, done: false, doneAt: null, ...extra });

test('createWorkout / createEntry / createSet give the documented shape', () => {
  const workout = createWorkout({ id: 'w', date: '2026-11-20', now: NOW });
  assert.deepEqual(workout, {
    id: 'w', status: 'active', date: '2026-11-20', startedAt: NOW, finishedAt: null,
    durationMin: null, notes: '', routineId: null, routineName: null, plannedRef: null,
    exerciseIds: [], exercises: [], createdAt: NOW, updatedAt: NOW,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(workout)), workout); // JSON-safe
  const entry = createEntry({ id: 'e', exerciseId: 'Bench', setIds: ['a', 'b'] });
  assert.deepEqual(entry, {
    id: 'e', exerciseId: 'Bench', repMin: 8, repMax: 12,
    sets: [
      { id: 'a', kg: null, reps: null, warmup: false, done: false, doneAt: null },
      { id: 'b', kg: null, reps: null, warmup: false, done: false, doneAt: null },
    ],
  });
  assert.deepEqual(createSet('x'), entry.sets[0].id === 'a' ? { ...entry.sets[0], id: 'x' } : null);
});

test('deriveExerciseIds: unique, in order', () => {
  assert.deepEqual(deriveExerciseIds({ exercises: [{ exerciseId: 'A' }, { exerciseId: 'B' }, { exerciseId: 'A' }] }), ['A', 'B']);
  assert.deepEqual(deriveExerciseIds({ exercises: [] }), []);
});

test('setLabels: warm-ups are W, the rest count from 1', () => {
  assert.deepEqual(setLabels([open(null, null, { warmup: true }), open(), open(null, null, { warmup: true }), open()]), ['W', '1', 'W', '2']);
});

test('placeholdersFor: matched by working-set position; warm-ups get none', () => {
  const last = [{ kg: 40, reps: 10 }, { kg: 40, reps: 8 }];
  assert.deepEqual(placeholdersFor([open(), open(), open()], last), [last[0], last[1], null]);
  assert.deepEqual(placeholdersFor([open(null, null, { warmup: true }), open(), open()], last), [null, last[0], last[1]]);
  assert.deepEqual(placeholdersFor([open(), open()], []), [null, null]);
  assert.deepEqual(placeholdersFor([open()]), [null]);
});

test('tickSet: an empty row accepts last time\'s values', () => {
  const { set, result } = tickSet(open(), { kg: 42.5, reps: 10 }, NOW);
  assert.equal(result, 'done');
  assert.deepEqual([set.kg, set.reps, set.done, set.doneAt], [42.5, 10, true, NOW]);
});

test('tickSet: typed values win; missing ones come from last time', () => {
  assert.deepEqual(tickSet(open(45, 9), { kg: 42.5, reps: 10 }, NOW).set, { ...open(45, 9), done: true, doneAt: NOW });
  const mixed = tickSet(open(45, null), { kg: 42.5, reps: 10 }, NOW).set;
  assert.deepEqual([mixed.kg, mixed.reps], [45, 10]);
  const mixed2 = tickSet(open(null, 7), { kg: 42.5, reps: 10 }, NOW).set;
  assert.deepEqual([mixed2.kg, mixed2.reps], [42.5, 7]);
});

test('tickSet: an empty row with no last time asks for the weight, and saves nothing', () => {
  const row = open();
  const { set, result } = tickSet(row, null, NOW);
  assert.equal(result, 'need-kg');
  assert.equal(set, row);
  assert.equal(set.done, false);
});

test('tickSet: weight without reps asks for reps; zero reps is not a set', () => {
  assert.equal(tickSet(open(40, null), null, NOW).result, 'need-reps');
  assert.equal(tickSet(open(40, 0), null, NOW).result, 'need-reps');
  assert.equal(tickSet(open(40, 0), { kg: 40, reps: 10 }, NOW).result, 'need-reps'); // a typed 0 is not replaced
});

test('tickSet: reps without weight and no last time is a bodyweight set', () => {
  const { set, result } = tickSet(open(null, 12), null, NOW);
  assert.equal(result, 'done');
  assert.deepEqual([set.kg, set.reps], [0, 12]);
});

test('tickSet: ticking a done row unticks it and keeps the values', () => {
  const { set, result } = tickSet(done(40, 8), { kg: 1, reps: 1 }, NOW);
  assert.equal(result, 'undone');
  assert.deepEqual([set.kg, set.reps, set.done, set.doneAt], [40, 8, false, null]);
});

test('tickSet does not modify its input', () => {
  const row = open();
  tickSet(row, { kg: 40, reps: 10 }, NOW);
  assert.deepEqual(row, open());
});

test('copyFromAbove copies weight and reps only', () => {
  const sets = [done(40, 10, { id: 'a' }), open(null, null, { id: 'b', warmup: true })];
  const copied = copyFromAbove(sets, 1);
  assert.deepEqual(copied[1], { id: 'b', kg: 40, reps: 10, warmup: true, done: false, doneAt: null });
  assert.equal(copied[0], sets[0]);
  assert.equal(copyFromAbove(sets, 0), sets); // nothing above the first row
  assert.equal(copyFromAbove(sets, 5), sets);
});

test('moveItem', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  const list = ['a', 'b'];
  assert.equal(moveItem(list, 0, -1), list);
  assert.equal(moveItem(list, 1, 1), list);
});

const workout = () => ({
  ...createWorkout({ id: 'w', date: '2026-11-20', now: NOW }),
  exercises: [
    { id: 'e1', exerciseId: 'Bench', repMin: 8, repMax: 12, sets: [done(20, 10, { warmup: true }), done(42.5, 10), done(42.5, 8), open(42.5, null)] },
    { id: 'e2', exerciseId: 'Pullups', repMin: 8, repMax: 12, sets: [done(0, 12), open()] },
    { id: 'e3', exerciseId: 'Squat', repMin: 8, repMax: 12, sets: [open(), open(60, 8)] },
  ],
});

test('untickedCount / pruneWorkout: unticked rows and emptied exercises go', () => {
  assert.equal(untickedCount(workout()), 4);
  const pruned = pruneWorkout(workout());
  assert.deepEqual(pruned.exercises.map((e) => [e.exerciseId, e.sets.length]), [['Bench', 3], ['Pullups', 1]]);
  assert.deepEqual(pruned.exerciseIds, ['Bench', 'Pullups']);
  assert.equal(untickedCount(pruned), 0);
});

test('completeWorkout: completed and pruned; null when nothing is ticked', () => {
  const original = workout();
  const finished = completeWorkout(original, '2026-11-20T17:00:00.000Z');
  assert.equal(finished.status, 'completed');
  assert.equal(finished.finishedAt, '2026-11-20T17:00:00.000Z');
  assert.equal(finished.exercises.length, 2);
  assert.equal(original.status, 'active'); // input untouched
  assert.equal(original.exercises.length, 3);

  const nothing = { ...workout(), exercises: [{ id: 'e', exerciseId: 'Squat', sets: [open(), open(60, 8)] }] };
  assert.equal(completeWorkout(nothing, NOW), null);
  assert.equal(completeWorkout({ ...workout(), exercises: [] }, NOW), null);

  // Editing a completed workout later keeps when it was really finished.
  const again = completeWorkout({ ...finished, exercises: finished.exercises }, '2027-01-01T00:00:00.000Z');
  assert.equal(again.finishedAt, '2026-11-20T17:00:00.000Z');
});

test('workoutStats counts working sets; warm-ups and unticked rows are left out', () => {
  assert.deepEqual(workoutStats(workout()), { exercises: 2, sets: 3, warmups: 1, reps: 30, volume: 42.5 * 10 + 42.5 * 8 });
  assert.deepEqual(workoutStats({ exercises: [] }), { exercises: 0, sets: 0, warmups: 0, reps: 0, volume: 0 });
});

const past = [
  { id: 'p1', status: 'completed', date: '2026-11-10', startedAt: '2026-11-10T16:00:00.000Z', exercises: [{ exerciseId: 'Bench', sets: [done(40, 10)] }] },
  { id: 'p2', status: 'completed', date: '2026-11-16', startedAt: '2026-11-16T16:00:00.000Z', exercises: [{ exerciseId: 'Bench', sets: [done(20, 5, { warmup: true }), done(42.5, 10), done(42.5, 8)] }] },
  { id: 'p3', status: 'completed', date: '2026-11-20', startedAt: '2026-11-20T07:00:00.000Z', exercises: [{ exerciseId: 'Bench', sets: [done(45, 6)] }] },
  { id: 'p4', status: 'completed', date: '2026-11-25', startedAt: '2026-11-25T16:00:00.000Z', exercises: [{ exerciseId: 'Bench', sets: [done(50, 5)] }] },
  { id: 'a1', status: 'active', date: '2026-11-19', startedAt: '2026-11-19T16:00:00.000Z', exercises: [{ exerciseId: 'Bench', sets: [done(99, 1)] }] },
];

test('lastSessionBefore: the latest completed session before this workout', () => {
  const current = { id: 'w', date: '2026-11-20', startedAt: '2026-11-20T16:00:00.000Z' };
  assert.deepEqual(lastSessionBefore(past, 'Bench', current), { workoutId: 'p3', date: '2026-11-20', sets: [{ kg: 45, reps: 6 }] });
  // Seen from an older workout, later ones don't count.
  assert.deepEqual(lastSessionBefore(past, 'Bench', past[1]), { workoutId: 'p1', date: '2026-11-10', sets: [{ kg: 40, reps: 10 }] });
  assert.equal(lastSessionBefore(past, 'Bench', past[0]), null);
  assert.equal(lastSessionBefore(past, 'Squat', current), null);
  // The workout itself is never its own "last time".
  assert.equal(lastSessionBefore([past[0]], 'Bench', past[0]), null);
});

test('compareSessions', () => {
  assert.deepEqual(compareSessions([{ kg: 40, reps: 10 }], []), { kind: 'first', now: null, last: null, delta: null });
  assert.deepEqual(compareSessions([{ kg: 40, reps: 10 }], null).kind, 'first');
  assert.deepEqual(
    compareSessions([{ kg: 42.5, reps: 10 }, { kg: 45, reps: 8 }], [{ kg: 42.5, reps: 10 }, { kg: 42.5, reps: 8 }]),
    { kind: 'volume', now: 785, last: 765, delta: 20 }
  );
  assert.deepEqual(compareSessions([{ kg: 0, reps: 12 }, { kg: 0, reps: 9 }], [{ kg: 0, reps: 10 }, { kg: 0, reps: 8 }]),
    { kind: 'reps', now: 21, last: 18, delta: 3 });
  // Weighted now, bodyweight last time: reps are the only fair comparison.
  assert.equal(compareSessions([{ kg: 5, reps: 8 }], [{ kg: 0, reps: 10 }]).kind, 'reps');
});

test('parseKg accepts comma and dot', () => {
  assert.equal(parseKg('12,5'), 12.5);
  assert.equal(parseKg('12.5'), 12.5);
  assert.equal(parseKg(' 40 '), 40);
  assert.equal(parseKg('0'), 0);
  assert.equal(parseKg('2,25'), 2.25);
  assert.equal(parseKg('12,'), 12);
  assert.equal(parseKg(',5'), 0.5);
  assert.equal(parseKg('1000'), 1000);
  for (const bad of ['', '  ', 'abc', '-5', '1,2,3', '12.5.1', '1e3', '12 5', '99999', null, undefined, '.']) {
    assert.equal(parseKg(bad), null, `parseKg(${JSON.stringify(bad)})`);
  }
});

test('parseReps accepts whole numbers only', () => {
  assert.equal(parseReps('10'), 10);
  assert.equal(parseReps(' 8 '), 8);
  assert.equal(parseReps('0'), 0);
  for (const bad of ['', '8,5', '8.5', '-1', 'ten', '1000', null]) assert.equal(parseReps(bad), null);
});

test('set formatting', () => {
  assert.equal(formatSetCompact({ kg: 42.5, reps: 10 }), '42.5×10');
  assert.equal(formatSetCompact({ kg: 10, reps: 10 }), '10×10');
  assert.equal(formatSetCompact({ kg: 0, reps: 12 }), 'BW×12');
  assert.equal(setVolume({ kg: 42.5, reps: 10 }), 425);
  assert.equal(setVolume({ kg: null, reps: 10 }), 0);
  assert.equal(formatWhole(3240.4), '3 240');
  assert.equal(formatWhole(950), '950');
  assert.equal(formatWhole(1234567), '1 234 567');
});

test('short dates and weekday names', () => {
  assert.equal(formatShortDate('2026-11-12'), '12 Nov');
  assert.equal(formatShortDate('2026-01-05', '2026-11-20'), '5 Jan');
  assert.equal(formatShortDate('2025-12-30', '2026-01-02'), '30 Dec 2025');
  assert.throws(() => formatShortDate('12-11-2026'));
  assert.equal(weekdayName('2026-11-16'), 'Monday');
  assert.equal(weekdayName('2026-11-22'), 'Sunday');
});
