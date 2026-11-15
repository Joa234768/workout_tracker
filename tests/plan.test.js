import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleForDate, ruleRoutineOn, occurrencesInRange, calendarDays, nextPlanned,
  planChange, validatePlan, applyExceptionChange, routineUsage,
} from '../js/logic/plan.js';
import {
  createRoutine, createRoutineExercise, cleanRoutineName, cleanRoutineExercise,
  duplicateRoutine, entriesFromRoutine, routineSummary,
} from '../js/logic/routines.js';
import { addDays, addMonths, monthStart, monthLabel, monthGrid, weekdayShort, isoWeekday } from '../js/logic/dates.js';

// 2026-11-16 is a Monday.
const weekly = { id: 'r1', startDate: '2026-11-16', endDate: '2026-12-31', type: 'weekly', days: { 1: 'A', 3: 'B', 5: 'C' } };
const rotation = { id: 'r2', startDate: '2027-01-01', endDate: null, type: 'rotation', weekdays: [1, 3, 5], routineIds: ['A', 'B', 'C'], offset: 0 };
const rules = [weekly, rotation];

test('ruleForDate picks the version covering the date', () => {
  assert.equal(ruleForDate(rules, '2026-11-15'), null); // before any plan
  assert.equal(ruleForDate(rules, '2026-11-16').id, 'r1');
  assert.equal(ruleForDate(rules, '2026-12-31').id, 'r1'); // endDate is inclusive
  assert.equal(ruleForDate(rules, '2027-01-01').id, 'r2');
  assert.equal(ruleForDate(rules, '2040-06-01').id, 'r2'); // open-ended
});

test('weekly rule: a routine per weekday', () => {
  assert.equal(ruleRoutineOn(weekly, '2026-11-16'), 'A'); // Monday
  assert.equal(ruleRoutineOn(weekly, '2026-11-17'), undefined);
  assert.equal(ruleRoutineOn(weekly, '2026-11-18'), 'B');
  assert.equal(ruleRoutineOn(weekly, '2026-11-20'), 'C');
  assert.equal(ruleRoutineOn(weekly, '2026-11-22'), undefined); // Sunday
  assert.equal(ruleRoutineOn(null, '2026-11-16'), undefined);
  // Keys arrive as strings after a backup round trip.
  const fromJson = JSON.parse(JSON.stringify(weekly));
  assert.equal(ruleRoutineOn(fromJson, '2026-11-18'), 'B');
});

test('rotation: A/B/C over the training days, counted from the start date', () => {
  // 2027-01-01 is a Friday.
  assert.equal(isoWeekday('2027-01-01'), 5);
  const sequence = [];
  for (let d = '2027-01-01'; d <= '2027-01-15'; d = addDays(d, 1)) {
    const routine = ruleRoutineOn(rotation, d);
    if (routine) sequence.push(`${d.slice(8)}:${routine}`);
  }
  assert.deepEqual(sequence, ['01:A', '04:B', '06:C', '08:A', '11:B', '13:C', '15:A']);
  assert.equal(ruleRoutineOn(rotation, '2027-01-02'), undefined); // Saturday is not a training day
});

test('rotation is plain arithmetic: far-away dates agree with counting day by day', () => {
  const rule = { type: 'rotation', startDate: '2026-11-17', endDate: null, weekdays: [2, 4, 6, 7], routineIds: ['A', 'B', 'C'], offset: 1 };
  let slot = 0;
  for (let d = rule.startDate; d <= '2030-03-01'; d = addDays(d, 1)) {
    if (!rule.weekdays.includes(isoWeekday(d))) {
      assert.equal(ruleRoutineOn(rule, d), undefined);
      continue;
    }
    assert.equal(ruleRoutineOn(rule, d), rule.routineIds[(slot + 1) % 3], d);
    slot += 1;
  }
  assert.ok(slot > 600);
});

test('rotation with more training days than routines, and a single routine', () => {
  const two = { type: 'rotation', startDate: '2026-11-16', endDate: null, weekdays: [1, 2, 3], routineIds: ['A', 'B'], offset: 0 };
  assert.deepEqual(['16', '17', '18', '23', '24'].map((d) => ruleRoutineOn(two, `2026-11-${d}`)), ['A', 'B', 'A', 'B', 'A']);
  const one = { ...two, routineIds: ['A'] };
  assert.equal(ruleRoutineOn(one, '2026-11-18'), 'A');
});

test('occurrencesInRange: rule occurrences in date order', () => {
  const list = occurrencesInRange('2026-11-16', '2026-11-22', { rules });
  assert.deepEqual(list.map((o) => [o.ref, o.date, o.routineId, o.cancelled, o.moved]), [
    ['rule:2026-11-16', '2026-11-16', 'A', false, false],
    ['rule:2026-11-18', '2026-11-18', 'B', false, false],
    ['rule:2026-11-20', '2026-11-20', 'C', false, false],
  ]);
  assert.deepEqual(occurrencesInRange('2026-11-09', '2026-11-15', { rules }), []); // before the plan started
});

test('exceptions: cancel, change routine, move within and across the range', () => {
  const exceptions = [
    { id: 'e1', originalDate: '2026-11-16', cancelled: true, movedTo: null, routineId: null },
    { id: 'e2', originalDate: '2026-11-18', cancelled: false, movedTo: '2026-11-19', routineId: null },
    { id: 'e3', originalDate: '2026-11-20', cancelled: false, movedTo: null, routineId: 'X' },
    { id: 'e4', originalDate: '2026-11-23', cancelled: false, movedTo: '2026-11-22', routineId: null }, // into this week
    { id: 'e5', originalDate: '2026-11-17', cancelled: true, movedTo: null, routineId: null }, // no workout that day: ignored
  ];
  const week = occurrencesInRange('2026-11-16', '2026-11-22', { rules, exceptions });
  assert.deepEqual(week.map((o) => [o.ref, o.date, o.routineId, o.cancelled, o.moved]), [
    ['rule:2026-11-16', '2026-11-16', 'A', true, false],
    ['rule:2026-11-18', '2026-11-19', 'B', false, true],
    ['rule:2026-11-20', '2026-11-20', 'X', false, false],
    ['rule:2026-11-23', '2026-11-22', 'A', false, true],
  ]);
  // The following week no longer has the workout that moved out of it.
  const next = occurrencesInRange('2026-11-23', '2026-11-29', { rules, exceptions });
  assert.deepEqual(next.map((o) => o.ref), ['rule:2026-11-25', 'rule:2026-11-27']);
});

test('one-off planned workouts', () => {
  const oneOffs = [
    { id: 'o1', date: '2026-11-21', routineId: null, cancelled: false },
    { id: 'o2', date: '2026-11-10', routineId: 'A', cancelled: false }, // before any rule: still planned
    { id: 'o3', date: '2026-12-25', routineId: 'B', cancelled: true },
  ];
  const list = occurrencesInRange('2026-11-09', '2026-11-22', { rules, oneOffs });
  assert.deepEqual(list.map((o) => [o.ref, o.kind, o.date, o.routineId]), [
    ['oneoff:o2', 'oneoff', '2026-11-10', 'A'],
    ['rule:2026-11-16', 'rule', '2026-11-16', 'A'],
    ['rule:2026-11-18', 'rule', '2026-11-18', 'B'],
    ['rule:2026-11-20', 'rule', '2026-11-20', 'C'],
    ['oneoff:o1', 'oneoff', '2026-11-21', null],
  ]);
  assert.equal(list.at(-1).oneOffId, 'o1');
  assert.equal(occurrencesInRange('2026-12-25', '2026-12-25', { rules, oneOffs }).find((o) => o.kind === 'oneoff').cancelled, true);
});

const workout = (id, date, extra = {}) => ({ id, status: 'completed', date, plannedRef: null, ...extra });
const states = (days) => Object.fromEntries(Object.entries(days).map(([date, entries]) => [date, entries.map((e) => e.state)]));

test('calendarDays: planned, missed, cancelled, completed', () => {
  const data = {
    rules,
    exceptions: [{ id: 'e1', originalDate: '2026-11-20', cancelled: true, movedTo: null, routineId: null }],
    workouts: [
      workout('w1', '2026-11-16', { plannedRef: 'rule:2026-11-16' }), // planned and done
      workout('w2', '2026-11-21'), // unplanned
    ],
    today: '2026-11-24',
  };
  assert.deepEqual(states(calendarDays('2026-11-16', '2026-11-29', data)), {
    '2026-11-16': ['completed'],
    '2026-11-18': ['missed'],
    '2026-11-20': ['cancelled'],
    '2026-11-21': ['completed'],
    '2026-11-23': ['missed'],
    '2026-11-25': ['planned'],
    '2026-11-27': ['planned'],
  });
});

test('calendarDays: today is still "planned", not "missed"', () => {
  const days = calendarDays('2026-11-16', '2026-11-18', { rules, workouts: [], today: '2026-11-18' });
  assert.deepEqual(states(days), { '2026-11-16': ['missed'], '2026-11-18': ['planned'] });
});

test('calendarDays: any completed workout on the day counts as doing the plan', () => {
  const days = calendarDays('2026-11-16', '2026-11-18', {
    rules,
    workouts: [workout('w1', '2026-11-16')], // no plannedRef
    today: '2026-11-30',
  });
  assert.deepEqual(states(days), { '2026-11-16': ['completed'], '2026-11-18': ['missed'] });
});

test('calendarDays: a planned workout done on another day is not missed', () => {
  // Monday's workout was started on Tuesday.
  const days = calendarDays('2026-11-16', '2026-11-18', {
    rules,
    workouts: [workout('w1', '2026-11-17', { plannedRef: 'rule:2026-11-16' })],
    today: '2026-11-30',
  });
  assert.deepEqual(states(days), { '2026-11-17': ['completed'], '2026-11-18': ['missed'] });
});

test('calendarDays: a workout in progress does not complete the plan yet', () => {
  const days = calendarDays('2026-11-16', '2026-11-16', {
    rules,
    workouts: [workout('w1', '2026-11-16', { status: 'active', plannedRef: 'rule:2026-11-16' })],
    today: '2026-11-16',
  });
  assert.deepEqual(states(days), { '2026-11-16': ['active', 'planned'] });
});

test('calendarDays: nothing is missed before the plan started, or without a plan', () => {
  assert.deepEqual(calendarDays('2026-10-01', '2026-11-15', { rules, workouts: [], today: '2027-01-01' }), {});
  assert.deepEqual(calendarDays('2026-11-01', '2026-11-30', { workouts: [workout('w', '2026-11-05')], today: '2026-11-30' })['2026-11-05'].length, 1);
});

test('calendarDays works years ahead', () => {
  const days = calendarDays('2031-03-01', '2031-03-31', { rules, workouts: [], today: '2026-11-16' });
  const planned = Object.values(days).flat();
  assert.equal(planned.length, 13); // Mondays, Wednesdays and Fridays of March 2031
  assert.ok(planned.every((e) => e.state === 'planned'));
});

test('nextPlanned skips cancelled and done occurrences', () => {
  const data = {
    rules,
    exceptions: [{ id: 'e', originalDate: '2026-11-18', cancelled: true, movedTo: null, routineId: null }],
    workouts: [],
  };
  assert.equal(nextPlanned('2026-11-16', data).ref, 'rule:2026-11-20'); // today (16th) itself is not "next"
  assert.equal(nextPlanned('2026-11-10', data).ref, 'rule:2026-11-16');
  assert.equal(nextPlanned('2026-11-16', { rules: [], workouts: [] }), null);
});

test('planChange: a new plan from a date; earlier days keep the old one', () => {
  const current = [
    { id: 'old', startDate: '2026-01-01', endDate: '2026-06-30', type: 'weekly', days: { 1: 'A' } },
    { id: 'now', startDate: '2026-07-01', endDate: null, type: 'weekly', days: { 2: 'B' } },
  ];
  const { put, remove } = planChange(current, { id: 'new', type: 'weekly', days: { 3: 'C' } }, '2026-11-16');
  assert.deepEqual(remove, []);
  assert.deepEqual(put, [
    { id: 'now', startDate: '2026-07-01', endDate: '2026-11-15', type: 'weekly', days: { 2: 'B' } },
    { id: 'new', type: 'weekly', days: { 3: 'C' }, startDate: '2026-11-16', endDate: null },
  ]);
  // After the change, ranges still do not overlap and history is intact.
  const after = [current[0], ...put];
  assert.equal(ruleForDate(after, '2026-03-02').id, 'old');
  assert.equal(ruleForDate(after, '2026-11-15').id, 'now');
  assert.equal(ruleForDate(after, '2026-11-16').id, 'new');
});

test('planChange: changing again the same day replaces, and null stops planning', () => {
  const current = [
    { id: 'now', startDate: '2026-07-01', endDate: '2026-11-15', type: 'weekly', days: { 2: 'B' } },
    { id: 'new', startDate: '2026-11-16', endDate: null, type: 'weekly', days: { 3: 'C' } },
  ];
  const again = planChange(current, { id: 'newer', type: 'weekly', days: { 4: 'D' } }, '2026-11-16');
  assert.deepEqual(again.remove, ['new']);
  assert.deepEqual(again.put, [{ id: 'newer', type: 'weekly', days: { 4: 'D' }, startDate: '2026-11-16', endDate: null }]);

  const stop = planChange(current, null, '2026-12-01');
  assert.deepEqual(stop.remove, []);
  assert.deepEqual(stop.put, [{ ...current[1], endDate: '2026-11-30' }]);
});

test('validatePlan', () => {
  const known = ['A', 'B'];
  assert.deepEqual(validatePlan({ type: 'weekly', days: { 1: 'A', 3: '', 5: 'B' } }, known), { ok: true, rule: { type: 'weekly', days: { 1: 'A', 5: 'B' } } });
  assert.equal(validatePlan({ type: 'weekly', days: {} }, known).error, 'Choose a routine for at least one day.');
  assert.equal(validatePlan({ type: 'weekly', days: { 1: 'Z' } }, known).ok, false);
  assert.deepEqual(validatePlan({ type: 'rotation', weekdays: [5, 1, 1, 3], routineIds: ['A', 'B', 'A'] }, known),
    { ok: true, rule: { type: 'rotation', weekdays: [1, 3, 5], routineIds: ['A', 'B', 'A'], offset: 0 } });
  assert.equal(validatePlan({ type: 'rotation', weekdays: [], routineIds: ['A'] }, known).error, 'Choose at least one training day.');
  assert.equal(validatePlan({ type: 'rotation', weekdays: [1], routineIds: [] }, known).error, 'Add at least one routine to the rotation.');
  assert.equal(validatePlan({ type: 'rotation', weekdays: [1], routineIds: ['Z'] }, known).ok, false);
  assert.equal(validatePlan({ type: 'other' }, known).ok, false);
});

test('applyExceptionChange: one record per occurrence, deleted when nothing deviates', () => {
  const cancelled = applyExceptionChange(null, '2026-11-18', { cancelled: true }, 'new-id');
  assert.deepEqual(cancelled, { id: 'new-id', originalDate: '2026-11-18', cancelled: true, movedTo: null, routineId: null });
  const moved = applyExceptionChange(cancelled, '2026-11-18', { cancelled: false, movedTo: '2026-11-19' }, 'unused');
  assert.deepEqual(moved, { id: 'new-id', originalDate: '2026-11-18', cancelled: false, movedTo: '2026-11-19', routineId: null });
  const both = applyExceptionChange(moved, '2026-11-18', { routineId: 'X' }, 'unused');
  assert.deepEqual([both.movedTo, both.routineId], ['2026-11-19', 'X']);
  // Moving it back to its own day and clearing the routine leaves nothing.
  assert.equal(applyExceptionChange(both, '2026-11-18', { movedTo: '2026-11-18', routineId: null }, 'unused'), null);
  assert.equal(applyExceptionChange(cancelled, '2026-11-18', { cancelled: false }, 'unused'), null);
  assert.equal(applyExceptionChange(null, '2026-11-18', { movedTo: 'nonsense' }, 'x'), null);
});

test('routineUsage', () => {
  const data = {
    rules: [
      { id: 'past', startDate: '2026-01-01', endDate: '2026-06-30', type: 'weekly', days: { 1: 'OLD' } },
      { id: 'now', startDate: '2026-07-01', endDate: null, type: 'rotation', weekdays: [1], routineIds: ['A', 'B'] },
    ],
    exceptions: [{ id: 'e', originalDate: '2026-11-18', routineId: 'SWAP' }],
    oneOffs: [{ id: 'o', date: '2026-11-21', routineId: 'ONE' }],
    workouts: [{ id: 'w', routineId: 'DONE' }],
    today: '2026-11-16',
  };
  assert.deepEqual(routineUsage('A', data), { inPlan: true, referenced: true });
  assert.deepEqual(routineUsage('OLD', data), { inPlan: false, referenced: true });
  assert.deepEqual(routineUsage('SWAP', data), { inPlan: false, referenced: true });
  assert.deepEqual(routineUsage('ONE', data), { inPlan: false, referenced: true });
  assert.deepEqual(routineUsage('DONE', data), { inPlan: false, referenced: true });
  assert.deepEqual(routineUsage('FREE', data), { inPlan: false, referenced: false });
});

test('routines: create, clean, duplicate, summary', () => {
  const NOW = '2026-11-16T10:00:00.000Z';
  const routine = createRoutine({ id: 'r', name: 'Push day', now: NOW });
  assert.deepEqual(routine, { id: 'r', name: 'Push day', exercises: [], archivedAt: null, createdAt: NOW, updatedAt: NOW });
  assert.deepEqual(createRoutineExercise({ id: 'x', exerciseId: 'Bench' }), { id: 'x', exerciseId: 'Bench', sets: 3, repMin: 8, repMax: 12 });

  assert.equal(cleanRoutineName('  Push   day '), 'Push day');
  assert.equal(cleanRoutineName('   '), 'Routine');
  assert.equal(cleanRoutineName('x'.repeat(60)).length, 40);

  assert.deepEqual(cleanRoutineExercise({ id: 'x', exerciseId: 'B', sets: 0, repMin: 15, repMax: 10 }), { id: 'x', exerciseId: 'B', sets: 1, repMin: 10, repMax: 15 });
  assert.deepEqual(cleanRoutineExercise({ id: 'x', exerciseId: 'B', sets: 'many', repMin: null, repMax: 500 }), { id: 'x', exerciseId: 'B', sets: 3, repMin: 8, repMax: 100 });

  const full = { ...routine, archivedAt: 'x', exercises: [{ id: 'a', exerciseId: 'Bench', sets: 3, repMin: 8, repMax: 12 }, { id: 'b', exerciseId: 'Row', sets: 1, repMin: 5, repMax: 5 }] };
  const copy = duplicateRoutine(full, { id: 'r2', exerciseIds: ['a2', 'b2'], now: '2027-01-01T00:00:00.000Z' });
  assert.equal(copy.name, 'Push day copy');
  assert.deepEqual(copy.exercises.map((e) => [e.id, e.exerciseId, e.sets]), [['a2', 'Bench', 3], ['b2', 'Row', 1]]);
  assert.equal(copy.archivedAt, null);
  assert.equal(full.exercises[0].id, 'a'); // the original is untouched
  assert.equal(routineSummary(full), '2 exercises · 4 sets');
  assert.equal(routineSummary({ exercises: [{ sets: 1 }] }), '1 exercise · 1 set');
});

test('entriesFromRoutine: rows and rep range come from the routine', () => {
  let n = 0;
  const entries = entriesFromRoutine({ exercises: [
    { id: 'a', exerciseId: 'Bench', sets: 3, repMin: 6, repMax: 10 },
    { id: 'b', exerciseId: 'Row', sets: 2, repMin: 8, repMax: 12 },
  ] }, () => `id${++n}`);
  assert.deepEqual(entries.map((e) => [e.exerciseId, e.repMin, e.repMax, e.sets.length]), [['Bench', 6, 10, 3], ['Row', 8, 12, 2]]);
  const allIds = entries.flatMap((e) => [e.id, ...e.sets.map((s) => s.id)]);
  assert.equal(new Set(allIds).size, allIds.length);
  assert.ok(entries[0].sets.every((s) => s.kg === null && s.reps === null && !s.done));
});

test('month helpers', () => {
  assert.equal(monthStart('2026-11-16'), '2026-11-01');
  assert.equal(addMonths('2026-11-16', 1), '2026-12-01');
  assert.equal(addMonths('2026-11-16', 2), '2027-01-01');
  assert.equal(addMonths('2026-01-31', -1), '2025-12-01');
  assert.equal(addMonths('2026-11-01', 12 * 10), '2036-11-01');
  assert.equal(addMonths('2026-11-01', -12 * 10), '2016-11-01');
  assert.equal(monthLabel('2026-11-16'), 'November 2026');
  assert.equal(weekdayShort(1), 'Mon');
  assert.equal(weekdayShort(7), 'Sun');
  const grid = monthGrid('2026-11-16');
  assert.equal(grid.length, 42);
  assert.deepEqual(grid[0], { date: '2026-10-26', inMonth: false }); // the Monday before 1 November
  assert.deepEqual(grid[6], { date: '2026-11-01', inMonth: true }); // 1 November 2026 is a Sunday
  assert.equal(grid.filter((d) => d.inMonth).length, 30);
  assert.equal(grid.at(-1).date, '2026-12-06');
});
