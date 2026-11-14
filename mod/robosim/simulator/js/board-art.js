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

/**
 * «Рассыпь» мелочи по текстолиту: SMD-конденсаторы, резисторы и переходные
 * отверстия. Позиции детерминированные (линейный конгруэнтный генератор от
 * размеров платы), поэтому плата выглядит одинаково при каждой перерисовке.
 *
 * Слой рисуется до крупных деталей: те, что окажутся сверху, просто закроют
 * мелочь — как на настоящей плате.
 */
function smdField(w, h, seed = 1) {
  let st = (seed * 2654435761) >>> 0 || 12345;
  const rnd = () => {
    st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
    return st / 4294967296;
  };
  const out = [];
  const n = Math.min(220, Math.round((w * h) / 1150));
  // по краям платы идут гребёнки и их подписи — там место оставляем свободным
  const mx = 20, my = 38;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + mx + rnd() * (w - mx * 2);
    const y = -h / 2 + my + rnd() * (h - my * 2);
    const t = rnd();
    const vert = rnd() < 0.45;
    const rot = vert ? ` transform="rotate(90 ${x.toFixed(1)} ${y.toFixed(1)})"` : '';
    if (t < 0.34) {
      // керамический конденсатор 0603: светлый корпус и металлические торцы
      out.push(`<g${rot}>
        <rect x="${x - 3.4}" y="${y - 1.8}" width="6.8" height="3.6" rx=".7" fill="#b8a179" stroke="#8a7754" stroke-width=".35"/>
        <rect x="${x - 3.4}" y="${y - 1.8}" width="1.7" height="3.6" fill="#c9d1d8"/>
        <rect x="${x + 1.7}" y="${y - 1.8}" width="1.7" height="3.6" fill="#aab4bd"/>
        <rect x="${x - 1.1}" y="${y - 1.4}" width="2.2" height="1" rx=".5" fill="rgba(255,255,255,.35)"/>
      </g>`);
    } else if (t < 0.66) {
      // резистор 0603: чёрный корпус с маркировкой
      out.push(`<g${rot}>
        <rect x="${x - 3.4}" y="${y - 1.7}" width="6.8" height="3.4" rx=".6" fill="#171b20" stroke="#0b0e12" stroke-width=".3"/>
        <rect x="${x - 3.4}" y="${y - 1.7}" width="1.5" height="3.4" fill="#b9c2ca"/>
        <rect x="${x + 1.9}" y="${y - 1.7}" width="1.5" height="3.4" fill="#9ea8b2"/>
        <rect x="${x - 1.2}" y="${y - .9}" width="2.4" height="1.8" rx=".4" fill="#2c333a"/>
      </g>`);
    } else if (t < 0.86) {
      // переходное отверстие с золотым ободком
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.9" fill="url(#sim-gold)" opacity=".9"/>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".95" fill="#080c10"/>`);
    } else {
      // транзистор SOT-23: тёмный корпус с тремя ножками
      out.push(`<g${rot}>
        <rect x="${x - 2.6}" y="${y - 2}" width="5.2" height="4" rx=".5" fill="#1b2027" stroke="#0c1014" stroke-width=".3"/>
        <rect x="${x - 2.2}" y="${y + 2}" width="1.2" height="1.4" fill="#c2cbd3"/>
        <rect x="${x + .5}" y="${y + 2}" width="1.2" height="1.4" fill="#c2cbd3"/>
        <rect x="${x - 2.2}" y="${y - 3.4}" width="1.2" height="1.4" fill="#c2cbd3"/>
      </g>`);
    }
  }
  return out.join('');
}

/**
 * Текстолит: тело платы, фаска, стеклотекстолит, дорожки под маской
 * и крепёжные отверстия.
 *
 * Слои снизу вверх: срез текстолита (чуть светлее корпуса), сама плата,
 * ткань стеклотекстолита (две диагональные сетки), дорожки под зелёной
 * маской, свет сверху-слева и затемнение к нижнему краю, фаска и отверстия.
 */
function pcbBody(w, h, base, edge, { radius = 9, holes = [], seed = 0 } = {}) {
  const x = -w / 2, y = -h / 2;
  return `
    <rect x="${x - 1.1}" y="${y - 1.1}" width="${w + 2.2}" height="${h + 2.2}" rx="${radius + 1}"
          fill="#3f8a63" opacity=".55" filter="url(#sim-raise-big)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${base}" stroke="${edge}" stroke-width="1.2"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="url(#sim-traces)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="url(#sim-traces2)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="url(#sim-fiber)"/>
    ${smdField(w, h, seed || Math.round(w * 7 + h * 13))}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="url(#sim-face-light)"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="url(#sim-gloss)"/>
    <rect x="${x + 2.5}" y="${y + 2.5}" width="${w - 5}" height="${h - 5}" rx="${radius - 2}"
          fill="none" stroke="rgba(255,255,255,.10)" stroke-width="1"/>
    ${holes.map(([hx, hy, r = 4.6]) => `
      <circle cx="${hx}" cy="${hy}" r="${r}" fill="url(#sim-drill)" stroke="#9fb0bd" stroke-width="1.2"/>
      <circle cx="${hx}" cy="${hy}" r="${r * 0.45}" fill="#05090c"/>
      <path d="M ${hx - r * 0.75} ${hy - r * 0.55} a ${r} ${r} 0 0 1 ${r * 1.5} 0"
            fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>`).join('')}`;
}

/** Одна площадка гребёнки: чёрный пластик, золото, отверстие — по центру вывода. */
function pad(x, y) {
  const half = 4.7;
  return `
    <rect x="${x - half}" y="${y - 5}" width="${half * 2}" height="10" rx="1.1" fill="#0a0f14"/>
    <rect x="${x - half + .9}" y="${y - 4.1}" width="${half * 2 - 1.8}" height="8.2" rx="1"
          fill="url(#sim-gold)" opacity=".95"/>
    <rect x="${x - half + .9}" y="${y - 4.1}" width="${half * 2 - 1.8}" height="8.2" rx="1"
          fill="none" stroke="rgba(255,244,200,.35)" stroke-width=".6"/>
    <rect x="${x - half + 1.5}" y="${y - 3.5}" width="${half * 2 - 3}" height="2.6" rx=".8"
          fill="rgba(255,255,255,.4)"/>
    <circle cx="${x}" cy="${y}" r="1.85" fill="url(#sim-drill)"/>
    <circle cx="${x}" cy="${y}" r="1.85" fill="none" stroke="rgba(255,240,190,.5)" stroke-width=".7"/>`;
}

/**
 * Отдельная контактная площадка: чёрный пластик вокруг, золото с бликом,
 * сверление и галтель припоя. По ней видно, что на плате есть отверстие,
 * а не «золотой квадратик».
 */
function goldPad(cx, cy, s = 6.2) {
  const h = s / 2;
  return `
    <rect x="${cx - h}" y="${cy - h}" width="${s}" height="${s}" rx=".9" fill="#0a0f14"/>
    <rect x="${cx - h + .8}" y="${cy - h + .8}" width="${s - 1.6}" height="${s - 1.6}" rx=".7"
          fill="url(#sim-gold)" opacity=".96"/>
    <rect x="${cx - h + .8}" y="${cy - h + .8}" width="${s - 1.6}" height="${s - 1.6}" rx=".7"
          fill="none" stroke="rgba(255,244,200,.4)" stroke-width=".55"/>
    <rect x="${cx - h + 1.2}" y="${cy - h + 1.2}" width="${s - 2.4}" height="1.5" rx=".6"
          fill="rgba(255,255,255,.42)"/>
    <circle cx="${cx}" cy="${cy}" r="${Math.min(1.7, s * 0.26)}" fill="url(#sim-drill)"/>`;
}

/** Гребёнка: тёмная планка на всю длину ряда + площадки. */
function header(pins, { dir = 'up', w, band = 11.5 } = {}) {
  const row = pins.filter((p) => (dir === 'up' ? p.y < 0 : p.y > 0) && p.dir === dir);
  if (!row.length) return '';
  const xs = row.map((p) => p.x);
  const minX = Math.max(Math.min(...xs) - 6.5, -w / 2 + 4);
  const maxX = Math.min(Math.max(...xs) + 6.5, w / 2 - 4);
  const yc = row.reduce((sum, p) => sum + p.y, 0) / row.length;
  return `
    <rect x="${minX}" y="${yc - band / 2 + 1}" width="${maxX - minX}" height="${band}" rx="1.6"
          fill="#05080a" opacity=".45"/>
    <rect x="${minX}" y="${yc - band / 2}" width="${maxX - minX}" height="${band}" rx="1.6"
          fill="#101519" stroke="#20272e" stroke-width=".8"/>
    <rect x="${minX + 1}" y="${yc - band / 2 + 1}" width="${maxX - minX - 2}" height="2.4" rx="1.2"
          fill="rgba(255,255,255,.12)"/>
    ${row.map((p) => pad(p.x, p.y)).join('')}`;
}

/** Корпус микросхемы: чёрный пластик, насечка, ножки, маркировка. */
function chip(x, y, w, h, label, sub = '', { legs = 14, silkSize = 5 } = {}) {
  const legStep = w / legs;
  const pins = [];
  for (let i = 0; i < legs / 2; i++) {
    const lx = x + legStep * (i + 0.5);
    pins.push(`<rect x="${lx - 1.2}" y="${y - 2.8}" width="2.4" height="3.4" rx=".4" fill="url(#sim-metal-h)"/>
      <rect x="${lx - 1.2}" y="${y - 2.8}" width="1" height="3.4" fill="rgba(255,255,255,.45)"/>`);
    pins.push(`<rect x="${lx - 1.2}" y="${y + h - 0.6}" width="2.4" height="3.4" rx=".4" fill="url(#sim-metal-h)"/>
      <rect x="${lx - 1.2}" y="${y + h - 0.6}" width="1" height="3.4" fill="rgba(255,255,255,.4)"/>`);
  }
  return `
    ${pins.join('')}
    <rect x="${x + .8}" y="${y + 1.6}" width="${w}" height="${h}" rx="1.8" fill="#04070a" opacity=".42"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.6" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    <rect x="${x + 1.4}" y="${y + 1.2}" width="${w - 2.8}" height="${h * 0.22}" rx="1" fill="rgba(255,255,255,.07)"/>
    <path d="M ${x + 4} ${y} a 4 4 0 0 0 0 ${Math.min(6, h * 0.3)}" fill="none" stroke="#0a0c0e" stroke-width="1.6"/>
    <circle cx="${x + 2.8}" cy="${y + 2.8}" r="1.1" fill="#0a0c0e" stroke="#3a4148" stroke-width=".4"/>
    ${silk(label, x + w / 2, y + h / 2 + 1.8, { size: silkSize, fill: '#8d9aa6', family: 'ui-sans-serif,sans-serif' })}
    ${sub ? silk(sub, x + w / 2, y + h / 2 + 6.6, { size: 3.6, fill: '#5d6a75', family: 'ui-sans-serif,sans-serif' }) : ''}`;
}

/** Электролитический конденсатор. */
function capElectro(x, y, r = 7, label = '') {
  // SMD-электролит: чёрная база-бочонок, серебристый торец, полоса полярности
  const ir = r - 1.6;
  return `
    <circle cx="${x + .7}" cy="${y + 1.2}" r="${r}" fill="#04070a" opacity=".5"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="#1a2027" stroke="#2b333b" stroke-width=".7"/>
    <circle cx="${x}" cy="${y - .3}" r="${ir}" fill="url(#sim-can)" stroke="#8d99a3" stroke-width=".5"/>
    <circle cx="${x}" cy="${y - .3}" r="${(ir * 0.62).toFixed(1)}" fill="none" stroke="rgba(70,84,96,.45)" stroke-width=".9"/>
    <path d="M ${x - ir} ${y + ir * 0.28} a ${ir} ${ir} 0 0 0 ${ir * 2} 0 z" fill="#0f151b" opacity=".85"/>
    <path d="M ${x - ir * 0.72} ${y - ir * 0.72} a ${ir} ${ir} 0 0 1 ${ir * 1.05} ${-ir * 0.42}"
          fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.1"/>
    <circle cx="${x + ir * 0.55}" cy="${y + ir * 0.1}" r="${(ir * 0.17).toFixed(1)}" fill="#c9d3db" opacity=".9"/>
    ${label ? silk(label, x, y + r + 5.2, { size: 3.8, fill: '#8d9aa6' }) : ''}`;
}

/** Тактовая кнопка: металлический корпус и «пятак» сверху. */
function tactile(x, y, s = 13, label = '', { above = false } = {}) {
  const ly = above ? y - s / 2 - 3 : y + s / 2 + 6.5;
  return `
    <rect x="${x - s / 2 + .7}" y="${y - s / 2 + 1.4}" width="${s}" height="${s}" rx="1.8" fill="#04070a" opacity=".45"/>
    <rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="1.8" fill="url(#sim-metal)" stroke="#6c7883" stroke-width=".9"/>
    <rect x="${x - s / 2 + 1.2}" y="${y - s / 2 + 1.2}" width="${s - 2.4}" height="${s * 0.3}" rx="1.2" fill="rgba(255,255,255,.28)"/>
    <circle cx="${x}" cy="${y}" r="${s * 0.28}" fill="#2a323a" stroke="#9aa6b1" stroke-width=".8"/>
    <circle cx="${x - s * 0.09}" cy="${y - s * 0.09}" r="${s * 0.1}" fill="rgba(255,255,255,.35)"/>
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

/** Кварцевый резонатор: металлическая «банка» с бликом и ножками. */
function crystalCan(x, y, w, h) {
  return `
    <rect x="${x + .8}" y="${y + 1.4}" width="${w}" height="${h}" rx="${h * 0.32}" fill="#04070a" opacity=".42"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h * 0.32}" fill="url(#sim-metal)" stroke="#8d99a3" stroke-width=".8"/>
    <rect x="${x + 2}" y="${y + 1.6}" width="${w - 4}" height="${h * 0.34}" rx="${h * 0.18}" fill="rgba(255,255,255,.4)"/>
    <rect x="${x + 2}" y="${y + h - 3.2}" width="${w - 4}" height="1.8" rx=".9" fill="rgba(0,0,0,.22)"/>`;
}

/** Стабилизатор в корпусе SOT-223: пластик, металлическая площадка, три ножки. */
function regSot223(x, y, w, h, label = '1117') {
  const leg = w / 4.2;
  return `
    <rect x="${x + .8}" y="${y + 1.6}" width="${w}" height="${h}" rx="1.4" fill="#04070a" opacity=".42"/>
    <rect x="${x + w * 0.28}" y="${y - 3.4}" width="${w * 0.44}" height="4.6" rx="1" fill="url(#sim-metal)" stroke="#8d99a3" stroke-width=".6"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.4" fill="url(#sim-dip)" stroke="#2b3138" stroke-width=".8"/>
    <rect x="${x + 1.2}" y="${y + 1.2}" width="${w - 2.4}" height="${h * 0.26}" rx=".8" fill="rgba(255,255,255,.09)"/>
    ${[0, 1, 2].map((i) => `<rect x="${x + 2 + i * leg * 1.35}" y="${y + h - 1.6}" width="${leg * 0.8}" height="3.4" rx=".5" fill="#b9c3cb"/>`).join('')}
    ${silk(label, x + w / 2, y + h / 2 + 2.2, { size: 4, fill: '#8d9aa6' })}`;
}

/** USB-разъём: металлический кожух и внутренняя колодка. */
function usb(x, y, w, h, { type = 'B' } = {}) {
  const kind = type === 'micro'
    ? `<rect x="${x + 3}" y="${y + h * 0.28}" width="${w - 6}" height="${h * 0.44}" rx="1.6" fill="#1b2026"/>`
    : `<rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="1.4" fill="url(#sim-plastic)" stroke="#3b454e" stroke-width=".6"/>
       <rect x="${x + 5.5}" y="${y + h * 0.3}" width="${w - 11}" height="${h * 0.4}" rx="1.2" fill="#0a0d11"/>
       <rect x="${x + 7}" y="${y + h * 0.36}" width="${w - 14}" height="${h * 0.1}" rx=".6" fill="rgba(255,255,255,.18)"/>`;
  return `
    <rect x="${x + 1}" y="${y + 2}" width="${w}" height="${h}" rx="2.4" fill="#04070a" opacity=".45"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="url(#sim-metal-v)" stroke="#7d8a96" stroke-width=".9"/>
    <rect x="${x + 1.4}" y="${y + 1.4}" width="${w - 2.8}" height="${h * 0.26}" rx="1.6"
          fill="rgba(255,255,255,.5)"/>
    <rect x="${x + 1.4}" y="${y + h - 3.2}" width="${w - 2.8}" height="1.8" rx=".9"
          fill="rgba(0,0,0,.35)"/>
    ${kind}`;
}

/** Разъём питания (бочонок) Arduino: чёрный корпус, металлические контакты, зев. */
function barrelJack(x, y, w, h) {
  const cy = y + h / 2;
  return `
    <rect x="${x + 1.2}" y="${y + 2.4}" width="${w}" height="${h}" rx="2.4" fill="#04070a" opacity=".45"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="url(#sim-plastic)" stroke="#2b333b" stroke-width=".9"/>
    <rect x="${x + 1.4}" y="${y + 1.6}" width="${w - 2.8}" height="${h * 0.16}" rx="1.4" fill="rgba(255,255,255,.14)"/>
    <rect x="${x + w - 9}" y="${y + 4}" width="5.4" height="${h - 8}" rx="1.6" fill="#1b2229" stroke="#39434c" stroke-width=".6"/>
    <rect x="${x + w - 7.6}" y="${y + 6}" width="2.2" height="${h - 12}" rx="1" fill="#2d373f"/>
    <ellipse cx="${x + 7}" cy="${cy}" rx="4.6" ry="${h / 2 - 4.5}" fill="#05080b" stroke="#39434c" stroke-width=".8"/>
    <ellipse cx="${x + 7}" cy="${cy}" rx="2.1" ry="${(h / 2 - 4.5) * 0.45}" fill="url(#sim-metal-v)" opacity=".85"/>
    <path d="M ${x + 7} ${cy - h / 2 + 5} a 4.6 5 0 0 1 0 4" stroke="rgba(255,255,255,.35)" fill="none" stroke-width=".8"/>
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
      holes: [[X(3.4), Y(3.6)], [X(65.2), Y(7.2)], [X(3.4), Y(49.7)], [X(65.2), Y(46.2)]],
    })}
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- разъёмы: USB-B и питание -->
    ${usb(X(0.4) - 16, Y(4.8), 26, 56, { type: 'B' })}
    ${barrelJack(X(0.4) - 12, Y(22.5), 22, 52)}

    <!-- ATmega16U2 и его ICSP -->
    ${chip(X(15.6), Y(12.8), 32, 24, 'MEGA16U2', '', { legs: 8, silkSize: 3.6 })}
    ${[[15.75, 5.8], [18.29, 5.8], [20.83, 5.8], [15.75, 8.4], [18.29, 8.4], [20.83, 8.4]]
    .map(([mx, my]) => `${goldPad(X(mx), Y(my))}`).join('')}

    <!-- «мозг» платы -->
    ${chip(X(24.5), Y(26.5), 130, 30, 'ATmega328P', 'PU', { legs: 14, silkSize: 5.4 })}
    ${silk('16 MHz', X(16.6), Y(23.6), { size: 3.8, opacity: 0.7 })}
    ${crystalCan(X(12.4), Y(25.2), 26, 16)}

    <!-- ICSP: 2×3 у правого края -->
    <rect x="${X(59.4)}" y="${Y(20.6)}" width="30" height="41" rx="1.6" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[[61.9, 23.3], [64.4, 23.3], [61.9, 25.8], [64.4, 25.8], [61.9, 28.3], [64.4, 28.3]]
    .map(([mx, my]) => `${goldPad(X(mx), Y(my))}`).join('')}
    ${silk('ICSP', X(63.2), Y(19.2), { size: 4.2, opacity: 0.8 })}

    <!-- питание: стабилизатор и банки -->
    ${regSot223(X(11.5), Y(37), 30, 20)}
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
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- модуль ESP32-WROOM-32: экран и антенна на дальнем от USB краю -->
    <rect x="${X(31.4)}" y="${Y(5.9)}" width="${72}" height="${64}" rx="2" fill="#0f1418" stroke="#242c34" stroke-width=".9"/>
    <rect x="${X(32.6)}" y="${Y(6.8)}" width="${46}" height="${55}" rx="2" fill="#c8d0d7" stroke="#98a3ac" stroke-width=".9"/>
    <rect x="${X(32.6)}" y="${Y(6.8)}" width="${46}" height="${11}" rx="2" fill="rgba(255,255,255,.5)"/>
    <path d="M ${X(36.4)} ${Y(8)} v ${38} h ${5.6} v -${38}"
          fill="none" stroke="#b9c3cb" stroke-width="1.3" opacity=".5"/>
    ${silk('ESP32-WROOM-32', X(32.6) + 23, Y(12.4), { size: 4.4, weight: 700, fill: '#3b444c', family: 'ui-sans-serif,sans-serif' })}
    ${silk('FCC · 2.4 GHz', X(32.6) + 23, Y(14.6), { size: 3.2, fill: '#57626b', family: 'ui-sans-serif,sans-serif' })}
    <!-- полосковая антенна -->
    <g stroke="#c9a227" stroke-width="1.6" fill="none" stroke-linejoin="round">
      <path d="M ${X(43.4)} ${Y(8)} v ${11} h 1.8 v -${11} h 1.8 v ${11} h 1.8 v -${11} h 1.8 v ${11}"/>
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
  return `
    ${pcbBody(w, h, '#0c3b2a', '#052018', { radius: 6 })}
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- RP2040 в середине, между рядами подписей -->
    ${chip(X(22.8), Y(6.0), 40, 22, 'RP2040', '', { legs: 12, silkSize: 4 })}

    <!-- USB -->
    ${usb(X(0.2) - 9, Y(7.6), 16, 27, { type: 'micro' })}

    <!-- BOOTSEL и отладочные площадки -->
    ${tactile(X(8.2), Y(12), 10, 'BOOTSEL', { above: true })}
    <rect x="${X(44.4)}" y="${Y(9.2)}" width="21" height="8" rx="1.2" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[0, 1, 2].map((i) => `<rect x="${X(45.4) + i * 6.4}" y="${Y(10)}" width="4.6" height="5.6" rx=".7"
      fill="#0a0f14" stroke="#d4af37" stroke-width=".9" opacity=".9"/>`).join('')}
    ${silk('DEBUG', X(47.4), Y(14.2), { size: 3.2, opacity: 0.7 })}

    <!-- встроенный светодиод (GP25) -->
    <g class="led-on">
      <circle cx="${X(7)}" cy="${Y(7.4)}" r="3.2" fill="#0e2231" stroke="#1b4358"/>
      <circle class="builtin-glow" cx="${X(7)}" cy="${Y(7.4)}" r="3.2" fill="#7ef29d" opacity="0"/>
    </g>

    <!-- шелкография -->
`;
}

// -------------------------------------------------------- Raspberry Pi 5 ----
function paintRpi5(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  const M = PX_PER_MM;
  const box = (x, y, bw, bh, fill, stroke = 'rgba(0,0,0,.45)', rx = 1.6) => `
    <rect x="${X(x)}" y="${Y(y)}" width="${bw * M}" height="${bh * M}" rx="${rx}"
          fill="${fill}" stroke="${stroke}" stroke-width=".8"/>`;

  return `
    ${pcbBody(w, h, '#12583a', '#072a1b', {
      radius: 6,
      holes: [
        [X(6), Y(6), 4.2], [X(79), Y(6), 4.2], [X(6), Y(50), 4.2], [X(79), Y(50), 4.2],
      ],
    })}

    <!-- дорожки: несколько линий текстолита, чтобы плата не выглядела пустой -->
    <g stroke="rgba(190,255,210,.10)" stroke-width="1.1" fill="none">
      <path d="M ${X(8)} ${Y(14)} H ${X(26)} V ${Y(30)} H ${X(40)}"/>
      <path d="M ${X(8)} ${Y(40)} H ${X(24)} V ${Y(46)}"/>
      <path d="M ${X(60)} ${Y(10)} V ${Y(26)} H ${X(72)}"/>
      <path d="M ${X(46)} ${Y(38)} H ${X(70)} V ${Y(24)}"/>
    </g>

    <!-- гребёнка 2×20: нечётные сверху, чётные снизу -->
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- экранированный модуль Wi-Fi/BT -->
    <rect x="${X(7)}" y="${Y(9)}" width="${27 * M}" height="${19 * M}" rx="1.4"
          fill="url(#sim-metal-v)" stroke="#7d8790" stroke-width=".9"/>
    <rect x="${X(8.4)}" y="${Y(10.4)}" width="${24 * M}" height="${16 * M}" rx="1"
          fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".7"/>
    ${silk('Wi-Fi · BT', X(20.5), Y(20), { size: 4.4, fill: '#33414b', weight: 600 })}

    <!-- BCM2712 и память -->
    ${chip(X(40), Y(10), 44, 34, 'BCM2712', 'Raspberry Pi 5', { legs: 10, silkSize: 5.6 })}
    ${chip(X(58), Y(12), 26, 16, 'LPDDR4X', '', { legs: 8, silkSize: 4 })}
    ${chip(X(58), Y(26), 22, 14, 'RP1', 'I/O', { legs: 8, silkSize: 4.4 })}

    <!-- разъёмы по нижнему краю: Ethernet, USB 3, USB 2 -->
    <rect x="${X(58)}" y="${Y(43)}" width="${23 * M}" height="${12 * M}" rx="1.2"
          fill="url(#sim-metal-v)" stroke="#6f7a83" stroke-width=".9"/>
    <rect x="${X(59.6)}" y="${Y(44.4)}" width="${19.8 * M}" height="${9 * M}" rx=".8" fill="#1b2127"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<rect x="${X(61) + i * 2.4 * M}" y="${Y(45.6)}" width="${1.4 * M}" height="${6.4 * M}" rx=".3" fill="#b7a878" opacity=".85"/>`).join('')}
    ${silk('ETHERNET', X(69.5), Y(42), { size: 3.6, fill: '#e8f2f4', opacity: 0.85 })}

    ${box(33, 43, 22, 11, 'url(#sim-metal-v)', '#6f7a83')}
    ${box(34.4, 44.2, 9.4, 8.6, '#1d64c8', 'rgba(0,0,0,.5)', 0.8)}
    ${box(34.4, 44.2, 9.4, 4.2, '#2b7ae0', 'none', 0.8)}
    ${box(45.2, 44.2, 8.4, 8.6, '#20262c', 'rgba(0,0,0,.5)', 0.8)}
    ${silk('USB 3', X(39), Y(42.2), { size: 3.6, fill: '#e8f2f4', opacity: 0.85 })}

    <!-- левый торец: USB-C питания и два micro-HDMI -->
    <rect x="${X(0.6)}" y="${Y(30)}" width="${11 * M}" height="${7 * M}" rx="${3 * M}"
          fill="url(#sim-metal-v)" stroke="#6f7a83" stroke-width=".9"/>
    <rect x="${X(1.6)}" y="${Y(31.2)}" width="${7.4 * M}" height="${4.6 * M}" rx="${1.6 * M}" fill="#15191d"/>
    ${silk('USB-C 5V', X(6), Y(39.6), { size: 3.4, fill: '#e8f2f4', opacity: 0.85 })}

    ${[16, 23.4].map((y) => `<rect x="${X(0.6)}" y="${Y(y)}" width="${9 * M}" height="${5 * M}" rx="1.4"
        fill="url(#sim-metal-v)" stroke="#6f7a83" stroke-width=".9"/>
      <rect x="${X(1.6)}" y="${Y(y + 0.9)}" width="${6 * M}" height="${3.2 * M}" rx=".8" fill="#14181c"/>`).join('')}
    ${silk('HDMI0', X(5), Y(14.4), { size: 3.2, fill: '#e8f2f4', opacity: 0.8 })}
    ${silk('HDMI1', X(5), Y(21.8), { size: 3.2, fill: '#e8f2f4', opacity: 0.8 })}

    <!-- кнопка питания, разъём вентилятора, PoE-контакты -->
    ${tactile(X(46), Y(50), 11, 'PWR')}
    <rect x="${X(64)}" y="${Y(20)}" width="${7 * M}" height="${4 * M}" rx=".8" fill="#e9e4d8" stroke="#8d8776" stroke-width=".7"/>
    ${[0, 1].map((i) => `<rect x="${X(65.2) + i * 2.6 * M}" y="${Y(21)}" width="${1.2 * M}" height="${2 * M}" fill="#b9b2a0"/>`).join('')}
    ${silk('FAN', X(67.5), Y(27), { size: 3.4, fill: '#e8f2f4', opacity: 0.8 })}
    ${[0, 1, 2, 3].map((i) => `<circle cx="${X(66 + i * 2.54)}" cy="${Y(14)}" r="2.2" fill="#0a1014" stroke="#d4af37" stroke-width=".9"/>`).join('')}
    ${silk('PoE+', X(70), Y(19), { size: 3.4, fill: '#e8f2f4', opacity: 0.8 })}

    <!-- логотип и модель -->
    ${silk('Raspberry Pi 5', X(20), Y(38), { size: 7.4, weight: 700, fill: '#eef8f4', spacing: 0.3 })}
    ${silk('МОДЕЛЬ B · 8 ГБ', X(20), Y(43.6), { size: 4, fill: '#cfe9dc', opacity: 0.85 })}

    <!-- индикатор питания -->
    <g class="led-on">
      <circle cx="${X(12)}" cy="${Y(46)}" r="3" fill="url(#sim-lens-red)"/>
      <circle cx="${X(12)}" cy="${Y(46)}" r="3" fill="#ff5b4a" opacity=".55"/>
      <circle class="builtin-glow" cx="${X(12)}" cy="${Y(46)}" r="5.6" fill="#ff6a58" opacity="0"/>
    </g>
    ${silk('PWR', X(12), Y(52.4), { size: 3.2, fill: '#e8f2f4', opacity: 0.7 })}

    <!-- шелкография -->
`;
}

// -------------------------------------------------------------- заглушка ----
function paintGeneric(spec) {
  const { w, h } = spec;
  return `
    ${pcbBody(w, h, spec.body?.[1] || '#12222c', 'rgba(0,0,0,.5)')}
    ${silk(spec.short.toUpperCase(), 0, 2, { size: 10, weight: 700 })}
    ${silk(spec.chip || '', 0, 12, { size: 5, opacity: 0.6 })}`;
}

/**
 * Подписи выводов — белая краска на текстолите, строго от края площадки внутрь:
 * так они не наезжают ни на сами площадки, ни друг на друга.
 */
function pinLabels(spec) {
  const { h, pins } = spec;
  const size = h > 180 ? 5.8 : h > 100 ? 4.4 : 3.8;
  return pins.map((p) => {
    if (p.silk === '') return '';                 // подпись не нужна (её роль играет шелкография узла)
    // вывод сбоку (ICSP) — подпись слева от площадки, вдоль платы
    if (p.dir === 'right' || p.dir === 'left') {
      // вторая колонка двойной гребёнки подписывается левее первой
      const col = pins.filter((q) => q.dir === p.dir && Math.abs(q.y - p.y) < 0.6 && q.x < p.x).length;
      const x = p.dir === 'right' ? p.x - 9 - col * 13 : p.x + 9 + col * 13;
      return silk(p.silk || p.label, x, p.y + 1.4, { size, rot: -90, fill: '#f4fbfb', opacity: 0.9, weight: 600 });
    }
    const up = p.y < 0;
    // площадка занимает ±5 px от вывода; текст начинается сразу за ней и идёт вглубь платы
    const y = up ? p.y + 7 : p.y - 7;
    return silk(p.silk || p.label, p.x, y, {
      size, rot: -90, anchor: up ? 'end' : 'start', fill: '#f4fbfb', opacity: 0.9, weight: 600,
    });
  }).join('');
}


// ---------------------------------------------------------------- Nano ----
function paintNano(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  return `
    ${pcbBody(w, h, '#0b8f95', '#076a70', { radius: 4 })}
    ${header(spec.pins, { dir: 'up', w, band: 9 })}
    ${header(spec.pins, { dir: 'down', w, band: 9 })}

    <!-- mini-USB слева -->
    ${usb(X(0) - 9, Y(5.4), 19, 28, { type: 'micro' })}

    <!-- ATmega328P (TQFP-32), кварц, стабилизатор -->
    ${chip(X(14.6), Y(4.6), 28, 28, 'MEGA328P', '', { legs: 8, silkSize: 3.2 })}
    <rect x="${X(10.6)}" y="${Y(7.2)}" width="12" height="7" rx="1.6" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".7"/>
    ${silk('16M', X(12.1), Y(10.4), { size: 3, fill: '#2f3b46' })}
    <rect x="${X(9)}" y="${Y(9.9)}" width="13" height="8" rx="1" fill="#15181c" stroke="#2b3138" stroke-width=".7"/>
    ${silk('1117', X(10.2), Y(11.8), { size: 3, fill: '#8d9aa6' })}
    ${tactile(X(4.8), Y(6.6), 8)}
    ${silk('RST', X(4.8), Y(9.6), { size: 2.8, opacity: 0.8 })}

    <!-- ICSP 2×3 у правого края -->
    <rect x="${X(38.2)}" y="${Y(4.0)}" width="19" height="28" rx="1.2" fill="#101519" stroke="#20272e" stroke-width=".7"/>
    ${[[39.6, 5.1], [42.1, 5.1], [39.6, 7.6], [42.1, 7.6], [39.6, 10.1], [42.1, 10.1]]
    .map(([mx, my]) => `${goldPad(X(mx), Y(my), 4.4)}`).join('')}

    <!-- индикаторы TX / RX / L / ON -->
    ${boardLed(X(24.2), Y(11.8), '#ffd166', '', { r: 2.2 })}
    ${boardLed(X(26.6), Y(11.8), '#ffd166', '', { r: 2.2 })}
    <g class="led-on">
      <circle cx="${X(29)}" cy="${Y(11.8)}" r="2.6" fill="#141b12" stroke="#2b3a24"/>
      <circle class="builtin-glow" cx="${X(29)}" cy="${Y(11.8)}" r="2.6" fill="#ffd166" opacity="0"/>
    </g>
    ${boardLed(X(31.4), Y(11.8), '#7ef29d', '', { r: 2.2 })}
    ${silk('TX RX L ON', X(27.8), Y(9.6), { size: 3, opacity: 0.75 })}

    <!-- шелкография -->
    ${silk('ARDUINO NANO', X(30.4), Y(7.4), { size: 4.4, weight: 700, spacing: .4, fill: '#f2fbfb' })}`;
}

// ------------------------------------------------------------ Pro Mini ----
function paintProMini(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  const ftdi = [16.51, 13.97, 11.43, 8.89, 6.35, 3.81];
  return `
    ${pcbBody(w, h, '#0d7f86', '#065e63', { radius: 3 })}
    ${header(spec.pins, { dir: 'up', w, band: 9 })}
    ${header(spec.pins, { dir: 'down', w, band: 9 })}

    <!-- FTDI-гребёнка слева -->
    <rect x="${X(0.4)}" y="${Y(2.4)}" width="9" height="58" rx="1.2" fill="#101519" stroke="#20272e" stroke-width=".7"/>
    ${ftdi.map((y) => `${goldPad(X(1.6), Y(y), 3.6)}`).join('')}
    ${silk('FTDI', X(1.6), Y(1.6), { size: 3, opacity: 0.8 })}

    <!-- ATmega328P и кварц -->
    ${chip(X(12.4), Y(4.4), 28, 28, 'MEGA328P', '', { legs: 8, silkSize: 3.2 })}
    <rect x="${X(8.6)}" y="${Y(7)}" width="11" height="6" rx="1.4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".7"/>
    ${silk('8M', X(9.9), Y(10.1), { size: 2.8, fill: '#2f3b46' })}
    <rect x="${X(18.4)}" y="${Y(9.8)}" width="12" height="8" rx="1" fill="#15181c" stroke="#2b3138" stroke-width=".7"/>
    ${silk('1117', X(19.6), Y(11.7), { size: 2.8, fill: '#8d9aa6' })}

    <!-- индикаторы -->
    ${boardLed(X(23.6), Y(11.8), '#7ef29d', '', { r: 2 })}
    <g class="led-on">
      <circle cx="${X(26.2)}" cy="${Y(11.8)}" r="2.4" fill="#141b12" stroke="#2b3a24"/>
      <circle class="builtin-glow" cx="${X(26.2)}" cy="${Y(11.8)}" r="2.4" fill="#ffd166" opacity="0"/>
    </g>

    ${silk('PRO MINI', X(24.6), Y(6.6), { size: 4, weight: 700, spacing: .4, fill: '#f2fbfb' })}`;
}

// -------------------------------------------------------------- Leonardo ----
function paintLeonardo(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  return `
    ${pcbBody(w, h, '#0b8f95', '#076a70', {
      radius: 8,
      holes: [[X(3.4), Y(3.6)], [X(65.2), Y(7.2)], [X(3.4), Y(49.7)], [X(65.2), Y(46.2)]],
    })}
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- micro-USB слева -->
    ${usb(X(0.4) - 14, Y(20.4), 22, 26, { type: 'micro' })}

    <!-- ATmega32u4 -->
    ${chip(X(19.6), Y(19.6), 42, 30, 'MEGA32U4', '', { legs: 12, silkSize: 4 })}
    <rect x="${X(13.4)}" y="${Y(24.6)}" width="22" height="14" rx="3" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    ${silk('16 MHz', X(13.6), Y(22.4), { size: 3.4, opacity: 0.7 })}

    <!-- ICSP 2×3 у правого края -->
    <rect x="${X(59.4)}" y="${Y(20.6)}" width="30" height="41" rx="1.6" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[[61.9, 23.3], [64.4, 23.3], [61.9, 25.8], [64.4, 25.8], [61.9, 28.3], [64.4, 28.3]]
    .map(([mx, my]) => `${goldPad(X(mx), Y(my))}`).join('')}
    ${silk('ICSP', X(63.2), Y(19.2), { size: 4, opacity: 0.8 })}

    <!-- питание и индикаторы -->
    ${regSot223(X(11.5), Y(37), 30, 20)}
    ${capElectro(X(24.5), Y(40), 8)}
    ${tactile(X(13.4), Y(11.6), 12)}
    ${silk('RESET', X(13.4), Y(15.6), { size: 3.8, opacity: 0.85 })}
    ${boardLed(X(26.4), Y(14.6), '#ffd166', 'TX')}
    ${boardLed(X(26.4), Y(17), '#ffd166', 'RX')}
    ${boardLed(X(44.5), Y(40.2), '#7ef29d', 'ON')}
    <g class="led-on">
      <circle cx="${X(27.4)}" cy="${Y(10.4)}" r="4.4" fill="#141b12" stroke="#2b3a24"/>
      <circle class="builtin-glow" cx="${X(27.4)}" cy="${Y(10.4)}" r="4.4" fill="#ffd166" opacity="0"/>
    </g>
    ${silk('L', X(27.4), Y(12.6), { size: 4.2, opacity: 0.85 })}

    ${silk('DIGITAL (PWM~)', X(52.5), Y(11.4), { size: 4.8, opacity: 0.5 })}
    ${silk('POWER', X(38), Y(44.6), { size: 4.2, opacity: 0.5 })}
    ${silk('ANALOG IN', X(60.5), Y(44.6), { size: 4.2, opacity: 0.5 })}
    ${silk('ARDUINO', X(44), Y(24.4), { size: 8, weight: 700, spacing: 1.1, fill: '#f2fbfb' })}
    ${silk('LEONARDO', X(44), Y(31.4), { size: 7.4, weight: 700, spacing: 1.4, fill: '#f2fbfb' })}`;
}

// ------------------------------------------------------------ Mega 2560 ----
function paintMega(spec) {
  const { w, h } = spec;
  const X = (mm) => mm * PX_PER_MM - w / 2;
  const Y = (mm) => mm * PX_PER_MM - h / 2;
  const block = spec.pins.filter((p) => p.dir === 'right');
  const bxs = block.map((p) => p.x);
  const bys = block.map((p) => p.y);
  const bx1 = Math.max(Math.min(...bxs) - 9, -w / 2 + 3);
  const bx2 = Math.min(Math.max(...bxs) + 9, w / 2 - 3);
  const by1 = Math.min(...bys) - 8, by2 = Math.max(...bys) + 8;
  return `
    ${pcbBody(w, h, '#0b8f95', '#076a70', {
      radius: 8,
      holes: [[X(3.6), Y(3.6)], [X(97.9), Y(3.6)], [X(3.6), Y(49.7)], [X(97.9), Y(49.7)]],
    })}
    ${header(spec.pins, { dir: 'up', w })}
    ${header(spec.pins, { dir: 'down', w })}

    <!-- двойная гребёнка 2×18 у правого края -->
    <rect x="${bx1}" y="${by1}" width="${bx2 - bx1}" height="${by2 - by1}" rx="1.6"
          fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${block.map((p) => pad(p.x, p.y)).join('')}

    <!-- разъёмы: USB-B и питание -->
    ${usb(X(0.4) - 16, Y(4.8), 26, 56, { type: 'B' })}
    ${barrelJack(X(0.4) - 12, Y(22.5), 22, 52)}

    <!-- ATmega2560 -->
    ${chip(X(38), Y(20), 60, 52, 'MEGA2560', '', { legs: 14, silkSize: 4.6 })}
    <rect x="${X(30)}" y="${Y(24.4)}" width="26" height="16" rx="4" fill="#c3ccd4" stroke="#8d99a3" stroke-width=".8"/>
    ${silk('16 MHz', X(30.2), Y(22.6), { size: 3.6, opacity: 0.7 })}

    <!-- ICSP -->
    <rect x="${X(80.6)}" y="${Y(21)}" width="30" height="41" rx="1.6" fill="#101519" stroke="#20272e" stroke-width=".8"/>
    ${[[83.1, 23.7], [85.6, 23.7], [83.1, 26.2], [85.6, 26.2], [83.1, 28.7], [85.6, 28.7]]
    .map(([mx, my]) => `${goldPad(X(mx), Y(my))}`).join('')}
    ${silk('ICSP', X(84.4), Y(19.6), { size: 4, opacity: 0.8 })}

    <!-- питание и индикаторы -->
    <rect x="${X(12)}" y="${Y(37)}" width="34" height="20" rx="1.2" fill="#15181c" stroke="#2b3138" stroke-width=".8"/>
    ${silk('1117', X(15.6), Y(40.6), { size: 4, fill: '#8d9aa6' })}
    ${capElectro(X(28), Y(40), 8)}
    ${capElectro(X(35), Y(40), 6.5)}
    ${tactile(X(13.4), Y(11.6), 12)}
    ${silk('RESET', X(13.4), Y(15.6), { size: 3.8, opacity: 0.85 })}
    ${boardLed(X(24.8), Y(14.6), '#ffd166', 'TX')}
    ${boardLed(X(24.8), Y(17), '#ffd166', 'RX')}
    ${boardLed(X(51), Y(40.2), '#7ef29d', 'ON')}
    <g class="led-on">
      <circle cx="${X(33.4)}" cy="${Y(13.4)}" r="4.4" fill="#141b12" stroke="#2b3a24"/>
      <circle class="builtin-glow" cx="${X(33.4)}" cy="${Y(13.4)}" r="4.4" fill="#ffd166" opacity="0"/>
    </g>
    ${silk('L', X(33.4), Y(15.8), { size: 4.2, opacity: 0.85 })}

    ${silk('DIGITAL (PWM~)', X(58), Y(11.4), { size: 4.8, opacity: 0.5 })}
    ${silk('POWER', X(41), Y(45.2), { size: 4.2, opacity: 0.5 })}
    ${silk('ANALOG IN', X(71), Y(45.2), { size: 4.2, opacity: 0.5 })}
    ${silk('ARDUINO', X(67), Y(25.4), { size: 8, weight: 700, spacing: 1.1, fill: '#f2fbfb' })}
    ${silk('MEGA 2560', X(67), Y(33.4), { size: 7, weight: 700, spacing: 1.4, fill: '#f2fbfb' })}`;
}

const PAINTERS = {
  uno: paintUno, esp32: paintEsp32, pico: paintPico, rpi5: paintRpi5,
  nano: paintNano, promini: paintProMini, leonardo: paintLeonardo, mega: paintMega,
};

export function renderBoardArt(spec) {
  const paint = PAINTERS[spec.id] || paintGeneric;
  return paint(spec) + pinLabels(spec);
}
