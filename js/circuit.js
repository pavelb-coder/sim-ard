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

export class Circuit {
  constructor(parts = [], wires = []) {
    this.parts = parts;
    this.wires = wires;
    this.pinNet = new Map();
    this.capState = new Map();   // partId -> { vprev }
    this.indState = new Map();   // partId -> { iprev }
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
    return this.groundNet;
  }

  // ------------------------------------------------------------ расчёт ----
  solve(runtimes, dt = 1 / 60) {
    const elements = [];
    this.warnings = [];
    const partInfo = new Map();
    const diodeIdx = new Map();
    const pwmNets = new Map();
    this.time += dt;

    const push = (el) => { elements.push(el); return elements.length - 1; };
    const gnd = this.groundNet;

    for (const p of this.parts) {
      const def = this.defOf(p);
      if (!def || def.board) continue;
      const n = (pin) => this.netOf(p.id, pin);
      const info = { brightness: 0, current: 0, voltage: 0, sounding: false };
      partInfo.set(p.id, info);

      switch (p.type) {
        case 'led': {
          const a = n('A'), k = n('K');
          if (a && k && a !== k) diodeIdx.set(p.id, push({ type: 'D', n1: a, n2: k, vf: 1.85, ron: 12, roff: 1e7 }));
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
        default: break;
      }
    }

    // платы
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
      const p = this.parts.find((q) => q.id === partId);
      const drive = pwmNets.get(this.netOf(partId, 'A')) || null;
      if (drive && drive.duty > 0.02) {
        // Решатель видит среднее напряжение ШИМ, а светодиод мигает на полном.
        // Пересчитываем «импульсный» ток (по паспортному падению 1,85 В) и
        // умножаем на скважность — получается честное визуальное диммирование.
        const vf = 1.85;
        const vOn = drive.duty * drive.vcc;
        const peak = vOn > vf + 0.05 ? I * (drive.vcc - vf) / (vOn - vf) : 0;
        info.brightness = Math.min(1.2, peak / 0.018) * drive.duty;
      } else {
        info.brightness = Math.min(1.2, I / 0.018);
      }
      if (I > 0.045) {
        this.warnings.push({
          text: `Светодиод «${this.nameOf(partId)}»: ток ${Math.round(I * 1000)} мА — на реальной плате он бы уже сгорел. Нужен резистор 220–330 Ом.`,
          level: 'danger',
        });
      } else if (I > 0.025) {
        this.warnings.push({ text: `Светодиод «${this.nameOf(partId)}»: ${Math.round(I * 1000)} мА — многовато, поставьте резистор побольше.`, level: 'warn' });
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
    return { ok: true, voltages: res.v, partInfo, warnings: this.warnings, iterations: res.iterations };
  }

  _netHasSource(elements, net) {
    return elements.some((e) => e.type === 'V' && (e.n1 === net || e.n2 === net));
  }

  nameOf(partId) {
    const p = this.parts.find((q) => q.id === partId);
    return p ? (this.defOf(p)?.name || p.type) : partId;
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
