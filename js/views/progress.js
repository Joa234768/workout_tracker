// The Progress tab. Routes:
//   #/progress                   Muscles: weekly sets per muscle group
//   #/progress/exercises         Exercises: the ones I have logged
//   #/progress/exercises/<id>    one exercise's charts
//   #/progress/training          Training: workouts per week, planned vs. done
//   #/progress/body              Body: the body-weight log

import * as muscles from './progress-muscles.js';
import * as exercises from './progress-exercises.js';
import * as training from './progress-training.js';
import * as body from './progress-body.js';

export function mount(container, { segments = [] } = {}) {
  const [part, id] = segments;
  if (part === 'exercises') return id ? exercises.mountCharts(container, { id }) : exercises.mountList(container);
  if (part === 'training') return training.mount(container);
  if (part === 'body') return body.mount(container);
  return muscles.mount(container);
}
