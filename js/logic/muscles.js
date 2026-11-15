// The dataset's 17 muscles and the 16 display groups they roll up into.
// Pure module. See docs/DATA_MODEL.md, "Muscle groups".

/** The muscle names used by data/exercises.json, exactly as written there. */
export const MUSCLES = [
  'abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest',
  'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back',
  'neck', 'quadriceps', 'shoulders', 'traps', 'triceps',
];

/**
 * Display groups, in the order they are shown. Only lats and middle back
 * merge (into Back). defaultTarget is weekly sets; null means no target.
 */
export const MUSCLE_GROUPS = [
  { id: 'chest', label: 'Chest', muscles: ['chest'], defaultTarget: 10 },
  { id: 'back', label: 'Back', muscles: ['lats', 'middle back'], defaultTarget: 10 },
  { id: 'shoulders', label: 'Shoulders', muscles: ['shoulders'], defaultTarget: 10 },
  { id: 'biceps', label: 'Biceps', muscles: ['biceps'], defaultTarget: 10 },
  { id: 'triceps', label: 'Triceps', muscles: ['triceps'], defaultTarget: 10 },
  { id: 'quads', label: 'Quads', muscles: ['quadriceps'], defaultTarget: 10 },
  { id: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'], defaultTarget: 10 },
  { id: 'glutes', label: 'Glutes', muscles: ['glutes'], defaultTarget: 10 },
  { id: 'abs', label: 'Abs', muscles: ['abdominals'], defaultTarget: 10 },
  { id: 'calves', label: 'Calves', muscles: ['calves'], defaultTarget: 10 },
  { id: 'lowerBack', label: 'Lower back', muscles: ['lower back'], defaultTarget: 10 },
  { id: 'traps', label: 'Traps', muscles: ['traps'], defaultTarget: null },
  { id: 'forearms', label: 'Forearms', muscles: ['forearms'], defaultTarget: null },
  { id: 'adductors', label: 'Adductors', muscles: ['adductors'], defaultTarget: null },
  { id: 'abductors', label: 'Abductors', muscles: ['abductors'], defaultTarget: null },
  { id: 'neck', label: 'Neck', muscles: ['neck'], defaultTarget: null },
];

const GROUP_BY_MUSCLE = new Map(MUSCLE_GROUPS.flatMap((group) => group.muscles.map((m) => [m, group])));
const GROUP_BY_ID = new Map(MUSCLE_GROUPS.map((group) => [group.id, group]));

/** The display group a dataset muscle belongs to, or null for an unknown name. */
export function groupOfMuscle(muscle) {
  return GROUP_BY_MUSCLE.get(muscle) || null;
}

export function groupById(id) {
  return GROUP_BY_ID.get(id) || null;
}

/** 'middle back' → 'Middle back'. */
export function muscleLabel(muscle) {
  return muscle ? muscle.charAt(0).toUpperCase() + muscle.slice(1) : '';
}

/** The display groups covering a list of muscles, without duplicates, in display order. */
export function groupsOfMuscles(muscles) {
  const ids = new Set(muscles.map((m) => GROUP_BY_MUSCLE.get(m)?.id).filter(Boolean));
  return MUSCLE_GROUPS.filter((group) => ids.has(group.id));
}
