/**
 * board-art.js — «как в жизни»: текстолит, шелкография, разъёмы и чипы.
 *
 * Каждая плата рисуется отдельным художником, но из общих примитивов:
 * корпус (текстолит с фаской и крепёжными отверстиями), гребёнка выводов
 * (чёрный пластик + золотые площадки), микросхема, разъёмы, кнопки, светодиоды
 * и шелкография — белые надписи, как на настоящей плате.
 *
 * Координаты — в системе детали: (0,0) в центре, Y вниз (как в SVG).
 * Выводы платы лежат на границе корпуса, поэтому гребёнки рисуются «внутрь».
 */

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Надпись шелкографией. */
function silk(str, x, y, o = {}) {
  const {
    size = 6, weight = 400, fill = '#eef8f8', anchor = 'middle', rot = 0,
    opacity = 1, family = 'ui-monospace,SFMono-Regular,Menlo,monospace', spacing = 0,
  } = o;
  const tr = rot ? ` transform="rotate(${rot} ${x} ${y})"` : '';
  const st = [
    `font:${weight} ${size}px ${family}`,
    `fill:${fill}`,
    `text-anchor:${anchor}`,
    opacity !== 1 ? `opacity:${opacity}` : '',
    spacing ? `letter-spacing:${spacing}px` : '',
  ].filter(Boolean).join(';');
  return `<text x="${x}" y="${y}"${tr} style="${st}">${esc(str)}</text>`;
}

/** Текстолит: тело платы, фаска, внутренняя тень и крепёжные отверстия. */
function pcbBody(w, h, base, edge, { radius = 9, holes = [] } = {}) {
  const x = -w / 2, y = -h / 2;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${base}" stroke="${edge}" stroke-width="1.2"/>
    <rect x="${x + 2.5}" y="${y + 2.5}" width="${w - 5}" height="${h - 5}" rx="${radius - 2}"
          fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1"/>
    ${holes.map(([hx, hy]) => `
      <circle cx="${hx}" cy="${hy}" r="4.4" fill="#0a1014" stroke="#9fb0bd" stroke-width="1.3"/>
      <circle cx="${hx}" cy="${hy}" r="2.2" fill="#05090c"/>`).join('')}`;
}

/** Одна площадка гребёнки: чёрный пластик, золото, отверстие. */
function pad(x, y, { dir = 'up' } = {}) {
  const cy = dir === 'up' ? y + 6.5 : y - 6.5;   // центр площадки — внутри платы
  return `
    <rect x="${x - 4.6}" y="${cy - 5}" width="9.2" height="10" rx="1.1" fill="#0a0f14"/>
    <rect x="${x - 3.4}" y="${cy - 3.6}" width="6.8" height="7.2" rx=".8"
          fill="none" stroke="#d4af37" stroke-width="1.1" opacity=".9"/>
    <circle cx="${x}" cy="${cy}" r="1.6" fill="#04080a"/>`;
}

/** Гребёнка: тёмная планка на всю длину ряда + площадки. */
function header(pins, { dir = 'up', h = 160 } = {}) {
  const row = pins.filter((p) => (dir === 'up' ? p.y < 0 : p.y > 0));
  if (!row.length) return '';
  const xs = row.map((p) => p.x);
  const minX = Math.min(...xs) - 6.5;
  const maxX = Math.max(...xs) + 6.5;
  const yEdge = dir === 'up' ? -h / 2 : h / 2;
  const bandH = 13;
  const bandY = dir === 'up' ? yEdge : yEdge - bandH;
  return `
    <rect x="${minX}" y="${bandY}" width="${maxX - minX}" height="${bandH}" rx="1.6"
          fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${row.map((p) => pad(p.x, p.y, { dir })).join('')}`;
}

/** Корпус микросхемы: чёрный пластик, насечка, ножки, маркировка. */
function chip(x, y, w, h, label, sub = '', { legs = 14 } = {}) {
  const left = x, top = y;
  const legStep = w / legs;
  const pins = [];
  for (let i = 0; i < legs / 2; i++) {
    const lx = left + legStep * (i + 0.5);
    pins.push(`<rect x="${lx - 1.2}" y="${top - 2.6}" width="2.4" height="3.2" fill="#b9c3cb"/>`);
    pins.push(`<rect x="${lx - 1.2}" y="${top + h - 0.6}" width="2.4" height="3.2" fill="#b9c3cb"/>`);
  }
  return `
    ${pins.join('')}
    <rect x="${left}" y="${top}" width="${w}" height="${h}" rx="1.6" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    <path d="M ${left + 5} ${top} a 4 4 0 0 0 0 ${h * 0.28 > 7 ? 7 : h * 0.28}" fill="none" stroke="#0a0c0e" stroke-width="1.6"/>
    ${silk(label, left + w / 2 + 2, top + h / 2 + 1.6, { size: 5, fill: '#8d9aa6', family: 'ui-sans-serif,sans-serif' })}
    ${sub ? silk(sub, left + w / 2 + 2, top + h / 2 + 7.5, { size: 3.6, fill: '#5d6a75', family: 'ui-sans-serif,sans-serif' }) : ''}`;
}

/** Керамический конденсатор-«капля» и электролит. */
function capElectro(x, y, r = 7, label = '') {
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="#1d2730" stroke="#3a4a58" stroke-width="1"/>
    <path d="M ${x - r + 1.5} ${y} a ${r - 1.5} ${r - 1.5} 0 0 1 ${2 * r - 3} 0" fill="#2c3a46"/>
    <circle cx="${x}" cy="${y}" r="${r - 3.4}" fill="none" stroke="rgba(255,255,255,.14)"/>
    ${label ? silk(label, x, y + 2, { size: 3.8, fill: '#93a4b2' }) : ''}`;
}

/** Тактовая кнопка: металлический корпус и «пятак» сверху. */
function tactile(x, y, s = 13, label = '') {
  return `
    <rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="1.6" fill="#454f59" stroke="#6c7883" stroke-width=".9"/>
    <circle cx="${x}" cy="${y}" r="${s * 0.28}" fill="#2a323a" stroke="#7b8894" stroke-width=".8"/>
    ${label ? silk(label, x, y + s / 2 + 6, { size: 4.4, fill: '#e8f2f4', opacity: 0.85 }) : ''}`;
}

/** Светодиод на плате + подпись рядом. */
function boardLed(x, y, color, label, { r = 3.4, glow = false } = {}) {
  return `
    <circle cx="${x}" cy="${y}" r="${r + 1.2}" fill="#0b1116" opacity=".6"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity=".92"/>
    <circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.42}" fill="rgba(255,255,255,.6)"/>
    ${'' /* свечение встроенного светодиода — отдельный слой, см. parts.js */}
    ${label ? silk(label, x, y + r + 6.4, { size: 4.2, fill: '#e8f2f4', opacity: 0.8 }) : ''}`;
}

/** USB-разъём: металлический кожух и внутренняя колодка. */
function usb(x, y, w, h, { type = 'B' } = {}) {
  const kind = type === 'micro'
    ? `<rect x="${x + 3}" y="${y + h * 0.28}" width="${w - 6}" height="${h * 0.44}" rx="1.6" fill="#1b2026"/>`
    : `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="1.4" fill="#2a3138"/>
       <rect x="${x + 7}" y="${y + h * 0.34}" width="${w - 14}" height="${h * 0.32}" rx="1" fill="#0e1216"/>`;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".9"/>
    <rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h * 0.32}" rx="1.6" fill="rgba(255,255,255,.45)"/>
    ${kind}`;
}

/** Разъём питания (бочонок) Arduino. */
function barrelJack(x, y, w, h) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#14181d" stroke="#2b333b" stroke-width=".9"/>
    <rect x="${x + w - 9}" y="${y + 3}" width="6" height="${h - 6}" rx="1.4" fill="#222a32"/>
    <ellipse cx="${x + 7}" cy="${y + h / 2}" rx="4.4" ry="${h / 2 - 4}" fill="#0a0d10" stroke="#333c45"/>
    ${silk('9V', x + w / 2 + 2, y + h - 3, { size: 4, fill: '#8a97a2' })}`;
}

// ------------------------------------------------------------------ Uno ----
function paintUno(spec) {
  const { w, h } = spec;
  const top = spec.pins.filter((p) => p.y < 0);
  const bottom = spec.pins.filter((p) => p.y > 0);
  return `
    ${pcbBody(w, h, '#0b8f95', '#076a70', { holes: [[-120, -58], [120, -58], [-120, 58], [120, 58]] })}
    ${header(top, { dir: 'up', h })}
    ${header(bottom, { dir: 'down', h })}

    <!-- разъёмы -->
    ${usb(-w / 2 - 1, -46, 26, 40, { type: 'B' })}
    ${barrelJack(-w / 2 - 3, 26, 13, 36)}

    <!-- «мозг» платы -->
    ${chip(-74, -30, 62, 26, 'ATmega328P', 'PU', { legs: 14 })}
    ${silk('16 MHz', 14, -18, { size: 4.4, opacity: 0.75 })}
    <rect x="2" y="-28" width="24" height="12" rx="5" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    <rect x="5" y="-25" width="18" height="6" rx="3" fill="#aab6bf"/>

    <!-- ICSP -->
    <rect x="94" y="-44" width="26" height="18" rx="1.4" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[0, 1, 2].flatMap((cx) => [0, 1].map((cy) => `
      <rect x="${98 + cx * 7}" y="${-40 + cy * 8}" width="5.4" height="6" rx=".8" fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`)).join('')}
    ${silk('ICSP', 107, -48, { size: 4.2, opacity: 0.8 })}

    <!-- питание и стабилизатор -->
    ${capElectro(60, -2, 7, '470')}
    ${capElectro(80, -2, 7, '100')}
    <rect x="98" y="6" width="20" height="14" rx="1.2" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    ${silk('1117', 108, 15.5, { size: 4, fill: '#8d9aa6' })}

    <!-- кнопка сброса и индикаторы -->
    ${tactile(-84, -44, 13, 'RESET')}
    ${boardLed(-88, 14, '#7ef29d', 'ON')}
    ${boardLed(-76, 14, '#ffd166', 'TX')}
    ${boardLed(-64, 14, '#ffd166', 'RX')}
    <g class="led-on">
      <circle cx="${spec.led.x}" cy="${spec.led.y}" r="4.6" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${spec.led.x}" cy="${spec.led.y}" r="4.6" fill="#ffd166" opacity="0"/>
    </g>
    ${silk('L', spec.led.x, spec.led.y + 10.5, { size: 4.2, opacity: 0.85 })}

    <!-- шелкография -->
    ${silk('DIGITAL (PWM ~)', -22, -42, { size: 5, opacity: 0.55 })}
    ${silk('POWER', 40, -42, { size: 5, opacity: 0.55 })}
    ${silk('ARDUINO', -30, 34, { size: 9, weight: 700, spacing: 1.2, fill: '#f2fbfb' })}
    ${silk('UNO', -46, 50, { size: 12, weight: 700, spacing: 2, fill: '#f2fbfb' })}
    <g opacity=".9" transform="translate(38 40)">
      <circle cx="0" cy="0" r="5.2" fill="none" stroke="#f2fbfb" stroke-width="1.8"/>
      <circle cx="9.6" cy="0" r="5.2" fill="none" stroke="#f2fbfb" stroke-width="1.8"/>
    </g>`;
}

// ---------------------------------------------------------------- ESP32 ----
function paintEsp32(spec) {
  const { w, h } = spec;
  const top = spec.pins.filter((p) => p.y < 0);
  const bottom = spec.pins.filter((p) => p.y > 0);
  return `
    ${pcbBody(w, h, '#1b222a', '#0c1116', { holes: [[-116, -62], [116, -62], [-116, 62], [116, 62]] })}
    ${header(top, { dir: 'up', h })}
    ${header(bottom, { dir: 'down', h })}

    <!-- модуль ESP32-WROOM-32 с экраном и антенной -->
    <rect x="-58" y="-46" width="116" height="56" rx="2" fill="#0f1418" stroke="#242c34" stroke-width=".9"/>
    <!-- антенна: меандр на верхней кромке модуля -->
    <path d="M -26 -43 h 9 v 6 h 9 v -6 h 9 v 6 h 9 v -6 h 9"
          fill="none" stroke="#c9a227" stroke-width="1.7" stroke-linejoin="round"/>
    <rect x="-54" y="-34" width="108" height="32" rx="2" fill="#c8d0d7" stroke="#98a3ac" stroke-width=".9"/>
    <rect x="-54" y="-34" width="108" height="8" rx="2" fill="rgba(255,255,255,.5)"/>
    <g stroke="#8e99a2" stroke-width=".7" opacity=".7">
      ${Array.from({ length: 7 }, (_, i) => `<line x1="${-50 + i * 16}" y1="-32" x2="${-50 + i * 16}" y2="-4"/>`).join('')}
      ${Array.from({ length: 3 }, (_, i) => `<line x1="-54" y1="${-26 + i * 8}" x2="54" y2="${-26 + i * 8}"/>`).join('')}
    </g>
    ${silk('ESP32-WROOM-32', 0, -15, { size: 5.6, weight: 700, fill: '#3b444c', family: 'ui-sans-serif,sans-serif' })}
    ${silk('FCC · 2.4 GHz', 0, -7, { size: 4, fill: '#57626b', family: 'ui-sans-serif,sans-serif' })}
    <!-- ножки модуля -->
    ${Array.from({ length: 15 }, (_, i) => `<rect x="${-52 + i * 7.4}" y="6" width="4" height="4" fill="#b9c3cb"/>`).join('')}

    <!-- USB и кнопки -->
    ${usb(-w / 2 - 1, -16, 24, 30, { type: 'micro' })}
    ${tactile(-84, 32, 13, 'EN')}
    ${tactile(-64, 32, 13, 'BOOT')}

    <!-- светодиоды -->
    ${boardLed(-40, 18, '#ff5544', 'PWR')}
    <g class="led-on">
      <circle cx="${spec.led.x}" cy="${spec.led.y}" r="4.6" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${spec.led.x}" cy="${spec.led.y}" r="4.6" fill="#4ea3ff" opacity="0"/>
    </g>
    ${silk('D2', spec.led.x, spec.led.y + 10.5, { size: 4.2, opacity: 0.85 })}

    <!-- стабилизатор -->
    <rect x="62" y="12" width="18" height="13" rx="1.2" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    ${silk('1117', 71, 21, { size: 3.8, fill: '#8d9aa6' })}
    ${capElectro(52, 30, 6)}
    ${capElectro(90, 30, 6)}

    <!-- шелкография -->
    ${silk('ESP32 DEVKIT V1', 0, 50, { size: 6.6, weight: 700, spacing: 1.1, fill: '#dfeaf2' })}
    ${silk('30 pin · 2.4 GHz', 0, 41, { size: 4.2, opacity: 0.45 })}`;
}

// ----------------------------------------------------------------- Pico ----
function paintPico(spec) {
  const { w, h } = spec;
  const top = spec.pins.filter((p) => p.y < 0);
  const bottom = spec.pins.filter((p) => p.y > 0);
  // зубчатые полуотверстия по краям — визитная карточка Pico
  const castellations = (pins, dir) => pins.map((p) => {
    const y = dir === 'up' ? -h / 2 : h / 2;
    return `<path d="M ${p.x - 4} ${y} a 4 4 0 0 1 8 0 z" fill="#c8b26a" opacity=".85"/>
            <circle cx="${p.x}" cy="${y}" r="2" fill="#0a1014"/>`;
  }).join('');
  return `
    ${pcbBody(w, h, '#0c3b2a', '#052018', { radius: 7, holes: [[-102, -50], [102, -50], [-102, 50], [102, 50]] })}
    ${castellations(top, 'up')}
    ${castellations(bottom, 'down')}
    ${header(top, { dir: 'up', h })}
    ${header(bottom, { dir: 'down', h })}

    <!-- RP2040 -->
    ${chip(-17, -14, 34, 30, 'RP2040', '', { legs: 14 })}
    <circle cx="-17" cy="-8" r="1.5" fill="#3d4750"/>

    <!-- кварц и обвязка -->
    <rect x="24" y="-12" width="20" height="10" rx="4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    ${silk('12 MHz', 34, 4, { size: 3.8, opacity: 0.6 })}
    ${capElectro(52, 14, 5.5)}
    ${capElectro(66, 14, 5.5)}

    <!-- USB -->
    ${usb(-w / 2 - 1, -18, 24, 34, { type: 'micro' })}

    <!-- BOOTSEL и отладочные площадки -->
    ${tactile(-62, 34, 12, 'BOOTSEL')}
    <rect x="58" y="26" width="34" height="12" rx="1.4" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[0, 1, 2].map((i) => `<rect x="${61 + i * 11}" y="29" width="6.5" height="6" rx=".8" fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`).join('')}
    ${silk('DEBUG', 75, 22, { size: 4, opacity: 0.75 })}

    <!-- индикатор -->
    <g class="led-on">
      <circle cx="${spec.led.x}" cy="${spec.led.y}" r="4.2" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${spec.led.x}" cy="${spec.led.y}" r="4.2" fill="#7ef29d" opacity="0"/>
    </g>
    ${silk('LED', spec.led.x, spec.led.y + 10, { size: 3.8, opacity: 0.8 })}

    <!-- шелкография -->
    ${silk('Raspberry Pi', 0, 36, { size: 7, weight: 700, fill: '#eaf6ee', family: 'ui-sans-serif,sans-serif' })}
    ${silk('Pico', 0, 49, { size: 9, weight: 700, spacing: 2.4, fill: '#eaf6ee', family: 'ui-sans-serif,sans-serif' })}`;
}

// -------------------------------------------------------------- заглушка ----
function paintGeneric(spec) {
  const { w, h } = spec;
  return `
    ${pcbBody(w, h, spec.body?.[1] || '#12222c', 'rgba(0,0,0,.5)')}
    ${silk(spec.short.toUpperCase(), 0, 2, { size: 10, weight: 700 })}
    ${silk(spec.chip || '', 0, 12, { size: 5, opacity: 0.6 })}`;
}

/** Подписи выводов — как белая краска на текстолите, вдоль площадок. */
function pinLabels(spec) {
  const { h } = spec;
  return spec.pins.map((p) => {
    const top = p.y < 0;
    const y = top ? -h / 2 + 23 : h / 2 - 23;
    const size = p.label.length > 3 ? 5.4 : 6.2;
    return silk(p.label, p.x, y, {
      size, rot: -90, fill: '#f4fbfb', opacity: 0.9, weight: 600,
    });
  }).join('');
}

export function renderBoardArt(spec) {
  const body = spec.id === 'uno' ? paintUno(spec)
    : spec.id === 'esp32' ? paintEsp32(spec)
      : spec.id === 'pico' ? paintPico(spec)
        : paintGeneric(spec);
  return body + pinLabels(spec);
}

/** Позиции встроенных светодиодов — их же использует boards.js. */
export const BOARD_LED = {
  uno: { x: -52, y: 14 },
  esp32: { x: -24, y: 18 },
  pico: { x: -60, y: 8 },
};
