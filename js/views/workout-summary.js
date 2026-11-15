// #/calendar/<id> — a finished workout: totals, what it did for this week's
// muscle targets, and each exercise compared with last time. Shown right
// after finishing a workout, and when opening one from the history.

import { el, section } from '../ui/dom.js';
import { toast } from '../ui/banner.js';
import { confirmDialog } from '../ui/dialog.js';
import { db } from '../db.js';
import { getLibrary } from '../exercises.js';
import { getWorkout, getAllWorkouts, deleteWorkout } from '../workouts.js';
import { workoutStats, lastSessionBefore, compareSessions } from '../logic/workout.js';
import { weekProgress, resolveTargets } from '../logic/volume.js';
import { formatDate, startOfWeek, endOfWeek, weekdayName } from '../logic/dates.js';
import { formatKg, formatSet, formatWhole, isWorkingSet } from '../logic/sets.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const signed = (n, format) => `${n > 0 ? '+' : '−'}${format(Math.abs(n))}`;

export function notFound() {
  return section('Workout not found',
    el('p', { class: 'muted', text: 'It may have been deleted.' }),
    el('a', { class: 'btn secondary', href: '#/calendar', text: 'All workouts' })
  );
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('span', { class: 'stat-value', text: value }), el('span', { class: 'muted', text: label }));
}

/** A bar toward the weekly target: earlier this week (soft) + this workout (strong), with a marker at the target. */
function progressBar({ before, added, after, target }) {
  const scale = Math.max(target || 0, after, 1);
  const percent = (n) => `${Math.min(100, (n / scale) * 100)}%`;
  const bar = el('div', { class: 'bar', role: 'img', 'aria-label': target ? `${formatKg(after)} of ${formatKg(target)} sets this week` : `${formatKg(after)} sets this week` },
    el('span', { class: 'bar-before', style: `width:${percent(before)}` }),
    el('span', { class: 'bar-added', style: `width:${percent(added)}` })
  );
  if (target) bar.append(el('span', { class: 'bar-marker', style: `left:${percent(target)}` }));
  return bar;
}

export function mount(container, { id }) {
  let alive = true;

  function render(workout, library, allWorkouts, settings) {
    const exerciseById = new Map(library.map((exercise) => [exercise.id, exercise]));
    const nameOf = (exerciseId) => exerciseById.get(exerciseId)?.name || exerciseId;
    const stats = workoutStats(workout);

    // ----- Totals -----
    const totals = section(`${weekdayName(workout.date)} ${formatDate(workout.date)}`,
      workout.routineName ? el('p', { class: 'muted', text: workout.routineName }) : null,
      el('div', { class: 'stats' },
        stat(String(stats.exercises), stats.exercises === 1 ? 'exercise' : 'exercises'),
        stat(String(stats.sets), stats.sets === 1 ? 'set' : 'sets'),
        stat(formatWhole(stats.volume), 'kg volume'),
        workout.durationMin ? stat(String(workout.durationMin), 'minutes') : null
      ),
      stats.warmups ? el('p', { class: 'muted', text: `Plus ${plural(stats.warmups, 'warm-up set', 'warm-up sets')}, not counted.` }) : null
    );

    // ----- Muscles: how far this workout pushed each group toward its weekly target -----
    const weekStart = startOfWeek(workout.date);
    const weekEnd = endOfWeek(workout.date);
    const others = allWorkouts.filter((w) => w.id !== workout.id && w.date >= weekStart && w.date <= weekEnd);
    const progress = weekProgress(workout, others, exerciseById, {
      mode: settings.volumeCounting,
      targets: resolveTargets(settings.muscleTargets),
    });
    const muscles = section('Muscles this week',
      progress.length
        ? el('ul', { class: 'progress-list' },
            progress.map((group) =>
              el('li', {},
                el('div', { class: 'progress-head' },
                  el('span', { text: group.label }),
                  el('span', { class: 'muted', text: `+${formatKg(group.added)} → ${formatKg(group.after)}${group.target ? ` / ${formatKg(group.target)}` : ''} sets` })
                ),
                progressBar(group)
              )
            )
          )
        : el('p', { class: 'muted', text: 'No muscle groups counted.' }),
      progress.length
        ? el('p', { class: 'muted', text: `Week of ${formatDate(weekStart)}. The stronger part of each bar is this workout; the line marks the weekly target.` })
        : null
    );

    // ----- Each exercise, compared with last time -----
    const exercises = section('Exercises',
      el('ul', { class: 'history' },
        workout.exercises.map((entry) => {
          const sets = entry.sets.filter(isWorkingSet);
          const last = lastSessionBefore(allWorkouts, entry.exerciseId, workout);
          const comparison = compareSessions(sets, last ? last.sets : []);
          let verdict;
          if (!sets.length) verdict = null;
          else if (comparison.kind === 'first') verdict = el('span', { class: 'delta', text: 'First time' });
          else if (comparison.delta === 0) verdict = el('span', { class: 'delta', text: 'Same as last time' });
          else {
            const text = comparison.kind === 'volume'
              ? `${signed(comparison.delta, formatWhole)} kg volume`
              : `${signed(comparison.delta, String)} ${Math.abs(comparison.delta) === 1 ? 'rep' : 'reps'}`;
            verdict = el('span', { class: comparison.delta > 0 ? 'delta up' : 'delta down', text });
          }
          return el('li', {},
            el('a', { class: 'history-date plain-link', href: `#/exercises/${encodeURIComponent(entry.exerciseId)}`, text: nameOf(entry.exerciseId) }),
            el('span', { text: sets.length ? sets.map(formatSet).join(' · ') : 'Warm-up sets only' }),
            last ? el('span', { class: 'muted', text: `Last time (${formatDate(last.date)}): ${last.sets.map(formatSet).join(' · ')}` }) : null,
            verdict
          );
        })
      )
    );

    const notes = workout.notes && workout.notes.trim()
      ? section('Notes', el('p', { class: 'notes', text: workout.notes }))
      : null;

    // ----- Edit and delete -----
    const remove = el('button', { class: 'btn plain danger-text', type: 'button', text: 'Delete workout' });
    remove.addEventListener('click', async () => {
      const confirmed = await confirmDialog({
        title: 'Delete this workout?',
        lines: [`The workout from ${formatDate(workout.date)} and all its sets will be deleted. This cannot be undone.`],
        confirmLabel: 'Delete workout',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await deleteWorkout(workout.id);
        toast('Workout deleted.');
        location.replace('#/calendar');
      } catch (err) {
        console.error(err);
        toast('The workout could not be deleted.');
      }
    });
    const actions = el('div', { class: 'stack' },
      el('a', { class: 'btn secondary', href: `#/calendar/${encodeURIComponent(workout.id)}/edit`, text: 'Edit workout' }),
      remove
    );

    container.replaceChildren(...[totals, muscles, exercises, notes, actions].filter(Boolean));
  }

  container.append(el('p', { class: 'muted', text: 'Loading…' }));
  Promise.all([
    getWorkout(id), getLibrary(), getAllWorkouts(),
    db.getSetting('volumeCounting'), db.getSetting('muscleTargets'),
  ])
    .then(([workout, library, allWorkouts, volumeCounting, muscleTargets]) => {
      if (!alive) return;
      if (!workout) {
        container.replaceChildren(notFound());
      } else if (workout.status === 'active') {
        location.replace('#/workout');
      } else {
        render(workout, library, allWorkouts, { volumeCounting, muscleTargets });
      }
    })
    .catch((err) => {
      console.error(err);
      if (alive) container.replaceChildren(el('p', { class: 'muted', text: 'The workout could not be loaded.' }));
    });

  return () => {
    alive = false;
  };
}
