/**
 * robot.js — робот с дифференциальным приводом, лидаром и батареей.
 *
 * Модель школьная, но честная: команда скорости из /cmd_vel интегрируется
 * по времени, столкновение со стеной действительно останавливает робота,
 * лидар светит 240 лучами и видит мебель, батарея садится в движении.
 */

import { castFan, collides } from './world.js';

export class Robot {
  constructor(world, opts = {}) {
    this.world = world;
    this.radius = opts.radius ?? 0.17;
    this.maxV = opts.maxV ?? 0.55;          // м/с
    this.maxW = opts.maxW ?? 1.8;           // рад/с
    this.rays = opts.rays ?? 240;
    this.maxRange = opts.maxRange ?? 8;
    this.reset();
  }

  reset() {
    const { x, y, theta } = this.world.spawn;
    this.x = x;
    this.y = y;
    this.theta = theta;
    this.v = 0;
    this.w = 0;
    this.targetV = 0;
    this.targetW = 0;
    this.odom = 0;              // пройденный путь, м
    this.battery = 100;         // %
    this.collisions = 0;
    this.charging = false;
    this.path = [{ x, y }];     // след для визуализации
    this.cooldown = 0;          // после удара робот не слушается 0.25 с
    this.lastHit = -10;         // время последнего «засчитанного» удара
    this.simTime = 0;
  }

  pose() { return { x: this.x, y: this.y, theta: this.theta }; }

  /** Команда из /cmd_vel (Twist): линейная по X, угловая по Z. */
  cmd(linearX, angularZ) {
    const lv = Number(linearX) || 0;
    const aw = Number(angularZ) || 0;
    this.targetV = Math.max(-this.maxV, Math.min(this.maxV, lv));
    this.targetW = Math.max(-this.maxW, Math.min(this.maxW, aw));
  }

  stop() { this.targetV = 0; this.targetW = 0; this.v = 0; this.w = 0; }

  /** Один шаг физики. Возвращает true, если было столкновение. */
  step(dt) {
    const d = Math.min(0.1, Math.max(0.001, dt));
    this.simTime += d;
    // плавный разгон/торможение — как у настоящего привода
    this.v += (this.targetV - this.v) * Math.min(1, d * 9);
    this.w += (this.targetW - this.w) * Math.min(1, d * 9);

    if (this.battery <= 0) { this.v = 0; this.w = 0; }
    if (this.cooldown > 0) { this.cooldown -= d; this.v = 0; }
    const moving = Math.abs(this.v) > 0.01 || Math.abs(this.w) > 0.5;

    let hit = false;
    const nx = this.x + this.v * Math.cos(this.theta) * d;
    const ny = this.y + this.v * Math.sin(this.theta) * d;
    if (!collides(this.world, nx, ny, this.radius)) {
      this.odom += Math.hypot(nx - this.x, ny - this.y);
      this.x = nx;
      this.y = ny;
    } else if (Math.abs(this.v) > 0.01) {
      // удар засчитываем не чаще двух раз в секунду, иначе «упёрся» = 50 ударов
      if (this.simTime - this.lastHit > 0.5) {
        this.lastHit = this.simTime;
        this.collisions++;
        hit = true;
      }
      this.v = 0;
      this.targetV = 0;
      this.cooldown = 0.25;
    }
    this.theta += this.w * d;
    while (this.theta > Math.PI) this.theta -= Math.PI * 2;
    while (this.theta < -Math.PI) this.theta += Math.PI * 2;

    // батарея: тратится в движении, заряжается на доке
    const onDock = Math.hypot(this.x - this.world.dock.x, this.y - this.world.dock.y) < this.world.dock.radius;
    this.charging = onDock;
    if (onDock) this.battery = Math.min(100, this.battery + 6 * d);
    else if (moving) this.battery = Math.max(0, this.battery - 0.35 * d);

    // след (не длиннее 1200 точек)
    const last = this.path[this.path.length - 1];
    if (Math.hypot(this.x - last.x, this.y - last.y) > 0.05) {
      this.path.push({ x: this.x, y: this.y });
      if (this.path.length > 1200) this.path.shift();
    }
    return hit;
  }

  /** Один оборот лидара: массив дальностей в метрах. */
  scan() {
    return castFan(this.world.segments, this.pose(), {
      rays: this.rays,
      maxRange: this.maxRange,
      angleMin: -Math.PI,
      angleSpan: Math.PI * 2,
    });
  }

  distanceTo(x, y) { return Math.hypot(this.x - x, this.y - y); }
}
