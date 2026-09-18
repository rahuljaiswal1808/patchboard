// Canvas / rendering logic for Patchboard.
//
// Blocks are absolutely-positioned DOM elements (bordered rectangles with a
// colored left edge). Connections are drawn in a single SVG overlay that shares
// the canvas coordinate space, as dashed "marching ants" lines with a
// directional arrowhead. The class owns all placement, dragging, connect-mode
// wiring, and deletion; it emits hooks so the app layer can play sounds and
// react without the canvas knowing about audio or UI.

import { getComponent, categoryColor } from './data/components.js';

let BLOCK_SEQ = 0;
let CONN_SEQ = 0;

export class Board {
  constructor(canvasEl, hooks = {}) {
    this.canvas = canvasEl;
    this.hooks = hooks; // { onPlace, onConnect, onDeleteBlock, onDeleteConnection }

    this.blocks = new Map(); // id -> { id, type, x, y, el }
    this.connections = new Map(); // id -> { id, a, b, group, line, hit }

    this.connectMode = false;
    this.pendingSource = null; // block id awaiting a second click, in connect mode
    this._cascade = 0; // offsets successive palette drops so they don't stack

    // SVG overlay for connections, sized to the canvas via CSS (100%/100%).
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('conn-layer');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.innerHTML = `
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"></path>
        </marker>
      </defs>`;
    this.canvas.appendChild(this.svg);

    this._onResize = () => this.redraw();
    window.addEventListener('resize', this._onResize);
  }

  // ---- placement -------------------------------------------------------

  // Add a block of `type`. If x/y are omitted, cascades near the top-left so
  // successive palette drops don't land on top of each other.
  addBlock(type, x, y, { animate = true } = {}) {
    const def = getComponent(type);
    if (!def) return null;

    const id = `b${++BLOCK_SEQ}`;
    if (x == null || y == null) {
      const step = 26;
      x = 40 + (this._cascade % 8) * step;
      y = 40 + (this._cascade % 8) * step;
      this._cascade++;
    }

    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.id = id;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--cat', categoryColor(def.category));
    el.innerHTML = `
      <span class="block-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${def.icon}</svg>
      </span>
      <span class="block-label"></span>
      <button class="block-del" title="Delete block" aria-label="Delete block">×</button>`;
    el.querySelector('.block-label').textContent = def.label;
    if (def.custom) el.classList.add('is-custom');
    if (animate) el.classList.add('pop-in');

    this.canvas.appendChild(el);
    const block = { id, type, x, y, el };
    this.blocks.set(id, block);

    this._wireBlock(block);
    if (this.hooks.onPlace) this.hooks.onPlace(block);
    return block;
  }

  _wireBlock(block) {
    const { el } = block;

    // Delete button.
    el.querySelector('.block-del').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeBlock(block.id);
    });

    // Click / drag behaviour depends on connect mode.
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.block-del')) return;
      if (this.connectMode) {
        e.preventDefault();
        this._handleConnectClick(block);
        return;
      }
      this._startDrag(block, e);
    });
  }

  _startDrag(block, e) {
    const { el } = block;
    el.classList.add('dragging');
    el.setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;
    const originX = block.x;
    const originY = block.y;

    const rect = this.canvas.getBoundingClientRect();
    const maxX = rect.width - el.offsetWidth;
    const maxY = rect.height - el.offsetHeight;

    const move = (ev) => {
      let nx = originX + (ev.clientX - startX);
      let ny = originY + (ev.clientY - startY);
      nx = Math.max(0, Math.min(nx, maxX));
      ny = Math.max(0, Math.min(ny, maxY));
      block.x = nx;
      block.y = ny;
      el.style.left = `${nx}px`;
      el.style.top = `${ny}px`;
      this._redrawFor(block.id);
    };
    const up = (ev) => {
      el.classList.remove('dragging');
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (_) {
        /* pointer already released */
      }
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  removeBlock(id) {
    const block = this.blocks.get(id);
    if (!block) return;

    // Remove any connections touching this block.
    for (const conn of [...this.connections.values()]) {
      if (conn.a === id || conn.b === id) this._destroyConnection(conn.id, { silent: true });
    }

    if (this.pendingSource === id) this._clearPending();

    // Shake, then fade, then remove (distinct from placement's pop-in).
    block.el.classList.remove('pop-in');
    block.el.classList.add('removing');
    const finish = () => {
      block.el.remove();
      this.blocks.delete(id);
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) finish();
    else block.el.addEventListener('animationend', finish, { once: true });

    if (this.hooks.onDeleteBlock) this.hooks.onDeleteBlock(block);
  }

  // ---- connections -----------------------------------------------------

  setConnectMode(on) {
    this.connectMode = on;
    this.canvas.classList.toggle('connect-mode', on);
    if (!on) this._clearPending();
  }

  _handleConnectClick(block) {
    if (this.pendingSource == null) {
      this.pendingSource = block.id;
      block.el.classList.add('conn-source');
      return;
    }
    if (this.pendingSource === block.id) {
      // Clicking the same block again cancels the pending connection.
      this._clearPending();
      return;
    }
    const a = this.pendingSource;
    const b = block.id;
    this._clearPending();
    this.connectBlocks(a, b);
  }

  _clearPending() {
    if (this.pendingSource != null) {
      const src = this.blocks.get(this.pendingSource);
      if (src) src.el.classList.remove('conn-source');
    }
    this.pendingSource = null;
  }

  // Create a directed connection a -> b. Returns the connection, or null if it
  // already exists (same unordered pair) or either block is missing.
  connectBlocks(a, b) {
    if (a === b || !this.blocks.has(a) || !this.blocks.has(b)) return null;
    for (const c of this.connections.values()) {
      if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) return null;
    }

    const id = `c${++CONN_SEQ}`;
    const NS = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(NS, 'g');
    group.classList.add('conn');

    // Wide, transparent line for an easy hover/click target.
    const hit = document.createElementNS(NS, 'line');
    hit.classList.add('conn-hit');

    // Visible dashed, animated line with an arrowhead at the target end.
    const line = document.createElementNS(NS, 'line');
    line.classList.add('conn-line');
    line.setAttribute('marker-end', 'url(#arrow)');

    group.appendChild(hit);
    group.appendChild(line);
    this.svg.appendChild(group);

    const conn = { id, a, b, group, line, hit };
    this.connections.set(id, conn);

    const highlight = (on) => group.classList.toggle('conn-hover', on);
    group.addEventListener('pointerenter', () => highlight(true));
    group.addEventListener('pointerleave', () => highlight(false));
    group.addEventListener('click', () => this._destroyConnection(id));

    this._drawConnection(conn);
    if (this.hooks.onConnect) this.hooks.onConnect(conn);
    return conn;
  }

  _destroyConnection(id, { silent = false } = {}) {
    const conn = this.connections.get(id);
    if (!conn) return;
    conn.group.remove();
    this.connections.delete(id);
    if (!silent && this.hooks.onDeleteConnection) this.hooks.onDeleteConnection(conn);
  }

  // Compute the point on a block's border facing a given external point, so the
  // line starts/ends at the block edge and the arrowhead sits on the border.
  _borderPoint(block, towardX, towardY) {
    const el = block.el;
    const cx = block.x + el.offsetWidth / 2;
    const cy = block.y + el.offsetHeight / 2;
    const hw = el.offsetWidth / 2;
    const hh = el.offsetHeight / 2;
    const dx = towardX - cx;
    const dy = towardY - cy;
    if (dx === 0 && dy === 0) return { cx, cy, x: cx, y: cy };
    const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    return { cx, cy, x: cx + dx * t, y: cy + dy * t };
  }

  _drawConnection(conn) {
    const a = this.blocks.get(conn.a);
    const b = this.blocks.get(conn.b);
    if (!a || !b) return;
    const ac = { x: a.x + a.el.offsetWidth / 2, y: a.y + a.el.offsetHeight / 2 };
    const bc = { x: b.x + b.el.offsetWidth / 2, y: b.y + b.el.offsetHeight / 2 };
    const pa = this._borderPoint(a, bc.x, bc.y);
    const pb = this._borderPoint(b, ac.x, ac.y);
    for (const seg of [conn.line, conn.hit]) {
      seg.setAttribute('x1', pa.x);
      seg.setAttribute('y1', pa.y);
      seg.setAttribute('x2', pb.x);
      seg.setAttribute('y2', pb.y);
    }
  }

  _redrawFor(blockId) {
    for (const conn of this.connections.values()) {
      if (conn.a === blockId || conn.b === blockId) this._drawConnection(conn);
    }
  }

  redraw() {
    for (const conn of this.connections.values()) this._drawConnection(conn);
  }

  // ---- bulk ------------------------------------------------------------

  // Remove everything from the board immediately (no per-item animation), used
  // when switching problems or before Solve-for-me builds a fresh board.
  clear() {
    this._clearPending();
    for (const conn of this.connections.values()) conn.group.remove();
    this.connections.clear();
    for (const block of this.blocks.values()) block.el.remove();
    this.blocks.clear();
    this._cascade = 0;
  }

  // Snapshot used by the evaluator: placed types and the type pairs they wire.
  snapshot() {
    const placedTypes = [...this.blocks.values()].map((b) => b.type);
    const connectionPairs = [...this.connections.values()].map((c) => ({
      from: this.blocks.get(c.a).type,
      to: this.blocks.get(c.b).type,
    }));
    return { placedTypes, connectionPairs, blockCount: this.blocks.size };
  }

  // Find one existing block of `type`, or null.
  findBlockByType(type) {
    for (const block of this.blocks.values()) {
      if (block.type === type) return block;
    }
    return null;
  }
}
