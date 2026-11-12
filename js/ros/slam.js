/**
 * slam.js — построение карты по лучам лидара (упрощённый Cartographer).
 *
 * Карта — сетка занятости 5 см: у каждой ячейки логарифм отношения
 * «занято / свободно». Луч лидара помечает всё, что прошёл, как свободное,
 * а точку попадания — как занятое. Это честная обратная проекция: если робот
 * не был в комнате, там останется «неизвестно» (как в RViz).
 *
 * Модуль без DOM: тестируется в Node.
 */

const FREE = -0.38;     // «здесь проехали» — минус к логарифму
const OCCUPIED = 0.9;   // «здесь стена» — плюс
const CLAMP = 4;        // ограничение, чтобы карта не «залипала»

export class OccupancyGrid {
  constructor(world, res = 0.05) {
    this.world = world;
    this.res = res;
    this.w = Math.ceil(world.width / res);
    this.h = Math.ceil(world.height / res);
    this.logOdds = new Float32Array(this.w * this.h);
    this.cells = this.w * this.h;
    this.reachable = this._computeReachable();
    this.totalReachable = this.reachable.reduce((s, v) => s + v, 0);
  }

  idx(ix, iy) { return iy * this.w + ix; }
  inside(ix, iy) { return ix >= 0 && iy >= 0 && ix < this.w && iy < this.h; }
  toCell(x, y) { return { ix: Math.floor(x / this.res), iy: Math.floor(y / this.res) }; }
  toWorld(ix, iy) { return { x: (ix + 0.5) * this.res, y: (iy + 0.5) * this.res }; }

  /** Ячейки, до которых робот физически может доехать (эталон для покрытия). */
  _computeReachable() {
    const { w, h, res } = this;
    const blocked = new Uint8Array(w * h);
    const segs = this.world.segments;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const x = (ix + 0.5) * res, y = (iy + 0.5) * res;
        let bad = false;
        for (const s of segs) {
          // расстояние от центра ячейки до отрезка — своя, дешёвая версия
          const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
          const len2 = dx * dx + dy * dy || 1e-9;
          let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = s.x1 + t * dx, py = s.y1 + t * dy;
          if (Math.hypot(x - px, y - py) < res * 0.85) { bad = true; break; }
        }
        if (bad) blocked[iy * w + ix] = 1;
      }
    }
    // заливка от точки старта: робот шириной 36 см не пролезет в щель уже 40 см
    const seen = new Uint8Array(w * h);
    const start = this.toCell(this.world.spawn.x, this.world.spawn.y);
    const queue = [this.idx(start.ix, start.iy)];
    seen[queue[0]] = 1;
    while (queue.length) {
      const i = queue.pop();
      const ix = i % w, iy = (i - ix) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = ix + dx, ny = iy + dy;
        if (!this.inside(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (seen[j] || blocked[j]) continue;
        if (this._tight(nx, ny, blocked)) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return seen;
  }

  /** Ячейка слишком близко к препятствию — робот там не поместится. */
  _tight(ix, iy, blocked) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = ix + dx, ny = iy + dy;
        if (!this.inside(nx, ny)) continue;
        if (blocked[this.idx(nx, ny)]) return true;
      }
    }
    return false;
  }

  /**
   * Подмешать одно измерение лидара.
   *
   * Луч не «рисует пунктир»: между соседними лучами закрашивается целый сектор
   * (дуга на каждом шаге по дальности). Иначе на 8 м между лучами остаются
   * дырки в 20 см — на карте это выглядит как штриховка, и покрытие не растёт.
   */
  update(pose, ranges, { angleMin = -Math.PI, angleSpan = Math.PI * 2, maxRange = 8 } = {}) {
    const n = ranges.length;
    if (!n) return;
    const dth = angleSpan / Math.max(1, n - 1);
    const step = this.res;

    for (let i = 0; i < n; i++) {
      const a0 = pose.theta + angleMin + dth * i;
      const r0 = Math.min(ranges[i] || 0, maxRange);
      const r1 = Math.min(ranges[(i + 1) % n] || 0, maxRange);

      // свободное — веером до ближайшего попадания в секторе
      const freeTo = Math.min(r0, r1);
      for (let d = step; d < freeTo - step * 0.5; d += step) {
        const arc = Math.max(1, Math.round((d * dth) / step) + 1);
        for (let k = 0; k < arc; k++) {
          const a = a0 + dth * (k / arc);
          const x = pose.x + Math.cos(a) * d;
          const y = pose.y + Math.sin(a) * d;
          const { ix, iy } = this.toCell(x, y);
          if (!this.inside(ix, iy)) continue;
          const j = this.idx(ix, iy);
          this.logOdds[j] = Math.max(-CLAMP, this.logOdds[j] + FREE);
        }
      }

      // занятое — в самой точке попадания, вместе с соседями (стена не тоньше 15 см)
      if (r0 < maxRange) {
        const x = pose.x + Math.cos(a0) * r0;
        const y = pose.y + Math.sin(a0) * r0;
        const { ix, iy } = this.toCell(x, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = ix + dx, ny = iy + dy;
            if (!this.inside(nx, ny)) continue;
            const j = this.idx(nx, ny);
            const add = dx === 0 && dy === 0 ? OCCUPIED : OCCUPIED * 0.5;
            this.logOdds[j] = Math.min(CLAMP, this.logOdds[j] + add);
          }
        }
      }
    }
  }

  /** Доля исследованной площади от той, куда вообще можно доехать (0…1). */
  coverage() {
    if (!this.totalReachable) return 0;
    let free = 0;
    for (let i = 0; i < this.cells; i++) {
      if (this.reachable[i] && this.logOdds[i] < -0.2) free++;
    }
    return free / this.totalReachable;
  }

  /** Занятость ячейки в терминах ROS: -1 неизвестно, 0…100. */
  value(i) {
    const lo = this.logOdds[i];
    if (lo >= 0.5) return 100;
    if (lo <= -0.2) return 0;
    return -1;
  }

  known() {
    let k = 0;
    for (let i = 0; i < this.cells; i++) if (this.logOdds[i] !== 0) k++;
    return k;
  }

  reset() { this.logOdds.fill(0); }
}
