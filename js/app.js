// Startup: open the database, ask for persistent storage, register the
// service worker, then start the router.

import { startRouter } from './router.js';
import { registerServiceWorker, applyUpdate } from './sw-client.js';
import { showBanner } from './ui/banner.js';
import { el, section } from './ui/dom.js';
import { db } from './db.js';
import { BACKUP_CHANGED, getBackupStatus } from './backup.js';
import * as today from './views/today.js';
import * as calendar from './views/calendar.js';
import * as progress from './views/progress.js';
import * as exercises from './views/exercises.js';
import * as settings from './views/settings.js';
import * as workout from './views/workout.js';
import { WORKOUT_CHANGED, getActiveWorkout } from './workouts.js';

const routes = {
  today: { title: 'Today', view: today },
  calendar: { title: 'Calendar', view: calendar },
  progress: { title: 'Progress', view: progress },
  exercises: { title: 'Exercises', view: exercises },
  settings: { title: 'Settings', view: settings },
  // The workout in progress is its own screen, shown under the Today tab.
  workout: { title: 'Workout', view: workout, tab: 'today' },
};

const container = document.getElementById('view');

// Registered first, so a broken release can always be replaced by a fixed one.
registerServiceWorker({
  onUpdateReady() {
    showBanner({
      id: 'update-banner',
      text: 'Update available — tap to reload',
      onTap: applyUpdate,
    });
  },
});

// Ask the browser not to evict our data. iOS decides by itself; Settings shows the result.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// A small "Workout in progress" pill above the tab bar. Not shown on the
// workout itself, nor on Today, whose card already says the same.
let currentRoute = null;
const pill = el('a', { class: 'pill', href: '#/workout', text: 'Workout in progress ›', hidden: true });
document.getElementById('banners').append(pill);
function refreshWorkoutPill() {
  getActiveWorkout()
    .then((active) => {
      pill.hidden = !active || currentRoute === 'workout' || currentRoute === 'today';
    })
    .catch((err) => console.error(err));
}

async function start() {
  try {
    await db.ready();
  } catch (err) {
    console.error(err);
    container.replaceChildren(
      section(
        'The saved data could not be opened',
        el('p', { class: 'muted', text: String((err && err.message) || err) }),
        el('p', { class: 'muted', text: 'Nothing has been deleted. Close the app completely and open it again.' })
      )
    );
    return;
  }

  startRouter({
    container,
    titleEl: document.getElementById('view-title'),
    backEl: document.getElementById('back-button'),
    tabEls: [...document.querySelectorAll('.tabbar a')],
    routes,
    fallback: 'today',
    onChange: (name) => {
      currentRoute = name;
      refreshWorkoutPill();
    },
  });
  window.addEventListener(WORKOUT_CHANGED, refreshWorkoutPill);

  // A small dot on the Settings tab while a backup is due.
  const settingsTab = document.querySelector('.tabbar a[data-tab="settings"]');
  const refreshBackupDot = () =>
    getBackupStatus()
      .then((status) => settingsTab.classList.toggle('has-dot', status.due))
      .catch((err) => console.error(err));
  refreshBackupDot();
  window.addEventListener(BACKUP_CHANGED, refreshBackupDot);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBackupDot(); // the day may have changed
  });
}

start();
