// What counts as a set, and how sets are written out. Pure module.

/** A set the user ticked off, with at least one rep. */
export function isDoneSet(set) {
  return Boolean(set) && set.done === true && typeof set.reps === 'number' && set.reps > 0;
}

/** A done set that is not a warm-up. Only these count for volume, e1RM and progression. */
export function isWorkingSet(set) {
  return isDoneSet(set) && set.warmup !== true;
}

/** Kilograms without trailing zeros: 12.5 → '12.5', 40 → '40'. */
export function formatKg(kg) {
  return String(Math.round(Number(kg) * 100) / 100);
}

/** '42.5 kg × 10', or '12 reps' for a bodyweight set (kg 0 or empty). */
export function formatSet(set) {
  if (typeof set.kg === 'number' && set.kg > 0) return `${formatKg(set.kg)} kg × ${set.reps}`;
  return `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`;
}
