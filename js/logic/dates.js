// Calendar-day helpers. Pure functions, no DOM.
//
// A calendar day is stored as a local 'YYYY-MM-DD' string. That order must not
// change: IndexedDB sorts and range-searches these strings as text.
// Dates are shown to the user as 'DD-MM-YYYY' via formatDate().
//
// Day arithmetic goes through UTC midnight, so daylight-saving changes can
// never add or drop a day.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function toUtcMs(dateStr) {
  const m = DATE_RE.exec(dateStr);
  if (!m) throw new Error(`Invalid date: ${dateStr}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  return ms;
}

function fromUtcMs(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** True for a real calendar day written as 'YYYY-MM-DD'. */
export function isValidDateStr(value) {
  if (typeof value !== 'string') return false;
  try {
    toUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

/** The local calendar day of a Date (or ISO timestamp), as 'YYYY-MM-DD'. Never uses toISOString(). */
export function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${date}`);
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's local calendar day. */
export function todayStr(now = new Date()) {
  return toDateStr(now);
}

/** dateStr plus n days (n may be negative). */
export function addDays(dateStr, n) {
  return fromUtcMs(toUtcMs(dateStr) + n * DAY_MS);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from, to) {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(dateStr) {
  const day = new Date(toUtcMs(dateStr)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** The Monday of the week containing dateStr. */
export function startOfWeek(dateStr) {
  return addDays(dateStr, 1 - isoWeekday(dateStr));
}

/** The Sunday of the week containing dateStr. */
export function endOfWeek(dateStr) {
  return addDays(dateStr, 7 - isoWeekday(dateStr));
}

/** 'YYYY-MM-DD' → 'DD-MM-YYYY', the format shown to the user. */
export function formatDate(dateStr) {
  const m = DATE_RE.exec(dateStr);
  if (!m || !isValidDateStr(dateStr)) throw new Error(`Invalid date: ${dateStr}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** An ISO timestamp (or Date) → the local day as 'DD-MM-YYYY'. */
export function formatTimestampDate(timestamp) {
  return formatDate(toDateStr(timestamp));
}
