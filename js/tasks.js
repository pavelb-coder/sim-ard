/**
 * tasks.js — учебные задания с автопроверкой (этап 4).
 *
 * Задание = бриф для ученика + стартовая схема + список проверок.
 * Каждая проверка — предикат над контекстом (см. checker.js): схема, код,
 * наблюдения работающего скетча. Проверки ничего не «подгоняют»: сначала
 * ученик собирает схему и пишет код, потом жмёт «Проверить».
 *
 * У каждого задания есть эталон — готовый пример из examples.js. Тесты
 * прогоняют эталоны через движок: если эталон не проходит задание,
 * значит сломались проверки, а не ученик.
 */

import { EXAMPLES } from './examples.js';

const board = (type = 'uno', x = 0, y = 0, id = 'b1') => ({ id, type, x, y, props: {} });
const wire = (ac, ap, bc, bp) => ({ a: { compId: ac, pin: ap }, b: { compId: bc, pin: bp } });

/** Минимальный стартовый скетч: setup/loop уже на месте, писать есть куда. */
const SKELETON_CPP = `// Задание: соберите схему и допишите скетч.
// Подсказка появится в панели «Проблемы», если что-то забыли.

void setup() {
  Serial.begin(9600);
}

void loop() {

}
`;

const SKELETON_MPY = `# MicroPython
from machine import Pin
import time

while True:
    pass
`;

export const LEVELS = {
  1: 'Новичок',
  2: 'Уверенный',
  3: 'Продвинутый',
};

/** Общие «кирпичики» проверок, чтобы не повторяться. */
const ledWithResistor = {
  id: 'led-resistor',
  kind: 'schema',
  text: 'Светодиод подключён через резистор (последовательная цепь)',
  hint: 'Светодиод не подключают к выводу напрямую: сначала резистор 220 Ом, потом светодиод, потом земля.',
  test: (cx) => {
    const p = cx.path('D9', 'GND');
    return { ok: Boolean(p && p.includes('led') && p.includes('resistor')), detail: p ? `путь: ${p.join(' → ')}` : 'путь не найден' };
  },
};

export const TASKS = [
  // ------------------------------------------------------------------ 1 ----
  {
    id: 'led-first',
    title: 'Первый светодиод',
    level: 1,
    topic: 'Цифровые выводы',
    minutes: 10,
    brief: 'Соберите цепь «вывод → резистор → светодиод → земля» и заставьте светодиод мигать. Это первая схема, с которой начинают все.',
    goals: [
      'Светодиод подключён к выводу D9',
      'Резистор 220 Ом стоит последовательно со светодиодом',
      'В скетче есть pinMode(9, OUTPUT) и digitalWrite()',
      'Светодиод действительно мигает',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'has-led', kind: 'schema', text: 'На схеме есть светодиод',
        test: (cx) => cx.count('led') >= 1,
      },
      {
        id: 'led-on-d9', kind: 'schema', text: 'Светодиод подключён к выводу D9',
        hint: 'Один вывод светодиода — на D9 платы, второй — к резистору. Провод тянется кликом по выводу, затем по другому.',
        test: (cx) => cx.onBoardPin('D9', 'led').length === 1,
      },
      ledWithResistor,
      {
        id: 'code-output', kind: 'code', text: 'В скетче вывод 9 настроен как выход',
        hint: 'В setup() нужен pinMode(9, OUTPUT) — вывод сам не становится выходом.',
        test: (cx) => cx.outputPins().has(9),
      },
      {
        id: 'blinks', kind: 'behavior', text: 'Вывод D9 переключался хотя бы 4 раза',
        hint: 'Нужны digitalWrite(9, HIGH) и digitalWrite(9, LOW) с паузой между ними — запустите скетч кнопкой «Старт».',
        test: (cx) => cx.flips('D9') >= 4,
      },
      {
        id: 'glows', kind: 'behavior', text: 'Светодиод загорался',
        hint: 'Если схема собрана, а светодиод не горит — проверьте, что земля светодиода идёт на GND платы.',
        test: (cx) => ({ ok: cx.ledBrightness() > 0.2, detail: `яркость ${(cx.ledBrightness() * 100).toFixed(0)} %` }),
      },
    ],
    solutionExample: 'led',
  },

  // ------------------------------------------------------------------ 2 ----
  {
    id: 'button-led',
    title: 'Кнопка зажигает светодиод',
    level: 1,
    topic: 'Цифровые входы',
    minutes: 12,
    brief: 'Добавьте кнопку: пока она нажата — светодиод горит. Кнопку подключите между D2 и землёй, а в скетче включите внутреннюю подтяжку.',
    goals: [
      'Кнопка между D2 и GND',
      'В скетче pinMode(2, INPUT_PULLUP) и digitalRead(2)',
      'При нажатии кнопки светодиод загорается',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'has-button', kind: 'schema', text: 'Кнопка подключена к D2 и к земле',
        hint: 'Одна нога кнопки — на D2, вторая — на GND. Подтяжку включим программно, отдельный резистор не нужен.',
        test: (cx) => cx.partsOf('button').some((b) => (cx.attached('D2', b.id, '1') || cx.attached('D2', b.id, '2'))
          && (cx.toGround(b.id, '1') || cx.toGround(b.id, '2'))),
      },
      {
        id: 'pullup', kind: 'code', text: 'Включена внутренняя подтяжка INPUT_PULLUP',
        hint: 'pinMode(BUTTON, INPUT_PULLUP) — иначе нажатие «поймать» не получится: вывод будет висеть в воздухе.',
        test: (cx) => ({ ok: cx.codeHas(/INPUT_PULLUP/), detail: cx.codeHas(/INPUT_PULLUP/) ? '' : 'нет INPUT_PULLUP в скетче' }),
      },
      {
        id: 'reads', kind: 'code', text: 'Скетч читает состояние кнопки через digitalRead',
        test: (cx) => cx.calls('digitalRead').length > 0,
      },
      {
        id: 'led-wiring', kind: 'schema', text: 'Светодиод с резистором подключён к D9',
        test: (cx) => {
          const p = cx.path('D9', 'GND');
          return Boolean(p && p.includes('led') && p.includes('resistor') && cx.onBoardPin('D9', 'led').length === 1);
        },
      },
      {
        id: 'reacts', kind: 'behavior', text: 'Пока кнопка нажата, светодиод горит',
        hint: 'Запустите скетч и нажмите кнопку на схеме мышью — симулятор запомнит, что происходило в этот момент.',
        test: (cx) => ({
          ok: cx.trace.pressSeen && (cx.trace.ledWhilePressed || 0) > 0.2,
          detail: cx.trace.pressSeen ? 'нажатие было, светодиод — ' + Math.round((cx.trace.ledWhilePressed || 0) * 100) + ' %' : 'нажатия кнопки не было',
        }),
      },
    ],
    solutionExample: 'button',
  },

  // ------------------------------------------------------------------ 3 ----
  {
    id: 'pot-dimmer',
    title: 'Регулятор яркости',
    level: 2,
    topic: 'Аналоговый вход и ШИМ',
    minutes: 15,
    brief: 'Потенциометр задаёт яркость светодиода. Крутите ручку — яркость меняется: аналоговый вход читаем, ШИМ выдаём.',
    goals: [
      'Потенциометр: крайние ножки на 5V и GND, средняя — на A0',
      'analogRead(A0) → map() → analogWrite(9, …)',
      'При повороте ручки яркость меняется минимум в трёх положениях',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'pot-a0', kind: 'schema', text: 'Средняя ножка потенциометра подключена к A0',
        test: (cx) => cx.onBoardPin('A0', 'pot').length === 1,
      },
      {
        id: 'pot-power', kind: 'schema', text: 'Крайние ножки потенциометра — на питании и земле',
        hint: 'Без питания на краях потенциометр не делит напряжение: A0 будет всегда показывать 0.',
        test: (cx) => cx.partsOf('pot').some((p) => (cx.toVcc(p.id, 'A') && cx.toGround(p.id, 'B'))
          || (cx.toVcc(p.id, 'B') && cx.toGround(p.id, 'A'))),
      },
      {
        id: 'code-analog', kind: 'code', text: 'Скетч читает A0 и управляет ШИМ',
        test: (cx) => cx.calls('analogRead').length > 0 && (cx.calls('analogWrite').length > 0 || cx.codeHas(/duty_u16/)),
      },
      {
        id: 'pwm-varied', kind: 'behavior', text: 'Скважность ШИМ принимала минимум 3 разных значения',
        hint: 'Запустите скетч и покрутите ручку потенциометра мышью.',
        test: (cx) => {
          const vals = cx.pwms('D9').filter((v) => v > 0 && v < 255);
          return { ok: new Set(vals).size >= 3, detail: `значений: ${new Set(vals).size}` };
        },
      },
      {
        id: 'brightness-moved', kind: 'behavior', text: 'Яркость светодиода менялась',
        test: (cx) => (cx.trace.ledSpread || 0) > 0.1,
      },
    ],
    solutionExample: 'pot',
  },

  // ------------------------------------------------------------------ 4 ----
  {
    id: 'rc-measure',
    title: 'Измеряем RC-цепь',
    level: 2,
    topic: 'Конденсаторы и измерения',
    minutes: 18,
    brief: 'Соберите RC-цепь из резистора 10 кОм и конденсатора 100 мкФ, заряжайте её с вывода D9 и измеряйте напряжение на A0. На осциллографе должна получиться экспонента.',
    goals: [
      'Резистор между D9 и плюсом конденсатора',
      'Конденсатор между этой точкой и землёй',
      'A0 измеряет напряжение на конденсаторе',
      'Скетч печатает показания в монитор порта',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'has-c', kind: 'schema', text: 'На схеме есть конденсатор',
        test: (cx) => cx.count('capacitor') + cx.count('electrolytic') >= 1,
      },
      {
        id: 'r-in-series', kind: 'schema', text: 'Резистор стоит между D9 и конденсатором',
        hint: 'Порядок: D9 → резистор → плюс конденсатора → земля. Иначе конденсатор зарядится мгновенно и никакой кривой не будет.',
        test: (cx) => {
          const p = cx.path('D9', 'A0');
          return { ok: Boolean(p && p.includes('resistor')), detail: p ? `путь: ${p.join(' → ')}` : 'D9 и A0 не связаны' };
        },
      },
      {
        id: 'c-to-ground', kind: 'schema', text: 'Конденсатор подключён второй ножкой к земле',
        test: (cx) => [...cx.partsOf('capacitor'), ...cx.partsOf('electrolytic')]
          .some((c) => cx.toGround(c.id, '1') || cx.toGround(c.id, '2')),
      },
      {
        id: 'a0-measures', kind: 'behavior', text: 'A0 видит заряд конденсатора: показания доходили до 2 В',
        hint: 'Запустите скетч и дайте ему поработать пару секунд: конденсатор заряжается плавно, и A0 должен это увидеть.',
        test: (cx) => {
          const a = cx.analog('A0');
          if (!a) return { ok: false, detail: 'analogRead(A0) не вызывался' };
          const adcMax = cx.boards()[0]?.type === 'uno' ? 1023 : 4095;
          const threshold = Math.round(adcMax * 0.4);
          return {
            ok: (a.max ?? 0) >= threshold,
            detail: `максимум ${a.max ?? 0} из ${adcMax}, нужно ≥ ${threshold}`,
          };
        },
      },
      {
        id: 'a0-changes', kind: 'behavior', text: 'Показания A0 не стоят на месте (заряд и разряд видны)',
        hint: 'Полный цикл в примере-эталоне — около 6 секунд: час зарядки и столько же разрядки. Дайте скетчу поработать подольше.',
        test: (cx) => {
          const a = cx.analog('A0');
          if (!a) return { ok: false, detail: 'analogRead(A0) не вызывался' };
          const spread = (a.max ?? 0) - (a.min ?? 0);
          return { ok: spread > 200, detail: `размах ${spread}; запустите скетч секунд на 7` };
        },
      },
      {
        id: 'prints', kind: 'behavior', text: 'Значения выводятся в монитор порта',
        test: (cx) => /[0-9]{2,}/.test(cx.serialText()),
      },
    ],
    solutionExample: 'rc',
  },

  // ------------------------------------------------------------------ 5 ----
  {
    id: 'servo-sweep',
    title: 'Серво-стрелка',
    level: 2,
    topic: 'Библиотеки и ШИМ',
    minutes: 15,
    brief: 'Подключите сервопривод к D9 и заставьте его качаться от 0 до 180 градусов. Библиотека Servo подключается по имени — как в настоящей Arduino IDE.',
    goals: [
      '#include <Servo.h> и объект Servo',
      'attach(9) в setup()',
      'Плавное качание через write(angle)',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'has-servo', kind: 'schema', text: 'Сервопривод подключён: сигнал на D9, питание и земля на плате',
        test: (cx) => cx.partsOf('servo').some((s) => cx.attached('D9', s.id, 'PWM')
          && cx.toVcc(s.id, 'VCC') && cx.toGround(s.id, 'GND')),
      },
      {
        id: 'include', kind: 'code', text: 'Подключена библиотека Servo',
        test: (cx) => cx.codeHas(/#include\s*<Servo\.h>/),
      },
      {
        id: 'attach', kind: 'code', text: 'В setup() вызван attach(9)',
        test: (cx) => cx.calls('attach').some((a) => cx.pinArgValue(a.split(',')[0]) === 9),
      },
      {
        id: 'sweeps', kind: 'behavior', text: 'Вал поворачивался минимум на 120 градусов',
        hint: 'Запустите скетч: сервопривод должен качаться. Угол показан на самой детали.',
        test: (cx) => {
          const s = Object.values(cx.trace.servos || {})[0];
          if (!s) return { ok: false, detail: 'угол не менялся' };
          return { ok: (s.max - s.min) >= 120, detail: `диапазон ${Math.round(s.min)}°…${Math.round(s.max)}°` };
        },
      },
    ],
    solutionExample: 'servo',
  },

  // ------------------------------------------------------------------ 6 ----
  {
    id: 'lcd-hello',
    title: 'Привет на LCD',
    level: 3,
    topic: 'I2C и дисплеи',
    minutes: 20,
    brief: 'Выведите на LCD 1602 две строки: приветствие и показание millis() в секундах. Дисплей подключается по I2C — две линии данных.',
    goals: [
      'LCD: GND, VCC, SDA → A4, SCL → A5',
      'lcd.init() и lcd.backlight()',
      'Две строки текста, во второй — меняющееся число',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'wiring', kind: 'schema', text: 'Дисплей подключён по I2C: SDA → A4, SCL → A5, питание и земля на месте',
        test: (cx) => cx.partsOf('lcd1602').some((l) => cx.attached('A4', l.id, 'SDA') && cx.attached('A5', l.id, 'SCL')
          && cx.toVcc(l.id, 'VCC') && cx.toGround(l.id, 'GND')),
      },
      {
        id: 'include', kind: 'code', text: 'Подключена библиотека LiquidCrystal_I2C',
        test: (cx) => cx.codeHas(/#include\s*<LiquidCrystal_I2C\.h>/),
      },
      {
        id: 'prints', kind: 'code', text: 'Скетч печатает на дисплей (print)',
        test: (cx) => cx.codeHas(/\.print\s*\(/),
      },
      {
        id: 'text-on-screen', kind: 'behavior', text: 'На дисплее есть текст, и в нём меняется число',
        hint: 'Запустите скетч: дисплей на схеме — это не картинка, на нём правда появляется текст.',
        test: (cx) => {
          const lines = Object.values(cx.trace.lcd || {})[0] || [];
          const text = lines.join(' ');
          const letters = (text.match(/[A-Za-zА-Яа-я]/g) || []).length;
          const digits = (text.match(/\d/g) || []).length;
          return { ok: letters >= 3 && digits >= 1, detail: `«${text.trim()}»` };
        },
      },
    ],
    solutionExample: 'lcd',
  },

  // ------------------------------------------------------------------ 7 ----
  {
    id: 'sonar-park',
    title: 'Парктроник',
    level: 3,
    topic: 'Датчики и время',
    minutes: 20,
    brief: 'Дальномер HC-SR04: измерьте расстояние до препятствия так же, как это делает настоящий парктроник — импульсом и pulseIn().',
    goals: [
      'TRIG → D7, ECHO → D8, питание и земля на месте',
      'digitalWrite(TRIG) и pulseIn(ECHO, HIGH)',
      'В монитор порта печатается расстояние в сантиметрах',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'wiring', kind: 'schema', text: 'Дальномер подключён: TRIG → D7, ECHO → D8',
        test: (cx) => cx.partsOf('hcsr04').some((s) => cx.attached('D7', s.id, 'TRIG') && cx.attached('D8', s.id, 'ECHO')
          && cx.toVcc(s.id, 'VCC') && cx.toGround(s.id, 'GND')),
      },
      {
        id: 'pulsein', kind: 'code', text: 'Длительность эха измеряется через pulseIn',
        test: (cx) => cx.codeHas(/pulseIn\s*\(/),
      },
      {
        id: 'formula', kind: 'code', text: 'Длина импульса пересчитывается в сантиметры',
        hint: 'Расстояние = длительность импульса / 58 (микросекунд на сантиметр).',
        test: (cx) => cx.codeHas(/\/\s*58|0\.0343|\/\s*29\b/),
      },
      {
        id: 'distances', kind: 'behavior', text: 'Симулятор видел два разных расстояния',
        hint: 'Запустите скетч и потяните дальномер мышью — расстояние до «стены» изменится.',
        test: (cx) => {
          const seen = cx.trace.sonarDistances || [];
          return { ok: new Set(seen).size >= 2, detail: `видели: ${seen.slice(-4).join(', ')} см` };
        },
      },
      {
        id: 'prints', kind: 'behavior', text: 'Расстояние печатается в монитор порта',
        test: (cx) => /см|cm/i.test(cx.serialText()) || /[0-9]{1,3}\s*[0-9]*/.test(cx.serialText()),
      },
    ],
    solutionExample: 'sonar',
  },

  // ------------------------------------------------------------------ 8 ----
  {
    id: 'two-boards',
    title: 'Две платы на одной схеме',
    level: 3,
    topic: 'Несколько плат',
    minutes: 20,
    brief: 'Поставьте рядом Arduino Uno и ESP32, и напишите каждому свой скетч. У каждой платы своя вкладка кода и свой встроенный светодиод.',
    goals: [
      'На схеме две платы: Uno и ESP32',
      'У каждой платы свой скетч во вкладке',
      'Оба встроенных светодиода мигают одновременно',
    ],
    start: { parts: [board('uno', 0, -110, 'b1'), board('esp32', 0, 150, 'b2')], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'two-boards', kind: 'schema', text: 'На схеме Arduino Uno и ESP32',
        test: (cx) => {
          const types = cx.boards().map((b) => b.type);
          return { ok: types.includes('uno') && types.includes('esp32'), detail: types.join(', ') };
        },
      },
      {
        id: 'both-blink', kind: 'behavior', text: 'Оба встроенных светодиода переключались',
        hint: 'Не забудьте запустить каждую плату: у ESP32 встроенный светодиод — GPIO2, у Uno — D13.',
        test: (cx) => {
          const boards = cx.boards();
          const okList = boards.map((b) => {
            const spec = b.__def?.spec || null;
            const ledPin = spec?.builtinLed;
            const flips = ledPin === undefined ? 0 : (cx.trace.pinFlips?.[`${b.id}:${ledPin}`] || 0);
            return { id: b.id, type: b.type, flips };
          });
          return { ok: okList.every((x) => x.flips >= 2), detail: okList.map((x) => `${x.type}: ${x.flips}`).join(', ') };
        },
      },
      {
        id: 'own-lang', kind: 'code', text: 'У ESP32 свой скетч, а не копия от Uno',
        test: (cx) => {
          const codes = cx.boards().map((b) => (b.props?.code || '').trim()).filter(Boolean);
          return { ok: codes.length >= 2 && new Set(codes).size === codes.length, detail: `${codes.length} скетча` };
        },
      },
    ],
    solutionExample: 'two-boards',
  },
];

/** Задание по id. */
export const taskById = (id) => TASKS.find((t) => t.id === id) || null;

/** Готовое решение задания — пример из examples.js (или собственный слепок). */
export function solutionOf(task) {
  if (!task?.solutionExample) return null;
  return EXAMPLES.find((e) => e.id === task.solutionExample) || null;
}
