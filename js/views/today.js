import { placeholder } from '../ui/dom.js';

export function mount(container) {
  placeholder(container, 'No workout yet', 'Planned workouts and the Start button arrive with workout logging.');
  return () => {};
}
