// Settings → database self-check (#/settings/selfcheck).

import { el, section } from '../ui/dom.js';
import { runSelfCheck } from '../selfcheck.js';

/** Runs the self-check and renders the results into `container`. `isAlive` stops updates after leaving. */
export function renderSelfCheck(container, { fixtureUrl, isAlive = () => true }) {
  const summary = el('p', { class: 'check-summary', text: 'Running…' });
  const list = el('ul', { class: 'check-list' });
  container.append(
    el('p', { class: 'muted', text: 'Tests the database layer in scratch databases. Your real data is not touched.' }),
    section('Database self-check', summary, list)
  );

  const report = (ok, name, detail) => {
    if (!isAlive()) return;
    list.append(
      el('li', { class: ok ? 'pass' : 'fail' },
        `${ok ? '✓' : '✗'} ${name}`,
        detail ? el('div', { class: 'detail', text: detail }) : null
      )
    );
  };

  return runSelfCheck({ fixtureUrl, report })
    .then(({ total, failed }) => {
      const ok = failed === 0;
      if (isAlive()) {
        summary.textContent = ok ? `All ${total} checks passed.` : `${failed} of ${total} checks failed.`;
        summary.classList.add(ok ? 'pass' : 'fail');
      }
      return ok;
    })
    .catch((err) => {
      console.error(err);
      if (isAlive()) {
        summary.textContent = `The self-check could not run: ${(err && err.message) || err}`;
        summary.classList.add('fail');
      }
      return false;
    });
}

export function mount(container) {
  let alive = true;
  renderSelfCheck(container, { fixtureUrl: './tests/fixtures/backup-v1.json', isAlive: () => alive });
  return () => {
    alive = false;
  };
}
