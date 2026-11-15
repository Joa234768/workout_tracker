// The calendar plan: weekly rules, exceptions and one-off workouts, and the
// state of every day. Pure module. See docs/DATA_MODEL.md, "Calendar plan".
//
// Nothing is pre-generated. A month is computed from the rule covering each
// date, so the calendar can go years ahead or back instantly.

import { addDays, diffDays, isoWeekday, isValidDateStr } from './dates.js';

/** The rule version covering a date, or null. Rule ranges never overlap. */
export function ruleForDate(rules, date) {
  return rules.find((rule) => rule.startDate <= date && (rule.endDate == null || date <= rule.endDate)) || null;
}

// Training days of a rotation in [rule.startDate, date).
function trainingDaysBefore(rule, date) {
  const total = diffDays(rule.startDate, date);
  const weeks = Math.floor(total / 7);
  let count = weeks * rule.weekdays.length;
  for (let i = weeks * 7; i < total; i++) {
    if (rule.weekdays.includes(isoWeekday(addDays(rule.startDate, i)))) count += 1;
  }
  return count;
}

/**
 * The routine a rule puts on a date, or undefined if the rule has no workout
 * that day. A rotation is fixed to the calendar: the routine depends only on
 * how many training days have passed since the rule started, so a missed
 * workout never shifts later ones.
 */
export function ruleRoutineOn(rule, date) {
  if (!rule) return undefined;
  const weekday = isoWeekday(date);
  if (rule.type === 'weekly') return (rule.days && rule.days[weekday]) || undefined;
  if (rule.type === 'rotation') {
    if (!rule.weekdays.includes(weekday) || !rule.routineIds.length) return undefined;
    const slot = trainingDaysBefore(rule, date) + (rule.offset || 0);
    return rule.routineIds[slot % rule.routineIds.length];
  }
  return undefined;
}

/**
 * Every planned occurrence whose (possibly moved) date falls in [from, to]:
 * { ref, kind: 'rule' | 'oneoff', originalDate, date, routineId, cancelled, moved, oneOffId? }
 * `ref` is what a workout stores in plannedRef: 'rule:<originalDate>' or 'oneoff:<id>'.
 */
export function occurrencesInRange(from, to, { rules = [], exceptions = [], oneOffs = [] }) {
  const exceptionByDate = new Map(exceptions.map((exception) => [exception.originalDate, exception]));
  const inRange = (date) => date >= from && date <= to;
  const result = [];

  const fromRule = (originalDate) => {
    const routineId = ruleRoutineOn(ruleForDate(rules, originalDate), originalDate);
    if (routineId === undefined) return null; // an exception left behind by an old plan is ignored
    const exception = exceptionByDate.get(originalDate);
    const movedTo = exception && exception.movedTo && exception.movedTo !== originalDate ? exception.movedTo : null;
    return {
      ref: `rule:${originalDate}`,
      kind: 'rule',
      originalDate,
      date: movedTo || originalDate,
      routineId: (exception && exception.routineId) || routineId,
      cancelled: Boolean(exception && exception.cancelled),
      moved: Boolean(movedTo),
    };
  };

  for (let date = from; date <= to; date = addDays(date, 1)) {
    const occurrence = fromRule(date);
    if (occurrence && inRange(occurrence.date)) result.push(occurrence);
  }
  // Workouts moved into the range from outside it.
  for (const exception of exceptions) {
    if (!exception.movedTo || !inRange(exception.movedTo) || inRange(exception.originalDate)) continue;
    const occurrence = fromRule(exception.originalDate);
    if (occurrence && occurrence.moved) result.push(occurrence);
  }
  for (const oneOff of oneOffs) {
    if (!inRange(oneOff.date)) continue;
    result.push({
      ref: `oneoff:${oneOff.id}`,
      kind: 'oneoff',
      originalDate: oneOff.date,
      date: oneOff.date,
      routineId: oneOff.routineId || null,
      cancelled: Boolean(oneOff.cancelled),
      moved: false,
      oneOffId: oneOff.id,
    });
  }
  return result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * What each day in [from, to] shows: { 'YYYY-MM-DD': entries[] }.
 * An entry is one of:
 * - { state: 'completed', workout }            a finished workout (planned or not)
 * - { state: 'active', workout }               the workout in progress
 * - { state: 'planned', occurrence }           today or later, not done, not cancelled
 * - { state: 'missed', occurrence }            before today, neither done nor cancelled
 * - { state: 'cancelled', occurrence }
 * A planned occurrence counts as done, and is not listed separately, when a
 * completed workout carries its ref or any completed workout is on its date.
 * `workouts` must be all workouts, not only those in the range.
 */
export function calendarDays(from, to, { rules = [], exceptions = [], oneOffs = [], workouts = [], today }) {
  const days = {};
  const add = (date, entry) => (days[date] || (days[date] = [])).push(entry);

  const completed = workouts.filter((workout) => workout.status === 'completed');
  const doneRefs = new Set(completed.map((workout) => workout.plannedRef).filter(Boolean));
  const doneDates = new Set(completed.map((workout) => workout.date));

  for (const workout of workouts) {
    if (workout.date < from || workout.date > to) continue;
    add(workout.date, { state: workout.status === 'completed' ? 'completed' : 'active', workout });
  }
  for (const occurrence of occurrencesInRange(from, to, { rules, exceptions, oneOffs })) {
    if (occurrence.cancelled) add(occurrence.date, { state: 'cancelled', occurrence });
    else if (doneRefs.has(occurrence.ref) || doneDates.has(occurrence.date)) continue;
    else add(occurrence.date, { state: occurrence.date < today ? 'missed' : 'planned', occurrence });
  }
  return days;
}

/** The next occurrence after `today` that is still to do, within `horizonDays`. Null if none. */
export function nextPlanned(today, data, horizonDays = 60) {
  const from = addDays(today, 1);
  const days = calendarDays(from, addDays(today, horizonDays), { ...data, today });
  for (const date of Object.keys(days).sort()) {
    const entry = days[date].find((e) => e.state === 'planned');
    if (entry) return entry.occurrence;
  }
  return null;
}

/**
 * Changing the plan from a date: earlier days keep the plan they had.
 * Rule versions starting on or after `fromDate` are removed, the version
 * covering it is ended the day before, and `newRule` (if any) starts there,
 * open-ended. Pass null to stop planning from that date.
 * Returns { put: rules to save, remove: rule ids to delete }.
 */
export function planChange(rules, newRule, fromDate) {
  const put = [];
  const remove = [];
  for (const rule of rules) {
    if (rule.startDate >= fromDate) remove.push(rule.id);
    else if (rule.endDate == null || rule.endDate >= fromDate) put.push({ ...rule, endDate: addDays(fromDate, -1) });
  }
  if (newRule) put.push({ ...newRule, startDate: fromDate, endDate: null });
  return { put, remove };
}

const validWeekday = (n) => Number.isInteger(n) && n >= 1 && n <= 7;

/**
 * Checks a plan as entered on the plan screen and returns it in stored form.
 * knownRoutineIds: the routines that exist. Returns { ok, error } or { ok, rule }
 * (without id and dates; planChange adds the dates).
 */
export function validatePlan(input, knownRoutineIds) {
  const known = new Set(knownRoutineIds);
  if (input.type === 'weekly') {
    const days = {};
    for (const [key, routineId] of Object.entries(input.days || {})) {
      if (!routineId) continue;
      if (!validWeekday(Number(key)) || !known.has(routineId)) return { ok: false, error: 'Choose a routine for each training day.' };
      days[Number(key)] = routineId;
    }
    if (!Object.keys(days).length) return { ok: false, error: 'Choose a routine for at least one day.' };
    return { ok: true, rule: { type: 'weekly', days } };
  }
  if (input.type === 'rotation') {
    const weekdays = [...new Set(input.weekdays || [])].filter(validWeekday).sort((a, b) => a - b);
    const routineIds = (input.routineIds || []).filter(Boolean);
    if (!weekdays.length) return { ok: false, error: 'Choose at least one training day.' };
    if (!routineIds.length) return { ok: false, error: 'Add at least one routine to the rotation.' };
    if (!routineIds.every((id) => known.has(id))) return { ok: false, error: 'Choose a routine for every step of the rotation.' };
    return { ok: true, rule: { type: 'rotation', weekdays, routineIds, offset: 0 } };
  }
  return { ok: false, error: 'Choose how to plan your week.' };
}

/**
 * The exception record after applying a change to one rule occurrence, or
 * null when nothing deviates any more (the record should be deleted).
 * change: any of { cancelled, movedTo, routineId }; null clears a field.
 */
export function applyExceptionChange(existing, originalDate, change, newId) {
  const merged = {
    id: existing ? existing.id : newId,
    originalDate,
    cancelled: existing ? Boolean(existing.cancelled) : false,
    movedTo: existing ? existing.movedTo || null : null,
    routineId: existing ? existing.routineId || null : null,
    ...change,
  };
  merged.cancelled = Boolean(merged.cancelled);
  if (!merged.movedTo || merged.movedTo === originalDate || !isValidDateStr(merged.movedTo)) merged.movedTo = null;
  if (!merged.routineId) merged.routineId = null;
  if (!merged.cancelled && !merged.movedTo && !merged.routineId) return null;
  return merged;
}

/**
 * Where a routine is used.
 * - inPlan: in a rule version that is still running on `today` or starts later
 *   (it cannot be deleted until it is taken out of the plan).
 * - referenced: anything refers to it (it must be archived, not deleted).
 */
export function routineUsage(routineId, { rules = [], exceptions = [], oneOffs = [], workouts = [], today }) {
  const ruleUses = (rule) =>
    rule.type === 'weekly' ? Object.values(rule.days || {}).includes(routineId) : (rule.routineIds || []).includes(routineId);
  const inPlan = rules.some((rule) => (rule.endDate == null || rule.endDate >= today) && ruleUses(rule));
  const referenced =
    rules.some(ruleUses) ||
    exceptions.some((exception) => exception.routineId === routineId) ||
    oneOffs.some((oneOff) => oneOff.routineId === routineId) ||
    workouts.some((workout) => workout.routineId === routineId);
  return { inPlan, referenced };
}
