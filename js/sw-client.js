// Page-side service worker handling: registration, update detection and
// asking the worker which app version it serves.

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // at most once an hour

let registration = null;
let reloadOnControllerChange = false;

const supported = 'serviceWorker' in navigator;

/**
 * Registers ./sw.js. `onUpdateReady` is called when a new version has been
 * downloaded and is waiting. It is not called for the very first install.
 */
export async function registerServiceWorker({ onUpdateReady } = {}) {
  if (!supported) return null;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when the user asked for the update. The first install also
    // fires this event (the worker claims the page) and must not reload.
    if (!reloadOnControllerChange) return;
    reloadOnControllerChange = false;
    location.reload();
  });

  try {
    registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  } catch (err) {
    console.error('Service worker registration failed', err);
    return null;
  }

  const notifyIfWaiting = () => {
    if (registration.waiting && navigator.serviceWorker.controller && onUpdateReady) onUpdateReady();
  };

  const watch = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') notifyIfWaiting();
    });
  };

  notifyIfWaiting();
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));

  // An installed iPhone app resumes without reloading, so it would rarely
  // look for updates by itself. Check on startup and when it comes back.
  let lastCheck = Date.now();
  const check = () => registration.update().catch(() => {}); // offline is fine
  check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
    lastCheck = Date.now();
    check();
  });

  return registration;
}

/** Switches to the waiting version and reloads the page once it has taken over. */
export function applyUpdate() {
  const waiting = registration && registration.waiting;
  if (!waiting) {
    location.reload();
    return;
  }
  reloadOnControllerChange = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

function timeout(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

/**
 * The version of the files actually being served, straight from the service
 * worker controlling this page. Null when there is none (e.g. first load).
 */
export async function getAppVersion() {
  if (!supported) return null;
  const ready = await Promise.race([navigator.serviceWorker.ready, timeout(4000)]);
  const worker = navigator.serviceWorker.controller || (ready && ready.active);
  if (!worker) return null;
  const reply = new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve((event.data && event.data.version) || null);
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  });
  return Promise.race([reply, timeout(3000)]);
}
