/**
 * world.js — квартира для ROS 2-режима: стены, мебель, мусор, док-станция.
 *
 * Всё в метрах, оси как в ROS: X вправо, Y вверх, угол против часовой стрелки.
 * Стены и мебель — отрезки: по ним считаются и лучи лидара, и столкновения.
 * Модуль ничего не знает про DOM и canvas, поэтому проверяется в Node.
 */

/** Прямоугольник → четыре отрезка (без повторов вершин). */
export function rectSegments(x1, y1, x2, y2) {
  return [
    [x1, y1, x2, y1],
    [x2, y1, x2, y2],
    [x2, y2, x1, y2],
    [x1, y2, x1, y1],
  ];
}

const WALLS = [
  // периметр квартиры
  [0, 0, 10.4, 0],
  [10.4, 0, 10.4, 7.4],
  [10.4, 7.4, 0, 7.4],
  [0, 7.4, 0, 0],
  // кухня | спальня (верхняя полоса)
  [4.6, 4.6, 4.6, 7.4],
  // верхняя полоса | коридор, проём 3.2…4.2
  [0, 4.6, 3.2, 4.6],
  [4.2, 4.6, 4.6, 4.6],
  [4.6, 4.6, 6.4, 4.6],
  [7.6, 4.6, 10.4, 4.6],
  // коридор | нижняя полоса, проём 4.8…5.8
  [0, 2.4, 4.8, 2.4],
  [5.8, 2.4, 10.4, 2.4],
  // гостиная | кабинет, проём по y 0.9…1.9
  [7.6, 0, 7.6, 0.9],
  [7.6, 1.9, 7.6, 2.4],
];

const FURNITURE = [
  { name: 'Диван', rect: [0.6, 0.4, 2.6, 1.0] },
  { name: 'Стол', rect: [2.0, 5.4, 3.4, 6.4] },
  { name: 'Кровать', rect: [7.4, 5.2, 9.6, 7.0] },
  { name: 'Шкаф', rect: [8.4, 0.3, 10.0, 0.9] },
  { name: 'Тумба', rect: [6.6, 3.2, 7.4, 3.9] },
];

const ROOMS = [
  { name: 'Кухня', rect: [0, 4.6, 4.6, 7.4] },
  { name: 'Спальня', rect: [4.6, 4.6, 10.4, 7.4] },
  { name: 'Коридор', rect: [0, 2.4, 10.4, 4.6] },
  { name: 'Гостиная', rect: [0, 0, 7.6, 2.4] },
  { name: 'Кабинет', rect: [7.6, 0, 10.4, 2.4] },
];

export function makeWorld() {
  const segments = [];
  for (const w of WALLS) segments.push({ x1: w[0], y1: w[1], x2: w[2], y2: w[3], kind: 'wall' });
  for (const f of FURNITURE) {
    for (const s of rectSegments(...f.rect)) {
      segments.push({ x1: s[0], y1: s[1], x2: s[2], y2: s[3], kind: 'furniture', name: f.name });
    }
  }
  return {
    width: 10.4,
    height: 7.4,
    walls: WALLS,
    furniture: FURNITURE,
    rooms: ROOMS,
    segments,
    dock: { x: 0.9, y: 3.9, radius: 0.45, name: 'Док-станция' },
    trash: [
      { id: 't1', x: 1.5, y: 1.9, kind: 'бутылка' },
      { id: 't2', x: 3.0, y: 3.6, kind: 'бумага' },
      { id: 't3', x: 6.4, y: 2.9, kind: 'банка' },
      { id: 't4', x: 8.8, y: 1.6, kind: 'коробка' },
      { id: 't5', x: 1.2, y: 6.4, kind: 'пакет' },
      { id: 't6', x: 9.9, y: 5.0, kind: 'бутылка' },
    ],
    spawn: { x: 0.9, y: 3.9, theta: 0 },
  };
}

// ------------------------------------------------------------------ геометрия ----

/** Расстояние от точки до отрезка. */
export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Луч из точки (ox, oy) под углом angle. Возвращает ближайшее расстояние
 * до отрезков или maxRange, если ничего не задели.
 */
export function raycast(segments, ox, oy, angle, maxRange = 8) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = maxRange;
  for (const s of segments) {
    const x1 = s.x1, y1 = s.y1, x2 = s.x2, y2 = s.y2;
    const sx = x2 - x1, sy = y2 - y1;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;             // луч параллелен отрезку
    const t = ((x1 - ox) * sy - (y1 - oy) * sx) / denom;   // вдоль луча
    const u = ((x1 - ox) * dy - (y1 - oy) * dx) / denom;   // вдоль отрезка
    if (t <= 0.001 || u < 0 || u > 1) continue;
    if (t < best) best = t;
  }
  return best;
}

/** Веер лучей: массив дальностей (м) и угол первого луча. */
export function castFan(segments, pose, { rays = 240, maxRange = 8, angleMin = -Math.PI, angleSpan = Math.PI * 2 } = {}) {
  const ranges = new Float32Array(rays);
  for (let i = 0; i < rays; i++) {
    const a = pose.theta + angleMin + (angleSpan * i) / (rays - 1);
    ranges[i] = raycast(segments, pose.x, pose.y, a, maxRange);
  }
  return ranges;
}

/** Сталкивается ли круг (робот) с препятствиями. */
export function collides(world, x, y, radius = 0.18) {
  if (x < radius || y < radius || x > world.width - radius || y > world.height - radius) return true;
  for (const s of world.segments) {
    if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) < radius) return true;
  }
  return false;
}

/** Внутри ли точка комнаты (для подсказок «вы в гостиной»). */
export function roomAt(world, x, y) {
  for (const r of world.rooms) {
    const [x1, y1, x2, y2] = r.rect;
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return r.name;
  }
  return '—';
}
