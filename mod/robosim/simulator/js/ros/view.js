/**
 * view.js — отрисовка ROS-режима на canvas.
 *
 * Слои: сетка 1 м → карта SLAM (как в RViz) → мебель и стены (в режиме
 * «истина») → мусор и док → лучи лидара → след → робот.
 *
 * Карта рисуется в отдельный offscreen-canvas размером «ячейка = пиксель»
 * и потом растягивается без сглаживания: 30 тысяч ячеек пересчитываются
 * за десятые доли миллисекунды, а выглядит как настоящая сетка занятости.
 */

const COLORS = {
  bg: '#0a1016',
  grid: '#141d26',
  gridBold: '#1d2a36',
  wall: '#4d6b85',
  furniture: '#2b3d4e',
  free: '#33475a',
  occupied: '#e6f2fb',
  ray: 'rgba(90,200,255,0.10)',
  path: 'rgba(120,220,255,0.55)',
  robot: '#3fb950',
  robotEdge: '#d8ffe4',
  trash: '#ffb26b',
  trashDone: '#3d4a58',
  dock: '#7ef29d',
};

export class RosView {
  constructor(canvas, { world, robot, slam }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.robot = robot;
    this.slam = slam;
    this.mode = 'slam';          // 'slam' | 'truth'
    this.showRays = true;
    this.showPath = true;
    this.scale = 60;
    this.offset = { x: 0, y: 0 };
    this._mapCanvas = null;
    this._mapImage = null;
    this._resize();
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 560;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    // вписываем всю квартиру с полями
    const pad = 26;
    this.scale = Math.min((w - pad * 2) / this.world.width, (h - pad * 2) / this.world.height);
    this.offset = {
      x: (w - this.world.width * this.scale) / 2,
      y: (h - this.world.height * this.scale) / 2,
    };
  }

  /** Метры → пиксели (ось Y перевёрнута: в ROS она вверх). */
  toScreen(x, y) {
    return {
      x: this.offset.x + x * this.scale,
      y: this.h - this.offset.y - y * this.scale,
    };
  }

  toWorld(px, py) {
    return {
      x: (px - this.offset.x) / this.scale,
      y: (this.h - this.offset.y - py) / this.scale,
    };
  }

  _ensureMap() {
    const { w, h } = this.slam;
    if (!this._mapCanvas || this._mapCanvas.width !== w || this._mapCanvas.height !== h) {
      this._mapCanvas = document.createElement('canvas');
      this._mapCanvas.width = w;
      this._mapCanvas.height = h;
      this._mapCtx = this._mapCanvas.getContext('2d');
      this._mapImage = this._mapCtx.createImageData(w, h);
      this._dirtyMap = true;
    }
  }

  /** Пересобрать пиксели карты занятости (быстро: 30k ячеек). */
  _rebuildMap() {
    this._ensureMap();
    const { slam } = this;
    const data = this._mapImage.data;
    const free = [0x33, 0x47, 0x5a];
    const occupied = [0xe6, 0xf2, 0xfb];
    const w = slam.w, h = slam.h;
    for (let i = 0; i < slam.cells; i++) {
      const v = slam.value(i);
      // ImageData растёт сверху вниз, а мир — снизу вверх: переворачиваем строки
      const ix = i % w;
      const iy = (i - ix) / w;
      const p = ((h - 1 - iy) * w + ix) * 4;
      if (v < 0) { data[p + 3] = 0; continue; }
      const c = v >= 50 ? occupied : free;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
      data[p + 3] = v >= 50 ? 235 : 150;
    }
    this._mapCtx.putImageData(this._mapImage, 0, 0);
    this._dirtyMap = false;
  }

  draw(state = {}) {
    const { ctx } = this;
    if (!ctx) return;
    const { w, h, scale, world } = this;

    if (this._dirtyMap !== false || !this._mapCanvas) this._rebuildMap();

    // фон и сетка
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    const o = this.toScreen(0, world.height);
    const W = world.width * scale;
    const H = world.height * scale;

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= world.width + 0.01; x += 1) {
      const p = this.toScreen(x, 0);
      ctx.moveTo(p.x, o.y); ctx.lineTo(p.x, o.y + H);
    }
    for (let y = 0; y <= world.height + 0.01; y += 1) {
      const p = this.toScreen(0, y);
      ctx.moveTo(o.x, p.y); ctx.lineTo(o.x + W, p.y);
    }
    ctx.stroke();

    // карта SLAM
    if (this._mapCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._mapCanvas, o.x, o.y, W, H);
      ctx.imageSmoothingEnabled = true;
    }

    // режим «истина»: стены и мебель поверх (для учителя и отладки)
    if (this.mode === 'truth') {
      ctx.strokeStyle = COLORS.wall;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const s of world.segments.filter((q) => q.kind === 'wall')) {
        const a = this.toScreen(s.x1, s.y1);
        const b = this.toScreen(s.x2, s.y2);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      ctx.fillStyle = COLORS.furniture;
      for (const f of world.furniture) {
        const p = this.toScreen(f.rect[0], f.rect[3]);
        ctx.fillRect(p.x, p.y, (f.rect[2] - f.rect[0]) * scale, (f.rect[3] - f.rect[1]) * scale);
      }
    }

    // док-станция
    {
      const d = world.dock;
      const p = this.toScreen(d.x, d.y);
      ctx.strokeStyle = COLORS.dock;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, d.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.dock;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('док', p.x, p.y + 3);
    }

    // мусор
    for (const t of state.trash || world.trash) {
      const p = this.toScreen(t.x, t.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(3, 0.09 * scale), 0, Math.PI * 2);
      ctx.fillStyle = t.collected ? COLORS.trashDone : COLORS.trash;
      ctx.globalAlpha = t.collected ? 0.5 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (t.collected) {
        ctx.strokeStyle = COLORS.trashDone;
        ctx.beginPath();
        ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y);
        ctx.stroke();
      }
    }

    // лучи лидара
    const ranges = state.ranges;
    const pose = this.robot.pose();
    const rp = this.toScreen(pose.x, pose.y);
    if (this.showRays && ranges) {
      ctx.strokeStyle = COLORS.ray;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        const a = pose.theta - Math.PI + (Math.PI * 2 * i) / Math.max(1, ranges.length - 1);
        const ex = this.toScreen(pose.x + Math.cos(a) * r, pose.y + Math.sin(a) * r);
        ctx.moveTo(rp.x, rp.y);
        ctx.lineTo(ex.x, ex.y);
      }
      ctx.stroke();
    }

    // след робота
    if (this.showPath && this.robot.path.length > 1) {
      ctx.strokeStyle = COLORS.path;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      this.robot.path.forEach((pt, i) => {
        const p = this.toScreen(pt.x, pt.y);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    // робот
    {
      const r = Math.max(6, this.robot.radius * scale);
      ctx.save();
      ctx.translate(rp.x, rp.y);
      ctx.rotate(-pose.theta);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.robot;
      ctx.fill();
      ctx.strokeStyle = COLORS.robotEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // «нос» робота
      ctx.beginPath();
      ctx.moveTo(r * 0.2, 0);
      ctx.lineTo(r * 0.95, 0);
      ctx.strokeStyle = COLORS.robotEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // подпись скорости
      const kmh = Math.abs(this.robot.v) * 3.6;
      if (kmh > 0.05) {
        ctx.fillStyle = 'rgba(216,255,228,.75)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${kmh.toFixed(1)} км/ч`, rp.x, rp.y - r - 6);
      }
    }

    // подписи комнат (только в режиме «истина»)
    if (this.mode === 'truth') {
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,16,22,.85)';
      for (const r of world.rooms) {
        const c = this.toScreen((r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2);
        ctx.strokeText(r.name, c.x, c.y);      // подложка, чтобы читалось поверх мебели
        ctx.fillStyle = 'rgba(168,192,214,.85)';
        ctx.fillText(r.name, c.x, c.y);
      }
    }
  }

  invalidate() { this._dirtyMap = true; }
}
