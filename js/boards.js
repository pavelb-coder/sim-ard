/**
 * boards.js — описания плат по настоящей геометрии.
 *
 * Размеры — в миллиметрах, как у реальных плат (Uno 68,58 × 53,34; ESP32 DevKit V1
 * 51,45 × 28,33; Pico 51 × 21). Выводы стоят там же, где на настоящей плате:
 * с шагом 2,54 мм, в том же порядке и с теми же разрывами между гребёнками
 * (у Uno это две отдельные колонки цифровых выводов, силовая и аналоговая).
 *
 * Координаты Uno взяты из чертежа Fritzing (сверено с официальным pinout),
 * ESP32 и Pico — из даташитов. Внутри детали координаты в пикселях:
 * (0,0) в центре платы, Y вниз (как в SVG), ось X вправо.
 *
 *   vcc        — напряжение логики (5 В у Uno, 3,3 В у ESP32 и Pico)
 *   adcMax     — максимум analogRead (1023 / 4095 / 65535)
 *   builtinLed — номер вывода со встроенным светодиодом
 *   silk       — что написано на шелкографии рядом с выводом
 */

import { PX_PER_MM } from './board-art.js';

const M = (v) => Math.round(v * PX_PER_MM * 10) / 10;

/** Вывод на верхнем/нижнем краю: xmm — расстояние от левого края платы. */
const top = (xmm, p) => ({ ...p, xmm, dir: 'up' });
const bot = (xmm, p) => ({ ...p, xmm, dir: 'down' });
const side = (ymm, dir, p) => ({ ...p, ymm, dir });

const d = (num, silk, extra = {}) => ({ id: `D${num}`, num, label: `D${num}`, silk, kind: 'digital', ...extra });
const an = (index, silk) => ({ id: `A${index}`, num: 14 + index, label: `A${index}`, silk, kind: 'analog' });
const pwr = (id, label, kind, aliasOf) => ({ id, label, silk: label, kind, ...(aliasOf ? { aliasOf } : {}) });

export const BOARDS = {
  // ------------------------------------------------------------ Arduino Uno ----
  // W 68,58 · H 53,34 · цифровые 2,54 мм от верхнего края, силовые и аналоговые — 50,8 мм
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
    wmm: 68.58,
    hmm: 53.34,
    padInset: 2.54,          // гребёнки стоят в 2,54 мм от края
    w: M(68.58),
    h: M(53.34),
    chip: 'ATmega328P',
    pins: [
      // верхняя гребёнка: SCL, SDA, AREF, GND, D13…D8, затем разрыв и D7…D0
      top(21.34, { id: 'SCL', label: 'SCL', silk: 'SCL', kind: 'none', decor: true }),
      top(23.88, { id: 'SDA', label: 'SDA', silk: 'SDA', kind: 'none', decor: true }),
      top(26.42, { id: 'AREF', label: 'AREF', silk: 'AREF', kind: 'none', decor: true }),
      top(28.96, pwr('GND2', 'GND', 'gnd', 'GND')),
      top(31.5, d(13, '13')),
      top(34.04, d(12, '12')),
      top(36.58, d(11, '~11')),
      top(39.12, d(10, '~10')),
      top(41.66, d(9, '~9')),
      top(44.2, d(8, '8')),
      top(48.26, d(7, '7')),
      top(50.8, d(6, '~6')),
      top(53.34, d(5, '~5')),
      top(55.88, d(4, '4')),
      top(58.42, d(3, '~3')),
      top(60.96, d(2, '2')),
      top(63.5, d(1, '1')),
      top(66.04, d(0, '0')),
      // нижняя гребёнка: питание и аналоговые входы
      bot(30.48, { id: 'IOREF', label: 'IOREF', silk: 'IOREF', kind: 'none', decor: true }),
      bot(33.02, { id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }),
      bot(35.56, pwr('3V3', '3V3', 'v33')),
      bot(38.1, pwr('5V', '5V', 'vcc')),
      bot(40.64, pwr('GND', 'GND', 'gnd')),
      bot(43.18, pwr('GND3', 'GND', 'gnd', 'GND')),
      bot(45.72, pwr('VIN', 'VIN', 'vin')),
      bot(53.34, an(0, 'A0')),
      bot(55.88, an(1, 'A1')),
      bot(58.42, an(2, 'A2')),
      bot(60.96, an(3, 'A3')),
      bot(63.5, an(4, 'A4')),
      bot(66.04, an(5, 'A5')),
      // второй +5 В — тот же вывод питания (в железе это один контакт 5V)
      { ...pwr('5V2', '5V', 'vcc'), xmm: 38.1, dir: 'down', silk: '', aliasOf: '5V' },
    ],
  },

  // ------------------------------------------------------- ESP32 DevKit V1 ----
  // W 51,45 · H 28,33 · два ряда по 15 выводов с шагом 2,54 мм, USB слева
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
    wmm: 51.45,
    hmm: 28.33,
    padInset: 2.735,         // два ряда по 15 выводов: 22,86 мм между рядами
    w: M(51.45),
    h: M(28.33),
    chip: 'ESP32-WROOM-32',
    labelInset: 19,
    pins: buildEsp32(),
  },

  // ------------------------------------------------------ Raspberry Pi Pico ----
  // W 51 · H 21 · 40 выводов по 2,54 мм по длинным сторонам, USB слева
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
    wmm: 51,
    hmm: 21,
    padInset: 1.61,          // зубчатые площадки у самого края
    w: M(51),
    h: M(21),
    chip: 'RP2040',
    labelInset: 15,
    pins: buildPico(),
  },
};

/** Ряды по 2,54 мм: 20 выводов на плате длиной 51 мм начинаются в 1,37 мм от края. */
function rowPositions(count, wmm, margin) {
  const span = wmm - margin * 2;
  const step = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => margin + i * step);
}

function buildEsp32() {
  const xs = rowPositions(15, 51.45, 7.945);       // 2,54 мм между выводами, по центру платы
  // левая колонка (в железе сверху вниз), при USB слева она идёт по верхнему краю справа налево
  const left = [
    ['3V3', pwr('3V3', '3V3', 'v33')],
    ['EN', { id: 'EN', label: 'EN', silk: 'EN', kind: 'none', decor: true }],
    ['VP', { id: 'G36', num: 36, label: 'G36', silk: 'VP', kind: 'analog' }],
    ['VN', { id: 'G39', num: 39, label: 'G39', silk: 'VN', kind: 'analog' }],
    ['IO34', { id: 'G34', num: 34, label: 'G34', silk: '34', kind: 'analog' }],
    ['IO35', { id: 'G35', num: 35, label: 'G35', silk: '35', kind: 'analog' }],
    ['IO32', { id: 'G32', num: 32, label: 'G32', silk: '32', kind: 'analog' }],
    ['IO33', { id: 'G33', num: 33, label: 'G33', silk: '33', kind: 'analog' }],
    ['IO25', { id: 'G25', num: 25, label: 'G25', silk: '25', kind: 'digital' }],
    ['IO26', { id: 'G26', num: 26, label: 'G26', silk: '26', kind: 'digital' }],
    ['IO27', { id: 'G27', num: 27, label: 'G27', silk: '27', kind: 'digital' }],
    ['IO14', { id: 'G14', num: 14, label: 'G14', silk: '14', kind: 'digital' }],
    ['IO12', { id: 'G12', num: 12, label: 'G12', silk: '12', kind: 'digital' }],
    ['GND', pwr('GND', 'GND', 'gnd')],
    ['IO13', { id: 'G13', num: 13, label: 'G13', silk: '13', kind: 'digital' }],
  ];
  const right = [
    ['VIN', pwr('VIN', 'VIN', 'vin')],
    ['GND', pwr('GND2', 'GND', 'gnd', 'GND')],
    ['IO23', { id: 'G23', num: 23, label: 'G23', silk: '23', kind: 'digital' }],
    ['IO22', { id: 'G22', num: 22, label: 'G22', silk: '22', kind: 'digital' }],
    ['TX0', { id: 'G1', num: 1, label: 'G1', silk: 'TX', kind: 'digital' }],
    ['RX0', { id: 'G3', num: 3, label: 'G3', silk: 'RX', kind: 'digital' }],
    ['IO21', { id: 'G21', num: 21, label: 'G21', silk: '21', kind: 'digital' }],
    ['IO19', { id: 'G19', num: 19, label: 'G19', silk: '19', kind: 'digital' }],
    ['IO18', { id: 'G18', num: 18, label: 'G18', silk: '18', kind: 'digital' }],
    ['IO5', { id: 'G5', num: 5, label: 'G5', silk: '5', kind: 'digital' }],
    ['TX2', { id: 'G17', num: 17, label: 'G17', silk: '17', kind: 'digital' }],
    ['RX2', { id: 'G16', num: 16, label: 'G16', silk: '16', kind: 'digital' }],
    ['IO4', { id: 'G4', num: 4, label: 'G4', silk: '4', kind: 'digital' }],
    ['IO2', { id: 'G2', num: 2, label: 'G2', silk: '2', kind: 'digital' }],
    ['IO15', { id: 'G15', num: 15, label: 'G15', silk: '15', kind: 'digital' }],
  ];
  // при повороте «USB влево» колонки читаются справа налево
  const upper = [...left].reverse().map(([, p], i) => top(xs[i], p));
  const lower = [...right].reverse().map(([, p], i) => bot(xs[i], p));
  return [...upper, ...lower];
}

function buildPico() {
  const xs = rowPositions(20, 51, 1.37);
  const needle = (n) => {
    if (n === 25) return { id: 'GP25', num: 25, label: 'GP25', silk: 'GP25', kind: 'digital' };
    const analog = n >= 26 && n <= 28;
    return { id: `GP${n}`, num: n, label: `GP${n}`, silk: `GP${n}`, kind: analog ? 'analog' : 'digital' };
  };
  const gnd = (i) => pwr(i === 0 ? 'GND' : `GND${i + 1}`, 'GND', 'gnd', i === 0 ? undefined : 'GND');
  // левая колонка (выводы 1…20) — по верхнему краю слева направо
  const upper = [
    needle(0), needle(1), gnd(0), needle(2), needle(3), needle(4), needle(5), gnd(1),
    needle(6), needle(7), needle(8), needle(9), gnd(2), needle(10), needle(11), needle(12),
    needle(13), gnd(3), needle(14), needle(15),
  ].map((p, i) => top(xs[i], p));
  // правая колонка (выводы 40…21) — по нижнему краю слева направо
  const lower = [
    pwr('VBUS', 'VBUS', 'vin', 'VSYS'),
    pwr('VSYS', 'VSYS', 'vin'),
    gnd(4),
    { id: '3V3_EN', label: '3V3_EN', silk: '3V3_EN', kind: 'none', decor: true },
    pwr('3V3', '3V3', 'v33'),
    { id: 'ADC_VREF', label: 'ADC_VREF', silk: 'ADC_VREF', kind: 'none', decor: true },
    needle(28), gnd(5), needle(27), needle(26),
    { id: 'RUN', label: 'RUN', silk: 'RUN', kind: 'none', decor: true },
    needle(22), gnd(6), needle(21), needle(20), needle(19), needle(18), gnd(7), needle(17), needle(16),
  ].map((p, i) => bot(xs[i], p));
  return [...upper, ...lower];
}

/**
 * Пересчёт миллиметров в координаты детали: (0,0) — центр платы, Y вниз.
 * Делается один раз при загрузке, чтобы дальше везде были готовые x/y.
 */
for (const spec of Object.values(BOARDS)) {
  const inset = spec.padInset ?? 2.54;      // мм от края до центра площадки
  spec.pins = spec.pins.map((p) => {
    const x = p.xmm != null ? M(p.xmm - spec.wmm / 2)
      : p.dir === 'right' ? M(spec.wmm / 2 - inset)
        : M(-spec.wmm / 2 + inset);
    const y = p.ymm != null ? M(p.ymm - spec.hmm / 2)
      : p.dir === 'up' ? M(-spec.hmm / 2 + inset) : M(spec.hmm / 2 - inset);
    return { ...p, x, y };
  });
}

export const boardOf = (type) => BOARDS[type] || BOARDS.uno;

/** Все числовые выводы платы (то, чем можно управлять из скетча). */
export function pinNumbers(spec) {
  return spec.pins.filter((p) => typeof p.num === 'number').map((p) => p.num);
}
