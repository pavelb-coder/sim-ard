/**
 * parts.js — каталог деталей: геометрия выводов и отрисовка (SVG).
 *
 * Платы (Uno / ESP32 / Pico) генерируются из таблицы boards.js одной и той
 * же рисовалкой. Остальные детали описаны по отдельности: размеры, выводы
 * (id, подпись, координаты, направление провода), render() и update().
 */

import { BOARDS } from './boards.js';
import { renderBoardArt } from './board-art.js';

export const GRID = 10;

const pinLabelStyle = 'font:6px ui-monospace,monospace;fill:#cfe6ff;text-anchor:middle';

/**
 * Короткие подписи под деталями и префиксы позиционных обозначений.
 * Обозначения (R1, D2, A1) присваивает schematic.js по порядку деталей.
 */
export const SHORT_NAME = {
  led: 'светодиод', resistor: 'резистор', capacitor: 'конденсатор', electrolytic: 'электролит',
  inductor: 'катушка', button: 'кнопка', pot: 'потенциометр', servo: 'сервопривод',
  lcd1602: 'LCD 1602', oled: 'OLED 128×64', buzzer: 'зуммер', ldr: 'фоторезистор',
  pir: 'PIR', dht11: 'DHT11', hcsr04: 'HC-SR04',
  diode: 'диод', npn: 'транзистор', rgbled: 'светодиод RGB', toggle: 'тумблер',
  battery9: 'батарейка 9 В', batteryAA: 'отсек 4×AA', psu: 'источник питания', scope: 'осциллограф',
  multimeter: 'мультиметр', logicprobe: 'логический пробник',
  seg7: 'индикатор', relay: 'реле', joystick: 'джойстик', stepper28byj: 'шаговый двигатель',
  uno: 'Arduino Uno', esp32: 'ESP32 DevKit V1', pico: 'Raspberry Pi Pico',
  nano: 'Arduino Nano', promini: 'Arduino Pro Mini', leonardo: 'Arduino Leonardo', mega: 'Arduino Mega 2560',
};

export const REF_PREFIX = {
  led: 'D', resistor: 'R', capacitor: 'C', electrolytic: 'C', inductor: 'L', button: 'S',
  pot: 'RV', servo: 'M', lcd1602: 'LCD', oled: 'DS', buzzer: 'BZ', ldr: 'R', pir: 'PIR',
  dht11: 'DHT', hcsr04: 'SR', uno: 'A', esp32: 'A', pico: 'A',
  diode: 'VD', npn: 'VT', rgbled: 'D', toggle: 'S', seg7: 'HG', relay: 'K', joystick: 'RV', stepper28byj: 'M',
  battery9: 'GB', batteryAA: 'GB', psu: 'G', scope: 'OS', multimeter: 'PA', logicprobe: 'PL',
  nano: 'A', promini: 'A', leonardo: 'A', mega: 'A',
};

/** Подпись под деталью: «R1 · резистор», «A1 · Arduino Uno». */
function partLabel(comp, type) {
  const name = SHORT_NAME[type] || comp.__def?.name || type;
  return comp.ref ? `${comp.ref} · ${name}` : name;
}

const partTag = (comp, w, h, body, extra = '') => {
  const label = partLabel(comp, comp.type);
  // шильдик стоит ниже самой нижней подписи вывода, чтобы они не наезжали
  const pins = comp.__def?.pins ? comp.__def.pins(comp) : [];
  const lowest = pins.reduce((m, p) => Math.max(m, p.y + (p.dir === 'down' ? 16 : 6)), h / 2);
  const base = Math.round(lowest);
  const tw = Math.round(label.length * 3.5 + 12);
  return `<g class="part" data-id="${comp.id}">
     <rect class="hit" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="transparent"/>
     <g class="body">${body}</g>${extra}
     <g class="tag">
       <rect class="part-tag" x="${-tw / 2}" y="${base + 12}" width="${tw}" height="14" rx="7"
             fill="#0c141b" stroke="#22323f" stroke-width=".8"/>
       <text class="part-label" x="0" y="${base + 22}"
             style="font:6px ui-monospace,monospace;fill:#9db2c5;text-anchor:middle;pointer-events:none">${esc(label)}</text>
     </g>
   </g>`;
};

// ------------------------------------------------------------- платы ----
function renderBoard(comp, spec) {
  return partTag(comp, spec.w, spec.h, renderBoardArt(spec));
}

// ------------------------------------------------------- дискретные ----
const DISCRETE = {
  led: {
    name: 'Светодиод', category: 'Компоненты', w: 56, h: 34,
    pins: () => [
      { id: 'A', label: 'A', x: -26, y: 0, dir: 'left' },
      { id: 'K', label: 'K', x: 26, y: 0, dir: 'right' },
    ],
    render(comp) {
      const c = comp.props?.color || '#ff5544';
      return partTag(comp, 56, 34, `
        <line x1="-26" y1="0" x2="-8" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="8" y1="0" x2="26" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <circle class="glow" cx="0" cy="0" r="23" fill="${c}" opacity="0"/>
        <circle class="glow-core" cx="0" cy="0" r="12" fill="${c}" opacity="0"/>
        <circle cx="0" cy="0" r="11" fill="#2a3440" stroke="#46586a" stroke-width="1.2"/>
        <path d="M -6 -6 L 6 0 L -6 6 Z" fill="#d8e4ee"/>
        <line x1="6" y1="-7" x2="6" y2="7" stroke="#d8e4ee" stroke-width="1.6"/>
        <text x="0" y="27" style="font:6px ui-monospace;fill:#7d93a6;text-anchor:middle">A→K</text>`);
    },
    update(g, comp, env) {
      const b = Math.min(1, env.brightness || 0);
      const halo = g.querySelector('.glow'), core = g.querySelector('.glow-core'), sym = g.querySelector('path');
      if (halo) halo.setAttribute('opacity', String(b * 0.32));
      if (core) core.setAttribute('opacity', String(b * 0.55));
      if (sym) sym.setAttribute('fill', b > 0.02 ? '#fff6cf' : '#d8e4ee');
    },
  },

  resistor: {
    name: 'Резистор', category: 'Компоненты', w: 70, h: 26,
    pins: () => [
      { id: '1', label: '1', x: -32, y: 0, dir: 'left' },
      { id: '2', label: '2', x: 32, y: 0, dir: 'right' },
    ],
    render(comp) {
      const v = comp.props?.value ?? 220;
      return partTag(comp, 70, 26, `
        <line x1="-32" y1="0" x2="-18" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="18" y1="0" x2="32" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <path d="M -18 0 l 4 -7 l 4 14 l 4 -14 l 4 14 l 4 -14 l 4 14 l 4 -7 l 4 0"
              fill="none" stroke="#e6c07b" stroke-width="1.6" stroke-linejoin="round"/>
        <text x="0" y="20" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">${fmtR(v)}</text>`);
    },
  },

  capacitor: {
    name: 'Конденсатор', category: 'Компоненты', w: 64, h: 30,
    pins: () => [
      { id: '1', label: '1', x: -30, y: 0, dir: 'left' },
      { id: '2', label: '2', x: 30, y: 0, dir: 'right' },
    ],
    render(comp) {
      const uf = (comp.props?.farads ?? 1e-5) * 1e6;
      return partTag(comp, 64, 30, `
        <line x1="-30" y1="0" x2="-5" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="5" y1="0" x2="30" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-5" y1="-10" x2="-5" y2="10" stroke="#bfe0ff" stroke-width="2"/>
        <line x1="5" y1="-10" x2="5" y2="10" stroke="#bfe0ff" stroke-width="2"/>
        <text x="0" y="22" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">${uf >= 1 ? uf.toFixed(0) + ' мкФ' : (uf * 1000).toFixed(0) + ' нФ'}</text>`);
    },
    update(g, comp, env) {
      const v = g.querySelectorAll('line');
      const charge = Math.min(1, Math.abs(env.voltage || 0) / 5);
      if (v[2]) v[2].setAttribute('stroke', charge > 0.05 ? `rgba(140,220,255,${0.35 + charge * 0.65})` : '#bfe0ff');
    },
  },

  electrolytic: {
    name: 'Электролит', category: 'Компоненты', w: 64, h: 34,
    pins: () => [
      { id: '1', label: '+', x: -30, y: 0, dir: 'left' },
      { id: '2', label: '−', x: 30, y: 0, dir: 'right' },
    ],
    render(comp) {
      const uf = (comp.props?.farads ?? 1e-4) * 1e6;
      return partTag(comp, 64, 34, `
        <line x1="-30" y1="0" x2="-5" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="5" y1="0" x2="30" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-5" y1="-11" x2="-5" y2="11" stroke="#ffb26b" stroke-width="2"/>
        <path d="M 9 -11 A 11 11 0 0 1 9 11" fill="none" stroke="#bfe0ff" stroke-width="2"/>
        <text x="-11" y="-13" style="font:7px ui-monospace;fill:#ffb26b;text-anchor:middle">+</text>
        <text x="0" y="25" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">${uf >= 1000 ? (uf / 1000).toFixed(0) + ' мФ' : uf.toFixed(0) + ' мкФ'}</text>`);
    },
  },

  inductor: {
    name: 'Катушка', category: 'Компоненты', w: 70, h: 30,
    pins: () => [
      { id: '1', label: '1', x: -32, y: 0, dir: 'left' },
      { id: '2', label: '2', x: 32, y: 0, dir: 'right' },
    ],
    render(comp) {
      const mh = (comp.props?.henries ?? 1e-3) * 1000;
      return partTag(comp, 70, 30, `
        <line x1="-32" y1="0" x2="-18" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="18" y1="0" x2="32" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <path d="M -18 0 a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0"
              fill="none" stroke="#b8a1ff" stroke-width="1.6"/>
        <text x="0" y="22" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">${mh.toFixed(1)} мГн</text>`);
    },
  },

  button: {
    name: 'Кнопка', category: 'Компоненты', w: 64, h: 36,
    pins: () => [
      { id: '1', label: '1', x: -30, y: 8, dir: 'left' },
      { id: '2', label: '2', x: 30, y: 8, dir: 'right' },
    ],
    render(comp) {
      return partTag(comp, 64, 36, `
        <line x1="-30" y1="8" x2="-14" y2="8" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="14" y1="8" x2="30" y2="8" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-14" y1="8" x2="-6" y2="8" stroke="#e6eef5" stroke-width="1.6"/>
        <line x1="6" y1="8" x2="14" y2="8" stroke="#e6eef5" stroke-width="1.6"/>
        <line class="plunger" x1="-10" y1="-6" x2="10" y2="-6" stroke="#9fb6c9" stroke-width="2"/>
        <circle cx="0" cy="-6" r="4" fill="#3a4b5c"/>
        <text x="0" y="26" style="font:6px ui-monospace;fill:#7d93a6;text-anchor:middle">нажмите</text>`);
    },
    update(g, comp) {
      const p = g.querySelector('.plunger');
      if (p) { p.setAttribute('y1', comp.props?.pressed ? '2' : '-6'); p.setAttribute('y2', comp.props?.pressed ? '2' : '-6'); }
    },
  },

  pot: {
    name: 'Потенциометр', category: 'Компоненты', w: 76, h: 60,
    pins: () => [
      { id: 'A', label: 'A', x: -34, y: 6, dir: 'left' },
      { id: 'B', label: 'B', x: 34, y: 6, dir: 'right' },
      { id: 'W', label: 'W', x: 0, y: 34, dir: 'down' },
    ],
    render(comp) {
      const a = comp.props?.value ?? 0.5;
      const wx = -18 + 36 * a;
      return partTag(comp, 76, 60, `
        <line x1="-34" y1="6" x2="-22" y2="6" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="22" y1="6" x2="34" y2="6" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="0" y1="34" x2="0" y2="16" stroke="#8aa4b8" stroke-width="1.4"/>
        <rect x="-22" y="-6" width="44" height="24" rx="3" fill="#2a3440" stroke="#46586a"/>
        <rect x="-18" y="8" width="36" height="4" fill="#1a222b"/>
        <rect data-role="knob" x="-22" y="-6" width="44" height="26" fill="transparent" style="cursor:ew-resize"/>
        <polygon class="wiper" points="${wx},-2 ${wx - 4},4 ${wx + 4},4" fill="#e6c07b"/>
        <text class="pot-value" x="0" y="-12" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">${Math.round(a * 100)}%</text>`);
    },
    update(g, comp) {
      const a = comp.props?.value ?? 0.5;
      const wx = -18 + 36 * a;
      const w = g.querySelector('.wiper');
      if (w) w.setAttribute('points', `${wx},-2 ${wx - 4},4 ${wx + 4},4`);
      const t = g.querySelector('.pot-value');
      if (t) t.textContent = `${Math.round(a * 100)}%`;
    },
  },

  ldr: {
    name: 'Фоторезистор', category: 'Датчики', w: 64, h: 44,
    pins: () => [
      { id: '1', label: '1', x: -28, y: 0, dir: 'left' },
      { id: '2', label: '2', x: 28, y: 0, dir: 'right' },
    ],
    render(comp) {
      const light = comp.props?.light ?? 0.5;
      return partTag(comp, 64, 44, `
        <line x1="-28" y1="0" x2="-14" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="14" y1="0" x2="28" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <circle cx="0" cy="0" r="13" fill="#2a3440" stroke="#46586a"/>
        <path d="M -8 -6 l 16 12 M -8 0 l 16 0 M -8 6 l 16 -12" stroke="#e6c07b" stroke-width="1.2" fill="none"/>
        <text x="0" y="24" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">свет ${Math.round(light * 100)}%</text>
        <rect data-role="knob" x="-13" y="-13" width="26" height="26" fill="transparent" style="cursor:ew-resize"/>`);
    },
    update(g, comp) {
      const t = g.querySelector('.body text');
      if (t) t.textContent = `свет ${Math.round((comp.props?.light ?? 0.5) * 100)}%`;
    },
  },

  pir: {
    name: 'Датчик движения', category: 'Датчики', w: 72, h: 56,
    pins: () => [
      { id: 'VCC', label: '+', x: -20, y: 24, dir: 'down' },
      { id: 'OUT', label: 'OUT', x: 0, y: 24, dir: 'down' },
      { id: 'GND', label: '−', x: 20, y: 24, dir: 'down' },
    ],
    render(comp) {
      const on = !!comp.props?.motion;
      return partTag(comp, 72, 56, `
        <path d="M -22 -4 a 22 22 0 0 1 44 0 z" fill="#e8eef4" stroke="#9fb0bf"/>
        <circle cx="0" cy="-6" r="7" fill="${on ? '#ffd166' : '#cfdae4'}" opacity=".9"/>
        <line x1="-20" y1="-4" x2="-20" y2="24" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="0" y1="-4" x2="0" y2="24" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="20" y1="-4" x2="20" y2="24" stroke="#8aa4b8" stroke-width="1.4"/>
        <text x="0" y="-18" style="font:6px ui-monospace;fill:${on ? '#ffd166' : '#7d93a6'};text-anchor:middle">${on ? 'движение' : 'тихо'}</text>`);
    },
    update() {},
  },

  dht11: {
    name: 'Датчик DHT11', category: 'Датчики', w: 66, h: 54,
    pins: () => [
      { id: 'VCC', label: '+', x: -20, y: 22, dir: 'down' },
      { id: 'DATA', label: 'D', x: 0, y: 22, dir: 'down' },
      { id: 'GND', label: '−', x: 20, y: 22, dir: 'down' },
    ],
    render(comp) {
      const t = comp.props?.temp ?? 24, h = comp.props?.hum ?? 45;
      return partTag(comp, 66, 54, `
        <rect x="-22" y="-24" width="44" height="34" rx="3" fill="#1b3a5c" stroke="#2c5c8a"/>
        <rect x="-16" y="-18" width="32" height="14" rx="1" fill="#0d2233"/>
        <text x="0" y="4" style="font:6px ui-monospace;fill:#a9d4f5;text-anchor:middle">${t.toFixed(0)}°C ${h.toFixed(0)}%</text>
        <line x1="-20" y1="10" x2="-20" y2="22" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="20" y1="10" x2="20" y2="22" stroke="#8aa4b8" stroke-width="1.4"/>`);
    },
    update(g, comp) {
      const t = g.querySelector('.body text');
      if (t) t.textContent = `${(comp.props?.temp ?? 24).toFixed(0)}°C ${(comp.props?.hum ?? 45).toFixed(0)}%`;
    },
  },

  hcsr04: {
    name: 'Дальномер HC-SR04', category: 'Датчики', w: 96, h: 54,
    pins: () => [
      { id: 'VCC', label: '+', x: -30, y: 22, dir: 'down' },
      { id: 'TRIG', label: 'T', x: -10, y: 22, dir: 'down' },
      { id: 'ECHO', label: 'E', x: 10, y: 22, dir: 'down' },
      { id: 'GND', label: '−', x: 30, y: 22, dir: 'down' },
    ],
    render(comp) {
      const dist = comp.props?.distance ?? 50;
      return partTag(comp, 96, 54, `
        <rect x="-40" y="-20" width="80" height="40" rx="3" fill="#12324a" stroke="#2c6a8a"/>
        <circle cx="-20" cy="0" r="11" fill="#20333f" stroke="#5f7c8c"/>
        <circle cx="20" cy="0" r="11" fill="#20333f" stroke="#5f7c8c"/>
        <text x="0" y="-6" style="font:6px ui-monospace;fill:#a9d4f5;text-anchor:middle">${Math.round(dist)} см</text>
        <text x="0" y="12" style="font:6px ui-monospace;fill:#5f8ba8;text-anchor:middle">HC-SR04</text>`);
    },
    update(g, comp) {
      const t = g.querySelector('.body text');
      if (t) t.textContent = `${Math.round(comp.props?.distance ?? 50)} см`;
    },
  },

  // ---------------------------------------------------- новые детали ----
  diode: {
    name: 'Диод', category: 'Компоненты', w: 60, h: 34,
    pins: () => [
      { id: 'A', label: 'A', x: -28, y: 0, dir: 'left' },
      { id: 'K', label: 'K', x: 28, y: 0, dir: 'right' },
    ],
    render(comp) {
      return partTag(comp, 60, 34, `
        <line x1="-28" y1="0" x2="-9" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="9" y1="0" x2="28" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <circle class="glow" cx="0" cy="0" r="16" fill="#ffd166" opacity="0"/>
        <path class="tri" d="M -9 -8 L 9 0 L -9 8 Z" fill="#d8e4ee"/>
        <line x1="9" y1="-9" x2="9" y2="9" stroke="#d8e4ee" stroke-width="1.8"/>
        <text x="0" y="24" style="font:6px ui-monospace;fill:#7d93a6;text-anchor:middle">A→K  0,65 В</text>`);
    },
    update(g, comp, env) {
      const i = env.current || 0;
      const on = i > 0.0005;
      const glow = g.querySelector('.glow'), tri = g.querySelector('.tri');
      if (glow) glow.setAttribute('opacity', String(Math.min(0.35, i * 6)));
      if (tri) tri.setAttribute('fill', on ? '#fff0c2' : '#d8e4ee');
    },
  },

  npn: {
    name: 'Транзистор NPN', category: 'Компоненты', w: 70, h: 72,
    pins: () => [
      { id: 'B', label: 'B', x: -32, y: 0, dir: 'left' },
      { id: 'C', label: 'C', x: 10, y: -30, dir: 'up' },
      { id: 'E', label: 'E', x: 10, y: 30, dir: 'down' },
    ],
    render(comp) {
      return partTag(comp, 70, 72, `
        <line x1="-32" y1="0" x2="-14" y2="0" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="10" y1="-30" x2="10" y2="-12" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="10" y1="12" x2="10" y2="30" stroke="#8aa4b8" stroke-width="1.4"/>
        <circle cx="4" cy="0" r="20" fill="#222c36" stroke="#46586a" stroke-width="1.2"/>
        <line x1="-14" y1="0" x2="-4" y2="0" stroke="#d8e4ee" stroke-width="1.8"/>
        <line x1="-4" y1="-11" x2="-4" y2="11" stroke="#d8e4ee" stroke-width="2.2"/>
        <line x1="-4" y1="-6" x2="10" y2="-12" stroke="#d8e4ee" stroke-width="1.6"/>
        <line x1="-4" y1="6" x2="10" y2="12" stroke="#d8e4ee" stroke-width="1.6"/>
        <path class="arrow" d="M 12 12 L 3 11 L 7 5 Z" fill="#d8e4ee"/>
        <circle class="state" cx="16" cy="-14" r="3" fill="#3a4b5c"/>` + `
        <text x="0" y="50" style="font:6px ui-monospace;fill:#7d93a6;text-anchor:middle">BC547  hFE≈100</text>`);
    },
    update(g, comp, env) {
      const on = !!env.info?.on;
      const st = g.querySelector('.state'), ar = g.querySelector('.arrow');
      if (st) st.setAttribute('fill', on ? '#7ef29d' : '#3a4b5c');
      if (ar) ar.setAttribute('fill', on ? '#c9ffe0' : '#d8e4ee');
    },
  },

  rgbled: {
    name: 'Светодиод RGB', category: 'Компоненты', w: 76, h: 60,
    pins: () => [
      { id: 'R', label: 'R', x: -21, y: 24, dir: 'down' },
      { id: 'G', label: 'G', x: -7, y: 24, dir: 'down' },
      { id: 'B', label: 'B', x: 7, y: 24, dir: 'down' },
      { id: 'K', label: '−', x: 21, y: 24, dir: 'down' },
    ],
    render(comp) {
      return partTag(comp, 76, 60, `
        <circle class="halo halo-r" cx="0" cy="-4" r="24" fill="#ff3b30" opacity="0"/>
        <circle class="halo halo-g" cx="0" cy="-4" r="24" fill="#28d17c" opacity="0"/>
        <circle class="halo halo-b" cx="0" cy="-4" r="24" fill="#3b82f6" opacity="0"/>
        <circle cx="0" cy="-4" r="13" fill="#e9eef3" fill-opacity=".22" stroke="#9fb0bf" stroke-width="1.1"/>
        <circle class="core" cx="0" cy="-4" r="7" fill="#dfe8ef" opacity=".85"/>
        <path d="M -13 0 L -13 24 M -7 6 L -7 24 M 7 6 L 7 24 M 13 0 L 13 24"
              stroke="#8aa4b8" stroke-width="1.3" fill="none"/>
        <text x="0" y="47" style="font:6px ui-monospace;fill:#7d93a6;text-anchor:middle">общий катод</text>`);
    },
    update(g, comp, env) {
      const ch = env.info?.channels || [0, 0, 0];
      const set = (sel, b) => { const el = g.querySelector(sel); if (el) el.setAttribute('opacity', String(Math.min(1, b) * 0.85)); };
      set('.halo-r', ch[0]); set('.halo-g', ch[1]); set('.halo-b', ch[2]);
      const core = g.querySelector('.core');
      if (core) {
        const m = Math.max(ch[0], ch[1], ch[2]);
        core.setAttribute('opacity', String(0.35 + Math.min(0.65, m * 0.65)));
        core.setAttribute('fill', m > 0.05
          ? `rgb(${Math.round(120 + 135 * Math.min(1, ch[0]))},${Math.round(120 + 135 * Math.min(1, ch[1]))},${Math.round(120 + 135 * Math.min(1, ch[2]))})`
          : '#dfe8ef');
      }
    },
  },

  toggle: {
    name: 'Тумблер', category: 'Компоненты', w: 64, h: 58,
    pins: () => [
      { id: '1', label: '1', x: -28, y: 12, dir: 'left' },
      { id: '2', label: '2', x: 28, y: 12, dir: 'right' },
      { id: '3', label: '3', x: 0, y: 26, dir: 'down' },
    ],
    render(comp) {
      const on = !!comp.props?.on;
      return partTag(comp, 64, 58, `
        <line x1="-28" y1="12" x2="-16" y2="12" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="16" y1="12" x2="28" y2="12" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="0" y1="26" x2="0" y2="12" stroke="#8aa4b8" stroke-width="1.4"/>
        <circle cx="-14" cy="12" r="2.2" fill="#cfdae4"/>
        <circle cx="14" cy="12" r="2.2" fill="#cfdae4"/>
        <circle cx="0" cy="12" r="2.2" fill="#cfdae4"/>
        <line x1="-14" y1="12" x2="14" y2="12" stroke="#3a4b5c" stroke-width="1"/>
        <g class="lever" transform="rotate(${on ? 34 : -34} 0 12)">
          <rect x="-3" y="-16" width="6" height="26" rx="3" fill="#c3ccd4" stroke="#7d93a6" stroke-width=".8"/>
          <circle cx="0" cy="-16" r="4" fill="#e9eef3" stroke="#7d93a6" stroke-width=".8"/>
        </g>
        <text class="sw-text" x="0" y="-24" style="font:6px ui-monospace;fill:${on ? '#7ef29d' : '#7d93a6'};text-anchor:middle">${on ? 'вкл' : 'выкл'}</text>`);
    },
    update(g, comp) {
      const on = !!comp.props?.on;
      const lv = g.querySelector('.lever');
      if (lv) lv.setAttribute('transform', `rotate(${on ? 34 : -34} 0 12)`);
      const t = g.querySelector('.sw-text');
      if (t) { t.textContent = on ? 'вкл' : 'выкл'; t.setAttribute('fill', on ? '#7ef29d' : '#7d93a6'); }
    },
  },

  seg7: {
    name: 'Индикатор 7 сегментов', category: 'Модули', w: 84, h: 120,
    pins: () => [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map((id, i) => (
        { id, label: id, x: -34, y: -35 + i * 10, dir: 'left', labelDx: -8, labelDy: 2, labelAnchor: 'end' })),
      { id: 'COM', label: '−', x: 34, y: 0, dir: 'right' },
    ].sort((a, b) => a.y - b.y),
    render(comp) {
      const SEG = {
        A: 'M -11 -40 l 3 -3 h 16 l 3 3 l -3 3 h -16 z',
        B: 'M 13 -37 l 3 3 v 15 l -3 3 l -3 -3 v -15 z',
        C: 'M 13 -13 l 3 3 v 15 l -3 3 l -3 -3 v -15 z',
        D: 'M -11 10 l 3 -3 h 16 l 3 3 l -3 3 h -16 z',
        E: 'M -13 -13 l 3 3 v 15 l -3 3 l -3 -3 v -15 z',
        F: 'M -13 -37 l 3 3 v 15 l -3 3 l -3 -3 v -15 z',
        G: 'M -11 -13 l 3 -3 h 16 l 3 3 l -3 3 h -16 z',
        DP: 'M 19 7 h 6 v 6 h -6 z',
      };
      const segs = Object.entries(SEG).map(([k, d]) =>
        `<path class="seg seg-${k}" d="${d}" fill="#3a2114"/>`).join('');
      return partTag(comp, 84, 120, `
        <rect x="-24" y="-48" width="52" height="64" rx="3" fill="#25150d" stroke="#3f2517"/>
        ${segs}
        <rect x="-24" y="-48" width="52" height="64" rx="3" fill="#000" opacity=".18"/>
        <text class="dig" x="0" y="42" style="font:9px ui-monospace;fill:#8a6a4a;text-anchor:middle">—</text>
        ${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map((id, i) =>
          `<line x1="-34" y1="${-35 + i * 10}" x2="-24" y2="${Math.max(-46, Math.min(14, -35 + i * 10))}" stroke="#8aa4b8" stroke-width="1.2"/>`).join('')}
        <line x1="34" y1="0" x2="28" y2="0" stroke="#8aa4b8" stroke-width="1.2"/>`);
    },
    update(g, comp, env) {
      const on = env.info?.segs || {};
      for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP']) {
        const el = g.querySelector(`.seg-${k}`);
        if (!el) continue;
        const b = Math.min(1, on[k] || 0);
        el.setAttribute('fill', b > 0.02 ? `rgba(255,${Math.round(70 + 60 * (1 - b))},40,${0.35 + 0.65 * b})` : '#3a2114');
      }
      const dig = g.querySelector('.dig');
      if (dig) {
        const map = [['A', 'B', 'C', 'D', 'E', 'F'], ['B', 'C'], ['A', 'B', 'D', 'E', 'G'], ['A', 'B', 'C', 'D', 'G'],
          ['B', 'C', 'F', 'G'], ['A', 'C', 'D', 'F', 'G'], ['A', 'C', 'D', 'E', 'F', 'G'], ['A', 'B', 'C'],
          ['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['A', 'B', 'C', 'D', 'F', 'G']];
        const lit = (k) => (on[k] || 0) > 0.35;
        const idx = map.findIndex((pat) => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].every((k) => lit(k) === pat.includes(k)));
        dig.textContent = idx >= 0 ? String(idx) : '—';
        dig.setAttribute('fill', idx >= 0 ? '#ffb26b' : '#8a6a4a');
      }
    },
  },
};

// ---------------------------------------------------------- модули ----
const MODULES = {
  servo: {
    name: 'Сервопривод', category: 'Модули', w: 90, h: 64,
    pins: () => [
      { id: 'PWM', label: 'S', x: -30, y: 26, dir: 'down' },
      { id: 'VCC', label: '+', x: -10, y: 26, dir: 'down' },
      { id: 'GND', label: '−', x: 10, y: 26, dir: 'down' },
    ],
    render(comp) {
      const a = comp.props?.angle ?? 90;
      return partTag(comp, 90, 64, `
        <rect x="-26" y="-20" width="52" height="34" rx="4" fill="#1c4f7a" stroke="#2c74ab"/>
        <circle cx="0" cy="-4" r="12" fill="#0f2c42" stroke="#2c74ab"/>
        <g transform="rotate(${a - 90} 0 -4)">
          <rect x="-3" y="-30" width="6" height="26" rx="2" fill="#ffb26b"/>
          <circle cx="0" cy="-30" r="3.5" fill="#ffd8a8"/>
        </g>
        <text x="0" y="7" style="font:6px ui-monospace;fill:#9fc9e6;text-anchor:middle">${Math.round(a)}°</text>
        <line x1="-30" y1="14" x2="-30" y2="26" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-10" y1="14" x2="-10" y2="26" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="10" y1="14" x2="10" y2="26" stroke="#8aa4b8" stroke-width="1.4"/>`);
    },
    update(g, comp) {
      const a = comp.props?.angle ?? 90;
      const horn = g.querySelector('g[transform]');
      if (horn) horn.setAttribute('transform', `rotate(${a - 90} 0 -4)`);
      const t = g.querySelector('.body text');
      if (t) t.textContent = `${Math.round(a)}°`;
    },
  },

  lcd1602: {
    name: 'LCD 1602 (I2C)', category: 'Модули', w: 160, h: 76,
    pins: () => [
      { id: 'GND', label: 'G', x: -45, y: -34, dir: 'up' },
      { id: 'VCC', label: 'V', x: -25, y: -34, dir: 'up' },
      { id: 'SDA', label: 'SDA', x: -5, y: -34, dir: 'up' },
      { id: 'SCL', label: 'SCL', x: 15, y: -34, dir: 'up' },
    ],
    render(comp) {
      const lines = comp.props?.lines || ['', ''];
      const on = comp.props?.backlight !== false;
      const row = (i) => `<text x="-64" y="${-9 + i * 14}" style="font:9px ui-monospace;fill:${on ? '#0a2b1d' : '#0d1712'};letter-spacing:.6px">${esc((lines[i] || '').padEnd(16).slice(0, 16)).replace(/ /g, '\u00a0')}</text>`;
      return partTag(comp, 160, 76, `
        <rect x="-72" y="-28" width="144" height="52" rx="3" fill="#0d3a1f" stroke="#1d6b38"/>
        <rect x="-68" y="-24" width="136" height="38" rx="2" fill="${on ? '#7ef29d' : '#3f7a52'}"/>
        ${row(0)}${row(1)}
        <text x="0" y="20" style="font:5px ui-monospace;fill:#6f9a7f;text-anchor:middle">1602 I2C</text>
        <line x1="-45" y1="-28" x2="-45" y2="-34" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-25" y1="-28" x2="-25" y2="-34" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-5" y1="-28" x2="-5" y2="-34" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="15" y1="-28" x2="15" y2="-34" stroke="#8aa4b8" stroke-width="1.4"/>`);
    },
    update() {},
  },

  oled: {
    name: 'OLED 128×64', category: 'Модули', w: 120, h: 92,
    pins: () => [
      { id: 'GND', label: 'G', x: -30, y: -42, dir: 'up' },
      { id: 'VCC', label: 'V', x: -10, y: -42, dir: 'up' },
      { id: 'SDA', label: 'SDA', x: 10, y: -42, dir: 'up' },
      { id: 'SCL', label: 'SCL', x: 30, y: -42, dir: 'up' },
    ],
    render(comp) {
      const lines = comp.props?.lines || [];
      const text = lines.slice(0, 8).map((l, i) =>
        `<text x="-46" y="${-27 + i * 7}" style="font:6.5px ui-monospace;fill:#9ad7ff">${esc(String(l).slice(0, 18))}</text>`).join('');
      return partTag(comp, 120, 92, `
        <rect x="-54" y="-38" width="108" height="76" rx="4" fill="#0a1220" stroke="#24405c"/>
        <rect x="-48" y="-32" width="96" height="58" rx="2" fill="#04121f"/>
        ${text}
        <text x="0" y="32" style="font:5px ui-monospace;fill:#4f7799;text-anchor:middle">SSD1306</text>
        <line x1="-30" y1="-38" x2="-30" y2="-42" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-10" y1="-38" x2="-10" y2="-42" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="10" y1="-38" x2="10" y2="-42" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="30" y1="-38" x2="30" y2="-42" stroke="#8aa4b8" stroke-width="1.4"/>`);
    },
    update() {},
  },

  buzzer: {
    name: 'Зуммер', category: 'Модули', w: 60, h: 46,
    pins: () => [
      { id: '1', label: '+', x: -22, y: 12, dir: 'left' },
      { id: '2', label: '−', x: 22, y: 12, dir: 'right' },
    ],
    render(comp) {
      return partTag(comp, 60, 46, `
        <line x1="-22" y1="12" x2="-14" y2="10" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="22" y1="12" x2="14" y2="10" stroke="#8aa4b8" stroke-width="1.4"/>
        <path d="M -14 10 a 14 14 0 0 1 28 0 z" fill="#2a3440" stroke="#46586a"/>
        <circle cx="0" cy="-2" r="3" fill="#0d141b"/>
        <text class="note" x="0" y="-16" style="font:8px ui-monospace;fill:#5a6b7d;text-anchor:middle">♪</text>`);
    },
    update(g, comp, env) {
      const n = g.querySelector('.note');
      if (n) n.setAttribute('fill', env.sounding ? '#ffd166' : '#5a6b7d');
    },
  },

  // ---------------------------------------------------- новые модули ----
  relay: {
    name: 'Модуль реле 5 В', category: 'Модули', w: 124, h: 84,
    pins: () => [
      { id: 'IN', label: 'IN', x: -48, y: 32, dir: 'down' },
      { id: 'VCC', label: '+', x: -32, y: 32, dir: 'down' },
      { id: 'GND', label: '−', x: -16, y: 32, dir: 'down' },
      { id: 'COM', label: 'COM', x: 16, y: 32, dir: 'down' },
      { id: 'NO', label: 'NO', x: 34, y: 32, dir: 'down' },
      { id: 'NC', label: 'NC', x: 52, y: 32, dir: 'down' },
    ],
    render(comp) {
      const on = !!comp.props?.energized;
      return partTag(comp, 124, 84, `
        <rect x="-60" y="-32" width="120" height="58" rx="3" fill="#123047" stroke="#24506e"/>
        <rect x="-52" y="-24" width="52" height="42" rx="2" fill="#1b4f8a" stroke="#2f74b8"/>
        <text x="-26" y="-8" style="font:7px ui-monospace;fill:#a9d4f5;text-anchor:middle">SRD</text>
        <text x="-26" y="2" style="font:6px ui-monospace;fill:#8fbde3;text-anchor:middle">05VDC</text>
        <text x="-26" y="12" style="font:5.6px ui-monospace;fill:#8fbde3;text-anchor:middle">10A 250V</text>
        <line x1="2" y1="-32" x2="2" y2="26" stroke="#3f6f92" stroke-width="1" stroke-dasharray="3 3"/>
        <text x="0" y="-34" style="font:5.4px ui-monospace;fill:#5f8ba8;text-anchor:middle">изоляция</text>
        <circle class="coil" cx="14" cy="-12" r="6" fill="none" stroke="#c98a3a" stroke-width="1.6"/>
        <text x="14" y="2" style="font:5.4px ui-monospace;fill:#c9a06a;text-anchor:middle">катушка</text>
        <g class="arm" transform="rotate(${on ? 12 : -12} 30 12)">
          <line x1="30" y1="12" x2="44" y2="12" stroke="#cfe6ff" stroke-width="2"/>
        </g>
        <circle cx="30" cy="12" r="2" fill="#cfdae4"/>
        <circle cx="44" cy="6" r="2" fill="#cfdae4"/>
        <circle cx="44" cy="20" r="2" fill="#cfdae4"/>
        <circle class="ind" cx="14" cy="-24" r="2.6" fill="${on ? '#ff5544' : '#4a2a2a'}"/>
        <text class="rl-state" x="34" y="-22" style="font:6px ui-monospace;fill:${on ? '#ffd166' : '#7d93a6'};text-anchor:middle">${on ? 'щёлк: NO' : 'покой: NC'}</text>`);
    },
    update(g, comp) {
      const on = !!comp.props?.energized;
      const arm = g.querySelector('.arm');
      if (arm) arm.setAttribute('transform', `rotate(${on ? 12 : -12} 30 12)`);
      const ind = g.querySelector('.ind');
      if (ind) ind.setAttribute('fill', on ? '#ff5544' : '#4a2a2a');
      const t = g.querySelector('.rl-state');
      if (t) { t.textContent = on ? 'щёлк: NO' : 'покой: NC'; t.setAttribute('fill', on ? '#ffd166' : '#7d93a6'); }
    },
  },

  joystick: {
    name: 'Джойстик KY-023', category: 'Модули', w: 108, h: 104,
    pins: () => [
      { id: 'GND', label: '−', x: -40, y: 46, dir: 'down' },
      { id: 'VCC', label: '+', x: -20, y: 46, dir: 'down' },
      { id: 'VRx', label: 'VRx', x: 0, y: 46, dir: 'down' },
      { id: 'VRy', label: 'VRy', x: 20, y: 46, dir: 'down' },
      { id: 'SW', label: 'SW', x: 40, y: 46, dir: 'down' },
    ],
    render(comp) {
      const x = comp.props?.x ?? 0, y = comp.props?.y ?? -0.35;
      const px = x * 22, py = -y * 22;
      const pressed = !!comp.props?.pressed;
      return partTag(comp, 108, 104, `
        <rect x="-50" y="-42" width="100" height="82" rx="4" fill="#1b2430" stroke="#33465a"/>
        <rect x="-38" y="-34" width="76" height="66" rx="3" fill="#141c26" stroke="#27384a"/>
        <g class="base">
          <path d="M -30 26 h 60 M -30 26 l 6 -4 M -30 26 l 6 4 M 30 26 l -6 -4 M 30 26 l -6 4"
                stroke="#2f4a63" stroke-width="1.2" fill="none"/>
          <path d="M 0 -30 v 60 M 0 -30 l -4 6 M 0 -30 l 4 6 M 0 30 l -4 -6 M 0 30 l 4 -6"
                stroke="#2f4a63" stroke-width="1.2" fill="none"/>
        </g>
        <g class="stick" transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">
          <circle cx="0" cy="0" r="15" fill="#0e1620" stroke="#3d5872" stroke-width="1.4"/>
          <circle cx="0" cy="0" r="${pressed ? 8 : 10}" fill="#2b3d4e" stroke="#5f7c8c"/>
          <circle cx="0" cy="0" r="4" fill="${pressed ? '#ffd166' : '#46586a'}"/>
        </g>
        <text class="js-vals" x="0" y="-34" style="font:6px ui-monospace;fill:#a8c0d2;text-anchor:middle">X ${x.toFixed(2)}  Y ${y.toFixed(2)}${pressed ? '  SW' : ''}</text>
        <rect data-role="stick" x="-46" y="-40" width="92" height="78" fill="transparent" style="cursor:move"/>`);
    },
    update(g, comp) {
      const x = comp.props?.x ?? 0, y = comp.props?.y ?? -0.35;
      const pressed = !!comp.props?.pressed;
      const st = g.querySelector('.stick');
      if (st) st.setAttribute('transform', `translate(${(x * 22).toFixed(1)} ${(-y * 22).toFixed(1)})`);
      const vals = g.querySelector('.js-vals');
      if (vals) vals.textContent = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}${pressed ? '  SW' : ''}`;
    },
  },

  stepper28byj: {
    name: 'Шаговый 28BYJ-48 + ULN2003', category: 'Модули', w: 150, h: 122,
    pins: () => [
      { id: 'IN1', label: 'IN1', x: -50, y: 58, dir: 'down' },
      { id: 'IN2', label: 'IN2', x: -30, y: 58, dir: 'down' },
      { id: 'IN3', label: 'IN3', x: -10, y: 58, dir: 'down' },
      { id: 'IN4', label: 'IN4', x: 10, y: 58, dir: 'down' },
      { id: 'VCC', label: '+', x: 30, y: 58, dir: 'down' },
      { id: 'GND', label: '−', x: 50, y: 58, dir: 'down' },
    ],
    render(comp) {
      const ph = comp.props?.phases || [false, false, false, false];
      const a = comp.props?.angle ?? 0;
      const leds = ph.map((on, i) => `
        <circle class="ph ph${i}" cx="${-40 + i * 11}" cy="20" r="3" fill="${on ? '#ff5544' : '#3d2a2a'}"/>`).join('');
      return partTag(comp, 150, 122, `
        <rect x="-70" y="-56" width="140" height="106" rx="4" fill="#123a2c" stroke="#22614a"/>
        <rect x="-64" y="-50" width="58" height="94" rx="3" fill="#155f47" stroke="#2b8f6a"/>
        <text x="-35" y="-38" style="font:6px ui-monospace;fill:#9fe0c4;text-anchor:middle">ULN2003</text>
        <rect x="-56" y="-30" width="42" height="26" rx="2" fill="#0d1712" stroke="#2b8f6a"/>
        <text x="-35" y="-14" style="font:5.4px ui-monospace;fill:#6fae92;text-anchor:middle">2003A</text>
        ${leds}
        <g class="motor" transform="translate(34 -6)">
          <circle r="30" fill="#9aa6b2" stroke="#6d7885" stroke-width="1.4"/>
          <circle r="23" fill="#b7c2cc" stroke="#8b97a3" stroke-width="1"/>
          <g class="shaft" transform="rotate(${a.toFixed(1)})">
            <rect x="-2.6" y="-28" width="5.2" height="22" rx="2" fill="#5f6b78"/>
            <rect x="-2.6" y="6" width="5.2" height="22" rx="2" fill="#5f6b78"/>
            <circle r="7" fill="#e6edf3" stroke="#8b97a3"/>
            <path d="M 0 -6 v -4" stroke="#c0392b" stroke-width="3"/>
          </g>
        </g>
        <text class="sp-vals" x="34" y="34" style="font:6px ui-monospace;fill:#9fe0c4;text-anchor:middle">${Math.round(a)}° / ${comp.props?.steps || 0} шаг.</text>`);
    },
    update(g, comp) {
      const ph = comp.props?.phases || [false, false, false, false];
      ph.forEach((on, i) => {
        const el = g.querySelector(`.ph${i}`);
        if (el) el.setAttribute('fill', on ? '#ff5544' : '#3d2a2a');
      });
      const a = comp.props?.angle ?? 0;
      const sh = g.querySelector('.shaft');
      if (sh) sh.setAttribute('transform', `rotate(${a.toFixed(1)})`);
      const t = g.querySelector('.sp-vals');
      if (t) t.textContent = `${Math.round(a)}° / ${comp.props?.steps || 0} шаг.`;
    },
  },
};


// ------------------------------------------------------------- питание ----
const POWER = {
  battery9: {
    name: 'Батарейка 9 В', category: 'Питание', w: 78, h: 66,
    pins: () => [
      { id: '+', label: '+', x: -20, y: 30, dir: 'down' },
      { id: '−', label: '−', x: 20, y: 30, dir: 'down' },
    ],
    render(comp) {
      const v = Number(comp.props?.voltage) || 9;
      return partTag(comp, 78, 66, `
        <line x1="-20" y1="30" x2="-20" y2="22" stroke="#c0392b" stroke-width="1.6"/>
        <line x1="20" y1="30" x2="20" y2="22" stroke="#8aa4b8" stroke-width="1.6"/>
        <rect x="-30" y="-26" width="60" height="48" rx="4" fill="#1b2430" stroke="#33465a"/>
        <rect x="-18" y="-32" width="16" height="8" rx="3" fill="#c0392b" stroke="#7d2b20"/>
        <rect x="4" y="-32" width="14" height="8" rx="3" fill="#c3ccd4" stroke="#7d93a6"/>
        <text x="0" y="-8" style="font:11px ui-monospace;fill:#ffd166;text-anchor:middle">${v.toFixed(1)} В</text>
        <text x="0" y="6" style="font:5.6px ui-monospace;fill:#8fbde3;text-anchor:middle">КРОНА / 6F22</text>
        <text x="0" y="16" style="font:5px ui-monospace;fill:#5f8ba8;text-anchor:middle">алкалиновая</text>`);
    },
    update() {},
  },

  batteryAA: {
    name: 'Отсек 4×AA', category: 'Питание', w: 132, h: 72,
    pins: () => [
      { id: '+', label: '+', x: -22, y: 32, dir: 'down' },
      { id: '−', label: '−', x: 22, y: 32, dir: 'down' },
    ],
    render(comp) {
      const v = Number(comp.props?.voltage) || 6;
      const cells = [-48, -24, 0, 24].map((x, i) => `
        <rect x="${x}" y="-30" width="18" height="38" rx="3" fill="#2a3440" stroke="#46586a"/>
        <rect x="${x + 6}" y="-34" width="6" height="5" rx="1.5" fill="#c3ccd4"/>
        <rect x="${x + 2}" y="-22" width="14" height="8" rx="1" fill="${i % 2 ? '#c0392b' : '#3d5a7a'}"/>
        <text x="${x + 9}" y="2" style="font:5px ui-monospace;fill:#7d93a6;text-anchor:middle">1,5</text>`).join('');
      return partTag(comp, 132, 72, `
        <rect x="-62" y="-40" width="124" height="70" rx="3" fill="#101820" stroke="#2b3945"/>
        ${cells}
        <text x="0" y="20" style="font:6px ui-monospace;fill:#ffd166;text-anchor:middle">${v.toFixed(1)} В = 4 × 1,5 В</text>
        <line x1="-22" y1="22" x2="-22" y2="32" stroke="#c0392b" stroke-width="1.6"/>
        <line x1="22" y1="22" x2="22" y2="32" stroke="#8aa4b8" stroke-width="1.6"/>`);
    },
    update() {},
  },

  psu: {
    name: 'Лабораторный источник', category: 'Питание', w: 126, h: 84,
    pins: () => [
      { id: '+', label: '+', x: -24, y: 38, dir: 'down' },
      { id: '−', label: '−', x: 0, y: 38, dir: 'down' },
    ],
    render(comp) {
      const v = Number(comp.props?.voltage) || 5;
      return partTag(comp, 126, 84, `
        <rect x="-58" y="-38" width="116" height="66" rx="4" fill="#151d26" stroke="#33465a"/>
        <rect x="-50" y="-32" width="62" height="26" rx="2" fill="#04121f" stroke="#24405c"/>
        <text class="psu-v" x="-19" y="-13" style="font:13px ui-monospace;fill:#7ef29d;text-anchor:middle">${v.toFixed(1)}</text>
        <text x="-19" y="-2" style="font:5px ui-monospace;fill:#4f7799;text-anchor:middle">ВОЛЬТ</text>
        <circle cx="34" cy="-18" r="11" fill="#2a3440" stroke="#46586a"/>
        <line class="psu-knob" x1="34" y1="-18" x2="${34 + 8 * Math.cos((v / 12) * 4.7 - 2.35)}" y2="${-18 + 8 * Math.sin((v / 12) * 4.7 - 2.35)}"
              stroke="#c3ccd4" stroke-width="2"/>
        <text x="34" y="2" style="font:5px ui-monospace;fill:#5f8ba8;text-anchor:middle">0…12 В</text>
        <text x="-30" y="16" style="font:5.4px ui-monospace;fill:#8fbde3;text-anchor:middle">выход DC</text>
        <line x1="-24" y1="28" x2="-24" y2="38" stroke="#c0392b" stroke-width="1.6"/>
        <line x1="0" y1="28" x2="0" y2="38" stroke="#8aa4b8" stroke-width="1.6"/>`);
    },
    update(g, comp) {
      const v = Number(comp.props?.voltage) || 5;
      const t = g.querySelector('.psu-v');
      if (t) t.textContent = v.toFixed(1);
      const k = g.querySelector('.psu-knob');
      if (k) {
        const a = (v / 12) * 4.7 - 2.35;
        k.setAttribute('x2', String(34 + 8 * Math.cos(a)));
        k.setAttribute('y2', String(-18 + 8 * Math.sin(a)));
      }
    },
  },

  scope: {
    name: 'Осциллограф', category: 'Приборы', w: 156, h: 112,
    pins: () => [
      { id: 'CH1', label: '1', x: -74, y: -18, dir: 'left' },
      { id: 'CH2', label: '2', x: -74, y: 8, dir: 'left' },
      { id: 'GND', label: '⊥', x: 0, y: 50, dir: 'down' },
    ],
    render(comp) {
      return partTag(comp, 156, 112, `
        <rect x="-74" y="-50" width="148" height="94" rx="4" fill="#1a222c" stroke="#3a4b5c"/>
        <rect x="-62" y="-42" width="112" height="66" rx="2" fill="#04121f" stroke="#24405c"/>
        <g class="grid" stroke="#12283a" stroke-width=".6">
          ${[-3, -2, -1, 0, 1, 2, 3].map((i) => `<line x1="${-62}" y1="${-9 + i * 8}" x2="${50}" y2="${-9 + i * 8}"/>`).join('')}
          ${[-5, -3, -1, 1, 3, 5].map((i) => `<line x1="${-6 + i * 9}" y1="-42" x2="${-6 + i * 9}" y2="24"/>`).join('')}
        </g>
        <polyline class="ch1" points="" fill="none" stroke="#ffd166" stroke-width="1.4"/>
        <polyline class="ch2" points="" fill="none" stroke="#5ad2ff" stroke-width="1.4"/>
        <text class="read" x="0" y="34" style="font:6px ui-monospace;fill:#8fbde3;text-anchor:middle">— нет сигнала</text>
        <text x="-34" y="34" style="font:5px ui-monospace;fill:#4f7799;text-anchor:middle">1</text>
        <text x="-34" y="26" style="font:6px ui-monospace;fill:#ffd166;text-anchor:middle">●</text>
        <text x="-20" y="34" style="font:5px ui-monospace;fill:#4f7799;text-anchor:middle">2</text>
        <text x="-14" y="26" style="font:6px ui-monospace;fill:#5ad2ff;text-anchor:middle">●</text>
        <line x1="-74" y1="-18" x2="-62" y2="-18" stroke="#8aa4b8" stroke-width="1.2"/>
        <line x1="-74" y1="8" x2="-62" y2="8" stroke="#8aa4b8" stroke-width="1.2"/>
        <line x1="0" y1="44" x2="0" y2="50" stroke="#8aa4b8" stroke-width="1.2"/>`);
    },
    update(g, comp) {
      const tr = comp.__trace || { ch1: [], ch2: [], max: 0 };
      const draw = (sel, arr) => {
        const el = g.querySelector(sel);
        if (!el) return;
        if (!arr || arr.length < 2) { el.setAttribute('points', ''); return; }
        const full = Math.max(5, tr.max || 5);
        const n = arr.length;
        const pts = arr.map((v, i) => {
          const x = -62 + (i / (n - 1)) * 112;
          const y = 12 - Math.max(-1, Math.min(1, (v || 0) / full)) * 48;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        el.setAttribute('points', pts.join(' '));
      };
      draw('.ch1', tr.ch1);
      draw('.ch2', tr.ch2);
      const read = g.querySelector('.read');
      if (read) {
        const a = tr.ch1?.length ? tr.ch1[tr.ch1.length - 1] : null;
        const b = tr.ch2?.length ? tr.ch2[tr.ch2.length - 1] : null;
        if (a === null && b === null) read.textContent = '— нет сигнала';
        else if (tr.ch1pwm) read.textContent = `ШИМ ${Math.round(tr.ch1pwm.duty * 100)}% · ${tr.ch1pwm.vcc.toFixed(1)} В · CH1`;
        else if (tr.ch2pwm) read.textContent = `ШИМ ${Math.round(tr.ch2pwm.duty * 100)}% · ${tr.ch2pwm.vcc.toFixed(1)} В · CH2`;
        else {
          const fmt = (v) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2));
          read.textContent = `${a === null ? '—' : fmt(a)} / ${b === null ? '—' : fmt(b)} В`;
        }
      }
    },
  },

  multimeter: {
    name: 'Мультиметр', category: 'Приборы', w: 152, h: 122,
    pins: () => [
      { id: 'COM', label: 'COM', x: -46, y: 60, dir: 'down' },
      { id: 'VΩ', label: 'VΩ', x: -10, y: 60, dir: 'down' },
      { id: 'mA', label: 'mA', x: 26, y: 60, dir: 'down' },
    ],
    render(comp) {
      return partTag(comp, 152, 122, `
        <rect x="-74" y="-56" width="148" height="108" rx="7" fill="#161f29" stroke="#33465a"/>
        <rect x="-74" y="-56" width="148" height="19" rx="7" fill="#1d2833" stroke="#33465a"/>
        <text x="-62" y="-43" style="font:6px ui-monospace;fill:#8fbde3;text-anchor:start">DIGITAL MULTIMETER</text>
        <text x="60" y="-43" style="font:5.5px ui-monospace;fill:#4f7799;text-anchor:end">DT-830</text>
        <rect x="-66" y="-32" width="88" height="46" rx="3" fill="#0b1a14" stroke="#2c5c46"/>
        <text class="mm-value" x="-22" y="-9" style="font:15px ui-monospace;fill:#7ef29d;text-anchor:middle">0.00</text>
        <text class="mm-sub" x="-22" y="4" style="font:5.5px ui-monospace;fill:#57a884;text-anchor:middle">В · DC</text>
        <circle cx="46" cy="-18" r="16" fill="#232f3a" stroke="#46586a"/>
        <circle cx="46" cy="-18" r="11" fill="#1a232c" stroke="#2f3f4d"/>
        <line class="mm-dial" x1="46" y1="-18" x2="46" y2="-29" stroke="#e6eef5" stroke-width="2"/>
        <circle data-role="knob" cx="46" cy="-18" r="17" fill="transparent" style="cursor:pointer"/>
        <text class="mm-mode" x="46" y="6" style="font:6px ui-monospace;fill:#ffd166;text-anchor:middle">V DC</text>
        <text x="46" y="14" style="font:4.6px ui-monospace;fill:#5f8ba8;text-anchor:middle">режим</text>
        <circle cx="-46" cy="44" r="4.5" fill="#0d141b" stroke="#8aa4b8"/>
        <circle cx="-10" cy="44" r="4.5" fill="#0d141b" stroke="#c0392b"/>
        <circle cx="26" cy="44" r="4.5" fill="#0d141b" stroke="#c0392b"/>
        <line x1="-46" y1="48" x2="-46" y2="60" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="-10" y1="48" x2="-10" y2="60" stroke="#c0392b" stroke-width="1.4"/>
        <line x1="26" y1="48" x2="26" y2="60" stroke="#c0392b" stroke-width="1.4"/>
        <text x="-74" y="52" style="font:4.4px ui-monospace;fill:#4f7799;text-anchor:start">CAT II 600V</text>`);
    },
    update(g, comp, env) {
      const info = env?.info || {};
      const mode = comp.props?.mode || 'V';
      const val = g.querySelector('.mm-value');
      const sub = g.querySelector('.mm-sub');
      const dial = g.querySelector('.mm-dial');
      const mlab = g.querySelector('.mm-mode');
      let main = '—';
      let subText = '';
      let warn = false;
      if (mode === 'A') {
        const i = Number(info.reading) || 0;
        if (info.overload) { main = '1L.'; subText = 'А · перегруз'; warn = true; }
        else if (i < 0.001) { main = (i * 1e6).toFixed(0); subText = 'мкА · DC'; }
        else if (i < 1) { main = (i * 1000).toFixed(1); subText = 'мА · DC'; }
        else { main = i.toFixed(2); subText = 'А · DC'; }
      } else if (mode === 'OHM' || mode === 'CONT') {
        const r = Number(info.resistance);
        if (!Number.isFinite(r) || r > 1e6) { main = '1L.'; subText = 'Ом · перегруз'; warn = true; }
        else if (r < 1000) { main = r.toFixed(1); subText = 'Ом'; }
        else { main = (r / 1000).toFixed(2); subText = 'кОм'; }
        if (mode === 'CONT') subText = (info.continuity ? 'ПИК · есть контакт' : 'обрыв') + '';
        if (info.busy) { subText += ' ⚠U'; warn = true; }
      } else {
        const v = Number(info.reading) || 0;
        main = v < 10 ? v.toFixed(2) : v.toFixed(1);
        subText = 'В · DC';
      }
      if (val) { val.textContent = main; val.setAttribute('fill', warn ? '#ff8a7a' : '#7ef29d'); }
      if (sub) sub.textContent = subText;
      if (dial) {
        const a = { V: -2.4, A: -0.9, OHM: 0.6, CONT: 2.1 }[mode] ?? -2.4;
        dial.setAttribute('x2', String(46 + 11 * Math.cos(a - Math.PI / 2)));
        dial.setAttribute('y2', String(-18 + 11 * Math.sin(a - Math.PI / 2)));
      }
      if (mlab) mlab.textContent = { V: 'V DC', A: 'A DC', OHM: 'Ω', CONT: 'ПИК' }[mode] || 'V DC';
    },
  },

  logicprobe: {
    name: 'Логический пробник', category: 'Приборы', w: 96, h: 118,
    pins: () => [
      { id: 'SIG', label: 'SIG', x: -48, y: -12, dir: 'left' },
      { id: 'GND', label: '⊥', x: 0, y: 52, dir: 'down' },
    ],
    render(comp) {
      return partTag(comp, 96, 118, `
        <rect x="-42" y="-46" width="84" height="92" rx="8" fill="#1b2430" stroke="#3a4b5c"/>
        <path d="M -42 -12 L -54 -12 L -54 -10 L -42 -10 Z" fill="#8aa4b8" stroke="#8aa4b8"/>
        <line x1="-48" y1="-12" x2="-42" y2="-12" stroke="#8aa4b8" stroke-width="1.6"/>
        <circle class="probe-led" cx="0" cy="-22" r="11" fill="#1e2a35" stroke="#4a5f72"/>
        <circle class="probe-core" cx="0" cy="-22" r="6" fill="#1e2a35"/>
        <text class="probe-text" x="0" y="4" style="font:8px ui-monospace;fill:#7d93a6;text-anchor:middle">LOW</text>
        <text class="probe-sub" x="0" y="17" style="font:5.5px ui-monospace;fill:#5f8ba8;text-anchor:middle">0.00 В</text>
        <text class="probe-freq" x="0" y="28" style="font:5.5px ui-monospace;fill:#ffd166;text-anchor:middle"></text>
        <line x1="0" y1="46" x2="0" y2="52" stroke="#8aa4b8" stroke-width="1.4"/>`);
    },
    update(g, comp, env) {
      const info = env?.info || {};
      const level = info.level || 'LOW';
      const led = g.querySelector('.probe-led');
      const core = g.querySelector('.probe-core');
      const txt = g.querySelector('.probe-text');
      const sub = g.querySelector('.probe-sub');
      const frq = g.querySelector('.probe-freq');
      const colors = { HIGH: '#ff5a4d', LOW: '#3fd07a', PULSE: '#ffd166', MID: '#ff9f43' };
      const c = colors[level] || '#7d93a6';
      if (led) { led.setAttribute('fill', c); led.setAttribute('opacity', '0.55'); }
      if (core) { core.setAttribute('fill', c); core.setAttribute('opacity', '0.95'); }
      if (txt) {
        txt.textContent = { HIGH: 'HIGH', LOW: 'LOW', PULSE: 'ИМП', MID: '??' }[level] || '—';
        txt.setAttribute('fill', c);
      }
      if (env?.level !== 'PULSE') {}
      if (sub) sub.textContent = `${(Number(info.voltage) || 0).toFixed(2)} В`;
      if (frq) {
        frq.textContent = level === 'PULSE'
          ? `≈${Math.round(info.freq || 490)} Гц · ${Math.round((info.duty || 0) * 100)} %`
          : '';
      }
    },
  },
};

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ------------------------------------------------------------- сборка ----
export const PARTS = { ...DISCRETE, ...MODULES, ...POWER };

for (const spec of Object.values(BOARDS)) {
  PARTS[spec.id] = {
    name: spec.name,
    category: 'Платы',
    w: spec.w,
    h: spec.h,
    board: true,
    spec,
    pins: () => spec.pins.filter((p) => !p.decor),   // служебные (EN, RUN) — только краска
    render: (comp) => renderBoard(comp, spec),
    update(g, comp, env) {
      const glow = g.querySelector('.builtin-glow');
      if (glow) glow.setAttribute('opacity', env.builtinOn ? '0.95' : '0');
    },
  };
}

export function fmtR(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(v % 1e6 ? 1 : 0)} МОм`;
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 ? 1 : 0)} кОм`;
  return `${Math.round(v)} Ом`;
}

export function pinWorld(comp, pinId) {
  const def = PARTS[comp.type];
  if (!def) return null;
  const p = def.pins(comp).find((q) => q.id === pinId);
  if (!p) return null;
  return { x: comp.x + p.x, y: comp.y + p.y, dir: p.dir, label: p.label };
}

export function allPins(comp) {
  return PARTS[comp.type].pins(comp).map((p) => ({
    ...p,
    compId: comp.id, pin: p.id, x: comp.x + p.x, y: comp.y + p.y,
  }));
}

export const BOARDS_LIST = Object.values(BOARDS);
