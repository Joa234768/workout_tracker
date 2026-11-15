import { placeholder } from '../ui/dom.js';

export function mount(container) {
  placeholder(container, 'Progress', 'Weekly muscle volume, exercise charts and body weight will live here.');
  return () => {};
}
