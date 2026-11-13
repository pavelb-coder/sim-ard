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

const boardSpecOf = (type) => BOARDS[type] || BOARDS.uno;

const R_OUT = 0.25;
const R_PULLUP = 20000;
const SOURCES = new Set(['battery9', 'batteryAA', 'psu']);
/** Измерительные приборы: испытательный ток омметра и предел по току. */
const TEST_I = 20e-6;      // 20 мкА — как у настоящего цифрового мультиметра в режиме Ω
const OHM_PARALLEL = 10e6; // входное сопротивление прибора в режиме Ω
const METER_MAX_A = 0.5;   // предел 0,5 А (в приборе предохранитель)
const HFE = 100;                 // усиление BC547 — для модели ключа
// последовательность фаз 28BYJ-48 (IN1…IN4): полушаги по кругу
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

    for (const board of this.boards) {
      const spec = board.spec;
      const g = board.gndNet || gnd;
      if (g !== gnd) push({ type: 'R', n1: g, n2: gnd, value: 0.001 });
      if (board.vccNet && board.vccNet !== g) push({ type: 'V', n1: board.vccNet, n2: g, value: spec.vcc });
      else if (board.vccNet && board.vccNet === g) this.warnings.push({ text: `${spec.name}: питание замкнуто на землю`, level: 'danger' });

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

      switch (p.type) {
        case 'led': {
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: effVf(a, 1.85), ron: 12, roff: 1e7 }));
          break;
        }
        case 'resistor': {
          const a = n('1'), b = n('2');
          if (a && b && a !== b) push({ type: 'R', n1: a, n2: b, value: Math.max(0.1, Number(p.props?.value) || 220) });
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
        case 'diode': {
          // кремниевый диод: 0,65 В вперёд, обратное направление заперто
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: effVf(a, 0.65), ron: 4, roff: 1e8 }));
          break;
        }
        case 'npn': {
          // Биполярный транзистор как ключ с усилением:
          // переход база-эмиттер — диод, коллектор-эмиттер — резистор,
          // который открывается током базы (Ic ≈ hFE·Iб, не больше насыщения).
          const b = n('B'), c = n('C'), e = n('E');
          if (b && e && b !== e) push({ type: 'D', n1: b, n2: e, vf: 0.68, ron: 30, roff: 2e8 });
          if (c && e && c !== e) {
            const vbe = prevV(b) - prevV(e);
            const vce = prevV(c) - prevV(e);
            const ib = Math.max(0, (vbe - 0.68) / 30);
            let rce = 1e8, on = false;
            if (ib > 2e-6 && vce > 0) {
              const ic = Math.min(0.3, HFE * ib);        // предел корпуса — 300 мА
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
      const bright = (di, net) => {
        if (di === undefined || !net) return 0;
        return Math.min(1.2, Math.abs(res.currents[di] || 0) / 0.018);
      };
      if (m.kind === 'rgb') {
        const chans = { R: n0('R'), G: n0('G'), B: n0('B') };
        for (const [ch, net] of Object.entries(chans)) {
          const b = bright(m.idx[ch], net);
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
          const b = bright(di, net);
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

    // зуммер звучит, если на нём есть напряжение
    for (const p of this.parts) {
      if (p.type !== 'buzzer') continue;
      const a = this.netOf(p.id, '1'), b = this.netOf(p.id, '2');
      const v = Math.abs((a ? res.v.get(a) ?? 0 : 0) - (b ? res.v.get(b) ?? 0 : 0));
      const info = partInfo.get(p.id);
      if (info) info.sounding = v > 1.0;
    }

    this._last = res.v;
    try { this._duty = dutyOf; } catch { this._duty = null; }
    return { ok: true, voltages: res.v, partInfo, warnings: this.warnings, iterations: res.iterations };
  }

  _netHasSource(elements, net) {
    return elements.some((e) => e.type === 'V' && (e.n1 === net || e.n2 === net));
  }

  nameOf(partId) {
    const p = this.parts.find((q) => q.id === partId);
    return p ? (this.defOf(p)?.name || p.type) : partId;
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
