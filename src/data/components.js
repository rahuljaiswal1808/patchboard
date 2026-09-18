// Component/type definitions for Patchboard.
//
// Each component has a stable `type` id (used by the puzzle data model and the
// evaluator), a display `label`, a `category` (which sets its accent color and
// palette grouping), and a distinct line-`icon`. These ids are the contract the
// evaluator scores against, so they must never change once a puzzle references
// them.

// Six categories, each with an accent color used for the block's left edge and
// for grouping in the palette. Colors chosen per the PRD's Visual design section.
export const CATEGORIES = {
  entry: { id: 'entry', label: 'Entry', color: '#8595a8' }, // slate
  edge: { id: 'edge', label: 'Edge', color: '#f2b03d' }, // amber
  compute: { id: 'compute', label: 'Compute', color: '#4b9bff' }, // blue
  cache: { id: 'cache', label: 'Cache', color: '#ff7d6b' }, // coral
  storage: { id: 'storage', label: 'Storage', color: '#3ecf8e' }, // green
  messaging: { id: 'messaging', label: 'Messaging', color: '#f5da42' }, // yellow
};

// Line-icons are inline SVG inner markup rendered at 24x24, stroked with
// currentColor so they inherit the category accent. Kept simple and distinct.
const ICONS = {
  client:
    '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  dns:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>',
  cdn:
    '<circle cx="12" cy="12" r="3.5"/><circle cx="5" cy="6" r="1.6"/><circle cx="19" cy="6" r="1.6"/><circle cx="5" cy="18" r="1.6"/><circle cx="19" cy="18" r="1.6"/><path d="m6.4 7 3 3M17.6 7l-3 3M6.4 17l3-3M17.6 17l-3-3"/>',
  lb:
    '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v3.5M5 17v-3.5h14V17M12 10.5V17"/>',
  gateway:
    '<path d="M8 4H4v16h4M16 4h4v16h-4"/><path d="M12 8v8M9.5 12h5"/>',
  webserver:
    '<rect x="4" y="4" width="16" height="7" rx="1.2"/><rect x="4" y="13" width="16" height="7" rx="1.2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  microservice:
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/><path d="M10.5 7h4a2 2 0 0 1 2 2v4.5"/>',
  worker:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19"/>',
  cache: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/>',
  sql:
    '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-13M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8"/>',
  nosql:
    '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v13c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-13M8.5 11h7M8.5 15h7"/>',
  object_storage:
    '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M4.5 8.5v10.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8.5M9.5 13h5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m14.5 14.5 6 6"/>',
  queue:
    '<rect x="3" y="7.5" width="4" height="9" rx="1"/><rect x="10" y="7.5" width="4" height="9" rx="1"/><rect x="17" y="7.5" width="4" height="9" rx="1"/>',
  // Generic icon used by player-defined custom components.
  custom: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M12 9v6M9 12h6"/>',
};

// The 14 built-in component types, in palette order (grouped by category).
export const COMPONENTS = [
  { type: 'client', label: 'Client / User', category: 'entry', icon: ICONS.client },
  { type: 'dns', label: 'DNS', category: 'entry', icon: ICONS.dns },
  { type: 'cdn', label: 'CDN', category: 'edge', icon: ICONS.cdn },
  { type: 'lb', label: 'Load Balancer', category: 'edge', icon: ICONS.lb },
  { type: 'gateway', label: 'API Gateway', category: 'edge', icon: ICONS.gateway },
  { type: 'webserver', label: 'Web Server', category: 'compute', icon: ICONS.webserver },
  { type: 'microservice', label: 'Microservice', category: 'compute', icon: ICONS.microservice },
  { type: 'worker', label: 'Background Worker', category: 'compute', icon: ICONS.worker },
  { type: 'cache', label: 'Cache (Redis-like)', category: 'cache', icon: ICONS.cache },
  { type: 'sql', label: 'SQL Database', category: 'storage', icon: ICONS.sql },
  { type: 'nosql', label: 'NoSQL Database', category: 'storage', icon: ICONS.nosql },
  { type: 'object_storage', label: 'Object Storage', category: 'storage', icon: ICONS.object_storage },
  { type: 'search', label: 'Search Index', category: 'storage', icon: ICONS.search },
  { type: 'queue', label: 'Message Queue', category: 'messaging', icon: ICONS.queue },
];

export const CUSTOM_ICON = ICONS.custom;

// Fast lookup from type id to its definition. Custom types are registered here
// at runtime by the palette so blocks and connections can resolve their label,
// color, and icon uniformly.
const REGISTRY = new Map(COMPONENTS.map((c) => [c.type, c]));

export function getComponent(type) {
  return REGISTRY.get(type);
}

// Register a player-defined custom type. `type` ids for custom components are
// prefixed with `custom:` so they can never collide with a built-in id and can
// never satisfy a checklist (the evaluator only matches built-in ids).
export function registerCustom(type, label, category) {
  const def = { type, label, category, icon: CUSTOM_ICON, custom: true };
  REGISTRY.set(type, def);
  return def;
}

// Remove all custom types from the registry (called when the board is cleared
// for a new problem).
export function clearCustomTypes() {
  for (const key of REGISTRY.keys()) {
    if (key.startsWith('custom:')) REGISTRY.delete(key);
  }
}

export function categoryColor(category) {
  return CATEGORIES[category] ? CATEGORIES[category].color : CATEGORIES.entry.color;
}
