/**
 * schematic.js — схемный редактор на SVG.
 *
 * Умеет: ставить детали из палитры, таскать их мышью, соединять выводы
 * проводами с автоматической ортогональной трассировкой, выделять и
 * удалять, масштабировать колесом и панорамировать перетаскиванием фона.
 * Состояние сериализуется в JSON (файл .robosim) без DOM-мусора.
 */

import { PARTS, pinWorld, allPins, REF_PREFIX } from './parts.js';

const snap = (v) => Math.round(v / 5) * 5;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Schematic {
  constructor({ svg, onChange }) {
    this.svg = svg;
    this.onChange = onChange || (() => {});
    this.parts = [];
    this.wires = [];
    this.seq = 1;
    this.view = { x: 0, y: 0, s: 1.45 };
    this.selected = null;         // {kind:'part'|'wire', id}
    this.showLabels = loadLabelPref();   // подписи элементов под деталями
    this.pending = null;          // {compId, pin}
    this.drag = null;
    this.pan = null;
    this.moved = false;

    this.layerWires = svg.querySelector('#wiresLayer');
    this.layerParts = svg.querySelector('#partsLayer');
    this.layerPins = svg.querySelector('#pinsLayer');
    this.layerPending = svg.querySelector('#pendingLayer');
    this.world = svg.querySelector('#world');

    this._bind();
    this.render();
  }

  // --------------------------------------------------------------- данные ----
  addPart(type, x, y, props = {}) {
    const def = PARTS[type];
    if (!def) return null;
    const part = {
      id: `p${this.seq++}`, type, x: snap(x), y: snap(y),
      props: { ...this.defaultProps(type), ...props },
      __def: def,
    };
    this.parts.push(part);
    this.selected = { kind: 'part', id: part.id };
    this.render();
    this.onChange();
    return part;
  }

  defaultProps(type) {
    const def = PARTS[type];
    if (def?.board) return { lang: def.spec?.defaultLang || 'cpp', code: '' };
    if (type === 'resistor') return { value: 220 };
    if (type === 'led') return { color: '#ff5544' };
    if (type === 'pot') return { value: 0.5, ohms: 10000 };
    if (type === 'button') return { pressed: false };
    return {};
  }

  part(id) { return this.parts.find((p) => p.id === id); }

  removeSelected() {
    if (!this.selected) return;
    if (this.selected.kind === 'part') {
      const id = this.selected.id;
      this.parts = this.parts.filter((p) => p.id !== id);
      this.wires = this.wires.filter((w) => w.a.compId !== id && w.b.compId !== id);
    } else {
      this.wires = this.wires.filter((w) => w.id !== this.selected.id);
    }
    this.selected = null;
    this.render();
    this.onChange();
  }

  clear() {
    this.parts = [];
    this.wires = [];
    this.selected = null;
    this.render();
    this.onChange();
  }

  toJSON() {
    return {
      version: 1,
      parts: this.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, props: { ...p.props } })),
      wires: this.wires.map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
      view: { ...this.view },
    };
  }

  fromJSON(data) {
    if (!data || !Array.isArray(data.parts)) throw new Error('Это не файл схемы');
    this.parts = data.parts.map((p) => ({
      ...p, props: { ...this.defaultProps(p.type), ...(p.props || {}) }, __def: PARTS[p.type],
    })).filter((p) => p.__def);
    this.wires = (data.wires || []).map((w, i) => ({ ...w, id: `w${i + 1}` }));
    this.seq = this.parts.reduce((m, p) => Math.max(m, Number(String(p.id).slice(1)) || 0), 0) + 1;
    if (data.view) this.view = data.view;
    this.selected = null;
    this.render();
    this.onChange();
  }

  // -------------------------------------------------------------- отрисовка ----
  render() {
    this.world.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.s})`);
    this.svg.classList.toggle('no-labels', this.showLabels === false);

    // позиционные обозначения: R1, R2, D1… — по порядку появления на схеме
    const counts = {};
    for (const p of this.parts) {
      const prefix = REF_PREFIX[p.type] || 'X';
      counts[prefix] = (counts[prefix] || 0) + 1;
      p.ref = `${prefix}${counts[prefix]}`;
    }

    // провода
    let wsvg = '';
    for (const w of this.wires) {
      const d = this.wirePath(w);
      if (!d) continue;
      const sel = this.selected?.kind === 'wire' && this.selected.id === w.id ? ' selected' : '';
      wsvg += `<path class="wire-hit" d="${d}"/><path class="wire${sel}" d="${d}" data-wire="${w.id}"/>`;
    }
    this.layerWires.innerHTML = wsvg;

    // детали
    let psvg = '';
    for (const p of this.parts) {
      const sel = this.selected?.kind === 'part' && this.selected.id === p.id ? ' selected' : '';
      const markup = p.__def.render(p);
      psvg += `<g transform="translate(${p.x} ${p.y})" data-wrap="${p.id}">${markup.replace('class="part"', `class="part${sel}"`)}</g>`;
    }
    this.layerParts.innerHTML = psvg;

    // выводы
    let pinsvg = '';
    for (const p of this.parts) {
      for (const pin of allPins(p)) {
        const key = `${pin.compId}:${pin.pin}`;
        const active = this.pending && this.pending.compId === pin.compId && this.pending.pin === pin.pin ? ' active' : '';
        const r = p.__def.board ? 3.2 : 4.2;
        pinsvg += `<circle class="pin${p.__def.board ? ' pin-board' : ''}${active}" data-key="${key}" data-pin="${pin.compId}|${pin.pin}" cx="${pin.x}" cy="${pin.y}" r="${r}"/>`;
        // у платы подписи выводов уже нарисованы на корпусе — не дублируем
        if (this.view.s > 0.75 && !p.__def.board) {
          pinsvg += `<text x="${pin.x}" y="${pin.y - 7}" style="font:6px ui-monospace;fill:#6f869a;text-anchor:middle;pointer-events:none">${pin.label}</text>`;
        }
      }
    }
    if (!this.parts.length) {
      pinsvg += `<text class="empty-hint" x="0" y="0">Нажмите деталь в палитре справа — она появится здесь</text>`;
    }
    this.layerPins.innerHTML = pinsvg;

    if (this.pending) this.drawPending(this.pointerWorld);
    else this.layerPending.innerHTML = '';
  }

  /** Показать/скрыть подписи элементов (выбор запоминается). */
  toggleLabels(on) {
    this.showLabels = typeof on === 'boolean' ? on : !this.showLabels;
    try { localStorage.setItem('robosim:labels', this.showLabels ? '1' : '0'); } catch { /* приватный режим */ }
    this.render();
    return this.showLabels;
  }

  wirePath(w) {
    const pa = this.part(w.a.compId), pb = this.part(w.b.compId);
    if (!pa || !pb) return null;
    const A = pinWorld(pa, w.a.pin), B = pinWorld(pb, w.b.pin);
    if (!A || !B) return null;
    const pts = route(A, B);
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  }

  drawPending(cur) {
    if (!cur) { this.layerPending.innerHTML = ''; return; }
    const part = this.part(this.pending.compId);
    if (!part) return;
    const A = pinWorld(part, this.pending.pin);
    const pts = route(A, { x: cur.x, y: cur.y, dir: null });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    this.layerPending.innerHTML = `<path class="pending-wire" d="${d}"/>`;
  }

  // ------------------------------------------------------------- динамика ----
  /** Обновляет «физику» на схеме: яркость, нажатия, состояния выводов. */
  applySim(partInfo, runtimes) {
    for (const p of this.parts) {
      const g = this.layerParts.querySelector(`[data-id="${p.id}"]`);
      if (!g || !p.__def.update) continue;
      const info = partInfo?.get?.(p.id) || {};
      const env = {
        brightness: info.brightness || 0,
        current: info.current || 0,
        voltage: info.voltage || 0,
        sounding: !!info.sounding,
        builtinOn: false,
      };
      if (p.__def.board) {
        const rt = runtimes?.get?.(p.id);
        const spec = p.__def.spec;
        env.builtinOn = !!(rt && (rt.pins.get(spec.builtinLed)?.pwm || 0) > 127);
      }
      p.__def.update(g, p, env);
    }
    for (const p of this.parts) {
      if (!p.__def.board) continue;
      const rt = runtimes?.get?.(p.id);
      for (const pin of p.__def.pins(p)) {
        if (typeof pin.num !== 'number') continue;
        const el = this.layerPins.querySelector(`[data-key="${p.id}:${pin.id}"]`);
        if (!el) continue;
        const st = rt?.pins.get(pin.num);
        el.classList.remove('high', 'low');
        if (st && st.mode === 'OUTPUT') el.classList.add(st.pwm > 127 ? 'high' : 'low');
      }
    }
  }

  // --------------------------------------------------------------- события ----
  _toWorld(ev) {
    const r = this.svg.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - this.view.x) / this.view.s,
      y: (ev.clientY - r.top - this.view.y) / this.view.s,
    };
  }

  _bind() {
    const svg = this.svg;

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button === 1) { this._startPan(ev); return; }
      const pinEl = ev.target.closest('.pin');
      const partEl = ev.target.closest('.part');
      const wireEl = ev.target.closest('[data-wire]');
      this.moved = false;

      if (pinEl) {
        const [compId, pin] = pinEl.dataset.pin.split('|');
        if (!this.pending) {
          this.pending = { compId, pin };
          this.pointerWorld = this._toWorld(ev);
          this.render();
        } else if (this.pending.compId === compId && this.pending.pin === pin) {
          this.pending = null;
          this.render();
        } else {
          const exists = this.wires.some((w) =>
            (w.a.compId === this.pending.compId && w.a.pin === this.pending.pin && w.b.compId === compId && w.b.pin === pin) ||
            (w.b.compId === this.pending.compId && w.b.pin === this.pending.pin && w.a.compId === compId && w.a.pin === pin));
          if (!exists) {
            this.wires.push({
              id: `w${this.seq++}`,
              a: { ...this.pending }, b: { compId, pin },
            });
          }
          this.pending = null;
          this.render();
          this.onChange();
        }
        ev.preventDefault();
        return;
      }

      if (wireEl) {
        this.selected = { kind: 'wire', id: wireEl.dataset.wire };
        this.render();
        ev.preventDefault();
        return;
      }

      if (partEl) {
        const id = partEl.dataset.id;
        const part = this.part(id);
        const knob = ev.target.closest('[data-role="knob"]');
        this.selected = { kind: 'part', id };
        this.drag = {
          id, startWorld: this._toWorld(ev), partX: part.x, partY: part.y, knob: !!knob,
        };
        if (part.type === 'button' && !knob) {
          part.props.pressed = true;
          this.refreshPart(part);
        }
        this.render();
        svg.setPointerCapture(ev.pointerId);
        ev.preventDefault();
        return;
      }

      // пустое место → снимаем выделение / панорамируем
      this.pending = null;
      this.selected = null;
      this.render();
      this._startPan(ev);
    });

    svg.addEventListener('pointermove', (ev) => {
      if (this.pending) {
        this.pointerWorld = this._toWorld(ev);
        this.drawPending(this.pointerWorld);
        return;
      }
      if (this.pan) {
        this.userMoved = true;
        this.view.x = this.pan.vx + (ev.clientX - this.pan.x);
        this.view.y = this.pan.vy + (ev.clientY - this.pan.y);
        if (Math.abs(ev.clientX - this.pan.x) + Math.abs(ev.clientY - this.pan.y) > 3) this.moved = true;
        this.world.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.s})`);
        return;
      }
      if (!this.drag && this.onHoverPin) {
        const pinEl = ev.target.closest?.('.pin');
        if (pinEl) {
          const [cid, pin] = pinEl.dataset.pin.split('|');
          this.onHoverPin({ compId: cid, pin });
        } else {
          this.onHoverPin(null);
        }
      }
      if (this.drag) {
        const w = this._toWorld(ev);
        const part = this.part(this.drag.id);
        if (this.drag.knob && part?.type === 'pot') {
          const local = (w.x - part.x + 18) / 36;
          part.props.value = clamp(local, 0, 1);
          this.refreshPart(part);
          this.onChange();
          return;
        }
        const dx = w.x - this.drag.startWorld.x, dy = w.y - this.drag.startWorld.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        part.x = snap(this.drag.partX + dx);
        part.y = snap(this.drag.partY + dy);
        const wrap = this.layerParts.querySelector(`[data-wrap="${part.id}"]`);
        if (wrap) wrap.setAttribute('transform', `translate(${part.x} ${part.y})`);
        this._updateWiresFor(part.id);
      }
    });

    const endDrag = (ev) => {
      if (this.drag) {
        const part = this.part(this.drag.id);
        if (part?.type === 'button') { part.props.pressed = false; this.refreshPart(part); }
        if (this.moved) this.onChange();
        this.drag = null;
      }
      this.pan = null;
      if (svg.hasPointerCapture?.(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
      this.render();
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      this.userMoved = true;
      const factor = ev.deltaY < 0 ? 1.1 : 1 / 1.1;
      const s = clamp(this.view.s * factor, 0.35, 2.5);
      const k = s / this.view.s;
      this.view.x = mx - (mx - this.view.x) * k;
      this.view.y = my - (my - this.view.y) * k;
      this.view.s = s;
      this.render();
    }, { passive: false });

    svg.addEventListener('dblclick', (ev) => {
      const partEl = ev.target.closest('.part');
      if (!partEl) return;
      const part = this.part(partEl.dataset.id);
      if (!part) return;
      if (part.type === 'resistor') {
        const v = prompt('Сопротивление, Ом:', String(part.props.value));
        if (v !== null && Number(v) > 0) { part.props.value = Number(v); this.render(); this.onChange(); }
      } else if (part.type === 'pot') {
        const v = prompt('Полное сопротивление потенциометра, Ом:', String(part.props.ohms));
        if (v !== null && Number(v) > 0) { part.props.ohms = Number(v); this.onChange(); }
      }
    });
  }

  _startPan(ev) {
    this.pan = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y };
    this.svg.setPointerCapture?.(ev.pointerId);
  }

  refreshPart(partOrId) {
    const part = typeof partOrId === 'string' ? this.part(partOrId) : partOrId;
    if (!part || !part.__def) return;
    const wrap = this.layerParts.querySelector(`[data-wrap="${part.id}"]`);
    if (!wrap) return;
    const sel = this.selected?.kind === 'part' && this.selected.id === part.id ? ' selected' : '';
    wrap.innerHTML = part.__def.render(part).replace('class="part"', `class="part${sel}"`);
  }

  _updateWiresFor(partId) {
    let changed = false;
    for (const w of this.wires) {
      if (w.a.compId !== partId && w.b.compId !== partId) continue;
      const path = this.layerWires.querySelector(`[data-wire="${w.id}"]`);
      if (!path) continue;
      const d = this.wirePath(w);
      if (!d) continue;
      path.setAttribute('d', d);
      const hit = path.previousElementSibling;
      if (hit && hit.classList.contains('wire-hit')) hit.setAttribute('d', d);
      changed = true;
    }
    return changed;
  }

  /** Вписать всю схему в окно: и плату, и модули вокруг неё. */
  centerBoard() {
    const r = this.svg.getBoundingClientRect();
    if (!this.parts.length || !r.width) {
      this.view.x = r.width / 2;
      this.view.y = r.height / 2;
      this.view.s = 1.45;
      this.render();
      return;
    }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of this.parts) {
      const d = PARTS[p.type];
      const w = (d?.w ?? 60) / 2, h = (d?.h ?? 40) / 2;
      x1 = Math.min(x1, p.x - w); y1 = Math.min(y1, p.y - h);
      x2 = Math.max(x2, p.x + w); y2 = Math.max(y2, p.y + h);
    }
    const bw = Math.max(40, x2 - x1), bh = Math.max(40, y2 - y1);
    const pad = 46;
    const s = Math.min(1.6, Math.max(0.5,
      Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh)));
    this.view.s = s;
    this.view.x = r.width / 2 - ((x1 + x2) / 2) * s;
    this.view.y = r.height / 2 - ((y1 + y2) / 2) * s;
    this.render();
  }
}

/**
 * Ортогональная трассировка: из вывода провод выходит перпендикулярно,
 * дальше идёт Z-маршрут. Если «перпендикуляр» уводит от цели — не делаем
 * лишнюю петлю, идём сразу к цели.
 */
function route(A, B) {
  const OFF = 22;
  const step = (p, off) => {
    if (p.dir === 'up') return { x: p.x, y: p.y - off };
    if (p.dir === 'down') return { x: p.x, y: p.y + off };
    if (p.dir === 'left') return { x: p.x - off, y: p.y };
    if (p.dir === 'right') return { x: p.x + off, y: p.y };
    return { x: p.x, y: p.y };
  };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  let a = step(A, OFF);
  if (dist(a, B) > dist(A, B)) a = { x: A.x, y: A.y };

  const pts = [{ x: A.x, y: A.y }, a];
  const aVert = A.dir === 'up' || A.dir === 'down';

  if (B.dir) {
    const bVert = B.dir === 'up' || B.dir === 'down';
    if (aVert && bVert) {
      const my = (a.y + B.y) / 2;
      pts.push({ x: a.x, y: my }, { x: B.x, y: my });
    } else if (!aVert && !bVert) {
      const mx = (a.x + B.x) / 2;
      pts.push({ x: mx, y: a.y }, { x: mx, y: B.y });
    } else if (aVert) {
      pts.push({ x: a.x, y: B.y });
    } else {
      pts.push({ x: B.x, y: a.y });
    }
  } else {
    const mx = (a.x + B.x) / 2;
    pts.push({ x: mx, y: a.y }, { x: mx, y: B.y });
  }
  pts.push({ x: B.x, y: B.y });

  return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 0.01 || Math.abs(p.y - pts[i - 1].y) > 0.01);
}

function pinNumber(pinId) {
  const m = /^D(\d+)$/.exec(pinId);
  if (m) return Number(m[1]);
  const a = /^A(\d)$/.exec(pinId);
  if (a) return 14 + Number(a[1]);
  return null;
}

/** Подписи элементов включены по умолчанию. */
function loadLabelPref() {
  try { return localStorage.getItem('robosim:labels') !== '0'; } catch { return true; }
}
