/**
 * examples.js — готовые примеры: скетч + схема (+ какие каналы включить
 * на осциллографе). Координаты подобраны так, чтобы провода не лезли
 * сквозь плату без нужды: цифровые выводы сверху, питание — с двух сторон.
 */

const board = (type = 'uno', x = 0, y = 0, id = 'b1') => ({ id, type, x, y, props: {} });
const wire = (ac, ap, bc, bp) => ({ a: { compId: ac, pin: ap }, b: { compId: bc, pin: bp } });

export const EXAMPLES = [
  {
    id: 'blink',
    name: 'Blink — встроенный светодиод D13',
    autorun: true,
    schematic: { parts: [board()], wires: [] },
    code: `// Мигаем встроенным светодиодом на D13 — подключать ничего не нужно.
// Следите за платой: рядом с выводом 13 загорится "L".

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("Blink: поехали!");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`,
  },

  {
    id: 'led',
    name: 'Светодиод + резистор на D9',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'l1', type: 'led', x: 0, y: -190, props: { color: '#ff5544' } },
        { id: 'r1', type: 'resistor', x: 110, y: -190, props: { value: 220 } },
      ],
      wires: [wire('b1', 'D9', 'l1', 'A'), wire('l1', 'K', 'r1', '1'), wire('r1', '2', 'b1', 'GND2')],
    },
    code: `// Светодиод на D9 через резистор 220 Ом.

const int LED = 9;

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Три коротких, один длинный");
}

void loop() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED, HIGH);
    delay(250);
    digitalWrite(LED, LOW);
    delay(250);
  }
  digitalWrite(LED, HIGH);
  delay(1200);
  digitalWrite(LED, LOW);
  delay(1200);
}
`,
  },

  {
    id: 'button',
    name: 'Кнопка с подтяжкой → светодиод',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'sw1', type: 'button', x: -40, y: -160, props: {} },
        { id: 'l1', type: 'led', x: 150, y: -190, props: { color: '#7ef29d' } },
        { id: 'r1', type: 'resistor', x: 250, y: -190, props: { value: 220 } },
      ],
      wires: [
        wire('b1', 'D2', 'sw1', '1'), wire('sw1', '2', 'b1', 'GND2'),
        wire('b1', 'D9', 'l1', 'A'), wire('l1', 'K', 'r1', '1'), wire('r1', '2', 'b1', 'GND2'),
      ],
    },
    code: `// Кнопка между D2 и землёй, внутри включена подтяжка к 5 В.
// Нажмите кнопку мышью — светодиод на D9 загорится.

const int BUTTON = 2;
const int LED = 9;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Нажмите кнопку на схеме");
}

void loop() {
  bool pressed = digitalRead(BUTTON) == LOW;
  digitalWrite(LED, pressed ? HIGH : LOW);
  if (pressed) {
    Serial.println("нажата");
    delay(200);
  }
  delay(50);
}
`,
  },

  {
    id: 'pot',
    name: 'Потенциометр → яркость (ШИМ)',
    autorun: true,
    scope: ['A0', 'D9'],
    timeDiv: 0.005,
    schematic: {
      parts: [
        board(),
        { id: 'rv1', type: 'pot', x: -60, y: -170, props: { value: 0.5, ohms: 10000 } },
        { id: 'l1', type: 'led', x: 120, y: -200, props: { color: '#ffd166' } },
        { id: 'r1', type: 'resistor', x: 220, y: -200, props: { value: 220 } },
      ],
      wires: [
        wire('b1', '5V2', 'rv1', 'A'), wire('b1', 'GND2', 'rv1', 'B'), wire('rv1', 'W', 'b1', 'A0'),
        wire('b1', 'D9', 'l1', 'A'), wire('l1', 'K', 'r1', '1'), wire('r1', '2', 'b1', 'GND2'),
      ],
    },
    code: `// Крутите ручку потенциометра — меняется яркость светодиода.
// Включите осциллограф (кнопка в шапке схемы) и поставьте развёртку 2 мс/дел:
// на D9 видно настоящий ШИМ.

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(A0);
  int level = map(value, 0, 1023, 0, 255);
  analogWrite(9, level);

  Serial.print("A0 = ");
  Serial.print(value);
  Serial.print("  ->  ШИМ ");
  Serial.println(level);

  delay(300);
}
`,
  },

  {
    id: 'rc',
    name: 'RC-цепь: заряд конденсатора (осциллограф)',
    autorun: true,
    scope: ['A0'],
    timeDiv: 0.5,
    schematic: {
      parts: [
        board(),
        { id: 'r1', type: 'resistor', x: 24, y: -150, props: { value: 10000 } },
        { id: 'c1', type: 'electrolytic', x: 140, y: -150, props: { farads: 0.0001 } },
      ],
      wires: [
        wire('b1', 'D9', 'r1', '1'),
        wire('r1', '2', 'c1', '1'),
        wire('c1', '1', 'b1', 'A0'),
        wire('c1', '2', 'b1', 'GND2'),
      ],
    },
    code: `// Классика: R = 10 кОм, C = 100 мкФ. Постоянная времени τ = R·C = 1 с.
// D9 заряжает конденсатор 3 секунды, потом разряжает. Смотрите осциллограф
// на канале A0: кривая заряда — это и есть экспонента.

void setup() {
  pinMode(9, OUTPUT);
  pinMode(A0, INPUT);
  Serial.begin(9600);
  Serial.println("Заряд/разряд RC-цепи");
}

void loop() {
  digitalWrite(9, HIGH);
  Serial.print("заряд, напряжение: ");
  delay(1000);
  Serial.println(analogRead(A0));

  delay(2000);

  digitalWrite(9, LOW);
  Serial.print("разряд, напряжение: ");
  delay(1000);
  Serial.println(analogRead(A0));

  delay(2000);
}
`,
  },

  {
    id: 'servo',
    name: 'Сервопривод: библиотека Servo',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'srv', type: 'servo', x: 170, y: -190, props: { angle: 90 } },
      ],
      wires: [
        wire('b1', 'D9', 'srv', 'PWM'),
        wire('b1', '5V2', 'srv', 'VCC'),
        wire('b1', 'GND2', 'srv', 'GND'),
      ],
    },
    code: `// Подключение библиотеки по имени работает как в Arduino IDE.
// Вал сервопривода на схеме будет поворачиваться.

#include <Servo.h>

Servo myservo;

void setup() {
  myservo.attach(9);
  Serial.begin(9600);
  Serial.println("Серво: 0 → 180 → 0");
}

void loop() {
  for (int angle = 0; angle <= 180; angle += 10) {
    myservo.write(angle);
    delay(80);
  }
  for (int angle = 180; angle >= 0; angle -= 10) {
    myservo.write(angle);
    delay(80);
  }
  Serial.println("полный оборот");
}
`,
  },

  {
    id: 'lcd',
    name: 'LCD 1602 по I2C',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'lcd', type: 'lcd1602', x: 0, y: 250, props: {} },
      ],
      wires: [
        wire('b1', 'GND2', 'lcd', 'GND'), wire('b1', '5V2', 'lcd', 'VCC'),
        wire('b1', 'A4', 'lcd', 'SDA'), wire('b1', 'A5', 'lcd', 'SCL'),
      ],
    },
    code: `// LCD 1602 через I2C-переходник: две строки по 16 символов.

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("RoboSim LCD");
  Serial.begin(9600);
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print("t = ");
  lcd.print(millis() / 1000);
  lcd.print(" s    ");
  delay(500);
}
`,
  },

  {
    id: 'oled',
    name: 'OLED 128×64 (SSD1306)',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'oled', type: 'oled', x: 0, y: 260, props: {} },
      ],
      wires: [
        wire('b1', 'GND2', 'oled', 'GND'), wire('b1', '5V2', 'oled', 'VCC'),
        wire('b1', 'A4', 'oled', 'SDA'), wire('b1', 'A5', 'oled', 'SCL'),
      ],
    },
    code: `// OLED на SSD1306: текстовый API Adafruit (графика — заглушки).

#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64);

void setup() {
  display.begin();
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("RoboSim");
  display.setCursor(0, 16);
  display.print("OLED работает");
  display.display();
  Serial.begin(9600);
}

void loop() {
  display.setCursor(0, 40);
  display.print("uptime: ");
  display.print(millis() / 1000);
  display.print(" s   ");
  display.display();
  delay(500);
}
`,
  },

  {
    id: 'dht',
    name: 'Датчик DHT11: температура и влажность',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'dht', type: 'dht11', x: 140, y: -160, props: { temp: 24, hum: 45 } },
      ],
      wires: [
        wire('b1', '5V2', 'dht', 'VCC'),
        wire('b1', 'D2', 'dht', 'DATA'),
        wire('b1', 'GND2', 'dht', 'GND'),
      ],
    },
    code: `// DHT11: потяните датчик мышью по вертикали — меняется температура.
// (Протокол не эмулируется побитово: библиотека берёт значения у детали.)

#include <DHT.h>
DHT dht(2);

void setup() {
  Serial.begin(9600);
  dht.begin();
  Serial.println("DHT11 запущен");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  Serial.print("T = ");
  Serial.print(t);
  Serial.print(" C,  H = ");
  Serial.print(h);
  Serial.println(" %");
  delay(1000);
}
`,
  },

  {
    id: 'sonar',
    name: 'Дальномер HC-SR04 (pulseIn)',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'sr', type: 'hcsr04', x: 160, y: -170, props: { distance: 50 } },
      ],
      wires: [
        wire('b1', '5V2', 'sr', 'VCC'),
        wire('b1', 'D7', 'sr', 'TRIG'),
        wire('b1', 'D8', 'sr', 'ECHO'),
        wire('b1', 'GND2', 'sr', 'GND'),
      ],
    },
    code: `// HC-SR04: pulseIn возвращает длительность эха (58 мкс на сантиметр).
// Тяните дальномер по вертикали — расстояние меняется.

const int TRIG = 7;
const int ECHO = 8;

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(TRIG, HIGH);
  delay(10);
  digitalWrite(TRIG, LOW);

  long us = pulseIn(ECHO, HIGH);
  long cm = us / 58;

  Serial.print("эхо ");
  Serial.print(us);
  Serial.print(" мкс -> ");
  Serial.print(cm);
  Serial.println(" см");
  delay(500);
}
`,
  },

  {
    id: 'danger',
    name: 'Авария: светодиод без резистора',
    autorun: true,
    schematic: {
      parts: [board(), { id: 'l1', type: 'led', x: 30, y: -190, props: { color: '#ff5544' } }],
      wires: [wire('b1', 'D9', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND2')],
    },
    code: `// Так делать нельзя: светодиод подключён напрямую к выводу.
// Симулятор посчитает реальный ток и покажет аварию внизу экрана.

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(9, HIGH);
  delay(1500);
  digitalWrite(9, LOW);
  delay(800);
}
`,
  },

  {
    id: 'esp32',
    name: 'ESP32: логика 3,3 В и АЦП 12 бит',
    autorun: true,
    boardId: 'b1',
    scope: ['A0'],
    schematic: {
      parts: [
        board('esp32'),
        { id: 'rv1', type: 'pot', x: -80, y: -185, props: { value: 0.5, ohms: 10000 } },
        { id: 'l1', type: 'led', x: 150, y: -200, props: { color: '#7ec8ff' } },
        { id: 'r1', type: 'resistor', x: 250, y: -200, props: { value: 220 } },
      ],
      wires: [
        wire('b1', '3V3', 'rv1', 'A'), wire('b1', 'GND', 'rv1', 'B'), wire('rv1', 'W', 'b1', '32'),
        wire('b1', '4', 'l1', 'A'), wire('l1', 'K', 'r1', '1'), wire('r1', '2', 'b1', 'GND'),
      ],
    },
    code: `// ESP32: питание 3,3 В, АЦП от 0 до 4095, встроенный светодиод на GPIO2.
// Порт Serial работает через USB-UART, как на плате.

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
  pinMode(4, OUTPUT);
  Serial.println("ESP32 запущен");
}

void loop() {
  int raw = analogRead(32);          // 0…4095, а не 0…1023
  int level = map(raw, 0, 4095, 0, 255);
  analogWrite(4, level);

  digitalWrite(2, raw > 2048 ? HIGH : LOW);

  Serial.print("GPIO32 = ");
  Serial.print(raw);
  Serial.print("  ->  LED ");
  Serial.println(level);
  delay(300);
}
`,
  },

  {
    id: 'pico',
    name: 'Pico + MicroPython: мигание',
    autorun: true,
    boardId: 'b1',
    schematic: { parts: [board('pico')], wires: [] },
    code: `# Raspberry Pi Pico, MicroPython.
# Встроенный светодиод — GP25.

from machine import Pin
import time

led = Pin(25, Pin.OUT)
counter = 0

while True:
    led.value(1)
    counter += 1
    print("мигание", counter)
    time.sleep(0.4)
    led.value(0)
    time.sleep(0.4)
`,
  },

  {
    id: 'pico-pwm',
    name: 'Pico + MicroPython: ШИМ и АЦП',
    autorun: true,
    boardId: 'b1',
    scope: ['A0', '11'],
    timeDiv: 0.005,
    schematic: {
      parts: [
        board('pico'),
        { id: 'rv1', type: 'pot', x: -80, y: -190, props: { value: 0.5, ohms: 10000 } },
        { id: 'l1', type: 'led', x: 150, y: -200, props: { color: '#ffd166' } },
        { id: 'r1', type: 'resistor', x: 250, y: -200, props: { value: 220 } },
      ],
      wires: [
        wire('b1', '3V3', 'rv1', 'A'), wire('b1', 'GND', 'rv1', 'B'), wire('rv1', 'W', 'b1', '26'),
        wire('b1', '11', 'l1', 'A'), wire('l1', 'K', 'r1', '1'), wire('r1', '2', 'b1', 'GND'),
      ],
    },
    code: `# MicroPython: ADC читает 0…65535, ШИМ задаётся через duty_u16.

from machine import Pin, ADC, PWM
import time

pot = ADC(Pin(26))
led = PWM(Pin(11))

while True:
    raw = pot.read_u16()
    led.duty_u16(raw)
    print("ADC", raw, "-> duty", raw)
    time.sleep(0.3)
`,
  },

  {
    id: 'two-boards',
    name: 'Две платы на одной схеме',
    autorun: true,
    schematic: {
      parts: [
        board('uno', 0, -110, 'b1'),
        board('esp32', 0, 150, 'b2'),
      ],
      wires: [],
    },
    code: `// У каждой платы свой скетч. Переключайтесь вкладками над редактором.
// Земли плат считаются общими (в железе их всегда соединяют проводом).

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);   // на Uno это D13
  Serial.begin(9600);
  Serial.println("Uno на связи");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(300);
  digitalWrite(LED_BUILTIN, LOW);
  delay(300);
}
`,
    extraCode: {
      b2: `// Второй скетч — для ESP32 (встроенный светодиод GPIO2).

void setup() {
  pinMode(2, OUTPUT);
  Serial.begin(115200);
  Serial.println("ESP32 на связи");
}

void loop() {
  digitalWrite(2, HIGH);
  delay(700);
  digitalWrite(2, LOW);
  delay(700);
}
`,
    },
  },

  {
    id: 'rgb',
    name: 'RGB-светодиод: три цвета',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'r1', type: 'resistor', x: -190, y: -180, props: { value: 220 } },
        { id: 'r2', type: 'resistor', x: -60, y: -180, props: { value: 220 } },
        { id: 'r3', type: 'resistor', x: 70, y: -180, props: { value: 220 } },
        { id: 'd1', type: 'rgbled', x: 240, y: -160, props: {} },
      ],
      wires: [
        wire('b1', 'D9', 'r1', '1'), wire('r1', '2', 'd1', 'R'),
        wire('b1', 'D10', 'r2', '1'), wire('r2', '2', 'd1', 'G'),
        wire('b1', 'D11', 'r3', '1'), wire('r3', '2', 'd1', 'B'),
        wire('d1', 'K', 'b1', 'GND'),
      ],
    },
    code: `// В одном корпусе три кристалла: красный, зелёный, синий.
// У каждого свой резистор — иначе кристалл сгорит.
// analogWrite даёт плавные переходы цвета.

void setup() {
  pinMode(9, OUTPUT); pinMode(10, OUTPUT); pinMode(11, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  analogWrite(9, 255); analogWrite(10, 0); analogWrite(11, 0);
  delay(400);
  analogWrite(9, 0); analogWrite(10, 255); analogWrite(11, 0);
  delay(400);
  analogWrite(9, 0); analogWrite(10, 0); analogWrite(11, 255);
  delay(400);
  // жёлтый = красный + зелёный, белый = все три
  analogWrite(9, 255); analogWrite(10, 200); analogWrite(11, 0);
  delay(400);
  analogWrite(9, 255); analogWrite(10, 255); analogWrite(11, 255);
  delay(600);
}
`,
  },

  {
    id: 'relay',
    name: 'Реле: щелчок и лампа через контакты',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'k1', type: 'relay', x: 120, y: -150, props: {} },
        { id: 'r1', type: 'resistor', x: 200, y: 60, props: { value: 220 } },
        { id: 'l1', type: 'led', x: 320, y: 60, props: { color: '#ffd166' } },
        { id: 'sw1', type: 'toggle', x: -120, y: 60, props: { on: true } },
      ],
      wires: [
        wire('b1', '5V2', 'k1', 'VCC'), wire('b1', 'GND2', 'k1', 'GND'), wire('b1', 'D9', 'k1', 'IN'),
        // силовая часть: питание → тумблер → лампа → COM…NO → земля
        wire('b1', '5V', 'sw1', '1'), wire('sw1', '2', 'r1', '1'), wire('r1', '2', 'l1', 'A'),
        wire('l1', 'K', 'k1', 'COM'), wire('k1', 'NO', 'b1', 'GND'),
      ],
    },
    code: `// Реле — электромагнитный ключ. Катушка и контакты развязаны:
// скетч управляет только катушкой (IN), а лампа живёт в своей цепи.
// Пока лампа включена — слышно «щёлк» и видно, как двигается якорь.

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
  Serial.println("Реле: раз в секунду");
}

void loop() {
  digitalWrite(9, HIGH);     // катушка под током → COM соединился с NO
  Serial.println("щёлк: лампа горит");
  delay(1000);
  digitalWrite(9, LOW);      // катушка обесточена → COM вернулся на NC
  Serial.println("отпустило: лампа погасла");
  delay(1000);
}
`,
  },

  {
    id: 'joystick',
    name: 'Джойстик: X, Y и кнопка',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'rv1', type: 'joystick', x: 140, y: -170, props: { x: 0, y: 0 } },
        { id: 'r1', type: 'resistor', x: -190, y: 80, props: { value: 220 } },
        { id: 'l1', type: 'led', x: -60, y: 80, props: { color: '#7ef29d' } },
      ],
      wires: [
        wire('b1', '5V2', 'rv1', 'VCC'), wire('b1', 'GND2', 'rv1', 'GND'),
        wire('rv1', 'VRx', 'b1', 'A0'), wire('rv1', 'VRy', 'b1', 'A1'),
        wire('rv1', 'SW', 'b1', 'D2'),
        wire('b1', 'D9', 'r1', '1'), wire('r1', '2', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND'),
      ],
    },
    code: `// Модуль джойстика — это два потенциометра и кнопка.
// Потяните ручку на схеме: VRx и VRy поедут к 0 или 1023.
// Нажмите на ручку — замкнётся SW (нужен INPUT_PULLUP).

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  pinMode(9, OUTPUT);
}

void loop() {
  int x = analogRead(A0);
  int y = analogRead(A1);
  bool sw = digitalRead(2) == LOW;

  Serial.print("X "); Serial.print(x);
  Serial.print("  Y "); Serial.print(y);
  Serial.print(sw ? "  кнопка" : "");
  Serial.println();

  digitalWrite(9, sw ? HIGH : LOW);
  delay(150);
}
`,
  },

  {
    id: 'seg7',
    name: 'Индикатор 7 сегментов: цифры',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'r1', type: 'resistor', x: -300, y: -200, props: { value: 220 } },
        { id: 'r2', type: 'resistor', x: -200, y: -200, props: { value: 220 } },
        { id: 'r3', type: 'resistor', x: -100, y: -200, props: { value: 220 } },
        { id: 'r4', type: 'resistor', x: 0, y: -200, props: { value: 220 } },
        { id: 'r5', type: 'resistor', x: 100, y: -200, props: { value: 220 } },
        { id: 'r6', type: 'resistor', x: 200, y: -200, props: { value: 220 } },
        { id: 'r7', type: 'resistor', x: 300, y: -200, props: { value: 220 } },
        { id: 'hg1', type: 'seg7', x: 60, y: 250, props: {} },
      ],
      wires: [
        wire('b1', 'D2', 'r1', '1'), wire('r1', '2', 'hg1', 'A'),
        wire('b1', 'D3', 'r2', '1'), wire('r2', '2', 'hg1', 'B'),
        wire('b1', 'D4', 'r3', '1'), wire('r3', '2', 'hg1', 'C'),
        wire('b1', 'D5', 'r4', '1'), wire('r4', '2', 'hg1', 'D'),
        wire('b1', 'D6', 'r5', '1'), wire('r5', '2', 'hg1', 'E'),
        wire('b1', 'D7', 'r6', '1'), wire('r6', '2', 'hg1', 'F'),
        wire('b1', 'D8', 'r7', '1'), wire('r7', '2', 'hg1', 'G'),
        wire('hg1', 'COM', 'b1', 'GND'),
      ],
    },
    code: `// У каждого сегмента свой вывод и свой резистор.
// Порядок сегментов:  A B C D E F G  →  D2…D8.

const int seg[7] = {2, 3, 4, 5, 6, 7, 8};

// какие сегменты горят для цифры 0…9
const byte digit[10][7] = {
  {1,1,1,1,1,1,0}, {0,1,1,0,0,0,0}, {1,1,0,1,1,0,1}, {1,1,1,1,0,0,1},
  {0,1,1,0,0,1,1}, {1,0,1,1,0,1,1}, {1,0,1,1,1,1,1}, {1,1,1,0,0,0,0},
  {1,1,1,1,1,1,1}, {1,1,1,1,0,1,1},
};

void setup() {
  for (int i = 0; i < 7; i++) pinMode(seg[i], OUTPUT);
  Serial.begin(9600);
}

void show(int n) {
  for (int i = 0; i < 7; i++) digitalWrite(seg[i], digit[n][i]);
}

void loop() {
  for (int n = 0; n <= 9; n++) {
    show(n);
    Serial.print("цифра ");
    Serial.println(n);
    delay(700);
  }
}
`,
  },

  {
    id: 'stepper',
    name: 'Шаговый 28BYJ-48 + ULN2003',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'm1', type: 'stepper28byj', x: 150, y: -160, props: { angle: 0, steps: 0, phases: [false, false, false, false] } },
      ],
      wires: [
        wire('b1', '5V2', 'm1', 'VCC'), wire('b1', 'GND2', 'm1', 'GND'),
        wire('b1', 'D8', 'm1', 'IN1'), wire('b1', 'D9', 'm1', 'IN2'),
        wire('b1', 'D10', 'm1', 'IN3'), wire('b1', 'D11', 'm1', 'IN4'),
      ],
    },
    code: `// Драйвер ULN2003 усиливает выводы платы до тока катушек.
// Библиотека Stepper сама выдаёт последовательность фаз на IN1…IN4 —
// на схеме по очереди загорятся четыре светодиода, а вал повернётся.

#include <Stepper.h>

const int stepsPerRev = 2048;          // у 28BYJ-48 редуктор 1:64
Stepper motor(stepsPerRev, 8, 9, 10, 11);

void setup() {
  motor.setSpeed(8);                   // оборотов в минуту
  Serial.begin(9600);
  Serial.println("Шаговик: вперёд и назад");
}

void loop() {
  motor.step(512);                     // четверть оборота вперёд
  delay(400);
  motor.step(-512);                    // и назад
  delay(400);
}
`,
  },

  {
    id: 'power',
    name: 'Питание без платы: батарейка, резистор, светодиод',
    autorun: true,
    schematic: {
      parts: [
        { id: 'g1', type: 'battery9', x: -120, y: 20, props: { voltage: 9 } },
        { id: 'r1', type: 'resistor', x: 30, y: -80, props: { value: 470 } },
        { id: 'l1', type: 'led', x: 170, y: -80, props: { color: '#7ef29d' } },
        { id: 'o1', type: 'scope', x: 60, y: 140, props: {} },
      ],
      wires: [
        wire('g1', '+', 'r1', '1'), wire('r1', '2', 'l1', 'A'), wire('l1', 'K', 'g1', '−'),
        wire('o1', 'CH1', 'r1', '2'), wire('o1', 'GND', 'g1', '−'),
      ],
    },
    code: `// Схема вообще без платы: только источник питания и детали.
// Щупы осциллографа стоят на выводе резистора и на «минусе» батарейки —
// на его экране видно около 2 В: 9 В минус падение на резисторе.
//
// Плату сюда можно и не ставить: нажмите «Запустить» — цепь посчитается.

void setup() {}
void loop() {}
`,
  },

  {
    id: 'scope-pwm',
    name: 'Осциллограф: ШИМ на D9 и щупы',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'r1', type: 'resistor', x: 0, y: -200, props: { value: 220 } },
        { id: 'l1', type: 'led', x: 130, y: -200, props: { color: '#ff5544' } },
        { id: 'o1', type: 'scope', x: 40, y: 250, props: {} },
      ],
      wires: [
        wire('b1', 'D9', 'r1', '1'), wire('r1', '2', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND2'),
        wire('o1', 'CH1', 'b1', 'D9'), wire('o1', 'CH2', 'l1', 'A'), wire('o1', 'GND', 'b1', 'GND2'),
      ],
    },
    scope: ['D9', 'A0'],
    code: `// Осциллограф — такая же деталь, как резистор: у него два щупа и земля.
// CH1 стоит прямо на выводе D9, CH2 — после резистора, на аноде светодиода.
// На экране прибора видно прямоугольник, а плата плавно меняет яркость.

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
  Serial.println("Осциллограф на D9");
}

void loop() {
  for (int v = 0; v <= 255; v += 5) {
    analogWrite(9, v);
    delay(30);
  }
  for (int v = 255; v >= 0; v -= 5) {
    analogWrite(9, v);
    delay(30);
  }
}
`,
  },
  {
    id: 'multimeter',
    name: 'Мультиметр: вольтметр, амперметр, омметр',
    autorun: true,
    schematic: {
      parts: [
        { id: 'g1', type: 'battery9', x: -210, y: 10, props: { voltage: 9 } },
        { id: 'r1', type: 'resistor', x: -30, y: -130, props: { value: 1000 } },
        { id: 'r2', type: 'resistor', x: 140, y: -130, props: { value: 1000 } },
        { id: 'pa1', type: 'multimeter', x: -40, y: 190, props: { mode: 'V' } },
        { id: 'pl1', type: 'logicprobe', x: 210, y: 190, props: {} },
      ],
      wires: [
        wire('g1', '+', 'r1', '1'), wire('r1', '2', 'r2', '1'), wire('r2', '2', 'g1', '−'),
        wire('pa1', 'COM', 'g1', '−'), wire('pa1', 'VΩ', 'r1', '2'),
        wire('pl1', 'SIG', 'r1', '2'), wire('pl1', 'GND', 'g1', '−'),
      ],
    },
    code: `// Мультиметр — настоящий прибор, а не картинка: у него три гнезда.
// Щупы стоят на середине делителя (1000 + 1000 Ом от 9 В), поэтому
// на экране 4.50 В — ровно половина питания.
//
// Клик по диску переключает режим:
//   V DC — вольтметр (вход 1 МОм);
//   A DC — амперметр, включается в разрыв (шунт 0,1 Ом);
//   Ω   — омметр, сам подаёт испытательный ток 20 мкА;
//   ПИК — прозвонка: пикает, если сопротивление меньше 30 Ом.
//
// Рядом логический пробник: он смотрит уровень на том же проводе.
// Он умеет различать HIGH, LOW и импульсы (ШИМ) — и не нагружает цепь.
`,
  },

  {
    id: 'probe',
    name: 'Пробник и мультиметр на выводах платы',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'r1', type: 'resistor', x: 0, y: -200, props: { value: 220 } },
        { id: 'l1', type: 'led', x: 130, y: -200, props: { color: '#ff5544' } },
        { id: 'pl1', type: 'logicprobe', x: 320, y: -190, props: {} },
        { id: 'pa1', type: 'multimeter', x: 140, y: 210, props: { mode: 'V' } },
      ],
      wires: [
        wire('b1', 'D9', 'r1', '1'), wire('r1', '2', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND2'),
        wire('pl1', 'SIG', 'b1', 'D9'), wire('pl1', 'GND', 'b1', 'GND2'),
        wire('pa1', 'COM', 'b1', 'GND2'), wire('pa1', 'VΩ', 'l1', 'A'),
      ],
    },
    code: `// Плата плавно меняет скважность на D9.
// Пробник на выводе D9 показывает «ИМП» и частоту, а мультиметр после
// резистора — среднее напряжение на аноде светодиода (оно ползёт вверх
// и вниз вместе с яркостью). Так и в железе: стрелочный прибор врёт,
// цифровой показывает среднее, а пробник ловит импульсы.

void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
  Serial.println("Пробник на D9");
}

void loop() {
  for (int v = 0; v <= 255; v += 5) {
    analogWrite(9, v);
    delay(40);
  }
  for (int v = 255; v >= 0; v -= 5) {
    analogWrite(9, v);
    delay(40);
  }
}
`,
  },
  {
    id: 'shift595',
    name: '74HC595: бегущий огонь на четырёх светодиодах',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'dd1', type: 'sr595', x: -30, y: 205, props: {} },
        { id: 'r1', type: 'resistor', x: 150, y: -215, props: { value: 220 } },
        { id: 'r2', type: 'resistor', x: 150, y: -165, props: { value: 220 } },
        { id: 'r3', type: 'resistor', x: 150, y: -115, props: { value: 220 } },
        { id: 'r4', type: 'resistor', x: 150, y: -65, props: { value: 220 } },
        { id: 'l1', type: 'led', x: 260, y: -215, props: { color: '#ff5544' } },
        { id: 'l2', type: 'led', x: 260, y: -165, props: { color: '#ffd166' } },
        { id: 'l3', type: 'led', x: 260, y: -115, props: { color: '#3fd07a' } },
        { id: 'l4', type: 'led', x: 260, y: -65, props: { color: '#5ad2ff' } },
      ],
      wires: [
        wire('b1', '5V', 'dd1', 'MR'), wire('b1', 'GND', 'dd1', 'OE'),
        wire('b1', 'D8', 'dd1', 'DS'), wire('b1', 'D9', 'dd1', 'SHCP'), wire('b1', 'D10', 'dd1', 'STCP'),
        wire('dd1', 'QA', 'r1', '1'), wire('r1', '2', 'l1', 'A'), wire('l1', 'K', 'b1', 'GND2'),
        wire('dd1', 'QB', 'r2', '1'), wire('r2', '2', 'l2', 'A'), wire('l2', 'K', 'b1', 'GND2'),
        wire('dd1', 'QC', 'r3', '1'), wire('r3', '2', 'l3', 'A'), wire('l3', 'K', 'b1', 'GND2'),
        wire('dd1', 'QD', 'r4', '1'), wire('r4', '2', 'l4', 'A'), wire('l4', 'K', 'b1', 'GND2'),
      ],
    },
    code: `// Один сдвиговый регистр вместо четырёх выводов: три провода
// (данные, такт, защёлка) зажигают сколько угодно светодиодов.
// Бит, выведенный первым, за восемь тактов доберётся до QH,
// поэтому старший бит отправляем первым — как shiftOut(MSBFIRST).

const int DS = 8;      // данные
const int SH = 9;      // такт сдвига
const int ST = 10;     // защёлка

void sendByte(byte value) {
  for (int i = 7; i >= 0; i--) {
    digitalWrite(DS, (value >> i) & 1);    // старший бит — первым
    digitalWrite(SH, HIGH);
    digitalWrite(SH, LOW);
  }
  digitalWrite(ST, HIGH);                  // переписали защёлку
  digitalWrite(ST, LOW);
}

void setup() {
  pinMode(DS, OUTPUT);
  pinMode(SH, OUTPUT);
  pinMode(ST, OUTPUT);
  Serial.begin(9600);
  Serial.println("74HC595: бегущий огонь");
}

void loop() {
  for (int i = 0; i < 4; i++) {
    sendByte(1 << i);
    delay(180);
  }
}
`,
  },

  {
    id: 'motor',
    name: 'L298N и мотор: вперёд, назад, стоп',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'da1', type: 'l298n', x: -60, y: 185, props: {} },
        { id: 'm1', type: 'dcmotor', x: 205, y: 190, props: {} },
      ],
      wires: [
        wire('b1', 'D9', 'da1', 'IN1'), wire('b1', 'D8', 'da1', 'IN2'),
        wire('b1', '5V', 'da1', 'ENA'), wire('b1', '5V', 'da1', 'VCC'), wire('b1', 'GND2', 'da1', 'GND'),
        wire('da1', 'OUT1', 'm1', 'M+'), wire('da1', 'OUT2', 'm1', 'M-'),
      ],
    },
    code: `// L298N — это H-мост: два входа задают полярность на выходе,
// ENA — разрешение. Внутри моста падает около 1,8 В, поэтому
// мотор получает не все 5 В, и обороты чуть ниже.
//
// Смотрите на мотор: он не «переключается», а честно раскручивается
// и выбегает — у него есть инерция, как у настоящего.

const int IN1 = 9;
const int IN2 = 8;

void setup() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  Serial.begin(9600);
  Serial.println("L298N: вперёд-назад");
}

void loop() {
  digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);    // вперёд
  delay(2500);
  digitalWrite(IN1, LOW);  digitalWrite(IN2, LOW);    // выбег
  delay(1200);
  digitalWrite(IN1, LOW);  digitalWrite(IN2, HIGH);   // назад
  delay(2500);
  digitalWrite(IN1, LOW);  digitalWrite(IN2, LOW);
  delay(1200);
}
`,
  },

  {
    id: 'keypad',
    name: 'Клавиатура 4×4 и светофор',
    autorun: true,
    schematic: {
      parts: [
        board(),
        { id: 'sb1', type: 'keypad', x: 300, y: 20, props: { pressed: null } },
        { id: 'hl1', type: 'traffic', x: -260, y: 240, props: {} },
      ],
      wires: [
        wire('b1', 'D2', 'sb1', 'R1'), wire('b1', 'D3', 'sb1', 'R2'),
        wire('b1', 'D4', 'sb1', 'R3'), wire('b1', 'D5', 'sb1', 'R4'),
        wire('b1', 'D6', 'sb1', 'C1'), wire('b1', 'D7', 'sb1', 'C2'),
        wire('b1', 'D10', 'sb1', 'C3'), wire('b1', 'D11', 'sb1', 'C4'),
        wire('b1', 'D12', 'hl1', 'R'), wire('b1', 'D13', 'hl1', 'Y'),
        wire('b1', 'A0', 'hl1', 'G'), wire('b1', 'GND', 'hl1', 'GND'),
      ],
    },
    code: `// Клавиатура — это матрица 4×4: чтобы узнать, какая клавиша нажата,
// строки по очереди «прижимаем» к земле и читаем столбцы.
// Нажмите на клавишу мышью — скетч напечатает её в мониторе порта.
// Цифры зажигают красный, * и # — жёлтый, A…D — зелёный.

const int rows[4] = {2, 3, 4, 5};
const int cols[4] = {6, 7, 10, 11};
const char keys[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
char lastKey = 0;

void setup() {
  for (int i = 0; i < 4; i++) {
    pinMode(rows[i], OUTPUT);
    digitalWrite(rows[i], HIGH);
    pinMode(cols[i], INPUT_PULLUP);
  }
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
  pinMode(A0, OUTPUT);
  Serial.begin(9600);
  Serial.println("Нажмите клавишу на схеме");
}

char scan() {
  char found = 0;
  for (int r = 0; r < 4; r++) {
    digitalWrite(rows[r], LOW);
    for (int c = 0; c < 4; c++) {
      if (digitalRead(cols[c]) == LOW) found = keys[r][c];
    }
    digitalWrite(rows[r], HIGH);
  }
  return found;
}

void loop() {
  char k = scan();
  if (k != lastKey) {
    digitalWrite(12, LOW);
    digitalWrite(13, LOW);
    digitalWrite(A0, LOW);
    if (k) {
      Serial.print("Клавиша: ");
      Serial.println(k);
      bool digit = (k >= '0' && k <= '9');
      digitalWrite(12, digit ? HIGH : LOW);
      digitalWrite(13, (k == '*' || k == '#') ? HIGH : LOW);
      digitalWrite(A0, (k >= 'A' && k <= 'D') ? HIGH : LOW);
    }
    lastKey = k;
  }
  delay(30);
}
`
  },
  {
    id: 'overvolt',
    name: 'Перегрузка: 9 В на модуль, рассчитанный на 5 В',
    autorun: true,
    schematic: {
      parts: [
        { id: 'g1', type: 'battery9', x: -140, y: 40, props: { voltage: 9 } },
        { id: 'd1', type: 'dht11', x: 60, y: -30, props: {} },
        { id: 'o1', type: 'multimeter', x: 60, y: 110, props: {} },
      ],
      wires: [
        wire('g1', '+', 'd1', 'VCC'), wire('d1', 'GND', 'g1', '−'),
        wire('o1', 'VΩ', 'd1', 'VCC'), wire('o1', 'COM', 'g1', '−'),
      ],
    },
    code: `// Напряжение выше паспортного — деталь сгорает.
// У DHT11 предел 5,5 В, а мы подали 9 В от батарейки.
// Смотрите монитор порта: симулятор посчитает, когда деталь перегреется,
// и заменит её кнопкой «Сброс».

void setup() {
  Serial.begin(9600);
  Serial.println("9 В на модуль 5 В — так делать нельзя");
}

void loop() {
  delay(1000);
}
`,
  },
  {
    id: 'short',
    name: 'Авария: короткое замыкание — провод 5 В на GND',
    autorun: true,
    schematic: {
      parts: [board()],
      wires: [wire('b1', '5V', 'b1', 'GND')],
    },
    code: `// Классическая авария на макетке: провод из шины 5 В прямо в землю.
// Току некуда деваться, кроме как идти через предохранитель платы.
// Симулятор проверит монтаж и сожжёт плату за 0,15 с — в мониторе порта
// будет написано, что случилось. Кнопка «Сброс» поставит новую плату.
//
// Другие аварии, которые ловит симулятор:
//   • перевёрнутый электролит — «бах» (плюс должен быть на выводе «+»);
//   • модуль с перепутанным питанием (VCC на землю, GND на 5 В);
//   • плюс источника на VIN, а минус на GND — переполюсовка питания.

void setup() {
  Serial.begin(9600);
  Serial.println(\"5 В на земле — короткое замыкание\");
}

void loop() {
  delay(1000);
}
`,
  },

  {
    id: 'rpi5-led',
    name: 'Raspberry Pi 5: светодиод на GPIO14',
    autorun: true,
    schematic: {
      parts: [
        board('rpi5', 0, 0, 'b1'),
        { id: 'r1', type: 'resistor', x: -10, y: 190, props: { value: 220 } },
        { id: 'd1', type: 'led', x: 130, y: 190, props: { color: '#3fd07a' } },
      ],
      wires: [
        wire('b1', 'GPIO14', 'r1', '1'),
        wire('r1', '2', 'd1', 'A'),
        wire('d1', 'K', 'b1', 'GND'),
      ],
    },
    code: `# Raspberry Pi 5: мигаем светодиодом на GPIO14 — это 8-й контакт гребёнки (TXD).
# Логика у Pi 3,3 В, с вывода можно взять не больше 16 мА, поэтому резистор 220 Ом.
# Всё как на настоящей плате: MicroPython, модуль machine, time.sleep.

from machine import Pin
import time

led = Pin(14, Pin.OUT)
count = 0

while True:
    led.value(1)
    time.sleep(0.4)
    led.value(0)
    time.sleep(0.4)
    count += 1
    if count % 5 == 0:
        print("миганий:", count)
`,
  },
];

/** Стартовый скетч для платы, добавленной из палитры. */
export function defaultCodeFor(type, lang) {
  if (type === 'pico') {
    return lang === 'cpp'
      ? `// Pico на C++: светодиод на GP25.\n\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n}\n`
      : `# Pico на MicroPython: светодиод на GP25.\n\nfrom machine import Pin\nimport time\n\nled = Pin(25, Pin.OUT)\n\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n`;
  }
  if (type === 'rpi5') {
    return `# Raspberry Pi 5: светодиод на GPIO17 (физический вывод 11).
# У Pi логика 3,3 В, а на GPIO можно вешать до 16 мА — резистор обязателен.

from machine import Pin
import time

led = Pin(14, Pin.OUT)

while True:
    led.value(1)
    time.sleep(0.5)
    led.value(0)
    time.sleep(0.5)
`;
  }
  if (type === 'esp32') {
    return `// ESP32: встроенный светодиод на GPIO2, логика 3,3 В.\n\nvoid setup() {\n  pinMode(2, OUTPUT);\n  Serial.begin(115200);\n  Serial.println("ESP32 запущен");\n}\n\nvoid loop() {\n  digitalWrite(2, HIGH);\n  delay(500);\n  digitalWrite(2, LOW);\n  delay(500);\n}\n`;
  }
  return `// Blink — мигание встроенным светодиодом.\n\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.begin(9600);\n  Serial.println("Blink started!");\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n}\n`;
}
