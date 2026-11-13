/**
 * libraries.js — библиотеки Arduino, доступные скетчу по имени.
 *
 * Это не копии настоящих библиотек, а их «поведенческие» двойники: API
 * совпадает (Servo.write, LCD.print, display.display…), а данные библиотека
 * берёт у детали на схеме через bus — маленький посредник, который умеет
 * «какая деталь висит на этом выводе».
 *
 * #include в скетче можно писать как обычно: подключение проверяется по
 * таблице INCLUDES (см. ниже), неизвестная библиотека — понятная ошибка.
 */

/** Заголовки, которые мы «знаем». Значение — объект, который попадёт в скетч. */
const STEP_SEQ = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'];

export const INCLUDES = new Map([
  ['servo.h', ['Servo']],
  ['wire.h', []],
  ['dht.h', ['DHT', 'DHT11']],
  ['dht_u.h', ['DHT']],
  ['liquidcrystal_i2c.h', ['LiquidCrystal_I2C']],
  ['adafruit_ssd1306.h', ['Adafruit_SSD1306']],
  ['adafruit_gfx.h', []],
  ['spi.h', []],
  ['stepper.h', ['Stepper']],
  ['math.h', []],
  ['string.h', []],
  ['stdlib.h', []],
  ['stdio.h', []],
  ['eeprom.h', []],
  ['avr/pgmspace.h', []],
  ['avr/interrupt.h', []],
  ['math.h', []],
]);

export function checkIncludes(source) {
  const errors = [];
  const re = /#include\s*[<"]([^>"]+)[>"]/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1].trim().toLowerCase();
    if (!INCLUDES.has(name)) {
      errors.push(`Библиотека «${m[1]}» пока не поддерживается. Доступны: ${[...INCLUDES.keys()].join(', ')}`);
    }
  }
  return errors;
}

/**
 * @param {object} bus  { partOnPin(pinNum, type), firstOfType(type), changed(part) }
 */
export function createLibraries(bus) {
  /** Сервопривод: PWM не эмулируем потактово — важен угол и поведение API. */
  class Servo {
    constructor() { this.pin = null; this._part = null; this._angle = 90; }
    attach(pin) { this.pin = pin; this._part = bus.partOnPin(pin, 'servo'); this._apply(); }
    detach() { this._part = null; }
    write(a) { this._angle = Math.max(0, Math.min(180, Number(a) || 0)); this._apply(); }
    writeMicroseconds(us) { this.write(Math.round(((Number(us) - 544) * 180) / 1456)); }
    read() { return this._angle; }
    attached() { return !!this.pin; }
    _apply() {
      if (!this._part) return;
      this._part.props.angle = this._angle;
      bus.changed(this._part);
    }
  }

  /** DHT11: значения берём у детали (в её свойствах — температура и влажность). */
  class DHT {
    constructor(pin) { this.pin = pin; this._part = bus.partOnPin(pin, 'dht11'); }
    begin() { if (this._part) this._part.props.active = true; return this._part ? 0 : 1; }
    readTemperature() { return this._part ? Number(this._part.props.temp ?? 24) : NaN; }
    readHumidity() { return this._part ? Number(this._part.props.hum ?? 45) : NaN; }
    computeHeatIndex(t) { return t; }
  }
  const DHT11 = DHT;

  /** LCD 1602 по I2C: двухстрочный буфер в стиле LiquidCrystal_I2C. */
  class LiquidCrystal_I2C {
    constructor(addr = 0x27, cols = 16, rows = 2) {
      this.addr = addr; this.cols = cols; this.rows = rows;
      this._buf = Array.from({ length: rows }, () => Array(cols).fill(' '));
      this._col = 0; this._row = 0; this._on = true;
      this._part = null;
    }
    _find() {
      if (!this._part) this._part = bus.firstOfType('lcd1602');
      return this._part;
    }
    init() { this._push(); }
    begin(c, r) { if (c && r) { this.cols = c; this.rows = r; this._buf = Array.from({ length: r }, () => Array(c).fill(' ')); } this._push(); }
    backlight() { this._on = true; this._push(); }
    noBacklight() { this._on = false; this._push(); }
    clear() { this._buf = Array.from({ length: this.rows }, () => Array(this.cols).fill(' ')); this._push(); }
    home() { this._col = 0; this._row = 0; }
    setCursor(c, r) { this._col = Math.max(0, c | 0); this._row = Math.max(0, r | 0); }
    cursor() {}
    noCursor() {}
    blink() {}
    noBlink() {}
    display() {}
    createChar() {}
    setBacklight(v) { this._on = !!v; this._push(); }
    print(v) {
      const s = String(v);
      for (const ch of s) {
        if (this._row < this.rows && this._col < this.cols) this._buf[this._row][this._col] = ch;
        this._col++;
        if (this._col >= this.cols) { this._col = 0; this._row++; if (this._row >= this.rows) this._row = 0; }
      }
      this._push();
    }
    write(code) { this.print(typeof code === 'number' ? String.fromCharCode(code) : code); }
    setCursorPrint(c, r, s) { this.setCursor(c, r); this.print(s); }
    _push() {
      const part = this._find();
      if (!part) return;
      part.props.lines = this._buf.slice(0, 2).map((row) => row.join(''));
      part.props.backlight = this._on;
      bus.changed(part);
    }
  }

  /** OLED 128×64 на SSD1306: текстовый API в пиксельных координатах. */
  class Adafruit_SSD1306 {
    constructor(width = 128, height = 64) {
      this.w = width; this.h = height;
      this._size = 1; this._x = 0; this._y = 0;
      this._rows = Array.from({ length: Math.floor(height / 8) }, () => '');
    }
    begin() { return true; }
    clearDisplay() { this._rows = Array.from({ length: Math.floor(this.h / 8) }, () => ''); this._dirty = true; }
    display() { this._push(); }
    setTextSize(n) { this._size = n || 1; }
    setTextColor() {}
    setCursor(x, y) { this._x = x; this._y = y; }
    print(v) {
      const row = Math.min(this._rows.length - 1, Math.floor(this._y / 8));
      const col = Math.floor(this._x / 6);
      const prev = this._rows[row] || '';
      // текст «печатается» поверх старых пикселей, как на настоящем дисплее
      const base = prev.length >= col ? prev.slice(0, col) : prev.padEnd(col, ' ');
      const str = String(v);
      this._rows[row] = (base + str).slice(0, Math.floor(this.w / 6));
      this._dirty = true;
      this._x += str.length * 6;
      return this;
    }
    println(v = '') { this.print(v); this.setCursor(0, this._y + 8); }
    drawPixel() {} drawLine() {} drawRect() {} fillRect() {} drawCircle() {} fillCircle() {}
    startscrollright() {} stopscroll() {} dim() {} invertDisplay() {} ssd1306_command() {}
    _push() {
      const part = bus.firstOfType('oled');
      if (!part) return;
      part.props.lines = this._rows.slice();
      bus.changed(part);
    }
  }

  /**
   * Шаговый двигатель как в библиотеке Stepper: step() не блокирует скетч,
   * а ставит шаги в очередь; сама очередь «проворачивается» драйвером кадров
   * (bus.tickSteppers) — так же, как это делает таймер в железе.
   */
  class Stepper {
    constructor(stepsPerRev, p1, p2, p3, p4) {
      this.stepsPerRev = Math.max(1, Number(stepsPerRev) || 2048);
      this.pins = [p1, p2, p3, p4].filter((x) => x !== undefined && x !== null).map(Number);
      this.pinCount = this.pins.length;
      this._rpm = 10;
      this._pending = 0;         // сколько шагов осталось сделать (со знаком)
      this._phase = 0;           // индекс в последовательности
      this._acc = 0;             // накопленное время до следующего шага
      this._dir = 1;
      bus.addStepper(this);
    }
    setSpeed(rpm) { this._rpm = Math.max(0.1, Number(rpm) || 1); }
    step(steps) { this._pending += Math.round(Number(steps) || 0); }
    version() { return 1; }
    /** сколько шагов в секунду должно быть при текущей скорости */
    _rate() { return Math.max(0.5, (this._rpm * this.stepsPerRev) / 60); }

    /** Один «тик»: выдаёт на выводы столько шагов, сколько успело накопиться. */
    tick(dt, write) {
      if (!this._pending) return;
      this._dir = this._pending > 0 ? 1 : -1;
      this._acc += dt * this._rate();
      let guard = 0;
      while (this._acc >= 1 && this._pending && guard++ < 64) {
        this._acc -= 1;
        this._pending -= this._dir;
        this._phase = (this._phase + this._dir * 2 + 8) % 8;   // полный шаг = 2 полушага
        this._apply(write);
        if (bus.stepMotor) bus.stepMotor(this, this._dir);
      }
    }
    _apply(write) {
      const pat = STEP_SEQ[this._phase];
      if (this.pinCount === 4) {
        for (let i = 0; i < 4; i++) write(this.pins[i], pat[i] === '1' ? 1 : 0);
      } else if (this.pinCount === 2) {                 // биполярный вариант: 2 вывода
        write(this.pins[0], pat[0] === '1' ? 1 : 0);
        write(this.pins[1], pat[1] === '1' ? 1 : 0);
      }
    }
  }

  return { Servo, DHT, DHT11, Stepper, LiquidCrystal_I2C, Adafruit_SSD1306, Wire: { begin() {}, setClock() {} } };
}
