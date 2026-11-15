// Small DOM helpers. All text goes in through textContent or text nodes,
// never innerHTML, so user-entered and imported text can't inject markup.

const PROPERTIES = new Set(['value', 'hidden', 'disabled', 'checked', 'type', 'href', 'htmlFor']);

/**
 * el('button', { class: 'btn', text: 'Save', onclick: fn }, child1, child2)
 * - `class` and `text` are shortcuts for className and textContent.
 * - `on…` functions become event listeners.
 * - null / false props and children are skipped.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (PROPERTIES.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

/** A titled card section used by every screen. */
export function section(title, ...children) {
  return el('section', { class: 'card' }, title ? el('h2', { class: 'card-title', text: title }) : null, ...children);
}

/** Placeholder content for screens that arrive in a later phase. */
export function placeholder(container, title, text) {
  container.append(section(title, el('p', { class: 'muted', text })));
}
