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

/** '42.5×10' (kg × reps), or 'BW×12' for a bodyweight set. Used in the compact "Last" line. */
export function formatSetCompact(set) {
  const weight = typeof set.kg === 'number' && set.kg > 0 ? formatKg(set.kg) : 'BW';
  return `${weight}×${set.reps}`;
}

/** kg × reps of one set; 0 for bodyweight or empty sets. */
export function setVolume(set) {
  return (typeof set.kg === 'number' ? set.kg : 0) * (typeof set.reps === 'number' ? set.reps : 0);
}

/** A whole number with a (non-breaking) space between thousands: 3240.4 → '3 240'. */
export function formatWhole(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/**
 * Text typed into a weight field → kilograms, or null if empty or not a
 * sensible weight. Accepts ',' and '.' as the decimal separator, because a
 * Danish keyboard gives a comma.
 */
export function parseKg(text) {
  const cleaned = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{0,2})?$|^\.\d{1,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/** Text typed into a reps field → a whole number from 0 to 999, or null. */
export function parseReps(text) {
  const cleaned = String(text ?? '').trim();
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  return Number(cleaned);
}
