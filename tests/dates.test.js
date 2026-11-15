import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidDateStr, toDateStr, todayStr, addDays, diffDays,
  isoWeekday, startOfWeek, endOfWeek, formatDate, formatTimestampDate,
} from '../js/logic/dates.js';

test('isValidDateStr accepts real days only', () => {
  assert.equal(isValidDateStr('2026-11-16'), true);
  assert.equal(isValidDateStr('2028-02-29'), true); // leap year
  assert.equal(isValidDateStr('2026-02-29'), false);
  assert.equal(isValidDateStr('2026-13-01'), false);
  assert.equal(isValidDateStr('16-11-2026'), false);
  assert.equal(isValidDateStr('2026-1-5'), false);
  assert.equal(isValidDateStr(null), false);
  assert.equal(isValidDateStr(20261116), false);
});

test('toDateStr uses the local day, not UTC', () => {
  // Local constructor: 00:30 and 23:30 local time are both still the 16th.
  assert.equal(toDateStr(new Date(2026, 10, 16, 0, 30)), '2026-11-16');
  assert.equal(toDateStr(new Date(2026, 10, 16, 23, 30)), '2026-11-16');
  assert.equal(toDateStr(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  assert.equal(todayStr(new Date(2027, 11, 31, 23, 59)), '2027-12-31');
  assert.throws(() => toDateStr('not a date'));
});

test('addDays crosses months, years and leap days', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-16', 0), '2026-11-16');
  assert.equal(addDays('2026-11-16', 3650), '2036-11-13');
});

test('addDays is not disturbed by daylight-saving changes', () => {
  // Denmark: clocks go forward 29 March 2026 and back 25 October 2026.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2);
});

test('diffDays', () => {
  assert.equal(diffDays('2026-11-16', '2026-11-16'), 0);
  assert.equal(diffDays('2026-11-16', '2026-11-30'), 14);
  assert.equal(diffDays('2026-11-30', '2026-11-16'), -14);
  assert.equal(diffDays('2026-01-01', '2027-01-01'), 365);
});

test('weeks run Monday to Sunday', () => {
  assert.equal(isoWeekday('2026-11-16'), 1); // Monday
  assert.equal(isoWeekday('2026-11-18'), 3);
  assert.equal(isoWeekday('2026-11-22'), 7); // Sunday
  for (const day of ['2026-11-16', '2026-11-19', '2026-11-22']) {
    assert.equal(startOfWeek(day), '2026-11-16');
    assert.equal(endOfWeek(day), '2026-11-22');
  }
  // A week that spans a year boundary.
  assert.equal(startOfWeek('2027-01-01'), '2026-12-28');
  assert.equal(endOfWeek('2026-12-28'), '2027-01-03');
});

test('formatDate shows DD-MM-YYYY', () => {
  assert.equal(formatDate('2026-11-16'), '16-11-2026');
  assert.equal(formatDate('2027-01-05'), '05-01-2027');
  assert.throws(() => formatDate('16-11-2026'));
  assert.throws(() => formatDate('2026-02-30'));
  assert.equal(formatTimestampDate(new Date(2026, 10, 16, 23, 30)), '16-11-2026');
});

test('stored date strings sort chronologically as text', () => {
  const days = ['2027-01-02', '2026-11-16', '2026-02-28', '2026-12-01'];
  const sorted = [...days].sort();
  assert.deepEqual(sorted, ['2026-02-28', '2026-11-16', '2026-12-01', '2027-01-02']);
});
