/**
 * scope.js — осциллограф: 4 канала, буфер отсчётов, развёртка и масштаб.
 *
 * Отсчёты приходят из app.js на каждом подшаге симуляции (по умолчанию
 * 4 подшага на кадр → 240 Гц). Это честные напряжения узлов, посчитанные
 * решателем: видно разряды RC-цепей, дребезг кнопки, медленные digitalWrite.
 *
 * Про ШИМ честно: 490 Гц при 240 отсчётах/с не разглядеть, поэтому при
 * развёртке ≤ 5 мс/дел канал с ШИМ-выводом рисуется аналитически —
 * идеальным прямоугольником с реальной скважностью (это ровно то, что
 * показывает настоящий осциллограф на ненагруженном выводе).
 */

const BUF = 8192;

export const TIME_DIVS = [0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2];
export const VOLT_DIVS = [0.1, 0.2, 0.5, 1, 2, 5];
const COLORS = ['#4cc9f0', '#ffd166', '#7ef29d', '#ff7b9c'];

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.channels = [0, 1, 2, 3].map((i) => ({
      index: i,
      on: false,
      source: null,       // { boardId, pin, label }
      pwm: null,          // { duty, freq } если вывод в режиме ШИМ
      buf: new Float32Array(BUF),
      head: 0,
      count: 0,
      color: COLORS[i],
    }));
    this.timeDiv = 0.05;    // 50 мс/дел
    this.voltDiv = 1;       // 1 В/дел
    this.sampleRate = 240;  // отсчётов в секунду
    this.paused = false;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 170;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.draw();
  }

  setChannel(i, source) {
    const ch = this.channels[i];
    ch.source = source;
    ch.on = !!source;
    if (source) { ch.head = 0; ch.count = 0; }
  }

  /** values — массив из 4 чисел (или null для выключенного канала). */
  push(values) {
    if (this.paused) return;
    for (const ch of this.channels) {
      const v = values[ch.index];
      if (!ch.on || v === null || v === undefined || Number.isNaN(v)) continue;
      ch.buf[ch.head] = v;
      ch.head = (ch.head + 1) % BUF;
      ch.count = Math.min(BUF, ch.count + 1);
    }
  }

  clear() {
    for (const ch of this.channels) { ch.head = 0; ch.count = 0; }
    this.draw();
  }

  // ------------------------------------------------------------- рисование ----
  draw() {
    const { ctx, w, h } = this;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    // фон
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, 0, w, h);

    const cols = 10, rows = 8;
    const cw = w / cols, chh = h / rows;

    // сетка
    ctx.strokeStyle = '#1c2836';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < cols; i++) { ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h); }
    for (let j = 1; j < rows; j++) { ctx.moveTo(0, j * chh); ctx.lineTo(w, j * chh); }
    ctx.stroke();

    ctx.strokeStyle = '#2b3f54';
    for (let i = 1; i < cols; i += 5) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, h); ctx.stroke(); }
    for (let j = 0; j <= rows; j += 4) { ctx.beginPath(); ctx.moveTo(0, j * chh); ctx.lineTo(w, j * chh); ctx.stroke(); }

    const maxV = rows * this.voltDiv;
    const samplesOnScreen = Math.max(2, Math.round(this.timeDiv * cols * this.sampleRate));

    for (const ch of this.channels) {
      if (!ch.on) continue;
      ch.pwm = ch.source?.pwm || null;
      const analytic = ch.pwm && this.timeDiv <= 0.005;
      if (analytic) this._drawPwm(ch, cw, chh, rows);
      else this._drawSamples(ch, samplesOnScreen, chh, rows);
      this._legend(ch);
    }

    // подписи осей — поверх графика, на своей «полосе», как у настоящего прибора
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(0, h - 15, w, 15);
    ctx.fillStyle = '#5d7790';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`0 В · ${this.voltDiv} В/дел`, 4, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${(this.timeDiv * cols * 1000).toFixed(0)} мс · ${this.timeDiv < 1 ? this.timeDiv * 1000 + ' мс' : this.timeDiv + ' с'}/дел`, w - 4, h - 4);
    ctx.fillText(`${maxV.toFixed(1)} В`, w - 4, 12);
  }

  _drawSamples(ch, n, chh, rows) {
    const { ctx, w, h } = this;
    const total = Math.min(ch.count, n);
    if (total < 2) return;
    const dpr = 1;
    const maxV = rows * this.voltDiv;
    const x0 = w - ((total - 1) / Math.max(1, n - 1)) * w;
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < total; i++) {
      const idx = (ch.head - total + i + BUF * 2) % BUF;
      const v = ch.buf[idx];
      const x = x0 + (i / Math.max(1, n - 1)) * w;
      const y = h - Math.max(0, Math.min(maxV, v)) / maxV * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    void dpr;
  }

  /** Аналитический ШИМ: то, что покажет настоящий осциллограф на выводе. */
  _drawPwm(ch, cw, chh, rows) {
    const { ctx, w, h } = this;
    const maxV = rows * this.voltDiv;
    const duty = ch.pwm.duty;
    const freq = ch.pwm.freq || 490;
    const windowSec = this.timeDiv * 10;
    const periodPx = (1 / freq / windowSec) * w;
    const highPx = periodPx * duty;
    const yHigh = h - Math.min(maxV, ch.pwm.vcc) / maxV * h;
    const yLow = h;
    ctx.strokeStyle = ch.color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let x = 0;
    while (x < w) {
      ctx.moveTo(x, yLow); ctx.lineTo(x, yHigh);
      ctx.lineTo(Math.min(w, x + highPx), yHigh);
      ctx.lineTo(Math.min(w, x + highPx), yLow);
      ctx.lineTo(Math.min(w, x + periodPx), yLow);
      x += periodPx;
    }
    ctx.stroke();
    ctx.fillStyle = ch.color;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`ШИМ ${Math.round(duty * 100)}% ≈${freq} Гц (аналитически)`, w - 4, 26 + ch.index * 12);
  }

  _legend(ch) {
    const { ctx, h } = this;
    const total = Math.min(ch.count, 2048);
    let min = Infinity, max = -Infinity, last = 0;
    for (let i = 0; i < total; i++) {
      const idx = (ch.head - total + i + BUF * 2) % BUF;
      const v = ch.buf[idx];
      if (v < min) min = v;
      if (v > max) max = v;
      last = v;
    }
    const txt = total ? `${ch.source?.label || ''}  ${last.toFixed(2)} В  (${min.toFixed(2)}…${max.toFixed(2)})` : ch.source?.label || '';
    ctx.fillStyle = ch.color;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(txt, 8, 12 + ch.index * 12);
    void h;
  }
}
