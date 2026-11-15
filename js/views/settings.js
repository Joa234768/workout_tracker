import { el, section } from '../ui/dom.js';
import { getAppVersion } from '../sw-client.js';

export function mount(container) {
  let alive = true;

  const versionValue = el('span', { class: 'value', text: '…' });
  container.append(
    section('About', el('div', { class: 'row' }, el('span', { text: 'Version' }), versionValue))
  );

  getAppVersion().then((version) => {
    if (alive) versionValue.textContent = version || 'unknown';
  });

  return () => {
    alive = false;
  };
}
