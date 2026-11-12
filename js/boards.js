/**
 * boards.js — описания плат. Одна таблица, из которой берётся всё:
 * геометрия выводов, логический уровень, разрядность АЦП и язык по умолчанию.
 *
 * Чтобы добавить плату, достаточно дописать сюда объект: рисовалка,
 * решатель цепей и рантайм подхватят её сами.
 *
 *   vcc        — напряжение логики (5 В у Uno, 3,3 В у ESP32 и Pico)
 *   adcMax     — максимум analogRead (1023 / 4095 / 65535)
 *   builtinLed — номер вывода со встроенным светодиодом
 *   languages  — какие языки доступны, defaultLang — какой открывается
 */

const d = (id, num, label = id) => ({ id, num, label, kind: 'digital' });
const an = (id, num, label = String(id)) => ({ id, num, label, kind: 'analog' });
const pwr = (id, label, kind, aliasOf) => ({ id, label, kind, aliasOf });

function row(count, x0, y, step, dir, make) {
  const out = [];
  for (let i = 0; i < count; i++) out.push({ ...make(i), x: x0 + i * step, y, dir });
  return out;
}

export const BOARDS = {
  uno: {
    id: 'uno',
    name: 'Arduino Uno',
    short: 'Uno',
    vcc: 5,
    vccPin: '5V',
    adcMax: 1023,
    builtinLed: 13,
    pwmPins: [3, 5, 6, 9, 10, 11],
    languages: ['cpp'],
    defaultLang: 'cpp',
    w: 250,
    h: 160,
    body: ['#1276b0', '#0a5786'],
    chip: 'ATmega328P',
    led: { x: 70, y: 36 },
    pins: [
      ...row(14, -102, -80, 14, 'up', (i) => d(`D${i}`, i)),
      { ...pwr('GND2', 'GND', 'gnd', 'GND'), x: 96, y: -80, dir: 'up' },
      { ...pwr('5V2', '5V', 'vcc', '5V'), x: 112, y: -80, dir: 'up' },
      ...row(6, -108, 80, 16.6, 'down', (i) => an(`A${i}`, 14 + i)),
      { ...pwr('GND', 'GND', 'gnd'), x: 20, y: 80, dir: 'down' },
      { ...pwr('5V', '5V', 'vcc'), x: 40, y: 80, dir: 'down' },
      { ...pwr('3V3', '3V3', 'v33'), x: 60, y: 80, dir: 'down' },
    ],
  },

  esp32: {
    id: 'esp32',
    name: 'ESP32 DevKit V1',
    short: 'ESP32',
    vcc: 3.3,
    vccPin: '3V3',
    adcMax: 4095,
    builtinLed: 2,
    pwmPins: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
    languages: ['cpp'],
    defaultLang: 'cpp',
    w: 250,
    h: 170,
    body: ['#2f3b46', '#1c242c'],
    chip: 'ESP32-WROOM',
    led: { x: 92, y: 40 },
    pins: [
      // верхний ряд — «обычные» GPIO, нижний — выводы с АЦП (ADC1)
      ...row(16, -97, -85, 13, 'up', (i) => { const n = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26][i]; return d(n, n, `G${n}`); }),
      ...row(6, -97, 85, 15, 'down', (i) => { const n = [32, 33, 34, 35, 0, 27][i]; return an(n, n, `G${n}`); }),
      { ...pwr('GND', 'GND', 'gnd'), x: 10, y: 85, dir: 'down' },
      { ...pwr('3V3', '3V3', 'v33'), x: 30, y: 85, dir: 'down' },
      { ...pwr('VIN', 'VIN', 'vin'), x: 50, y: 85, dir: 'down' },
    ],
  },

  pico: {
    id: 'pico',
    name: 'Raspberry Pi Pico',
    short: 'Pico',
    vcc: 3.3,
    vccPin: '3V3',
    adcMax: 65535,
    builtinLed: 25,
    pwmPins: Array.from({ length: 29 }, (_, i) => i),
    languages: ['mpy', 'cpp'],
    defaultLang: 'mpy',
    w: 220,
    h: 170,
    body: ['#1f4d3a', '#12301f'],
    chip: 'RP2040',
    led: { x: 80, y: 34 },
    pins: [
      // GP0…GP12, а четырнадцатым — GP25 (встроенный светодиод, есть у каждого Pico)
      ...row(14, -92, -85, 12, 'up', (i) => { const n = i < 13 ? i : 25; return d(n, n, `GP${n}`); }),
      { ...pwr('GND2', 'GND', 'gnd', 'GND'), x: 78, y: -85, dir: 'up' },
      { ...pwr('3V3_2', '3V3', 'v33', '3V3'), x: 92, y: -85, dir: 'up' },
      // ADC0…ADC2 — это GP26…GP28 (настоящий порядок выводов Pico), затем GP16…GP19
      ...row(7, -92, 85, 13, 'down', (i) => { const n = i < 3 ? 26 + i : 13 + i; return an(n, n, `GP${n}`); }),
      { ...pwr('GND', 'GND', 'gnd'), x: 10, y: 85, dir: 'down' },
      { ...pwr('3V3', '3V3', 'v33'), x: 24, y: 85, dir: 'down' },
      { ...pwr('VSYS', 'VSYS', 'vin'), x: 38, y: 85, dir: 'down' },
    ],
  },
};

export const boardOf = (type) => BOARDS[type] || BOARDS.uno;

/** Все числовые выводы платы (то, чем можно управлять из скетча). */
export function pinNumbers(spec) {
  return spec.pins.filter((p) => typeof p.num === 'number').map((p) => p.num);
}
