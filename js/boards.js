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
      bot(33.02, { id: 'IOREF', label: 'IOREF', silk: 'IOREF', kind: 'none', decor: true }),
      bot(35.56, { id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }),
      bot(38.1, pwr('3V3', '3V3', 'v33')),
      bot(40.64, pwr('5V', '5V', 'vcc')),
      bot(43.18, pwr('GND', 'GND', 'gnd')),
      bot(45.72, pwr('GND3', 'GND', 'gnd', 'GND')),
      bot(48.26, pwr('VIN', 'VIN', 'vin')),
      bot(53.34, an(0, 'A0')),
      bot(55.88, an(1, 'A1')),
      bot(58.42, an(2, 'A2')),
      bot(60.96, an(3, 'A3')),
      bot(63.5, an(4, 'A4')),
      bot(66.04, an(5, 'A5')),
      // второй +5 В — тот же вывод питания (в железе это один контакт 5V)
      { ...pwr('5V2', '5V', 'vcc'), xmm: 40.64, dir: 'down', silk: '', aliasOf: '5V' },
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

  // ------------------------------------------------------ Raspberry Pi 5 --------
  // 85 × 56 мм, гребёнка 2×20 с шагом 2,54 мм. Как и у Pico, ряды развёрнуты
  // на противоположные края — так провода не путаются: нечётные выводы сверху,
  // чётные снизу, номера те же, что на настоящем разъёме (1…40).
  rpi5: {
    id: 'rpi5',
    name: 'Raspberry Pi 5',
    short: 'RPi 5',
    vcc: 3.3,                // логика 3,3 В, как у настоящего
    vccPin: '3V3',
    adcMax: 4095,
    builtinLed: null,        // пользовательского светодиода на плате нет
    pwmPins: [12, 13, 18, 19, 14, 15],
    languages: ['mpy'],
    defaultLang: 'mpy',
    wmm: 85,
    hmm: 56,
    padInset: 2.54,
    w: M(85),
    h: M(56),
    chip: 'BCM2712',
    labelInset: 24,
    rails: [{ pin: '5V', volts: 5 }],   // шина 5 В от USB-C-питания
    pins: buildRpi5(),
  },

  // ---------------------------------------------------------- Arduino Nano ----
  // W 43,18 · H 17,78 · два ряда по 15 выводов с шагом 2,54 мм, mini-USB слева
  nano: {
    id: 'nano',
    name: 'Arduino Nano',
    short: 'Nano',
    vcc: 5,
    vccPin: '5V',
    adcMax: 1023,
    builtinLed: 13,
    pwmPins: [3, 5, 6, 9, 10, 11],
    languages: ['cpp'],
    defaultLang: 'cpp',
    wmm: 43.18,
    hmm: 17.78,
    padInset: 1.27,
    w: M(43.18),
    h: M(17.78),
    chip: 'ATmega328P',
    pins: [
      // верхний ряд
      { ...{ id: 'D12', label: '12', silk: '12', kind: 'digital', num: 12 }, xmm: 3.81, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D11', label: '11', silk: '11', kind: 'digital', num: 11 }, xmm: 6.35, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D10', label: '10', silk: '10', kind: 'digital', num: 10 }, xmm: 8.89, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D9', label: '9', silk: '9', kind: 'digital', num: 9 }, xmm: 11.43, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D8', label: '8', silk: '8', kind: 'digital', num: 8 }, xmm: 13.97, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D7', label: '7', silk: '7', kind: 'digital', num: 7 }, xmm: 16.51, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D6', label: '6', silk: '6', kind: 'digital', num: 6 }, xmm: 19.05, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D5', label: '5', silk: '5', kind: 'digital', num: 5 }, xmm: 21.59, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D4', label: '4', silk: '4', kind: 'digital', num: 4 }, xmm: 24.13, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D3', label: '3', silk: '3', kind: 'digital', num: 3 }, xmm: 26.67, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D2', label: '2', silk: '2', kind: 'digital', num: 2 }, xmm: 29.21, ymm: 1.27, dir: 'up' },
      { ...{ id: 'GND', label: 'GND', silk: 'GND', kind: 'gnd' }, xmm: 31.75, ymm: 1.27, dir: 'up' },
      { ...{ id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 34.29, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D0', label: '0', silk: '0', kind: 'digital', num: 0 }, xmm: 36.83, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D1', label: '1', silk: '1', kind: 'digital', num: 1 }, xmm: 39.37, ymm: 1.27, dir: 'up' },
      // нижний ряд
      { ...{ id: 'D13', label: '13', silk: '13', kind: 'digital', num: 13 }, xmm: 3.81, ymm: 16.51, dir: 'down' },
      { ...{ id: '3V3', label: '3V3', silk: '3V3', kind: 'v33' }, xmm: 6.35, ymm: 16.51, dir: 'down' },
      { ...{ id: 'AREF', label: 'AREF', silk: 'AREF', kind: 'none', decor: true }, xmm: 8.89, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A0', label: 'A0', silk: 'A0', kind: 'analog', num: 14 }, xmm: 11.43, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A1', label: 'A1', silk: 'A1', kind: 'analog', num: 15 }, xmm: 13.97, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A2', label: 'A2', silk: 'A2', kind: 'analog', num: 16 }, xmm: 16.51, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A3', label: 'A3', silk: 'A3', kind: 'analog', num: 17 }, xmm: 19.05, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A4', label: 'A4', silk: 'A4', kind: 'analog', num: 18 }, xmm: 21.59, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A5', label: 'A5', silk: 'A5', kind: 'analog', num: 19 }, xmm: 24.13, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A6', label: 'A6', silk: 'A6', kind: 'analog', num: 20 }, xmm: 26.67, ymm: 16.51, dir: 'down' },
      { ...{ id: 'A7', label: 'A7', silk: 'A7', kind: 'analog', num: 21 }, xmm: 29.21, ymm: 16.51, dir: 'down' },
      { ...{ id: '5V', label: '5V', silk: '5V', kind: 'vcc' }, xmm: 31.75, ymm: 16.51, dir: 'down' },
      { ...{ id: 'RESET2', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 34.29, ymm: 16.51, dir: 'down' },
      { ...{ id: 'GND2', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 36.83, ymm: 16.51, dir: 'down' },
      { ...{ id: 'VIN', label: 'VIN', silk: 'VIN', kind: 'vin' }, xmm: 39.37, ymm: 16.51, dir: 'down' },
    ],
  },

  // ------------------------------------------------------ Arduino Pro Mini ----
  // W 33,02 · H 17,78 · 12 + 12 выводов, разъём FTDI слева, без USB
  promini: {
    id: 'promini',
    name: 'Arduino Pro Mini',
    short: 'Pro Mini',
    vcc: 5,
    vccPin: '5V',
    adcMax: 1023,
    builtinLed: 13,
    pwmPins: [3, 5, 6, 9, 10, 11],
    languages: ['cpp'],
    defaultLang: 'cpp',
    wmm: 33.02,
    hmm: 17.78,
    padInset: 1.27,
    w: M(33.02),
    h: M(17.78),
    chip: 'ATmega328P',
    pins: [
      // верхний ряд
      { ...{ id: 'VIN', label: 'RAW', silk: 'RAW', kind: 'vin' }, xmm: 3.81, ymm: 1.27, dir: 'up' },
      { ...{ id: 'GND', label: 'GND', silk: 'GND', kind: 'gnd' }, xmm: 6.35, ymm: 1.27, dir: 'up' },
      { ...{ id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 8.89, ymm: 1.27, dir: 'up' },
      { ...{ id: '5V', label: 'VCC', silk: 'VCC', kind: 'vcc' }, xmm: 11.43, ymm: 1.27, dir: 'up' },
      { ...{ id: 'A3', label: 'A3', silk: 'A3', kind: 'analog', num: 17 }, xmm: 13.97, ymm: 1.27, dir: 'up' },
      { ...{ id: 'A2', label: 'A2', silk: 'A2', kind: 'analog', num: 16 }, xmm: 16.51, ymm: 1.27, dir: 'up' },
      { ...{ id: 'A1', label: 'A1', silk: 'A1', kind: 'analog', num: 15 }, xmm: 19.05, ymm: 1.27, dir: 'up' },
      { ...{ id: 'A0', label: 'A0', silk: 'A0', kind: 'analog', num: 14 }, xmm: 21.59, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D13', label: '13', silk: '13', kind: 'digital', num: 13 }, xmm: 24.13, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D12', label: '12', silk: '12', kind: 'digital', num: 12 }, xmm: 26.67, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D11', label: '11', silk: '11', kind: 'digital', num: 11 }, xmm: 29.21, ymm: 1.27, dir: 'up' },
      { ...{ id: 'D10', label: '10', silk: '10', kind: 'digital', num: 10 }, xmm: 31.75, ymm: 1.27, dir: 'up' },
      // нижний ряд
      { ...{ id: 'D0', label: '0', silk: '0', kind: 'digital', num: 0 }, xmm: 3.81, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D1', label: '1', silk: '1', kind: 'digital', num: 1 }, xmm: 6.35, ymm: 16.51, dir: 'down' },
      { ...{ id: 'RESET2', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 8.89, ymm: 16.51, dir: 'down' },
      { ...{ id: 'GND2', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 11.43, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D2', label: '2', silk: '2', kind: 'digital', num: 2 }, xmm: 13.97, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D3', label: '3', silk: '3', kind: 'digital', num: 3 }, xmm: 16.51, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D4', label: '4', silk: '4', kind: 'digital', num: 4 }, xmm: 19.05, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D5', label: '5', silk: '5', kind: 'digital', num: 5 }, xmm: 21.59, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D6', label: '6', silk: '6', kind: 'digital', num: 6 }, xmm: 24.13, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D7', label: '7', silk: '7', kind: 'digital', num: 7 }, xmm: 26.67, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D8', label: '8', silk: '8', kind: 'digital', num: 8 }, xmm: 29.21, ymm: 16.51, dir: 'down' },
      { ...{ id: 'D9', label: '9', silk: '9', kind: 'digital', num: 9 }, xmm: 31.75, ymm: 16.51, dir: 'down' },
    ],
  },

  // ------------------------------------------------------- Arduino Leonardo ----
  // W 68,58 · H 53,34 · как Uno, но ATmega32u4 и micro-USB слева
  leonardo: {
    id: 'leonardo',
    name: 'Arduino Leonardo',
    short: 'Leonardo',
    vcc: 5,
    vccPin: '5V',
    adcMax: 1023,
    builtinLed: 13,
    pwmPins: [3, 5, 6, 9, 10, 11, 13],
    languages: ['cpp'],
    defaultLang: 'cpp',
    wmm: 68.58,
    hmm: 53.34,
    padInset: 2.54,
    w: M(68.58),
    h: M(53.34),
    chip: 'ATmega32U4',
    pins: [
      // верхний ряд
      { ...{ id: 'SCL', label: 'SCL', silk: 'SCL', kind: 'none', decor: true }, xmm: 21.34, ymm: 2.54, dir: 'up' },
      { ...{ id: 'SDA', label: 'SDA', silk: 'SDA', kind: 'none', decor: true }, xmm: 23.88, ymm: 2.54, dir: 'up' },
      { ...{ id: 'AREF', label: 'AREF', silk: 'AREF', kind: 'none', decor: true }, xmm: 26.42, ymm: 2.54, dir: 'up' },
      { ...{ id: 'GND', label: 'GND', silk: 'GND', kind: 'gnd' }, xmm: 28.96, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D13', label: '13', silk: '13', kind: 'digital', num: 13 }, xmm: 31.5, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D12', label: '12', silk: '12', kind: 'digital', num: 12 }, xmm: 34.04, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D11', label: '11', silk: '11', kind: 'digital', num: 11 }, xmm: 36.58, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D10', label: '10', silk: '10', kind: 'digital', num: 10 }, xmm: 39.12, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D9', label: '9', silk: '9', kind: 'digital', num: 9 }, xmm: 41.66, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D8', label: '8', silk: '8', kind: 'digital', num: 8 }, xmm: 44.2, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D7', label: '7', silk: '7', kind: 'digital', num: 7 }, xmm: 48.26, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D6', label: '6', silk: '6', kind: 'digital', num: 6 }, xmm: 50.8, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D5', label: '5', silk: '5', kind: 'digital', num: 5 }, xmm: 53.34, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D4', label: '4', silk: '4', kind: 'digital', num: 4 }, xmm: 55.88, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D3', label: '3', silk: '3', kind: 'digital', num: 3 }, xmm: 58.42, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D2', label: '2', silk: '2', kind: 'digital', num: 2 }, xmm: 60.96, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D1', label: '1', silk: '1', kind: 'digital', num: 1 }, xmm: 63.5, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D0', label: '0', silk: '0', kind: 'digital', num: 0 }, xmm: 66.04, ymm: 2.54, dir: 'up' },
      // нижний ряд
      { ...{ id: 'IOREF', label: 'IOREF', silk: 'IOREF', kind: 'none', decor: true }, xmm: 33.02, ymm: 50.8, dir: 'down' },
      { ...{ id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 35.56, ymm: 50.8, dir: 'down' },
      { ...{ id: '3V3', label: '3V3', silk: '3V3', kind: 'v33' }, xmm: 38.1, ymm: 50.8, dir: 'down' },
      { ...{ id: '5V', label: '5V', silk: '5V', kind: 'vcc' }, xmm: 40.64, ymm: 50.8, dir: 'down' },
      { ...{ id: 'GND2', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 43.18, ymm: 50.8, dir: 'down' },
      { ...{ id: 'GND3', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 45.72, ymm: 50.8, dir: 'down' },
      { ...{ id: 'VIN', label: 'VIN', silk: 'VIN', kind: 'vin' }, xmm: 48.26, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A0', label: 'A0', silk: 'A0', kind: 'analog', num: 18 }, xmm: 53.34, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A1', label: 'A1', silk: 'A1', kind: 'analog', num: 19 }, xmm: 55.88, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A2', label: 'A2', silk: 'A2', kind: 'analog', num: 20 }, xmm: 58.42, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A3', label: 'A3', silk: 'A3', kind: 'analog', num: 21 }, xmm: 60.96, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A4', label: 'A4', silk: 'A4', kind: 'analog', num: 22 }, xmm: 63.5, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A5', label: 'A5', silk: 'A5', kind: 'analog', num: 23 }, xmm: 66.04, ymm: 50.8, dir: 'down' },
    ],
  },

  // -------------------------------------------------------- Arduino Mega 2560 ----
  // W 101,6 · H 53,34 · 54 цифровых (в том числе двойная гребёнка 2×18), 16 аналоговых
  mega: {
    id: 'mega',
    name: 'Arduino Mega 2560',
    short: 'Mega',
    vcc: 5,
    vccPin: '5V',
    adcMax: 1023,
    builtinLed: 13,
    pwmPins: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46],
    languages: ['cpp'],
    defaultLang: 'cpp',
    wmm: 101.6,
    hmm: 53.34,
    padInset: 2.54,
    w: M(101.6),
    h: M(53.34),
    chip: 'ATmega2560',
    pins: [
      // верхний ряд
      { ...{ id: 'SCL', label: 'SCL', silk: 'SCL', kind: 'none', decor: true }, xmm: 21.38, ymm: 2.54, dir: 'up' },
      { ...{ id: 'SDA', label: 'SDA', silk: 'SDA', kind: 'none', decor: true }, xmm: 23.92, ymm: 2.54, dir: 'up' },
      { ...{ id: 'AREF', label: 'AREF', silk: 'AREF', kind: 'none', decor: true }, xmm: 26.46, ymm: 2.54, dir: 'up' },
      { ...{ id: 'GND', label: 'GND', silk: 'GND', kind: 'gnd' }, xmm: 29.0, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D13', label: '13', silk: '13', kind: 'digital', num: 13 }, xmm: 31.54, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D12', label: '12', silk: '12', kind: 'digital', num: 12 }, xmm: 34.08, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D11', label: '11', silk: '11', kind: 'digital', num: 11 }, xmm: 36.62, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D10', label: '10', silk: '10', kind: 'digital', num: 10 }, xmm: 39.16, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D9', label: '9', silk: '9', kind: 'digital', num: 9 }, xmm: 41.7, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D8', label: '8', silk: '8', kind: 'digital', num: 8 }, xmm: 44.24, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D7', label: '7', silk: '7', kind: 'digital', num: 7 }, xmm: 48.3, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D6', label: '6', silk: '6', kind: 'digital', num: 6 }, xmm: 50.84, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D5', label: '5', silk: '5', kind: 'digital', num: 5 }, xmm: 53.38, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D4', label: '4', silk: '4', kind: 'digital', num: 4 }, xmm: 55.92, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D3', label: '3', silk: '3', kind: 'digital', num: 3 }, xmm: 58.46, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D2', label: '2', silk: '2', kind: 'digital', num: 2 }, xmm: 61.0, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D1', label: '1', silk: '1', kind: 'digital', num: 1 }, xmm: 63.54, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D0', label: '0', silk: '0', kind: 'digital', num: 0 }, xmm: 66.08, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D14', label: '14', silk: '14', kind: 'digital', num: 14 }, xmm: 71.16, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D15', label: '15', silk: '15', kind: 'digital', num: 15 }, xmm: 73.7, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D16', label: '16', silk: '16', kind: 'digital', num: 16 }, xmm: 76.24, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D17', label: '17', silk: '17', kind: 'digital', num: 17 }, xmm: 78.78, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D18', label: '18', silk: '18', kind: 'digital', num: 18 }, xmm: 81.32, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D19', label: '19', silk: '19', kind: 'digital', num: 19 }, xmm: 83.86, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D20', label: '20', silk: '20', kind: 'digital', num: 20 }, xmm: 86.4, ymm: 2.54, dir: 'up' },
      { ...{ id: 'D21', label: '21', silk: '21', kind: 'digital', num: 21 }, xmm: 88.94, ymm: 2.54, dir: 'up' },
      // нижний ряд
      { ...{ id: 'NC', label: 'NC', silk: '', kind: 'none', decor: true }, xmm: 30.52, ymm: 50.8, dir: 'down' },
      { ...{ id: 'IOREF2', label: 'IOREF', silk: 'IOREF', kind: 'none', decor: true }, xmm: 33.06, ymm: 50.8, dir: 'down' },
      { ...{ id: 'RESET', label: 'RESET', silk: 'RESET', kind: 'none', decor: true }, xmm: 35.6, ymm: 50.8, dir: 'down' },
      { ...{ id: '3V3', label: '3V3', silk: '3V3', kind: 'v33' }, xmm: 38.14, ymm: 50.8, dir: 'down' },
      { ...{ id: '5V3', label: '5V', silk: '5V', kind: 'vcc', aliasOf: '5V' }, xmm: 40.68, ymm: 50.8, dir: 'down' },
      { ...{ id: 'GND4', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 43.22, ymm: 50.8, dir: 'down' },
      { ...{ id: 'GND5', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 45.76, ymm: 50.8, dir: 'down' },
      { ...{ id: 'VIN', label: 'VIN', silk: 'VIN', kind: 'vin' }, xmm: 48.3, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A0', label: 'A0', silk: 'A0', kind: 'analog', num: 54 }, xmm: 53.38, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A1', label: 'A1', silk: 'A1', kind: 'analog', num: 55 }, xmm: 55.92, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A2', label: 'A2', silk: 'A2', kind: 'analog', num: 56 }, xmm: 58.46, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A3', label: 'A3', silk: 'A3', kind: 'analog', num: 57 }, xmm: 61.0, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A4', label: 'A4', silk: 'A4', kind: 'analog', num: 58 }, xmm: 63.54, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A5', label: 'A5', silk: 'A5', kind: 'analog', num: 59 }, xmm: 66.08, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A6', label: 'A6', silk: 'A6', kind: 'analog', num: 60 }, xmm: 68.62, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A7', label: 'A7', silk: 'A7', kind: 'analog', num: 61 }, xmm: 71.16, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A8', label: 'A8', silk: 'A8', kind: 'analog', num: 62 }, xmm: 76.24, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A9', label: 'A9', silk: 'A9', kind: 'analog', num: 63 }, xmm: 78.78, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A10', label: 'A10', silk: 'A10', kind: 'analog', num: 64 }, xmm: 81.32, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A11', label: 'A11', silk: 'A11', kind: 'analog', num: 65 }, xmm: 83.86, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A12', label: 'A12', silk: 'A12', kind: 'analog', num: 66 }, xmm: 86.4, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A13', label: 'A13', silk: 'A13', kind: 'analog', num: 67 }, xmm: 88.94, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A14', label: 'A14', silk: 'A14', kind: 'analog', num: 68 }, xmm: 91.48, ymm: 50.8, dir: 'down' },
      { ...{ id: 'A15', label: 'A15', silk: 'A15', kind: 'analog', num: 69 }, xmm: 94.02, ymm: 50.8, dir: 'down' },
      // двойная гребёнка у правого края
      { ...{ id: '5V', label: '5V', silk: '5V', kind: 'vcc' }, xmm: 96.56, ymm: 2.54, dir: 'right' },
      { ...{ id: 'D22', label: '22', silk: '22', kind: 'digital', num: 22 }, xmm: 96.56, ymm: 5.08, dir: 'right' },
      { ...{ id: 'D24', label: '24', silk: '24', kind: 'digital', num: 24 }, xmm: 96.56, ymm: 7.62, dir: 'right' },
      { ...{ id: 'D26', label: '26', silk: '26', kind: 'digital', num: 26 }, xmm: 96.56, ymm: 10.16, dir: 'right' },
      { ...{ id: 'D28', label: '28', silk: '28', kind: 'digital', num: 28 }, xmm: 96.56, ymm: 12.7, dir: 'right' },
      { ...{ id: 'D30', label: '30', silk: '30', kind: 'digital', num: 30 }, xmm: 96.56, ymm: 15.24, dir: 'right' },
      { ...{ id: 'D32', label: '32', silk: '32', kind: 'digital', num: 32 }, xmm: 96.56, ymm: 17.78, dir: 'right' },
      { ...{ id: 'D34', label: '34', silk: '34', kind: 'digital', num: 34 }, xmm: 96.56, ymm: 20.32, dir: 'right' },
      { ...{ id: 'D36', label: '36', silk: '36', kind: 'digital', num: 36 }, xmm: 96.56, ymm: 22.86, dir: 'right' },
      { ...{ id: 'D38', label: '38', silk: '38', kind: 'digital', num: 38 }, xmm: 96.56, ymm: 25.4, dir: 'right' },
      { ...{ id: 'D40', label: '40', silk: '40', kind: 'digital', num: 40 }, xmm: 96.56, ymm: 27.94, dir: 'right' },
      { ...{ id: 'D42', label: '42', silk: '42', kind: 'digital', num: 42 }, xmm: 96.56, ymm: 30.48, dir: 'right' },
      { ...{ id: 'D44', label: '44', silk: '44', kind: 'digital', num: 44 }, xmm: 96.56, ymm: 33.02, dir: 'right' },
      { ...{ id: 'D46', label: '46', silk: '46', kind: 'digital', num: 46 }, xmm: 96.56, ymm: 35.56, dir: 'right' },
      { ...{ id: 'D48', label: '48', silk: '48', kind: 'digital', num: 48 }, xmm: 96.56, ymm: 38.1, dir: 'right' },
      { ...{ id: 'D50', label: '50', silk: '50', kind: 'digital', num: 50 }, xmm: 96.56, ymm: 40.64, dir: 'right' },
      { ...{ id: 'D52', label: '52', silk: '52', kind: 'digital', num: 52 }, xmm: 96.56, ymm: 43.18, dir: 'right' },
      { ...{ id: 'GND2', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 96.56, ymm: 45.72, dir: 'right' },
      { ...{ id: '5V2', label: '5V', silk: '5V', kind: 'vcc', aliasOf: '5V' }, xmm: 99.1, ymm: 2.54, dir: 'right' },
      { ...{ id: 'D23', label: '23', silk: '23', kind: 'digital', num: 23 }, xmm: 99.1, ymm: 5.08, dir: 'right' },
      { ...{ id: 'D25', label: '25', silk: '25', kind: 'digital', num: 25 }, xmm: 99.1, ymm: 7.62, dir: 'right' },
      { ...{ id: 'D27', label: '27', silk: '27', kind: 'digital', num: 27 }, xmm: 99.1, ymm: 10.16, dir: 'right' },
      { ...{ id: 'D29', label: '29', silk: '29', kind: 'digital', num: 29 }, xmm: 99.1, ymm: 12.7, dir: 'right' },
      { ...{ id: 'D31', label: '31', silk: '31', kind: 'digital', num: 31 }, xmm: 99.1, ymm: 15.24, dir: 'right' },
      { ...{ id: 'D33', label: '33', silk: '33', kind: 'digital', num: 33 }, xmm: 99.1, ymm: 17.78, dir: 'right' },
      { ...{ id: 'D35', label: '35', silk: '35', kind: 'digital', num: 35 }, xmm: 99.1, ymm: 20.32, dir: 'right' },
      { ...{ id: 'D37', label: '37', silk: '37', kind: 'digital', num: 37 }, xmm: 99.1, ymm: 22.86, dir: 'right' },
      { ...{ id: 'D39', label: '39', silk: '39', kind: 'digital', num: 39 }, xmm: 99.1, ymm: 25.4, dir: 'right' },
      { ...{ id: 'D41', label: '41', silk: '41', kind: 'digital', num: 41 }, xmm: 99.1, ymm: 27.94, dir: 'right' },
      { ...{ id: 'D43', label: '43', silk: '43', kind: 'digital', num: 43 }, xmm: 99.1, ymm: 30.48, dir: 'right' },
      { ...{ id: 'D45', label: '45', silk: '45', kind: 'digital', num: 45 }, xmm: 99.1, ymm: 33.02, dir: 'right' },
      { ...{ id: 'D47', label: '47', silk: '47', kind: 'digital', num: 47 }, xmm: 99.1, ymm: 35.56, dir: 'right' },
      { ...{ id: 'D49', label: '49', silk: '49', kind: 'digital', num: 49 }, xmm: 99.1, ymm: 38.1, dir: 'right' },
      { ...{ id: 'D51', label: '51', silk: '51', kind: 'digital', num: 51 }, xmm: 99.1, ymm: 40.64, dir: 'right' },
      { ...{ id: 'D53', label: '53', silk: '53', kind: 'digital', num: 53 }, xmm: 99.1, ymm: 43.18, dir: 'right' },
      { ...{ id: 'GND3', label: 'GND', silk: 'GND', kind: 'gnd', aliasOf: 'GND' }, xmm: 99.1, ymm: 45.72, dir: 'right' },
    ],
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


/** Raspberry Pi 5: физические выводы 1…40, GPIO-номера как в MicroPython. */
function buildRpi5() {
  // пары «физический вывод → функция»; odd — сверху, even — снизу
  const layout = [
    [1, pwr('3V3', '3V3', 'v33')], [2, pwr('5V', '5V', 'vcc')],
    [3, { id: 'GPIO2', num: 2, label: 'GPIO2', silk: 'GP2', kind: 'digital' }], [4, pwr('5V2', '5V', 'vcc', '5V')],
    [5, { id: 'GPIO3', num: 3, label: 'GPIO3', silk: 'GP3', kind: 'digital' }], [6, pwr('GND', 'GND', 'gnd')],
    [7, { id: 'GPIO4', num: 4, label: 'GPIO4', silk: 'GP4', kind: 'digital' }], [8, pwr('GND2', 'GND', 'gnd', 'GND')],
    [9, pwr('GND3', 'GND', 'gnd', 'GND')], [10, { id: 'GPIO14', num: 14, label: 'GPIO14', silk: 'GP14', kind: 'digital' }],
    [11, { id: 'GPIO17', num: 17, label: 'GPIO17', silk: 'GP17', kind: 'digital' }], [12, { id: 'GPIO15', num: 15, label: 'GPIO15', silk: 'GP15', kind: 'digital' }],
    [13, { id: 'GPIO27', num: 27, label: 'GPIO27', silk: 'GP27', kind: 'digital' }], [14, pwr('GND4', 'GND', 'gnd', 'GND')],
    [15, { id: 'GPIO22', num: 22, label: 'GPIO22', silk: 'GP22', kind: 'digital' }], [16, { id: 'GPIO18', num: 18, label: 'GPIO18', silk: 'GP18', kind: 'digital' }],
    [17, pwr('3V3_2', '3V3', 'v33', '3V3')], [18, { id: 'GPIO23', num: 23, label: 'GPIO23', silk: 'GP23', kind: 'digital' }],
    [19, { id: 'GPIO10', num: 10, label: 'GPIO10', silk: 'GP10', kind: 'digital' }], [20, { id: 'GPIO24', num: 24, label: 'GPIO24', silk: 'GP24', kind: 'digital' }],
    [21, { id: 'GPIO9', num: 9, label: 'GPIO9', silk: 'GP9', kind: 'digital' }], [22, pwr('GND5', 'GND', 'gnd', 'GND')],
    [23, { id: 'GPIO11', num: 11, label: 'GPIO11', silk: 'GP11', kind: 'digital' }], [24, { id: 'GPIO25', num: 25, label: 'GPIO25', silk: 'GP25', kind: 'digital' }],
    [25, pwr('GND6', 'GND', 'gnd', 'GND')], [26, { id: 'GPIO8', num: 8, label: 'GPIO8', silk: 'GP8', kind: 'digital' }],
    [27, { id: 'GPIO0', num: 0, label: 'GPIO0', silk: 'GP0', kind: 'digital' }], [28, { id: 'GPIO7', num: 7, label: 'GPIO7', silk: 'GP7', kind: 'digital' }],
    [29, { id: 'GPIO5', num: 5, label: 'GPIO5', silk: 'GP5', kind: 'digital' }], [30, pwr('GND7', 'GND', 'gnd', 'GND')],
    [31, { id: 'GPIO6', num: 6, label: 'GPIO6', silk: 'GP6', kind: 'digital' }], [32, { id: 'GPIO12', num: 12, label: 'GPIO12', silk: 'GP12', kind: 'digital' }],
    [33, { id: 'GPIO13', num: 13, label: 'GPIO13', silk: 'GP13', kind: 'digital' }], [34, pwr('GND8', 'GND', 'gnd', 'GND')],
    [35, { id: 'GPIO19', num: 19, label: 'GPIO19', silk: 'GP19', kind: 'digital' }], [36, { id: 'GPIO16', num: 16, label: 'GPIO16', silk: 'GP16', kind: 'digital' }],
    [37, { id: 'GPIO26', num: 26, label: 'GPIO26', silk: 'GP26', kind: 'digital' }], [38, { id: 'GPIO20', num: 20, label: 'GPIO20', silk: 'GP20', kind: 'digital' }],
    [39, pwr('GND9', 'GND', 'gnd', 'GND')], [40, { id: 'GPIO21', num: 21, label: 'GPIO21', silk: 'GP21', kind: 'digital' }],
  ];
  const topRow = [];
  const botRow = [];
  for (const [phys, pin] of layout) {
    const idx = Math.floor((phys - 1) / 2);          // 0…19 вдоль платы
    const xmm = 4.6 + idx * 2.54;
    if (phys % 2 === 1) topRow.push(top(xmm, pin));
    else botRow.push(bot(xmm, pin));
  }
  return [...topRow, ...botRow];
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
