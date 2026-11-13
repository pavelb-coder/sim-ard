/**
 * hints.js — локальный «ИИ-подсказчик».
 *
 * Никакой сети и никакой модели: набор правил, которые ловят типичные ошибки
 * школьника прямо в коде и в схеме, и объясняют их человеческим языком.
 * Правила ничего не меняют сами — только показывают строку и совет.
 *
 *   lint({ code, lang, ctx }) → [{ id, level, line, text, anchor }]
 *
 * level: 'info' — «можно лучше», 'warn' — «так не заработает», 'danger' — «сгорит».
 */

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Все вызовы функции name(...) в исходнике: аргументы, смещение, строка. */
function callsOf(src, name) {
  const out = [];
  const re = new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, 'g');
  let m;
  while ((m = re.exec(src))) {
    out.push({ args: m[1].trim(), index: m.index, line: lineOf(src, m.index) });
  }
  return out;
}

/** «9», «LED_BUILTIN», «A0» → номер вывода платы. */
export function pinNumber(arg, spec) {
  if (!arg) return null;
  const a = String(arg).trim();
  if (a === 'LED_BUILTIN') return spec?.builtinLed ?? null;
  const an = /^A(\d+)$/i.exec(a);
  if (an) {
    const analog = spec?.pins?.filter((p) => p.kind === 'analog') || [];
    return analog[Number(an[1])]?.num ?? Number(an[1]);
  }
  const n = Number(a);
  return Number.isFinite(n) ? n : null;
}

/**
 * Правила для скетча Arduino C++.
 * ctx: { spec, hasLed, ledWithoutResistor, ledsOnPins, analogPinsUsed }
 */
export function lintCpp(code, ctx = {}) {
  const out = [];
  const spec = ctx.spec || null;
  const src = String(code || '');
  const pwmPins = spec?.pwmPins || [];

  const pinModes = new Map();       // номер вывода → режимы из pinMode()
  for (const c of callsOf(src, 'pinMode')) {
    const [pinArg, modeArg] = c.args.split(',').map((s) => s && s.trim());
    const n = pinNumber(pinArg, spec);
    if (n === null) continue;
    if (!pinModes.has(n)) pinModes.set(n, new Set());
    pinModes.get(n).add(String(modeArg || '').toUpperCase());
  }

  const reported = new Set();
  const report = (id, level, line, text) => {
    const key = `${id}:${line}`;
    if (reported.has(key)) return;
    reported.add(key);
    out.push({ id, level, line, text });
  };

  // 1. Управляем выводом, а pinMode не вызван
  for (const name of ['digitalWrite', 'analogWrite', 'tone']) {
    for (const c of callsOf(src, name)) {
      const n = pinNumber(c.args.split(',')[0], spec);
      if (n === null || pinModes.get(n)?.has('OUTPUT')) continue;
      report('no-pinmode', 'warn', c.line,
        `Вывод ${c.args.split(',')[0].trim()} используется как выход, но в setup() нет pinMode(${c.args.split(',')[0].trim()}, OUTPUT).`);
    }
  }

  // 2. Читаем вывод, а режим не задан
  for (const name of ['digitalRead', 'analogRead']) {
    for (const c of callsOf(src, name)) {
      const n = pinNumber(c.args, spec);
      if (n === null) continue;
      const modes = pinModes.get(n);
      if (name === 'digitalRead' && !modes) {
        report('no-pinmode-in', 'info', c.line,
          `Перед digitalRead стоит вызвать pinMode(${c.args.trim()}, INPUT) или INPUT_PULLUP — иначе вывод «висит в воздухе».`);
      }
    }
  }

  // 3. analogWrite на выводе без ШИМ
  for (const c of callsOf(src, 'analogWrite')) {
    const n = pinNumber(c.args.split(',')[0], spec);
    if (n === null || !spec) continue;
    if (!pwmPins.includes(n)) {
      report('no-pwm', 'warn', c.line,
        `На ${spec.short} аппаратный ШИМ есть только на выводах ${pwmPins.join(', ')}. На выводе ${n} analogWrite будет просто «вкл/выкл».`);
    }
  }

  // 4. Слишком долгая пауза
  for (const c of callsOf(src, 'delay')) {
    const ms = Number(c.args);
    if (Number.isFinite(ms) && ms >= 3000) {
      report('long-delay', 'info', c.line,
        `delay(${ms}) — это ${(ms / 1000).toFixed(0)} с полной остановки. Для мигания хватает 200–500 мс, а лучше millis().`);
    }
  }

  // 5. Вечный цикл без паузы
  if (/while\s*\(\s*(true|1)\s*\)/.test(src)) {
    const m = /while\s*\(\s*(true|1)\s*\)/.exec(src);
    const body = src.slice(m.index, m.index + 400);
    if (!/delay\s*\(|millis\s*\(/.test(body)) {
      report('busy-loop', 'warn', lineOf(src, m.index),
        'Цикл while (true) без delay()/millis() крутится вхолостую: браузер не успевает перерисовывать схему.');
    }
  }

  // 6. Serial.print без Serial.begin
  if (/Serial\s*\.\s*(print|println|write)/.test(src) && !/Serial\s*\.\s*begin/.test(src)) {
    const m = /Serial\s*\.\s*(print|println|write)/.exec(src);
    report('no-serial-begin', 'info', lineOf(src, m.index),
      'В setup() не вызван Serial.begin(9600) — на настоящей плате монитор порта останется пустым.');
  }

  // 7. Пустой loop()
  if (/void\s+loop\s*\(\s*\)\s*\{\s*\}/.test(src)) {
    const m = /void\s+loop\s*\(\s*\)\s*\{\s*\}/.exec(src);
    report('empty-loop', 'info', lineOf(src, m.index),
      'loop() пустой: после setup() ничего не происходит. Всё «живое» поведение пишут в loop().');
  }

  // 8. Светодиод без резистора — это про схему, но сообщаем здесь же
  if (ctx.ledWithoutResistor) {
    report('led-no-resistor', 'danger', 1,
      'Светодиод подключён к выводу без резистора — на реальной плате он сгорит. Добавьте 220 Ом последовательно.');
  }

  // 9. Аналоговый вход, к которому ничего не подключено
  for (const c of callsOf(src, 'analogRead')) {
    const arg = c.args.trim();
    const n = pinNumber(arg, spec);
    if (n === null) continue;
    if (ctx.usedAnalogPins && !ctx.usedAnalogPins.includes(n)) {
      report('analog-floating', 'info', c.line,
        `К выводу ${arg} ничего не подключено — analogRead всегда вернёт случайный шум. Нужен делитель или потенциометр.`);
    }
  }

  // 10. Забыли подключить библиотеку
  if (/\bServo\b/.test(src) && !/#include\s*<Servo\.h>/.test(src)) {
    report('no-include-servo', 'info', 1, 'Класс Servo используется без #include <Servo.h>.');
  }
  if (/\bLiquidCrystal_I2C\b/.test(src) && !/#include\s*<LiquidCrystal_I2C\.h>/.test(src)) {
    report('no-include-lcd', 'info', 1, 'Класс LiquidCrystal_I2C используется без #include <LiquidCrystal_I2C.h>.');
  }

  return out.sort((a, b) => a.line - b.line);
}

/** Правила для MicroPython. */
export function lintPython(code, ctx = {}) {
  const out = [];
  const src = String(code || '');
  const report = (id, level, line, text) => out.push({ id, level, line, text });

  if (!/\bwhile\s+True\s*:/.test(src) && /\bPin\s*\(/.test(src)) {
    report('no-loop', 'info', 1, 'У Pico скетч обычно живёт в while True: — иначе программа завершится сразу после настройки.');
  }
  if (/\bwhile\s+True\s*:/.test(src) && !/time\.sleep|utime\.sleep|sleep_ms/.test(src)) {
    const m = /\bwhile\s+True\s*:/.exec(src);
    report('busy-loop', 'warn', lineOf(src, m.index), 'В while True: нет time.sleep() — цикл займёт весь процессор.');
  }
  if (/\bprint\s*\(/.test(src) && !/\bimport\b/.test(src)) {
    report('no-import', 'info', 1, 'Для print в MicroPython нужен хотя бы один import (например, import time).');
  }
  if (/\bPin\s*\(\s*\d+\s*,\s*Pin\.OUT\s*\)/.test(src) && !/value\s*\(|on\s*\(|off\s*\(|toggle\s*\(/.test(src)) {
    report('unused-pin', 'info', 1, 'Вывод объявлен как выход, но с ним ничего не делают (value/on/off/toggle).');
  }
  if (ctx.ledWithoutResistor) {
    report('led-no-resistor', 'danger', 1, 'Светодиод подключён без резистора — на реальной плате он сгорит.');
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Общая точка входа: сама выбирает набор правил. */
export function lint({ code, lang, ctx } = {}) {
  return lang === 'mpy' ? lintPython(code, ctx) : lintCpp(code, ctx);
}
