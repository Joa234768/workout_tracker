import { placeholder } from '../ui/dom.js';

export function mount(container) {
  placeholder(container, 'Calendar', 'The month view, your weekly plan and routines will live here.');
  return () => {};
}
