import test from 'node:test';
import assert from 'node:assert/strict';
import {
  e1rm, exerciseSeries, isBodyweightSeries, metricsFor, rangeStart, inRange,
  weeklyTraining, trainingSummary, movingAverage, parseBodyKg, formatOneDecimal, loggedExercises,
} from '../js/logic/stats.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('e1rm: Epley, only for 1–12 reps with a weight', () => {
  close(e1rm(100, 10), 100 * (1 + 10 / 30));
  close(e1rm(60, 12), 84);
  assert.equal(e1rm(100, 1), 100); // a single rep is what it is
  assert.equal(e1rm(100, 13), null);
  assert.equal(e1rm(0, 10), null);
  assert.equal(e1rm(100, 0), null);
  assert.equal(e1rm(null, 5), null);
});

test('exerciseSeries: one point per session, oldest first', () => {
  const history = [ // newest first, as exerciseHistory() returns it
    { workoutId: 'b', date: '2026-11-10', sets: [{ kg: 50, reps: 15 }, { kg: 60, reps: 6 }, { kg: 60, reps: 8 }] },
    { workoutId: 'a', date: '2026-11-03', sets: [{ kg: 40, reps: 10 }, { kg: 45, reps: 20 }] },
  ];
  const [a, b] = exerciseSeries(history);
  assert.equal(a.workoutId, 'a');
  close(a.e1rm, 40 * (1 + 10 / 30)); // the set of 20 reps is not used for the estimate
  assert.deepEqual([a.top, a.topReps, a.volume, a.reps, a.bestReps], [45, 20, 1300, 30, 20]);
  close(b.e1rm, 60 * (1 + 8 / 30));
  assert.deepEqual([b.date, b.top, b.topReps, b.volume, b.reps], ['2026-11-10', 60, 8, 750 + 360 + 480, 29]);
  assert.equal(exerciseSeries([{ workoutId: 'c', date: '2026-11-01', sets: [{ kg: 30, reps: 20 }] }])[0].e1rm, null);
  assert.deepEqual(exerciseSeries([]), []);
});

test('bodyweight exercises chart reps instead', () => {
  const pullups = exerciseSeries([{ workoutId: 'a', date: '2026-11-03', sets: [{ kg: 0, reps: 12 }, { kg: null, reps: 9 }] }]);
  assert.equal(isBodyweightSeries(pullups), true);
  assert.deepEqual([pullups[0].bestReps, pullups[0].reps, pullups[0].volume, pullups[0].e1rm], [12, 21, 0, null]);
  assert.deepEqual(metricsFor(pullups).map((m) => m.id), ['bestReps', 'reps']);
  const weighted = exerciseSeries([
    { workoutId: 'b', date: '2026-11-10', sets: [{ kg: 5, reps: 8 }] },
    { workoutId: 'a', date: '2026-11-03', sets: [{ kg: 0, reps: 12 }] },
  ]);
  assert.equal(isBodyweightSeries(weighted), false);
  assert.deepEqual(metricsFor(weighted).map((m) => m.id), ['e1rm', 'top', 'volume']);
  assert.equal(isBodyweightSeries([]), false);
});

test('time ranges', () => {
  assert.equal(rangeStart('1m', '2026-11-15'), '2026-10-16');
  assert.equal(rangeStart('3m', '2026-11-15'), '2026-08-16');
  assert.equal(rangeStart('1y', '2026-11-15'), '2025-11-15');
  assert.equal(rangeStart('all', '2026-11-15'), null);
  assert.equal(rangeStart('nonsense', '2026-11-15'), null);
  const items = [{ date: '2026-10-15' }, { date: '2026-10-16' }, { date: '2026-11-15' }];
  assert.deepEqual(inRange(items, '1m', '2026-11-15').map((i) => i.date), ['2026-10-16', '2026-11-15']);
  assert.equal(inRange(items, 'all', '2026-11-15').length, 3);
});

test('weeklyTraining: done, planned and planned-and-done per week', () => {
  const done = (id, date, plannedRef = null) => ({ id, status: 'completed', date, plannedRef });
  const data = {
    // Monday and Thursday from Monday 2 November 2026.
    rules: [{ id: 'r', startDate: '2026-11-02', endDate: null, type: 'weekly', days: { 1: 'A', 4: 'B' } }],
    exceptions: [{ id: 'x', originalDate: '2026-11-12', cancelled: true, movedTo: null, routineId: null }],
    oneOffs: [{ id: 'o', date: '2026-11-07', routineId: null, cancelled: false }],
    workouts: [
      done('w0', '2026-10-28'),                    // before the plan, unplanned
      done('w1', '2026-11-02', 'rule:2026-11-02'), // Monday, as planned
      done('w2', '2026-11-06', 'rule:2026-11-05'), // Thursday's workout done on Friday
      done('w3', '2026-11-09'),                    // on a planned Monday, without a link
      { id: 'w4', status: 'active', date: '2026-11-15', plannedRef: null },
    ],
  };
  const weeks = weeklyTraining(null, '2026-11-15', data);
  assert.deepEqual(weeks, [
    { week: '2026-10-26', done: 1, planned: 0, due: 0, plannedDone: 0 },
    { week: '2026-11-02', done: 2, planned: 3, due: 3, plannedDone: 2 }, // the one-off on Saturday was missed
    { week: '2026-11-09', done: 1, planned: 1, due: 1, plannedDone: 1 }, // Thursday was cancelled
  ]);
  assert.deepEqual(trainingSummary(weeks), { weeks: 3, done: 4, perWeek: 4 / 3, due: 4, plannedDone: 3 });
  // Seen on Wednesday 4 November: Thursday and Saturday are still ahead, so they are not due.
  const midWeek = weeklyTraining('2026-11-02', '2026-11-04', { ...data, workouts: data.workouts.slice(0, 2) });
  assert.deepEqual(midWeek, [{ week: '2026-11-02', done: 1, planned: 3, due: 1, plannedDone: 1 }]);
  assert.deepEqual(weeklyTraining('2026-11-10', '2026-11-15', data).map((w) => w.week), ['2026-11-09']);
  assert.deepEqual(weeklyTraining(null, '2026-11-15', {}), []);
  assert.deepEqual(trainingSummary([]), { weeks: 0, done: 0, perWeek: 0, due: 0, plannedDone: 0 });
  // An empty range still lists its weeks, so gaps show as zero.
  assert.deepEqual(weeklyTraining('2026-10-12', '2026-10-25', data).map((w) => [w.week, w.done]), [['2026-10-12', 0], ['2026-10-19', 0]]);
});

test('movingAverage: the mean of the entries in the 7 days ending on each date', () => {
  const entries = [
    { date: '2026-11-03', kg: 80 },
    { date: '2026-11-01', kg: 82 },
    { date: '2026-11-07', kg: 79 },
    { date: '2026-11-08', kg: 78 }, // 1 November has dropped out of the window
    { date: '2026-11-20', kg: 77 }, // alone in its window
  ];
  const trend = movingAverage(entries);
  assert.deepEqual(trend.map((t) => t.date), ['2026-11-01', '2026-11-03', '2026-11-07', '2026-11-08', '2026-11-20']);
  close(trend[0].kg, 82);
  close(trend[1].kg, 81);
  close(trend[2].kg, (82 + 80 + 79) / 3);
  close(trend[3].kg, (80 + 79 + 78) / 3);
  close(trend[4].kg, 77);
  assert.deepEqual(movingAverage([]), []);
});

test('parseBodyKg and formatOneDecimal', () => {
  assert.equal(parseBodyKg('78,4'), 78.4);
  assert.equal(parseBodyKg('78.45'), 78.45);
  assert.equal(parseBodyKg('80'), 80);
  assert.equal(parseBodyKg('19'), null);
  assert.equal(parseBodyKg('401'), null);
  assert.equal(parseBodyKg(''), null);
  assert.equal(parseBodyKg('abc'), null);
  assert.equal(formatOneDecimal(78.44), '78.4');
  assert.equal(formatOneDecimal(80), '80');
  assert.equal(formatOneDecimal(83.333333), '83.3');
});

test('loggedExercises: most recently used first, counting sessions with a working set', () => {
  const set = (extra = {}) => ({ kg: 40, reps: 10, warmup: false, done: true, ...extra });
  const workouts = [
    { status: 'completed', date: '2026-11-03', exercises: [{ exerciseId: 'Bench', sets: [set()] }, { exerciseId: 'Row', sets: [set({ warmup: true })] }] },
    { status: 'completed', date: '2026-11-10', exercises: [{ exerciseId: 'Squat', sets: [set()] }, { exerciseId: 'Squat', sets: [set()] }] },
    { status: 'completed', date: '2026-11-08', exercises: [{ exerciseId: 'Bench', sets: [set(), set()] }] },
    { status: 'active', date: '2026-11-15', exercises: [{ exerciseId: 'Curl', sets: [set()] }] },
  ];
  assert.deepEqual(loggedExercises(workouts), [
    { exerciseId: 'Squat', sessions: 1, lastDate: '2026-11-10' },
    { exerciseId: 'Bench', sessions: 2, lastDate: '2026-11-08' },
  ]);
  assert.deepEqual(loggedExercises([]), []);
});
