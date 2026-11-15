// The body-weight log's data access. One entry per day, keyed by its date:
// saving a day that already has an entry replaces it.

import { db } from './db.js';
import { isValidDateStr, todayStr } from './logic/dates.js';
import { MAX_BODY_KG, MIN_BODY_KG } from './logic/stats.js';

/** Every entry, oldest first: [{ date, kg, updatedAt }]. */
export async function getBodyWeights() {
  const entries = await db.getAll('bodyWeights');
  return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Saves the weight for a day (today or earlier). Throws with a message for the user if invalid. */
export async function saveBodyWeight(date, kg) {
  if (!isValidDateStr(date) || date > todayStr()) throw new Error('Choose today or an earlier date.');
  if (typeof kg !== 'number' || !(kg >= MIN_BODY_KG && kg <= MAX_BODY_KG)) {
    throw new Error(`Enter a weight between ${MIN_BODY_KG} and ${MAX_BODY_KG} kg.`);
  }
  await db.put('bodyWeights', { date, kg, updatedAt: new Date().toISOString() });
}

export function deleteBodyWeight(date) {
  return db.remove('bodyWeights', date);
}
