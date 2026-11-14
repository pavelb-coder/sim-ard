/**
 * realism.js — «как настоящее железо»: общие куски отрисовки деталей.
 *
 * Здесь нет ни физики, ни выводов — только тело детали: металл корпуса,
 * стекло светодиода, полоски на резисторе, ножки DIP-микросхемы. Градиенты
 * и фильтры объявлены один раз в index.html (`#sim-metal`, `#sim-glass` …),
 * поэтому деталь весит несколько сотен байт, а не килобайт.
 *
 * Координаты — как у всех деталей: (0,0) в центре, Y вниз.
 */

/** Полоски сопротивления по ГОСТ/МЭК: 4 полосы, как на настоящем резисторе. */
const BAND_COLORS = [
  ['чёрный', '#1b1b1b'], ['коричневый', '#6b3f1d'], ['красный', '#c0392b'],
  ['оранжевый', '#e07b23'], ['жёлтый', '#e8c531'], ['зелёный', '#2e9e4f'],
  ['синий', '#2f6fd0'], ['фиолетовый', '#8b4fc0'], ['серый', '#9aa4ad'], ['белый', '#eef2f5'],
];

/** Значение → четыре полосы (две цифры, множитель, допуск 5 %). */
export function resistorBands(ohms) {
  const v = Math.max(1, Math.round(Number(ohms) || 1));
  let exp = 0;
  let digits = v;
  while (digits >= 100 && exp < 9) { digits = Math.round(digits / 10); exp++; }
  if (digits >= 100) digits = 99;
  const d1 = Math.floor(digits / 10) % 10;
  const d2 = digits % 10;
  return [BAND_COLORS[d1][1], BAND_COLORS[d2][1], BAND_COLORS[Math.min(9, exp)][1], '#c9a227'];
}

/** Металлический вывод: цилиндр с блеском. */
export function lead(x1, x2, y = 0, width = 3.2) {
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="url(#sim-metal-h)"
    stroke-width="${width}" stroke-linecap="round"/>`;
}

/** Резистор: бежевый цилиндр, четыре полосы, металлические выводы. */
export function resistorBody({ value = 220, x1 = -18, x2 = 18 } = {}) {
  const [b1, b2, b3, b4] = resistorBands(value);
  const w = x2 - x1;
  const band = (at, color) => `<rect x="${x1 + w * at}" y="-7" width="${Math.max(2.2, w * 0.09)}" height="14"
      fill="${color}" opacity=".95"/>`;
  return `
    ${lead(x1 - 12, x1 + 1)}
    ${lead(x2 - 1, x2 + 12)}
    <rect x="${x1}" y="-7" width="${w}" height="14" rx="6" fill="url(#sim-beige)" stroke="#c9bda2" stroke-width=".7"/>
    <rect x="${x1 + 1}" y="-6" width="${w - 2}" height="4" rx="2" fill="rgba(255,255,255,.45)"/>
    ${band(0.13, b1)}${band(0.32, b2)}${band(0.52, b3)}${band(0.78, b4)}`;
}

/**
 * Светодиод 5 мм: прозрачный купол с плоской стороной катода, фланец-юбка,
 * внутри видны кристалл и перемычка. Свечение включается через lit (0…1).
 */
export function ledLens({ color = '#ff5544', r = 12, label = 'A→K', lit = 0 } = {}) {
  const R = r + 1.9;
  const fx = R * 0.68;                       // хорда — плоский край катода
  const fy = Math.sqrt(R * R - fx * fx);
  const rim = shade(color, -0.55);
  const glow = Math.max(0, Math.min(1, lit));
  const f = (v) => v.toFixed(1);
  return `
    <circle class="glow" cx="0" cy="0" r="${f(r * 2)}" fill="${color}" opacity="${(glow * 0.35).toFixed(2)}"/>
    <circle class="glow-core" cx="0" cy="0" r="${f(r * 1.25)}" fill="${color}" opacity="${(glow * 0.45).toFixed(2)}"/>
    <path d="M ${f(fx + 1.1)} ${f(-fy - 1.1)} A ${f(R + 1.1)} ${f(R + 1.1)} 0 1 0 ${f(fx + 1.1)} ${f(fy + 1.1)} Z"
          fill="rgba(208,222,234,.45)" stroke="rgba(150,166,180,.55)" stroke-width=".6"/>
    <path d="M ${f(fx)} ${f(-fy)} A ${f(R)} ${f(R)} 0 1 0 ${f(fx)} ${f(fy)} Z"
          fill="${shade(color, -0.2)}" opacity=".9"/>
    <circle class="lens-fill" cx="0" cy="0" r="${f(r)}" fill="${color}" opacity="${(0.34 + glow * 0.5).toFixed(2)}"/>
    <circle cx="0" cy="0" r="${f(r)}" fill="url(#sim-lens)" opacity=".55"/>
    <circle cx="0" cy="0" r="${f(r)}" fill="none" stroke="${rim}" stroke-width="1"/>
    <circle cx="0" cy="${f(r * 0.1)}" r="${f(r * 0.56)}" fill="${shade(color, glow > 0.02 ? 0.3 : -0.12)}" opacity=".38"/>
    <path d="M ${f(-r * 0.8)} ${f(r * 0.46)} A ${f(r)} ${f(r)} 0 0 0 ${f(r * 0.5)} ${f(r * 0.88)}"
          fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.6"/>
    <ellipse cx="${f(-r * 0.32)}" cy="${f(-r * 0.46)}" rx="${f(r * 0.34)}" ry="${f(r * 0.2)}"
             fill="rgba(255,255,255,.75)" transform="rotate(-32 ${f(-r * 0.32)} ${f(-r * 0.46)})"/>
    <path d="M ${f(-r * 0.8)} ${f(-r * 0.1)} A ${f(r * 0.82)} ${f(r * 0.82)} 0 0 1 ${f(r * 0.42)} ${f(-r * 0.7)}"
          fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>
    ${label ? `<text x="0" y="${f(r + 13)}" style="font:6px ui-monospace,monospace;fill:#7d93a6;text-anchor:middle">${label}</text>` : ''}`;
}

/** Электролитический конденсатор: алюминиевый стакан, насечка, полоса «−». */
export function electrolyticCan({ r = 13, text = '' } = {}) {
  // Полярный электролит: серебристая «банка», синяя полоса со стороны «−»,
  // крест-насечка на торце, маркировка прямо на корпусе.
  return `
    <circle cx="${r * 0.1}" cy="${r * 0.22}" r="${r}" fill="rgba(0,0,0,.5)" opacity=".5"/>
    <circle cx="0" cy="0" r="${r}" fill="url(#sim-can)" stroke="#5c6b78" stroke-width="1"/>
    <path d="M ${-r * 0.74} ${-r * 0.68} A ${r} ${r} 0 0 1 ${r * 0.74} ${-r * 0.68}"
          fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.6"/>
    <path d="M ${-r * 0.62} ${r * 0.78} A ${r} ${r} 0 0 0 ${r * 0.62} ${r * 0.78}"
          fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.8"/>
    <path d="M ${r * 0.5} ${-r * 0.85} A ${r} ${r} 0 0 1 ${r * 0.5} ${r * 0.85}" fill="none"
          stroke="#2f6fd0" stroke-width="${Math.max(2, r * 0.28)}" opacity=".85"/>
    <path d="M ${-r * 0.5} ${-r * 0.52} h ${r * 0.5} M ${-r * 0.25} ${-r * 0.77} v ${r * 0.5}"
          stroke="rgba(70,84,96,.42)" stroke-width="1" stroke-linecap="round"/>
    <text x="${-r - 4}" y="${-2}" style="font:7px ui-monospace,monospace;fill:#8fbde3;text-anchor:middle">+</text>
    ${text ? `<text x="0" y="${r * 0.56}" style="font:5.4px ui-monospace,monospace;fill:#33414d;text-anchor:middle;letter-spacing:.3px">${text}</text>` : ''}`;
}

/** Диод: стеклянная колба с тёмным кольцом катода. */
export function diodeBody({ x1 = -9, x2 = 9 } = {}) {
  // 1N4007: чёрный эпоксидный цилиндр, серебристое кольцо катода, блик сверху.
  const w = x2 - x1;
  return `
    <rect x="${x1 + .6}" y="-4" width="${w}" height="12" rx="6" fill="rgba(0,0,0,.4)"/>
    <rect x="${x1}" y="-7" width="${w}" height="14" rx="6" fill="url(#sim-dip)" stroke="#11161b" stroke-width="1"/>
    <rect x="${x2 - w * 0.3}" y="-6.4" width="${w * 0.16}" height="12.8" rx="1.6" fill="url(#sim-metal-h)"/>
    <path d="M ${x1 + 3} -4.6 H ${x2 - 4}" stroke="rgba(255,255,255,.28)" stroke-width="1.6" stroke-linecap="round"/>`;
}

/** Транзистор TO-92: пластиковый полукруг с плоской стороной и три ножки. */
export function to92({ label = '', sub = '' } = {}) {
  return `
    <path d="M -16 -14 A 20 20 0 0 1 -16 14 L -16 -14 Z" fill="none"/>
    <path d="M -14 -15 L 8 -15 A 17 17 0 0 1 8 15 L -14 15 Z" fill="url(#sim-plastic)" stroke="#2b3945" stroke-width="1"/>
    <rect x="-16" y="-15" width="6" height="30" rx="1" fill="#202a33" opacity=".9"/>
    <path d="M -8 -10 L 4 -10" stroke="rgba(255,255,255,.16)" stroke-width="2"/>
    ${[[-8, 'left'], [0, 'mid'], [8, 'right']].map(([x], i) => `<line x1="${x}" y1="14" x2="${x}" y2="${22 - i * 2}"
        stroke="url(#sim-metal-h)" stroke-width="2.6" stroke-linecap="round"/>`).join('')}
    ${label ? `<text x="0" y="-2" style="font:6px ui-monospace,monospace;fill:#b6c6d4;text-anchor:middle">${label}</text>` : ''}
    ${sub ? `<text x="0" y="6" style="font:4.6px ui-monospace,monospace;fill:#7d93a6;text-anchor:middle">${sub}</text>` : ''}`;
}

/** Мощный корпус TO-220: металлическая пластина-радиатор и три ножки. */
export function to220({ label = '' } = {}) {
  return `
    <rect x="-20" y="-24" width="40" height="34" rx="2" fill="url(#sim-metal)" stroke="#7d8790" stroke-width="1"/>
    <circle cx="0" cy="-14" r="4.6" fill="#0e1318" stroke="#98a4ae" stroke-width="1"/>
    <rect x="-15" y="-6" width="30" height="30" rx="2.4" fill="url(#sim-plastic)" stroke="#2b3945" stroke-width="1"/>
    ${[-9, 0, 9].map((x) => `<line x1="${x}" y1="22" x2="${x}" y2="30" stroke="url(#sim-metal-h)" stroke-width="2.8" stroke-linecap="round"/>`).join('')}
    ${label ? `<text x="0" y="14" style="font:6px ui-monospace,monospace;fill:#b6c6d4;text-anchor:middle">${label}</text>` : ''}`;
}

/** DIP-корпус: чёрный пластик, ключ-полукруг, ножки с двух сторон, маркировка. */
export function dipBody({ w = 60, h = 120, label = '', sub = '', legs = 8 } = {}) {
  const step = h / (legs + 1);
  const legsSvg = [];
  for (let i = 0; i < legs; i++) {
    const y = -h / 2 + step * (i + 1);
    legsSvg.push(`<rect x="${-w / 2 - 7}" y="${y - 1.6}" width="8" height="3.2" rx="1" fill="url(#sim-metal-h)"/>`);
    legsSvg.push(`<rect x="${w / 2 - 1}" y="${y - 1.6}" width="8" height="3.2" rx="1" fill="url(#sim-metal-h)"/>`);
  }
  return `
    ${legsSvg.join('')}
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="url(#sim-dip)" stroke="#0b0f13" stroke-width="1"/>
    <path d="M ${-w / 2 + 7} ${-h / 2} a 7 7 0 0 0 0 13" fill="none" stroke="#05080a" stroke-width="2.2"/>
    <circle cx="${-w / 2 + 7}" cy="${-h / 2 + 6.5}" r="2" fill="#05080a"/>
    <rect x="${-w / 2 + 3}" y="${-h / 2 + 12}" width="${w - 6}" height="1.2" fill="rgba(255,255,255,.07)"/>
    ${label ? `<text x="0" y="-6" style="font:8px ui-monospace,monospace;fill:#aebbc7;text-anchor:middle;letter-spacing:.4px">${label}</text>` : ''}
    ${sub ? `<text x="0" y="6" style="font:5.4px ui-monospace,monospace;fill:#6f7f8d;text-anchor:middle">${sub}</text>` : ''}`;
}

/** Навесной монтаж на макетке: зелёная плата с площадками. */
export function pcbModule({ w = 140, h = 100, holes = true } = {}) {
  return `
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="url(#sim-pcb-soft)" stroke="#0b3a25" stroke-width="1"/>
    ${holes ? [[-w / 2 + 7, -h / 2 + 7], [w / 2 - 7, -h / 2 + 7], [-w / 2 + 7, h / 2 - 7], [w / 2 - 7, h / 2 - 7]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" fill="#0a1218" stroke="#c9cfd6" stroke-width="1"/>`).join('') : ''}`;
}

/** Затемнить/осветлить цвет: shade('#ff5544', -0.5). */
export function shade(hex, k) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const to = (v) => {
    const n = parseInt(v, 16);
    const out = k < 0 ? Math.round(n * (1 + k)) : Math.round(n + (255 - n) * k);
    return Math.max(0, Math.min(255, out)).toString(16).padStart(2, '0');
  };
  return `#${to(m[1])}${to(m[2])}${to(m[3])}`;
}
