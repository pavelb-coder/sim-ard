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

  check('неизвестная плата рисуется заглушкой', renderBoardArt({ id: 'nano', short: 'NANO', w: 100, h: 60, pins: [] }).includes('NANO'));
  check('у каждой детали есть короткое имя и префикс обозначения',
    Object.keys(PARTS).every((t) => SHORT_NAME[t] && REF_PREFIX[t]),
    Object.keys(PARTS).filter((t) => !SHORT_NAME[t] || !REF_PREFIX[t]).join(','));
  check('платы обозначаются как A1, A2 (не как U)',
    REF_PREFIX.uno === 'A' && REF_PREFIX.esp32 === 'A' && REF_PREFIX.pico === 'A');
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

console.log(`\nИтого: ${passed} ок, ${failed} провалено\n`);
process.exit(failed ? 1 : 0);
