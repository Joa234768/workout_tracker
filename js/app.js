// Startup: wire the tab bar and start the router.

import { startRouter } from './router.js';
import { registerServiceWorker, applyUpdate } from './sw-client.js';
import { showBanner } from './ui/banner.js';
import * as today from './views/today.js';
import * as calendar from './views/calendar.js';
import * as progress from './views/progress.js';
import * as exercises from './views/exercises.js';
import * as settings from './views/settings.js';

const routes = {
  today: { title: 'Today', view: today },
  calendar: { title: 'Calendar', view: calendar },
  progress: { title: 'Progress', view: progress },
  exercises: { title: 'Exercises', view: exercises },
  settings: { title: 'Settings', view: settings },
};

startRouter({
  container: document.getElementById('view'),
  titleEl: document.getElementById('view-title'),
  backEl: document.getElementById('back-button'),
  tabEls: [...document.querySelectorAll('.tabbar a')],
  routes,
  fallback: 'today',
});

registerServiceWorker({
  onUpdateReady() {
    showBanner({
      id: 'update-banner',
      text: 'Update available — tap to reload',
      onTap: applyUpdate,
    });
  },
});
