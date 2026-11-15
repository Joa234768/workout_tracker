// The Exercises tab. Routes:
//   #/exercises                 the library (search, filters)
//   #/exercises/new             create a custom exercise
//   #/exercises/<id>            exercise detail
//   #/exercises/<id>/muscles    edit a built-in exercise's muscle tags
//   #/exercises/<id>/edit       edit a custom exercise

import * as list from './exercise-list.js';
import * as detail from './exercise-detail.js';
import * as muscles from './exercise-muscles.js';
import * as form from './exercise-form.js';

export function mount(container, params = {}) {
  const [first, second] = params.segments || [];
  if (!first) return list.mount(container);
  if (first === 'new' && !second) return form.mount(container, { id: null });
  if (second === 'muscles') return muscles.mount(container, { id: first });
  if (second === 'edit') return form.mount(container, { id: first });
  return detail.mount(container, { id: first });
}
