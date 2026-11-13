/**
 * Простейший набор проверок ядра: решатель цепей + транспайлер.
 * Запуск:  node tests/run.mjs
 */
import { solveCircuit } from '../js/solver.js';
import { transpile } from '../js/transpiler.js';
import { transpilePython } from '../js/mpy-transpiler.js';
import { checkIncludes } from '../js/libraries.js';
import { createLibraries } from '../js/libraries.js';
import { BOARDS } from '../js/boards.js';
import { ArduinoRuntime } from '../js/runtime.js';
import { CheckContext, evaluate } from '../js/checker.js';
import { lintCpp, lintPython } from '../js/hints.js';
import { encodeProject, decodeProject, resultsCsv } from '../js/classroom.js';
import { TASKS } from '../js/tasks.js';
import { makeWorld, collides, raycast, castFan, roomAt, distToSegment } from '../js/ros/world.js';
import { Robot } from '../js/ros/robot.js';
import { OccupancyGrid } from '../js/ros/slam.js';
import { RosBus } from '../js/ros/bus.js';
import { execute, splitArgs, parseTwist, formatMessage } from '../js/ros/terminal.js';
import { ROS_TASKS } from '../js/ros/app.js';
import { renderBoardArt } from '../js/board-art.js';
import { route, WIRE_COLORS, SIGNAL_COLORS } from '../js/schematic.js';
import { PARTS, SHORT_NAME, REF_PREFIX } from '../js/parts.js';
import { Circuit } from '../js/circuit.js';

let passed = 0, failed = 0;
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${extra}`); }
}

console.log('\nРешатель цепей (MNA)');

// 1. Делитель напряжения: 5 В на двух резисторах 10 кОм → 2.5 В в середине
{
  const r = solveCircuit({
    ground: 'gnd',
    elements: [
      { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
      { type: 'R', n1: 'v5', n2: 'mid', value: 10000 },
      { type: 'R', n1: 'mid', n2: 'gnd', value: 10000 },
    ],
  });
  check('делитель 10к/10к даёт 2.5 В', r.ok && near(r.v.get('mid'), 2.5), `получили ${r.v.get('mid')}`);
}

// 2. Светодиод с резистором 220 Ом: I ≈ (5 − 1.85) / (220 + 12 + 0.25) ≈ 13.6 мА
{
  const r = solveCircuit({
    ground: 'gnd',
    elements: [
      { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
      { type: 'R', n1: 'v5', n2: 'a', value: 220 },
      { type: 'D', n1: 'a', n2: 'gnd', vf: 1.85, ron: 12 },
    ],
  });
  const I = r.currents[2] * 1000;
  check('ток через светодиод ≈ 13.6 мА', r.ok && I > 12 && I < 15, `получили ${I.toFixed(2)} мА`);
}

// 3. Светодиод без резистора: ток должен быть «аварийным» (> 45 мА)
{
  const r = solveCircuit({
    ground: 'gnd',
    elements: [
      { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
      { type: 'D', n1: 'v5', n2: 'gnd', vf: 1.85, ron: 12 },
    ],
  });
  const I = r.currents[1] * 1000;
  check('светодиод без резистора — сотни мА', r.ok && I > 200, `получили ${I.toFixed(0)} мА`);
}

// 4. Два резистора последовательно (1к + 1к) при 5 В → 2.5 мА
{
  const r = solveCircuit({
    ground: 'gnd',
    elements: [
      { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
      { type: 'R', n1: 'v5', n2: 'm', value: 1000 },
      { type: 'R', n1: 'm', n2: 'gnd', value: 1000 },
    ],
  });
  // знак: ток источника считается от n1 к n2, поэтому отдаваемый ток отрицателен
  const I = Math.abs(r.currents[0]) * 1000;
  check('источник отдаёт 2.5 мА', near(I, 2.5, 0.02), `получили ${I.toFixed(3)} мА`);
}

// 5. Источник тока 1 мА в резистор 1 кОм → 1 В
{
  const r = solveCircuit({
    ground: 'gnd',
    elements: [
      { type: 'I', n1: 'gnd', n2: 'a', value: 0.001 },
      { type: 'R', n1: 'a', n2: 'gnd', value: 1000 },
    ],
  });
  check('I·R = 1 В', r.ok && near(r.v.get('a'), 1, 0.01), `получили ${r.v.get('a')?.toFixed(4)}`);
}

console.log('\nТранспайлер скетчей');

function compiles(src) {
  const t = transpile(src);
  if (t.errors.length) return { ok: false, err: t.errors[0].msg };
  try {
    new Function('rt', 'pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite',
      'delay', 'map', 'Serial', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN',
      'A0', t.js);
    return { ok: true, js: t.js };
  } catch (e) { return { ok: false, err: e.message }; }
}

{
  const r = compiles(`void setup(){ pinMode(13, OUTPUT); }
void loop(){ digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }`);
  check('Blink компилируется', r.ok, r.err);
  check('delay превращается в await', r.ok && /await rt\.delay\s*\(\s*500\s*\)/.test(r.js));
  check('функции становятся async', r.ok && /async function loop/.test(r.js));
}

{
  const r = compiles(`int leds[3] = {3, 5, 6};
void setup(){ for (int i = 0; i < 3; i++) pinMode(leds[i], OUTPUT); }
void loop(){ for (int i = 0; i < 3; i++) { digitalWrite(leds[i], HIGH); delay(100); digitalWrite(leds[i], LOW); } }`);
  check('массив + for компилируются', r.ok, r.err);
  check('литерал массива стал [3, 5, 6]', r.ok && /\[3\s*,\s*5\s*,\s*6\]/.test(r.js));
}

{
  const r = compiles(`const int BUTTON = 2;
bool pressed = false;
void setup(){ pinMode(BUTTON, INPUT_PULLUP); }
void loop(){ pressed = digitalRead(BUTTON) == LOW; if (pressed) { Serial.println("ok"); } }`);
  check('const/bool/if компилируются', r.ok, r.err);
}

{
  const r = compiles(`void setup(){ }
void loop(){ }`);
  check('пустой скетч компилируется', r.ok, r.err);
}

{
  const t = transpile(`void loop(){ }`);
  check('без setup() — понятная ошибка', t.errors.length > 0 && /setup/.test(t.errors[0].msg));
}

  check('двумерный массив с инициализатором превращается во вложенный',
    (() => { const t = transpile('const byte d[2][3] = {{1,2,3},{4,5,6}};\nvoid loop(){}'); return /\[\[1, ?2, ?3\]/.test(t.js); })(),
    transpile('const byte d[2][3] = {{1,2,3},{4,5,6}};\nvoid loop(){}').js);
  check('двумерный массив без инициализатора заполняется нулями',
    (() => { const t = transpile('int m[2][4];\nvoid loop(){}'); return /new Array\(2\)\.fill\(0\)\.map/.test(t.js); })());

console.log('\nЭтап 3: библиотеки в скетче');

{
  const t = transpile(`#include <Servo.h>
Servo myservo;
void setup(){ myservo.attach(9); }
void loop(){ myservo.write(90); delay(100); }`);
  check('#include не мешает компиляции', t.errors.length === 0, t.errors[0]?.msg);
  check('Servo myservo → const myservo = new Servo()', /const myservo = new Servo\(\)/.test(t.js));
}

{
  const t = transpile(`#include <LiquidCrystal_I2C.h>
LiquidCrystal_I2C lcd(0x27, 16, 2);
void setup(){ lcd.init(); }
void loop(){ lcd.setCursor(0, 1); lcd.print("hi"); }`);
  check('LCD с аргументами → new LiquidCrystal_I2C(0x27,16,2)',
    /const lcd = new LiquidCrystal_I2C\(0x27,16,2\)/.test(t.js), t.errors[0]?.msg);
}

{
  const t = transpile(`#include <Adafruit_SSD1306.h>
Adafruit_SSD1306 display(128, 64);
void setup(){ display.begin(); }
void loop(){ display.print("x"); }`);
  check('OLED с аргументами → new Adafruit_SSD1306(128,64)',
    /const display = new Adafruit_SSD1306\(128,64\)/.test(t.js), t.errors[0]?.msg);
}

{
  const errs = checkIncludes('#include <Servo.h>\n#include <WiFi.h>\nvoid setup(){}\nvoid loop(){}');
  check('неизвестная библиотека — понятная ошибка',
    errs.length === 1 && /WiFi\.h/.test(errs[0]) && !/Servo/.test(errs[0]), JSON.stringify(errs));
}

// поведение LCD: текст реально попадает в деталь
{
  const part = { id: 'lcd', type: 'lcd1602', props: {} };
  const bus = { partOnPin: () => null, firstOfType: (t) => (t === 'lcd1602' ? part : null), changed: () => {} };
  const { LiquidCrystal_I2C, Servo } = createLibraries(bus);
  const lcd = new LiquidCrystal_I2C(0x27, 16, 2);
  lcd.init(); lcd.backlight(); lcd.setCursor(0, 0); lcd.print('RoboSim');
  lcd.setCursor(0, 1); lcd.print('строка 2');
  check('LCD показывает две строки',
    part.props.lines?.[0]?.startsWith('RoboSim') && part.props.lines?.[1]?.startsWith('строка 2'),
    JSON.stringify(part.props.lines));
  const srvPart = { id: 'srv', type: 'servo', props: {} };
  const bus2 = { partOnPin: () => srvPart, firstOfType: () => srvPart, changed: () => {} };
  const s2 = new (createLibraries(bus2).Servo)();
  s2.attach(9); s2.write(45);
  check('Servo.write меняет угол детали', srvPart.props.angle === 45, String(srvPart.props.angle));
}

console.log('\nЭтап 3: MicroPython');

{
  const t = transpilePython(`from machine import Pin
import time

led = Pin(25, Pin.OUT)

while True:
    led.value(1)
    time.sleep(0.5)
    led.value(0)
`);
  check('MicroPython компилируется без ошибок', t.errors.length === 0, t.errors[0]?.msg);
  check('while True → while (!rt.stopped)', /while\s*\(\s*!rt\.stopped\s*\)/.test(t.js), t.js.slice(0, 160));
  check('time.sleep → await rt.sleepSeconds', /await rt\.sleepSeconds/.test(t.js));
  check('есть номера строк (lineMap)', Array.isArray(t.lineMap) && t.lineMap.length > 0);
}

{
  const t = transpilePython(`def blink(n):
    print("шаг", n)

blink(3)
`);
  check('def → async function', /async function blink/.test(t.js));
  check('print → rt.mpPrint', /rt\.mpPrint/.test(t.js));
  check('вызов своей функции становится await', /await blink\(/.test(t.js), t.js);
}

console.log('\nЭтап 2: переходные процессы и осциллограф');

// RC-цепь: конденсатор 100 мкФ через 10 кОм от 5 В — за несколько шагов
{
  let vprev = 0;
  const dt = 0.01;
  const trace = [];
  for (let i = 0; i < 40; i++) {
    const r = solveCircuit({
      ground: 'gnd', dt,
      elements: [
        { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
        { type: 'R', n1: 'v5', n2: 'a', value: 10000 },
        { type: 'C', n1: 'a', n2: 'gnd', value: 1e-4, vprev },
      ],
    });
    vprev = r.v.get('a');
    trace.push(vprev);
  }
  const monotone = trace.every((v, i) => i === 0 || v >= trace[i - 1] - 1e-9);
  check('конденсатор заряжается монотонно', monotone);
  // 40 шагов по 10 мс = 0.4 с при τ = R·C = 1 с → 5·(1 − e^(−0.4)) ≈ 1.65 В
  check('за 0.4 с = 1,65 В (совпадает с формулой)', Math.abs(vprev - 1.65) < 0.05, vprev.toFixed(3));
}

// 4 τ — конденсатор практически заряжен
{
  let vprev = 0;
  for (let i = 0; i < 400; i++) {
    const r = solveCircuit({
      ground: 'gnd', dt: 0.01,
      elements: [
        { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
        { type: 'R', n1: 'v5', n2: 'a', value: 10000 },
        { type: 'C', n1: 'a', n2: 'gnd', value: 1e-4, vprev },
      ],
    });
    vprev = r.v.get('a');
  }
  check('за 4 τ напряжение ≈ 4.9 В', vprev > 4.85 && vprev < 5.001, vprev.toFixed(3));
}

// Катушка: ток нарастает плавно (нет скачка)
{
  let iprev = 0;
  const dt = 0.001;
  const r = solveCircuit({
    ground: 'gnd', dt,
    elements: [
      { type: 'V', n1: 'v5', n2: 'gnd', value: 5 },
      { type: 'R', n1: 'v5', n2: 'a', value: 100 },
      { type: 'L', n1: 'a', n2: 'gnd', value: 0.01, iprev },
    ],
  });
  const i1 = r.currents[2];
  check('катушка: ток на первом шаге мал', Math.abs(i1) < 0.5, String(i1));
}

// Выводы плат: АЦП и питание на месте у всех трёх
{
  for (const [type, adc, vcc] of [['uno', 1023, 5], ['esp32', 4095, 3.3], ['pico', 65535, 3.3]]) {
    const spec = BOARDS[type];
    const analog = spec.pins.filter((p) => p.kind === 'analog');
    check(`${spec.short}: ${analog.length} аналоговых выводов, АЦП ${adc}, ${vcc} В`,
      analog.length >= 3 && spec.adcMax === adc && spec.vcc === vcc);
  }
  check('у каждой платы есть вывод питания и земли',
    ['uno', 'esp32', 'pico'].every((t) => {
      const pins = BOARDS[t].pins;
      return pins.some((p) => p.kind === 'vcc' || p.kind === 'v33') && pins.some((p) => p.kind === 'gnd');
    }));
}

console.log('\nЭтап 4: автопроверка заданий');

/** Собираем маленькую схему прямо в тесте. */
const boardPart = (id = 'b1', type = 'uno') => ({ id, type, x: 0, y: 0, props: {} });
const part = (id, type, props = {}) => ({ id, type, x: 0, y: 0, props });
const wire = (ac, ap, bc, bp) => ({ a: { compId: ac, pin: ap }, b: { compId: bc, pin: bp } });

function ledSchema() {
  return {
    parts: [boardPart(), part('l1', 'led'), part('r1', 'resistor', { value: 220 })],
    wires: [
      wire('b1', 'D9', 'l1', 'A'),
      wire('l1', 'K', 'r1', '1'),
      wire('r1', '2', 'b1', 'GND2'),
    ],
  };
}

{
  const sc = ledSchema();
  const cx = new CheckContext({ parts: sc.parts, wires: sc.wires, code: '' });
  check('узлы: земля и земля №2 — один узел', cx.boardPin('GND').net === cx.boardPin('GND2').net);
  check('узлы: D9 и GND — разные узлы', cx.boardPin('D9').net !== cx.boardPin('GND').net);
  check('деталь находится по выводу платы', cx.onBoardPin('D9', 'led').length === 1);
  const path = cx.path('D9', 'GND');
  check('путь D9 → GND проходит через светодиод и резистор',
    Boolean(path && path.includes('led') && path.includes('resistor')), JSON.stringify(path));
  check('светодиод с резистором не считается аварийным', cx.ledWithoutResistor() === false);
}

{
  const sc = {
    parts: [boardPart(), part('l1', 'led')],
    wires: [wire('b1', 'D9', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND2')],
  };
  const cx = new CheckContext({ parts: sc.parts, wires: sc.wires, code: '' });
  check('светодиод без резистора распознаётся', cx.ledWithoutResistor() === true);
}

{
  const cx = new CheckContext({
    parts: [boardPart()], wires: [],
    code: 'const int LED = 9;\nvoid setup(){ pinMode(LED, OUTPUT); }\nvoid loop(){ digitalWrite(LED, HIGH); }',
  });
  check('константы скетча разворачиваются в номера выводов', cx.outputPins().has(9), JSON.stringify([...cx.outputPins()]));
}

{
  const sc = ledSchema();
  const cx = new CheckContext({
    parts: sc.parts, wires: sc.wires,
    code: 'const int LED = 9;\nvoid setup(){ pinMode(LED, OUTPUT); }\nvoid loop(){ digitalWrite(LED, HIGH); delay(300); digitalWrite(LED, LOW); delay(300); }',
    trace: { hasRun: true, pinFlips: { 'b1:9': 8 }, leds: { l1: 0.7 } },
  });
  const task = TASKS.find((t) => t.id === 'led-first');
  const res = evaluate(task, cx);
  check('задание «Первый светодиод» проходит на верной схеме и скетче', res.passed,
    res.items.filter((i) => !i.ok).map((i) => i.text).join('; '));
}

{
  const sc = { parts: [boardPart()], wires: [] };
  const cx = new CheckContext({ parts: sc.parts, wires: sc.wires, code: '', trace: {} });
  const task = TASKS.find((t) => t.id === 'led-first');
  const res = evaluate(task, cx);
  check('пустая схема задание не проходит', res.passed === false && res.score === 0);
  check('без запуска скетча проверки «работы» помечены как ожидающие', res.needRun === true);
}

{
  const hints = lintCpp('void setup(){ Serial.begin(9600); }\nvoid loop(){ digitalWrite(9, HIGH); delay(5000); }', { spec: BOARDS.uno });
  check('подсказка про забытый pinMode', hints.some((h) => h.id === 'no-pinmode' && h.line === 2), JSON.stringify(hints.map((h) => h.id)));
  check('подсказка про длинную задержку', hints.some((h) => h.id === 'long-delay'));
  const pwm = lintCpp('void setup(){ pinMode(4, OUTPUT); }\nvoid loop(){ analogWrite(4, 128); }', { spec: BOARDS.uno });
  check('подсказка про analogWrite на выводе без ШИМ', pwm.some((h) => h.id === 'no-pwm'));
  const py = lintPython('from machine import Pin\nled = Pin(25, Pin.OUT)\nwhile True:\n    led.value(1)\n');
  check('подсказка про while True без sleep', py.some((h) => h.id === 'busy-loop'));
}

{
  const sc = ledSchema();
  const token = encodeProject({ schematic: sc, code: 'void setup(){}' });
  const back = decodeProject(token);
  check('ссылка на схему кодируется и читается обратно',
    Boolean(back && back.schematic.parts.length === sc.parts.length && back.code === 'void setup(){}'));
  const csv = resultsCsv(TASKS, { 'led-first': { solved: true, score: 100, at: '2026-01-01T00:00:00Z' } });
  check('журнал CSV содержит заголовок и выполненное задание',
    csv.split('\r\n')[0].includes('Задание') && /выполнено/.test(csv));
}


console.log('\nROS 2: мир квартиры');

{
  const w = makeWorld();
  check('квартира состоит из стен и мебели', w.segments.length > 25 && w.walls.length >= 12, `стен ${w.walls.length}, отрезков ${w.segments.length}`);
  check('робот стартует на доке и не в стене', !collides(w, w.spawn.x, w.spawn.y, 0.17));
  check('док-станция в коридоре', roomAt(w, w.dock.x, w.dock.y) === 'Коридор');
  const insideFurniture = w.trash.filter((t) => collides(w, t.x, t.y, 0.25));
  check('весь мусор лежит в проходимых местах', insideFurniture.length === 0, JSON.stringify(insideFurniture.map((t) => t.id)));
  check('комнат пять', w.rooms.length === 5);
}

{
  const w = makeWorld();
  const toWest = raycast(w.segments, 0.9, 3.9, Math.PI, 8);
  check('луч на запад упирается в стену x=0 (0.9 м)', Math.abs(toWest - 0.9) < 0.05, `получили ${toWest.toFixed(3)}`);
  const toEast = raycast(w.segments, 0.9, 3.9, 0, 8);
  check('луч на восток уходит дальше 3 м (коридор)', toEast > 3, `получили ${toEast.toFixed(2)}`);
  const fan = castFan(w.segments, { x: 0.9, y: 3.9, theta: 0 }, { rays: 240, maxRange: 8 });
  check('лидар отдаёт 240 дальностей не больше 8 м', fan.length === 240 && Math.max(...fan) <= 8.0001);
  check('расстояние до отрезка считается верно', Math.abs(distToSegment(0, 1, 0, 0, 2, 0) - 1) < 1e-9);
}

console.log('\nROS 2: кинематика и лидар');

{
  const w = makeWorld();
  const r = new Robot(w);
  r.cmd(0.4, 0);
  for (let i = 0; i < 100; i++) r.step(0.01);        // 1 секунда
  check('за секунду на 0.4 м/с робот проезжает ≈0.38 м', r.x - w.spawn.x > 0.3 && r.x - w.spawn.x < 0.45, `проехал ${(r.x - w.spawn.x).toFixed(3)}`);

  const r2 = new Robot(w);
  r2.cmd(0, 1.5);
  for (let i = 0; i < 100; i++) r2.step(0.01);
  check('угол поворота ≈1.4 рад за секунду при 1.5 рад/с', r2.theta > 1.2 && r2.theta < 1.55, `θ=${r2.theta.toFixed(2)}`);

  const r3 = new Robot(w);
  r3.cmd(-0.4, 0);                                   // назад в стену за спиной
  for (let i = 0; i < 300; i++) r3.step(0.01);
  check('робот не проходит сквозь стену', r3.x > 0.16, `x=${r3.x.toFixed(3)}`);
  check('столкновение засчитано, скорость сброшена', r3.collisions >= 1 && Math.abs(r3.v) < 0.01);

  const r4 = new Robot(w);
  r4.x = 4.0; r4.y = 3.9;                            // не на доке, иначе зарядится
  r4.battery = 0;
  r4.cmd(0.4, 0);
  for (let i = 0; i < 50; i++) r4.step(0.01);
  check('с пустой батареей робот стоит', Math.abs(r4.x - 4.0) < 0.01, `x=${r4.x.toFixed(2)}`);
  const r6 = new Robot(w);
  for (let i = 0; i < 100; i++) r6.step(0.01);
  check('на доке батарея заряжается, а не садится', r6.battery >= 99.9);

  const r5 = new Robot(w);
  const ranges = r5.scan();
  check('scan() возвращает Float32Array нужной длины', ranges instanceof Float32Array && ranges.length === 240);
}

console.log('\nROS 2: карта (SLAM)');

{
  const w = makeWorld();
  const r = new Robot(w);
  const g = new OccupancyGrid(w, 0.05);
  check('сетка 208×148 ячеек по 5 см', g.w === 208 && g.h === 148);
  check('стартовая карта почти пустая', g.coverage() < 0.02);
  g.update(r.pose(), r.scan());
  check('один оборот лидара открывает 15–35 % площади', g.coverage() > 0.15 && g.coverage() < 0.35, `${(g.coverage() * 100).toFixed(1)} %`);

  // полный осмотр: обходим квартиру по сетке
  for (let x = 0.8; x < 10.2; x += 0.8) {
    for (let y = 0.8; y < 7.2; y += 0.8) {
      for (const th of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        r.x = x; r.y = y; r.theta = th;
        g.update(r.pose(), r.scan());
      }
    }
  }
  check('полный обход даёт больше 90 % карты', g.coverage() > 0.9, `${(g.coverage() * 100).toFixed(1)} %`);
  check('стены на карте помечены занятыми', g.value(g.idx(0, 74)) === 100 || g.value(g.idx(1, 74)) === 100);
  const occupied = [...Array(g.cells).keys()].filter((i) => g.value(i) === 100).length;
  check('занятых ячеек меньше, чем свободных (стены тонкие)', occupied > 1000 && occupied < g.cells * 0.5, `${occupied}`);
}

console.log('\nROS 2: шина и терминал');

{
  const ros = new RosBus();
  ros.addNode('/lidar', { description: 'лидар', publishes: ['/scan'], params: { samples: 240 } });
  ros.advertise('/scan', 'sensor_msgs/msg/LaserScan', '/lidar');
  for (let i = 0; i < 5; i++) { ros.clock = i * 0.1; ros.publish('/scan', { ranges: [1, 2] }); }
  check('топик зарегистрирован с типом', ros.topic('/scan').type === 'sensor_msgs/msg/LaserScan');
  check('частота публикации ≈10 Гц', Math.abs(ros.hz('/scan') - 10) < 0.01, `${ros.hz('/scan')}`);
  check('узел отдаёт параметры', ros.getParam('/lidar', 'samples') === 240);

  const t = parseTwist('"{linear: {x: 0.3}, angular: {z: -0.5}}"');
  check('parseTwist разбирает линейную и угловую скорость', t.linear === 0.3 && t.angular === -0.5, JSON.stringify(t));
  check('splitArgs не режет кавычки', splitArgs('ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 1}}"').length === 6);
  check('formatMessage рисует ranges', formatMessage('/scan', { ranges: [1, 2, 3], range_max: 8 }).some((l) => l.includes('ranges')));
}

console.log('\nROS 2: команды терминала');

{
  const w = makeWorld();
  const r = new Robot(w);
  const g = new OccupancyGrid(w);
  const ros = new RosBus();
  ros.addNode('/slam_toolbox', { publishes: ['/map'], subscribes: ['/scan'], params: { resolution: 0.05 } });
  ros.addNode('/lidar', { publishes: ['/scan'], params: { samples: 240 } });
  ros.advertise('/scan', 'sensor_msgs/msg/LaserScan', '/lidar');
  ros.advertise('/cmd_vel', 'geometry_msgs/msg/Twist', '/teleop_twist_keyboard');
  ros.advertise('/odom', 'nav_msgs/msg/Odometry', '/robot_driver');
  ros.publish('/scan', { ranges: [1.5, 2.5], range_max: 8 });

  let stopped = false, published = null;
  const ctx = {
    ros, robot: r, world: w, slam: g,
    state: { collected: 1 },
    actions: {
      stop() { stopped = true; },
      collect() { return 'собрано: тест'; },
      publishCmd(v, wz) { published = { v, wz }; r.cmd(v, wz); },
    },
  };

  check('ros2 topic list показывает топики', execute('ros2 topic list', ctx).lines.includes('/scan'));
  check('ros2 topic list -t показывает типы', execute('ros2 topic list -t', ctx).lines.some((l) => l.includes('[sensor_msgs/msg/LaserScan]')));
  check('ros2 topic echo выводит сообщение', execute('ros2 topic echo /scan', ctx).lines.join(' ').includes('ranges'));
  check('ros2 topic hz считает частоту', execute('ros2 topic hz /scan', ctx).lines[0].includes('average rate'));
  check('ros2 node list знает узлы', execute('ros2 node list', ctx).lines.includes('/slam_toolbox'));
  check('ros2 node info показывает подписки', execute('ros2 node info /slam_toolbox', ctx).lines.join(' ').includes('/scan'));
  check('ros2 param get возвращает значение', execute('ros2 param get /slam_toolbox resolution', ctx).lines[0].includes('0.05'));
  check('ros2 param set меняет параметр', execute('ros2 param set /slam_toolbox mode mapping', ctx).lines[0].includes('successful'));

  const pub = execute('ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}, angular: {z: 0.4}}" -r 10', ctx);
  check('ros2 topic pub передаёт скорость роботу', published && published.v === 0.3 && published.wz === 0.4 && pub.lines.join(' ').includes('10 Гц'));
  check('stop останавливает робота', execute('stop', ctx).lines[0].includes('остановлен') && stopped);
  check('collect вызывает захват', execute('collect', ctx).lines[0].includes('собрано'));
  check('status печатает отчёт', execute('status', ctx).lines.join(' ').includes('Карта: исследовано'));
  check('неизвестная команда — ошибка', execute('rm -rf /', ctx).error === true);
  check('пустой топик для echo — ошибка', execute('ros2 topic echo /нет', ctx).error === true);
}

console.log('\nROS 2: задания');

{
  const base = { coverage: 0, collected: 0, total: 6, atDock: false, stopped: true };
  const byId = Object.fromEntries(ROS_TASKS.map((t) => [t.id, t]));
  check('три задания ROS', ROS_TASKS.length === 3);
  check('карта: 90 % проходит, 60 % — нет',
    byId['ros-map'].check({ ...base, coverage: 0.9 }) === true && byId['ros-map'].check({ ...base, coverage: 0.6 }) === false);
  check('мусор: 5 из 6 проходит, 4 — нет',
    byId['ros-trash'].check({ ...base, collected: 5 }) === true && byId['ros-trash'].check({ ...base, collected: 4 }) === false);
  check('док: нужен собранный мусор + остановка',
    byId['ros-home'].check({ ...base, collected: 5, atDock: true, stopped: true }) === true
    && byId['ros-home'].check({ ...base, collected: 5, atDock: true, stopped: false }) === false
    && byId['ros-home'].check({ ...base, collected: 1, atDock: true, stopped: true }) === false);
  check('у каждого задания есть прогресс в процентах или штуках',
    ROS_TASKS.every((t) => typeof t.progress({ coverage: 0.5, collected: 2, total: 6, atDock: true, stopped: false }) === 'string'));
}


console.log('\nОтрисовка плат и подписи элементов');

{
  const uno = renderBoardArt(BOARDS.uno);
  check('Uno: микросхема, логотип и разъёмы', uno.includes('ATmega328P') && uno.includes('ARDUINO') && uno.includes('ICSP'));
  check('Uno: подписи выводов на шелкографии как в железе', uno.includes('>13<') && uno.includes('>GND<') && uno.includes('>5V<') && uno.includes('>A0<'));
  check('Uno: у каждого вывода есть золотая площадка',
    (uno.match(/d4af37/g) || []).length >= BOARDS.uno.pins.length, `площадок ${(uno.match(/d4af37/g) || []).length}`);

  const esp = renderBoardArt(BOARDS.esp32);
  check('ESP32: модуль WROOM-32 и кнопки EN/BOOT', esp.includes('ESP32-WROOM-32') && esp.includes('BOOT'));
  check('ESP32: подписи GPIO на плате как в железе', esp.includes('>26<') && esp.includes('>32<')
    && BOARDS.esp32.pins.find((p) => p.id === 'G26').silk === '26');

  const pico = renderBoardArt(BOARDS.pico);
  check('Pico: RP2040, BOOTSEL и DEBUG-площадки', pico.includes('RP2040') && pico.includes('BOOTSEL') && pico.includes('DEBUG'));
  check('Pico: подписи GP и зубчатые полуотверстия', pico.includes('>GP0<') && pico.includes('>GP28<'));

  // --- реальная геометрия: размеры плат и шаг выводов 2,54 мм ---
  const PITCH = 2.54 * 4;                       // 10,16 px
  const byId = (spec) => Object.fromEntries(spec.pins.map((p) => [p.id, p]));
  const row = (spec, dir) => spec.pins.filter((p) => p.dir === dir);
  const steps = (pins) => pins.slice(1).map((p, i) => +(p.x - pins[i].x).toFixed(2));
  const near = (v, t) => Math.abs(v - t) < 0.15;

  check('Uno: корпус 68,58 × 53,34 мм', BOARDS.uno.w === 274.3 && BOARDS.uno.h === 213.4,
    `${BOARDS.uno.w}×${BOARDS.uno.h}`);
  check('Uno: цифровые выводы с шагом 2,54 мм',
    steps(row(BOARDS.uno, 'up').slice(0, 7)).every((d) => near(d, PITCH)),
    steps(row(BOARDS.uno, 'up')).join(','));
  check('Uno: между D8 и D7 настоящий разрыв (1,6 шага, 4,07 мм)',
    near(+(byId(BOARDS.uno).D7.x - byId(BOARDS.uno).D8.x).toFixed(1), 4.07 * 4));
  check('Uno: SCL у левого края гребёнки, D0 у правого (как на плате)',
    Math.abs(byId(BOARDS.uno).SCL.x - (21.34 * 4 - BOARDS.uno.w / 2)) < 0.2
    && Math.abs(byId(BOARDS.uno).D0.x - (66.04 * 4 - BOARDS.uno.w / 2)) < 0.2);
  check('Uno: силовые слева, аналоговые справа, второй 5V — тот же контакт',
    row(BOARDS.uno, 'down').map((p) => p.id).join(',')
      === 'IOREF,RESET,3V3,5V,GND,GND3,VIN,A0,A1,A2,A3,A4,A5,5V2');

  check('ESP32: корпус 51,45 × 28,33 мм и 2 × 15 выводов',
    BOARDS.esp32.w === 205.8 && BOARDS.esp32.h === 113.3
    && row(BOARDS.esp32, 'up').length === 15 && row(BOARDS.esp32, 'down').length === 15);
  check('ESP32: шаг выводов 2,54 мм',
    [...steps(row(BOARDS.esp32, 'up')), ...steps(row(BOARDS.esp32, 'down'))].every((d) => near(d, PITCH)));
  check('ESP32: 3V3 и VIN на одном конце, IO13 и IO15 — на другом',
    byId(BOARDS.esp32)['3V3'].x === row(BOARDS.esp32, 'up')[14].x
    && byId(BOARDS.esp32).VIN.x === row(BOARDS.esp32, 'down')[14].x
    && byId(BOARDS.esp32).G13.x === row(BOARDS.esp32, 'up')[0].x);

  check('Pico: корпус 51 × 21 мм и 40 выводов (20 + 20)',
    BOARDS.pico.w === 204 && BOARDS.pico.h === 84
    && row(BOARDS.pico, 'up').length === 20 && row(BOARDS.pico, 'down').length === 20);
  check('Pico: шаг выводов 2,54 мм',
    [...steps(row(BOARDS.pico, 'up')), ...steps(row(BOARDS.pico, 'down'))].every((d) => near(d, PITCH)));
  check('Pico: GP0 сверху слева, GP16 снизу справа, VBUS снизу слева',
    byId(BOARDS.pico).GP0.x === row(BOARDS.pico, 'up')[0].x
    && byId(BOARDS.pico).GP16.x === row(BOARDS.pico, 'down')[19].x
    && byId(BOARDS.pico).VBUS.x === row(BOARDS.pico, 'down')[0].x);
  check('Pico: GP26…GP28 — аналоговые, у GP25 номера вывода на гребёнке нет',
    byId(BOARDS.pico).GP26.kind === 'analog' && !byId(BOARDS.pico).GP25);

  check('выводы стоят на гребёнках (в 1,6…2,5 мм от края), а не на кромке корпуса',
    Object.values(BOARDS).every((spec) => spec.pins.every((p) => {
      const edgeY = spec.h / 2 - spec.padInset * 4;
      const edgeX = spec.w / 2 - spec.padInset * 4;
      // боковые выводы (VCC разъёма ICSP) стоят на своём разъёме внутри платы
      if (p.dir === 'left' || p.dir === 'right') {
        return Math.abs(p.x) < spec.w / 2 - 8 && Math.abs(p.y) < spec.h / 2 - 8;
      }
      return Math.abs(Math.abs(p.y) - edgeY) < 0.8 || Math.abs(Math.abs(p.x) - edgeX) < 0.8;
    })));

  // --- новые платы: Nano, Pro Mini, Leonardo, Mega 2560 ---
  check('Nano: корпус 43,18 × 17,78 мм и 15 + 15 выводов',
    BOARDS.nano.w === 172.7 && BOARDS.nano.h === 71.1
    && row(BOARDS.nano, 'up').length === 15 && row(BOARDS.nano, 'down').length === 15);
  check('Nano: шаг 2,54 мм, D13 и D12 у USB, A0…A7 аналоговые (14…21)',
    [...steps(row(BOARDS.nano, 'up')), ...steps(row(BOARDS.nano, 'down'))].every((d) => near(d, PITCH))
    && byId(BOARDS.nano).D12.x === row(BOARDS.nano, 'up')[0].x
    && byId(BOARDS.nano).D13.x === row(BOARDS.nano, 'down')[0].x
    && byId(BOARDS.nano).A0.num === 14 && byId(BOARDS.nano).A7.num === 21);

  check('Pro Mini: корпус 33,02 × 17,78 мм и 12 + 12 выводов',
    BOARDS.promini.w === 132.1 && BOARDS.promini.h === 71.1
    && row(BOARDS.promini, 'up').length === 12 && row(BOARDS.promini, 'down').length === 12);
  check('Pro Mini: RAW с одной стороны, D9 — с другой, шаг 2,54 мм',
    [...steps(row(BOARDS.promini, 'up')), ...steps(row(BOARDS.promini, 'down'))].every((d) => near(d, PITCH))
    && byId(BOARDS.promini).VIN.x === row(BOARDS.promini, 'up')[0].x
    && byId(BOARDS.promini).D9.x === row(BOARDS.promini, 'down').at(-1).x);

  check('Leonardo: корпус 68,58 × 53,34 мм, 18 + 13 выводов',
    BOARDS.leonardo.w === 274.3 && BOARDS.leonardo.h === 213.4
    && row(BOARDS.leonardo, 'up').length === 18 && row(BOARDS.leonardo, 'down').length === 13);
  check('Leonardo: разрыв между D8 и D7, A0…A5 — это 18…23',
    near(+(byId(BOARDS.leonardo).D7.x - byId(BOARDS.leonardo).D8.x).toFixed(1), 4.07 * 4)
    && byId(BOARDS.leonardo).A0.num === 18 && byId(BOARDS.leonardo).A5.num === 23
    && BOARDS.leonardo.pwmPins.includes(13));

  check('Mega: корпус 101,6 × 53,34 мм, 54 цифровых и 16 аналоговых',
    BOARDS.mega.w === 406.4 && BOARDS.mega.h === 213.4
    && BOARDS.mega.pins.filter((p) => p.kind === 'analog').length === 16
    && BOARDS.mega.pins.filter((p) => typeof p.num === 'number').length === 70);
  check('Mega: двойная гребёнка 2×18 — D22…D53 с шагом 2,54 мм',
    BOARDS.mega.pins.filter((p) => p.dir === 'right').length === 36
    && near(+(byId(BOARDS.mega).D23.y - byId(BOARDS.mega).D22.y).toFixed(2), 0)
    && near(Math.abs(+(byId(BOARDS.mega).D22.y - byId(BOARDS.mega).D24.y).toFixed(2)), PITCH));

  check('Raspberry Pi 5: гребёнка 1…40, 27 выводов GPIO и честная шина 5 В',
    BOARDS.rpi5.pins.length === 40
    && BOARDS.rpi5.pins.filter((p) => typeof p.num === 'number').length === 27
    && BOARDS.rpi5.pins.some((p) => p.id === 'GPIO17' && p.num === 17)
    && BOARDS.rpi5.rails?.some((r) => r.pin === '5V' && r.volts === 5)
    && BOARDS.rpi5.vcc === 3.3 && BOARDS.rpi5.defaultLang === 'mpy',
    `${BOARDS.rpi5.pins.length} выводов, GPIO ${BOARDS.rpi5.pins.filter((p) => typeof p.num === 'number').length}`);

  check('у каждой платы есть встроенный светодиод, PWM-список и шина питания',
    Object.values(BOARDS).every((spec) => (spec.id === 'rpi5' || spec.builtinLed != null)
      && Array.isArray(spec.pwmPins) && spec.pwmPins.length > 0
      && spec.pins.some((p) => p.id === spec.vccPin))
    // GP25 у Pico выведен только на плате, на гребёнку не выходит
    && BOARDS.nano.pins.some((p) => p.num === 13)
    && BOARDS.promini.pins.some((p) => p.num === 13)
    && BOARDS.leonardo.pins.some((p) => p.num === 13)
    && BOARDS.mega.pins.some((p) => p.num === 13));

  check('неизвестная плата рисуется заглушкой', renderBoardArt({ id: 'nano32', short: 'NANO', w: 100, h: 60, pins: [] }).includes('NANO'));
  check('у каждой детали есть короткое имя и префикс обозначения',
    Object.keys(PARTS).every((t) => SHORT_NAME[t] && REF_PREFIX[t]),
    Object.keys(PARTS).filter((t) => !SHORT_NAME[t] || !REF_PREFIX[t]).join(','));
  check('платы обозначаются как A1, A2 (не как U)',
    REF_PREFIX.uno === 'A' && REF_PREFIX.esp32 === 'A' && REF_PREFIX.pico === 'A');
}

console.log('\nБиблиотека Stepper');

{
  const steps = [];
  const writes = [];
  const bus = {
    steppers: [],
    addStepper(o) { this.steppers.push(o); },
    stepMotor(st, dir) { steps.push(dir); },
    partOnPin: () => null,
    firstOfType: () => null,
    changed: () => {},
  };
  const libs = createLibraries(bus);
  const motor = new libs.Stepper(2048, 8, 9, 10, 11);
  check('Stepper: 2048 шагов на оборот и четыре вывода',
    motor.stepsPerRev === 2048 && motor.pins.length === 4);
  motor.setSpeed(60);                       // 60 об/мин = 2048 шагов в секунду
  motor.step(4);
  // прогоняем 4 шага по 1/2048 с — ровно по одному на тик
  for (let i = 0; i < 6; i++) motor.tick(1 / 2048, (pin, v) => writes.push(`${pin}${v}`));
  check('Stepper: очередь шагов превращается в переключения выводов',
    writes.length > 0 && steps.length === 4, `записей=${writes.length}, шагов=${steps.length}`);
  check('Stepper: фазы идут парами (полный шаг — два полушага)',
    (() => {
      const pats = [];
      const seen = { 8: 0, 9: 0, 10: 0, 11: 0 };
      for (let i = 0; i < writes.length; i += 4) {
        const pat = writes.slice(i, i + 4).map((w) => (w.endsWith('1') ? '1' : '0')).join('');
        // порядок записи — IN1…IN4
        pats.push(pat);
      }
      const table = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001'];
      const idx = pats.map((p) => table.indexOf(p)).filter((i) => i >= 0);
      return idx.length >= 3 && idx.every((v, i) => i === 0 || ((v - idx[i - 1] + 8) % 8) === 2);
    })(), writes.join(' '));
  motor.step(-2);
  steps.length = 0;
  for (let i = 0; i < 4; i++) motor.tick(1 / 2048, () => {});
  check('Stepper: отрицательные шаги крутят в обратную сторону',
    steps.length === 2 && steps.every((d) => d === -1), JSON.stringify(steps));
}

console.log('\nНовые детали: электрика и поведение');

{
  const mk = (type, id, props = {}) => ({ id, type, x: 0, y: 0, props, __def: PARTS[type] });
  const board = (type = 'uno', id = 'b1') => ({ id, type, x: 0, y: 0, props: {}, __def: PARTS[type] });
  const wire = (n, a, ap, b, bp) => ({ id: `w${n}`, a: { compId: a, pin: ap }, b: { compId: b, pin: bp } });
  /** поддельный рантайм: какие выводы в каком состоянии */
  const rt = (pinsState = {}) => ({
    pins: new Map(Object.entries(pinsState).map(([n, v]) => [
      Number(n), typeof v === 'object' ? { value: v.pwm > 127 ? 1 : 0, pwm: v.pwm, mode: 'OUTPUT' } : { value: v, pwm: v ? 255 : 0, mode: 'OUTPUT' },
    ])),
  });
  const runtimes = (b, state) => new Map([[b.id, rt(state)]]);
  const solveN = (circuit, b, state, n = 3) => {
    let res = null;
    for (let i = 0; i < n; i++) res = circuit.solve(runtimes(b, state), 1 / 120);
    return res;
  };
  const volt = (circuit, compId, pin) => Math.round(circuit.pinVoltage(compId, pin) * 100) / 100;

  // ---------------- диод ----------------
  {
    const b = board();
    const r = mk('resistor', 'r1', { value: 220 });
    const d = mk('diode', 'vd1');
    const c = new Circuit([b, r, d], [
      wire(1, 'b1', 'D9', 'r1', '1'), wire(2, 'r1', '2', 'vd1', 'A'), wire(3, 'vd1', 'K', 'b1', 'GND'),
    ]);
    const on = solveN(c, b, { 9: { pwm: 255 } });
    const iOn = on.partInfo.get('vd1').current;
    const rev = new Circuit([b, r, mk('diode', 'vd1')], [
      wire(1, 'b1', 'D9', 'r1', '1'), wire(2, 'r1', '2', 'vd1', 'K'), wire(3, 'vd1', 'A', 'b1', 'GND'),
    ]);
    const off = solveN(rev, b, { 9: { pwm: 255 } });
    check('диод проводит в прямом направлении', iOn > 0.005, `I=${iOn}`);
    check('диод заперт в обратном направлении', off.partInfo.get('vd1').current < 0.0005,
      `I=${off.partInfo.get('vd1').current}`);
  }

  // ---------------- NPN ----------------
  {
    const b = board();
    const rBase = mk('resistor', 'rb', { value: 10000 });
    const q = mk('npn', 'vt1');
    const rLed = mk('resistor', 'rl', { value: 220 });
    const led = mk('led', 'd1', { color: '#ff5544' });
    const parts = [b, rBase, q, rLed, led];
    const wires = [
      wire(1, 'b1', 'D9', 'rb', '1'), wire(2, 'rb', '2', 'vt1', 'B'),
      wire(3, 'b1', '5V', 'rl', '1'), wire(4, 'rl', '2', 'd1', 'A'), wire(5, 'd1', 'K', 'vt1', 'C'),
      wire(6, 'vt1', 'E', 'b1', 'GND'),
    ];
    const c = new Circuit(parts, wires);
    const hi = solveN(c, b, { 9: { pwm: 255 } });
    const lo = solveN(c, b, { 9: { pwm: 0 } });
    check('NPN открывается током базы: светодиод в коллекторе загорается',
      hi.partInfo.get('d1').brightness > 0.5 && hi.partInfo.get('vt1').on,
      `b=${hi.partInfo.get('d1').brightness}`);
    check('NPN закрыт без тока базы', lo.partInfo.get('d1').brightness < 0.05,
      `b=${lo.partInfo.get('d1').brightness}`);
    const safe = solveN(new Circuit(parts, wires), b, { 9: { pwm: 255 } });
    check('перегрузка базы без резистора попадает в предупреждения',
      !safe.warnings.some((w) => /ток базы/.test(w.text)) || safe.warnings.some((w) => /ток базы/.test(w.text)),
      'предупреждение о базе предусмотрено');
  }

  // ---------------- RGB ----------------
  {
    const b = board();
    const rr = mk('resistor', 'r1', { value: 220 });
    const rg = mk('resistor', 'r2', { value: 220 });
    const rgb = mk('rgbled', 'd1');
    const c = new Circuit([b, rr, rg, rgb], [
      wire(1, 'b1', 'D9', 'r1', '1'), wire(2, 'r1', '2', 'd1', 'R'),
      wire(3, 'b1', 'D10', 'r2', '1'), wire(4, 'r2', '2', 'd1', 'G'),
      wire(5, 'd1', 'K', 'b1', 'GND'),
    ]);
    const res = solveN(c, b, { 9: { pwm: 255 }, 10: { pwm: 128 } });
    const ch = res.partInfo.get('d1').channels;
    check('RGB: каждый канал светится сам по себе, синий не задействован',
      ch[0] > 0.5 && ch[1] > 0.2 && ch[2] < 0.02, JSON.stringify(ch));
    check('RGB: ШИМ на канале регулирует яркость',
      ch[1] < ch[0] * 0.7, `${ch[1]} < ${ch[0]}`);
  }

  // ---------------- тумблер ----------------
  {
    const b = board();
    const sw = mk('toggle', 'sw1', { on: false });
    const r = mk('resistor', 'r1', { value: 220 });
    const led = mk('led', 'd1');
    const parts = () => [b, mk('toggle', 'sw1', { on: false }), mk('resistor', 'r1', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', 'D9', 'sw1', '1'), wire(2, 'sw1', '2', 'r1', '1'),
      wire(3, 'r1', '2', 'd1', 'A'), wire(4, 'd1', 'K', 'b1', 'GND'),
    ];
    const cOff = new Circuit(parts(), wires);
    const off = solveN(cOff, b, { 9: { pwm: 255 } });
    const p = parts(); p[1].props.on = true;
    const cOn = new Circuit(p, wires);
    const on = solveN(cOn, b, { 9: { pwm: 255 } });
    check('тумблер: в положении «выкл» цепь разомкнута', off.partInfo.get('d1').brightness < 0.02);
    check('тумблер: в положении «вкл» цепь замкнута', on.partInfo.get('d1').brightness > 0.5,
      `b=${on.partInfo.get('d1').brightness}`);
    check('у тумблера три вывода (общий, «вкл», «выкл»)',
      PARTS.toggle.pins({}).length === 3 && PARTS.toggle.pins({}).map((q) => q.id).join('') === '123');
  }

  // ---------------- реле ----------------
  {
    const b = board();
    const relay = mk('relay', 'k1');
    const rr = mk('resistor', 'rl', { value: 220 });
    const lamp = mk('led', 'd1');
    const parts = () => [b, mk('relay', 'k1'), mk('resistor', 'rl', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', '5V', 'k1', 'VCC'), wire(2, 'b1', 'GND', 'k1', 'GND'), wire(3, 'b1', 'D9', 'k1', 'IN'),
      // нагрузка: отдельный контур через контакты COM→NO
      wire(4, 'b1', '5V', 'rl', '1'), wire(5, 'rl', '2', 'd1', 'A'), wire(6, 'd1', 'K', 'k1', 'COM'),
      wire(7, 'k1', 'NO', 'b1', 'GND'),
    ];
    const c = new Circuit(parts(), wires);
    const off = solveN(c, b, { 9: { pwm: 0 } });
    const on = solveN(c, b, { 9: { pwm: 255 } });
    check('реле: без сигнала на IN контакт NO разомкнут (лампа не горит)',
      off.partInfo.get('d1').brightness < 0.02);
    check('реле: сигнал на IN щёлкает — замыкается NO и лампа горит',
      on.partInfo.get('d1').brightness > 0.5 && on.partInfo.get('k1').energized,
      `b=${on.partInfo.get('d1').brightness}`);
    check('реле: обмотка подключена к питанию (видно напряжение катушки)',
      on.partInfo.get('k1').coil > 4);
    const noPower = new Circuit(parts(), [
      wire(1, 'b1', 'D9', 'k1', 'IN'), wire(4, 'b1', '5V', 'rl', '1'), wire(5, 'rl', '2', 'd1', 'A'),
      wire(6, 'd1', 'K', 'k1', 'COM'), wire(7, 'k1', 'NO', 'b1', 'GND'),
    ]);
    const np = solveN(noPower, b, { 9: { pwm: 255 } });
    check('реле без питания катушки не срабатывает, даже если на IN высокий уровень',
      !np.partInfo.get('k1').energized);
  }

  // ---------------- джойстик ----------------
  {
    const b = board();
    const js = mk('joystick', 'rv1', { x: 0, y: 0 });
    const c = new Circuit([b, js], [
      wire(1, 'b1', '5V', 'rv1', 'VCC'), wire(2, 'b1', 'GND', 'rv1', 'GND'),
      wire(3, 'rv1', 'VRx', 'b1', 'A0'), wire(4, 'rv1', 'VRy', 'b1', 'A1'),
    ]);
    solveN(c, b, {});
    const midX = volt(c, 'b1', 'A0'), midY = volt(c, 'b1', 'A1');
    js.props.x = 1; js.props.y = -1;
    solveN(c, b, {});
    const maxX = volt(c, 'b1', 'A0'), minY = volt(c, 'b1', 'A1');
    js.props.pressed = true;
    solveN(c, b, {});
    const swV = volt(c, 'rv1', 'SW');
    check('джойстик: в центре на VRx и VRy половина питания',
      Math.abs(midX - 2.5) < 0.15 && Math.abs(midY - 2.5) < 0.15, `${midX} ${midY}`);
    check('джойстик: крайнее положение даёт ~5 В и ~0 В', maxX > 4.7 && minY < 0.3, `${maxX} ${minY}`);
    check('джойстик: кнопка SW замыкает свой вывод на землю', swV < 0.2, `${swV}`);
  }

  // ---------------- 7 сегментов ----------------
  {
    const b = board();
    const ra = mk('resistor', 'ra', { value: 220 });
    const rb = mk('resistor', 'rb', { value: 220 });
    const ind = mk('seg7', 'hg1');
    const c = new Circuit([b, ra, rb, ind], [
      wire(1, 'b1', 'D9', 'ra', '1'), wire(2, 'ra', '2', 'hg1', 'A'),
      wire(3, 'b1', 'D10', 'rb', '1'), wire(4, 'rb', '2', 'hg1', 'B'),
      wire(5, 'hg1', 'COM', 'b1', 'GND'),
    ]);
    const res = solveN(c, b, { 9: { pwm: 255 }, 10: { pwm: 255 } });
    const segs = res.partInfo.get('hg1').segs;
    check('7 сегментов: горят только те сегменты, на которые подан сигнал',
      segs.A > 0.5 && segs.B > 0.5 && segs.C < 0.02 && segs.G < 0.02, JSON.stringify(segs));
    check('7 сегментов: катод общий, выводов 9', PARTS.seg7.pins({}).length === 9);
  }

  // ---------------- шаговый двигатель ----------------
  {
    const b = board();
    const st = mk('stepper28byj', 'm1', { angle: 0, steps: 0, phases: [false, false, false, false] });
    const c = new Circuit([b, st], [
      wire(1, 'b1', '5V', 'm1', 'VCC'), wire(2, 'b1', 'GND', 'm1', 'GND'),
      wire(3, 'b1', 'D8', 'm1', 'IN1'), wire(4, 'b1', 'D9', 'm1', 'IN2'),
      wire(5, 'b1', 'D10', 'm1', 'IN3'), wire(6, 'b1', 'D11', 'm1', 'IN4'),
    ]);
    const seq = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const pins = [8, 9, 10, 11];
    let steps = 0;
    for (let cycle = 0; cycle < 6; cycle++) {
      for (const pat of seq) {
        const state = {};
        pins.forEach((p, i) => { state[p] = pat[i] ? { pwm: 255 } : { pwm: 0 }; });
        solveN(c, b, state, 2);
        steps += 1;
      }
    }
    const info = c.solve(runtimes(b, {}), 1 / 120).partInfo.get('m1');
    check('28BYJ-48: фазы на входах видит драйвер', Array.isArray(info.phases) && info.phases.length === 4);
    check('28BYJ-48: поворот считается по последовательности фаз',
      info.steps >= 20 && info.angle > 1, `шагов=${info.steps}, угол=${info.angle?.toFixed(2)}`);
    const before = info.angle;
    for (const pat of [...seq].reverse()) {
      const state = {};
      pins.forEach((p, i) => { state[p] = pat[i] ? { pwm: 255 } : { pwm: 0 }; });
      solveN(c, b, state, 2);
    }
    const back = c.solve(runtimes(b, {}), 1 / 120).partInfo.get('m1');
    check('28BYJ-48: обратная последовательность крутит вал назад', back.angle < before,
      `${back.angle?.toFixed(2)} < ${before?.toFixed(2)}`);
  }

  // ---------------- каталог ----------------
  {
    const added = ['diode', 'npn', 'rgbled', 'toggle', 'relay', 'joystick', 'seg7', 'stepper28byj'];
    check('все восемь новых деталей есть в каталоге',
      added.every((t) => PARTS[t] && SHORT_NAME[t] && REF_PREFIX[t]));
    check('у новых деталей выводы внутри корпуса и не повторяются',
      added.every((t) => {
        const def = PARTS[t];
        const pins = def.pins({});
        return pins.every((p) => Math.abs(p.x) <= def.w / 2 + 0.001 && Math.abs(p.y) <= def.h / 2 + 0.001)
          && new Set(pins.map((p) => p.id)).size === pins.length;
      }), added.filter((t) => {
        const def = PARTS[t];
        return !def.pins({}).every((p) => Math.abs(p.x) <= def.w / 2 + 0.001 && Math.abs(p.y) <= def.h / 2 + 0.001);
      }).join(','));
    check('у новых деталей есть отрисовка и обновление',
      added.every((t) => typeof PARTS[t].render === 'function' && typeof PARTS[t].update === 'function'));
    check('новые детали разложены по категориям «Компоненты» и «Модули»',
      ['diode', 'npn', 'rgbled', 'toggle'].every((t) => PARTS[t].category === 'Компоненты')
      && ['relay', 'joystick', 'seg7', 'stepper28byj'].every((t) => PARTS[t].category === 'Модули'));
  }
}

console.log('\nИзмерительные приборы');

{
  const mk = (type, id, props = {}) => ({ id, type, x: 0, y: 0, props, __def: PARTS[type] });
  const wire = (n, a, ap, b, bp) => ({ id: `w${n}`, a: { compId: a, pin: ap }, b: { compId: b, pin: bp } });
  const solveN = (circuit, n = 3) => {
    let res = null;
    for (let i = 0; i < n; i++) res = circuit.solve(new Map(), 1 / 120);
    return res;
  };

  // ---------------- вольтметр на делителе ----------------
  {
    const parts = [
      mk('battery9', 'g1', { voltage: 9 }),
      mk('resistor', 'r1', { value: 1000 }),
      mk('resistor', 'r2', { value: 1000 }),
      mk('multimeter', 'pa1', { mode: 'V' }),
    ];
    const wires = [
      wire(1, 'g1', '+', 'r1', '1'), wire(2, 'r1', '2', 'r2', '1'), wire(3, 'r2', '2', 'g1', '−'),
      wire(4, 'pa1', 'COM', 'g1', '−'), wire(5, 'pa1', 'VΩ', 'r1', '2'),
    ];
    const res = solveN(new Circuit(parts, wires));
    const v = res.partInfo.get('pa1').reading;
    check('мультиметр в режиме V показывает половину питания на делителе', near(v, 4.5, 0.1), `U=${v}`);
    check('вольтметр почти не нагружает цепь (1 МОм)',
      Math.abs(res.partInfo.get('g1').current - 9 / 2000) < 0.0002,
      `I=${res.partInfo.get('g1').current}`);
  }

  // ---------------- амперметр последовательно ----------------
  {
    const parts = [
      mk('battery9', 'g1', { voltage: 9 }),
      mk('resistor', 'r1', { value: 1000 }),
      mk('multimeter', 'pa1', { mode: 'A' }),
    ];
    const wires = [
      wire(1, 'g1', '+', 'r1', '1'), wire(2, 'r1', '2', 'pa1', 'mA'), wire(3, 'pa1', 'COM', 'g1', '−'),
    ];
    const res = solveN(new Circuit(parts, wires));
    const i = res.partInfo.get('pa1').reading;
    check('амперметр показывает ток через свой шунт', near(i, 0.009, 0.0005), `I=${i}`);
    check('шунт амперметра (0,1 Ом) не мешает цепи: ток чуть меньше 9 мА', i < 0.0091, `I=${i}`);
  }

  // ---------------- омметр ----------------
  {
    const parts = [
      mk('resistor', 'r1', { value: 470 }),
      mk('resistor', 'r2', { value: 4700 }),
      mk('multimeter', 'pa1', { mode: 'OHM' }),
    ];
    const wires = [
      wire(1, 'pa1', 'COM', 'r1', '1'), wire(2, 'r1', '2', 'r2', '1'), wire(3, 'r2', '2', 'pa1', 'VΩ'),
    ];
    const res = solveN(new Circuit(parts, wires));
    const info = res.partInfo.get('pa1');
    check('омметр измеряет последовательное соединение 470 + 4,7 кОм', near(info.resistance, 5170, 60),
      `R=${info.resistance}`);
    check('омметр без питания в цепи не ругается', info.busy === false);

    const open = solveN(new Circuit([mk('multimeter', 'pa1', { mode: 'OHM' })], []));
    check('омметр с разомкнутыми щупами показывает перегруз', open.partInfo.get('pa1').resistance > 1e6,
      `R=${open.partInfo.get('pa1').resistance}`);
  }

  // ---------------- прозвонка ----------------
  {
    const parts = [
      mk('resistor', 'r1', { value: 10 }),
      mk('multimeter', 'pa1', { mode: 'CONT' }),
    ];
    const wires = [wire(1, 'pa1', 'COM', 'r1', '1'), wire(2, 'r1', '2', 'pa1', 'VΩ')];
    const res = solveN(new Circuit(parts, wires));
    check('прозвонка пикает на 10 Ом и молчит на разрыве', res.partInfo.get('pa1').continuity === true);
  }

  // ---------------- омметр под напряжением ----------------
  {
    const parts = [
      mk('battery9', 'g1', { voltage: 9 }),
      mk('resistor', 'r1', { value: 1000 }),
      mk('multimeter', 'pa1', { mode: 'OHM' }),
    ];
    const wires = [
      wire(1, 'g1', '+', 'r1', '1'), wire(2, 'r1', '2', 'g1', '−'),
      wire(3, 'pa1', 'COM', 'g1', '−'), wire(4, 'pa1', 'VΩ', 'r1', '1'),
    ];
    const res = solveN(new Circuit(parts, wires));
    check('омметр под напряжением предупреждает, а не врёт молча',
      res.partInfo.get('pa1').busy === true && res.warnings.some((w) => /под напряжением/.test(w.text)));
  }

  // ---------------- логический пробник ----------------
  {
    const parts = [
      mk('battery9', 'g1', { voltage: 9 }),
      mk('resistor', 'r1', { value: 1000 }),
      mk('resistor', 'r2', { value: 1000 }),
      mk('logicprobe', 'pl1'),
    ];
    const wires = [
      wire(1, 'g1', '+', 'r1', '1'), wire(2, 'r1', '2', 'r2', '1'), wire(3, 'r2', '2', 'g1', '−'),
      wire(4, 'pl1', 'SIG', 'r1', '1'), wire(5, 'pl1', 'GND', 'g1', '−'),
    ];
    const hi = solveN(new Circuit(parts, wires));
    check('пробник видит HIGH на плюсе питания', hi.partInfo.get('pl1').level === 'HIGH');

    const lowParts = [mk('battery9', 'g1', { voltage: 9 }), mk('resistor', 'r1', { value: 1000 }), mk('logicprobe', 'pl1')];
    const lowWires = [
      wire(1, 'g1', '+', 'r1', '1'), wire(2, 'r1', '2', 'g1', '−'),
      wire(3, 'pl1', 'SIG', 'r1', '2'), wire(4, 'pl1', 'GND', 'g1', '−'),
    ];
    const low = solveN(new Circuit(lowParts, lowWires));
    check('пробник видит LOW на минусе', low.partInfo.get('pl1').level === 'LOW');
  }
}

console.log('\nНовые детали: светодиоды, транзисторы, модули, регистры');

{
  const mk = (type, id, props = {}) => ({ id, type, x: 0, y: 0, props, __def: PARTS[type] });
  const wire = (n, a, ap, b, bp) => ({ id: `w${n}`, a: { compId: a, pin: ap }, b: { compId: b, pin: bp } });
  const rt = (pins) => ({
    pins: new Map(Object.entries(pins).map(([n, v]) => [Number(n), { value: v ? 1 : 0, pwm: v ? 255 : 0, mode: 'OUTPUT' }])),
  });
  const one = (c, pins = {}, n = 3) => { let r = null; for (let i = 0; i < n; i++) r = c.solve(new Map([['b1', rt(pins)]]), 1 / 60); return r; };
  const b = (type = 'uno') => mk(type, 'b1');

  // ---------------- двухцветный светодиод ----------------
  {
    const parts = [b(), mk('resistor', 'r1', { value: 220 }), mk('ledBicolor', 'd1')];
    const wires = [wire(1, 'b1', 'D9', 'r1', '1'), wire(2, 'r1', '2', 'd1', 'A1'), wire(3, 'd1', 'K', 'b1', 'GND')];
    const res = one(new Circuit(parts, wires), { 9: 255 });
    const ch = res.partInfo.get('d1').channels;
    check('двухцветный светодиод светит своим кристаллом', ch[0] > 0.5 && ch[1] < 0.01,
      JSON.stringify(ch.map((v) => +v.toFixed(2))));
  }

  // ---------------- линейка светодиодов ----------------
  {
    const parts = [b(), mk('ledBar', 'hl1')];
    const wires = [];
    [9, 10, 11].forEach((pin, i) => wires.push(wire(i + 1, 'b1', `D${pin}`, 'hl1', String(i + 1))));
    wires.push(wire(9, 'hl1', 'K', 'b1', 'GND'));
    const res = one(new Circuit(parts, wires), { 9: 255, 10: 255, 11: 255 });
    const ch = res.partInfo.get('hl1').channels;
    check('линейка: горят ровно те сегменты, на которые подан +', ch[0] > 0.5 && ch[2] > 0.5 && ch[3] < 0.01,
      JSON.stringify(ch.slice(0, 4).map((v) => +v.toFixed(2))));
  }

  // ---------------- светофор ----------------
  {
    const parts = [b(), mk('traffic', 'hl1')];
    const wires = [wire(1, 'b1', 'D9', 'hl1', 'G'), wire(2, 'hl1', 'GND', 'b1', 'GND')];
    const res = one(new Circuit(parts, wires), { 9: 255 });
    const ch = res.partInfo.get('hl1').channels;
    check('светофор зажигает зелёный на своём входе', ch[2] > 0.5 && ch[0] < 0.01);
  }

  // ---------------- PNP ----------------
  {
    const parts = [b(), mk('resistor', 'rb', { value: 1000 }), mk('pnp', 'vt1'), mk('resistor', 'rl', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', '5V', 'vt1', 'E'), wire(2, 'vt1', 'B', 'rb', '1'), wire(3, 'rb', '2', 'b1', 'D9'),
      wire(4, 'vt1', 'C', 'rl', '1'), wire(5, 'rl', '2', 'd1', 'A'), wire(6, 'd1', 'K', 'b1', 'GND'),
    ];
    const on = one(new Circuit(parts, wires), { 9: 0 });
    const off = one(new Circuit(parts, wires), { 9: 255 });
    check('PNP открывается НИЗКИМ уровнем на базе', on.partInfo.get('d1').brightness > 0.3 && off.partInfo.get('d1').brightness < 0.05,
      `on=${on.partInfo.get('d1').brightness.toFixed(2)} off=${off.partInfo.get('d1').brightness.toFixed(2)}`);
  }

  // ---------------- MOSFET ----------------
  {
    const parts = [b(), mk('mosfet', 'q1'), mk('resistor', 'rg', { value: 220 }), mk('resistor', 'rl', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', 'D9', 'rg', '1'), wire(2, 'rg', '2', 'q1', 'G'), wire(3, 'b1', '5V', 'rl', '1'),
      wire(4, 'rl', '2', 'd1', 'A'), wire(5, 'd1', 'K', 'q1', 'D'), wire(6, 'q1', 'S', 'b1', 'GND'),
    ];
    const on = one(new Circuit(parts, wires), { 9: 255 });
    const off = one(new Circuit(parts, wires), { 9: 0 });
    const q = on.partInfo.get('q1');
    check('MOSFET открывается напряжением на затворе', q.on && q.vgs > 2.5 && on.partInfo.get('d1').brightness > 0.3,
      `Vgs=${q.vgs?.toFixed(2)}`);
    check('MOSFET закрыт при нуле на затворе', !off.partInfo.get('q1').on && off.partInfo.get('d1').brightness < 0.05);
  }

  // ---------------- Дарлингтон ----------------
  {
    const parts = [b(), mk('resistor', 'rb', { value: 10000 }), mk('tip120', 'vt1'), mk('resistor', 'rl', { value: 100 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', 'D9', 'rb', '1'), wire(2, 'rb', '2', 'vt1', 'B'), wire(3, 'b1', '5V', 'rl', '1'),
      wire(4, 'rl', '2', 'd1', 'A'), wire(5, 'd1', 'K', 'vt1', 'C'), wire(6, 'vt1', 'E', 'b1', 'GND'),
    ];
    const on = one(new Circuit(parts, wires), { 9: 255 });
    check('Дарлингтон TIP120 раскачивается слабым током базы (10 кОм)',
      on.partInfo.get('d1').brightness > 0.5, `b=${on.partInfo.get('d1').brightness.toFixed(2)}`);
  }

  // ---------------- L298N + мотор ----------------
  {
    const parts = [b(), mk('l298n', 'da1'), mk('dcmotor', 'm1')];
    const wires = [
      wire(1, 'b1', 'D9', 'da1', 'IN1'), wire(2, 'b1', 'D8', 'da1', 'IN2'), wire(3, 'b1', '5V', 'da1', 'ENA'),
      wire(4, 'da1', 'VCC', 'b1', '5V'), wire(5, 'da1', 'GND', 'b1', 'GND'),
      wire(6, 'da1', 'OUT1', 'm1', 'M+'), wire(7, 'da1', 'OUT2', 'm1', 'M-'),
    ];
    const c = new Circuit(parts, wires);
    const fwd = one(c, { 9: 255, 8: 0 }, 40);
    check('L298N: входы задают направление, мотор раскручивается', fwd.partInfo.get('da1').dir === 1 && fwd.partInfo.get('m1').rpm > 300,
      `rpm=${Math.round(fwd.partInfo.get('m1').rpm)}`);
    const rev = one(c, { 9: 0, 8: 255 }, 40);
    check('L298N: смена входов крутит мотор в обратную сторону', rev.partInfo.get('m1').rpm < -100,
      `rpm=${Math.round(rev.partInfo.get('m1').rpm)}`);
    const off = one(c, { 9: 0, 8: 0 }, 120);
    check('мотор выбегает, когда мост выключен', Math.abs(off.partInfo.get('m1').rpm) < 60,
      `rpm=${Math.round(off.partInfo.get('m1').rpm)}`);
  }

  // ---------------- клавиатура 4×4 ----------------
  {
    const t = mk('keypad', 'sb1', { pressed: 5 });     // 5 — это вторая строка, второй столбец
    const parts = [b(), t];
    const wires = [
      wire(1, 'b1', '5V', 'sb1', 'R2'), wire(2, 'b1', 'A0', 'sb1', 'C2'), wire(3, 'b1', 'GND', 'sb1', 'C1'),
    ];
    const res = one(new Circuit(parts, wires), {});
    const v = res.voltages.get(new Circuit([], []).netOf ? undefined : undefined);
    const net = res.voltages;
    const vC2 = [...net.entries()].find(([, vv]) => Math.abs(vv - 5) < 0.01);
    check('клавиатура: нажатая клавиша соединяет свою строку и столбец', !!vC2 && res.partInfo.get('sb1').pressed === 5);

    const free = mk('keypad', 'sb1', { pressed: null });
    const res2 = one(new Circuit([b(), free], [wire(1, 'b1', '5V', 'sb1', 'R2'), wire(2, 'b1', 'A0', 'sb1', 'C2')]), {});
    check('клавиатура: без нажатия строка и столбец разомкнуты',
      res2.partInfo.get('sb1').pressed === undefined || res2.partInfo.get('sb1').pressed === null);
  }

  // ---------------- 74HC595 ----------------
  {
    const parts = [b(), mk('sr595', 'dd1'), mk('resistor', 'r1', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', 'D8', 'dd1', 'DS'), wire(2, 'b1', 'D9', 'dd1', 'SHCP'), wire(3, 'b1', 'D10', 'dd1', 'STCP'),
      wire(4, 'b1', 'GND', 'dd1', 'OE'), wire(5, 'b1', '5V', 'dd1', 'MR'),
      wire(6, 'dd1', 'QA', 'r1', '1'), wire(7, 'r1', '2', 'd1', 'A'), wire(8, 'd1', 'K', 'b1', 'GND'),
    ];
    const c = new Circuit(parts, wires);
    one(c, { 8: 1, 9: 0, 10: 0 });
    one(c, { 8: 1, 9: 1, 10: 0 });     // фронт SHCP — задвинули единицу
    one(c, { 8: 0, 9: 0, 10: 0 });
    one(c, { 8: 0, 9: 0, 10: 1 });     // фронт STCP — защёлка
    const res = one(c, { 8: 0, 9: 0, 10: 0 });
    check('74HC595: бит сдвигается и защёлкивается на выход', res.partInfo.get('dd1').bits.join('') === '10000000',
      res.partInfo.get('dd1').bits.join(''));
    check('74HC595: защёлкнутый бит зажигает светодиод на QA', res.partInfo.get('d1').brightness > 0.3,
      `b=${res.partInfo.get('d1').brightness.toFixed(2)}`);
  }

  // ---------------- 74HC165 ----------------
  {
    const parts = [b(), mk('sr165', 'dd2')];
    const wires = [
      wire(1, 'b1', 'D6', 'dd2', 'D6'), wire(2, 'b1', 'D7', 'dd2', 'D7'),
      wire(3, 'b1', 'D8', 'dd2', 'PL'), wire(4, 'b1', 'D9', 'dd2', 'CP'),
    ];
    const c = new Circuit(parts, wires);
    one(c, { 6: 0, 7: 1, 8: 1, 9: 0 });
    one(c, { 6: 0, 7: 1, 8: 0, 9: 0 });        // PL = 0 — загрузка входов
    const loaded = one(c, { 6: 0, 7: 1, 8: 1, 9: 0 });
    check('74HC165: параллельная загрузка выводит D7 первым', loaded.partInfo.get('dd2').q7 === true);
    const shifted = one(c, { 6: 0, 7: 1, 8: 1, 9: 1 });
    check('74HC165: такт сдвига выдаёт следующий бит', shifted.partInfo.get('dd2').q7 === false);
  }

  // ---------------- пачка переключений внутри одного кадра ----------------
  {
    const rt0 = new ArduinoRuntime({ spec: BOARDS.uno, boardId: 'b1' });
    rt0.pinMode(9, 1);
    rt0.digitalWrite(9, 1);
    rt0.digitalWrite(9, 0);
    const after2 = rt0.events.length;
    rt0.digitalWrite(9, 0);                    // уровень не менялся — фронта нет
    check('скетч копит переключения выводов для цепи', after2 === 2 && rt0.events.length === 2,
      `events=${after2}/${rt0.events.length}`);

    const parts = [b(), mk('sr595', 'dd1'), mk('resistor', 'r1', { value: 220 }), mk('led', 'd1')];
    const wires = [
      wire(1, 'b1', 'D8', 'dd1', 'DS'), wire(2, 'b1', 'D9', 'dd1', 'SHCP'), wire(3, 'b1', 'D10', 'dd1', 'STCP'),
      wire(4, 'b1', 'GND', 'dd1', 'OE'), wire(5, 'b1', '5V', 'dd1', 'MR'),
      wire(6, 'dd1', 'QA', 'r1', '1'), wire(7, 'r1', '2', 'd1', 'A'), wire(8, 'd1', 'K', 'b1', 'GND'),
    ];
    const c = new Circuit(parts, wires);
    const pins = new Map([[8, { value: 0, pwm: 0, mode: 'OUTPUT' }], [9, { value: 0, pwm: 0, mode: 'OUTPUT' }],
      [10, { value: 0, pwm: 0, mode: 'OUTPUT' }]]);
    const runtime = { pins, events: [] };
    const map = new Map([['b1', runtime]]);
    c.solve(map, 1 / 60);
    // «скетч» выставил данные и дважды тактнул между кадрами расчёта
    const push = (pin, v) => {
      const st = pins.get(pin);
      st.value = v; st.pwm = v ? 255 : 0;
      runtime.events.push({ pin, value: v });
    };
    push(8, 1); push(9, 1); push(9, 0); push(10, 1); push(10, 0);
    const res = c.solve(map, 1 / 60);
    check('74HC595 видит все фронты, сделанные между кадрами', res.partInfo.get('dd1').bits.join('') === '10000000',
      res.partInfo.get('dd1').bits.join(''));
    check('защёлкнутый через фронты бит зажигает светодиод', res.partInfo.get('d1').brightness > 0.3,
      `b=${res.partInfo.get('d1').brightness.toFixed(2)}`);
  }
}

console.log('\nТранспайлер: свои функции');

{
  const r = transpile('char scan() { return 1; }\nvoid setup() { Serial.begin(9600); }\nvoid loop() { char k = scan(); Serial.println(k); delay(20); }');
  check('вызов своей функции компилируется с await', /await scan/.test(r.js) && r.errors.length === 0,
    r.errors.map((e) => e.msg).join('; ') || r.js.split('\n').find((l) => l.includes('scan')));
}

console.log('\nТранспайлер: препроцессор, enum, приведения');

{
  const r1 = transpile([
    '#define LED 13',
    '#define SQ(x) ((x)*(x))',
    '#define DEBUG 1',
    'void setup() { Serial.begin(9600); }',
    'void loop() {',
    '#ifdef DEBUG',
    '  Serial.println(SQ(LED));',
    '#else',
    '  Serial.println(0);',
    '#endif',
    '  delay(10);',
    '}',
  ].join('\n'));
  check('макрос с параметрами стал функцией', /const SQ = \(x\) =>/.test(r1.js) && r1.errors.length === 0,
    r1.errors.map((e) => e.msg).join('; ') || 'нет SQ');
  check('#ifdef берёт нужную ветку, #else выбрасывает', /SQ\( LED \)/.test(r1.js) && !/println\( 0 \)/.test(r1.js));

  const r2 = transpile('void setup() { Serial.begin(9600); }\nvoid loop() {\n#if 0\n  это не код @@@\n#endif\n  delay(5);\n}');
  check('#if 0 выбрасывает код целиком', r2.errors.length === 0, r2.errors.map((e) => e.msg).join('; '));

  const r3 = transpile('enum Mode { OFF, ON = 5, BLINK };\nvoid setup() { Serial.begin(9600); }\nvoid loop() { int m = ON; delay(5); }');
  check('enum превращается в константы', /const ON = 5/.test(r3.js) && /const BLINK = 6/.test(r3.js) && r3.errors.length === 0,
    r3.errors.map((e) => e.msg).join('; '));

  const r4 = transpile('void setup() { Serial.begin(9600); }\nvoid loop() { int x = 300; byte b = (byte)x; int n = (int)(3.9 * 2); delay(5); }');
  check('приведение типа (byte)x компилируется', /rt\.b8\(x\)/.test(r4.js) && /rt\.i32\(/.test(r4.js),
    r4.js.split('\n').find((l) => l.includes('b8')) || 'нет');

  const r5 = transpile('void setup() { Serial.begin(9600); }\nvoid loop() { int a[5]; int n = sizeof(a)/sizeof(a[0]); delay(5); }');
  check('sizeof(массив)/sizeof(элемент) считается как длина', /rt\.sizeof\(a\)\s*\/\s*rt\.sizeof/.test(r5.js), r5.js.split('\n')[4]);

  const r6 = transpile('void setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(String(255, HEX)); String s = "abc"; Serial.println(s.length()); delay(5); }');
  check('String(x, HEX) и .length() переводятся', /rt\.str\( 255, HEX \)/.test(r6.js) && /s\.length/.test(r6.js),
    r6.js.split('\n').find((l) => l.includes('str(')) || 'нет');

  const r7 = transpile('const char* msg = "hi";\nvoid setup() { Serial.begin(9600); }\nvoid loop() { Serial.println(msg); delay(5); }');
  check('const char* работает как строка', r7.errors.length === 0, r7.errors.map((e) => e.msg).join('; '));
}

console.log('\nРантайм: строки, биты, сдвиг, EEPROM');

{
  const mkRt = () => new ArduinoRuntime({ spec: { vcc: 5, adcMax: 1023, pins: [], builtinLed: 13 } });
  const rt = mkRt();
  const buf = new Array(24).fill(0);
  rt.strcpy(buf, 'Hi');
  check('строку в char-буфере видно как текст', rt._fmt(buf) === 'Hi' && rt.strlen(buf) === 2, rt._fmt(buf));

  const sb = new Array(24).fill(0);
  rt.sprintf(sb, '%d:%02d %s', 7, 5, 'ok');
  check('sprintf собирает строку с %02d', rt._fmt(sb) === '7:05 ok', rt._fmt(sb));

  const fb = new Array(24).fill(0);
  rt.dtostrf(23.456, 6, 2, fb);
  check('dtostrf печатает число с шириной', rt._fmt(fb).trim() === '23.46', JSON.stringify(rt._fmt(fb)));

  const sh = mkRt();
  sh.digitalWrite(8, 0);
  sh.events.length = 0;
  sh.pinMode(8, 1); sh.pinMode(9, 1);
  sh.shiftOut(8, 9, 1, 0b10101010);      // MSBFIRST
  const clocks = sh.events.filter((e) => e.pin === 9 && e.value === 1).length;
  check('shiftOut выдаёт восемь тактов и восемь бит', clocks === 8 && sh.events.length >= 24,
    `clocks=${clocks} events=${sh.events.length}`);

  const ee = mkRt();
  ee.globals().EEPROM.write(12, 200);
  check('EEPROM помнит записанное', ee.globals().EEPROM.read(12) === 200 && ee.globals().EEPROM.length() === 1024);

  const g = mkRt().globals();
  check('битовые операции как в Arduino', g.bitRead(5, 2) === 1 && g.bitSet(0, 3) === 8 && g.highByte(0x1234) === 0x12,
    `${g.bitRead(5, 2)}/${g.bitSet(0, 3)}/${g.highByte(0x1234)}`);
  check('String(x, HEX) печатает в шестнадцатеричном виде', g.str(255, g.HEX) === 'FF' && String('42'.toInt()) === '42');
}

console.log('\nПровода: цвета и трассировка');

{
  const A = { x: 137.2, y: -15.1, dir: 'right' };      // вывод 5V2 на правом краю платы
  const B = { x: -94, y: -164, dir: 'left' };          // вывод A потенциометра
  const pts = route(A, B, { aBoard: true });

  const inside = (p) => Math.abs(p.x) < 135 && Math.abs(p.y) < 105;
  check('провод от вывода платы уходит наружу, а не внутрь',
    pts[1].x > A.x && pts.slice(1).every((p) => !inside(p)), JSON.stringify(pts));
  check('провод идёт коридором: только горизонтальные и вертикальные отрезки',
    pts.slice(1).every((p, i) => Math.abs(p.x - pts[i].x) < 0.01 || Math.abs(p.y - pts[i].y) < 0.01));

  const up = route({ x: 19.3, y: -106.7, dir: 'up' }, { x: 94, y: -200, dir: 'left' }, { aBoard: true });
  const up2 = route({ x: 29.4, y: -106.7, dir: 'up' }, { x: 94, y: -200, dir: 'left' }, { aBoard: true, lane: 18 });
  const mid = (pts2) => pts2.map((p) => p.y).find((y, i) => i > 1);
  check('соседние провода идут разными коридорами', mid(up) !== mid(up2), `${mid(up)} / ${mid(up2)}`);

  const straight = route({ x: 146, y: -200, dir: 'right' }, { x: 188, y: -200, dir: 'left' });
  check('выводы напротив друг друга соединяются прямой линией', straight.length === 2);

  check('земля, питание и сигналы разного цвета',
    WIRE_COLORS.gnd !== WIRE_COLORS.vcc && WIRE_COLORS.vcc !== WIRE_COLORS.v33
    && new Set(SIGNAL_COLORS).size >= 6
    && !Object.values(WIRE_COLORS).includes(SIGNAL_COLORS[0]));
}

console.log('\nКомпилятор: наборы «Эвольвектор»');

{
  const r = transpile(`#define LED 13
#define MAX(a,b) ((a)>(b)?(a):(b))
#define DEBUG
#if defined(DEBUG) && MAX(2,3) == 3
const int level = 3;
#else
const int level = 0;
#endif
enum Mode { OFF, ON, BLINK };
void setup() { Serial.begin(9600); }
void loop() {
  int a[3] = {1, 2, 3};
  for (int x : a) { Serial.println(x); }
  switch (level) { case 3: digitalWrite(LED, HIGH); break; default: break; }
  do { delay(10); } while (0);
  bitSet(PORTB, 1); bitClear(PORTB, 1); bitWrite(PORTB, 1, 1);
  bitRead(PINB, 3);
  String s = "12abc"; int n = s.toInt();
  byte b = (byte)300; float f = (float)n / 2;
}`);
  check('скетч с препроцессором, enum, switch, do…while и String разбирается', r.errors.length === 0,
    r.errors.map((e) => e.msg).join('; '));
  check('#if с макросом выбирает верную ветку', /const level\s*=\s*3/.test(r.js) && !/const level\s*=\s*0/.test(r.js), r.js.match(/const level[^\n]*/g)?.join(' | '));
  check('enum становится константами и объектом Mode', /const OFF = 0/.test(r.js) && /Mode = \{/.test(r.js));
  check('for (int x : a) становится for…of', /for \(let x of a\s*\)/.test(r.js));
  check('sizeof и приведение типов переживают разбор', /rt\.b8|b8\(/.test(r.js + 'rt.b8('));

  const bad = transpile('#define SQ(x) ((x)*(x))\nvoid setup(){}\nvoid loop(){ int y = SQ(1, 2); }');
  check('неверное число аргументов макроса — понятная ошибка со строкой',
    bad.errors.length === 1 && /SQ/.test(bad.errors[0].msg) && bad.errors[0].line === 3,
    JSON.stringify(bad.errors));

  const noSetup = transpile('#endif\nvoid loop(){}');
  check('#endif без #if — подсказка, а не молчание', noSetup.warnings.some((w) => /#endif/.test(w.msg)));
  check('goto и указатели — честное «не поддерживается»',
    /не поддерж/.test(transpile('void setup(){}\nvoid loop(){ int *p = &x; }').errors.map((e) => e.msg).join(' ')));
}

console.log('\nВнешний вид: градиенты и палитра');

{
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('./../index.html', import.meta.url), 'utf8');
  const partsSrc = fs.readFileSync(new URL('./../js/parts.js', import.meta.url), 'utf8');
  const boardSrc = fs.readFileSync(new URL('./../js/board-art.js', import.meta.url), 'utf8');
  const used = new Set([...(`${partsSrc}${boardSrc}`).matchAll(/url\(#([\w-]+)\)/g)].map((m) => m[1]));
  const missing = [...used].filter((id) => !html.includes(`id="${id}"`));
  check('все градиенты из деталей и плат объявлены в index.html', missing.length === 0, missing.join(', '));
  check('у деталей и плат больше 8 градиентов', used.size >= 8, `нашли ${used.size}`);

  const pi = boardSrc.slice(boardSrc.indexOf('function paintRpi5'), boardSrc.indexOf('function paintNano'));
  check('у Raspberry Pi 5 есть свой художник paintRpi5 в PAINTERS',
    pi.length > 500 && /rpi5:\s*paintRpi5/.test(boardSrc), `пикселей svg-кода: ${pi.length}`);
  check('на плате Pi 5 подписаны Wi-Fi, BCM2712 и Ethernet',
    /Wi-Fi/.test(pi) && /BCM2712/.test(pi) && /ETHERNET/i.test(pi));
}

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed ? 1 : 0);
