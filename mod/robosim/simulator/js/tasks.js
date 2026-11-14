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
import { PARTS } from './parts.js';

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

/** Скетч без комментариев: слова из подсказок не должны проходить проверки. */
const noComments = (code) => String(code || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Фабрика проверки: светодиод с резистором на выводе (путь «вывод → GND»). */
const ledOn = (pin, id = `led-${pin.toLowerCase()}`) => ({
  id,
  kind: 'schema',
  text: `Светодиод с резистором подключён к ${pin}`,
  hint: `Цепь: ${pin} → резистор 220 Ом → анод светодиода → катод → GND. Без резистора светодиод сгорит.`,
  test: (cx) => {
    const p = cx.path(pin, 'GND');
    const ok = Boolean(p && p.includes('led') && p.includes('resistor'));
    return { ok, detail: p ? `путь: ${p.join(' → ')}` : 'путь не найден' };
  },
});

/** Модуль подключён к питанию и земле платы. */
const powered = (type, id = 'powered') => ({
  id,
  kind: 'schema',
  text: 'Модуль подключён к питанию 5 В и к земле',
  hint: 'VCC (или «+») — на 5V платы, GND (или «−») — на GND. Перепутаете — модуль сгорит.',
  test: (cx) => {
    const m = cx.partsOf(type)[0];
    if (!m) return { ok: false, detail: `на схеме нет детали «${type}»` };
    const plus = ['VCC', '+', '1', 'M+'].find((p) => cx.toVcc(m.id, p));
    const minus = ['GND', '−', '2', 'M-'].find((p) => cx.toGround(m.id, p));
    return { ok: Boolean(plus && minus), detail: `${plus || '—'} / ${minus || '—'}` };
  },
});

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
        id: 'own-lang', kind: 'code', needsLive: true, text: 'У ESP32 свой скетч, а не копия от Uno',
        test: (cx) => {
          const codes = cx.boards().map((b) => (b.props?.code || '').trim()).filter(Boolean);
          return { ok: codes.length >= 2 && new Set(codes).size === codes.length, detail: `${codes.length} скетча` };
        },
      },
    ],
    solutionExample: 'two-boards',
  },
  // ==========================================================================
  //  Наборы «Эвольвектор»: «Азбука электронщика» и «Основы программирования»
  // ==========================================================================

  {
    id: 'ev-two-leds',
    title: 'Два светодиода мигают по очереди',
    level: 1,
    topic: 'Эвольвектор · Азбука электронщика: выводы',
    minutes: 12,
    brief: 'Первый шаг набора: две лампочки-светодиода по очереди. Соберите две одинаковые цепи на D9 и D10 и заставьте их мигать по очереди — так выглядит «перекрёсток» в проектах набора.',
    goals: [
      'Два светодиода, каждый со своим резистором 220 Ом',
      'Первый — на D9, второй — на D10',
      'В скетче оба вывода объявлены выходами и мигают по очереди',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'two-leds', kind: 'schema', text: 'На схеме два светодиода',
        test: (cx) => ({ ok: cx.count('led') >= 2, detail: `светодиодов: ${cx.count('led')}` }),
      },
      ledOn('D9', 'led-d9'),
      ledOn('D10', 'led-d10'),
      {
        id: 'outputs', kind: 'code', text: 'Оба вывода объявлены выходами',
        hint: 'pinMode(9, OUTPUT) и pinMode(10, OUTPUT) — иначе digitalWrite ничего не даст.',
        test: (cx) => {
          const p = cx.outputPins();
          return { ok: p.has(9) && p.has(10), detail: [...p].join(', ') };
        },
      },
      {
        id: 'alternate', kind: 'behavior', text: 'Оба вывода переключались',
        hint: 'Запустите скетч кнопкой «Старт» — симулятор посчитает переключения выводов.',
        test: (cx) => {
          const a = cx.flips('D9'), b = cx.flips('D10');
          return { ok: a >= 2 && b >= 2, detail: `D9: ${a}, D10: ${b}` };
        },
      },
    ],
    solutionExample: 'two-leds',
  },

  {
    id: 'ev-button-toggle',
    title: 'Кнопка-переключатель: нажал — включил',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: кнопки',
    minutes: 15,
    brief: 'В наборе кнопка часто работает как выключатель: одно нажатие включает светодиод, второе — выключает. Нужна переменная-состояние и защита от дребезга паузой.',
    goals: [
      'Кнопка между D2 и землёй, внутренняя подтяжка',
      'Состояние хранится в переменной и меняется на противоположное',
      'Светодиод на D9 повторяет состояние',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'button', kind: 'schema', text: 'Кнопка подключена к D2 и к земле',
        hint: 'Одна нога кнопки — на D2, вторая — на GND платы.',
        test: (cx) => cx.partsOf('button').some((b) => (cx.attached('D2', b.id, '1') || cx.attached('D2', b.id, '2'))
          && (cx.toGround(b.id, '1') || cx.toGround(b.id, '2'))),
      },
      ledOn('D9'),
      {
        id: 'pullup', kind: 'code', text: 'Включена подтяжка INPUT_PULLUP',
        hint: 'pinMode(2, INPUT_PULLUP) — иначе вывод «висит в воздухе» и ловит помехи.',
        test: (cx) => cx.codeHas(/INPUT_PULLUP/),
      },
      {
        id: 'toggle', kind: 'code', text: 'Состояние переключается на противоположное',
        hint: 'Хитрость: state = !state; — и сразу digitalWrite(9, state).',
        test: (cx) => {
          const ok = cx.codeHas(/!\s*state|1\s*-\s*state|state\s*=\s*!\s*state/) && cx.codeHas(/digitalRead/);
          return { ok, detail: ok ? '' : 'не вижу переключения состояния или digitalRead' };
        },
      },
      {
        id: 'lights', kind: 'behavior', text: 'После запуска светодиод управляется скетчем',
        hint: 'Запустите скетч и понажимайте кнопку на схеме мышью.',
        test: (cx) => ({ ok: cx.ledBrightness() > 0.2 || cx.flips('D9') >= 1, detail: `яркость ${Math.round(cx.ledBrightness() * 100)} %` }),
      },
    ],
    solutionExample: 'button-toggle',
  },

  {
    id: 'ev-fade',
    title: 'Плавное затухание: ШИМ своими руками',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: ШИМ',
    minutes: 15,
    brief: 'analogWrite(9, 0…255) не просто включает и выключает вывод, а «дозирует» яркость. Сделайте «дыхание» светодиода: яркость плавно растёт и падает.',
    goals: [
      'Светодиод с резистором на D9 (вывод с «~» — он умеет ШИМ)',
      'В скетче analogWrite, а не digitalWrite',
      'Скважность плавно меняется, яркость «дышит»',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      ledOn('D9'),
      {
        id: 'pwm', kind: 'code', text: 'Используется analogWrite',
        hint: 'analogWrite(9, level), где level — от 0 до 255.',
        test: (cx) => {
          const args = cx.calls('analogWrite');
          return { ok: args.length > 0, detail: args.length ? `analogWrite(${args[0]})` : 'analogWrite не найден' };
        },
      },
      {
        id: 'levels', kind: 'behavior', text: 'Скважность принимала минимум три разных значения',
        hint: 'Меняйте яркость в цикле: brightness = brightness + step.',
        test: (cx) => {
          const vals = cx.pwms('D9').filter((v) => v > 0 && v < 255);
          return { ok: vals.length >= 3, detail: `значений: ${vals.length}` };
        },
      },
      {
        id: 'breath', kind: 'behavior', text: 'Яркость светодиода менялась',
        test: (cx) => ({ ok: (cx.trace.ledSpread || 0) > 0.1, detail: `разброс яркости ${Math.round((cx.trace.ledSpread || 0) * 100)} %` }),
      },
    ],
    solutionExample: 'fade',
  },

  {
    id: 'ev-ldr-nightlight',
    title: 'Ночник на фоторезисторе',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: датчики',
    minutes: 18,
    brief: 'Фоторезистор и постоянный резистор образуют делитель напряжения. Вечером сопротивление фоторезистора растёт — напряжение на A0 падает, и ночник загорается ярче.',
    goals: [
      'Фоторезистор и резистор 10 кОм — делитель, средняя точка на A0',
      'Скетч читает analogRead(A0)',
      'Яркость светодиода на D9 зависит от освещённости',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'ldr', kind: 'schema', text: 'Фоторезистор подключён к A0',
        test: (cx) => {
          const bp = cx.boardPin('A0');
          const ldr = cx.partsOf('ldr')[0];
          const ok = Boolean(bp && ldr && ['1', '2'].some((p) => cx.netOf(ldr.id, p) === bp.net));
          return { ok, detail: ldr ? 'фоторезистор есть' : 'фоторезистора нет' };
        },
      },
      {
        id: 'divider', kind: 'schema', text: 'Второе плечо делителя — резистор на землю',
        hint: 'Без второго резистора на A0 будет «плавающее» напряжение: 5 В → фоторезистор → A0 и резистор 10 кОм → GND.',
        test: (cx) => {
          const bp = cx.boardPin('A0');
          const ok = Boolean(bp) && cx.partsOf('resistor').some((r) =>
            (cx.netOf(r.id, '1') === bp.net && cx.toGround(r.id, '2'))
            || (cx.netOf(r.id, '2') === bp.net && cx.toGround(r.id, '1')));
          return { ok, detail: ok ? '' : 'резистора между A0 и землёй нет' };
        },
      },
      ledOn('D9'),
      {
        id: 'reads', kind: 'code', text: 'Скетч читает analogRead(A0)',
        test: (cx) => cx.codeHas(/analogRead\s*\(\s*A0\s*\)/),
      },
      {
        id: 'measures', kind: 'behavior', text: 'Симулятор увидел напряжение на A0',
        test: (cx) => {
          const a = cx.analog('A0');
          return { ok: Boolean(a), detail: a ? `от ${a.min} до ${a.max}` : 'A0 не читался' };
        },
      },
    ],
    solutionExample: 'ldr-nightlight',
  },

  {
    id: 'ev-buzzer',
    title: 'Зуммер: пищалка по кнопке',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: звук',
    minutes: 14,
    brief: 'Зуммер в наборе — активный: чтобы он пищал, достаточно подать напряжение. Сделайте охранную пищалку: нажали кнопку — пищит.',
    goals: [
      'Зуммер подключён к D8 (плюс) и к земле (минус)',
      'Кнопка на D2 с подтяжкой',
      'В скетче tone() при нажатии и noTone() когда отпустили',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'buzzer', kind: 'schema', text: 'Зуммер подключён к D8, минус — на землю',
        hint: 'Плюс зуммера — на D8, минус — на GND.',
        test: (cx) => {
          const bz = cx.partsOf('buzzer')[0];
          const ok = Boolean(bz) && (cx.attached('D8', bz.id, '1') || cx.attached('D8', bz.id, '2'))
            && (cx.toGround(bz.id, '1') || cx.toGround(bz.id, '2'));
          return { ok, detail: bz ? '' : 'зуммера нет' };
        },
      },
      {
        id: 'button', kind: 'schema', text: 'Кнопка подключена к D2 и к земле',
        test: (cx) => cx.partsOf('button').some((b) => (cx.attached('D2', b.id, '1') || cx.attached('D2', b.id, '2'))
          && (cx.toGround(b.id, '1') || cx.toGround(b.id, '2'))),
      },
      {
        id: 'tone', kind: 'code', text: 'Скетч включает звук через tone()',
        hint: 'tone(8, 880) — вывод 8, частота 880 Гц. Выключаем noTone(8).',
        test: (cx) => ({ ok: cx.calls('tone').length > 0 && cx.codeHas(/noTone/), detail: cx.calls('tone').join(' | ') }),
      },
      {
        id: 'reads', kind: 'code', text: 'Скетч читает кнопку через digitalRead',
        test: (cx) => cx.calls('digitalRead').length > 0,
      },
    ],
    solutionExample: 'buzzer-button',
  },

  {
    id: 'ev-transistor',
    title: 'Транзистор-ключ: кнопка управляет моторчиком',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: транзистор',
    minutes: 20,
    brief: 'Моторчику нужно 200 мА, а вывод Arduino даёт не больше 40 мА. Между ними работает транзистор: вывод управляет базой, мотор питается от 5 В.',
    goals: [
      'Резистор 1 кОм между D9 и базой транзистора',
      'Эмиттер — на землю, коллектор — на мотор',
      'Мотор между 5 В и коллектором',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'npn', kind: 'schema', text: 'На схеме транзистор NPN',
        test: (cx) => ({ ok: cx.count('npn') >= 1, detail: `транзисторов: ${cx.count('npn')}` }),
      },
      {
        id: 'base', kind: 'schema', text: 'База подключена к D9 через резистор',
        hint: 'Резистор 1 кОм обязательно: без него через базу пойдёт слишком большой ток.',
        test: (cx) => {
          const vt = cx.partsOf('npn')[0];
          const bp = cx.boardPin('D9');
          if (!vt || !bp) return { ok: false, detail: 'нет транзистора или D9' };
          const baseNet = cx.netOf(vt.id, 'B');
          const ok = cx.partsOf('resistor').some((r) =>
            (cx.netOf(r.id, '1') === baseNet && cx.netOf(r.id, '2') === bp.net)
            || (cx.netOf(r.id, '2') === baseNet && cx.netOf(r.id, '1') === bp.net));
          return { ok, detail: ok ? '' : 'резистора между D9 и базой нет' };
        },
      },
      {
        id: 'emitter', kind: 'schema', text: 'Эмиттер транзистора — на земле',
        test: (cx) => {
          const vt = cx.partsOf('npn')[0];
          return Boolean(vt) && cx.toGround(vt.id, 'E');
        },
      },
      {
        id: 'motor', kind: 'schema', text: 'Мотор стоит между питанием и коллектором',
        hint: 'Плюс мотора — на 5V, минус — на коллектор транзистора. Тогда ключ замыкает цепь на землю.',
        test: (cx) => {
          const vt = cx.partsOf('npn')[0];
          const m = cx.partsOf('dcmotor')[0];
          if (!vt || !m) return { ok: false, detail: 'нет мотора или транзистора' };
          const collector = cx.netOf(vt.id, 'C');
          const ok = (cx.toVcc(m.id, 'M+') && cx.netOf(m.id, 'M-') === collector)
            || (cx.toVcc(m.id, 'M-') && cx.netOf(m.id, 'M+') === collector);
          return { ok, detail: ok ? '' : 'мотор не на коллекторе' };
        },
      },
      {
        id: 'output', kind: 'code', text: 'Скетч управляет выводом D9',
        test: (cx) => cx.outputPins().has(9),
      },
    ],
    solutionExample: 'transistor-motor',
  },

  {
    id: 'ev-relay',
    title: 'Реле: слабый вывод управляет сильной нагрузкой',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: реле',
    minutes: 18,
    brief: 'Реле — электромагнитный выключатель. Arduino подаёт 5 мА на катушку, а контакты коммутируют лампу с отдельным питанием. Соберите цепь, где светодиод питается через контакты реле.',
    goals: [
      'Вход реле IN — на D9, питание модуля — 5 В и земля',
      'Лампа (светодиод с резистором) идёт через COM и NO',
      'Скетч щёлкает реле через digitalWrite',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'relay', kind: 'schema', text: 'Реле подключено к D9',
        test: (cx) => {
          const k = cx.partsOf('relay')[0];
          const ok = Boolean(k) && cx.attached('D9', k.id, 'IN');
          return { ok, detail: k ? '' : 'реле нет на схеме' };
        },
      },
      powered('relay', 'relay-power'),
      {
        id: 'contacts', kind: 'schema', text: 'Нагрузка подключена через контакты COM и NO',
        hint: 'Питание → переключатель → резистор → светодиод → COM реле, а NO реле → земля.',
        test: (cx) => {
          const k = cx.partsOf('relay')[0];
          if (!k) return { ok: false, detail: 'реле нет' };
          const com = cx.netOf(k.id, 'COM');
          const no = cx.netOf(k.id, 'NO');
          const attachedTo = (net) => cx.parts.filter((p) => !p.__def?.board
            && PARTS[p.type].pins(p).some((pin) => cx.netOf(p.id, pin.id) === net)).length;
          return { ok: attachedTo(com) > 0 && attachedTo(no) > 0, detail: `COM: ${attachedTo(com)}, NO: ${attachedTo(no)}` };
        },
      },
      {
        id: 'clicks', kind: 'behavior', text: 'Вывод D9 переключался (реле щёлкало)',
        test: (cx) => ({ ok: cx.flips('D9') >= 2, detail: `переключений: ${cx.flips('D9')}` }),
      },
    ],
    solutionExample: 'relay',
  },

  {
    id: 'ev-rgb',
    title: 'RGB-светодиод: три цвета в одном корпусе',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: RGB',
    minutes: 16,
    brief: 'Внутри RGB-светодиода три кристалла и общий катод. Каждому цвету нужен свой резистор, иначе он заберёт весь ток себе и сгорит.',
    goals: [
      'Три резистора 220 Ом — на R, G и B',
      'Красный на D9, зелёный на D10, синий на D11',
      'Общий катод — на землю',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'rgb', kind: 'schema', text: 'На схеме RGB-светодиод',
        test: (cx) => ({ ok: cx.count('rgbled') >= 1, detail: `модулей: ${cx.count('rgbled')}` }),
      },
      {
        id: 'resistors', kind: 'schema', text: 'У каждого цвета свой резистор',
        hint: 'Три резистора: между D9 и R, D10 и G, D11 и B.',
        test: (cx) => {
          const d = cx.partsOf('rgbled')[0];
          if (!d) return { ok: false, detail: 'нет RGB-светодиода' };
          const wired = ['R', 'G', 'B'].filter((ch) => {
            const net = cx.netOf(d.id, ch);
            return cx.partsOf('resistor').some((r) => cx.netOf(r.id, '1') === net || cx.netOf(r.id, '2') === net);
          });
          return { ok: wired.length === 3, detail: `с резистором: ${wired.join(', ') || 'ни одного'}` };
        },
      },
      {
        id: 'common', kind: 'schema', text: 'Общий катод на земле',
        test: (cx) => {
          const d = cx.partsOf('rgbled')[0];
          return Boolean(d) && cx.toGround(d.id, 'K');
        },
      },
      {
        id: 'colors', kind: 'schema', text: 'Цвета подключены к D9, D10 и D11',
        test: (cx) => {
          const d = cx.partsOf('rgbled')[0];
          if (!d) return { ok: false, detail: 'нет RGB-светодиода' };
          const viaResistorTo = (ch, pin) => {
            const bp = cx.boardPin(pin);
            if (!bp) return false;
            const net = cx.netOf(d.id, ch);
            return cx.partsOf('resistor').some((r) =>
              ((cx.netOf(r.id, '1') === net) && cx.netOf(r.id, '2') === bp.net)
              || ((cx.netOf(r.id, '2') === net) && cx.netOf(r.id, '1') === bp.net));
          };
          const ok = viaResistorTo('R', 'D9') && viaResistorTo('G', 'D10') && viaResistorTo('B', 'D11');
          return { ok, detail: ok ? '' : 'цвета подключены не к тем выводам' };
        },
      },
      {
        id: 'outputs', kind: 'code', text: 'Скетч управляет тремя выводами',
        test: (cx) => {
          const p = cx.outputPins();
          const need = [9, 10, 11].filter((n) => p.has(n));
          return { ok: need.length === 3, detail: need.join(', ') };
        },
      },
    ],
    solutionExample: 'rgb',
  },

  {
    id: 'ev-seg7',
    title: 'Семисегментный индикатор: цифры',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: индикатор',
    minutes: 20,
    brief: 'Семь светодиодов в одном корпусе умеют показать любую цифру. Каждый сегмент — через свой резистор, общий вывод — на землю.',
    goals: [
      'Семь резисторов 220 Ом — по одному на сегмент',
      'Сегменты A…G — на D2…D8',
      'Общий вывод COM — на землю',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'seg7', kind: 'schema', text: 'На схеме индикатор 7 сегментов',
        test: (cx) => ({ ok: cx.count('seg7') >= 1, detail: `индикаторов: ${cx.count('seg7')}` }),
      },
      {
        id: 'com', kind: 'schema', text: 'Общий вывод подключён к земле',
        test: (cx) => {
          const hg = cx.partsOf('seg7')[0];
          return Boolean(hg) && cx.toGround(hg.id, 'COM');
        },
      },
      {
        id: 'seven', kind: 'schema', text: 'Все семь сегментов подключены через резисторы',
        hint: 'Семь резисторов — по одному на каждый сегмент, иначе индикатор сгорит.',
        test: (cx) => {
          const hg = cx.partsOf('seg7')[0];
          if (!hg) return { ok: false, detail: 'нет индикатора' };
          const wired = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].filter((s) => {
            const net = cx.netOf(hg.id, s);
            return cx.partsOf('resistor').some((r) => cx.netOf(r.id, '1') === net || cx.netOf(r.id, '2') === net);
          });
          return { ok: wired.length === 7, detail: `сегментов с резистором: ${wired.length}` };
        },
      },
      {
        id: 'shows', kind: 'behavior', text: 'Сегменты переключались',
        test: (cx) => {
          const total = ['D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'].reduce((n, p) => n + cx.flips(p), 0);
          return { ok: total >= 6, detail: `переключений: ${total}` };
        },
      },
    ],
    solutionExample: 'seg7',
  },

  {
    id: 'ev-servo-pot',
    title: 'Серво по потенциометру',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: сервопривод',
    minutes: 16,
    brief: 'Потенциометр задаёт угол, сервопривод его отрабатывает: analogRead даёт 0…1023, а серво понимает 0…180°. Связывает их map().',
    goals: [
      'Средняя ножка потенциометра — на A0',
      'PWM сервопривода — на D9, питание — 5 В и земля',
      'В скетче библиотека Servo и map(raw, 0, 1023, 0, 180)',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'pot', kind: 'schema', text: 'Потенциометр подключён к A0',
        test: (cx) => {
          const rv = cx.partsOf('pot')[0];
          return Boolean(rv) && cx.attached('A0', rv.id, 'W');
        },
      },
      {
        id: 'pot-power', kind: 'schema', text: 'Крайние ножки потенциометра — на 5 В и на землю',
        test: (cx) => {
          const rv = cx.partsOf('pot')[0];
          if (!rv) return { ok: false, detail: 'нет потенциометра' };
          const ok = (cx.toVcc(rv.id, 'A') && cx.toGround(rv.id, 'B'))
            || (cx.toVcc(rv.id, 'B') && cx.toGround(rv.id, 'A'));
          return { ok, detail: ok ? '' : 'крайние ножки не на питании и земле' };
        },
      },
      {
        id: 'servo', kind: 'schema', text: 'Сервопривод подключён к D9',
        test: (cx) => {
          const srv = cx.partsOf('servo')[0];
          return Boolean(srv) && cx.attached('D9', srv.id, 'PWM');
        },
      },
      powered('servo', 'servo-power'),
      {
        id: 'code', kind: 'code', text: 'Скетч использует Servo, analogRead и map',
        hint: 'srv.attach(9); int angle = map(analogRead(A0), 0, 1023, 0, 180); srv.write(angle);',
        test: (cx) => {
          const ok = /Servo/.test(cx.code) && cx.codeHas(/map\s*\(/) && cx.codeHas(/analogRead/);
          return { ok, detail: ok ? '' : 'нужны Servo, analogRead и map' };
        },
      },
      {
        id: 'moves', kind: 'behavior', text: 'Угол сервопривода задавался',
        test: (cx) => {
          const s = Object.keys(cx.trace.servos || {});
          return { ok: s.length > 0, detail: s.length ? `серво: ${s.join(', ')}` : 'угол не задавался' };
        },
      },
    ],
    solutionExample: 'servo-pot',
  },

  {
    id: 'ev-stepper',
    title: 'Шаговый двигатель 28BYJ-48',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: шаговик',
    minutes: 20,
    brief: 'Шаговик крутится строго на заданный угол: у 28BYJ-48 с драйвером ULN2003 — 2048 шагов на оборот. Четыре управляющих входа идут на D8…D11.',
    goals: [
      'IN1…IN4 — на D8, D9, D10, D11',
      'Питание модуля — 5 В и земля',
      'В скетче библиотека Stepper и оборот туда-обратно',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'motor', kind: 'schema', text: 'Шаговый двигатель на схеме',
        test: (cx) => ({ ok: cx.count('stepper28byj') >= 1, detail: `двигателей: ${cx.count('stepper28byj')}` }),
      },
      {
        id: 'wires', kind: 'schema', text: 'IN1…IN4 подключены к D8…D11',
        test: (cx) => {
          const m = cx.partsOf('stepper28byj')[0];
          if (!m) return { ok: false, detail: 'нет двигателя' };
          const mapIn = [['IN1', 'D8'], ['IN2', 'D9'], ['IN3', 'D10'], ['IN4', 'D11']];
          const ok = mapIn.every(([pin, out]) => cx.attached(out, m.id, pin));
          return { ok, detail: mapIn.map(([pin, out]) => `${pin}→${out}`).join(' ') };
        },
      },
      powered('stepper28byj', 'motor-power'),
      {
        id: 'code', kind: 'code', text: 'Скетч использует библиотеку Stepper',
        hint: 'Stepper motor(2048, 8, 9, 10, 11); motor.setSpeed(10); motor.step(2048);',
        test: (cx) => ({ ok: cx.codeHas(/Stepper/) && cx.codeHas(/\.step\s*\(/), detail: cx.codeHas(/Stepper/) ? '' : 'нет Stepper' }),
      },
      {
        id: 'steps', kind: 'behavior', text: 'Фазы двигателя переключались',
        test: (cx) => {
          const total = ['D8', 'D9', 'D10', 'D11'].reduce((n, p) => n + cx.flips(p), 0);
          return { ok: total >= 4, detail: `переключений: ${total}` };
        },
      },
    ],
    solutionExample: 'stepper',
  },

  {
    id: 'ev-keypad',
    title: 'Клавиатура 4×4: кодовый замок',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: клавиатура',
    minutes: 22,
    brief: 'Клавиатура 4×4 занимает 8 выводов: четыре строки и четыре столбца. Библиотека Keypad сканирует матрицу и отдаёт символ нажатой клавиши — из них и собирают кодовый замок.',
    goals: [
      'Строки R1…R4 — на D2…D5, столбцы C1…C4 — на D6, D7, D10, D11',
      'В скетче объект Keypad и опрос getKey()',
      'Нажатая цифра видна в мониторе порта',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'keypad', kind: 'schema', text: 'Клавиатура на схеме',
        test: (cx) => ({ ok: cx.count('keypad') >= 1, detail: `клавиатур: ${cx.count('keypad')}` }),
      },
      {
        id: 'wiring', kind: 'schema', text: 'Восемь выводов клавиатуры подключены к плате',
        hint: 'R1…R4 → D2…D5, C1…C4 → D6, D7, D10, D11.',
        test: (cx) => {
          const kp = cx.partsOf('keypad')[0];
          if (!kp) return { ok: false, detail: 'нет клавиатуры' };
          const pins = ['R1', 'R2', 'R3', 'R4', 'C1', 'C2', 'C3', 'C4'];
          const onBoard = pins.filter((pin) => {
            const net = cx.netOf(kp.id, pin);
            return cx.boards().some((b) => PARTS[b.type].pins(b).some((q) => typeof q.num === 'number'
              && cx.netOf(b.id, q.id) === net));
          });
          return { ok: onBoard.length === 8, detail: `подключено: ${onBoard.length} из 8` };
        },
      },
      {
        id: 'code', kind: 'code', text: 'Скетч опрашивает клавиатуру',
        hint: 'Можно библиотекой Keypad (getKey()) или самому: строки по очереди на землю, столбцы читаем digitalRead.',
        test: (cx) => {
          const library = cx.codeHas(/Keypad/) && cx.codeHas(/getKey/);
          const manual = cx.codeHas(/digitalRead/) && cx.codeHas(/digitalWrite/) && cx.codeHas(/Serial\.(print|println)/);
          return { ok: library || manual, detail: library ? 'библиотека Keypad' : manual ? 'своё сканирование матрицы' : 'опрос клавиатуры не найден' };
        },
      },
    ],
    solutionExample: 'keypad',
  },

  {
    id: 'ev-joystick',
    title: 'Джойстик: два напряжения и кнопка',
    level: 2,
    topic: 'Эвольвектор · Азбука электронщика: джойстик',
    minutes: 16,
    brief: 'Модуль джойстика — это два потенциометра и кнопка. Наклон по X и Y читаем через A0 и A1, нажатие рукоятки — через D2.',
    goals: [
      'VRx — на A0, VRy — на A1',
      'Кнопка SW — на D2 с подтяжкой',
      'Скетч печатает координаты в монитор порта',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'axes', kind: 'schema', text: 'Оси джойстика подключены к A0 и A1',
        test: (cx) => {
          const js = cx.partsOf('joystick')[0];
          return Boolean(js) && cx.attached('A0', js.id, 'VRx') && cx.attached('A1', js.id, 'VRy');
        },
      },
      {
        id: 'button', kind: 'schema', text: 'Кнопка джойстика подключена к D2',
        test: (cx) => {
          const js = cx.partsOf('joystick')[0];
          return Boolean(js) && cx.attached('D2', js.id, 'SW');
        },
      },
      powered('joystick', 'joystick-power'),
      {
        id: 'code', kind: 'code', text: 'Скетч читает обе оси и печатает их',
        test: (cx) => {
          const a0 = cx.codeHas(/analogRead\s*\(\s*A0\s*\)/);
          const a1 = cx.codeHas(/analogRead\s*\(\s*A1\s*\)/);
          return { ok: a0 && a1 && cx.codeHas(/Serial\.(print|println)/), detail: `A0: ${a0}, A1: ${a1}` };
        },
      },
      {
        id: 'reads', kind: 'behavior', text: 'Оба входа читались',
        test: (cx) => ({ ok: Boolean(cx.analog('A0') && cx.analog('A1')), detail: 'напряжения на A0/A1' }),
      },
    ],
    solutionExample: 'joystick',
  },

  {
    id: 'ev-motor',
    title: 'Драйвер L298N: мотор вперёд и назад',
    level: 3,
    topic: 'Эвольвектор · Азбука электронщика: мотор',
    minutes: 20,
    brief: 'Драйвер L298N — это два H-моста. Два вывода задают направление, третий (ENA) — скорость через ШИМ. Соберите реверс мотора.',
    goals: [
      'IN1 → D9, IN2 → D8, ENA → 5 В (или ШИМ)',
      'Выходы драйвера OUT1/OUT2 — на мотор',
      'Скетч умеет крутить вперёд, назад и останавливать',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'driver', kind: 'schema', text: 'Драйвер L298N на схеме',
        test: (cx) => ({ ok: cx.count('l298n') >= 1, detail: `драйверов: ${cx.count('l298n')}` }),
      },
      {
        id: 'control', kind: 'schema', text: 'IN1 и IN2 подключены к D9 и D8',
        test: (cx) => {
          const d = cx.partsOf('l298n')[0];
          return Boolean(d) && cx.attached('D9', d.id, 'IN1') && cx.attached('D8', d.id, 'IN2');
        },
      },
      {
        id: 'motor', kind: 'schema', text: 'Мотор подключён к выходам драйвера',
        test: (cx) => {
          const d = cx.partsOf('l298n')[0];
          const m = cx.partsOf('dcmotor')[0];
          if (!d || !m) return { ok: false, detail: 'нет мотора или драйвера' };
          const o1 = cx.netOf(d.id, 'OUT1'), o2 = cx.netOf(d.id, 'OUT2');
          const ok = (cx.netOf(m.id, 'M+') === o1 && cx.netOf(m.id, 'M-') === o2)
            || (cx.netOf(m.id, 'M+') === o2 && cx.netOf(m.id, 'M-') === o1);
          return { ok, detail: ok ? '' : 'мотор не на OUT1/OUT2' };
        },
      },
      powered('l298n', 'driver-power'),
      {
        id: 'code', kind: 'code', text: 'Скетч задаёт направление двумя выводами',
        test: (cx) => {
          const p = cx.outputPins();
          return { ok: p.has(8) && p.has(9), detail: [...p].join(', ') };
        },
      },
    ],
    solutionExample: 'motor',
  },

  {
    id: 'ev-for',
    title: 'Цикл for: бегущий огонь',
    level: 2,
    topic: 'Эвольвектор · Основы программирования: циклы',
    minutes: 15,
    brief: 'Цикл for избавляет от копирования строк. Соберите три светодиода и массив их выводов, а огонь пусть «бежит» циклом.',
    goals: [
      'Три светодиода с резисторами на D9, D10, D11',
      'Выводы собраны в массив',
      'В скетче цикл for по этому массиву',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'three', kind: 'schema', text: 'Три светодиода с резисторами',
        test: (cx) => ({ ok: cx.count('led') >= 3 && cx.count('resistor') >= 3, detail: `светодиодов: ${cx.count('led')}` }),
      },
      ledOn('D9', 'led-d9'),
      ledOn('D10', 'led-d10'),
      ledOn('D11', 'led-d11'),
      {
        id: 'for', kind: 'code', text: 'В скетче есть цикл for и массив выводов',
        hint: 'const int PINS[] = {9, 10, 11}; for (int i = 0; i < 3; i++) { … PINS[i] … }',
        test: (cx) => {
          const arr = cx.codeHas(/\[\s*\]\s*=\s*\{/) || cx.codeHas(/\{\s*\d+\s*,\s*\d+/);
          return { ok: cx.codeHas(/for\s*\(/) && arr, detail: `for: ${cx.codeHas(/for\s*\(/)}, массив: ${arr}` };
        },
      },
      {
        id: 'runs', kind: 'behavior', text: 'Все три вывода переключались',
        test: (cx) => {
          const list = ['D9', 'D10', 'D11'].map((p) => cx.flips(p));
          return { ok: list.every((n) => n >= 2), detail: list.join(', ') };
        },
      },
    ],
    solutionExample: 'for-loop',
  },

  {
    id: 'ev-array',
    title: 'Массив и биты: узор на светодиодах',
    level: 3,
    topic: 'Эвольвектор · Основы программирования: массивы',
    minutes: 18,
    brief: 'Узор удобно хранить числом: каждый бит — свой светодиод. Массив чисел задаёт последовательность картинок, а цикл их показывает.',
    goals: [
      'Три светодиода на D9, D10, D11',
      'Массив узоров (например, 0b001, 0b010, 0b100, 0b111)',
      'Все три светодиода по очереди загораются',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'three', kind: 'schema', text: 'Три светодиода с резисторами',
        test: (cx) => ({ ok: cx.count('led') >= 3 && cx.count('resistor') >= 3, detail: `светодиодов: ${cx.count('led')}` }),
      },
      {
        id: 'array', kind: 'code', text: 'В скетче массив и цикл по нему',
        test: (cx) => ({ ok: cx.codeHas(/\[\s*\]/) && cx.codeHas(/for\s*\(/), detail: '' }),
      },
      {
        id: 'bits', kind: 'code', text: 'Состояние светодиода берётся из бита',
        hint: 'digitalWrite(PINS[i], (PATTERN[s] >> i) & 1);',
        test: (cx) => ({ ok: cx.codeHas(/>>|bitRead|&\s*1/), detail: '' }),
      },
      {
        id: 'all-lit', kind: 'behavior', text: 'Каждый светодиод загорался',
        test: (cx) => {
          const leds = cx.partsOf('led').map((l) => cx.ledBrightness(l.id));
          return { ok: leds.length >= 3 && leds.filter((b) => b > 0.2).length >= 3, detail: leds.map((b) => Math.round(b * 100) + '%').join(', ') };
        },
      },
    ],
    solutionExample: 'array-pattern',
  },

  {
    id: 'ev-functions',
    title: 'Своя функция: blinkPin()',
    level: 2,
    topic: 'Эвольвектор · Основы программирования: функции',
    minutes: 14,
    brief: 'Повторяющийся код прячут в функцию с параметрами. Напишите blinkPin(вывод, пауза) и мигайте двумя светодиодами в разном ритме.',
    goals: [
      'Два светодиода на D9 и D10',
      'Своя функция с параметрами (кроме setup и loop)',
      'Функция вызывается для обоих выводов',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'two', kind: 'schema', text: 'Два светодиода с резисторами',
        test: (cx) => ({ ok: cx.count('led') >= 2, detail: `светодиодов: ${cx.count('led')}` }),
      },
      {
        id: 'own-fn', kind: 'code', text: 'В скетче есть своя функция (кроме setup и loop)',
        hint: 'void blinkPin(int pin, int ms) { … } — и потом blinkPin(9, 100);',
        test: (cx) => {
          const m = /void\s+(?!setup\b|loop\b)([A-Za-z_]\w*)\s*\(/g;
          const names = [...cx.code.matchAll(m)].map((x) => x[1]);
          const called = names.filter((n) => new RegExp(`\\b${n}\\s*\\(`).test(cx.code.slice(cx.code.indexOf(n + '(') + 1)) || cx.calls(n).length > 1);
          return { ok: names.length > 0 && called.length > 0, detail: names.join(', ') || 'своей функции нет' };
        },
      },
      {
        id: 'lights', kind: 'behavior', text: 'Оба светодиода загорались',
        test: (cx) => {
          const leds = cx.partsOf('led').map((l) => cx.ledBrightness(l.id));
          return { ok: leds.filter((b) => b > 0.2).length >= 2, detail: leds.map((b) => Math.round(b * 100) + '%').join(', ') };
        },
      },
    ],
    solutionExample: 'functions',
  },

  {
    id: 'ev-switch',
    title: 'switch/case: команды из монитора порта',
    level: 3,
    topic: 'Эвольвектор · Основы программирования: ветвления',
    minutes: 20,
    brief: 'Управление с компьютера: в монитор порта пишем букву — плата меняет цвет RGB-светодиода. Разбор команд делают через switch/case.',
    goals: [
      'RGB-светодиод с тремя резисторами на D9…D11',
      'В скетче switch с несколькими case',
      'Скетч читает Serial и понимает команды r, g, b',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'rgb', kind: 'schema', text: 'RGB-светодиод на схеме',
        test: (cx) => ({ ok: cx.count('rgbled') >= 1, detail: `модулей: ${cx.count('rgbled')}` }),
      },
      {
        id: 'switch', kind: 'code', text: 'В скетче switch с несколькими case',
        hint: 'switch (c) { case \'r\': … break; case \'g\': … break; }',
        test: (cx) => {
          const cases = (cx.code.match(/case\s+/g) || []).length;
          return { ok: cx.codeHas(/switch\s*\(/) && cases >= 2, detail: `case: ${cases}` };
        },
      },
      {
        id: 'read', kind: 'code', text: 'Скетч читает символ из Serial',
        test: (cx) => ({ ok: cx.codeHas(/Serial\.read/) && cx.codeHas(/Serial\.available/), detail: '' }),
      },
      {
        id: 'prompt', kind: 'behavior', text: 'Плата напечатала подсказку о командах',
        test: (cx) => ({ ok: /r\/g\/b|команд/i.test(cx.serialText()), detail: cx.serialText().slice(0, 60) }),
      },
    ],
    solutionExample: 'switch-menu',
  },

  {
    id: 'ev-serial-echo',
    title: 'Serial: эхо — плата повторяет введённое',
    level: 2,
    topic: 'Эвольвектор · Основы программирования: Serial',
    minutes: 14,
    brief: 'Обмен с компьютером — основа всех проектов с датчиками. Сделайте эхо: что ввели в монитор порта, то плата и напечатает обратно.',
    goals: [
      'Скетч читает строку из Serial',
      'Каждая введённая строка возвращается с приставкой «эхо:»',
      'Для проверки напишите что-нибудь в монитор порта и нажмите Enter',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'reads', kind: 'code', text: 'Скетч читает данные из Serial',
        hint: 'Serial.available() и Serial.readStringUntil(\'\\n\') — так удобнее, чем по байту.',
        test: (cx) => ({ ok: cx.codeHas(/readStringUntil|Serial\.read/) && cx.codeHas(/Serial\.available/), detail: '' }),
      },
      {
        id: 'prints', kind: 'code', text: 'Скетч печатает ответ',
        test: (cx) => cx.codeHas(/Serial\.(print|println)/),
      },
      {
        id: 'prompt', kind: 'behavior', text: 'В мониторе есть приглашение написать строку',
        test: (cx) => ({ ok: /напишите|введите|повтор/i.test(cx.serialText()), detail: cx.serialText().slice(0, 60) }),
      },
      {
        id: 'echo', kind: 'behavior', text: 'Плата ответила на введённую строку',
        hint: 'Напишите в поле под монитором любое слово и нажмите Enter — плата должна ответить.',
        test: (cx) => ({ ok: /эхо/i.test(cx.serialText()), detail: 'ответа «эхо: …» пока нет' }),
      },
    ],
    solutionExample: 'serial-echo',
  },

  {
    id: 'ev-string',
    title: 'String: разбор команды «LED 9 1»',
    level: 3,
    topic: 'Эвольвектор · Основы программирования: строки',
    minutes: 22,
    brief: 'Команда из трёх частей — имя, номер вывода, уровень — учит разбирать строку: indexOf находит пробелы, substring вырезает куски, toInt превращает их в числа.',
    goals: [
      'Скетч принимает команду «LED <вывод> <0|1>»',
      'Для разбора используются indexOf, substring и toInt',
      'Команда включает и выключает светодиод',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'leds', kind: 'schema', text: 'Два светодиода с резисторами на D9 и D10',
        test: (cx) => ({ ok: cx.count('led') >= 2, detail: `светодиодов: ${cx.count('led')}` }),
      },
      {
        id: 'parse', kind: 'code', text: 'Строка разбирается через indexOf и substring',
        hint: 'int p1 = cmd.indexOf(\' \'); String what = cmd.substring(0, p1);',
        test: (cx) => {
          const ok = cx.codeHas(/indexOf/) && cx.codeHas(/substring/) && cx.codeHas(/toInt/);
          return { ok, detail: `indexOf: ${cx.codeHas(/indexOf/)}, substring: ${cx.codeHas(/substring/)}, toInt: ${cx.codeHas(/toInt/)}` };
        },
      },
      {
        id: 'wait', kind: 'code', text: 'Скетч ждёт строку целиком',
        test: (cx) => cx.codeHas(/readStringUntil|readString\s*\(/),
      },
      {
        id: 'prompt', kind: 'behavior', text: 'Плата напечатала формат команды',
        test: (cx) => ({ ok: /формат|LED\s+\d/i.test(cx.serialText()), detail: cx.serialText().slice(0, 60) }),
      },
    ],
    solutionExample: 'string-cmd',
  },

  {
    id: 'ev-random',
    title: 'Случайные числа: электронный кубик',
    level: 3,
    topic: 'Эвольвектор · Основы программирования: random',
    minutes: 20,
    brief: 'random(1, 7) даёт число от 1 до 6. Покажем его на семисегментном индикаторе: каждой цифре — своя маска сегментов, а биты маски разложим циклом.',
    goals: [
      'Индикатор подключён через семь резисторов',
      'В скетче random() и таблица цифр',
      'Цифра показывается и печатается в монитор',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      {
        id: 'seg7', kind: 'schema', text: 'Семисегментный индикатор подключён через резисторы',
        test: (cx) => {
          const hg = cx.partsOf('seg7')[0];
          return Boolean(hg) && cx.count('resistor') >= 7 && cx.toGround(hg.id, 'COM');
        },
      },
      {
        id: 'random', kind: 'code', text: 'В скетче random()',
        hint: 'int d = random(1, 7); — и randomSeed(analogRead(A0)) в setup.',
        test: (cx) => ({ ok: cx.calls('random').length > 0, detail: cx.calls('random').join(' | ') }),
      },
      {
        id: 'table', kind: 'code', text: 'Цифры хранятся в массиве масок',
        test: (cx) => ({ ok: cx.codeHas(/0b\d+|0x[0-9a-fA-F]+/) && cx.codeHas(/\[\s*\]/), detail: '' }),
      },
      {
        id: 'printed', kind: 'behavior', text: 'Кубик «бросался» — результат в мониторе порта',
        test: (cx) => ({ ok: /выпало|кубик/i.test(cx.serialText()), detail: cx.serialText().slice(-40) }),
      },
    ],
    solutionExample: 'random-dice',
  },

  {
    id: 'ev-millis',
    title: 'millis() вместо delay: мигаем без остановки',
    level: 3,
    topic: 'Эвольвектор · Основы программирования: время',
    minutes: 18,
    brief: 'delay() останавливает программу целиком. С millis() можно мигать светодиодом и одновременно опрашивать кнопку — так строят все «многозадачные» скетчи.',
    goals: [
      'Светодиод с резистором на D9',
      'Время считается через millis(), без delay()',
      'Светодиод мигает, а loop не «залипает»',
    ],
    start: { parts: [board()], wires: [], code: SKELETON_CPP },
    checks: [
      ledOn('D9'),
      {
        id: 'millis', kind: 'code', text: 'В скетче используется millis()',
        hint: 'unsigned long now = millis(); if (now - previous >= 500) { previous = now; … }',
        test: (cx) => ({ ok: cx.codeHas(/millis\s*\(\s*\)/), detail: '' }),
      },
      {
        id: 'no-delay', kind: 'code', text: 'В скетче нет delay()',
        hint: 'Именно в этом смысл задания: пауза делается сравнением времени, а не delay().',
        test: (cx) => {
          const body = noComments(cx.code);
          return { ok: !/delay\s*\(/.test(body), detail: /delay\s*\(/.test(body) ? 'delay() всё ещё есть' : '' };
        },
      },
      {
        id: 'blinks', kind: 'behavior', text: 'Светодиод мигал',
        test: (cx) => ({ ok: cx.flips('D9') >= 2, detail: `переключений: ${cx.flips('D9')}` }),
      },
    ],
    solutionExample: 'millis-blink',
  },

  {
    id: 'usb-link',
    title: 'Arduino и Raspberry Pi 5 по USB',
    level: 3,
    topic: 'Эвольвектор · USB: две платы вместе',
    minutes: 25,
    brief: 'Настоящий проект часто собирают из двух плат: Arduino меряет и управляет, Raspberry Pi 5 считает и показывает. Соедините их USB-кабелем: Serial одной платы виден другой как /dev/ttyACM0.',
    goals: [
      'На схеме Arduino Uno и Raspberry Pi 5',
      'USB-кабель соединяет разъёмы USB обеих плат',
      'Скетч Arduino печатает данные, а Pi их читает и печатает',
    ],
    start: {
      parts: [board('uno', 10, -160, 'b1'), board('rpi5', 10, 200, 'b2')],
      wires: [],
      code: SKELETON_CPP,
    },
    checks: [
      {
        id: 'boards', kind: 'schema', text: 'На схеме Uno и Raspberry Pi 5',
        test: (cx) => {
          const types = cx.boards().map((b) => b.type);
          return { ok: types.includes('uno') && types.includes('rpi5'), detail: types.join(', ') };
        },
      },
      {
        id: 'cable', kind: 'schema', text: 'USB-кабель соединяет разъёмы двух плат',
        hint: 'Поставьте деталь «USB-кабель» (раздел «Связь») и проведите провода от разъёма USB одной платы к концу A, от разъёма USB второй — к концу B.',
        test: (cx) => {
          const cable = cx.partsOf('usbcable')[0];
          if (!cable) return { ok: false, detail: 'USB-кабеля нет на схеме' };
          const boardOn = (pin) => {
            const net = cx.netOf(cable.id, pin);
            return cx.boards().filter((b) => cx.netOf(b.id, 'USB') === net).map((b) => b.type);
          };
          const a = boardOn('A'), b = boardOn('B');
          return { ok: a.length === 1 && b.length === 1 && a[0] !== b[0], detail: `A: ${a.join('') || '—'}, B: ${b.join('') || '—'}` };
        },
      },
      {
        id: 'sends', kind: 'code', text: 'Скетч Arduino отправляет данные в Serial',
        test: (cx) => ({ ok: cx.codeHas(/Serial\.(print|println|write)/), detail: '' }),
      },
      {
        id: 'receives', kind: 'behavior', text: 'Raspberry Pi 5 получила данные от Arduino',
        hint: 'В скетче Pi нужен порт: import serial; port = serial.Serial(\'/dev/ttyACM0\', 9600); line = port.readline()',
        test: (cx) => ({ ok: /от Arduino|ttyACM0|получен/i.test(cx.serialText()), detail: cx.serialText().slice(-80) }),
      },
    ],
    solutionExample: 'usb-uno-pi',
  },

];

/** Задание по id. */
export const taskById = (id) => TASKS.find((t) => t.id === id) || null;

/** Готовое решение задания — пример из examples.js (или собственный слепок). */
export function solutionOf(task) {
  if (!task?.solutionExample) return null;
  return EXAMPLES.find((e) => e.id === task.solutionExample) || null;
}
