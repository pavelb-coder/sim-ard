/**
 * runtime.js — рантайм одной платы: выводы, время, Serial, математика.
 *
 * Рантайм не знает про электрику: он спрашивает напряжения через readPin
 * и сообщает об изменениях через onPinChange. Всё остальное — дело circuit.js.
 *
 * Кроме Arduino-API здесь живёт «машинный» слой для MicroPython
 * (machinePin / pwmPin / sleepSeconds): транспайлер MicroPython превращает
 * Pin(25, Pin.OUT) в rt.machinePin(25, 'OUT'), и дальше работает тот же
 * самый код выводов.
 */

import { BOARDS } from './boards.js';

export class StopSketch extends Error {
  constructor() { super('остановлено пользователем'); this.name = 'StopSketch'; }
}

export class ArduinoRuntime {
  constructor(opts = {}) {
    this.spec = opts.spec || BOARDS.uno;
    this.boardId = opts.boardId || null;
    this.vcc = this.spec.vcc;
    this.adcMax = this.spec.adcMax;
    this.speedScale = opts.speedScale ?? 1;
    this.onSerial = opts.onSerial || (() => {});
    this.onFrame = opts.onFrame || (() => {});
    this.onPinChange = opts.onPinChange || (() => {});
    this.readPin = opts.readPin || (() => 0);
    this.onTone = opts.onTone || (() => {});
    this.onPulseIn = opts.onPulseIn || (() => 0);

    this.pins = new Map();
    const nums = this.spec.pins.filter((p) => typeof p.num === 'number').map((p) => p.num);
    for (const n of new Set(nums)) this.pins.set(n, { mode: 'INPUT', value: 0, pwm: 0 });

    this.stopped = false;
    this.startTime = performance.now();

    const rt = this;
    this.Serial = {
      _baud: 9600,
      begin(baud = 9600) { this._baud = baud; },
      print(...args) { rt.onSerial(args.map((a) => rt._fmt(a)).join('')); },
      println(...args) { rt.onSerial((args.length ? args.map((a) => rt._fmt(a)).join('') : '') + '\n'); },
      write(v) { rt.onSerial(String.fromCharCode(v & 0xff)); },
      flush() {},
      available() { return 0; },
      read() { return -1; },
      end() {},
    };
  }

  /** print() из MicroPython: аргументы через пробел, как в Python. */
  mpPrint(...args) {
    const s = args.map((a) => (typeof a === 'number' && !Number.isInteger(a) ? String(Math.round(a * 1e6) / 1e6) : this._fmt(a))).join(' ');
    this.onSerial(s + '\n');
  }

  _fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return String(v);
  }

  _frame() {
    return new Promise((resolve) => requestAnimationFrame(() => { this.onFrame(); resolve(); }));
  }

  pin(n) {
    if (typeof n === 'string') {
      const m = /^A(\d)$/i.exec(n.trim());
      if (m) {
        const analog = this.spec.pins.filter((p) => p.kind === 'analog');
        n = analog[Number(m[1])]?.num ?? Number(m[1]);
      } else n = Number(n);
    }
    n = Number(n) | 0;
    if (!this.pins.has(n)) this.pins.set(n, { mode: 'INPUT', value: 0, pwm: 0 });
    return this.pins.get(n);
  }

  // ------------------------------------------------------------- Arduino ----
  pinMode(n, mode) {
    const p = this.pin(n);
    p.mode = mode === 1 ? 'OUTPUT' : mode === 2 ? 'INPUT_PULLUP' : 'INPUT';
    this.onPinChange(n);
  }
  digitalWrite(n, v) {
    const p = this.pin(n);
    p.value = v ? 1 : 0;
    p.pwm = v ? 255 : 0;
    p.mode = 'OUTPUT';
    this.onPinChange(n);
  }
  digitalRead(n) {
    const p = this.pin(n);
    if (p.mode === 'OUTPUT') return p.value;
    return this.readPin(n) > this.vcc * 0.5 ? 1 : 0;
  }
  analogWrite(n, val) {
    const p = this.pin(n);
    p.pwm = Math.max(0, Math.min(255, Math.round(val)));
    p.value = p.pwm > 127 ? 1 : 0;
    p.mode = 'OUTPUT';
    this.onPinChange(n);
  }
  analogRead(n) {
    const v = this.readPin(typeof n === 'string' ? this._ax(n) : n);
    return Math.max(0, Math.min(this.adcMax, Math.round((v / this.vcc) * this.adcMax)));
  }
  _ax(name) {
    const m = /^A(\d)$/i.exec(String(name));
    if (m) {
      const analog = this.spec.pins.filter((p) => p.kind === 'analog');
      return analog[Number(m[1])]?.num ?? Number(m[1]);
    }
    return Number(name);
  }

  millis() { return Math.floor((performance.now() - this.startTime) / this.speedScale); }
  micros() { return Math.floor(((performance.now() - this.startTime) * 1000) / this.speedScale); }

  async delay(ms) {
    const target = performance.now() + Math.max(0, Number(ms) || 0) * this.speedScale;
    if (!(ms > 0)) { await this._frame(); if (this.stopped) throw new StopSketch(); return; }
    while (performance.now() < target) {
      if (this.stopped) throw new StopSketch();
      await this._frame();
    }
    if (this.stopped) throw new StopSketch();
  }
  async delayMicroseconds(us) {
    if (us > 1500) await this.delay(us / 1000);
    else await this._frame();
  }

  /** Длительность импульса на выводе в микросекундах (или 0 по таймауту). */
  pulseIn(pin, value, timeout = 1000000) {
    return this.onPulseIn(this.boardId, Number(pin), value ?? 1, timeout);
  }

  tone(n, freq, duration) { this.onTone(this.boardId, Number(n), freq, duration || 0, true); }
  noTone(n) { this.onTone(this.boardId, n === undefined ? null : Number(n), 0, 0, false); }

  map(x, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMin;
    return Math.round(outMin + ((x - inMin) * (outMax - outMin)) / (inMax - inMin));
  }
  constrain(x, a, b) { return Math.min(Math.max(x, a), b); }
  sq(x) { return x * x; }
  radians(d) { return (d * Math.PI) / 180; }
  degrees(r) { return (r * 180) / Math.PI; }
  randomSeed() {}
  random(a, b) {
    if (a === undefined) return Math.random();
    if (b === undefined) return Math.floor(Math.random() * a);
    return a + Math.floor(Math.random() * (b - a));
  }

  // ---------------------------------------------------- слой MicroPython ----
  machinePin(num, mode = 'IN') {
    const rt = this;
    const n = Number(num);
    const map = { OUT: 1, IN: 0, OPEN_DRAIN: 0, PULL_UP: 2, PULL_DOWN: 0 };
    if (mode === 'PULL_UP') this.pinMode(n, 2); else this.pinMode(n, map[mode] ?? 0);
    return {
      num: n,
      value(v) {
        if (v === undefined) return rt.digitalRead(n);
        rt.digitalWrite(n, v);
        return null;
      },
      on() { rt.digitalWrite(n, 1); },
      off() { rt.digitalWrite(n, 0); },
      toggle() { rt.digitalWrite(n, rt.pin(n).value ? 0 : 1); },
      init(m) { rt.pinMode(n, map[m] ?? 0); },
    };
  }
  pwmPin(num, freq = 1000) {
    const rt = this;
    const n = Number(num);
    this.pinMode(n, 1);
    return {
      num: n,
      freq(f) { if (f !== undefined) return f; return freq; },
      duty_u16(v) { rt.analogWrite(n, Math.round((v / 65535) * 255)); },
      duty(v) { rt.analogWrite(n, Math.round((v / 1023) * 255)); },
      deinit() { rt.pinMode(n, 0); },
    };
  }
  adcPin(num) {
    const rt = this;
    const n = Number(num);
    this.pinMode(n, 0);
    return { num: n, read_u16: () => Math.round((rt.analogRead(n) / rt.adcMax) * 65535), read: () => rt.analogRead(n) };
  }
  /** time.sleep(сек) / utime.sleep_ms(мс) — одна и та же задержка. */
  sleepSeconds(s) { return this.delay(Number(s) * 1000); }
  sleepMs(ms) { return this.delay(ms); }

  globals() {
    const m = {
      pinMode: this.pinMode.bind(this),
      digitalWrite: this.digitalWrite.bind(this),
      digitalRead: this.digitalRead.bind(this),
      analogRead: this.analogRead.bind(this),
      analogWrite: this.analogWrite.bind(this),
      pulseIn: this.pulseIn.bind(this),
      millis: this.millis.bind(this),
      micros: this.micros.bind(this),
      tone: this.tone.bind(this),
      noTone: this.noTone.bind(this),
      map: this.map.bind(this),
      constrain: this.constrain.bind(this),
      sq: this.sq.bind(this),
      radians: this.radians.bind(this),
      degrees: this.degrees.bind(this),
      random: this.random.bind(this),
      randomSeed: this.randomSeed.bind(this),
      Serial: this.Serial,
      rt: this,
      HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2,
      LED_BUILTIN: this.spec.builtinLed,
      PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2,
      min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt,
      pow: Math.pow, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      floor: Math.floor, ceil: Math.ceil, round: Math.round, fabs: Math.abs,
    };
    // A0… — это аналоговые выводы платы в её собственном порядке
    this.spec.pins.filter((p) => p.kind === 'analog').slice(0, 8).forEach((p, i) => {
      m[`A${i}`] = p.num;
    });
    return m;
  }

  stop() { this.stopped = true; }
}
