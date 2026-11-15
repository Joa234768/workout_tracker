import test from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestProgression, suggestionText, parseIncrement, warmupSets, buildSetsCsv, csvFilename,
} from '../js/logic/helpers.js';

const sets = (kg, ...reps) => reps.map((r) => ({ kg, reps: r }));
const range = { repMin: 8, repMax: 12 };
const suggest = (sessions, extra = {}) => suggestProgression({ sessions, ...range, ...extra });

test('progression: every set at the top of the range → add the increment, aim for the bottom', () => {
  assert.deepEqual(suggest([sets(40, 12, 12, 12)]), { kind: 'increase', kg: 42.5, reps: 8 });
  assert.deepEqual(suggest([sets(40, 13, 12, 15)]), { kind: 'increase', kg: 42.5, reps: 8 });
  assert.deepEqual(suggest([sets(40, 12, 12)], { increment: 1.25 }), { kind: 'increase', kg: 41.25, reps: 8 });
  assert.deepEqual(suggest([sets(12.5, 12)], { increment: 0.1 }), { kind: 'increase', kg: 12.6, reps: 8 }); // no 12.600000001
});

test('progression: otherwise the same weight and one more rep', () => {
  assert.deepEqual(suggest([sets(40, 12, 11, 10)]), { kind: 'more-reps', kg: 40 });
  assert.deepEqual(suggest([sets(40, 9, 8, 7)]), { kind: 'more-reps', kg: 40 }); // below the range once is not a pattern
  assert.deepEqual(suggest([sets(40, 9, 8, 7), sets(40, 10, 9, 8)]), { kind: 'more-reps', kg: 40 });
});

test('progression: below the range two sessions in a row → keep or reduce', () => {
  assert.deepEqual(suggest([sets(40, 8, 7, 6), sets(40, 8, 7, 7)]), { kind: 'hold', kg: 40 });
  assert.deepEqual(suggest([sets(40, 7), sets(42.5, 6), sets(40, 12)]), { kind: 'hold', kg: 40 });
});

test('progression: with mixed weights the heaviest sets are judged', () => {
  // The back-off set at 35 kg × 6 does not count against the 40 kg sets.
  assert.deepEqual(suggest([[...sets(40, 12, 12), ...sets(35, 6)]]), { kind: 'increase', kg: 42.5, reps: 8 });
  assert.deepEqual(suggest([[...sets(35, 12), ...sets(40, 10)]]), { kind: 'more-reps', kg: 40 });
});

test('progression: no last time, and bodyweight exercises', () => {
  assert.equal(suggest([]), null);
  assert.equal(suggest([[]]), null);
  assert.deepEqual(suggest([sets(0, 12, 12)]), { kind: 'add-load' });
  assert.deepEqual(suggest([sets(0, 10, 9)]), { kind: 'more-reps', kg: 0 });
  assert.deepEqual(suggest([[{ kg: null, reps: 5 }], sets(0, 6)]), { kind: 'hold', kg: 0 });
});

test('suggestionText', () => {
  assert.equal(suggestionText({ kind: 'increase', kg: 42.5, reps: 8 }, range), 'Suggestion: 42.5 kg, aim for 8 reps (you reached 12 on every set)');
  assert.equal(suggestionText({ kind: 'more-reps', kg: 40 }, range), 'Suggestion: 40 kg, aim for one more rep');
  assert.equal(suggestionText({ kind: 'more-reps', kg: 0 }, range), 'Suggestion: bodyweight, aim for one more rep');
  assert.equal(suggestionText({ kind: 'hold', kg: 40 }, range), 'Suggestion: stay at 40 kg or go lighter (under 8 reps two sessions in a row)');
  assert.equal(suggestionText({ kind: 'add-load' }, range), 'Suggestion: add weight, or more reps (you reached 12 on every set)');
  assert.equal(suggestionText(null, range), null);
});

test('parseIncrement', () => {
  assert.equal(parseIncrement('2,5'), 2.5);
  assert.equal(parseIncrement('1.25'), 1.25);
  assert.equal(parseIncrement('50'), 50);
  assert.equal(parseIncrement('0'), null);
  assert.equal(parseIncrement('51'), null);
  assert.equal(parseIncrement(''), null);
});

test('warm-up sets: bar × 10, then about 40 %, 60 %, 80 %, rounded to 2.5 kg', () => {
  assert.deepEqual(warmupSets(100), [{ kg: 20, reps: 10 }, { kg: 40, reps: 5 }, { kg: 60, reps: 3 }, { kg: 80, reps: 2 }]);
  assert.deepEqual(warmupSets(62.5), [{ kg: 20, reps: 10 }, { kg: 25, reps: 5 }, { kg: 37.5, reps: 3 }, { kg: 50, reps: 2 }]);
  assert.deepEqual(warmupSets(100, 15), [{ kg: 15, reps: 10 }, { kg: 40, reps: 5 }, { kg: 60, reps: 3 }, { kg: 80, reps: 2 }]);
});

test('warm-up sets: light weights lose the steps that make no sense', () => {
  // 40 % of 40 kg is below the bar, so it is left out.
  assert.deepEqual(warmupSets(40), [{ kg: 20, reps: 10 }, { kg: 25, reps: 3 }, { kg: 32.5, reps: 2 }]);
  assert.deepEqual(warmupSets(25), [{ kg: 20, reps: 10 }]);
  assert.deepEqual(warmupSets(20), []); // the working weight is the bar itself
  assert.deepEqual(warmupSets(10), []);
  assert.deepEqual(warmupSets(0), []);
  assert.deepEqual(warmupSets(null), []);
});

test('warm-up sets: without a bar (dumbbells, machines) there is no empty-bar set', () => {
  assert.deepEqual(warmupSets(30, 0), [{ kg: 12.5, reps: 5 }, { kg: 17.5, reps: 3 }, { kg: 25, reps: 2 }]);
  assert.deepEqual(warmupSets(5, 0), [{ kg: 2.5, reps: 5 }]);
  for (const work of [22.5, 47.5, 80, 132.5, 200]) {
    const ramp = warmupSets(work);
    assert.ok(ramp.every((s, i) => s.kg < work && (i === 0 || s.kg > ramp[i - 1].kg)), `ramp for ${work} must rise and stay below it`);
    assert.ok(ramp.every((s) => (s.kg * 10) % 25 === 0), `ramp for ${work} must be in 2.5 kg steps`);
  }
});

test('CSV: one row per ticked set of finished workouts, oldest first', () => {
  const set = (kg, reps, extra = {}) => ({ kg, reps, warmup: false, done: true, ...extra });
  const workouts = [
    {
      status: 'completed', date: '2026-11-16', startedAt: '2026-11-16T16:00:00Z', notes: 'Felt "strong"; slept well',
      exercises: [
        { exerciseId: 'bench', sets: [set(20, 10, { warmup: true }), set(42.5, 10), set(42.5, 8), set(45, null, { done: false })] },
        { exerciseId: 'pullups', sets: [set(0, 12)] },
      ],
    },
    { status: 'completed', date: '2026-11-09', startedAt: '2026-11-09T16:00:00Z', notes: '', exercises: [{ exerciseId: 'evil', sets: [set(1000, 1)] }] },
    { status: 'active', date: '2026-11-18', startedAt: '2026-11-18T16:00:00Z', notes: '', exercises: [{ exerciseId: 'bench', sets: [set(50, 5)] }] },
  ];
  const names = { bench: 'Bench Press', pullups: 'Pull-ups; strict', evil: '=HYPERLINK("x")' };
  const csv = buildSetsCsv(workouts, (id) => names[id]);
  assert.deepEqual(csv.split('\r\n'), [
    'Date;Exercise;Set;Kg;Reps;Warm-up;Notes',
    `09-11-2026;"'=HYPERLINK(""x"")";1;1000;1;no;`,
    '16-11-2026;Bench Press;1;20;10;yes;"Felt ""strong""; slept well"',
    '16-11-2026;Bench Press;2;42,5;10;no;"Felt ""strong""; slept well"',
    '16-11-2026;Bench Press;3;42,5;8;no;"Felt ""strong""; slept well"',
    '16-11-2026;"Pull-ups; strict";1;0;12;no;"Felt ""strong""; slept well"',
    '',
  ]);
  assert.equal(buildSetsCsv([], () => ''), 'Date;Exercise;Set;Kg;Reps;Warm-up;Notes\r\n');
  assert.ok(buildSetsCsv([{ status: 'completed', date: '2026-11-16', notes: 'two\nlines', exercises: [{ exerciseId: 'bench', sets: [set(1, 1)] }] }], () => 'x').includes('"two\nlines"'));
  assert.equal(csvFilename('2026-11-16'), 'workout-sets-16-11-2026.csv');
});
