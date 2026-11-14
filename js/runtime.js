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

/**
 * Методы String из Arduino, которых нет в JavaScript.
 * Расширяем прототип один раз при загрузке модуля — так `s.toInt()` в скетче
 * работает без переписывания кода школьника.
 */
function extendString() {
  const P = String.prototype;
  if (P.toInt) return;
  Object.defineProperty(P, 'toInt', { value() { const n = parseInt(String(this).trim(), 10); return Number.isFinite(n) ? n : 0; }, configurable: true });
  Object.defineProperty(P, 'toFloat', { value() { const n = parseFloat(String(this).trim()); return Number.isFinite(n) ? n : 0; }, configurable: true });
  Object.defineProperty(P, 'equals', { value(o) { return String(this) === String(o); }, configurable: true });
  Object.defineProperty(P, 'equalsIgnoreCase', { value(o) { return String(this).toLowerCase() === String(o).toLowerCase(); }, configurable: true });
  Object.defineProperty(P, 'toCharArray', {
    value(buf, len) {
      const text = String(this);
      const n = Math.min(len ?? text.length, text.length);
      for (let i = 0; i < n; i++) buf[i] = text.charCodeAt(i) & 0xff;
      if (buf.length > n) buf[n] = 0;
      return n;
    },
    configurable: true,
  });
  // MicroPython: ' строка \n'.strip() / b'...'.decode() — в симуляторе строки уже str
  Object.defineProperty(P, 'strip', { value() { return String(this).trim(); }, configurable: true });
  Object.defineProperty(P, 'lstrip', { value() { return String(this).replace(/^\s+/, ''); }, configurable: true });
  Object.defineProperty(P, 'rstrip', { value() { return String(this).replace(/\s+$/, ''); }, configurable: true });
  Object.defineProperty(P, 'decode', { value() { return String(this); }, configurable: true });
  Object.defineProperty(P, 'encode', { value() { return String(this); }, configurable: true });
  Object.defineProperty(P, 'splitlines', { value() { return String(this).split(/\r?\n/); }, configurable: true });
  Object.defineProperty(P, 'remove', {
    value(idx) {
      const text = String(this);
      String.prototype.__rm = true;
      return idx < 0 ? text : text.slice(0, idx);
    },
    configurable: true,
  });
}

extendString();

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
    // то, что скетч отправляет «в USB» второй плате (Pi пишет в /dev/ttyACM0)
    this.onUsbWrite = opts.onUsbWrite || (() => {});
    // очередь принятых байт: USB-кабель, монитор порта, настоящая плата
    this.serialRx = [];

    this.pins = new Map();
    const nums = this.spec.pins.filter((p) => typeof p.num === 'number').map((p) => p.num);
    for (const n of new Set(nums)) this.pins.set(n, { mode: 'INPUT', value: 0, pwm: 0 });

    // Скетч может дёрнуть вывод несколько раз между двумя кадрами расчёта
    // (например, весь байт в сдвиговый регистр). Цепь эти переключения
    // должна увидеть по порядку, поэтому складываем их в очередь.
    this.events = [];

    this.stopped = false;
    this.startTime = performance.now();

    // EEPROM: у настоящего AVR это 1 КБ, которая переживает перезагрузку.
    // Здесь — таблица адресов, общая для всех запусков скетча на этой плате.
    this.eeprom = {
      _size: 1024,
      _mem: this.eepromStore || (this.eepromStore = new Map()),
      read(addr) { return this._mem.get(Number(addr) | 0) ?? 0; },
      write(addr, val) { this._mem.set(Number(addr) | 0, Number(val) & 0xff); },
      update(addr, val) { if (this.read(addr) !== (Number(val) & 0xff)) this.write(addr, val); },
      length() { return this._size; },
      get(addr, type) { return this.read(addr); },
      put(addr, val) { this.write(addr, val); },
    };

    const rt = this;
    this.Serial = {
      _baud: 9600,
      begin(baud = 9600) { this._baud = baud; },
      print(...args) { rt.onSerial(rt._fmtArgs(args)); },
      println(...args) { rt.onSerial((args.length ? rt._fmtArgs(args) : '') + '\n'); },
      printf(fmt, ...args) { rt.onSerial(rt._format(fmt, args)); },
      write(v) { rt.onSerial(String.fromCharCode(v & 0xff)); },
      flush() {},
      // Приём: байты приходят по USB с компьютера, от второй платы или из
      // монитора порта (js/app.js → feedSerial). В железе Serial читается так же.
      available() { return rt.serialRx.length; },
      peek() { return rt.serialRx.length ? (rt.serialRx[0] & 0xff) : -1; },
      read() { return rt.serialRx.length ? (rt.serialRx.shift() & 0xff) : -1; },
      readString() { return rt.readSerialUntil('\n', true); },
      readStringUntil(ch) {
        // В скетче перевод строки — это число 10, но из JS сюда может прийти и строка.
        const code = typeof ch === 'number' ? ch : (typeof ch === 'string' && ch ? ch.charCodeAt(0) : 10);
        return rt.readSerialUntil(String.fromCharCode(code), false);   // терминатор в строку не входит
      },
      setTimeout() {},
      end() {},
    };
  }

  /**
   * Байты «с провода USB»: их присылает вторая плата, монитор порта или
   * настоящая плата через Web Serial. Храним как числа 0…255, как в железе.
   */
  feedSerial(data) {
    const text = typeof data === 'string' ? data : String.fromCharCode(...data);
    // Храним коды символов как есть: в железе это байты, но нам важно не
    // потерять русские буквы (UTF-16 → & 0xff их бы испортил).
    for (const ch of text) this.serialRx.push(ch.codePointAt(0));
    if (this.serialRx.length > 8192) this.serialRx.splice(0, this.serialRx.length - 8192);
  }

  /** Прочитать из очереди до разделителя (или всё, что есть). */
  readSerialUntil(sep, keepTail = false) {
    if (!this.serialRx.length) return '';
    const idx = this.serialRx.indexOf(sep.charCodeAt(0));
    // Разделитель забираем из очереди всегда, как это делает Arduino;
    // в возвращаемую строку он попадает только при keepTail.
    const take = idx < 0 ? this.serialRx.length : idx + 1;
    const chars = this.serialRx.splice(0, take).map((c) => String.fromCharCode(c)).join('');
    return keepTail ? chars : chars.replace(sep, '');
  }

  /**
   * Порт /dev/ttyACM0 глазами Raspberry Pi: то же самое, что делает pyserial
   * на настоящем компьютере. Скетч MicroPython пишет `serial.Serial('/dev/ttyACM0')`.
   * Чтение неблокирующее: если данных нет — пустая строка, как при timeout=0.
   */
  usbSerial(port = '/dev/ttyACM0', baud = 9600) {
    const rt = this;
    return {
      port,
      baudrate: baud,
      timeout: 0,
      get in_waiting() { return rt.serialRx.length; },
      get inWaiting() { return rt.serialRx.length; },
      isOpen: true,
      readline() { return rt.readSerialUntil('\n', true); },
      read(n = 1) { return rt.serialRx.splice(0, Math.max(1, n | 0)).map((c) => String.fromCharCode(c)).join(''); },
      read_all() { return rt.serialRx.splice(0).map((c) => String.fromCharCode(c)).join(''); },
      write(data) {
        const text = typeof data === 'string' ? data : String.fromCharCode(...(data || []));
        rt.onUsbWrite(text);
        return text.length;
      },
      flush() {},
      close() {},
      __enter__() { return this; },
      __exit__() {},
    };
  }

  /** print() из MicroPython: аргументы через пробел, как в Python. */
  mpPrint(...args) {
    const s = args.map((a) => (typeof a === 'number' && !Number.isInteger(a) ? String(Math.round(a * 1e6) / 1e6) : this._fmt(a))).join(' ');
    this.onSerial(s + '\n');
  }

  /** print(x), print(x, HEX): во втором аргументе — система счисления. */
  _fmtArgs(args) {
    if (args.length >= 2 && typeof args[1] === 'number' && [10, 16, 2, 8].includes(args[1])) {
      return this._fmtNum(args[0], args[1]);
    }
    return args.map((a) => this._fmt(a)).join('');
  }

  _fmtNum(v, base) {
    const n = Math.trunc(Number(v) || 0);
    if (base === 16) return (n < 0 ? '-0x' : '0x') + Math.abs(n).toString(16).toUpperCase();
    if (base === 8) return (n < 0 ? '-0' : '0') + Math.abs(n).toString(8);
    if (base === 2) return (n < 0 ? '-0b' : '0b') + Math.abs(n).toString(2);
    return String(n);
  }

  /** Массив символов (char buf[16]) печатаем как строку — до первого нуля. */
  _fmtArray(arr) {
    if (!arr.length) return '';
    const chars = [];
    for (const el of arr) {
      if (el === 0 || el === '\u0000' || el === '' || el == null) break;
      if (typeof el === 'number') chars.push(String.fromCharCode(el & 0xff));
      else if (typeof el === 'string') chars.push(el[0]);
      else break;
    }
    return chars.join('');
  }

  _fmt(v) {
    if (Array.isArray(v)) return this._fmtArray(v);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v === undefined) return '';
    return String(v);
  }

  // ------------------------------------------------ помощь транспайлеру ----
  /** (int)x, (long)x — усечение и 32 бита, как у AVR. */
  i32(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) | 0 : 0; }
  b8(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) & 0xff : 0; }
  chr(v) { return typeof v === 'string' ? v : String.fromCharCode(Math.trunc(Number(v) || 0) & 0xff); }
  /** String(x) и String(x, HEX) */
  str(v, base) {
    if (base === 16) return Math.trunc(Number(v) || 0).toString(16).toUpperCase();
    if (base === 2) return Math.trunc(Number(v) || 0).toString(2);
    if (base === 8) return Math.trunc(Number(v) || 0).toString(8);
    if (typeof v === 'number' && !Number.isInteger(v)) return String(Math.floor(v * 100 + 0.5) / 100);
    return this._fmt(v);
  }
  /** sizeof(массив) — в элементах (как sizeof(a)/sizeof(a[0]) в C++). */
  sizeof(v) {
    if (Array.isArray(v)) return v.length;
    if (typeof v === 'string') return v.length;
    return 1;
  }

  /** Форматирование в стиле sprintf → строка (буфер пишут sprintf/snprintf). */
  _format(fmt, args) {
    const out = String(fmt).replace(
      /%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:l|h|hh|ll)?([diouxXeEfgGsc%])/g,
      (m, flags, width, prec, conv) => {
        if (conv === '%') return '%';
        let val = args.shift();
        let text;
        switch (conv) {
          case 'd': case 'i': text = String(Math.trunc(Number(val) || 0)); break;
          case 'u': text = String(Math.trunc(Number(val) || 0) >>> 0); break;
          case 'o': text = Math.trunc(Number(val) || 0).toString(8); break;
          case 'x': text = (Math.trunc(Number(val) || 0) >>> 0).toString(16); break;
          case 'X': text = (Math.trunc(Number(val) || 0) >>> 0).toString(16).toUpperCase(); break;
          case 'f': case 'e': case 'g': {
            const p = prec === undefined ? 2 : Number(prec);
            text = Number(val || 0).toFixed(p);
            break;
          }
          case 's': text = this._fmt(val); break;
          case 'c': text = typeof val === 'string' ? val[0] : String.fromCharCode(Math.trunc(Number(val) || 0) & 0xff); break;
          default: text = this._fmt(val);
        }
        const w = width ? Number(width) : 0;
        if (w > text.length) {
          const pad = (flags.includes('0') && conv !== 's' && conv !== 'c') ? '0' : ' ';
          text = flags.includes('-') ? text.padEnd(w, pad) : text.padStart(w, pad);
        }
        return text;
      },
    );
    return out;
  }

  _writeChars(buf, text, limit) {
    if (!buf) return 0;
    const cut = limit === undefined ? text.length : Math.min(text.length, limit - 1);
    for (let i = 0; i < cut; i++) buf[i] = text.charCodeAt(i) & 0xff;
    if (buf.length > cut) buf[cut] = 0;
    return cut;
  }

  /** sprintf(буфер, формат, …) — как в C: результат в буфер, вернули длину. */
  sprintf(buf, fmt, ...args) {
    const text = this._format(fmt, args);
    this._writeChars(buf, text);
    return text.length;
  }
  snprintf(buf, size, fmt, ...args) {
    const limit = Math.max(1, Number(size) || 1);
    const text = this._format(fmt, args);
    this._writeChars(buf, text, limit);
    return text.length;
  }

  /** dtostrf(значение, ширина, знаков, буфер) — из AVR-библиотеки stdlib. */
  dtostrf(val, width, prec, buf) {
    let text = Number(val || 0).toFixed(Math.max(0, Math.trunc(Number(prec) || 0)));
    const w = Math.trunc(Number(width) || 0);
    if (w > text.length) text = text.padStart(w, ' ');
    this._writeChars(buf, text);
    return text;
  }

  // ---------------------------------------------------- строки и биты ----
  strlen(a) { return Array.isArray(a) ? this._fmtArray(a).length : String(a).length; }
  strcpy(dst, src) { this._copyChars(dst, String(src)); return dst; }
  strncpy(dst, src, n) { this._copyChars(dst, String(src).slice(0, Math.max(0, n | 0))); return dst; }
  _copyChars(dst, text) {
    if (!Array.isArray(dst)) return;
    const len = Math.min(dst.length - 1, text.length);
    for (let i = 0; i < len; i++) dst[i] = text.charCodeAt(i) & 0xff;
    dst[len] = 0;
  }
  strcat(dst, src) { return this.strcpy(dst, this._fmtArray(dst) + String(src)); }
  strcmp(a, b) {
    const x = Array.isArray(a) ? this._fmtArray(a) : String(a);
    const y = Array.isArray(b) ? this._fmtArray(b) : String(b);
    return x === y ? 0 : (x < y ? -1 : 1);
  }
  strncmp(a, b, n) { return this.strcmp(String(a).slice(0, n), String(b).slice(0, n)); }
  atoi(v) { return Math.trunc(parseFloat(this._fmt(v))) || 0; }
  atol(v) { return this.atoi(v); }
  atof(v) { return parseFloat(this._fmt(v)) || 0; }
  itoa(v, buf, base = 10) { return this.strcpy(buf, Math.trunc(Number(v) || 0).toString(base)); }
  utoa(v, buf, base = 10) { return this.strcpy(buf, (Math.trunc(Number(v) || 0) >>> 0).toString(base)); }
  ltoa(v, buf, base = 10) { return this.strcpy(buf, Math.trunc(Number(v) || 0).toString(base)); }
  bitRead(x, n) { return (x >> n) & 1; }
  bitWrite(x, n, b) { return b ? (x | (1 << n)) : (x & ~(1 << n)); }
  bitSet(x, n) { return x | (1 << n); }
  bitClear(x, n) { return x & ~(1 << n); }
  bit(n) { return 1 << n; }
  lowByte(x) { return x & 0xff; }
  highByte(x) { return (x >> 8) & 0xff; }

  /** shiftOut(dataPin, clockPin, bitOrder, value) — как в железе, по одному биту. */
  shiftOut(dataPin, clockPin, bitOrder, value) {
    let v = Math.trunc(Number(value) || 0) & 0xff;
    for (let i = 0; i < 8; i++) {
      const bitOut = bitOrder === this.LSBFIRST ? (v & 1) : ((v & 0x80) ? 1 : 0);
      this.digitalWrite(dataPin, bitOut);
      this.digitalWrite(clockPin, 1);
      this.digitalWrite(clockPin, 0);
      v = bitOrder === this.LSBFIRST ? (v >> 1) : ((v << 1) & 0xff);
    }
  }
  /** shiftIn(dataPin, clockPin, bitOrder) — читаем байт по фронту такта. */
  shiftIn(dataPin, clockPin, bitOrder) {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      this.digitalWrite(clockPin, 1);
      const bitIn = this.digitalRead(dataPin);
      this.digitalWrite(clockPin, 0);
      if (bitOrder === this.LSBFIRST) value |= bitIn << i;
      else value = (value << 1) | (bitIn & 1);
    }
    return value & 0xff;
  }
  /** Прерывания не моделируются — вызовы молча ничего не делают. */
  attachInterrupt() {}
  detachInterrupt() {}
  digitalPinToInterrupt(pin) { return pin; }
  interrupts() {}
  noInterrupts() {}
  yield() {}

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
    const level = v ? 1 : 0;
    const changed = p.value !== level || p.mode !== 'OUTPUT';
    p.value = level;
    p.pwm = v ? 255 : 0;
    p.mode = 'OUTPUT';
    if (changed && this.events.length < 512) this.events.push({ pin: n, value: level });
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
      // препроцессор/predefined-константы Arduino
      HEX: 16, DEC: 10, OCT: 8, BIN: 2, LSBFIRST: 0, MSBFIRST: 1, ARDUINO: 10819,
      // типы пикселей Adafruit_NeoPixel: порядок байт и частота шины
      NEO_RGB: 0x06, NEO_RBG: 0x09, NEO_GRB: 0x52, NEO_GBR: 0xA0,
      NEO_BRG: 0x58, NEO_BGR: 0xE0, NEO_KHZ800: 0x0000, NEO_KHZ400: 0x0100,
      CHANGE: 1, RISING: 2, FALLING: 3, LED_BUILTIN: this.spec.builtinLed,
      // строки, символы, биты и вывод битов — как в avr-libc / Arduino
      i32: this.i32.bind(this), b8: this.b8.bind(this), chr: this.chr.bind(this),
      str: this.str.bind(this), sizeof: this.sizeof.bind(this),
      strlen: this.strlen.bind(this), strcpy: this.strcpy.bind(this), strncpy: this.strncpy.bind(this),
      strcat: this.strcat.bind(this), strcmp: this.strcmp.bind(this), strncmp: this.strncmp.bind(this),
      atoi: this.atoi.bind(this), atol: this.atol.bind(this), atof: this.atof.bind(this),
      itoa: this.itoa.bind(this), utoa: this.utoa.bind(this), ltoa: this.ltoa.bind(this),
      sprintf: this.sprintf.bind(this), snprintf: this.snprintf.bind(this), dtostrf: this.dtostrf.bind(this),
      bitRead: this.bitRead.bind(this), bitWrite: this.bitWrite.bind(this),
      bitSet: this.bitSet.bind(this), bitClear: this.bitClear.bind(this), bit: this.bit.bind(this),
      lowByte: this.lowByte.bind(this), highByte: this.highByte.bind(this),
      shiftOut: this.shiftOut.bind(this), shiftIn: this.shiftIn.bind(this),
      attachInterrupt: this.attachInterrupt.bind(this), detachInterrupt: this.detachInterrupt.bind(this),
      digitalPinToInterrupt: this.digitalPinToInterrupt.bind(this),
      interrupts: this.interrupts.bind(this), noInterrupts: this.noInterrupts.bind(this),
      EEPROM: this.eeprom,
    };
    // A0… — это аналоговые выводы платы в её собственном порядке
    this.spec.pins.filter((p) => p.kind === 'analog').slice(0, 8).forEach((p, i) => {
      m[`A${i}`] = p.num;
    });
    return m;
  }

  stop() { this.stopped = true; }
}
