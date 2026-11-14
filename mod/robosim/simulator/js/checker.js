/**
 * checker.js — движок автопроверки заданий.
 *
 * Задание состоит из пунктов трёх видов:
 *   schema    — что должно быть на схеме (детали, выводы, цепочки);
 *   code      — что должно быть в скетче (вызовы, аргументы, структура);
 *   behavior  — что должно происходить при запуске (наблюдения симулятора).
 *
 * Контекст проверки (CheckContext) умеет отвечать на «школьные» вопросы:
 * «что висит на D9», «есть ли резистор последовательно со светодиодом»,
 * «сколько раз мигал вывод», «какой текст на LCD». Всё считается локально,
 * без обращений к DOM, поэтому движок тестируется в Node.
 */

import { PARTS } from './parts.js';

// ------------------------------------------------------------------ контекст ----

/** Собирает электрические узлы из проводов — та же логика, что в circuit.js. */
function buildNets(parts, wires) {
  const parent = new Map();
  const find = (k) => {
    let p = parent.get(k);
    if (p === undefined) { parent.set(k, k); return k; }
    while (p !== k) { k = p; p = parent.get(k) ?? k; if (p === k) break; }
    return k;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const key = (compId, pin) => `${compId}:${pin}`;

  for (const p of parts) for (const pin of PARTS[p.type].pins(p)) find(key(p.id, pin.id));
  for (const w of wires) union(key(w.a.compId, w.a.pin), key(w.b.compId, w.b.pin));

  // выводы питания одной платы — один узел (GND2 = GND, 5V2 = 5V, 3V3_2 = 3V3)
  for (const p of parts) {
    const def = PARTS[p.type];
    if (!def?.board) continue;
    for (const pin of def.pins(p)) {
      if (pin.aliasOf) union(key(p.id, pin.id), key(p.id, pin.aliasOf));
    }
  }
  return { find, key };
}

/** Таблица констант скетча: const int LED = 9;  #define LED 9;  LED = 25 */
function collectConsts(code, lang) {
  const out = {};
  const src = String(code || '');
  if (lang === 'mpy') {
    for (const m of src.matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*$/gm)) out[m[1]] = Number(m[2]);
    for (const m of src.matchAll(/^\s*(\w+)\s*=\s*Pin\s*\(\s*(\d+)/gm)) out[m[1]] = Number(m[2]);
    return out;
  }
  // const int LED = 9; и const int GAS = A0; — во втором случае храним имя вывода
  for (const m of src.matchAll(/(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|uint8_t|int8_t|int16_t)\s+([A-Za-z_]\w*)\s*=\s*(\d+|[A-Z]\d+|LED_BUILTIN)\s*;/g)) {
    out[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
  }
  for (const m of src.matchAll(/#define\s+([A-Za-z_]\w*)\s+(\d+|[A-Z]\d+|LED_BUILTIN)\b/g)) {
    out[m[1]] = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
  }
  return out;
}

export class CheckContext {
  /**
   * @param {object} opts
   *   parts, wires  — схема
   *   code, lang    — скетч активной платы
   *   trace         — наблюдения симулятора (см. app.js → recorder)
   */
  constructor({ parts = [], wires = [], code = '', lang = 'cpp', trace = null } = {}) {
    this.parts = parts;
    this.wires = wires;
    this.code = code;
    this.lang = lang;
    this.trace = trace || {};
    const { find, key } = buildNets(parts, wires);
    this._find = find;
    this._key = key;
    this.consts = collectConsts(code, lang);
  }

  // ---------------------------------------------------------------- детали ----
  part(id) { return this.parts.find((p) => p.id === id) || null; }
  partsOf(type) { return this.parts.filter((p) => p.type === type); }
  types() { return this.parts.map((p) => p.type); }
  count(type) { return this.partsOf(type).length; }
  boards() { return this.parts.filter((p) => PARTS[p.type]?.board); }

  netOf(compId, pin) {
    if (!compId) return null;
    return this._find(this._key(compId, pin));
  }

  /** Узел вывода платы по «человеческому» имени: D9, A0, GND, 5V, GP25, 32. */
  boardPin(name, board = null) {
    const b = board || this.boards()[0];
    if (!b) return null;
    const pins = PARTS[b.type].pins(b);
    const w = String(name).trim();
    const byLabel = pins.find((p) => p.label === w || p.id === w);
    if (byLabel) return { part: b, pin: byLabel, net: this.netOf(b.id, byLabel.id) };
    const d = /^D(\d+)$/i.exec(w);
    if (d) {
      const p = pins.find((q) => q.num === Number(d[1]));
      if (p) return { part: b, pin: p, net: this.netOf(b.id, p.id) };
    }
    const a = /^A(\d+)$/i.exec(w);
    if (a) {
      const p = pins.filter((q) => q.kind === 'analog')[Number(a[1])];
      if (p) return { part: b, pin: p, net: this.netOf(b.id, p.id) };
    }
    const n = Number(w);
    if (Number.isFinite(n)) {
      const p = pins.find((q) => q.num === n);
      if (p) return { part: b, pin: p, net: this.netOf(b.id, p.id) };
    }
    return null;
  }

  /** Все детали, у которых есть вывод на том же узле, что и вывод платы. */
  onBoardPin(name, type = null) {
    const bp = this.boardPin(name);
    if (!bp || !bp.net) return [];
    return this.parts.filter((p) => {
      if (p.__def?.board || PARTS[p.type]?.board) return false;
      if (type && p.type !== type) return false;
      return PARTS[p.type].pins(p).some((pin) => this.netOf(p.id, pin.id) === bp.net);
    });
  }

  /** Вывод детали подключён к выводу платы? */
  attached(boardPinName, compId, pinId) {
    const bp = this.boardPin(boardPinName);
    const part = this.part(compId);
    if (!bp || !part) return false;
    return this.netOf(compId, pinId) === bp.net;
  }

  /** Деталь подключена к земле платы? */
  toGround(compId, pinId) {
    const gndPins = ['GND', 'GND2'];
    const nets = gndPins.map((n) => this.boardPin(n)?.net).filter(Boolean);
    return nets.includes(this.netOf(compId, pinId));
  }

  /** Деталь подключена к питанию платы? */
  toVcc(compId, pinId) {
    const names = ['5V', '5V2', '3V3', '3V3_2', 'VIN', 'VSYS'];
    const nets = names.map((n) => this.boardPin(n)?.net).filter(Boolean);
    return nets.includes(this.netOf(compId, pinId));
  }

  /**
   * Какие детали стоят «по пути» между двумя выводами платы.
   * BFS по узлам: с узла можно перейти на другую ногу любой детали,
   * у которой одна нога уже на этом узле. Возвращает список типов деталей
   * в порядке обхода или null, если пути нет.
   */
  path(fromBoardPin, toBoardPin, maxParts = 6) {
    const a = this.boardPin(fromBoardPin);
    const b = this.boardPin(toBoardPin);
    if (!a || !b || !a.net || !b.net) return null;
    const startNet = a.net;
    const goalNet = b.net;

    const queue = [{ net: startNet, used: [] }];
    const seen = new Set([startNet]);
    while (queue.length) {
      const { net, used } = queue.shift();
      if (net === goalNet) return used.map((p) => p.type);
      if (used.length >= maxParts) continue;
      for (const p of this.parts) {
        if (PARTS[p.type]?.board) continue;
        if (used.includes(p)) continue;
        const pins = PARTS[p.type].pins(p);
        if (!pins.some((pin) => this.netOf(p.id, pin.id) === net)) continue;
        for (const pin of pins) {
          const n2 = this.netOf(p.id, pin.id);
          if (!n2 || n2 === net || seen.has(n2)) continue;
          seen.add(n2);
          queue.push({ net: n2, used: [...used, p] });
        }
      }
    }
    return null;
  }

  /** Есть ли на схеме светодиод, воткнутый в вывод без резистора последовательно. */
  ledWithoutResistor() {
    return this.partsOf('led').some((led) => {
      const anodeNet = this.netOf(led.id, 'A');
      const cathodeNet = this.netOf(led.id, 'K');
      if (!anodeNet || !cathodeNet) return false;
      const drivePins = [];
      for (const b of this.boards()) {
        for (const pin of PARTS[b.type].pins(b)) {
          if (typeof pin.num !== 'number') continue;
          if (this.netOf(b.id, pin.id) === anodeNet || this.netOf(b.id, pin.id) === cathodeNet) drivePins.push(pin.id);
        }
      }
      if (!drivePins.length) return false;         // светодиод вообще не подключён к выводам
      // ищем резистор между выводом платы и землёй/питанием
      const other = this.netOf(led.id, 'A') === anodeNet ? cathodeNet : anodeNet;
      const viaResistor = this.partsOf('resistor').some((r) => {
        const r1 = this.netOf(r.id, '1'), r2 = this.netOf(r.id, '2');
        return (r1 === anodeNet || r1 === cathodeNet || r2 === anodeNet || r2 === cathodeNet);
      });
      return !viaResistor;
    });
  }

  /** Аналоговые выводы, к которым хоть что-то подключено. */
  usedAnalogPins() {
    const out = [];
    for (const b of this.boards()) {
      for (const pin of PARTS[b.type].pins(b)) {
        if (pin.kind !== 'analog') continue;
        const net = this.netOf(b.id, pin.id);
        const used = this.parts.some((p) => !PARTS[p.type]?.board
          && PARTS[p.type].pins(p).some((q) => this.netOf(p.id, q.id) === net));
        if (used) out.push(pin.num);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ код ----
  codeHas(re) { return re instanceof RegExp ? re.test(this.code) : this.code.includes(re); }
  calls(name) {
    const re = new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(this.code))) out.push(m[1].trim());
    return out;
  }

  /** Вывод платы в исходнике: '9', 'LED_BUILTIN', 'LED' (константа), 'A0', '25'. */
  pinArgValue(arg, board = null) {
    const b = board || this.boards()[0];
    const spec = b ? (PARTS[b.type].spec || PARTS[b.type]) : null;
    const a = String(arg || '').trim();
    if (a === 'LED_BUILTIN') return spec?.builtinLed ?? null;
    // константа может быть объявлена через другую константу: const int G = A0;
    if (this.consts[a] !== undefined) {
      const next = String(this.consts[a]).trim();
      return next === a ? null : this.pinArgValue(next, board);
    }
    const m = /^A(\d+)$/i.exec(a);
    if (m && spec) return spec.pins.filter((p) => p.kind === 'analog')[Number(m[1])]?.num ?? Number(m[1]);
    const n = Number(a);
    return Number.isFinite(n) ? n : null;
  }

  /** Какие выводы скетч использует как выходы (для C++ и для MicroPython). */
  outputPins() {
    const out = new Set();
    if (this.lang === 'mpy') {
      for (const m of this.code.matchAll(/Pin\s*\(\s*(\w+)\s*,\s*Pin\.(?:OUT|OPEN_DRAIN)/g)) {
        const n = this.pinArgValue(m[1]); if (n !== null) out.add(n);
      }
      for (const m of this.code.matchAll(/PWM\s*\(\s*Pin\s*\(\s*(\w+)/g)) {
        const n = this.pinArgValue(m[1]); if (n !== null) out.add(n);
      }
      return out;
    }
    for (const args of this.calls('pinMode')) {
      const [pin, mode] = args.split(',').map((x) => x && x.trim());
      if (/OUTPUT/i.test(mode || '')) { const n = this.pinArgValue(pin); if (n !== null) out.add(n); }
    }
    for (const name of ['digitalWrite', 'analogWrite', 'tone']) {
      for (const args of this.calls(name)) {
        const n = this.pinArgValue(args.split(',')[0]);
        if (n !== null) out.add(n);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ поведение ----
  flips(boardPinName) {
    const bp = this.boardPin(boardPinName);
    if (!bp) return 0;
    return this.trace.pinFlips?.[`${bp.part.id}:${bp.pin.num}`] || 0;
  }

  pwms(boardPinName) {
    const bp = this.boardPin(boardPinName);
    if (!bp) return [];
    return this.trace.pinPwm?.[`${bp.part.id}:${bp.pin.num}`] || [];
  }

  /** Максимальная яркость светодиода за время работы (0…1). */
  ledBrightness(partId = null) {
    const leds = this.trace.leds || {};
    if (partId) return leds[partId] || 0;
    return Math.max(0, ...Object.values(leds));
  }

  analog(bpcName) {
    const bp = this.boardPin(bpcName);
    if (!bp) return null;
    return this.trace.analog?.[`${bp.part.id}:${bp.pin.num}`] || null;
  }

  // ------------------------------------------------------------- тележка ----
  /** Наблюдения за роботом-тележкой: пробег, время на линии, круги, скорость. */
  car(partId = null) {
    const cars = this.trace.linecar || {};
    const empty = {
      distance: 0, onLine: 0, offLine: 0, changes: 0, laps: 0, seconds: 0,
      avgSpeed: 0, speed: 0, pose: null, sensors: [false, false],
    };
    const entry = partId ? cars[partId] : Object.values(cars)[0];
    return entry ? { ...empty, ...entry } : empty;
  }

  /** Какая доля времени тележка видела линию (0…1). */
  carLineShare(partId = null) {
    const c = this.car(partId);
    const t = c.onLine + c.offLine;
    return t > 0.2 ? c.onLine / t : 0;
  }

  /** Точечная картинка матрицы MAX7219: сколько точек горит и где. */
  grid(partId = null) {
    const grids = this.trace.grids || {};
    const g = partId ? grids[partId] : Object.values(grids)[0];
    return Array.isArray(g) ? g : [];
  }

  /** Наибольший ток, который видел датчик ACS712 (амперы). */
  currentSeen(partId = null) {
    const all = this.trace.acs || {};
    return Number(partId ? all[partId] : Math.max(0, ...Object.values(all))) || 0;
  }

  /** Текст, который виден на дисплеях (LCD или OLED). */
  displays() {
    return Object.values(this.trace.lcd || {}).map((lines) => (Array.isArray(lines) ? lines.join(' ') : ''));
  }

  /** Сколько точек горит на матрице. */
  litDots(partId = null) {
    return this.grid(partId).flat().filter(Boolean).length;
  }

  serialText() { return (this.trace.serial || []).join('\n'); }
  ran() { return Boolean(this.trace.hasRun); }
}

// ---------------------------------------------------------------- проверка ----

function runOne(check, cx) {
  try {
    const r = check.test(cx);
    if (r && typeof r === 'object') return { ok: Boolean(r.ok), detail: r.detail || '' };
    return { ok: Boolean(r), detail: '' };
  } catch (err) {
    return { ok: false, detail: `проверка сломалась: ${err.message}` };
  }
}

/**
 * Прогоняет все пункты задания.
 * @returns {{items: Array, passed: boolean, needRun: boolean, score: number}}
 */
export function evaluate(task, cx) {
  const items = task.checks.map((check) => {
    const { ok, detail } = runOne(check, cx);
    return {
      id: check.id,
      kind: check.kind,
      text: check.text,
      hint: check.hint || '',
      ok,
      detail,
      skipped: check.kind === 'behavior' && !cx.ran(),
    };
  });
  const needRun = items.some((i) => i.skipped);
  const passed = items.every((i) => i.ok);
  const done = items.filter((i) => i.ok).length;
  return { items, passed, needRun, score: Math.round((done / items.length) * 100) };
}
