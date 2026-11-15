// Hash router: '#/tab' or '#/tab/sub/…'. The first segment picks the tab and
// its view; the rest is passed to the view as params.segments.

function parseHash() {
  return location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * routes: { today: { title, view: { mount(container, params) → cleanup? } }, … }
 * Returns { refresh } to re-render the current route.
 */
export function startRouter({ container, titleEl, backEl, tabEls, routes, fallback, onChange }) {
  let cleanup = null;

  function render() {
    const segments = parseHash();
    const name = segments[0];
    const route = routes[name];
    if (!route) {
      location.replace(`#/${fallback}`);
      return;
    }

    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (err) {
        console.error(err);
      }
    }
    cleanup = null;
    container.replaceChildren();

    titleEl.textContent = route.title;
    document.title = `${route.title} · Workout Tracker`;
    for (const tab of tabEls) {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    // An installed iPhone app has no browser back button, so sub-screens get one.
    backEl.hidden = segments.length < 2;
    backEl.href = `#/${name}`;

    window.scrollTo(0, 0);
    try {
      cleanup = route.view.mount(container, { segments: segments.slice(1) });
    } catch (err) {
      console.error(err);
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Something went wrong showing this screen.';
      container.replaceChildren(p);
    }
    if (onChange) onChange(name);
  }

  window.addEventListener('hashchange', render);
  render();
  return { refresh: render };
}
