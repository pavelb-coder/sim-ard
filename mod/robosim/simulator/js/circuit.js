/**
 * circuit.js — связка «схема ↔ физика ↔ скетчи».
 *
 * Собирает из деталей и проводов электрические узлы (union-find), строит
 * список элементов для solver.js и на каждом шаге пересчитывает цепь с
 * учётом того, что делают выводы плат:
 *   OUTPUT       — источник напряжения платы (5 В / 3,3 В) через 0,25 Ом;
 *   INPUT        — «воздух» (100 МОм на землю, чтобы матрица не вырождалась);
 *   INPUT_PULLUP — 20 кОм к шине питания.
 *
 * Земли всех плат считаются общими (в железе их всегда соединяют проводом) —
 * это единственное «допущение удобства» в модели, и оно описано в README.
 */

import { solveCircuit } from './solver.js';
import { BOARDS } from './boards.js';
import { CAR, newPose, sensorsOnLine, stepPose } from './linecar.js';

const boardSpecOf = (type) => BOARDS[type] || BOARDS.uno;

const R_OUT = 0.25;
const R_PULLUP = 20000;
const SOURCES = new Set(['battery9', 'batteryAA', 'psu']);
/** Измерительные приборы: испытательный ток омметра и предел по току. */
const TEST_I = 20e-6;      // 20 мкА — как у настоящего цифрового мультиметра в режиме Ω
const OHM_PARALLEL = 10e6; // входное сопротивление прибора в режиме Ω
const METER_MAX_A = 0.5;   // предел 0,5 А (в приборе предохранитель)
/** Питание платы: предохранитель на входе и защита от переполюсовки. */
const BOARD_FUSE = 1.5;    // А — больше плата не отдаёт в нагрузку
const FUSE_TIME = 0.15;    // с — столько держится КЗ, пока сгорит предохранитель
const VIN_MIN = -0.7;      // В — на входе питания отрицательное напряжение
const KE = 0.02;           // В·с/рад у мотора: 5 В без нагрузки ≈ 2400 об/мин
// Моторы тележки — TT с редуктором 1:48: обмотка 6 Ом, около 1250 об/мин на валу
const CAR_KE = 0.006, CAR_R = 6, CAR_J = 8e-6, CAR_FRIC = 1.23e-5;
const HFE = 100;                 // усиление BC547 — для модели ключа
// последовательность фаз 28BYJ-48 (IN1…IN4): полушаги по кругу
/** Числа для сообщений: 0,25 Вт, 32 мА, 5,2 В. */
const ru = (x, d = 2) => String(Number(x.toFixed(d))).replace('.', ',');
const fmtV = (v) => `${ru(v, v < 10 ? 2 : 1)} В`;
const fmtA = (a) => (a < 1 ? `${ru(a * 1000, 0)} мА` : `${ru(a, 2)} А`);
const fmtW = (w) => (w < 1 ? `${Math.round(w * 1000)} мВт` : `${ru(w, 2)} Вт`);
const STEP_SEQ = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'];

export class Circuit {
  constructor(parts = [], wires = []) {
    this.parts = parts;
    this.wires = wires;
    this.pinNet = new Map();
    this.capState = new Map();   // partId -> { vprev }
    this.indState = new Map();   // partId -> { iprev }
    this.stepState = new Map();  // partId -> { idx, angle, steps }  — фазы 28BYJ-48
    this.warnings = [];
    this.burnedNow = [];         // очередь «кто сгорел» — её забирает интерфейс
    this.time = 0;
    this.rebuild();
  }

  setSchematic(parts, wires) {
    this.parts = parts;
    this.wires = wires;
    this.rebuild();
  }

  defOf(p) { return p.__def || null; }

  boardParts() { return this.parts.filter((p) => this.defOf(p)?.board); }

  specOf(part) {
    return this.defOf(part)?.spec || boardSpecOf(part.type);
  }

  // ------------------------------------------------------------- узлы ----
  rebuild() {
    const parent = new Map();
    const find = (a) => {
      if (!parent.has(a)) parent.set(a, a);
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(a) !== r) { const n = parent.get(a); parent.set(a, r); a = n; }
      return r;
    };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

    const keys = [];
    for (const p of this.parts) {
      const def = this.defOf(p);
      if (!def) continue;
      for (const pin of def.pins(p)) { const k = `${p.id}:${pin.id}`; find(k); keys.push(k); }
    }
    for (const w of this.wires) union(`${w.a.compId}:${w.a.pin}`, `${w.b.compId}:${w.b.pin}`);

    // дубли питания на плате — те же шины
    for (const b of this.boardParts()) {
      for (const pin of this.defOf(b).pins(b)) {
        if (pin.aliasOf) union(`${b.id}:${pin.id}`, `${b.id}:${pin.aliasOf}`);
      }
    }

    const groups = new Map();
    for (const k of keys) {
      const r = find(k);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(k);
    }
    this.pinNet.clear();
    let n = 1;
    for (const [, members] of groups) {
      const id = `n${n++}`;
      for (const k of members) this.pinNet.set(k, id);
    }

    this.boards = this.boardParts().map((b) => ({
      part: b,
      spec: this.specOf(b),
      gndNet: this.pinNet.get(`${b.id}:GND`) || null,
      vccNet: this.pinNet.get(`${b.id}:${this.specOf(b).vccPin || '5V'}`) || null,
    }));
    this.groundNet = this.boards[0]?.gndNet || 'gnd';
  }

  netOf(compId, pin) { return this.pinNet.get(`${compId}:${pin}`) || null; }

  /** Шина питания, к которой логично тянуть подтяжки: первая найденная. */
  vccNet() {
    for (const b of this.boards) if (b.vccNet && b.vccNet !== this.groundNet) return b.vccNet;
    for (const p of this.parts) {
      if (!SOURCES.has(p.type)) continue;
      const net = this.netOf(p.id, '+');
      if (net && net !== this.groundNet) return net;
    }
    return this.groundNet;
  }

  // ------------------------------------------------------------ расчёт ----
  solve(runtimes, dt = 1 / 60) {
    const elements = [];
    this.warnings = [];
    const partInfo = new Map();
    const diodeIdx = new Map();
    const multiIdx = new Map();   // partId -> { канал: индекс диода } для RGB и 7-сегментника
    const sourceIdx = new Map();  // partId -> индекс источника (для тока)
    const supplyIdx = new Map();  // `${плата}:vcc` / `${плата}:${вывод}` -> индекс источника платы
    const elemIdx = new Map();    // partId -> индекс элемента (для тока через резистор)
    const pwmNets = new Map();
    this.time += dt;

    const push = (el) => { elements.push(el); return elements.length - 1; };
    const gnd = this.groundNet;
    // напряжения прошлого шага: нужны транзистору, реле и шаговому двигателю —
    // их состояние зависит от того, что было на выводах чуть раньше
    const prevV = (net) => (this._last && net ? (this._last.get(net) ?? 0) : 0);
    // ШИМ моделируем средним напряжением. Чтобы светодиод не «пропадал» на
    // малой скважности (среднее ниже падения на нём), порог его диода
    // сдвигаем: vf' = vf − (1−d)·(Vcc − vf). Тогда средний ток совпадает с
    // настоящим импульсным, а диммирование остаётся честным.
    const effVf = (net, vf) => {
      const d = dutyOf.get(net);
      if (!d || d.duty >= 0.995) return vf;
      return vf - (1 - d.duty) * (d.vcc - vf);
    };

    // Переключения, которые скетч сделал между кадрами: переводим в узлы схемы,
    // чтобы сдвиговые регистры увидели каждый фронт, а не только последний уровень.
    const pinEvents = [];
    for (const [boardId, rt] of runtimes || []) {
      if (!rt?.events?.length) continue;
      const board = this.boards.find((b) => b.part?.id === boardId || b.id === boardId);
      const spec = board?.spec || boardSpecOf(this.parts.find((p) => p.id === boardId)?.type);
      if (!spec) { rt.events.length = 0; continue; }
      for (const ev of rt.events) {
        const pin = spec.pins.find((q) => q.num === Number(ev.pin));
        const net = pin ? this.netOf(boardId, pin.id) : null;
        if (net) pinEvents.push({ net, v: ev.value });
      }
      rt.events.length = 0;
    }

    for (const board of this.boards) {
      const spec = board.spec;
      const g = board.gndNet || gnd;
      // сгоревшая плата — как вынутая из макетки: не питает и не управляет
      if (board.part?.props?.burned) continue;
      if (g !== gnd) push({ type: 'R', n1: g, n2: gnd, value: 0.001 });
      // Шину, замкнутую на землю проводом, источником не делаем: это не питание,
      // а короткое замыкание — его разберёт проверка питания в конце solve().
      if (board.vccNet && board.vccNet !== g) {
        supplyIdx.set(`${board.part.id}:vcc`, push({ type: 'V', n1: board.vccNet, n2: g, value: spec.vcc }));
      }
      // дополнительные шины платы: у Raspberry Pi 5 рядом с 3,3 В есть честные 5 В
      for (const rail of spec.rails || []) {
        const net = this.pinNet.get(`${board.part.id}:${rail.pin}`);
        if (!net || net === g) continue;
        supplyIdx.set(`${board.part.id}:${rail.pin}`, push({ type: 'V', n1: net, n2: g, value: rail.volts }));
      }

      const rt = runtimes?.get?.(board.part.id) || null;
      for (const pin of spec.pins) {
        if (typeof pin.num !== 'number') continue;
        const net = this.netOf(board.part.id, pin.id);
        if (!net) continue;
        const st = rt?.pins.get(pin.num);
        if (!st) continue;
        if (st.mode === 'OUTPUT') {
          const internal = `src_${board.part.id}_${pin.id}`;
          push({ type: 'R', n1: net, n2: internal, value: R_OUT });
          push({ type: 'V', n1: internal, n2: g, value: (st.pwm / 255) * spec.vcc });
          // ШИМ считаем средним напряжением (это верно для RC-фильтров и АЦП),
          // но яркость светодиода потом пересчитаем в «импульсную».
          if (st.pwm > 0 && st.pwm < 255) pwmNets.set(net, { duty: st.pwm / 255, vcc: spec.vcc });
        } else if (st.mode === 'INPUT_PULLUP') {
          push({ type: 'R', n1: net, n2: this.vccNet(), value: R_PULLUP });
        }
      }
    }

    // Скважность ШИМ известна только на выводе платы, а светодиод обычно
    // стоит за резистором. Разносим её по цепочке резисторов, не заходя на
    // шины питания и земли.
    const dutyOf = new Map(pwmNets);
    {
      const skip = new Set([gnd, this.vccNet()].filter(Boolean));
      for (const b of this.boards) { skip.add(b.gndNet); skip.add(b.vccNet); }
      const links = [];
      for (const p of this.parts) {
        const def = this.defOf(p);
        if (!def || def.board) continue;
        if (!['resistor', 'pot', 'ldr', 'inductor', 'button', 'toggle'].includes(p.type)) continue;
        const ids = def.pins(p).map((x) => x.id);
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = this.netOf(p.id, ids[i]), c = this.netOf(p.id, ids[j]);
            if (a && c && a !== c) links.push([a, c]);
          }
        }
      }
      for (let hop = 0; hop < 3; hop++) {
        for (const [a, c] of links) {
          if (dutyOf.has(a) && !dutyOf.has(c) && !skip.has(c)) dutyOf.set(c, dutyOf.get(a));
          else if (dutyOf.has(c) && !dutyOf.has(a) && !skip.has(a)) dutyOf.set(a, dutyOf.get(c));
        }
      }
    }

    for (const p of this.parts) {
      const def = this.defOf(p);
      if (!def || def.board) continue;
      const n = (pin) => this.netOf(p.id, pin);
      const info = { brightness: 0, current: 0, voltage: 0, sounding: false };
      partInfo.set(p.id, info);
      // сгоревшая деталь — это разрыв: ток через неё не идёт, пока её не заменят
      if (p.props?.burned) { info.burned = true; continue; }

      switch (p.type) {
        case 'led': {
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: effVf(a, 1.85), ron: 12, roff: 1e7 }));
          break;
        }
        case 'resistor': {
          const a = n('1'), b = n('2');
          if (a && b && a !== b) {
            const R = Math.max(0.1, Number(p.props?.value) || 220);
            elemIdx.set(p.id, push({ type: 'R', n1: a, n2: b, value: R }));
            info.ohms = R;
          }
          break;
        }
        case 'ldr': {
          const a = n('1'), b = n('2');
          const light = Math.min(1, Math.max(0, p.props?.light ?? 0.5));
          const R = 1e6 * Math.pow(1e-4, light);   // 1 МОм в темноте … 100 Ом на свету
          info.resistance = R;
          if (a && b && a !== b) push({ type: 'R', n1: a, n2: b, value: R });
          break;
        }
        case 'capacitor':
        case 'electrolytic': {
          const a = n('1'), b = n('2');
          const st = this.capState.get(p.id) || { vprev: 0 };
          if (a && b && a !== b) {
            push({ type: 'C', n1: a, n2: b, value: Math.max(1e-12, p.props?.farads ?? 1e-5), vprev: st.vprev });
          }
          info.state = st;
          break;
        }
        case 'inductor': {
          const a = n('1'), b = n('2');
          const st = this.indState.get(p.id) || { iprev: 0 };
          if (a && b && a !== b) push({ type: 'L', n1: a, n2: b, value: Math.max(1e-9, p.props?.henries ?? 1e-3), iprev: st.iprev });
          break;
        }
        case 'button': {
          const a = n('1'), b = n('2');
          if (a && b && a !== b) push({ type: 'R', n1: a, n2: b, value: p.props?.pressed ? 0.05 : 1e9 });
          break;
        }
        case 'pot': {
          const a = n('A'), b = n('B'), w = n('W');
          const R = Math.max(10, Number(p.props?.ohms) || 10000);
          const alpha = Math.min(1, Math.max(0, p.props?.value ?? 0.5));
          if (a && w && a !== w) push({ type: 'R', n1: a, n2: w, value: Math.max(1, R * alpha) });
          if (w && b && w !== b) push({ type: 'R', n1: w, n2: b, value: Math.max(1, R * (1 - alpha)) });
          break;
        }
        case 'acs712': {
          // Датчик тока: между IP+ и IP− лежит шунт 1,2 мОм — ток идёт через него.
          // Выход OUT — настоящий активный выход: 2,5 В в покое плюс 185 мВ на ампер.
          const ip = n('IP+'), im = n('IP-');
          if (ip && im && ip !== im) info.shuntIdx = push({ type: 'R', n1: ip, n2: im, value: 0.0012 });
          const out = n('OUT');
          const measured = Number(p.__acsI) || 0;          // ток, измеренный на прошлом шаге
          if (out) {
            const inner = `acs_${p.id}`;
            push({ type: 'R', n1: out, n2: inner, value: 22 });
            push({ type: 'V', n1: inner, n2: gnd, value: 2.5 + 0.185 * measured });
          }
          const vcc = n('VCC') || this.vccNet(), g2 = n('GND') || gnd;
          if (vcc && g2 && vcc !== g2) push({ type: 'R', n1: vcc, n2: g2, value: 3300 });
          break;
        }
        case 'reed': {
          // Геркон: контакты в стеклянной колбе. Поднесли магнит — цепь замкнута.
          const a1 = n('1'), b1 = n('2');
          if (a1 && b1 && a1 !== b1) {
            push({ type: 'R', n1: a1, n2: b1, value: p.props?.magnet ? 0.08 : 1e9 });
          }
          break;
        }
        case 'encoder': {
          // Квадратурный выход: CLK и DT переключаются со сдвигом на четверть
          // периода, а шаги считаются по последовательности этих уровней.
          const vcc = n('VCC') || this.vccNet(), g3 = n('GND') || gnd;
          const steps = Math.round(Number(p.props?.steps) || 0);
          const phase = ((steps % 4) + 4) % 4;
          const CLK = [1, 1, 0, 0][phase];
          const DT = [0, 1, 1, 0][phase];
          const clk = n('CLK'), dt = n('DT');
          if (clk) push({ type: 'R', n1: clk, n2: CLK ? (vcc || g3) : g3, value: 1000 });
          if (dt) push({ type: 'R', n1: dt, n2: DT ? (vcc || g3) : g3, value: 1000 });
          const sw = n('SW');
          if (sw) push({ type: 'R', n1: sw, n2: p.props?.pressed ? g3 : (vcc || g3), value: 1000 });
          break;
        }
        case 'pir': {
          // выход «тянет» либо к питанию, либо к земле — как настоящий push-pull
          const out = n('OUT'), vcc = n('VCC') || this.vccNet();
          const target = p.props?.motion ? vcc : gnd;
          if (out && out !== target) push({ type: 'R', n1: out, n2: target, value: 1000 });
          break;
        }
        case 'dht11': {
          const data = n('DATA'), vcc = n('VCC') || this.vccNet();
          if (data && vcc && data !== vcc) push({ type: 'R', n1: data, n2: vcc, value: 10000 });
          break;
        }
        // Аналоговый датчик: внутри модуля делитель, поэтому на выводе AO —
        // честное напряжение. 0 — земля, 1 — питание, analogRead читает это
        // как 0…1023, и скетч работает с реальными числами, а не с «магией».
        case 'mq2':
        case 'soil':
        case 'sound': {
          const out = n('AO'), vcc = n('VCC') || this.vccNet();
          const raw = Math.min(1, Math.max(0, Number(p.props?.value ?? 0)));
          // у датчика влажности почвы сухая земля даёт БОЛЬШЕ напряжения
          const v = p.type === 'soil' ? 1 - raw : raw;
          if (out && vcc && out !== vcc) push({ type: 'R', n1: out, n2: vcc, value: 1000 * (1 - v) + 1 });
          if (out && out !== gnd) push({ type: 'R', n1: out, n2: gnd, value: 1000 * v + 1 });
          const dout = n('DO');
          if (dout) {
            const target = raw > 0.5 ? (vcc || gnd) : gnd;      // порог компаратора модуля
            if (dout !== target) push({ type: 'R', n1: dout, n2: target, value: 1000 });
          }
          break;
        }
        // Шины I2C и 1-Wire: подтяжки к питанию. Плата видит на SDA/SCL
        // высокий уровень, как и на настоящей шине в покое.
        case 'rtc': {
          // DS3231 висит на I²C: подтяжки шины и небольшое питание самой платы.
          const vcc = n('VCC') || this.vccNet(), g4 = n('GND') || gnd;
          if (vcc && g4 && vcc !== g4) push({ type: 'R', n1: vcc, n2: g4, value: 12000 });
          for (const id of ['SDA', 'SCL']) {
            const pin = n(id);
            if (pin && vcc && pin !== vcc) push({ type: 'R', n1: pin, n2: vcc, value: 10000 });
          }
          break;
        }
        case 'max7219': {
          // Плата матрицы: входы SPI — обычные КМОП-входы, питание 5 В.
          const vcc = n('VCC') || this.vccNet(), g5 = n('GND') || gnd;
          if (vcc && g5 && vcc !== g5) push({ type: 'R', n1: vcc, n2: g5, value: 2200 });
          for (const id of ['DIN', 'CS', 'CLK']) {
            const pin = n(id);
            if (pin && g5 && pin !== g5) push({ type: 'R', n1: pin, n2: g5, value: 100000 });
          }
          break;
        }
        case 'mpu6050':
        case 'bmp280':
        case 'bh1750': {
          const vcc = n('VCC') || this.vccNet(), g = n('GND') || gnd;
          if (vcc && g && vcc !== g) push({ type: 'R', n1: vcc, n2: g, value: 4700 });
          for (const id of ['SDA', 'SCL']) {
            const pin = n(id);
            if (pin && vcc && pin !== vcc) push({ type: 'R', n1: pin, n2: vcc, value: 10000 });
          }
          break;
        }
        case 'ds18b20': {
          const vcc = n('VCC') || this.vccNet(), g = n('GND') || gnd, data = n('DATA');
          if (vcc && g && vcc !== g) push({ type: 'R', n1: vcc, n2: g, value: 22000 });
          if (data && vcc && data !== vcc) push({ type: 'R', n1: data, n2: vcc, value: 4700 });
          break;
        }
        // Параллельный LCD 1602: логика — обычные КМОП-входы (высокий импеданс,
        // на цепь не влияют), а светодиод подсветки A/K светится как настоящий.
        // В модуле уже стоит ограничительный резистор, поэтому 5 В на A и K —
        // это нормальные 18 мА, а не сгоревший светодиод.
        case 'lcd1602p': {
          const vdd = n('VDD') || this.vccNet(), vss = n('VSS') || gnd;
          if (vdd && vss && vdd !== vss) push({ type: 'R', n1: vdd, n2: vss, value: 2500 });  // сам модуль: ~2 мА
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: effVf(a, 3.2), ron: 100, roff: 1e7 }));
          for (const id of ['RS', 'RW', 'E', 'V0', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) {
            const pin = n(id);
            if (pin && vss && pin !== vss) push({ type: 'R', n1: pin, n2: vss, value: 1e7 });
          }
          break;
        }
        // Адресная лента / матрица / кольцо WS2812: вход DIN — обычный КМОП-вход
        // (на цепь не влияет), а питание лента потребляет честно: около 20 мА
        // на канал каждого светодиода, то есть до 60 мА на белый.
        case 'ws2812':
        case 'ws2812m':
        case 'ws2812r': {
          const vcc = n('5V'), g = n('GND') || gnd, din = n('DIN');
          if (din && g && din !== g) push({ type: 'R', n1: din, n2: g, value: 1e6 });
          const px = Array.isArray(p.props?.pixels) ? p.props.pixels : [];
          const bright = Math.max(0, Math.min(255, Number(p.props?.brightness ?? 255))) / 255;
          let sum = 0;
          for (const c of px) {
            if (!c) continue;
            sum += (Number(c[0] || 0) + Number(c[1] || 0) + Number(c[2] || 0)) / 765;
          }
          // 20 мА на канал: белый светодиод на полной яркости — 60 мА
          const amps = 0.001 + sum * 0.06 * bright;                 // холостой ток + светодиоды
          info.current = amps;
          // На первом расчёте предыдущих напряжений ещё нет — считаем питание
          // поданным, если провода есть, а дальше судим по настоящему напряжению.
          info.powered = Boolean(vcc && g && vcc !== g && (!this._last || prevV(vcc) - prevV(g) > 3.0));
          if (vcc && g && vcc !== g) {
            push({ type: 'R', n1: vcc, n2: g, value: Math.max(0.6, 5 / Math.max(amps, 0.002)) });
          }
          break;
        }
        case 'servo': {
          const a = n('VCC'), b = n('GND');
          const pwm = n('PWM');
          if (a && b && a !== b) push({ type: 'R', n1: a, n2: b, value: 1000 });
          if (pwm) info.servo = true;
          break;
        }
        case 'buzzer': {
          const a = n('1'), b = n('2');
          if (a && b && a !== b) push({ type: 'R', n1: a, n2: b, value: 100 });
          break;
        }
        case 'battery9':
        case 'batteryAA':
        case 'psu': {
          // Источник питания: идеальная ЭДС + внутреннее сопротивление.
          // Минус сажаем на общий узел отсчёта, чтобы схема работала и без
          // платы (в SPICE это узел 0 — «земля» прибора).
          const plus = n('+'), minus = n('−') || gnd;
          const volts = Math.max(1.5, Math.min(24, Number(p.props?.voltage) || (p.type === 'batteryAA' ? 6 : p.type === 'psu' ? 5 : 9)));
          info.source = volts;
          info.voltage = volts;
          if (plus) {
            const inner = `bat_${p.id}`;
            push({ type: 'R', n1: plus, n2: inner, value: 0.4 });      // внутреннее сопротивление
            const vi = push({ type: 'V', n1: inner, n2: minus, value: volts });
            sourceIdx.set(p.id, vi);
            if (minus !== gnd) push({ type: 'R', n1: minus, n2: gnd, value: 0.001 });
            if (plus !== gnd) push({ type: 'R', n1: plus, n2: gnd, value: 1e6 });  // чтобы узел не висел
            // замкнули клеммы проводом: остаётся только внутреннее сопротивление,
            // честные 22 А и предупреждение «КЗ» (plus и minus стали одним узлом)
            if (plus === minus) info.shorted = true;
          }
          break;
        }
        case 'multimeter': {
          // Цифровой мультиметр как в железе:
          //  • V — вход 1 МОм, цепь почти не нагружает;
          //  • A — шунт 0,1 Ом между COM и mA, прибор честно влияет на цепь;
          //  • Ω/ПИК — источник испытательного тока 20 мкА, по падению считаем R.
          const com = n('COM');
          const mode = p.props?.mode || 'V';
          info.mode = mode;
          if (com) {
            if (mode === 'A') {
              const a = n('mA');
              if (a && a !== com) info.shuntIdx = push({ type: 'R', n1: a, n2: com, value: 0.1 });
            } else if (mode === 'OHM' || mode === 'CONT') {
              const v = n('VΩ');
              if (v && v !== com) {
                info.testIdx = push({ type: 'I', n1: com, n2: v, value: TEST_I });   // ток втекает в VΩ
                push({ type: 'R', n1: v, n2: com, value: OHM_PARALLEL });
                push({ type: 'R', n1: com, n2: gnd, value: OHM_PARALLEL });
              }
            } else {
              const v = n('VΩ');
              if (v && v !== com) push({ type: 'R', n1: v, n2: com, value: 1e6 });
            }
          }
          break;
        }
        case 'logicprobe': {
          // Щуп 1 МОм на землю: на цепь не влияет, только смотрит уровень
          const sig = n('SIG'), g0 = n('GND') || gnd;
          if (sig && g0 && sig !== g0) push({ type: 'R', n1: sig, n2: g0, value: 1e6 });
          break;
        }
        case 'scope': {
          // Щупы осциллографа — 1 МОм на общий провод, как у настоящего прибора
          const g0 = n('GND') || gnd;
          for (const id of ['CH1', 'CH2']) {
            const net = n(id);
            if (net && g0 && net !== g0) push({ type: 'R', n1: net, n2: g0, value: 1e6 });
          }
          break;
        }
        case 'ledBicolor': {
          // два кристалла в одном корпусе, общий катод: красный и зелёный
          const k = n('K');
          const idx = ['A1', 'A2'].map((id) => {
            const a = n(id);
            return a && k && a !== k ? push({ type: 'D', n1: a, n2: k, vf: effVf(a, 1.85), ron: 12, roff: 1e8 }) : null;
          });
          multiIdx.set(p.id, { idx, kind: 'multi' });
          break;
        }
        case 'ledBar': {
          // линейка из десяти светодиодов с общим катодом
          const k = n('K');
          const idx = Array.from({ length: 10 }, (_, i) => {
            const a = n(String(i + 1));
            return a && k && a !== k ? push({ type: 'D', n1: a, n2: k, vf: effVf(a, 1.85), ron: 12, roff: 1e8 }) : null;
          });
          multiIdx.set(p.id, { idx, kind: 'multi' });
          break;
        }
        case 'traffic': {
          // светофорный модуль: три светодиода на общий минус
          const g0 = n('GND');
          const idx = ['R', 'Y', 'G'].map((id, i) => {
            const a = n(id);
            const vf = [1.85, 2.0, 2.6][i];
            return a && g0 && a !== g0 ? push({ type: 'D', n1: a, n2: g0, vf: effVf(a, vf), ron: 12, roff: 1e8 }) : null;
          });
          multiIdx.set(p.id, { idx, kind: 'multi' });
          break;
        }
        case 'pnp': {
          // PNP: открывается, когда база НИЖЕ эмиттера; ток течёт из эмиттера
          const b = n('B'), c = n('C'), e = n('E');
          if (e && b && e !== b) push({ type: 'D', n1: b, n2: e, vf: 0.68, ron: 30, roff: 2e8 });
          if (c && e && c !== e) {
            const veb = prevV(e) - prevV(b);
            const vec = prevV(e) - prevV(c);
            const ib = Math.max(0, (veb - 0.68) / 30);
            let rce = 1e8, on = false;
            if (ib > 2e-6 && vec > 0) {
              const ic = Math.min(0.3, HFE * ib);
              rce = Math.max(1.5, Math.min(1e7, vec / ic));
              on = rce < 40;
            }
            info.ib = ib;
            info.on = on;
            info.rce = rce;
            push({ type: 'R', n1: e, n2: c, value: rce });
          }
          break;
        }
        case 'mosfet': {
          // N-канальный MOSFET: затвор почти не потребляет ток,
          // канал открывается напряжением затвор-исток
          const g1 = n('G'), d1 = n('D'), s1 = n('S');
          if (g1 && s1 && g1 !== s1) push({ type: 'R', n1: g1, n2: s1, value: 1e7 });
          const vgs = prevV(g1) - prevV(s1);
          const open = vgs > 2.5;
          const rds = open ? Math.max(0.05, Math.min(1.5, 0.6 / (vgs - 1.6))) : 1e8;
          info.vgs = vgs;
          info.on = open;
          info.rds = rds;
          if (d1 && s1 && d1 !== s1) push({ type: 'R', n1: d1, n2: s1, value: rds });
          break;
        }
        case 'l298n': {
          // Два H-моста в одном модуле: канал A (ENA, IN1, IN2 → OUT1, OUT2)
          // и канал B (ENB, IN3, IN4 → OUT3, OUT4). Выход не идеальный: на
          // плечах моста падает около 1,8 В.
          const chan = (enId, inA, inB, outA, outB) => {
            // ENA/ENB — не только «включено/выключено»: ШИМ на этом выводе
            // задаёт скважность, а значит и среднее напряжение на моторе.
            const enNet = n(enId);
            // dutyOf хранит пару {duty, vcc}: без ШИМ остаётся «включено на полную»
            const dutyRec = enNet ? dutyOf.get(enNet) : null;
            const duty = enNet
              ? (dutyRec ? Math.min(1, Math.max(0, dutyRec.duty)) : (prevV(enNet) > 2.0 ? 1 : 0))
              : 0;
            const en = duty > 0.02;
            const a = prevV(n(inA)) > 2.0, b = prevV(n(inB)) > 2.0;
            const dir = en && a !== b ? (a ? 1 : -1) : 0;
            const drive = (id, volts) => {
              const net = n(id);
              if (!net) return;
              const inner = `l298_${p.id}_${id}`;
              push({ type: 'R', n1: net, n2: inner, value: 1.2 });
              push({ type: 'V', n1: inner, n2: gnd, value: volts });
            };
            // выходы «висят» и при выключенном мосте: слабая утечка на землю,
            // иначе цепь «мотор + два провода» остаётся без точки отсчёта
            for (const id of [outA, outB]) {
              const net = n(id);
              if (net && net !== gnd) push({ type: 'R', n1: net, n2: gnd, value: 1e6 });
            }
            if (dir) {
              const vccV = this.vccNet() ? (prevV(this.vccNet()) || 5) : 5;
              const hi = Math.max(0, (vccV - 1.8) * Math.min(1, duty));
              drive(dir > 0 ? outA : outB, hi);
              drive(dir > 0 ? outB : outA, 0);
            }
            return { en, dir, duty: dir ? duty : 0 };
          };
          const A = chan('ENA', 'IN1', 'IN2', 'OUT1', 'OUT2');
          const B = chan('ENB', 'IN3', 'IN4', 'OUT3', 'OUT4');
          info.enabled = A.en || B.en;
          info.dir = A.dir;
          info.dirB = B.dir;
          info.dutyA = A.duty;
          info.dutyB = B.duty;
          break;
        }
        case 'linecar': {
          // Робот-тележка: две обмотки моторов (как у отдельного мотора) и два
          // датчика линии. Датчик — компаратор модуля TCRT5000: над белым полем
          // выход притянут к 5 В, над чёрной линией — к земле.
          const st = p.__car || (p.__car = { wL: 0, wR: 0 });
          const vcc = n('5V') || this.vccNet(), g = n('GND') || gnd;
          const winding = (aId, bId, w) => {
            const a = n(aId), b = n(bId);
            if (!a || !b || a === b) return null;
            const inner = `car_${p.id}_${aId.replace(/[^A-Za-z0-9]/g, '')}`;
            push({ type: 'R', n1: a, n2: inner, value: CAR_R });
            return push({ type: 'V', n1: inner, n2: b, value: CAR_KE * w });
          };
          info.motorIdxL = winding('M1+', 'M1-', st.wL);
          info.motorIdxR = winding('M2+', 'M2-', st.wR);
          const on = Array.isArray(p.props?.sensors) ? p.props.sensors : [false, false];
          ['SL', 'SR'].forEach((id, i) => {
            const pin = n(id);
            if (!pin) return;
            const target = on[i] ? gnd : vcc;
            if (target && pin !== target) push({ type: 'R', n1: pin, n2: target, value: 1000 });
          });
          if (vcc && g && vcc !== g) push({ type: 'R', n1: vcc, n2: g, value: 1000 });   // электроника тележки
          info.sensors = [!!on[0], !!on[1]];
          break;
        }
        case 'dcmotor': {
          // Мотор: обмотка 15 Ом + противо-ЭДС от скорости вращения.
          // Постоянная машины одна и та же для ЭДС и момента.
          const a = n('M+'), b = n('M-');
          const st = p.__motor || (p.__motor = { w: 0 });
          if (a && b && a !== b) {
            const inner = `motor_${p.id}`;
            const emf = KE * st.w;                     // В, против приложенного
            push({ type: 'R', n1: a, n2: inner, value: 15 });
            info.motorIdx = push({ type: 'V', n1: inner, n2: b, value: emf });
            info.voltage = prevV(a) - prevV(b);
          }
          info.rpm = st.w * 60 / (2 * Math.PI);
          info.angle = p.props.angle || 0;
          break;
        }
        case 'keypad': {
          // Матрица 4×4: нажатая клавиша — это резистор 120 Ом между строкой и столбцом
          const k = p.props?.pressed;
          if (k !== null && k !== undefined) {
            const i = Number(k);
            const rNet = n(`R${Math.floor(i / 4) + 1}`);
            const cNet = n(`C${(i % 4) + 1}`);
            if (rNet && cNet && rNet !== cNet) push({ type: 'R', n1: rNet, n2: cNet, value: 120 });
            info.pressed = i;
          }
          break;
        }
        case 'sr595': {
          // 74HC595: сдвиг по фронту SHCP, защёлка по фронту STCP.
          // Выходы — обычные двухтактные: 5 В через 0,25 Ом.
          const st = p.__sr595 || (p.__sr595 = { shift: [0, 0, 0, 0, 0, 0, 0, 0], latch: [0, 0, 0, 0, 0, 0, 0, 0], lastSh: 0, lastSt: 0 });
          const shNet = n('SHCP'), stNet = n('STCP'), dsNet = n('DS');
          let sh = prevV(shNet) > 2.0 ? 1 : 0;
          let stc = prevV(stNet) > 2.0 ? 1 : 0;
          let ds = prevV(dsNet) > 2.0 ? 1 : 0;
          const shiftIn = () => { st.shift = [ds, ...st.shift.slice(0, 7)]; };
          let shEdge = false, stEdge = false;
          // сначала все переключения этого кадра — по порядку, как в железе
          for (const ev of pinEvents) {
            if (ev.net === dsNet) ds = ev.v;
            else if (ev.net === shNet) { if (ev.v && !sh) { shiftIn(); shEdge = true; } sh = ev.v; }
            else if (ev.net === stNet) { if (ev.v && !stc) { st.latch = [...st.shift]; stEdge = true; } stc = ev.v; }
          }
          // фронт, который не поймали событиями (вывод просто был высоким)
          if (!shEdge && sh && !st.lastSh) shiftIn();
          if (!stEdge && stc && !st.lastSt) st.latch = [...st.shift];
          st.lastSh = sh;
          st.lastSt = stc;
          const oeNet = n('OE');
          const outOn = !oeNet || prevV(oeNet) < 2.0;
          info.bits = [...st.latch];
          info.enabled = outOn;
          'ABCDEFGH'.split('').forEach((ch, i) => {
            const net = n(`Q${ch}`);
            if (!net) return;
            const inner = `sr595_${p.id}_${i}`;
            push({ type: 'R', n1: net, n2: inner, value: 0.25 });
            push({ type: 'V', n1: inner, n2: gnd, value: outOn ? st.latch[i] * 5 : 0 });
          });
          break;
        }
        case 'sr165': {
          // 74HC165: параллельная загрузка при PL = 0 по фронту CP,
          // иначе сдвиг: Q7 выдаёт старший бит, на вход DS вдвигается новый
          const st = p.__sr165 || (p.__sr165 = { bits: [0, 0, 0, 0, 0, 0, 0, 0], lastCp: 0 });
          const cpNet = n('CP'), plNet = n('PL'), dsNet = n('DS');
          let cp = prevV(cpNet) > 2.0 ? 1 : 0;
          let pl = prevV(plNet);
          let ds = prevV(dsNet);
          const ceNet = n('CE');
          const enable = !ceNet || prevV(ceNet) < 2.0;
          const load = () => { st.bits = Array.from({ length: 8 }, (_, i) => (prevV(n(`D${7 - i}`)) > 2.0 ? 1 : 0)); };
          let cpEdge = false;
          for (const ev of pinEvents) {
            if (ev.net === plNet) { pl = ev.v; if (ev.v < 2.0) load(); }
            else if (ev.net === dsNet) ds = ev.v;
            else if (ev.net === cpNet) {
              if (ev.v && !cp && enable && pl >= 2.0) { st.bits = [...st.bits.slice(1), ds]; cpEdge = true; }
              cp = ev.v;
            }
          }
          if (pl < 2.0) load();
          // PL = 0 — параллельная загрузка (в любой момент, как в даташите),
          // PL = 1 — по каждому фронту CP биты сдвигаются к выходу Q7.
          // После загрузки первым из Q7 выходит D7 (старший бит), как при shiftIn(MSBFIRST).
          if (!cpEdge && cp && !st.lastCp && enable && pl >= 2.0) st.bits = [...st.bits.slice(1), ds];
          st.lastCp = cp;
          const q7 = n('Q7');
          info.q7 = !!st.bits[0];
          info.bits = [...st.bits];
          if (q7) {
            const inner = `sr165_${p.id}`;
            push({ type: 'R', n1: q7, n2: inner, value: 0.25 });
            push({ type: 'V', n1: inner, n2: gnd, value: st.bits[0] * 5 });
          }
          break;
        }
        case 'diode': {
          // кремниевый диод: 0,65 В вперёд, обратное направление заперто
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: effVf(a, 0.65), ron: 4, roff: 1e8 }));
          break;
        }
        case 'npn':
        case 'tip120': {
          // Биполярный транзистор как ключ с усилением (у Дарлингтона hFE≈1000):
          // переход база-эмиттер — диод, коллектор-эмиттер — резистор,
          // который открывается током базы (Ic ≈ hFE·Iб, не больше насыщения).
          const b = n('B'), c = n('C'), e = n('E');
          if (b && e && b !== e) push({ type: 'D', n1: b, n2: e, vf: p.type === 'tip120' ? 1.35 : 0.68, ron: 30, roff: 2e8 });
          if (c && e && c !== e) {
            const vbe = prevV(b) - prevV(e);
            const vce = prevV(c) - prevV(e);
            const ib = Math.max(0, (vbe - (p.type === 'tip120' ? 1.35 : 0.68)) / 30);
            let rce = 1e8, on = false;
            if (ib > 2e-6 && vce > 0) {
              const ic = Math.min(p.type === 'tip120' ? 5 : 0.3, (p.type === 'tip120' ? 1000 : HFE) * ib);        // предел корпуса — 300 мА
              rce = Math.max(1.5, Math.min(1e7, vce / ic));
              on = rce < 40;
            }
            info.ib = ib;
            info.on = on;
            info.rce = rce;
            push({ type: 'R', n1: c, n2: e, value: rce });
            if (ib > 0.03) {
              this.warnings.push({
                text: `Транзистор «${this.nameOf(p.id)}»: ток базы ${Math.round(ib * 1000)} мА — между выводом и базой нужен резистор 1–10 кОм.`,
                level: 'danger',
              });
            }
          }
          break;
        }
        case 'rgbled': {
          // три кристалла в одном корпусе, общий катод; у зелёного и синего выше падение
          const k = n('K');
          const chans = { R: [n('R'), 1.9], G: [n('G'), 2.6], B: [n('B'), 2.9] };
          const idx = {};
          for (const [ch, [anode, vf]] of Object.entries(chans)) {
            if (anode && k && anode !== k) idx[ch] = push({ type: 'D', n1: anode, n2: k, vf: effVf(anode, vf), ron: 12, roff: 1e8 });
          }
          multiIdx.set(p.id, { idx, kind: 'rgb' });
          break;
        }
        case 'toggle': {
          // тумблер на три вывода: 1 — общий, 2 — «вкл», 3 — «выкл»
          const c = n('1'), a = n('2'), b = n('3');
          const on = !!p.props?.on;
          if (c && a && c !== a) push({ type: 'R', n1: c, n2: a, value: on ? 0.05 : 1e9 });
          if (c && b && c !== b) push({ type: 'R', n1: c, n2: b, value: on ? 1e9 : 0.05 });
          break;
        }
        case 'relay': {
          // Катушка между VCC и GND, вход IN через резистор (в модуле стоит
          // транзистор-драйвер). Контакты гальванически развязаны: это
          // отдельные узлы, как в железе.
          const vcc = n('VCC'), gg = n('GND'), ctl = n('IN');
          if (vcc && gg && vcc !== gg) push({ type: 'R', n1: vcc, n2: gg, value: 70 });
          if (ctl && ctl !== gg) push({ type: 'R', n1: ctl, n2: gg || gnd, value: 10000 });
          const vin = prevV(ctl) - prevV(gg);
          const vcoil = vcc && gg ? prevV(vcc) - prevV(gg) : 0;
          const energized = vin > 2.5 && vcoil > 3.5;
          info.energized = energized;
          info.coil = vcoil;
          p.props.energized = energized;    // рисуем якорь по этому флагу
          const com = n('COM'), no = n('NO'), nc = n('NC');
          if (com && no && com !== no) push({ type: 'R', n1: com, n2: no, value: energized ? 0.02 : 1e9 });
          if (com && nc && com !== nc) push({ type: 'R', n1: com, n2: nc, value: energized ? 1e9 : 0.02 });
          break;
        }
        case 'joystick': {
          // два потенциометра по 10 кОм и кнопка, замыкающая SW на землю
          const vcc = n('VCC'), gg = n('GND');
          const px = Math.min(1, Math.max(-1, p.props?.x ?? 0));
          const py = Math.min(1, Math.max(-1, p.props?.y ?? 0));
          // a — доля от земли: 0 → вывод на земле, 1 → на питании
          const pair = (wiper, a) => {
            if (!wiper || !vcc || wiper === vcc) return;
            push({ type: 'R', n1: vcc, n2: wiper, value: Math.max(20, 10000 * Math.max(0.002, 1 - a)) });
            if (gg && wiper !== gg) push({ type: 'R', n1: wiper, n2: gg, value: Math.max(20, 10000 * Math.max(0.002, a)) });
          };
          pair(n('VRx'), (px + 1) / 2);
          pair(n('VRy'), (py + 1) / 2);
          const sw = n('SW');
          if (sw && gg && sw !== gg) push({ type: 'R', n1: sw, n2: gg, value: p.props?.pressed ? 0.05 : 1e9 });
          break;
        }
        case 'seg7': {
          // восемь диодов: каждый сегмент — свой светодиод на общий катод
          const com = n('COM');
          const idx = {};
          for (const seg of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) {
            const a = n(seg);
            if (a && com && a !== com) idx[seg] = push({ type: 'D', n1: a, n2: com, vf: effVf(a, 1.9), ron: 12, roff: 1e8 });
          }
          multiIdx.set(p.id, { idx, kind: 'seg7' });
          break;
        }
        case 'stepper28byj': {
          // ULN2003 — драйвер: входы высокоомные, катушки питаются от VCC/GND.
          // Поворот считаем по последовательности фаз на входах (см. STEP_SEQ).
          const vcc = n('VCC'), gg = n('GND');
          if (vcc && gg && vcc !== gg) push({ type: 'R', n1: vcc, n2: gg, value: 1500 });
          const ins = ['IN1', 'IN2', 'IN3', 'IN4'].map((id) => n(id));
          for (const net of ins) {
            if (net && gg && net !== gg) push({ type: 'R', n1: net, n2: gg, value: 22000 });
          }
          const phases = ins.map((net) => prevV(net) > 2.0);
          const st = this.stepState.get(p.id) || { idx: -1 };
          // Шаги считаем в «полушагах» вала: 4096 полушагов на оборот.
          // Если двигатель крутит библиотека Stepper, она сообщает шаги сама
          // (props.half обновляется из libraries.js) — по фазе их не угадать,
          // за один кадр выводы успевают переключиться много раз.
          const libOwned = Date.now() - (Number(p.props.libTick) || 0) < 150;
          let half = Number(p.props.half) || 0;
          if (!libOwned) {
            const key = phases.map((x) => (x ? '1' : '0')).join('');
            const idx = STEP_SEQ.indexOf(key);
            if (idx >= 0 && st.idx >= 0) {
              let d = (idx - st.idx + 8) % 8;
              if (d > 4) d -= 8;                     // короткий путь по кругу фаз
              if (Math.abs(d) <= 2) half += d;        // 1 — полушаг, 2 — полный
            }
            if (idx >= 0) st.idx = idx;
            else if (!phases.some(Boolean)) st.idx = -1;
          }
          this.stepState.set(p.id, st);
          p.props.half = half;
          p.props.angle = (((half * 360) / 4096) % 360 + 360) % 360;
          p.props.steps = Math.round(Math.abs(half) / 2);
          p.props.phases = phases;
          info.angle = p.props.angle;
          info.steps = p.props.steps;
          info.phases = phases;
          break;
        }
        default: break;
      }
    }

    // платы
    // третьи выводы платы (3V3/VIN) — просто источники, если это 3V3
    for (const p of this.boardParts()) {
      const spec = this.specOf(p);
      for (const pin of this.defOf(p).pins(p)) {
        if (pin.kind !== 'v33') continue;
        const net = this.netOf(p.id, pin.id);
        const g = this.boards.find((b) => b.part.id === p.id)?.gndNet || gnd;
        if (net && net !== g && !this._netHasSource(elements, net)) push({ type: 'V', n1: net, n2: g, value: 3.3 });
      }
    }

    const res = solveCircuit({ ground: gnd, elements, dt });
    if (!res.ok) {
      this.warnings.push({ text: res.error || 'Цепь не решается', level: 'danger' });
      return { ok: false, voltages: new Map(), partInfo, warnings: this.warnings };
    }

    // сохраняем состояние реактивных элементов
    for (const p of this.parts) {
      if (p.type === 'capacitor' || p.type === 'electrolytic') {
        const a = this.netOf(p.id, '1'), b = this.netOf(p.id, '2');
        const v = (a ? res.v.get(a) ?? 0 : 0) - (b ? res.v.get(b) ?? 0 : 0);
        this.capState.set(p.id, { vprev: v });
        const info = partInfo.get(p.id);
        if (info) info.voltage = Math.abs(v);
      }
    }

    // диагностика светодиодов
    for (const [partId, info] of partInfo) {
      const di = diodeIdx.get(partId);
      if (di === undefined) continue;
      const I = Math.abs(res.currents[di] || 0);
      info.current = I;
      // порог диода уже сдвинут под скважность, поэтому ток — средний
      info.brightness = Math.min(1.2, I / 0.018);
      if (I > 0.045) {
        this.warnings.push({
          text: `Светодиод «${this.nameOf(partId)}»: ток ${Math.round(I * 1000)} мА — на реальной плате он бы уже сгорел. Нужен резистор 220–330 Ом.`,
          level: 'danger',
        });
      } else if (I > 0.025) {
        this.warnings.push({ text: `Светодиод «${this.nameOf(partId)}»: ${Math.round(I * 1000)} мА — многовато, поставьте резистор побольше.`, level: 'warn' });
      }
    }

    // RGB-светодиод и 7-сегментный индикатор: яркость по каждому каналу
    const n0of = (partId) => (pin) => this.netOf(partId, pin);
    for (const [partId, m] of multiIdx) {
      const info = partInfo.get(partId);
      if (!info) continue;
      const n0 = n0of(partId);
      const bright = (di) => (di === undefined || di === null
        ? 0
        : Math.min(1.2, Math.abs(res.currents[di] || 0) / 0.018));
      if (m.kind === 'multi') {
        info.channels = m.idx.map((di) => bright(di));
        info.current = Math.max(0, ...info.channels);
        info.brightness = info.current;
        if (info.current > 2.2) {
          this.warnings.push({
            text: `«${this.nameOf(partId)}»: светодиоды перегружены — на каждый нужен резистор 220–330 Ом.`,
            level: 'danger',
          });
        }
      } else if (m.kind === 'rgb') {
        const chans = { R: n0('R'), G: n0('G'), B: n0('B') };
        for (const [ch, net] of Object.entries(chans)) {
          const b = bright(m.idx[ch]);
          info[ch] = b;
          if (b > 2.2) this.warnings.push({ text: `RGB «${this.nameOf(partId)}»: канал ${ch} перегружен — нужен резистор на каждый цвет.`, level: 'danger' });
        }
        info.channels = [info.R || 0, info.G || 0, info.B || 0];
        info.current = Math.max(info.R || 0, info.G || 0, info.B || 0);
      } else {
        info.segs = {};
        let worst = 0;
        for (const [seg, di] of Object.entries(m.idx)) {
          const net = n0(seg);
          const b = bright(di);
          info.segs[seg] = b;
          worst = Math.max(worst, b);
        }
        info.current = worst;
        if (worst > 2.2) this.warnings.push({ text: `Индикатор «${this.nameOf(partId)}»: сегменты перегружены — поставьте резисторы 220–330 Ом.`, level: 'danger' });
      }
    }

    // источники питания: ток и короткое замыкание
    for (const [partId, idx] of sourceIdx) {
      const info = partInfo.get(partId);
      if (!info) continue;
      const I = Math.abs(res.currents[idx] || 0);
      info.current = I;
      const p = this.parts.find((q) => q.id === partId);
      // клеммы источника, соединённые проводом: у лабораторного блока питания
      // сработает защита, а батарейка просто выйдет из строя
      if (p && info.shorted && p.type !== 'psu') {
        this._burn(p, `«${this.nameOf(partId)}» сгорел: короткое замыкание — клеммы «+» и «−» `
          + 'соединены проводом. Замените источник: кнопка «Сброс» берёт новый.', 'КЗ: клеммы источника');
        continue;
      }
      if (I > 2.5) {
        this.warnings.push({
          text: `«${this.nameOf(partId)}»: ток ${I.toFixed(1)} А — это короткое замыкание, в железе источник бы сел или сработала защита.`,
          level: 'danger',
        });
      } else if (I > 1.2 && p) {
        this.warnings.push({ text: `«${this.nameOf(partId)}»: ${I.toFixed(1)} А — многовато для источника.`, level: 'warn' });
      }
    }

    // Показания измерительных приборов считаем по уже решённой цепи:
    // вольтметр — разность потенциалов, амперметр — ток через свой шунт,
    // омметр — падение от испытательного тока (и предупреждение, если под U).
    const powered = this.boards.length > 0 || sourceIdx.size > 0;
    for (const p of this.parts) {
      const info = partInfo.get(p.id);
      if (!info) continue;
      if (p.type === 'multimeter') {
        const mode = info.mode || 'V';
        const com = this.netOf(p.id, 'COM');
        const V = (net) => (net && res.v.has(net) ? res.v.get(net) : 0);
        if (mode === 'A') {
          const I = Math.abs(res.currents[info.shuntIdx] || 0);
          info.reading = I;
          info.unit = 'А';
          info.overload = I > METER_MAX_A;
          if (info.overload) {
            this.warnings.push({
              text: `«${this.nameOf(p.id)}»: ${I.toFixed(2)} А — предел 0,5 А, в приборе сгорел бы предохранитель.`,
              level: 'danger',
            });
          }
        } else if (mode === 'OHM' || mode === 'CONT') {
          const dv = Math.abs(V(this.netOf(p.id, 'VΩ')) - V(com));   // полярность щупов не важна
          const rMeas = dv / TEST_I;
          // вычитаем собственные 10 МОм прибора — они включены параллельно
          const r = rMeas > 0 ? (rMeas * OHM_PARALLEL) / (OHM_PARALLEL - rMeas) : 0;
          info.resistance = Number.isFinite(r) && r > 0 ? r : Infinity;
          info.reading = info.resistance;
          info.unit = 'Ом';
          info.busy = powered;
          info.continuity = info.resistance < 30 && !powered;
          if (info.busy) {
            this.warnings.push({
              text: `«${this.nameOf(p.id)}»: замер сопротивления под напряжением — так делать нельзя, прибор покажет ерунду.`,
              level: 'warn',
            });
          }
        } else {
          info.reading = Math.abs(V(this.netOf(p.id, 'VΩ')) - V(com));
          info.unit = 'В';
        }
      } else if (p.type === 'logicprobe') {
        const sig = this.netOf(p.id, 'SIG');
        const v = sig ? (res.v.get(sig) ?? 0) : 0;
        info.voltage = v;
        const d = sig ? dutyOf.get(sig) : null;
        if (d && d.duty > 0.005 && d.duty < 0.995) {
          info.level = 'PULSE';
          info.freq = 490;
          info.duty = d.duty;
        } else {
          info.level = v > 2.2 ? 'HIGH' : v < 0.8 ? 'LOW' : 'MID';
        }
      }
    }

    // Моторы: механика. Момент пропорционален току, разгон и выбег —
    // по первому закону вращательного движения, как у настоящей машины.
    for (const p of this.parts) {
      if (p.type !== 'dcmotor') continue;
      const st = p.__motor;
      const info = partInfo.get(p.id);
      if (!st || !info) continue;
      const I = info.motorIdx != null ? (res.currents[info.motorIdx] || 0) : 0;
      const J = 2e-5, bFric = 4e-5;   // трение щёток и подшипников
      const dW = (KE * I - bFric * st.w) / J;
      st.w = Math.max(-400, Math.min(400, st.w + dW * dt));
      if (Math.abs(st.w) < 0.05 && Math.abs(I) < 0.001) st.w = 0;
      info.rpm = st.w * 60 / (2 * Math.PI);
      info.current = I;
      const angle = ((Number(p.props.angle) || 0) + st.w * dt * 57.2958) % 360;
      p.props.angle = angle;
      info.angle = angle;
    }

    // Робот-тележка: те же уравнения, что у мотора, но на два колеса.
    // Момент каждого мотора тянет своё колесо через редуктор 1:48, разность
    // скоростей колёс поворачивает тележку — как у настоящей дифференциальной
    // пары. Датчики при этом смотрят на реальную геометрию поля.
    for (const p of this.parts) {
      if (p.type !== 'linecar') continue;
      const st = p.__car;
      const info = partInfo.get(p.id);
      if (!st || !info) continue;
      const IL = info.motorIdxL != null ? (res.currents[info.motorIdxL] || 0) : 0;
      const IR = info.motorIdxR != null ? (res.currents[info.motorIdxR] || 0) : 0;
      st.wL = Math.max(-600, Math.min(600, st.wL + ((CAR_KE * IL - CAR_FRIC * st.wL) / CAR_J) * dt));
      st.wR = Math.max(-600, Math.min(600, st.wR + ((CAR_KE * IR - CAR_FRIC * st.wR) / CAR_J) * dt));
      if (Math.abs(st.wL) < 0.05 && Math.abs(IL) < 0.001) st.wL = 0;
      if (Math.abs(st.wR) < 0.05 && Math.abs(IR) < 0.001) st.wR = 0;
      const pose = p.props.pose || (p.props.pose = newPose());
      const move = stepPose(pose, st.wL, st.wR, dt);
      p.props.sensors = sensorsOnLine(pose);
      p.props.speed = move.v;
      const degL = (st.wL / CAR.gear) * dt * 57.2958;
      const degR = (st.wR / CAR.gear) * dt * 57.2958;
      p.props.angleL = ((Number(p.props.angleL) || 0) + degL) % 360;
      p.props.angleR = ((Number(p.props.angleR) || 0) + degR) % 360;
      info.angleL = p.props.angleL;
      info.angleR = p.props.angleR;
      info.speed = move.v;
      info.current = Math.abs(IL) + Math.abs(IR);
      info.rpmL = st.wL * 60 / (2 * Math.PI);
      info.rpmR = st.wR * 60 / (2 * Math.PI);
      st.odo = (st.odo || 0) + Math.abs(move.v) * dt;
      const anyOn = p.props.sensors.some(Boolean);
      st.tOn = (st.tOn || 0) + (anyOn ? dt : 0);
      st.tOff = (st.tOff || 0) + (anyOn ? 0 : dt);
      const prevOn = st.prevOn || [false, false];
      if (prevOn[0] !== p.props.sensors[0] || prevOn[1] !== p.props.sensors[1]) st.changes = (st.changes || 0) + 1;
      st.prevOn = p.props.sensors.slice();
      info.sensors = p.props.sensors;
      info.onLine = p.props.sensors.filter(Boolean).length;
      info.distance = st.odo;
      info.offLine = st.tOff;
      info.pose = { x: pose.x, y: pose.y, th: pose.th };
    }

    // зуммер звучит, если на нём есть напряжение
    for (const p of this.parts) {
      if (p.type !== 'buzzer') continue;
      const a = this.netOf(p.id, '1'), b = this.netOf(p.id, '2');
      const v = Math.abs((a ? res.v.get(a) ?? 0 : 0) - (b ? res.v.get(b) ?? 0 : 0));
      const info = partInfo.get(p.id);
      if (info) info.sounding = v > 1.0;
    }


    // ---- номиналы: перегрузка и перегорание -------------------------------
    // У каждой детали есть паспорт (js/parts.js → RATINGS). Считаем, что на ней
    // реально: напряжение между выводами, ток и мощность. Если больше номинала —
    // деталь дымится; если перегрузка держится два кадра — сгорает насовсем.
    for (const p of this.parts) {
      const def = this.defOf(p);
      if (!def || def.board) continue;
      const info = partInfo.get(p.id);
      if (!info || info.burned) continue;

      const pins = def.pins(p);
      let vmax = 0;
      for (let i = 0; i < pins.length; i++) {
        const a = this.netOf(p.id, pins[i].id);
        if (!a) continue;
        for (let j = i + 1; j < pins.length; j++) {
          const b = this.netOf(p.id, pins[j].id);
          if (!b) continue;
          const v = Math.abs((res.v.get(a) ?? 0) - (res.v.get(b) ?? 0));
          if (v > vmax) vmax = v;
        }
      }
      if (vmax) info.voltage = vmax;

      // ток: у резистора — из элемента, у светодиодов — по самому нагруженному каналу
      let amps = info.current || 0;
      const ri = elemIdx.get(p.id);
      if (ri != null) {
        amps = Math.abs(res.currents[ri] || 0);
        info.current = amps;
        info.power = amps * amps * (info.ohms || 220);
      }
      if (p.type === 'acs712') {
        const I = info.shuntIdx != null ? Math.abs(res.currents[info.shuntIdx] || 0) : 0;
        p.__acsI = I;                        // понадобится на следующем шаге для выхода
        info.amps = I;
        info.sensorVolts = 2.5 + 0.185 * I;
      }
      const m = multiIdx.get(p.id);
      if (m) {
        const vals = Object.values(m.idx).map((di) => (di == null ? 0 : Math.abs(res.currents[di] || 0)));
        amps = Math.max(0, ...vals);
        info.amps = amps;
      }

      const rate = def.rating;
      if (!rate) { p.__over = 0; continue; }
      const over = [];
      if (rate.vMax && vmax > rate.vMax) {
        over.push({ ratio: vmax / rate.vMax, txt: `${fmtV(vmax)} вместо ${fmtV(rate.vMax)}` });
      }
      if (rate.iMax && amps > rate.iMax) {
        over.push({ ratio: amps / rate.iMax, txt: `ток ${fmtA(amps)} вместо ${fmtA(rate.iMax)}` });
      }
      if (rate.pMax && info.power > rate.pMax) {
        over.push({ ratio: info.power / rate.pMax, txt: `${fmtW(info.power)} вместо ${fmtW(rate.pMax)}` });
      }
      // полярность: детали с «плюсом» и «минусом» не терпят обратного напряжения
      if (rate.vMin && rate.plus && rate.minus) {
        const a = this.netOf(p.id, rate.plus), b = this.netOf(p.id, rate.minus);
        if (a && b && a !== b) {
          const v = (res.v.get(a) ?? 0) - (res.v.get(b) ?? 0);
          if (v < rate.vMin) {
            over.push({
              ratio: v / rate.vMin,
              rev: true,
              txt: `${fmtV(Math.abs(v))} наоборот — ${rate.plus} на минусе, ${rate.minus} на плюсе`,
            });
          }
        }
      }
      if (!over.length) { p.__over = 0; continue; }

      const worst = p.__burnWorst = over.reduce((a, b) => (b.ratio > a.ratio ? b : a));
      const time = (p.__over = (p.__over || 0) + dt);
      if (time < 0.25) continue;          // 0,25 с перегрузки: короткий выброс деталь переживает

      const name = p.ref ? `${def.name} (${p.ref})` : def.name;
      const hint = worst.rev ? rate.revHint : rate.hint;
      const msg = `${name} сгорел: ${worst.rev ? 'перепутана полярность — ' : ''}${worst.txt}`
        + (hint ? ` — ${hint}.` : '.')
        + ' Замените деталь: кнопка «Сброс» берёт новые.';
      this._burn(p, msg, worst.rev ? 'переполюсовка' : worst.txt);
    }

    // ---- питание плат: короткое замыкание и переполюсовка ------------------
    // Плата — не «деталь с паспортом»: у неё на входе предохранитель и защита
    // от переполюсовки. Поэтому проверяем именно питание: шина, соединённая
    // с землёй проводом, и минус на VIN убивают плату, а слишком большой ток
    // через шину говорит о коротком замыкании где-то в монтаже.
    for (const board of this.boards) {
      const part = board.part, spec = board.spec;
      if (!part || part.props?.burned) continue;
      const info = partInfo.get(part.id) || (partInfo.set(part.id, {}), partInfo.get(part.id));
      const g = board.gndNet || gnd;
      const name = part.ref ? `${spec.name} (${part.ref})` : spec.name;
      const V = (net) => (net && res.v.has(net) ? res.v.get(net) : 0);
      const replace = ' Замените плату: кнопка «Сброс» берёт новую.';

      // 1) провод между шиной питания и землёй — классическое КЗ
      if (board.vccNet && board.vccNet === g) {
        this._burn(part, `${name} сгорела: короткое замыкание — вывод ${fmtV(spec.vcc)} соединён с GND проводом.${replace}`, 'КЗ: питание на земле');
        continue;
      }
      let railShort = null;
      for (const rail of spec.rails || []) {
        const net = this.pinNet.get(`${part.id}:${rail.pin}`);
        if (net && net === g) { railShort = rail; break; }
      }
      if (railShort) {
        this._burn(part, `${name} сгорела: короткое замыкание — шина ${railShort.pin} (${fmtV(railShort.volts)}) соединена с GND.${replace}`, `КЗ: шина ${railShort.pin} на земле`);
        continue;
      }
      // 1) переполюсовка: плюс источника пришёл на землю платы, а минус — на VIN.
      // Смотрим именно на соединения: земли всех плат в модели общие, поэтому
      // «минус на VIN» по напряжениям не отличить от нормального питания.
      const vinNet = this.pinNet.get(`${part.id}:VIN`);
      if (vinNet && vinNet !== g) {
        const rev = this.parts.find((s) => {
          if (!SOURCES.has(s.type) || s.props?.burned) return false;
          const plus = this.netOf(s.id, '+'), minus = this.netOf(s.id, '−');
          return plus && minus && plus === g && minus === vinNet;
        });
        if (rev) {
          this._burn(part, `${name} сгорела: переполюсовка питания — плюс источника пришёл на GND, `
            + `а минус на VIN. Поменяйте местами провода питания.${replace}`, 'переполюсовка питания');
          continue;
        }
        const v = V(vinNet) - V(g);
        if (v < VIN_MIN) {
          this._burn(part, `${name} сгорела: переполюсовка питания — на VIN ${fmtV(v)} вместо плюса. `
            + 'Поменяйте местами плюс и минус источника.' + replace, 'переполюсовка питания');
          continue;
        }
      }
      // 3) слишком большой ток через шину — где-то короткое замыкание в монтаже
      const idxs = [`${part.id}:vcc`, ...(spec.rails || []).map((r) => `${part.id}:${r.pin}`)]
        .map((k) => supplyIdx.get(k)).filter((i) => i != null);
      if (!idxs.length) continue;
      const amps = Math.max(0, ...idxs.map((i) => Math.abs(res.currents[i] || 0)));
      info.current = Math.max(info.current || 0, amps);
      if (amps <= BOARD_FUSE) { part.__over = 0; continue; }
      if ((part.__over = (part.__over || 0) + dt) < FUSE_TIME) continue;
      this._burn(part, `${name} сгорела: короткое замыкание — через питание идёт ${fmtA(amps)}, `
        + `предохранитель платы держит ${fmtA(BOARD_FUSE)}.${replace}`, 'КЗ: перегрузка по току');
    }

    this._last = res.v;
    try { this._duty = dutyOf; } catch { this._duty = null; }
    return { ok: true, voltages: res.v, partInfo, warnings: this.warnings, iterations: res.iterations };
  }

  /**
   * Сжечь деталь или плату: помечаем сгоревшей, пишем сообщение в монитор и в
   * очередь интерфейса. Сгоревшее — это разрыв: пока не нажмут «Сброс», деталь
   * не проводит ток, а плата ничего не питает.
   */
  _burn(part, msg, cause) {
    if (!part) return;
    part.props = part.props || {};
    part.props.burned = true;
    part.__over = 0;
    part.__burnedAt = this.time;
    this.warnings.push({ text: msg, level: 'danger' });
    this.burnedNow.push({ partId: part.id, text: msg, cause });
  }

  _netHasSource(elements, net) {
    return elements.some((e) => e.type === 'V' && (e.n1 === net || e.n2 === net));
  }

  nameOf(partId) {
    const p = this.parts.find((q) => q.id === partId);
    if (!p) return partId;
    if (p.ref && this.defOf(p)?.name) return `${this.defOf(p).name} ${p.ref}`;
    return this.defOf(p)?.name || p.type;
  }

  /** Скважность ШИМ на узле (если узел связан с ШИМ-выводом платы). */
  dutyOfNet(net) {
    const d = this._duty?.get(net);
    return d ? { duty: d.duty, vcc: d.vcc } : null;
  }

  pinVoltage(compId, pin) {
    const net = this.netOf(compId, pin);
    if (!net || !this._last) return null;
    return this._last.get(net) ?? null;
  }

  netVoltage(net) {
    if (!net || !this._last) return 0;
    return this._last.get(net) ?? 0;
  }

  /** Напряжение на выводе платы по номеру вывода. */
  voltageOf(boardId, pinNum) {
    if (!this._last) return 0;
    const spec = boardSpecOf(this.parts.find((p) => p.id === boardId)?.type);
    const pin = spec?.pins.find((q) => q.num === Number(pinNum));
    if (!pin) return 0;
    const net = this.netOf(boardId, pin.id);
    return net ? (this._last.get(net) ?? 0) : 0;
  }
}
