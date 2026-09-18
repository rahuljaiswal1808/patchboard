// Application entry point for Patchboard.
//
// Wires the data (components, puzzles), the canvas (Board), the evaluator, and
// the sound engine to the DOM. Keeps no game logic of its own beyond
// orchestration: scoring lives in evaluator.js, rendering in canvas.js, audio in
// sound.js, content in data/.

import { COMPONENTS, CATEGORIES, categoryColor, registerCustom, clearCustomTypes, getComponent } from './data/components.js';
import { PUZZLES } from './data/puzzles.js';
import { Board } from './canvas.js';
import { evaluate, scoreTier, buildSolution } from './evaluator.js';
import { SoundEngine } from './sound.js';

const $ = (sel) => document.querySelector(sel);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STORE_KEY = 'patchboard:prefs';
const PUZZLE_KEY = 'patchboard:puzzles';
const CREATE_OPTION = '__create__';

const sound = new SoundEngine();

const state = {
  puzzle: null,
  hintsUsed: 0,
  hintsShown: 0,
  customSeq: 0,
  solving: false,
  customPuzzles: [], // user-authored puzzles, persisted in localStorage
  labelConnId: null, // connection currently being labeled
};

// ---- board -------------------------------------------------------------

const board = new Board($('#canvas'), {
  onPlace: () => {
    sound.place();
    refreshEmptyHint();
  },
  onConnect: () => sound.connect(),
  onDeleteBlock: () => {
    sound.del();
    refreshEmptyHint();
  },
  onDeleteConnection: () => sound.del(),
  onEditLabel: (conn) => openLabelEditor(conn),
});

function refreshEmptyHint() {
  $('#empty-hint').hidden = board.blocks.size > 0;
}

// ---- preferences (localStorage) ---------------------------------------

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch (_) {
    return {};
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch (_) {
    /* storage unavailable; preferences just won't persist */
  }
}
function updatePref(key, value) {
  const prefs = loadPrefs();
  prefs[key] = value;
  savePrefs(prefs);
}

function loadCustomPuzzles() {
  try {
    const arr = JSON.parse(localStorage.getItem(PUZZLE_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}
function saveCustomPuzzles() {
  try {
    localStorage.setItem(PUZZLE_KEY, JSON.stringify(state.customPuzzles));
  } catch (_) {
    /* storage unavailable; custom puzzles won't persist */
  }
}

function allPuzzles() {
  return [...PUZZLES, ...state.customPuzzles];
}
function findPuzzle(id) {
  return allPuzzles().find((p) => p.id === id);
}

// ---- theme -------------------------------------------------------------

function applyTheme(theme) {
  const light = theme === 'light';
  document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  $('#theme-label').textContent = light ? 'Light' : 'Dark';
  $('#theme-toggle').title = light ? 'Switch to dark mode' : 'Switch to light mode';
}

// ---- palette -----------------------------------------------------------

function buildPalette() {
  const groups = $('#palette-groups');
  groups.innerHTML = '';

  for (const catId of Object.keys(CATEGORIES)) {
    const items = COMPONENTS.filter((c) => c.category === catId);
    if (!items.length) continue;
    const cat = CATEGORIES[catId];

    const group = document.createElement('div');
    group.className = 'palette-group';
    group.innerHTML = `<h3 class="palette-group-title"><span class="cat-dot" style="--cat:${cat.color}"></span>${cat.label}</h3>`;
    const list = document.createElement('div');
    list.className = 'palette-items';
    for (const c of items) list.appendChild(makePaletteButton(c));
    group.appendChild(list);
    groups.appendChild(group);
  }

  const catSel = $('#custom-category');
  catSel.innerHTML = '';
  for (const catId of Object.keys(CATEGORIES)) {
    const opt = document.createElement('option');
    opt.value = catId;
    opt.textContent = CATEGORIES[catId].label;
    catSel.appendChild(opt);
  }
}

function makePaletteButton(def) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'palette-item';
  btn.style.setProperty('--cat', categoryColor(def.category));
  btn.dataset.type = def.type;
  btn.innerHTML = `
    <span class="palette-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${def.icon}</svg>
    </span>
    <span class="palette-item-label"></span>`;
  btn.querySelector('.palette-item-label').textContent = def.label;
  if (def.custom) btn.classList.add('is-custom');
  btn.addEventListener('click', () => board.addBlock(def.type));
  return btn;
}

// ---- problems ----------------------------------------------------------

function buildProblemSelect() {
  const sel = $('#problem');
  const current = state.puzzle ? state.puzzle.id : null;
  sel.innerHTML = '';
  for (const p of allPuzzles()) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.custom ? `${p.title} ★` : p.title;
    sel.appendChild(opt);
  }
  const create = document.createElement('option');
  create.value = CREATE_OPTION;
  create.textContent = '➕ Create custom problem…';
  sel.appendChild(create);
  if (current) sel.value = current;
}

function loadPuzzle(id) {
  const puzzle = findPuzzle(id);
  if (!puzzle) return;
  state.puzzle = puzzle;
  state.hintsUsed = 0;
  state.hintsShown = 0;

  board.clear();
  board.setConnectMode(false);
  syncConnectToggle();
  clearCustomTypes();
  state.customSeq = 0;
  buildPalette();

  $('#problem-title').textContent = puzzle.title;
  $('#problem-desc').textContent = puzzle.desc;
  $('#delete-problem-btn').hidden = !puzzle.custom;

  const reqList = $('#requirements-list');
  reqList.innerHTML = '';
  for (const r of puzzle.requirements) {
    const li = document.createElement('li');
    li.textContent = r;
    reqList.appendChild(li);
  }

  $('#hints-list').innerHTML = '';
  $('#hints-panel').hidden = true;
  updateHintCount();

  $('#solve-panel').hidden = true;
  $('#result-modal').hidden = true;

  $('#problem').value = puzzle.id;
  refreshEmptyHint();
}

function deleteActiveProblem() {
  const p = state.puzzle;
  if (!p || !p.custom) return;
  state.customPuzzles = state.customPuzzles.filter((x) => x.id !== p.id);
  saveCustomPuzzles();
  buildProblemSelect();
  loadPuzzle(allPuzzles()[0].id);
}

// ---- hints -------------------------------------------------------------

function updateHintCount() {
  const left = 3 - state.hintsUsed;
  $('#hint-count').textContent = `${left} left`;
  $('#hint-btn').disabled = left <= 0;
}

function revealHint() {
  if (!state.puzzle || state.hintsUsed >= 3) return;
  const text = state.puzzle.hints[state.hintsShown] || 'No further hints.';
  state.hintsUsed += 1;
  state.hintsShown += 1;

  $('#hints-panel').hidden = false;
  const li = document.createElement('li');
  li.textContent = text;
  $('#hints-list').appendChild(li);

  sound.hint();
  updateHintCount();
}

// ---- connect mode ------------------------------------------------------

function syncConnectToggle() {
  const btn = $('#connect-toggle');
  const on = board.connectMode;
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
  $('#connect-banner').hidden = !on;
}

// ---- connection label editor ------------------------------------------

function openLabelEditor(conn) {
  state.labelConnId = conn.id;
  $('#label-input').value = conn.label || '';
  $('#label-modal').hidden = false;
  $('#label-input').focus();
}
function closeLabelEditor() {
  $('#label-modal').hidden = true;
  state.labelConnId = null;
}

// ---- evaluation --------------------------------------------------------

function runEvaluation() {
  if (!state.puzzle) return;
  showResult(evaluate(state.puzzle, board.snapshot(), state.hintsUsed));
}

function showResult(result) {
  const modal = $('#result-modal');
  const ring = $('#score-ring');
  const valueEl = $('#score-value');
  ring.dataset.tier = scoreTier(result.finalScore);

  const list = $('#result-checklist');
  list.innerHTML = '';
  for (const r of result.results) {
    const li = document.createElement('li');
    li.className = r.satisfied ? 'pass' : 'fail';
    li.innerHTML = `<span class="check-mark" aria-hidden="true"></span><span class="check-text"></span>`;
    li.querySelector('.check-text').textContent = r.label;
    list.appendChild(li);
  }

  const note =
    result.hintsUsed > 0
      ? `Raw score ${result.rawScore} · ${result.hintsUsed} hint${result.hintsUsed > 1 ? 's' : ''} used (−${result.penalty})`
      : `Raw score ${result.rawScore} · no hints used`;
  $('#score-note').textContent = `${result.satisfied} of ${result.total} requirements met · ${note}`;

  modal.hidden = false;

  if (prefersReducedMotion()) valueEl.textContent = String(result.finalScore);
  else animateCount(valueEl, result.finalScore, 550);

  if (result.finalScore >= 60) sound.pass();
  else sound.fail();
}

function animateCount(el, target, duration) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(eased * target));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = String(target);
  };
  requestAnimationFrame(step);
}

// ---- solve for me ------------------------------------------------------

const TIER = { entry: 0, edge: 1, compute: 2, cache: 3, storage: 3, messaging: 3 };

async function solveForMe() {
  if (!state.puzzle || state.solving) return;
  const ok = await showConfirm('Solve for me will clear your current board and build one reference solution. Continue?');
  if (!ok) return;

  state.solving = true;
  board.clear(); // also resets pan/zoom so the built layout is in view
  board.setConnectMode(false);
  syncConnectToggle();
  refreshEmptyHint();

  const { steps, explanation } = buildSolution(state.puzzle);
  const rect = $('#canvas').getBoundingClientRect();
  const colWidth = Math.min(170, (rect.width - 60) / 4);
  const rowHeight = 92;
  const tierRows = {};

  const delay = prefersReducedMotion() ? 0 : 200;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  for (const step of steps) {
    if (step.kind === 'place') {
      const tier = TIER[categoryOf(step.type)] ?? 2;
      const row = tierRows[tier] || 0;
      tierRows[tier] = row + 1;
      board.addBlock(step.type, 30 + tier * colWidth, 30 + row * rowHeight);
    } else if (step.kind === 'connect') {
      const a = board.findBlockByType(step.from);
      const b = board.findBlockByType(step.to);
      if (a && b) board.connectBlocks(a.id, b.id);
    }
    if (delay) await wait(delay);
  }

  showSolveExplanation(explanation);
  refreshEmptyHint();
  state.solving = false;
}

function categoryOf(type) {
  const def = getComponent(type) || COMPONENTS.find((c) => c.type === type);
  return def ? def.category : 'compute';
}

function showSolveExplanation({ components, connections }) {
  const fill = (sel, items) => {
    const ul = $(sel);
    ul.innerHTML = '';
    for (const c of items) {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    }
  };
  fill('#solve-components', components);
  fill('#solve-connections', connections);
  $('#solve-panel').hidden = false;
}

// ---- confirm dialog ----------------------------------------------------

let confirmResolver = null;
function showConfirm(text) {
  $('#confirm-text').textContent = text;
  $('#confirm-modal').hidden = false;
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}
function resolveConfirm(value) {
  $('#confirm-modal').hidden = true;
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
}

// ---- custom components (palette) --------------------------------------

function addCustomComponent(label, category) {
  const clean = label.trim();
  if (!clean) return;
  const type = `custom:${++state.customSeq}`;
  const def = registerCustom(type, clean, category);
  const groups = $('#palette-groups');
  const groupList = [...groups.querySelectorAll('.palette-group')];
  const target =
    groupList.find((g) => g.querySelector('.palette-group-title').textContent.trim() === CATEGORIES[category].label) ||
    groupList[groupList.length - 1];
  target.querySelector('.palette-items').appendChild(makePaletteButton(def));
}

// ---- custom problem builder -------------------------------------------

const TYPE_OPTIONS = COMPONENTS.map((c) => `<option value="${c.type}">${c.label}</option>`).join('');

function componentReqRow() {
  const row = document.createElement('div');
  row.className = 'req-row';
  row.innerHTML = `
    <div class="req-field">
      <span>Acceptable types (any one counts)</span>
      <select multiple class="text-input req-select" data-role="ids">${TYPE_OPTIONS}</select>
    </div>
    <div class="req-field req-min-field">
      <span>Min</span>
      <input type="number" min="1" value="1" class="text-input req-min" data-role="min" />
    </div>
    <button type="button" class="req-remove" aria-label="Remove requirement">×</button>`;
  row.querySelector('.req-remove').addEventListener('click', () => row.remove());
  return row;
}

function connectionReqRow() {
  const row = document.createElement('div');
  row.className = 'req-row';
  row.innerHTML = `
    <div class="req-field">
      <span>From (any one)</span>
      <select multiple class="text-input req-select" data-role="from">${TYPE_OPTIONS}</select>
    </div>
    <div class="req-field">
      <span>To (any one)</span>
      <select multiple class="text-input req-select" data-role="to">${TYPE_OPTIONS}</select>
    </div>
    <button type="button" class="req-remove" aria-label="Remove requirement">×</button>`;
  row.querySelector('.req-remove').addEventListener('click', () => row.remove());
  return row;
}

function openBuilder() {
  $('#builder-name').value = '';
  $('#builder-desc').value = '';
  $('#component-reqs').innerHTML = '';
  $('#connection-reqs').innerHTML = '';
  $('#component-reqs').appendChild(componentReqRow());
  $('#connection-reqs').appendChild(connectionReqRow());
  document.querySelectorAll('.hint-input').forEach((i) => (i.value = ''));
  $('#builder-error').hidden = true;
  $('#builder-modal').hidden = false;
  $('#builder-name').focus();
}

function selectedValues(sel) {
  return [...sel.selectedOptions].map((o) => o.value);
}

function componentLabel(type) {
  const def = getComponent(type) || COMPONENTS.find((c) => c.type === type);
  return def ? def.label : type;
}

function collectBuilder() {
  const title = $('#builder-name').value.trim();
  const desc = $('#builder-desc').value.trim() || 'A custom system-design problem.';

  const requiredComponents = [];
  for (const row of $('#component-reqs').querySelectorAll('.req-row')) {
    const ids = selectedValues(row.querySelector('[data-role="ids"]'));
    if (!ids.length) continue;
    const min = Math.max(1, parseInt(row.querySelector('[data-role="min"]').value, 10) || 1);
    const joined = ids.map(componentLabel).join(' or ');
    const label = min > 1 ? `At least ${min} of: ${joined}` : `A ${joined}`;
    requiredComponents.push({ ids, min, label });
  }

  const requiredConnections = [];
  for (const row of $('#connection-reqs').querySelectorAll('.req-row')) {
    const from = selectedValues(row.querySelector('[data-role="from"]'));
    const to = selectedValues(row.querySelector('[data-role="to"]'));
    if (!from.length || !to.length) continue;
    const label = `Connect ${from.map(componentLabel).join(' or ')} to ${to.map(componentLabel).join(' or ')}`;
    requiredConnections.push({ from, to, label });
  }

  const defaultHints = [
    'Start from the entry point and trace the request path through the system.',
    'Make sure every requirement has both its components and the connections that link them.',
    'Stuck? Use "Solve for me" to see one valid reference solution.',
  ];
  const hints = [0, 1, 2].map((i) => {
    const v = document.querySelector(`.hint-input[data-hint="${i}"]`).value.trim();
    return v || defaultHints[i];
  });

  const requirements = [...requiredComponents.map((r) => r.label), ...requiredConnections.map((r) => r.label)];

  return {
    id: `custom:${Date.now()}`,
    custom: true,
    title,
    desc,
    requirements,
    hints,
    requiredComponents,
    requiredConnections,
  };
}

function submitBuilder(e) {
  e.preventDefault();
  const puzzle = collectBuilder();
  const err = $('#builder-error');
  if (!puzzle.title) {
    err.textContent = 'Give the problem a title.';
    err.hidden = false;
    return;
  }
  if (!puzzle.requiredComponents.length) {
    err.textContent = 'Add at least one component requirement with a type selected.';
    err.hidden = false;
    return;
  }
  state.customPuzzles.push(puzzle);
  saveCustomPuzzles();
  buildProblemSelect();
  $('#builder-modal').hidden = true;
  loadPuzzle(puzzle.id);
}

// ---- audio controls ----------------------------------------------------

function syncMuteButton() {
  const btn = $('#mute-toggle');
  btn.setAttribute('aria-pressed', String(sound.muted));
  btn.classList.toggle('muted', sound.muted);
  $('#mute-label').textContent = sound.muted ? 'Muted' : 'Sound on';
  btn.title = sound.muted ? 'Sound off' : 'Sound on';
}
function syncAmbientButton() {
  const btn = $('#ambient-toggle');
  const on = sound.isDroneOn();
  btn.setAttribute('aria-pressed', String(on));
  btn.classList.toggle('active', on);
  btn.title = on ? 'Ambient drone (on)' : 'Ambient drone (off)';
}

// ---- wiring ------------------------------------------------------------

function wireEvents() {
  $('#problem').addEventListener('change', (e) => {
    if (e.target.value === CREATE_OPTION) {
      e.target.value = state.puzzle ? state.puzzle.id : allPuzzles()[0].id;
      openBuilder();
      return;
    }
    loadPuzzle(e.target.value);
  });

  $('#connect-toggle').addEventListener('click', () => {
    board.setConnectMode(!board.connectMode);
    syncConnectToggle();
  });
  $('#hint-btn').addEventListener('click', revealHint);
  $('#evaluate-btn').addEventListener('click', runEvaluation);
  $('#solve-btn').addEventListener('click', solveForMe);

  $('#clear-btn').addEventListener('click', async () => {
    if (board.blocks.size === 0) return;
    const ok = await showConfirm('Clear the board? This removes every block and connection for this problem.');
    if (ok) {
      board.clear();
      refreshEmptyHint();
    }
  });

  $('#delete-problem-btn').addEventListener('click', async () => {
    const ok = await showConfirm(`Delete "${state.puzzle.title}"? This custom problem will be removed permanently.`);
    if (ok) deleteActiveProblem();
  });

  // Zoom / pan controls.
  $('#zoom-in').addEventListener('click', () => board.zoomByCenter(1.2));
  $('#zoom-out').addEventListener('click', () => board.zoomByCenter(1 / 1.2));
  $('#zoom-reset').addEventListener('click', () => board.resetView());

  // Result modal.
  $('#result-close').addEventListener('click', () => ($('#result-modal').hidden = true));
  $('#result-dismiss').addEventListener('click', () => ($('#result-modal').hidden = true));

  // Solve panel.
  $('#solve-close').addEventListener('click', () => ($('#solve-panel').hidden = true));

  // Confirm modal.
  $('#confirm-ok').addEventListener('click', () => resolveConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => resolveConfirm(false));

  // Connection label editor.
  $('#label-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.labelConnId) board.setConnectionLabel(state.labelConnId, $('#label-input').value);
    closeLabelEditor();
  });
  $('#label-clear').addEventListener('click', () => {
    if (state.labelConnId) board.setConnectionLabel(state.labelConnId, '');
    closeLabelEditor();
  });

  // Requirements collapse.
  $('#requirements-toggle').addEventListener('click', (e) => {
    const list = $('#requirements-list');
    const desc = $('#problem-desc');
    const open = list.hidden;
    list.hidden = !open;
    desc.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });

  // Custom component form.
  $('#new-component-btn').addEventListener('click', () => {
    const form = $('#custom-form');
    form.hidden = !form.hidden;
    if (!form.hidden) $('#custom-label').focus();
  });
  $('#custom-cancel').addEventListener('click', () => {
    $('#custom-form').hidden = true;
    $('#custom-label').value = '';
  });
  $('#custom-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addCustomComponent($('#custom-label').value, $('#custom-category').value);
    $('#custom-label').value = '';
    $('#custom-form').hidden = true;
  });

  // Builder modal.
  $('#add-component-req').addEventListener('click', () => $('#component-reqs').appendChild(componentReqRow()));
  $('#add-connection-req').addEventListener('click', () => $('#connection-reqs').appendChild(connectionReqRow()));
  $('#builder-form').addEventListener('submit', submitBuilder);
  $('#builder-cancel').addEventListener('click', () => ($('#builder-modal').hidden = true));
  $('#builder-close').addEventListener('click', () => ($('#builder-modal').hidden = true));

  // Theme toggle.
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    updatePref('theme', next);
  });

  // Audio.
  $('#mute-toggle').addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    syncMuteButton();
    updatePref('muted', sound.muted);
  });
  $('#ambient-toggle').addEventListener('click', () => {
    sound.toggleDrone();
    syncAmbientButton();
  });

  // Escape closes the topmost transient layer.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#label-modal').hidden) return closeLabelEditor();
    if (!$('#builder-modal').hidden) return ($('#builder-modal').hidden = true);
    if (!$('#confirm-modal').hidden) return resolveConfirm(false);
    if (!$('#result-modal').hidden) return ($('#result-modal').hidden = true);
    if (!$('#solve-panel').hidden) $('#solve-panel').hidden = true;
  });
}

// ---- init --------------------------------------------------------------

function init() {
  const prefs = loadPrefs();
  applyTheme(prefs.theme === 'light' ? 'light' : 'dark');
  if (prefs.muted) sound.setMuted(true);
  state.customPuzzles = loadCustomPuzzles();

  buildProblemSelect();
  buildPalette();
  wireEvents();
  syncMuteButton();
  syncAmbientButton();
  syncConnectToggle();

  loadPuzzle(allPuzzles()[0].id);
}

init();
