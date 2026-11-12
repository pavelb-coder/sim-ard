/**
 * solver.js — решатель электрических цепей методом узловых потенциалов (MNA).
 *
 * Поддерживает: резисторы, идеальные источники напряжения и тока, диоды
 * (кусочно-линейная модель с итерациями Ньютона), конденсаторы и катушки
 * (companion-модели обратного Эйлера для переходных процессов).
 *
 * Формат описания цепи:
 *   {
 *     ground: 'gnd',                       // узел-эталон, 0 В
 *     dt: 0.016,                           // шаг по времени, с
 *     elements: [
 *       { type:'R', n1, n2, value },        // Ом
 *       { type:'V', n1, n2, value },        // В: V(n1) - V(n2) = value
 *       { type:'I', n1, n2, value },        // А, от n1 к n2
 *       { type:'D', n1, n2, vf, ron, roff },// диод: n1 — анод, n2 — катод
 *       { type:'C', n1, n2, value, vprev }, // Ф + напряжение с прошлого шага
 *       { type:'L', n1, n2, value, iprev }, // Гн + ток с прошлого шага
 *     ]
 *   }
 *
 * Возвращает: { ok, v: Map<узел, В>, currents: number[], iterations }
 */

const R_OPEN = 1e9;
const R_SHORT = 1e-3;

export function solveCircuit({ ground = 'gnd', elements = [], dt = 1 / 60, maxIter = 60, tol = 1e-6 } = {}) {
  // --- узлы ---
  const nodes = new Map(); // имя -> индекс 1..N (0 — земля)
  const idxOf = (name) => {
    if (name === undefined || name === null) return 0;
    if (String(name) === String(ground)) return 0;
    const key = String(name);
    let i = nodes.get(key);
    if (i === undefined) { i = nodes.size + 1; nodes.set(key, i); }
    return i;
  };
  const prepared = [];
  for (const el of elements) {
    if (!el || el.value === 0 && el.type !== 'V' && el.type !== 'I') continue;
    const a = idxOf(el.n1), b = idxOf(el.n2);
    if (a === 0 && b === 0 && el.type !== 'V' && el.type !== 'I') continue; // замкнут на себя
    prepared.push({ ...el, a, b, vd: el.vd || 0 });
  }
  // страховка от «висящих» узлов: 100 МОм на землю каждому узлу
  for (let i = 1; i <= nodes.size; i++) prepared.push({ type:'R', a:i, b:0, value:1e8, _shunt:true });

  const sources = prepared.filter(e => e.type === 'V');
  const N = nodes.size, M = sources.length;
  const size = N + M;
  if (size === 0) return { ok: true, v: new Map(), currents: [], iterations: 0 };

  const A = Array.from({ length: size }, () => new Float64Array(size));
  const b = new Float64Array(size);
  const srcIndex = new Map();
  sources.forEach((s, k) => srcIndex.set(s, N + 1 + k));

  const g = (i, j, val) => { if (i > 0 && j > 0) A[i - 1][j - 1] += val; };
  const rhs = (i, val) => { if (i > 0) b[i - 1] += val; };

  let sol = new Float64Array(size);
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < size; i++) { A[i].fill(0); b[i] = 0; }

    for (const el of prepared) {
      const { type, a, b: n2 } = el;
      if (type === 'R') {
        const gg = 1 / Math.max(el.value, R_SHORT);
        g(a, a, gg); g(n2, n2, gg); g(a, n2, -gg); g(n2, a, -gg);
      } else if (type === 'V') {
        const k = srcIndex.get(el);
        g(a, k, 1); g(k, a, 1); g(n2, k, -1); g(k, n2, -1);
        rhs(k, el.value);
      } else if (type === 'I') {
        rhs(a, -el.value); rhs(n2, el.value);
      } else if (type === 'D') {
        const vf = el.vf ?? 1.9, ron = el.ron ?? 10, roff = el.roff ?? 1e7;
        const on = el.vd > vf;
        const gg = 1 / (on ? ron : roff);
        g(a, a, gg); g(n2, n2, gg); g(a, n2, -gg); g(n2, a, -gg);
        if (on) { rhs(a, gg * vf); rhs(n2, -gg * vf); }
      } else if (type === 'C') {
        const gg = el.value / Math.max(dt, 1e-9);
        const vprev = el.vprev || 0;
        g(a, a, gg); g(n2, n2, gg); g(a, n2, -gg); g(n2, a, -gg);
        rhs(a, gg * vprev); rhs(n2, -gg * vprev);
      } else if (type === 'L') {
        const gg = Math.max(dt, 1e-9) / Math.max(el.value, 1e-9);
        g(a, a, gg); g(n2, n2, gg); g(a, n2, -gg); g(n2, a, -gg);
        rhs(a, -(el.iprev || 0)); rhs(n2, el.iprev || 0);
      }
    }

    const next = gauss(A, b, size);
    if (!next) return { ok: false, error: 'Схема не имеет решения (проверьте короткие замыкания)', v: new Map(), currents: [], iterations };

    let delta = 0;
    for (let i = 0; i < size; i++) delta = Math.max(delta, Math.abs(next[i] - sol[i]));
    sol = next;
    iterations = iter + 1;

    // обновляем напряжения на нелинейных элементах
    let changed = false;
    for (const el of prepared) {
      if (el.type !== 'D') continue;
      const va = el.a > 0 ? sol[el.a - 1] : 0;
      const vb = el.b > 0 ? sol[el.b - 1] : 0;
      const vd = va - vb;
      if (Math.abs(vd - el.vd) > 1e-4) { el.vd = vd; changed = true; }
    }
    if (!changed && delta < tol) break;
    if (iter === maxIter - 1) break;
  }

  // --- результаты ---
  const v = new Map([[String(ground), 0]]);
  for (const [name, i] of nodes) v.set(name, sol[i - 1]);

  const currents = prepared.map((el) => {
    const va = el.a > 0 ? sol[el.a - 1] : 0;
    const vb = el.b > 0 ? sol[el.b - 1] : 0;
    if (el._shunt) return 0;
    if (el.type === 'R') return (va - vb) / Math.max(el.value, R_SHORT);
    if (el.type === 'V') return sol[srcIndex.get(el) - 1];
    if (el.type === 'D') {
      const vf = el.vf ?? 1.9;
      return va - vb > vf ? (va - vb - vf) / (el.ron ?? 10) : (va - vb) / (el.roff ?? 1e7);
    }
    if (el.type === 'C') return ((va - vb) - (el.vprev || 0)) * (el.value / Math.max(dt, 1e-9));
    if (el.type === 'L') return (va - vb) * Math.max(dt, 1e-9) / Math.max(el.value, 1e-9) + (el.iprev || 0);
    return 0;
  });

  return { ok: true, v, currents, iterations, list: prepared };
}

/** Гаусс с выбором главного элемента. Возвращает null, если матрица вырождена. */
function gauss(A, b, n) {
  const m = A.map((row, i) => { const r = Array.from(row); r.push(b[i]); return r; });
  for (let col = 0; col < n; col++) {
    let piv = col, best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) { const v = Math.abs(m[r][col]); if (v > best) { best = v; piv = r; } }
    if (best < 1e-12) return null;
    if (piv !== col) { const t = m[piv]; m[piv] = m[col]; m[col] = t; }
    const d = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}
