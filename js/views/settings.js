import { placeholder } from '../ui/dom.js';

export function mount(container) {
  placeholder(container, 'Settings', 'Backup, app version and preferences will live here.');
  return () => {};
}
