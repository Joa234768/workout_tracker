// The body map: a simplified front and back figure drawn for this project.
// Each region belongs to a muscle group (js/logic/muscles.js) and is coloured
// by how full that group is this week. Tapping a region selects its group.
//
// Shapes are drawn for the left half of the figure (the figure is 100 wide,
// centred on x = 50) and mirrored, unless marked `single`.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null && value !== false) node.setAttribute(key, String(value));
  }
  node.append(...children.flat().filter(Boolean));
  return node;
}

const ellipse = (cx, cy, rx, ry, rotate = 0) => ({ tag: 'ellipse', attrs: { cx, cy, rx, ry, transform: rotate ? `rotate(${rotate} ${cx} ${cy})` : null } });
const path = (d) => ({ tag: 'path', attrs: { d } });

// Head, torso, limbs: the neutral figure the regions sit on.
const BASE = [
  { tag: 'circle', attrs: { cx: 50, cy: 13, r: 9 }, single: true },
  { ...path('M34 30 H66 Q73 31 72 40 L67 80 L68 100 H32 L33 80 L28 40 Q27 31 34 30 Z'), single: true },
  { tag: 'line', attrs: { x1: 25, y1: 38, x2: 20, y2: 72, 'stroke-width': 11 } },
  { tag: 'line', attrs: { x1: 20, y1: 76, x2: 15, y2: 108, 'stroke-width': 9 } },
  { tag: 'circle', attrs: { cx: 14, cy: 116, r: 5 } },
  { tag: 'line', attrs: { x1: 40, y1: 104, x2: 38.5, y2: 150, 'stroke-width': 17 } },
  { tag: 'line', attrs: { x1: 38.5, y1: 157, x2: 37.5, y2: 204, 'stroke-width': 12 } },
  { ...ellipse(36.5, 215, 6.5, 4) },
];

const NECK = { ...path('M45.5 22 H54.5 V29 H45.5 Z'), single: true };
const ARM = ellipse(22.8, 55, 5.2, 13, 8);
const FOREARM = ellipse(17.6, 91, 4.2, 14.5, 8);

const FRONT = [
  { group: 'neck', ...NECK },
  { group: 'traps', ...path('M45 25 V30.5 H35.5 Z') },
  { group: 'shoulders', ...ellipse(27, 36.5, 7.5, 7) },
  { group: 'chest', ...path('M49 33 H40 Q36 34 36 41 Q37 49 44 49 H49 Z') },
  { group: 'biceps', ...ARM },
  { group: 'forearms', ...FOREARM },
  { group: 'abs', ...path('M43 52 H57 V84 Q57 90 50 92 Q43 90 43 84 Z'), single: true },
  { group: 'abductors', ...ellipse(31.6, 103, 2.6, 8) },
  { group: 'quads', ...ellipse(37.6, 128, 6.2, 20, 2) },
  { group: 'adductors', ...ellipse(46.2, 117, 2.4, 11) },
];

const BACK = [
  { group: 'neck', ...NECK },
  { group: 'traps', ...path('M45 24 H55 L65 31 L50 46 L35 31 Z'), single: true },
  { group: 'shoulders', ...ellipse(27, 36.5, 7.5, 7) },
  { group: 'back', muscle: 'middle back', ...path('M36 34.5 L49 47.5 V62 L38.5 52.5 Z') },
  { group: 'back', muscle: 'lats', ...path('M31 43 L37 55 L49 65.5 V79 H35.5 Z') },
  { group: 'triceps', ...ARM },
  { group: 'forearms', ...FOREARM },
  { group: 'lowerBack', ...path('M37 81 H63 L64 92 H36 Z'), single: true },
  { group: 'abductors', ...ellipse(30.6, 101, 2.2, 7) },
  { group: 'glutes', ...ellipse(41.4, 103.5, 8, 9) },
  { group: 'hamstrings', ...ellipse(39, 135, 7, 17, 2) },
  { group: 'calves', ...ellipse(37.8, 178, 5.4, 16) },
];

const MIRROR = 'translate(100 0) scale(-1 1)';

function draw(shape, attrs) {
  const node = svg(shape.tag, { ...shape.attrs, ...attrs });
  if (shape.single) return [node];
  // The mirrored copy keeps its own rotation by being wrapped, not re-transformed.
  return [node, svg('g', { transform: MIRROR }, svg(shape.tag, { ...shape.attrs, ...attrs }))];
}

function figure(title, regions, { groups, selected, onSelect }) {
  const root = svg('svg', { viewBox: '0 0 100 222', class: 'body-figure', role: 'group', 'aria-label': title });
  root.append(svg('g', { class: 'body-base' }, BASE.flatMap((shape) => draw(shape, {}))));
  for (const region of regions) {
    const group = groups.get(region.group);
    if (!group) continue;
    const level = group.level;
    const node = svg('g', {
      class: `body-region${level > 0 ? '' : ' empty'}${selected === region.group ? ' selected' : ''}`,
      style: level > 0 ? `fill-opacity:${(0.25 + 0.75 * level).toFixed(2)}` : null,
      role: 'button',
      tabindex: 0,
      'aria-label': `${group.label}, ${title.toLowerCase()}`,
      'aria-pressed': String(selected === region.group),
      'data-group': region.group,
      'data-muscle': region.muscle || null,
    }, draw(region, {}));
    const pick = () => onSelect(region.group);
    node.addEventListener('click', pick);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick();
      }
    });
    root.append(node);
  }
  return root;
}

/**
 * groups: the weekVolume() list. selected: a group id or null.
 * onSelect(groupId) is called when a region is tapped.
 */
export function bodyMap({ groups, selected = null, onSelect }) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const options = { groups: byId, selected, onSelect };
  const wrap = document.createElement('div');
  wrap.className = 'body-map';
  for (const [title, regions] of [['Front', FRONT], ['Back', BACK]]) {
    const cell = document.createElement('div');
    cell.className = 'body-cell';
    const caption = document.createElement('span');
    caption.className = 'muted';
    caption.textContent = title;
    cell.append(figure(title, regions, options), caption);
    wrap.append(cell);
  }
  return wrap;
}
