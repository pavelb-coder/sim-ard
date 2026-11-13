/**
 * board-art.js — «как в жизни»: текстолит, шелкография, разъёмы и чипы.
 *
 * Все размеры взяты из реальных чертежей, поэтому масштаб у плат общий:
 * PX_PER_MM пикселей на миллиметр. Рисуем в миллиметрах от левого верхнего
 * угла платы (y вниз), а переводим в координаты детали (центр — 0,0) через
 * X() и Y(), чтобы всё совпадало с выводами из boards.js.
 */

export const PX_PER_MM = 4;

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
    ${holes.map(([hx, hy, r = 4.6]) => `
      <circle cx="${hx}" cy="${hy}" r="${r}" fill="#0a1014" stroke="#9fb0bd" stroke-width="1.2"/>
      <circle cx="${hx}" cy="${hy}" r="${r * 0.45}" fill="#05090c"/>`).join('')}`;
}

/** Одна площадка гребёнки: чёрный пластик, золото, отверстие. */
function pad(x, y, { dir = 'up', depth = 6.5 } = {}) {
  const cy = dir === 'up' ? y + depth : y - depth;
  const half = 4.7;
  return `
    <rect x="${x - half}" y="${cy - 5}" width="${half * 2}" height="10" rx="1.1" fill="#0a0f14"/>
    <rect x="${x - half + 1.2}" y="${cy - 3.6}" width="${half * 2 - 2.4}" height="7.2" rx=".8"
          fill="none" stroke="#d4af37" stroke-width="1.1" opacity=".9"/>
    <circle cx="${x}" cy="${cy}" r="1.5" fill="#04080a"/>`;
}

/** Гребёнка: тёмная планка на всю длину ряда + площадки. */
function header(pins, { dir = 'up', w, h, depth = 6.5, band = 11.5 } = {}) {
  const row = pins.filter((p) => (dir === 'up' ? p.y < 0 : p.y > 0) && p.dir === dir);
  if (!row.length) return '';
  const xs = row.map((p) => p.x);
  const minX = Math.max(Math.min(...xs) - 6.5, -w / 2 + 4);
  const maxX = Math.min(Math.max(...xs) + 6.5, w / 2 - 4);
  const yEdge = dir === 'up' ? -h / 2 : h / 2;
  const bandY = dir === 'up' ? yEdge : yEdge - band;
  return `
    <rect x="${minX}" y="${bandY}" width="${maxX - minX}" height="${band}" rx="1.6"
          fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${row.map((p) => pad(p.x, p.y, { dir, depth })).join('')}`;
}

/** Корпус микросхемы: чёрный пластик, насечка, ножки, маркировка. */
function chip(x, y, w, h, label, sub = '', { legs = 14, silkSize = 5 } = {}) {
  const legStep = w / legs;
  const pins = [];
  for (let i = 0; i < legs / 2; i++) {
    const lx = x + legStep * (i + 0.5);
    pins.push(`<rect x="${lx - 1.2}" y="${y - 2.6}" width="2.4" height="3.2" fill="#b9c3cb"/>`);
    pins.push(`<rect x="${lx - 1.2}" y="${y + h - 0.6}" width="2.4" height="3.2" fill="#b9c3cb"/>`);
  }
  return `
    ${pins.join('')}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    <path d="M ${x + 4} ${y} a 4 4 0 0 0 0 ${Math.min(6, h * 0.3)}" fill="none" stroke="#0a0c0e" stroke-width="1.6"/>
    ${silk(label, x + w / 2, y + h / 2 + 1.8, { size: silkSize, fill: '#8d9aa6', family: 'ui-sans-serif,sans-serif' })}
    ${sub ? silk(sub, x + w / 2, y + h / 2 + 6.6, { size: 3.6, fill: '#5d6a75', family: 'ui-sans-serif,sans-serif' }) : ''}`;
}

/** Электролитический конденсатор. */
function capElectro(x, y, r = 7, label = '') {
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="#1d2730" stroke="#3a4a58" stroke-width="1"/>
    <path d="M ${x - r + 1.5} ${y} a ${r - 1.5} ${r - 1.5} 0 0 1 ${2 * r - 3} 0" fill="#2c3a46"/>
    <circle cx="${x}" cy="${y}" r="${r - 3.4}" fill="none" stroke="rgba(255,255,255,.14)"/>
    ${label ? silk(label, x, y + 2, { size: 3.8, fill: '#93a4b2' }) : ''}`;
}

/** Тактовая кнопка: металлический корпус и «пятак» сверху. */
function tactile(x, y, s = 13, label = '', { above = false } = {}) {
  const ly = above ? y - s / 2 - 3 : y + s / 2 + 6.5;
  return `
    <rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="1.6" fill="#454f59" stroke="#6c7883" stroke-width=".9"/>
    <circle cx="${x}" cy="${y}" r="${s * 0.28}" fill="#2a323a" stroke="#7b8894" stroke-width=".8"/>
    ${label ? silk(label, x, ly, { size: 4.4, fill: '#e8f2f4', opacity: 0.85 }) : ''}`;
}

/** Светодиод на плате + подпись рядом. */
function boardLed(x, y, color, label, { r = 3.4 } = {}) {
  return `
    <circle cx="${x}" cy="${y}" r="${r + 1.2}" fill="#0b1116" opacity=".6"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${color}" opacity=".92"/>
    <circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.42}" fill="rgba(255,255,255,.6)"/>
    ${label ? silk(label, x, y + r + 6.4, { size: 4.2, fill: '#e8f2f4', opacity: 0.8 }) : ''}`;
}

/** USB-разъём: металлический кожух и внутренняя колодка. */
function usb(x, y, w, h, { type = 'B' } = {}) {
  const kind = type === 'micro'
    ? `<rect x="${x + 3}" y="${y + h * 0.28}" width="${w - 6}" height="${h * 0.44}" rx="1.6" fill="#1b2026"/>`
    : `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="1.4" fill="#2a3138"/>
       <rect x="${x + 6}" y="${y + h * 0.34}" width="${w - 12}" height="${h * 0.32}" rx="1" fill="#0e1216"/>`;
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".9"/>
    <rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h * 0.3}" rx="1.6" fill="rgba(255,255,255,.45)"/>
    ${kind}`;
}

/** Разъём питания (бочонок) Arduino. */
function barrelJack(x, y, w, h) {
  return `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#14181d" stroke="#2b333b" stroke-width=".9"/>
    <rect x="${x + w - 8}" y="${y + 3}" width="5" height="${h - 6}" rx="1.4" fill="#222a32"/>
    <ellipse cx="${x + 6}" cy="${y + h / 2}" rx="4" ry="${h / 2 - 4}" fill="#0a0d10" stroke="#333c45"/>
    ${silk('9V', x + w / 2 + 1, y + h - 3, { size: 4, fill: '#8a97a2' })}`;
}

// ------------------------------------------------------------------ Uno ----
function paintUno(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  return `
    ${pcbBody(w, h, '#0b8f95', '#076a70', {
      radius: 8,
      holes: [[X(3.4), Y(3.6)], [X(65.2), Y(3.6)], [X(3.4), Y(49.7)], [X(65.2), Y(49.7)]],
    })}
    ${header(spec.pins, { dir: 'up', w, h })}
    ${header(spec.pins, { dir: 'down', w, h })}

    <!-- разъёмы: USB-B и питание -->
    ${usb(X(0.4) - 16, Y(4.8), 26, 56, { type: 'B' })}
    ${barrelJack(X(0.4) - 12, Y(22.5), 22, 52)}

    <!-- ATmega16U2 и его ICSP -->
    ${chip(X(15.6), Y(12.8), 32, 24, 'MEGA16U2', '', { legs: 8, silkSize: 3.6 })}
    ${[[15.75, 5.8], [18.29, 5.8], [20.83, 5.8], [15.75, 8.4], [18.29, 8.4], [20.83, 8.4]]
    .map(([mx, my]) => `<rect x="${X(mx) - 2.6}" y="${Y(my) - 2.6}" width="5.2" height="5.2" rx=".7"
      fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`).join('')}

    <!-- «мозг» платы -->
    ${chip(X(24.5), Y(26.5), 130, 30, 'ATmega328P', 'PU', { legs: 14, silkSize: 5.4 })}
    ${silk('16 MHz', X(16.6), Y(23.6), { size: 3.8, opacity: 0.7 })}
    <rect x="${X(12.4)}" y="${Y(25.4)}" width="26" height="16" rx="4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    <rect x="${X(14)}" y="${Y(27.4)}" width="20" height="12" rx="3" fill="#aab6bf"/>

    <!-- ICSP: 2×3 у правого края (его VCC — вывод 5V2) -->
    <rect x="${X(60.2)}" y="${Y(21.4)}" width="26" height="26" rx="1.4" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[[61.9, 23.3], [64.4, 23.3], [61.9, 25.8], [64.4, 25.8], [61.9, 28.3], [64.4, 28.3]]
    .map(([mx, my]) => `<rect x="${X(mx) - 2.6}" y="${Y(my) - 2.6}" width="5.2" height="5.2" rx=".7"
      fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`).join('')}
    ${silk('ICSP', X(63.2), Y(20.2), { size: 4.2, opacity: 0.8 })}
    ${pad(w / 2 - 5, Y(22.9), { dir: 'up' })}

    <!-- питание: стабилизатор и банки -->
    <rect x="${X(11.5)}" y="${Y(37)}" width="30" height="20" rx="1.2" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    ${silk('1117', X(15), Y(40.6), { size: 4, fill: '#8d9aa6' })}
    ${capElectro(X(24.5), Y(40), 8)}
    ${capElectro(X(31.5), Y(40), 6.5)}

    <!-- кнопка сброса и индикаторы -->
    ${tactile(X(13.4), Y(11.6), 12)}
    ${silk('RESET', X(13.4), Y(15.6), { size: 3.8, opacity: 0.85 })}
    ${boardLed(X(24.8), Y(15), '#ffd166', 'TX')}
    ${boardLed(X(24.8), Y(17.4), '#ffd166', 'RX')}
    ${boardLed(X(44.5), Y(40.2), '#7ef29d', 'ON')}
    <!-- встроенный светодиод на выводе 13 -->
    <g class="led-on">
      <circle cx="${X(25.4)}" cy="${Y(10.4)}" r="4.4" fill="#141b12" stroke="#2b3a24"/>
      <circle class="builtin-glow" cx="${X(25.4)}" cy="${Y(10.4)}" r="4.4" fill="#ffd166" opacity="0"/>
    </g>
    ${silk('L', X(25.4), Y(12.6), { size: 4.2, opacity: 0.85 })}

    <!-- шелкография -->${silkGroup(X, Y)}
    ${silk('ARDUINO', X(41), Y(19.4), { size: 8, weight: 700, spacing: 1.1, fill: '#f2fbfb' })}
    ${silk('UNO', X(41), Y(25.4), { size: 11, weight: 700, spacing: 2, fill: '#f2fbfb' })}
    <g opacity=".85" transform="translate(${X(52.6)} ${Y(22.4)})">
      <circle cx="0" cy="0" r="5" fill="none" stroke="#f2fbfb" stroke-width="1.7"/>
      <circle cx="9.4" cy="0" r="5" fill="none" stroke="#f2fbfb" stroke-width="1.7"/>
    </g>`;
}

function silkGroup(X, Y) {
  return `
    ${silk('DIGITAL (PWM~)', X(52.5), Y(11.4), { size: 4.8, opacity: 0.5 })}
    ${silk('POWER', X(36.5), Y(44.6), { size: 4.2, opacity: 0.5 })}
    ${silk('ANALOG IN', X(59.5), Y(44.6), { size: 4.2, opacity: 0.5 })}`;
}

// ---------------------------------------------------------------- ESP32 ----
function paintEsp32(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  return `
    ${pcbBody(w, h, '#1b222a', '#0c1116', { radius: 6 })}
    ${header(spec.pins, { dir: 'up', w, h })}
    ${header(spec.pins, { dir: 'down', w, h })}

    <!-- модуль ESP32-WROOM-32: экран и антенна на дальнем от USB краю -->
    <rect x="${X(31.4)}" y="${Y(4.2)}" width="${72}" height="${80}" rx="2" fill="#0f1418" stroke="#242c34" stroke-width=".9"/>
    <rect x="${X(32.6)}" y="${Y(5.2)}" width="${46}" height="${70}" rx="2" fill="#c8d0d7" stroke="#98a3ac" stroke-width=".9"/>
    <rect x="${X(32.6)}" y="${Y(5.2)}" width="${46}" height="${12}" rx="2" fill="rgba(255,255,255,.5)"/>
    <path d="M ${X(36.4)} ${Y(6.6)} v ${50} h ${5.6} v -${50}"
          fill="none" stroke="#b9c3cb" stroke-width="1.3" opacity=".5"/>
    ${silk('ESP32-WROOM-32', X(32.6) + 23, Y(11.4), { size: 4.4, weight: 700, fill: '#3b444c', family: 'ui-sans-serif,sans-serif' })}
    ${silk('FCC · 2.4 GHz', X(32.6) + 23, Y(13.8), { size: 3.2, fill: '#57626b', family: 'ui-sans-serif,sans-serif' })}
    <!-- полосковая антенна -->
    <g stroke="#c9a227" stroke-width="1.6" fill="none" stroke-linejoin="round">
      <path d="M ${X(43.4)} ${Y(6.4)} v ${14} h 1.8 v -${14} h 1.8 v ${14} h 1.8 v -${14} h 1.8 v ${14}"/>
    </g>

    <!-- USB и кнопки -->
    ${usb(X(0.3) - 10, Y(10.4), 18, 30, { type: 'micro' })}
    ${tactile(X(11.4), Y(9.4), 12, 'EN')}
    ${tactile(X(11.4), Y(17.4), 12, 'BOOT')}

    <!-- стабилизатор и индикаторы -->
    <rect x="${X(17.4)}" y="${Y(19.4)}" width="20" height="15" rx="1.2" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    ${silk('1117', X(19.8), Y(21.6), { size: 3.4, fill: '#8d9aa6' })}
    ${capElectro(X(17.8), Y(13.4), 5.5)}
    ${boardLed(X(24.6), Y(13.4), '#ff5544', 'PWR', { r: 2.8 })}
    <g class="led-on">
      <circle cx="${X(29.4)}" cy="${Y(13.4)}" r="4" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${X(29.4)}" cy="${Y(13.4)}" r="4" fill="#4ea3ff" opacity="0"/>
    </g>
    ${silk('D2', X(29.4), Y(17.6), { size: 3.8, opacity: 0.85 })}

    <!-- шелкография -->
    ${silk('ESP32 DEVKIT V1', X(21.5), Y(10.6), { size: 4.4, weight: 700, spacing: .6, fill: '#dfeaf2' })}`;
}

// ----------------------------------------------------------------- Pico ----
function paintPico(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  // зубчатые полуотверстия по краям — визитная карточка Pico
  const castellations = spec.pins.filter((p) => p.dir === 'up' || p.dir === 'down').map((p) => {
    const y = p.dir === 'up' ? -h / 2 : h / 2;
    return `<path d="M ${p.x - 3.6} ${y} a 3.6 3.6 0 0 1 7.2 0 z" fill="#c8b26a" opacity=".85"/>
            <circle cx="${p.x}" cy="${y}" r="1.6" fill="#0a1014"/>`;
  }).join('');
  return `
    ${pcbBody(w, h, '#0c3b2a', '#052018', { radius: 6 })}
    ${header(spec.pins, { dir: 'up', w, h })}
    ${header(spec.pins, { dir: 'down', w, h })}
    ${castellations}

    <!-- RP2040 -->
    ${chip(X(22.4), Y(8.2), 28, 26, 'RP2040', '', { legs: 12, silkSize: 4.2 })}

    <!-- обвязка -->
    <rect x="${X(37.6)}" y="${Y(9)}" width="15" height="8" rx="3.2" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    ${silk('12 MHz', X(40), Y(8.2), { size: 3.2, opacity: 0.55 })}
    ${capElectro(X(37.4), Y(15.4), 4.2)}
    ${capElectro(X(42.6), Y(15.4), 4.2)}

    <!-- USB -->
    ${usb(X(0.2) - 9, Y(7.2), 16, 27, { type: 'micro' })}

    <!-- BOOTSEL и отладочные площадки -->
    ${tactile(X(12.6), Y(15.4), 11, 'BOOTSEL', { above: true })}
    <rect x="${X(44.4)}" y="${Y(6.2)}" width="21" height="8" rx="1.2" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[0, 1, 2].map((i) => `<rect x="${X(45.4) + i * 6.4}" y="${Y(7)}" width="4.6" height="5.6" rx=".7"
      fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`).join('')}
    ${silk('DEBUG', X(47.4), Y(12), { size: 3.2, opacity: 0.7 })}

    <!-- встроенный светодиод (GP25) -->
    <g class="led-on">
      <circle cx="${X(8.6)}" cy="${Y(8.6)}" r="3.4" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${X(8.6)}" cy="${Y(8.6)}" r="3.4" fill="#7ef29d" opacity="0"/>
    </g>

    <!-- шелкография -->
    ${silk('Raspberry Pi Pico', X(15.4), Y(11.8), { size: 4.4, weight: 700, fill: '#eaf6ee', family: 'ui-sans-serif,sans-serif' })}`;
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
  const { h, pins } = spec;
  // отступ подписи от края: у Uno гребёнка стоит глубже, у Pico и ESP32 почти на краю
  const inset = spec.labelInset ?? 22;
  const size = h > 180 ? 5.8 : h > 100 ? 4.4 : 3.8;
  return pins.map((p) => {
    if (p.dir === 'right') {
      return silk(p.silk || p.label, spec.w / 2 - 14, p.y + 1.6, { size, rot: -90, fill: '#f4fbfb', opacity: 0.9, weight: 600 });
    }
    const up = p.y < 0;
    const y = up ? -h / 2 + inset : h / 2 - inset;
    return silk(p.silk || p.label, p.x, y, { size, rot: -90, fill: '#f4fbfb', opacity: 0.9, weight: 600 });
  }).join('');
}

export function renderBoardArt(spec) {
  const body = spec.id === 'uno' ? paintUno(spec)
    : spec.id === 'esp32' ? paintEsp32(spec)
      : spec.id === 'pico' ? paintPico(spec)
        : paintGeneric(spec);
  return body + pinLabels(spec);
}
