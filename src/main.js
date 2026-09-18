// Application entry point for Patchboard.
//
// Wires the data (components, puzzles), the canvas (Board), the evaluator, and
// the sound engine to the DOM. Keeps no game logic of its own beyond
// orchestration: scoring lives in evaluator.js, rendering in canvas.js, audio in
// sound.js, content in data/.

import { COMPONENTS, CATEGORIES, categoryColor, registerCustom, clearCustomTypes } from './data/components.js';
import { PUZZLES, getPuzzle } from './data/puzzles.js';
import { Board } from './canvas.js';
import { evaluate, scoreTier, buildSolution } from './evaluator.js';
import { SoundEngine } from './sound.js';

const $ = (sel) => document.querySelector(sel);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const STORE_KEY = 'patchboard:prefs';

const sound = new SoundEngine();

// ---- state -------------------------------------------------------------

const state = {
  puzzle: null,
  hintsUsed: 0,
  hintsShown: 0,
  customSeq: 0,
  solving: false,
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
    /* storage unavailable (private mode); preferences just won't persist */
  }
}

// ---- palette -----------------------------------------------------------

function buildPalette() {
  const groups = $('#palette-groups');
  groups.innerHTML = '';

  // One group per category, in category declaration order.
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

  // Populate the custom-component category select.
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
  sel.innerHTML = '';
  for (const p of PUZZLES) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => loadPuzzle(sel.value));
}

function loadPuzzle(id) {
  const puzzle = getPuzzle(id);
  if (!puzzle) return;
  state.puzzle = puzzle;
  state.hintsUsed = 0;
  state.hintsShown = 0;

  board.clear();
  board.setConnectMode(false);
  syncConnectToggle();
  clearCustomTypes();
  state.customSeq = 0;
  buildPalette(); // rebuild so removed custom types drop out of the palette

  $('#problem-title').textContent = puzzle.title;
  $('#problem-desc').textContent = puzzle.desc;

  const reqList = $('#requirements-list');
  reqList.innerHTML = '';
  for (const r of puzzle.requirements) {
    const li = document.createElement('li');
    li.textContent = r;
    reqList.appendChild(li);
  }

  // Reset hints UI.
  $('#hints-list').innerHTML = '';
  $('#hints-panel').hidden = true;
  updateHintCount();

  // Close any open panels.
  $('#solve-panel').hidden = true;
  $('#result-modal').hidden = true;

  refreshEmptyHint();
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

  const panel = $('#hints-panel');
  panel.hidden = false;
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

// ---- evaluation --------------------------------------------------------

function runEvaluation() {
  if (!state.puzzle) return;
  const result = evaluate(state.puzzle, board.snapshot(), state.hintsUsed);
  showResult(result);
}

function showResult(result) {
  const modal = $('#result-modal');
  const ring = $('#score-ring');
  const valueEl = $('#score-value');
  const tier = scoreTier(result.finalScore);

  ring.dataset.tier = tier;

  // Checklist.
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

  // Count-up animation (respect reduced motion).
  if (prefersReducedMotion()) {
    valueEl.textContent = String(result.finalScore);
  } else {
    animateCount(valueEl, result.finalScore, 550);
  }

  // Distinct pass/fail resolution (60+ counts as passing).
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

// Layout columns keyed by a coarse tier so the auto-built solution reads
// left-to-right instead of piling up.
const TIER = { entry: 0, edge: 1, compute: 2, cache: 3, storage: 3, messaging: 3 };

async function solveForMe() {
  if (!state.puzzle || state.solving) return;
  const ok = await showConfirm('Solve for me will clear your current board and build one reference solution. Continue?');
  if (!ok) return;

  state.solving = true;
  board.clear();
  board.setConnectMode(false);
  syncConnectToggle();
  refreshEmptyHint();

  const { steps, explanation } = buildSolution(state.puzzle);
  const rect = $('#canvas').getBoundingClientRect();
  const colWidth = Math.min(170, (rect.width - 60) / 4);
  const rowHeight = 92;
  const tierRows = {}; // tier -> next row index

  const delay = prefersReducedMotion() ? 0 : 200;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  for (const step of steps) {
    if (step.kind === 'place') {
      const tier = TIER[categoryOf(step.type)] ?? 2;
      const row = tierRows[tier] || 0;
      tierRows[tier] = row + 1;
      const x = 30 + tier * colWidth;
      const y = 30 + row * rowHeight;
      board.addBlock(step.type, x, y);
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
  const defs = COMPONENTS.find((c) => c.type === type);
  return defs ? defs.category : 'compute';
}

function showSolveExplanation({ components, connections }) {
  const compList = $('#solve-components');
  const connList = $('#solve-connections');
  compList.innerHTML = '';
  connList.innerHTML = '';
  for (const c of components) {
    const li = document.createElement('li');
    li.textContent = c;
    compList.appendChild(li);
  }
  for (const c of connections) {
    const li = document.createElement('li');
    li.textContent = c;
    connList.appendChild(li);
  }
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

// ---- custom components -------------------------------------------------

function addCustomComponent(label, category) {
  const clean = label.trim();
  if (!clean) return;
  const type = `custom:${++state.customSeq}`;
  const def = registerCustom(type, clean, category);
  // Append a palette button to the matching category group (or a fallback).
  const groups = $('#palette-groups');
  const groupTitles = [...groups.querySelectorAll('.palette-group')];
  const targetGroup =
    groupTitles.find((g) => g.querySelector('.palette-group-title').textContent.trim() === CATEGORIES[category].label) ||
    groupTitles[groupTitles.length - 1];
  targetGroup.querySelector('.palette-items').appendChild(makePaletteButton(def));
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

  // Result modal.
  $('#result-close').addEventListener('click', () => ($('#result-modal').hidden = true));
  $('#result-dismiss').addEventListener('click', () => ($('#result-modal').hidden = true));

  // Solve panel.
  $('#solve-close').addEventListener('click', () => ($('#solve-panel').hidden = true));

  // Confirm modal.
  $('#confirm-ok').addEventListener('click', () => resolveConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => resolveConfirm(false));

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

  // Audio.
  $('#mute-toggle').addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    syncMuteButton();
    const prefs = loadPrefs();
    prefs.muted = sound.muted;
    savePrefs(prefs);
  });
  $('#ambient-toggle').addEventListener('click', () => {
    sound.toggleDrone();
    syncAmbientButton();
  });

  // Close modals with Escape.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#confirm-modal').hidden) resolveConfirm(false);
    if (!$('#result-modal').hidden) $('#result-modal').hidden = true;
    if (!$('#solve-panel').hidden) $('#solve-panel').hidden = true;
  });
}

// ---- init --------------------------------------------------------------

function init() {
  const prefs = loadPrefs();
  if (prefs.muted) sound.setMuted(true);

  buildProblemSelect();
  buildPalette();
  wireEvents();
  syncMuteButton();
  syncAmbientButton();
  syncConnectToggle();

  loadPuzzle(PUZZLES[0].id);
  $('#problem').value = PUZZLES[0].id;
}

init();
