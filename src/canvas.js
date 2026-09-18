// Canvas / rendering logic for Patchboard.
//
// Blocks are absolutely-positioned DOM elements living inside a transformed
// "world" layer, so the whole board can be panned (drag empty space) and zoomed
// (buttons or wheel). Connections are drawn in an SVG overlay that shares the
// world coordinate space, as dashed "marching ants" lines with a directional
// arrowhead and an optional text label.
//
// Clicking a connection SELECTS it (it does not delete). A small floating
// toolbar then appears at the line's midpoint with a delete (×) button and a
// label (✎) button. Selection lives in screen space so its controls stay a
// constant size regardless of zoom.

import { getComponent, categoryColor } from './data/components.js';

let BLOCK_SEQ = 0;
let CONN_SEQ = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

export class Board {
  constructor(canvasEl, hooks = {}) {
    this.canvas = canvasEl; // the fixed viewport
    this.hooks = hooks; // onPlace,onConnect,onDeleteBlock,onDeleteConnection,onSelectConnection,onEditLabel

    this.blocks = new Map(); // id -> { id, type, x, y, el }
    this.connections = new Map(); // id -> { id, a, b, group, line, hit, labelEl, labelBg, label }

    this.connectMode = false;
    this.pendingSource = null;
    this.selectedConn = null;
    this._cascade = 0;

    // View transform (world -> screen): screen = world * zoom + pan.
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.minZoom = 0.4;
    this.maxZoom = 2.5;

    // World layer holds blocks + the connection SVG and carries the transform.
    this.world = document.createElement('div');
    this.world.className = 'world';
    this.canvas.appendChild(this.world);

    const NS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('conn-layer');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.innerHTML = `
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="context-stroke"></path>
        </marker>
      </defs>`;
    this.world.appendChild(this.svg);

    // Screen-space overlay for the selected-connection toolbar.
    this.overlay = document.createElement('div');
    this.overlay.className = 'canvas-overlay';
    this.canvas.appendChild(this.overlay);

    this.connToolbar = document.createElement('div');
    this.connToolbar.className = 'conn-toolbar';
    this.connToolbar.hidden = true;
    this.connToolbar.innerHTML = `
      <button type="button" class="conn-tool-btn" data-act="label" title="Edit label" aria-label="Edit label">✎</button>
      <button type="button" class="conn-tool-btn danger" data-act="delete" title="Delete connection" aria-label="Delete connection">×</button>`;
    this.overlay.appendChild(this.connToolbar);
    this.connToolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.connToolbar.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (this.selectedConn) this._destroyConnection(this.selectedConn);
    });
    this.connToolbar.querySelector('[data-act="label"]').addEventListener('click', () => {
      const conn = this.connections.get(this.selectedConn);
      if (conn && this.hooks.onEditLabel) this.hooks.onEditLabel(conn);
    });

    this._applyTransform();
    this._wireViewport();

    this._onResize = () => {
      this.redraw();
      this._positionToolbar();
    };
    window.addEventListener('resize', this._onResize);
  }

  // ---- coordinate transforms ------------------------------------------

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.panX) / this.zoom,
      y: (clientY - rect.top - this.panY) / this.zoom,
    };
  }

  // World point -> pixels relative to the canvas top-left.
  worldToScreen(x, y) {
    return { x: x * this.zoom + this.panX, y: y * this.zoom + this.panY };
  }

  _applyTransform() {
    this.world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    // Pan + zoom the blueprint grid along with the content.
    const g = 26 * this.zoom;
    const G = 130 * this.zoom;
    this.canvas.style.backgroundSize = `${g}px ${g}px, ${g}px ${g}px, ${G}px ${G}px, ${G}px ${G}px`;
    this.canvas.style.backgroundPosition = `${this.panX}px ${this.panY}px`;
  }

  // ---- viewport: pan + zoom -------------------------------------------

  _wireViewport() {
    // Pan by dragging empty canvas/world background (not a block or line).
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.block') || e.target.closest('.conn-toolbar')) return;
      if (e.target.classList && e.target.classList.contains('conn-hit')) return;
      // A background click also deselects any selected connection.
      this._deselectConnection();
      this._startPan(e);
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        this.zoomAt(this.zoom * factor, e.clientX, e.clientY);
      },
      { passive: false },
    );
  }

  _startPan(e) {
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = this.panX;
    const originY = this.panY;
    this.canvas.classList.add('panning');
    this.canvas.setPointerCapture(e.pointerId);

    const move = (ev) => {
      this.panX = originX + (ev.clientX - startX);
      this.panY = originY + (ev.clientY - startY);
      this._applyTransform();
      this._positionToolbar();
    };
    const up = (ev) => {
      this.canvas.classList.remove('panning');
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch (_) {
        /* already released */
      }
      this.canvas.removeEventListener('pointermove', move);
      this.canvas.removeEventListener('pointerup', up);
    };
    this.canvas.addEventListener('pointermove', move);
    this.canvas.addEventListener('pointerup', up);
  }

  // Zoom keeping the world point under (clientX, clientY) fixed on screen.
  zoomAt(newZoom, clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = (sx - this.panX) / this.zoom;
    const wy = (sy - this.panY) / this.zoom;
    this.zoom = clamp(newZoom, this.minZoom, this.maxZoom);
    this.panX = sx - wx * this.zoom;
    this.panY = sy - wy * this.zoom;
    this._applyTransform();
    this._positionToolbar();
  }

  // Zoom around the viewport center (used by the +/- buttons).
  zoomByCenter(factor) {
    const rect = this.canvas.getBoundingClientRect();
    this.zoomAt(this.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
    this._positionToolbar();
  }

  // ---- placement -------------------------------------------------------

  // World point near the current viewport center, cascaded so successive
  // palette drops don't stack.
  _placementPoint() {
    const rect = this.canvas.getBoundingClientRect();
    const c = this.screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const step = 26;
    const off = (this._cascade % 8) * step - 90;
    this._cascade++;
    return { x: c.x + off, y: c.y + off };
  }

  addBlock(type, x, y, { animate = true } = {}) {
    const def = getComponent(type);
    if (!def) return null;

    const id = `b${++BLOCK_SEQ}`;
    if (x == null || y == null) {
      const p = this._placementPoint();
      x = p.x;
      y = p.y;
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

    this.world.appendChild(el);
    const block = { id, type, x, y, el };
    this.blocks.set(id, block);

    this._wireBlock(block);
    if (this.hooks.onPlace) this.hooks.onPlace(block);
    return block;
  }

  _wireBlock(block) {
    const { el } = block;

    el.querySelector('.block-del').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeBlock(block.id);
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.block-del')) return;
      e.stopPropagation(); // never start a pan from a block
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

    const move = (ev) => {
      // Screen deltas are scaled by zoom to get world deltas.
      block.x = originX + (ev.clientX - startX) / this.zoom;
      block.y = originY + (ev.clientY - startY) / this.zoom;
      el.style.left = `${block.x}px`;
      el.style.top = `${block.y}px`;
      this._redrawFor(block.id);
    };
    const up = (ev) => {
      el.classList.remove('dragging');
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (_) {
        /* already released */
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

    for (const conn of [...this.connections.values()]) {
      if (conn.a === id || conn.b === id) this._destroyConnection(conn.id, { silent: true });
    }
    if (this.pendingSource === id) this._clearPending();

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

  connectBlocks(a, b, label = '') {
    if (a === b || !this.blocks.has(a) || !this.blocks.has(b)) return null;
    for (const c of this.connections.values()) {
      if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) return null;
    }

    const id = `c${++CONN_SEQ}`;
    const NS = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(NS, 'g');
    group.classList.add('conn');

    const hit = document.createElementNS(NS, 'line');
    hit.classList.add('conn-hit');

    const line = document.createElementNS(NS, 'line');
    line.classList.add('conn-line');
    line.setAttribute('marker-end', 'url(#arrow)');

    const labelBg = document.createElementNS(NS, 'rect');
    labelBg.classList.add('conn-label-bg');
    const labelEl = document.createElementNS(NS, 'text');
    labelEl.classList.add('conn-label');
    labelEl.setAttribute('text-anchor', 'middle');
    labelEl.setAttribute('dominant-baseline', 'middle');

    group.appendChild(hit);
    group.appendChild(line);
    group.appendChild(labelBg);
    group.appendChild(labelEl);
    this.svg.appendChild(group);

    const conn = { id, a, b, group, line, hit, labelEl, labelBg, label: '' };
    this.connections.set(id, conn);

    const highlight = (on) => {
      if (this.selectedConn !== id) group.classList.toggle('conn-hover', on);
    };
    group.addEventListener('pointerenter', () => highlight(true));
    group.addEventListener('pointerleave', () => highlight(false));
    group.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectConnection(id);
    });

    if (label) this.setConnectionLabel(id, label);
    this._drawConnection(conn);
    if (this.hooks.onConnect) this.hooks.onConnect(conn);
    return conn;
  }

  _selectConnection(id) {
    if (this.selectedConn === id) return;
    this._deselectConnection();
    const conn = this.connections.get(id);
    if (!conn) return;
    this.selectedConn = id;
    conn.group.classList.remove('conn-hover');
    conn.group.classList.add('selected');
    this.connToolbar.hidden = false;
    this._positionToolbar();
    if (this.hooks.onSelectConnection) this.hooks.onSelectConnection(conn);
  }

  _deselectConnection() {
    if (this.selectedConn == null) return;
    const conn = this.connections.get(this.selectedConn);
    if (conn) conn.group.classList.remove('selected');
    this.selectedConn = null;
    this.connToolbar.hidden = true;
  }

  _positionToolbar() {
    if (this.selectedConn == null) return;
    const conn = this.connections.get(this.selectedConn);
    if (!conn) return;
    const a = this.blocks.get(conn.a);
    const b = this.blocks.get(conn.b);
    if (!a || !b) return;
    const midWorldX = (a.x + a.el.offsetWidth / 2 + b.x + b.el.offsetWidth / 2) / 2;
    const midWorldY = (a.y + a.el.offsetHeight / 2 + b.y + b.el.offsetHeight / 2) / 2;
    const p = this.worldToScreen(midWorldX, midWorldY);
    this.connToolbar.style.left = `${p.x}px`;
    this.connToolbar.style.top = `${p.y}px`;
  }

  setConnectionLabel(id, text) {
    const conn = this.connections.get(id);
    if (!conn) return;
    conn.label = (text || '').trim();
    conn.labelEl.textContent = conn.label;
    this._drawConnection(conn);
  }

  _destroyConnection(id, { silent = false } = {}) {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (this.selectedConn === id) this._deselectConnection();
    conn.group.remove();
    this.connections.delete(id);
    if (!silent && this.hooks.onDeleteConnection) this.hooks.onDeleteConnection(conn);
  }

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

    // Label at the midpoint, with a background rect sized to the text.
    const mx = (pa.x + pb.x) / 2;
    const my = (pa.y + pb.y) / 2;
    if (conn.label) {
      conn.labelEl.setAttribute('x', mx);
      conn.labelEl.setAttribute('y', my);
      conn.labelEl.style.display = '';
      conn.labelBg.style.display = '';
      // Size the background after the text has a box.
      requestAnimationFrame(() => {
        if (!conn.label) return;
        const bb = conn.labelEl.getBBox();
        const padX = 6;
        const padY = 3;
        conn.labelBg.setAttribute('x', bb.x - padX);
        conn.labelBg.setAttribute('y', bb.y - padY);
        conn.labelBg.setAttribute('width', bb.width + padX * 2);
        conn.labelBg.setAttribute('height', bb.height + padY * 2);
        conn.labelBg.setAttribute('rx', 4);
      });
    } else {
      conn.labelEl.style.display = 'none';
      conn.labelBg.style.display = 'none';
    }
  }

  _redrawFor(blockId) {
    for (const conn of this.connections.values()) {
      if (conn.a === blockId || conn.b === blockId) this._drawConnection(conn);
    }
    if (this.selectedConn != null) {
      const c = this.connections.get(this.selectedConn);
      if (c && (c.a === blockId || c.b === blockId)) this._positionToolbar();
    }
  }

  redraw() {
    for (const conn of this.connections.values()) this._drawConnection(conn);
  }

  // ---- bulk ------------------------------------------------------------

  clear() {
    this._clearPending();
    this._deselectConnection();
    for (const conn of this.connections.values()) conn.group.remove();
    this.connections.clear();
    for (const block of this.blocks.values()) block.el.remove();
    this.blocks.clear();
    this._cascade = 0;
    this.resetView();
  }

  snapshot() {
    const placedTypes = [...this.blocks.values()].map((b) => b.type);
    const connectionPairs = [...this.connections.values()].map((c) => ({
      from: this.blocks.get(c.a).type,
      to: this.blocks.get(c.b).type,
    }));
    return { placedTypes, connectionPairs, blockCount: this.blocks.size };
  }

  findBlockByType(type) {
    for (const block of this.blocks.values()) {
      if (block.type === type) return block;
    }
    return null;
  }
}
