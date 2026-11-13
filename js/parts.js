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
  uno: 'Arduino Uno', esp32: 'ESP32 DevKit V1', pico: 'Raspberry Pi Pico',
};

export const REF_PREFIX = {
  led: 'D', resistor: 'R', capacitor: 'C', electrolytic: 'C', inductor: 'L', button: 'S',
  pot: 'RV', servo: 'M', lcd1602: 'LCD', oled: 'DS', buzzer: 'BZ', ldr: 'R', pir: 'PIR',
  dht11: 'DHT', hcsr04: 'SR', uno: 'A', esp32: 'A', pico: 'A',
};

/** Подпись под деталью: «R1 · резистор», «A1 · Arduino Uno». */
function partLabel(comp, type) {
  const name = SHORT_NAME[type] || comp.__def?.name || type;
  return comp.ref ? `${comp.ref} · ${name}` : name;
}

const partTag = (comp, w, h, body, extra = '') => {
  const label = partLabel(comp, comp.type);
  // подпись — «шильдик» под деталью: провода проходят под ним и не рвут текст
  const tw = Math.round(label.length * 3.5 + 12);
  return `<g class="part" data-id="${comp.id}">
     <rect class="hit" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="transparent"/>
     <g class="body">${body}</g>${extra}
     <rect class="part-tag" x="${-tw / 2}" y="${h / 2 + 12}" width="${tw}" height="14" rx="7"
           fill="#0c141b" stroke="#22323f" stroke-width=".8"/>
     <text class="part-label" x="0" y="${h / 2 + 22}"
           style="font:6px ui-monospace,monospace;fill:#9db2c5;text-anchor:middle;pointer-events:none">${esc(label)}</text>
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
        <rect x="-22" y="-20" width="44" height="40" rx="3" fill="#1b3a5c" stroke="#2c5c8a"/>
        <rect x="-16" y="-14" width="32" height="14" rx="1" fill="#0d2233"/>
        <text x="0" y="9" style="font:6px ui-monospace;fill:#a9d4f5;text-anchor:middle">${t.toFixed(0)}°C ${h.toFixed(0)}%</text>
        <line x1="-20" y1="20" x2="-20" y2="22" stroke="#8aa4b8" stroke-width="1.4"/>
        <line x1="20" y1="20" x2="20" y2="22" stroke="#8aa4b8" stroke-width="1.4"/>`);
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
};

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ------------------------------------------------------------- сборка ----
export const PARTS = { ...DISCRETE, ...MODULES };

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
    compId: comp.id, pin: p.id, x: comp.x + p.x, y: comp.y + p.y, dir: p.dir, label: p.label,
  }));
}

export const BOARDS_LIST = Object.values(BOARDS);
