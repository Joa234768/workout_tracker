import { placeholder } from '../ui/dom.js';

export function mount(container) {
  placeholder(container, 'Exercises', 'The exercise library, filters and your custom exercises will live here.');
  return () => {};
}
