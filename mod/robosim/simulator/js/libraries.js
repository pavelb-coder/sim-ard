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
  ['adafruit_mpu6050.h', ['Adafruit_MPU6050', 'MPU6050']],
  ['adafruit_bmp280.h', ['Adafruit_BMP280']],
  ['adafruit_sensor.h', []],
  ['adafruit_bus_io.h', []],
  ['onewire.h', ['OneWire']],
  ['dallastemperature.h', ['DallasTemperature']],
  ['bh1750.h', ['BH1750']],
  ['liquidcrystal_i2c.h', ['LiquidCrystal_I2C']],
  ['liquidcrystal.h', ['LiquidCrystal']],
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

  /**
   * LCD 1602 по параллельному интерфейсу (HD44780) — библиотека LiquidCrystal.
   *
   * Конструктор, как в настоящей библиотеке, принимает номера выводов платы:
   *   LiquidCrystal lcd(12, 11, 5, 4, 3, 2);                  // 4 бита
   *   LiquidCrystal lcd(12, 11, 10, 5, 4, 3, 2);             // 4 бита + RW
   *   LiquidCrystal lcd(12, 11, 10, 5, 4, 3, 2, 1, 0, 7, 6); // 8 бит
   *
   * Экран библиотека находит по схеме: берёт деталь, у которой RS, E и линии
   * данных сидят на тех же выводах, — поэтому два экрана на одной схеме
   * не путаются между собой. Нет питания на VDD/VSS или RW поднят в «чтение» —
   * экран остаётся пустым, ровно как в железе.
   */
  class LiquidCrystal {
    constructor(...args) {
      const nums = args.map((x) => Number(x));
      this.rs = nums[0] ?? null;
      this.en = nums[1] ?? null;
      this.rw = null;
      this.data = [];
      this.bits = 4;
      if (nums.length >= 10) {                 // rs, rw, en, d0…d7
        this.rw = nums[1]; this.en = nums[2]; this.data = nums.slice(3, 11); this.bits = 8;
      } else if (nums.length === 7) {           // rs, rw, en, d4…d7
        this.rw = nums[1]; this.en = nums[2]; this.data = nums.slice(3, 7);
      } else {                                  // rs, en, d4…d7
        this.data = nums.slice(2, 6);
      }
      this.cols = 16; this.rows = 2;
      this._buf = Array.from({ length: 2 }, () => Array(16).fill(' '));
      this._col = 0; this._row = 0; this._on = true;
      this._part = null;
    }

    /** Выводы данных по именам: D4…D7 в 4-битном режиме, D0…D7 в 8-битном. */
    _dataIds() {
      const first = this.bits === 8 ? 0 : 4;
      return this.data.map((_, i) => `D${first + i}`);
    }

    /** Сколько выводов библиотеки реально попали на выводы этой детали. */
    _score(part) {
      const can = (name) => typeof bus.sameNet === 'function';
      if (!can()) return 0;
      let n = 0;
      if (this.rs != null && bus.sameNet(this.rs, part, 'RS')) n++;
      if (this.en != null && bus.sameNet(this.en, part, 'E')) n++;
      this._dataIds().forEach((id, i) => { if (this.data[i] != null && bus.sameNet(this.data[i], part, id)) n++; });
      return n;
    }

    _find() {
      if (this._part) return this._part;
      if (typeof bus.partsOfType !== 'function') return null;
      let best = null;
      let bestScore = 0;
      for (const part of bus.partsOfType('lcd1602p')) {
        const sc = this._score(part);
        if (sc > bestScore) { best = part; bestScore = sc; }
      }
      // одного случайного провода мало: нужны RS, E и хотя бы две линии данных
      if (best && bestScore >= 4) { this._part = best; return best; }
      return null;
    }

    /** Экран получает питание: VDD на 5 В и VSS на земле платы. */
    _powered(part) {
      if (typeof bus.poweredOn !== 'function') return true;
      return bus.poweredOn(part, 'VDD', 'VSS');
    }

    /**
     * RW, поднятый в высокий уровень, переводит HD44780 в режим чтения:
     * запись в него не проходит, и на экране ничего не меняется.
     */
    _writeAllowed(part) {
      if (this.rw == null || typeof bus.sameNet !== 'function' || typeof bus.voltageOfPin !== 'function') return true;
      if (!bus.sameNet(this.rw, part, 'RW')) return true;      // RW никуда не подключён — можно писать
      return (bus.voltageOfPin(this.rw) || 0) < 2.5;
    }

    begin(cols, rows) {
      if (cols && rows) {
        this.cols = cols; this.rows = rows;
        this._buf = Array.from({ length: rows }, () => Array(cols).fill(' '));
      }
      this._part = null;          // могли переподключить провода — ищем экран заново
      this._find();
      this._push();
    }
    init() { this.begin(); }
    clear() { this._buf = Array.from({ length: this.rows }, () => Array(this.cols).fill(' ')); this._push(); }
    home() { this._col = 0; this._row = 0; }
    setCursor(c, r) { this._col = Math.max(0, c | 0); this._row = Math.max(0, r | 0); }
    cursor() {} noCursor() {} blink() {} noBlink() {} display() {} noDisplay() {}
    scrollDisplayLeft() {} scrollDisplayRight() {} autoscroll() {} noAutoscroll() {}
    leftToRight() {} rightToLeft() {}
    createChar() {}
    backlight() { this._on = true; this._push(); }
    noBacklight() { this._on = false; this._push(); }
    print(v) {
      const part = this._find();
      if (part && !this._writeAllowed(part)) return;      // RW = HIGH: дисплей молчит
      for (const ch of String(v)) {
        if (this._row < this.rows && this._col < this.cols) this._buf[this._row][this._col] = ch;
        this._col++;
        if (this._col >= this.cols) { this._col = 0; this._row++; if (this._row >= this.rows) this._row = 0; }
      }
      this._push();
    }
    write(code) { this.print(typeof code === 'number' ? String.fromCharCode(code) : code); }
    _push() {
      const part = this._find();
      if (!part) return;
      const live = this._powered(part);
      part.props.lines = live ? this._buf.slice(0, 2).map((row) => row.join('')) : ['', ''];
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
   * Датчики-модули: значения живут в свойствах детали на схеме (их меняет
   * ученик мышью), а библиотека их читает — как настоящая, только вместо
   * байтов по I2C берёт число из «железа» симулятора.
   */
  const sensorPart = (cls, type) => {
    const find = () => bus.firstOfType(type);
    return { cls, find };
  };

  /** MPU-6050: акселерометр (±2 g), гироскоп (±250 °/с) и термометр. */
  class MPU6050 {
    constructor(addr = 0x68) { this.addr = addr; this._part = null; this._on = false; }
    _find() { if (!this._part) this._part = bus.firstOfType('mpu6050'); return this._part; }
    begin() {
      const p = this._find();
      this._on = !!p;
      if (p) { p.props.active = true; bus.changed(p); }
      return this._on;
    }
    /** Учебный метод: пересчитать показания (в железе это делает регистр). */
    readSensor() {
      const p = this._find();
      const tilt = (Number(p?.props?.tilt ?? 0) * Math.PI) / 180;
      const shake = Math.min(1, Math.max(0, Number(p?.props?.shake ?? 0)));
      const jitter = shake ? (Math.random() - 0.5) * 0.08 * shake : 0;
      this._a = { x: Math.sin(tilt) + jitter, y: jitter, z: Math.cos(tilt) + jitter / 2 };
      this._g = { x: 0, y: 0, z: shake * 250 + (shake ? (Math.random() - 0.5) * 20 : 0) };
      this._t = Number(p?.props?.temp ?? 28);
      return true;
    }
    _sync() { if (!this._a) this.readSensor(); return this; }
    accelX() { return this._sync()._a.x; }
    accelY() { return this._sync()._a.y; }
    accelZ() { return this._sync()._a.z; }
    gyroX() { return this._sync()._g.x; }
    gyroY() { return this._sync()._g.y; }
    gyroZ() { return this._sync()._g.z; }
    temperature() { return this._sync()._t; }
    /** Угол наклона вокруг оси Y — то, что обычно показывают на экране. */
    pitch() { return (Math.atan2(this.accelX(), this.accelZ()) * 180) / Math.PI; }
    roll() { return (Math.atan2(this.accelY(), this.accelZ()) * 180) / Math.PI; }
    getTemp() { return this.temperature(); }
  }
  const Adafruit_MPU6050 = MPU6050;

  /** BMP280: давление в паскалях, температура и высота над уровнем моря. */
  class Adafruit_BMP280 {
    constructor(addr = 0x76) { this.addr = addr; this._part = null; }
    _find() { if (!this._part) this._part = bus.firstOfType('bmp280'); return this._part; }
    begin() {
      const p = this._find();
      if (p) { p.props.active = true; bus.changed(p); }
      return !!p;
    }
    setSampling() {}
    readPressure() { return Number(this._find()?.props?.pressure ?? 1013) * 100; }   // Па
    readTemperature() { return Number(this._find()?.props?.temp ?? 24); }
    readAltitude(seaLevelHpa = 1013.25) {
      const p = this.readPressure() / 100;
      return 44330 * (1 - Math.pow(p / seaLevelHpa, 1 / 5.255));
    }
  }

  /** 1-Wire — заглушка шины: адрес устройства не нужен, датчик один. */
  class OneWire {
    constructor(pin) { this.pin = pin; }
    reset() { return true; }
    skip() {}
    write() {}
    read() { return 0; }
    select() {}
  }

  /** DS18B20: как в библиотеке DallasTemperature. */
  class DallasTemperature {
    constructor(oneWire = null) { this.wire = oneWire; }
    begin() { return !!bus.firstOfType('ds18b20'); }
    getDeviceCount() { return bus.firstOfType('ds18b20') ? 1 : 0; }
    requestTemperatures() {}
    getTempCByIndex(index = 0) {
      if (Number(index) !== 0) return -127;
      const p = bus.firstOfType('ds18b20');
      return p ? Number(p.props.temp ?? 24) : -127;
    }
    getTempC() { return this.getTempCByIndex(0); }
    setResolution() {}
  }

  /** BH1750: люксметр по I2C, показания в люксах. */
  class BH1750 {
    constructor(addr = 0x23) { this.addr = addr; this._part = null; }
    _find() { if (!this._part) this._part = bus.firstOfType('bh1750'); return this._part; }
    begin(mode = 0x10) {
      const p = this._find();
      if (p) { p.props.active = true; bus.changed(p); }
      return !!p;
    }
    configure(mode) {}
    setMode(mode) {}
    readLightLevel() { return Number(this._find()?.props?.lux ?? 300); }
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

  return {
    Servo, DHT, DHT11, Stepper, LiquidCrystal, LiquidCrystal_I2C, Adafruit_SSD1306,
    MPU6050, Adafruit_MPU6050, Adafruit_BMP280, OneWire, DallasTemperature, BH1750,
    Wire: { begin() {}, setClock() {} },
  };
}
