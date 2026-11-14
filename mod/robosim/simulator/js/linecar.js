/**
 * linecar.js — «робот-тележка на линии»: геометрия тренажёра и движение.
 *
 * Деталь `linecar` — это не картинка, а маленький полигон: замкнутая линия на
 * поле и тележка с двумя моторами и двумя датчиками линии. Здесь живёт только
 * геометрия и кинематика, без электрики:
 *
 *   • где проходит линия и на каком расстоянии от неё точка (distToLine);
 *   • где стоят датчики при текущем положении тележки (sensorPoints);
 *   • как положение меняется от оборотов колёс (stepPose).
 *
 * Электрика (обмотки моторов, выходы датчиков) — в circuit.js, отрисовка — в
 * parts.js. Единицы — миллиметры поля, как у настоящей тележки: колесо 44 мм,
 * колея 76 мм, линия 24 мм.
 */

/** Поле тренажёра: размеры в единицах схемы (1 единица ≈ 1 мм поля). */
export const ARENA = { w: 440, h: 340, pad: 9 };

/** Замкнутая линия — эллипс. width — ширина чёрной полосы. */
export const TRACK = { cx: 0, cy: 6, a: 140, b: 104, width: 24 };

/** Сама тележка: размеры корпуса, колёс и положение датчиков. */
export const CAR = {
  bodyW: 122,          // рама по ходу движения
  bodyH: 62,           // ширина рамы
  wheelR: 22,          // радиус колеса, мм
  trackW: 76,          // колея (между центрами колёс)
  sensorAhead: 38,     // датчики вынесены вперёд от оси
  sensorSpread: 9,     // каждый датчик в сторону от оси симметрии
  gear: 48,            // редуктор TT-мотора: 48 оборотов мотора на оборот колеса
  vLimit: 260,         // предел скорости, мм/с (чтобы тележку не «уносило»)
};

/** Длина осевой линии: сколько проходит тележка за один круг. */
export function trackLength() {
  // периметр эллипса по Рамануджану — точность лучше 0,1 % при наших осях
  const a = TRACK.a, b = TRACK.b;
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Положение тележки, у которой датчики стоят ровно на линии в точке t. */
export function poseOnTrack(t) {
  const p = trackPoint(t);
  const tx = -TRACK.a * Math.sin(t), ty = TRACK.b * Math.cos(t);   // касательная к эллипсу
  const th = Math.atan2(ty, tx);
  // датчики вынесены вперёд, поэтому корпус отодвигаем назад по ходу движения
  return { x: p.x - CAR.sensorAhead * Math.cos(th), y: p.y - CAR.sensorAhead * Math.sin(th), th };
}

/** Стартовая позиция: датчики на линии слева от поля, носом по ходу движения. */
export const START = poseOnTrack(Math.PI);

const TAU = Math.PI * 2;

/** Точка на осевой линии эллипса: t = 0…2π. */
export function trackPoint(t) {
  return { x: TRACK.cx + TRACK.a * Math.cos(t), y: TRACK.cy + TRACK.b * Math.sin(t) };
}

// Полилиния осевой линии, посчитанная один раз: по ней быстро ищем расстояние.
const CURVE = (() => {
  const n = 160;
  const out = [];
  for (let i = 0; i < n; i++) out.push(trackPoint((i / n) * TAU));
  return out;
})();

/** Расстояние от точки до отрезка. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

/** Насколько далеко точка поля от середины линии (мм). */
export function distToLine(x, y) {
  let best = Infinity;
  for (let i = 0; i < CURVE.length; i++) {
    const a = CURVE[i], b = CURVE[(i + 1) % CURVE.length];
    const d = segDist(x, y, a.x, a.y, b.x, b.y);
    if (d < best) best = d;
  }
  return best;
}

/** Видит ли датчик чёрную линию: точка попала на полосу. */
export function seesLine(x, y) {
  return distToLine(x, y) <= TRACK.width / 2;
}

/** Точки двух датчиков в координатах поля для заданного положения. */
export function sensorPoints(pose) {
  const cos = Math.cos(pose.th), sin = Math.sin(pose.th);
  const place = (side) => {
    const lx = CAR.sensorAhead, ly = side * CAR.sensorSpread;
    return { x: pose.x + lx * cos - ly * sin, y: pose.y + lx * sin + ly * cos };
  };
  return [place(-1), place(1)];      // слева и справа по ходу движения
}

/** Состояние датчиков: [левый, правый], true — под датчиком чёрная линия. */
export function sensorsOnLine(pose) {
  return sensorPoints(pose).map((p) => seesLine(p.x, p.y));
}

/** Новое положение тележки от угловых скоростей колёс (рад/с) за dt секунд. */
export function stepPose(pose, wl, wr, dt) {
  const vl = Math.max(-CAR.vLimit, Math.min(CAR.vLimit, (wl * CAR.wheelR) / CAR.gear));
  const vr = Math.max(-CAR.vLimit, Math.min(CAR.vLimit, (wr * CAR.wheelR) / CAR.gear));
  const v = (vl + vr) / 2;
  // в координатах схемы Y смотрит вниз, а «право» тележки — это +Y, поэтому
  // поворот считается как (v_лев - v_прав)/колея: быстрое левое колесо уводит вправо
  const omega = (vl - vr) / CAR.trackW;
  pose.th += omega * dt;
  pose.x += v * Math.cos(pose.th) * dt;
  pose.y += v * Math.sin(pose.th) * dt;
  // борта поля: тележка упирается в стенку и дальше не едет
  const mx = ARENA.w / 2 - ARENA.pad - CAR.bodyW / 2;
  const my = ARENA.h / 2 - ARENA.pad - CAR.bodyH / 2;
  pose.x = Math.max(-mx, Math.min(mx, pose.x));
  pose.y = Math.max(-my, Math.min(my, pose.y));
  return { vl, vr, v, omega };
}

/** Поставить тележку на старт. */
export function resetPose(pose) {
  pose.x = START.x;
  pose.y = START.y;
  pose.th = START.th;
  return pose;
}

/** Новая (стартовая) поза. */
export function newPose() {
  return { ...START };
}
