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

/**
 * Куда поставить подпись вывода у детали (не у платы).
 * Наружу по направлению вывода: под нижней площадкой, над верхней, сбоку от
 * боковой — чтобы текст не наезжал на рисунок. Отдельный вывод может задать
 * смещение сам (labelDx / labelDy / labelAnchor) — так подписаны сегменты
 * индикатора, где подписи идут столбиком сбоку.
 */
function pinLabelPos(pin) {
  if (pin.labelAnchor) {
    return { x: pin.x + (pin.labelDx || 0), y: pin.y + (pin.labelDy || 0), anchor: pin.labelAnchor };
  }
  if (pin.dir === 'down') return { x: pin.x, y: pin.y + 11, anchor: 'middle' };
  if (pin.dir === 'left') return { x: pin.x - 8, y: pin.y + 2, anchor: 'end' };
  if (pin.dir === 'right') return { x: pin.x + 8, y: pin.y + 2, anchor: 'start' };
  return { x: pin.x, y: pin.y - 8, anchor: 'middle' };
}

/** Цвета проводов: земля, питание и «сигнальная» палитра по кругу. */
export const WIRE_COLORS = { gnd: '#93a4b4', vcc: '#f2555a', v33: '#f5a25d', vin: '#f5a25d' };
export const SIGNAL_COLORS = ['#f2c94c', '#4ade80', '#5aa9e6', '#c084fc', '#2dd4bf', '#fb923c', '#f472b6', '#a3e635'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Что спрашивать у датчика по двойному клику: подпись, ключ, диапазон. */
const SENSOR_PROPS = {
  mpu6050: { key: 'tilt', ask: 'Наклон датчика, градусы (−60…60):', min: -60, max: 60 },
  bmp280: { key: 'pressure', ask: 'Атмосферное давление, гПа (950…1050):', min: 950, max: 1050 },
  ds18b20: { key: 'temp', ask: 'Температура, °C (−10…50):', min: -10, max: 50 },
  bh1750: { key: 'lux', ask: 'Освещённость, люкс (0…2000):', min: 0, max: 2000 },
  mq2: { key: 'value', ask: 'Концентрация газа, доля от максимума (0…1):', min: 0, max: 1 },
  soil: { key: 'value', ask: 'Влажность почвы, доля (0 — сухо, 1 — мокро):', min: 0, max: 1 },
  sound: { key: 'value', ask: 'Громкость, доля от максимума (0…1):', min: 0, max: 1 },
};

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
    this.layerHits = svg.querySelector('#wireHitLayer');
    this.layerBoards = svg.querySelector('#boardsLayer');
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
    if (type === 'toggle') return { on: false };
    if (type === 'joystick') return { x: 0, y: 0, pressed: false };
    if (type === 'relay') return { energized: false };
    if (type === 'stepper28byj') return { angle: 0, steps: 0, phases: [false, false, false, false] };
    if (type === 'rgbled') return {};
    if (type === 'battery9') return { voltage: 9 };
    if (type === 'batteryAA') return { voltage: 6 };
    if (type === 'psu') return { voltage: 5 };
    if (type === 'scope') return {};
    if (type === 'multimeter') return { mode: 'V' };
    if (type === 'logicprobe') return {};
    if (type === 'keypad') return { pressed: null };
    if (type === 'dcmotor') return { angle: 0 };
    if (type === 'sr595' || type === 'sr165') return {};
    if (type === 'seg7') return {};
    // датчики: у каждого своя измеряемая величина, ползунок меняет её мышью
    if (type === 'mpu6050') return { tilt: 0, shake: 0 };
    if (type === 'bmp280') return { pressure: 1013, temp: 24 };
    if (type === 'ds18b20') return { temp: 24 };
    if (type === 'bh1750') return { lux: 300 };
    if (type === 'mq2') return { value: 0 };
    if (type === 'soil') return { value: 0.4 };
    if (type === 'sound') return { value: 0.1 };
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

    // выводы, к которым ведёт выделенный провод — обводим, чтобы было видно, куда он идёт
    const linked = new Set();
    if (this.selected?.kind === 'wire') {
      const w = this.wires.find((q) => q.id === this.selected.id);
      if (w) { linked.add(`${w.a.compId}:${w.a.pin}`); linked.add(`${w.b.compId}:${w.b.pin}`); }
    }

    // провода: тёмная обводка + цветной провод + точки на концах
    let wsvg = '';
    let hitsvg = '';
    let signal = 0;
    for (const w of this.wires) {
      const geo = this.wireGeom(w);
      if (!geo) continue;
      const { d, A, B } = geo;
      const col = this.wireColor(w, this.pinKind(w.a) === 'gnd' || this.pinKind(w.b) === 'gnd' ? 0 : signal++);
      const sel = this.selected?.kind === 'wire' && this.selected.id === w.id;
      const extra = sel ? ' selected' : '';
      const gap = sel ? ' hot' : '';
      hitsvg += `<path class="wire-hit${extra}" d="${d}" data-wire="${w.id}"/>`;
      wsvg += `<g class="wire-g${gap}" data-wire-g="${w.id}" style="--wc:${col}">
        <path class="wire-case" d="${d}"/>
        <path class="wire${extra}" d="${d}" data-wire="${w.id}" style="stroke:${col}"/>
        <circle class="wire-dot" data-end="a" cx="${A.x}" cy="${A.y}" r="2.6" fill="${col}"/>
        <circle class="wire-dot" data-end="b" cx="${B.x}" cy="${B.y}" r="2.6" fill="${col}"/>
      </g>`;
    }
    this.layerHits.innerHTML = hitsvg;
    this.layerWires.innerHTML = wsvg;

    // детали: платы — отдельным слоем ниже проводов, чтобы провод доходил до площадки
    let psvg = '';
    let bsvg = '';
    for (const p of this.parts) {
      const sel = this.selected?.kind === 'part' && this.selected.id === p.id ? ' selected' : '';
      const markup = p.__def.render(p).replace('class="part"', `class="part${sel}"`);
      const tr = `translate(${p.x} ${p.y})`;
      if (p.__def.board) {
        // плата — в нижний слой (провод доходит до площадки), а её шильдик —
        // в слой деталей, чтобы провод не рвал подпись
        const tag = markup.match(/<g class="tag">[\s\S]*?<\/g>/);
        bsvg += `<g transform="${tr}" data-wrap="${p.id}">${tag ? markup.replace(tag[0], '') : markup}</g>`;
        if (tag) psvg += `<g transform="${tr}" data-wrap-tag="${p.id}">${tag[0]}</g>`;
      } else psvg += `<g transform="${tr}" data-wrap="${p.id}">${markup}</g>`;
    }
    this.layerParts.innerHTML = psvg;
    this.layerBoards.innerHTML = bsvg;

    // выводы
    let pinsvg = '';
    for (const p of this.parts) {
      for (const pin of allPins(p)) {
        const key = `${pin.compId}:${pin.pin}`;
        const active = this.pending && this.pending.compId === pin.compId && this.pending.pin === pin.pin ? ' active' : '';
        const r = p.__def.board ? 3.2 : 4.2;
        const link = linked.has(key) ? ' linked' : '';
        pinsvg += `<circle class="pin${p.__def.board ? ' pin-board' : ''}${active}${link}" data-key="${key}" data-pin="${pin.compId}|${pin.pin}" cx="${pin.x}" cy="${pin.y}" r="${r}"/>`;
        // у платы подписи выводов уже нарисованы на корпусе — не дублируем
        if (this.view.s > 0.75 && !p.__def.board) {
          // подпись вывода ставится наружу от корпуса: у нижних выводов — под
          // площадкой, у верхних — над ней, у боковых — сбоку, чтобы текст не
          // наезжал на рисунок детали
          const l = pinLabelPos(pin);
          pinsvg += `<text x="${l.x}" y="${l.y}" style="font:6px ui-monospace;fill:#6f869a;text-anchor:${l.anchor};pointer-events:none">${pin.label}</text>`;
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
    const geo = this.wireGeom(w);
    return geo ? geo.d : null;
  }

  /** Точки начала и конца провода + строка path. */
  wireGeom(w) {
    const pa = this.part(w.a.compId), pb = this.part(w.b.compId);
    if (!pa || !pb) return null;
    const A = pinWorld(pa, w.a.pin), B = pinWorld(pb, w.b.pin);
    if (!A || !B) return null;
    const boardPart = pa.__def.board ? pa : pb.__def.board ? pb : null;
    const pts = route(A, B, {
      lane: this.wireLane(w),
      aBoard: !!pa.__def.board,
      bBoard: !!pb.__def.board,
      box: boardPart ? {
        x1: boardPart.x - boardPart.__def.w / 2,
        y1: boardPart.y - boardPart.__def.h / 2,
        x2: boardPart.x + boardPart.__def.w / 2,
        y2: boardPart.y + boardPart.__def.h / 2,
      } : null,
    });
    return { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '), A, B };
  }

  /** Номер «коридора»: соседние провода идут на разной высоте, а не поверх друг друга. */
  wireLane(w) {
    const i = this.wires.indexOf(w);
    return ((i % 5) - 2) * 9;
  }

  /** Характер вывода: земля, питание или сигнал — от него зависит цвет провода. */
  pinKind(end) {
    const part = this.part(end.compId);
    const pin = part?.__def?.pins(part).find((q) => q.id === end.pin);
    return pin?.kind || 'digital';
  }

  /**
   * Цвет провода как у настоящего монтажа: земля — стальная, питание — красное,
   * сигнальные — по очереди из палитры, чтобы соседние провода различались.
   */
  wireColor(w, index) {
    const ka = this.pinKind(w.a), kb = this.pinKind(w.b);
    const kinds = [ka, kb];
    if (kinds.includes('gnd')) return WIRE_COLORS.gnd;
    for (const k of ['vcc', 'v33', 'vin']) if (kinds.includes(k)) return WIRE_COLORS[k];
    return SIGNAL_COLORS[index % SIGNAL_COLORS.length];
  }

  drawPending(cur) {
    if (!cur) { this.layerPending.innerHTML = ''; return; }
    const part = this.part(this.pending.compId);
    if (!part) return;
    const A = pinWorld(part, this.pending.pin);
    const pts = route(A, { x: cur.x, y: cur.y, dir: null }, { aBoard: !!part.__def.board });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
    this.layerPending.innerHTML = `<path class="pending-wire" d="${d}"/>`;
  }

  // ------------------------------------------------------------- динамика ----
  /** Обновляет «физику» на схеме: яркость, нажатия, состояния выводов. */
  applySim(partInfo, runtimes) {
    // сгорела деталь или её заменили — перерисовываем один раз, а не каждый кадр
    for (const p of this.parts) {
      const burned = !!p.props?.burned;
      if (burned !== !!p.__burnShown) { p.__burnShown = burned; this.refreshPart(p); }
    }
    for (const p of this.parts) {
      const g = this.layerParts.querySelector(`[data-id="${p.id}"]`)
        || this.layerBoards.querySelector(`[data-id="${p.id}"]`);
      if (!g || !p.__def.update) continue;
      const info = partInfo?.get?.(p.id) || {};
      const env = {
        brightness: info.brightness || 0,
        current: info.current || 0,
        voltage: info.voltage || 0,
        sounding: !!info.sounding,
        builtinOn: false,
        info,                       // полная телеметрия детали (каналы RGB, сегменты, фазы…)
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
        // preventDefault() гасит click/dblclick, поэтому двойное нажатие
        // ловим сами: две «нажатия» по одной детали за 400 мс — это редактор
        const now = performance.now();
        const tap = this._lastTap;
        const onKnob = !!ev.target.closest('[data-role="knob"],[data-role="stick"]');
        this._lastTap = onKnob ? null : { id, t: now };
        if (!onKnob && tap && tap.id === id && now - tap.t < 400 && part) {
          this._lastTap = null;
          this.drag = null;
          this.editPart(part);
          this.render();
          ev.preventDefault();
          return;
        }
        const knob = ev.target.closest('[data-role="knob"]');
        const knobKey = knob?.dataset?.knob || null;      // у MPU-6050 их два: наклон и тряска
        const stick = ev.target.closest('[data-role="stick"]');
        this.selected = { kind: 'part', id };
        this.drag = {
          id, startWorld: this._toWorld(ev), partX: part.x, partY: part.y, knob: !!knob, knobKey,
          stick: !!stick, pressPending: false,
        };
        if (part.type === 'button' && !knob) {
          part.props.pressed = true;
          this.refreshPart(part);
        }
        const keyEl = ev.target.closest('[data-role="key"]');
        if (part.type === 'keypad' && keyEl) {
          part.props.pressed = Number(keyEl.dataset.key);
          this.refreshPart(part);
          this.onChange();
          this.drag = { ...this.drag, keypadKey: true };
          return;
        }
        if (part.type === 'multimeter' && knob) {
          const modes = ['V', 'A', 'OHM', 'CONT'];
          const cur = modes.indexOf(part.props.mode || 'V');
          part.props.mode = modes[(cur + 1) % modes.length];
          this.refreshPart(part);
          this.onChange();
          this.drag = null;
          ev.preventDefault();
          return;
        }
        if (part.type === 'toggle') {
          part.props.on = !part.props.on;
          this.refreshPart(part);
          this.onChange();
        }
        if (part.type === 'joystick' && stick) {
          part.props.pressed = true;   // нажали на ручку — сработала кнопка SW
          this.drag.pressPending = true;
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
        // под курсором сверху может лежать прозрачная зона детали —
        // смотрим всю стопку, чтобы провод и вывод отзывались всегда
        const stack = document.elementsFromPoint?.(ev.clientX, ev.clientY) || [];
        const pinEl = stack.find((el) => el.classList?.contains('pin')) || ev.target.closest?.('.pin');
        const wireEl = stack.find((el) => el.classList?.contains('wire-hit')) || ev.target.closest?.('[data-wire]');
        if (pinEl) {
          const [cid, pin] = pinEl.dataset.pin.split('|');
          this.onHoverPin({ compId: cid, pin });
          this.highlightWire(null);
        } else if (wireEl) {
          this.onHoverPin(null);
          this.highlightWire(wireEl.dataset.wire);
          if (this.onHoverWire) this.onHoverWire(this.wires.find((w) => w.id === wireEl.dataset.wire));
        } else {
          this.onHoverPin(null);
          this.highlightWire(null);
          if (this.onHoverWire) this.onHoverWire(null);
        }
      }
      if (this.drag) {
        const w = this._toWorld(ev);
        const part = this.part(this.drag.id);
        if (this.drag.stick && part?.type === 'joystick') {
          const dx = w.x - part.x, dy = w.y - part.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) {
            part.props.x = clamp(dx / 26, -1, 1);
            part.props.y = clamp(-dy / 26, -1, 1);
            if (this.drag.pressPending) { part.props.pressed = false; this.drag.pressPending = false; }
            this.refreshPart(part);
            this.onChange();
            this.moved = true;
          }
          return;
        }
        if (this.drag.knob && part?.type === 'pot') {
          const local = (w.x - part.x + 18) / 36;
          part.props.value = clamp(local, 0, 1);
          this.refreshPart(part);
          this.onChange();
          return;
        }
        if (this.drag.knob && part?.__def?.knob) {
          // ползунок датчика: тянем влево-вправо, значение живёт в props
          const local = clamp((w.x - part.x + 18) / 36, 0, 1);
          part.__def.knob.set(part, local, this.drag.knobKey);
          this.refreshPart(part);
          this.onChange();
          return;
        }
        const dx = w.x - this.drag.startWorld.x, dy = w.y - this.drag.startWorld.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        part.x = snap(this.drag.partX + dx);
        part.y = snap(this.drag.partY + dy);
        for (const wrap of this.wrapsOf(part.id)) {
          wrap.setAttribute('transform', `translate(${part.x} ${part.y})`);
        }
        this._updateWiresFor(part.id);
      }
    });

    const endDrag = (ev) => {
      if (this.drag) {
        const part = this.part(this.drag.id);
        if (part?.type === 'button') { part.props.pressed = false; this.refreshPart(part); }
        if (part?.type === 'keypad' && part.props.pressed !== null && part.props.pressed !== undefined) {
          part.props.pressed = null;
          this.refreshPart(part);
          this.onChange();
        }
        if (part?.type === 'joystick' && part.props.pressed) { part.props.pressed = false; this.refreshPart(part); }
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
      // указатель захвачен холстом (панорама), поэтому ev.target может быть
      // самим svg — тогда ищем деталь под курсором вручную
      const partEl = ev.target.closest?.('.part')
        || document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.part') || null;
      if (!partEl) return;
      const part = this.part(partEl.dataset.id);
      if (part) this.editPart(part);
    });
  }

  /** Двойной клик по детали: у резистора — номинал, у источника — напряжение. */
  editPart(part) {
    if (part.type === 'resistor') {
      const v = prompt('Сопротивление, Ом:', String(part.props.value));
      if (v !== null && Number(v) > 0) { part.props.value = Number(v); this.render(); this.onChange(); }
    } else if (part.type === 'battery9' || part.type === 'batteryAA' || part.type === 'psu') {
      const v = prompt('Напряжение источника, В (1,5…24):', String(part.props.voltage));
      if (v !== null && Number(v) > 0) {
        part.props.voltage = Math.max(1.5, Math.min(24, Number(v)));
        this.refreshPart(part);
        this.render();
        this.onChange();
      }
    } else if (part.type === 'pot') {
      const v = prompt('Полное сопротивление потенциометра, Ом:', String(part.props.ohms));
      if (v !== null && Number(v) > 0) { part.props.ohms = Number(v); this.onChange(); }
    } else if (SENSOR_PROPS[part.type]) {
      const spec = SENSOR_PROPS[part.type];
      const v = prompt(spec.ask, String(part.props[spec.key] ?? spec.min));
      if (v === null || v === '') return;
      const num = Number(String(v).replace(',', '.'));
      if (!Number.isFinite(num)) return;
      part.props[spec.key] = Math.min(spec.max, Math.max(spec.min, num));
      this.refreshPart(part);
      this.onChange();
    }
  }

  _startPan(ev) {
    this.pan = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y };
    this.svg.setPointerCapture?.(ev.pointerId);
  }

  /** Обёртки детали: тело и (у плат) отдельно лежащий шильдик. */
  wrapsOf(id) {
    return [
      ...this.layerParts.querySelectorAll(`[data-wrap="${id}"]`),
      ...(this.layerBoards ? this.layerBoards.querySelectorAll(`[data-wrap="${id}"]`) : []),
      ...this.layerParts.querySelectorAll(`[data-wrap-tag="${id}"]`),
    ];
  }

  wrapOf(id) { return this.wrapsOf(id)[0] || null; }

  refreshPart(partOrId) {
    const part = typeof partOrId === 'string' ? this.part(partOrId) : partOrId;
    if (!part || !part.__def) return;
    const wraps = this.wrapsOf(part.id);
    if (!wraps.length) return;
    const sel = this.selected?.kind === 'part' && this.selected.id === part.id ? ' selected' : '';
    const markup = part.__def.render(part).replace('class="part"', `class="part${sel}"`);
    const tag = markup.match(/<g class="tag">[\s\S]*?<\/g>/);
    for (const wrap of wraps) {
      if (wrap.hasAttribute('data-wrap-tag')) wrap.innerHTML = tag ? tag[0] : '';
      else wrap.innerHTML = tag ? markup.replace(tag[0], '') : markup;
    }
  }

  _updateWiresFor(partId) {
    let changed = false;
    for (const w of this.wires) {
      if (w.a.compId !== partId && w.b.compId !== partId) continue;
      const geo = this.wireGeom(w);
      if (!geo) continue;
      const g = this.layerWires.querySelector(`[data-wire-g="${w.id}"]`);
      const hit = this.layerHits.querySelector(`[data-wire="${w.id}"]`);
      if (g) {
        for (const path of g.querySelectorAll('path')) path.setAttribute('d', geo.d);
        const ca = g.querySelector('[data-end="a"]');
        const cb = g.querySelector('[data-end="b"]');
        if (ca) { ca.setAttribute('cx', geo.A.x); ca.setAttribute('cy', geo.A.y); }
        if (cb) { cb.setAttribute('cx', geo.B.x); cb.setAttribute('cy', geo.B.y); }
      }
      if (hit) hit.setAttribute('d', geo.d);
      changed = true;
    }
    return changed;
  }

  /** Подсветить один провод и приглушить остальные (наведение мышью). */
  highlightWire(id) {
    this.layerWires.classList.toggle('dim', !!id);
    for (const g of this.layerWires.querySelectorAll('.wire-g')) {
      g.classList.toggle('hot', !!id && g.dataset.wireG === id);
    }
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
 * Ортогональная трассировка провода.
 *
 * Правила, которые убирают кашу на схеме:
 *  · из вывода всегда выходим перпендикулярно, на 22 px;
 *  · дальше идём одним коридором и заходим в цель тоже перпендикулярно;
 *  · у платы коридор идёт по её краю — провод обходит плату, а не режет насквозь;
 *  · если цель — горизонтальный вывод, коридор смещён от её ряда на lane,
 *    чтобы провода между одними рядами деталей не ложились друг на друга.
 *
 * lane — «полоса» провода (у каждого своя), aBoard/bBoard — выводы на плате.
 */
/** Обход платы сбоку: наружу из вывода, по краю корпуса, обратно к цели. */
function aroundBoard(A, B, a, b, box) {
  const left = box.x1 - 26;
  const right = box.x2 + 26;
  // если вывод уже сбоку от платы — обходим с его стороны
  const aOutsideX = a.x <= box.x1 || a.x >= box.x2;
  const costLeft = Math.abs(a.x - left) + Math.abs(b.x - left);
  const costRight = Math.abs(a.x - right) + Math.abs(b.x - right);
  const sx = aOutsideX ? (a.x < box.x1 ? left : right) : costLeft <= costRight ? left : right;
  // если цель тоже сбоку — возвращаемся к ней по свободной стороне
  const bInsideY = b.y > box.y1 && b.y < box.y2;
  const sy = !bInsideY ? b.y : b.y < (box.y1 + box.y2) / 2 ? box.y1 - 26 : box.y2 + 26;
  const pts = [
    { x: A.x, y: A.y }, a,
    { x: a.x, y: a.y }, { x: sx, y: a.y },
    { x: sx, y: sy }, { x: b.x, y: sy },
  ];
  if (bInsideY) pts.push({ x: b.x, y: b.y });
  pts.push(b, { x: B.x, y: B.y });
  return pts;
}

/**
 * Заходит ли ортогональный отрезок внутрь корпуса платы (с отступом pad).
 * Провода должны обходить плату, а не ложиться на её шелкографию.
 */
export function enters(p, q, box, pad = 12) {
  const x1 = box.x1 + pad, x2 = box.x2 - pad;
  const y1 = box.y1 + pad, y2 = box.y2 - pad;
  if (Math.abs(p.y - q.y) < 0.01) {
    if (p.y <= y1 || p.y >= y2) return false;
    return Math.max(p.x, q.x) > x1 && Math.min(p.x, q.x) < x2;
  }
  if (Math.abs(p.x - q.x) < 0.01) {
    if (p.x <= x1 || p.x >= x2) return false;
    return Math.max(p.y, q.y) > y1 && Math.min(p.y, q.y) < y2;
  }
  return false;
}

export function route(A, B, { lane = 0, aBoard = false, bBoard = false, box = null } = {}) {
  const OFF = 22;
  const horiz = (p) => p.dir === 'left' || p.dir === 'right';
  const vert = (p) => p.dir === 'up' || p.dir === 'down';

  const out = (p) => {
    if (p.dir === 'up') return { x: p.x, y: p.y - OFF };
    if (p.dir === 'down') return { x: p.x, y: p.y + OFF };
    if (p.dir === 'left') return { x: p.x - OFF, y: p.y };
    if (p.dir === 'right') return { x: p.x + OFF, y: p.y };
    return { x: p.x, y: p.y };
  };

  // выводы смотрят друг на друга по одной линии — достаточно прямого провода
  const sameY = Math.abs(A.y - B.y) < 0.5;
  const sameX = Math.abs(A.x - B.x) < 0.5;
  if (B.dir && ((sameY && horiz(A) && horiz(B)) || (sameX && vert(A) && vert(B)))) {
    return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
  }

  const a = out(A);
  const b = B.dir ? out(B) : { x: B.x, y: B.y };

  // высота коридора
  let my;
  if (B.dir && bBoard && vert(B)) my = b.y;              // к плате подходим по её краю
  else if (B.dir && horiz(B)) my = Math.abs(a.x - b.x) > 40 ? b.y - 14 + lane : b.y;  // коридор рядом с рядом цели
  else my = (a.y + b.y) / 2 + lane;

  let pts = [{ x: A.x, y: A.y }, a, { x: a.x, y: my }, { x: b.x, y: my }];
  if (B.dir) pts.push(b);
  pts.push({ x: B.x, y: B.y });

  // провод не должен резать плату насквозь: если какой-то отрезок заходит
  // внутрь корпуса, обходим плату сбоку, как настоящий провод в обход
  if (box && pts.some((p, i) => i > 1 && enters(p, pts[i - 1], box))) {   // первый отрезок — это площадка на плате
    pts = aroundBoard(A, B, a, b, box);
  }

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
