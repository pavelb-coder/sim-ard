/**
 * transpiler.js — превращает скетч Arduino C++ (подмножество) в JavaScript.
 *
 * Это НЕ компилятор C++ и не эмулятор AVR: скетч переводится в JS и
 * исполняется интерпретатором браузера. Номера строк сохраняются один к
 * одному, поэтому ошибки указывают на строку в исходнике школьника.
 *
 * Что умеет:
 *   - void setup() / void loop() и свои функции (все становятся async);
 *   - объявления int/float/long/unsigned/bool/char/String/byte + массивы;
 *   - if/else/for/while/do, switch, break/continue, тернарный оператор;
 *   - pinMode, digitalWrite, digitalRead, analogRead, analogWrite, tone,
 *     delay (превращается в await), millis, micros, map, constrain, random…
 *   - Serial.begin/print/println/write/flush;
 *   - #include отбрасывается (библиотеки не поддерживаются), #define → const.
 *
 * Чего не умеет (и честно об этом сообщает): указатели, структуры, классы,
 * шаблоны, препроцессор с условиями, подключение внешних библиотек.
 */

const TYPES = new Set([
  'void', 'int', 'float', 'double', 'long', 'short', 'char', 'bool', 'boolean',
  'byte', 'word', 'unsigned', 'signed', 'const', 'static', 'volatile', 'String',
  'size_t', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t',
  'uint64_t', 'int64_t', 'auto', 'register', 'inline',
]);

const UNSUPPORTED = {
  class: 'классы не поддерживаются',
  struct: 'структуры не поддерживаются',
  template: 'шаблоны не поддерживаются',
  goto: 'goto не поддерживается',
  typedef: 'typedef не поддерживается',
  namespace: 'namespace не поддерживается',
};

/** Классы из libraries.js: их можно объявлять как в скетче — Servo myservo; */
const LIB_CLASSES = new Set([
  'Servo', 'DHT', 'DHT11', 'Stepper', 'LiquidCrystal_I2C', 'Adafruit_SSD1306', 'Wire', 'TwoWire',
]);

/** new Array(m).fill(0) для последней размерности. */
function initRest(dims, d) {
  if (d >= dims.length - 1) return '.fill(0)';
  return `.fill(0).map(() => new Array(${dims[d + 1]})${initRest(dims, d + 1)})`;
}
function mkRest(dims, d) { return initRest(dims, d); }

/** Типы, к которым можно приводить: (int)x, (byte)x, (float)x … */
const CAST_INFO = {
  int: 'i32', int16_t: 'i32', int32_t: 'i32', long: 'i32', short: 'i32', word: 'i32',
  uint16_t: 'i32', uint32_t: 'i32', size_t: 'i32', unsigned: 'i32', signed: 'i32',
  byte: 'b8', uint8_t: 'b8', char: 'chr',
  float: 'num', double: 'num',
  bool: 'bool', boolean: 'bool',
  String: 'str',
};

/** Размеры типов в байтах — для sizeof(int) и подобных. */
const TYPE_BYTES = {
  int: 2, short: 2, word: 2, unsigned: 2, uint16_t: 2, int16_t: 2,
  long: 4, unsigned_long: 4, uint32_t: 4, int32_t: 4, float: 4, double: 4,
  char: 1, byte: 1, uint8_t: 1, int8_t: 1, bool: 1, boolean: 1, size_t: 2,
};

/**
 * Читает «операнд» — то, к чему применяется приведение типа:
 * имя, число, вызов, элемент массива, поле, отрицание, скобки и хвосты [i], (…), .f.
 * Возвращает { end, text } — индекс сразу за операндом и его текст.
 */
function readOperand(toks, start) {
  let i = start;
  const text = [];
  const push = (t) => text.push(t.v);
  const skip = () => { while (i < toks.length && toks[i].t === 'nl') i++; };
  skip();
  let unary = 0;
  while (i < toks.length && toks[i].t === 'op' && ['-', '+', '!', '~', '++', '--'].includes(toks[i].v) && unary < 3) {
    push(toks[i]); i++; skip(); unary++;
  }
  if (i >= toks.length) return { end: i, text: text.join(' ') };
  const t0 = toks[i];
  if (t0.t === 'op' && t0.v === '(') {
    let depth = 0;
    while (i < toks.length) {
      const q = toks[i];
      if (q.t === 'op' && q.v === '(') depth++;
      if (q.t === 'op' && q.v === ')') { depth--; push(q); i++; if (!depth) break; continue; }
      push(q); i++;
    }
  } else if (t0.t === 'id' || t0.t === 'num' || t0.t === 'str') {
    push(t0); i++;
  } else {
    return { end: i, text: text.join(' ') };
  }
  // хвосты: [i], (…), .поле, ++/--
  for (;;) {
    let k = i;
    while (k < toks.length && toks[k].t === 'nl') k++;
    const q = toks[k];
    if (!q || q.t !== 'op') break;
    if (q.v === '[') {
      let depth = 0;
      for (; k < toks.length; k++) {
        const r = toks[k];
        if (r.t === 'op' && r.v === '[') depth++;
        if (r.t === 'op' && r.v === ']') { depth--; push(r); k++; if (!depth) break; continue; }
        push(r);
      }
      i = k;
    } else if (q.v === '(') {
      let depth = 0;
      for (; k < toks.length; k++) {
        const r = toks[k];
        if (r.t === 'op' && r.v === '(') depth++;
        if (r.t === 'op' && r.v === ')') { depth--; push(r); k++; if (!depth) break; continue; }
        push(r);
      }
      i = k;
    } else if (q.v === '.') {
      push(q); k++;
      while (k < toks.length && toks[k].t === 'nl') k++;
      if (toks[k]) { push(toks[k]); k++; }
      i = k;
    } else if (q.v === '++' || q.v === '--') {
      push(q); i = k + 1;
    } else break;
  }
  return { end: i, text: text.join(' ') };
}

/** Склеивает токены аргументов, вставляя пробел только между словами. */
function joinToks(list) {
  let out = '';
  for (const t of list) {
    if (out && /[A-Za-z0-9_$]$/.test(out) && /^[A-Za-z0-9_$]/.test(String(t.v))) out += ' ';
    out += t.v;
  }
  return out;
}

export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1;
  const push = (t, v) => toks.push({ t, v, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push('nl', '\n'); line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') { push('nl', '\n'); line++; }
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c; let s = q; i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') { s += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === '\n') break;
        s += src[i++];
      }
      s += q; i++;
      // В C++ 'r' — это число (код символа 114), а не строка. Так же, как в
      // железе, работает switch (c) { case 'r': … } после Serial.read().
      const single = /^'(\\.|[^'\\])'$/.exec(s);
      if (single) {
        const code = { '\\n': 10, '\\t': 9, '\\r': 13, '\\0': 0, "\\'": 39, '\\\\': 92 }[single[1]]
          ?? single[1].charCodeAt(0);
        push('num', String(code));
        continue;
      }
      push('str', s); continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = '';
      while (i < src.length && /[0-9a-fA-FxXbB._ULul]/.test(src[i])) s += src[i++];
      push('num', s.replace(/[ULul]+$/, ''));
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_$]/.test(src[i])) s += src[i++];
      push('id', s);
      continue;
    }
    const three = src.substr(i, 3), two = src.substr(i, 2);
    if (three === '<<=' || three === '>>=') { push('op', three); i += 3; continue; }
    if (['==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '->', '::'].includes(two)) {
      push('op', two); i += 2; continue;
    }
    push('op', c); i++;
  }
  return toks;
}

const nextMeaningful = (toks, i) => {
  while (i < toks.length && toks[i].t === 'nl') i++;
  return i;
};
const prevMeaningful = (toks, i) => {
  let j = i - 1;
  while (j >= 0 && toks[j].t === 'nl') j--;
  return j;
};

export function transpile(source) {
  const errors = [];
  const warnings = [];
  const toks = tokenize(source);
  const out = [];
  let i = 0;
  let pendingType = false;   // ждём имя переменной после типа
  let lastTypes = [];        // слова последнего объявления (const char …)
  let declConst = false;     // было const — не печатать let
  const braceStack = [];     // 'block' | 'arr' — чтобы закрыть литерал скобкой ]
  const condStack = [];      // [{ active, taken }] — вложенные #if/#ifdef
  const macros = new Set(['ARDUINO']);   // имена из #define (для #ifdef)
  const macroFns = new Map();            // из них — с параметрами: имя → сколько аргументов
  const enumNames = new Set();           // имена enum, чтобы не спутать с переменными

  // Свои функции компилируются в async, поэтому и вызовы надо ждать:
  // иначе «char k = scan();» получит промис вместо символа.
  // Имена собираем заранее — функция может вызываться до объявления.
  const userFns = new Set();
  for (let a = 0; a < toks.length; a++) {
    const t = toks[a];
    if (!(t.t === 'id' && TYPES.has(t.v))) continue;
    const j = nextMeaningful(toks, a + 1);
    const nameTok = toks[j];
    if (!nameTok || nameTok.t !== 'id' || TYPES.has(nameTok.v)) continue;
    const k = nextMeaningful(toks, j + 1);
    if (!(toks[k] && toks[k].t === 'op' && toks[k].v === '(')) continue;
    let depth = 0, m = k;
    for (; m < toks.length; m++) {
      const q = toks[m];
      if (q.t === 'nl') continue;
      if (q.t === 'op' && q.v === '(') depth++;
      if (q.t === 'op' && q.v === ')') { depth--; if (!depth) break; }
    }
    const after = toks[nextMeaningful(toks, m + 1)];
    if (after && after.t === 'op' && (after.v === '{' || after.v === ';')) userFns.add(nameTok.v);
  }

  const emit = (s) => out.push(s);
  const error = (line, msg) => errors.push({ line, msg });
  const warn = (line, msg) => warnings.push({ line, msg });

  /** index первого перевода строки после from (чтобы «съесть» директиву целиком) */
  const lineEndIndex = (from) => {
    let k = from;
    while (k < toks.length && toks[k].t !== 'nl') k++;
    return k;
  };

  /** Условие препроцессора: defined(NAME), числа и простая арифметика. */
  const evalCondition = (list) => {
    let src = list.map((t) => t.v).join(' ').trim();
    if (!src) return false;
    src = src.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/g,
      (m, n) => (macros.has(n) || macroFns.has(n) ? '1' : '0'));
    if (!/^[0-9+\-*/%<>=!&|() .\t]*$/.test(src)) return true;   // не разобрали — считаем истиной
    try { return !!Function(`"use strict"; return (${src || '1'});`)(); } catch { return true; }
  };

  while (i < toks.length) {
    const tk = toks[i];

    if (tk.t === 'nl') { emit('\n'); i++; continue; }

    // ---------- препроцессор ----------
    if (tk.t === 'op' && tk.v === '#') {
      const j = nextMeaningful(toks, i + 1);
      const dir = toks[j] ? toks[j].v : '';
      const endOfLine = () => { while (i < toks.length && toks[i].t !== 'nl') i++; };
      const restOfLine = (from) => {
        const out = [];
        let k = from;
        while (k < toks.length && toks[k].t !== 'nl') { out.push(toks[k]); k++; }
        return out;
      };

      // --- #if / #ifdef / #ifndef / #elif / #else / #endif ---
      if (dir === 'if' || dir === 'ifdef' || dir === 'ifndef') {
        let cond;
        if (dir === 'ifdef' || dir === 'ifndef') {
          const nameTok = toks[nextMeaningful(toks, j + 1)];
          const has = !!(nameTok && macros.has(nameTok.v));
          cond = dir === 'ifdef' ? has : !has;
        } else {
          cond = evalCondition(restOfLine(nextMeaningful(toks, j + 1)));
        }
        condStack.push({ active: cond, taken: cond });
        i = lineEndIndex(i);
        continue;
      }
      if (dir === 'elif' || dir === 'else' || dir === 'endif') {
        const top = condStack[condStack.length - 1];
        if (!top) {
          warn(tk.line, `#${dir} без #if`);
        } else if (dir === 'endif') {
          condStack.pop();
        } else if (dir === 'else') {
          top.active = !top.taken;
          top.taken = true;
        } else {
          const cond = !top.taken && evalCondition(restOfLine(nextMeaningful(toks, j + 1)));
          top.active = cond;
          if (cond) top.taken = true;
        }
        i = lineEndIndex(i);
        continue;
      }

      // внутри выключенной ветки остальное просто пропускаем
      if (condStack.some((c) => !c.active)) {
        endOfLine();
        continue;
      }

      if (dir === 'include') {
        // #include <Servo.h> — ничего не делаем: классы из libraries.js
        // уже в области видимости, а неизвестный заголовок ловит checkIncludes()
      } else if (dir === 'define') {
        const nameIdx = nextMeaningful(toks, j + 1);
        const nameTok = toks[nameIdx];
        if (nameTok) {
          macros.add(nameTok.v);
          const rawNext = toks[nameIdx + 1];          // без перескока через перевод строки
          const afterName = nextMeaningful(toks, nameIdx + 1);
          // макрос с параметрами: #define SQ(x) ((x)*(x))  →  const SQ = (x) => ((x)*(x));
          const looksFn = rawNext && rawNext.t === 'op' && rawNext.v === '(';
          if (looksFn) {
            const params = [];
            let k = nextMeaningful(toks, nameIdx + 1) + 1;   // после '('
            let depth = 1;
            for (; k < toks.length && toks[k].t !== 'nl'; k++) {
              const q = toks[k];
              if (q.t === 'op' && q.v === '(') depth++;
              if (q.t === 'op' && q.v === ')') { depth--; if (!depth) { k++; break; } }
              if (q.t === 'op' && q.v === ',') continue;
              if (q.t === 'id' && TYPES.has(q.v)) continue;
              if (q.t !== 'nl') params.push(q.v);
            }
            const body = restOfLine(k).map((q) => q.v).join(' ');
            macroFns.set(nameTok.v, params.length);
            emit(`const ${nameTok.v} = (${params.join(', ')}) => (${body || 'undefined'});\n`);
          } else {
            const valueToks = rawNext && rawNext.t === 'nl' ? [] : restOfLine(nameIdx + 1);
            emit(`const ${nameTok.v} = ${valueToks.length ? valueToks.map((q) => q.v).join(' ') : 'true'};\n`);
          }
        }
      } else if (dir === 'undef') {
        const nameTok = toks[nextMeaningful(toks, j + 1)];
        if (nameTok) { macros.delete(nameTok.v); macroFns.delete(nameTok.v); }
      } else if (dir === 'error') {
        const msg = restOfLine(nextMeaningful(toks, j + 1)).map((q) => q.v).join(' ');
        error(tk.line, `#error ${msg}`.trim());
      } else if (dir === 'warning') {
        warn(tk.line, restOfLine(nextMeaningful(toks, j + 1)).map((q) => q.v).join(' '));
      } else if (dir !== 'pragma' && dir !== '') {
        warn(tk.line, `Директива #${dir} пропущена`);
      }
      endOfLine();
      continue;
    }

    // всё, что попало в выключенную ветку #if, не компилируем
    if (condStack.some((c) => !c.active)) {
      if (tk.t === 'nl') emit('\n');
      i++;
      continue;
    }

    // ---------- enum { A, B = 5, C }; ----------
    if (tk.t === 'id' && tk.v === 'enum') {
      let k = nextMeaningful(toks, i + 1);
      let enumName = null;
      if (toks[k] && toks[k].t === 'id' && toks[k].v !== '{') { enumName = toks[k].v; k = nextMeaningful(toks, k + 1); }
      if (!toks[k] || toks[k].v !== '{') {
        error(tk.line, 'enum без списка значений');
        i++;
        continue;
      }
      const entries = [];
      let next = 0;
      k = nextMeaningful(toks, k + 1);
      while (k < toks.length && !(toks[k].t === 'op' && toks[k].v === '}')) {
        if (toks[k].t === 'id') {
          const nm = toks[k].v;
          let exprTxt = null;
          let value = next;
          let q = nextMeaningful(toks, k + 1);
          if (toks[q] && toks[q].t === 'op' && toks[q].v === '=') {
            const parts = [];
            q = nextMeaningful(toks, q + 1);
            while (q < toks.length && !(toks[q].t === 'op' && (toks[q].v === ',' || toks[q].v === '}'))) {
              parts.push(toks[q].v);
              q = nextMeaningful(toks, q + 1);
            }
            exprTxt = parts.join(' ');
            const num = Number(exprTxt);
            if (Number.isFinite(num)) { value = num; next = num + 1; } else { value = null; }
          } else {
            next += 1;
          }
          entries.push({ name: nm, value, exprTxt });
          enumNames.add(nm);
          k = nextMeaningful(toks, q);
        } else {
          k = nextMeaningful(toks, k + 1);
        }
      }
      for (const e of entries) {
        emit(`const ${e.name} = ${e.value !== null ? e.value : `(${e.exprTxt})`};`);
      }
      if (enumName) {
        const obj = entries.map((e) => `${e.name}: ${e.value !== null ? e.value : `(${e.exprTxt})`}`).join(', ');
        emit(`const ${enumName} = { ${obj} };`);
      }
      emit('\n');
      // проматываем до '}' и, если есть, ';'
      let m = k;
      while (m < toks.length && !(toks[m].t === 'op' && toks[m].v === '}')) m++;
      m = nextMeaningful(toks, m + 1);
      if (toks[m] && toks[m].t === 'op' && toks[m].v === ';') m++;
      i = m;
      continue;
    }

    // ---------- String(x) / String(x, HEX) ----------
    if (tk.t === 'id' && tk.v === 'String') {
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (nx && nx.t === 'op' && nx.v === '(') { emit('rt.str'); i++; continue; }
    }

    // ---------- неподдерживаемое ----------
    if (tk.t === 'id' && UNSUPPORTED[tk.v] && toks[nextMeaningful(toks, i + 1)]?.v !== '.') {
      error(tk.line, UNSUPPORTED[tk.v]);
      i++; continue;
    }

    // ---------- объекты библиотек: Servo myservo; DHT dht(2); ----------
    if (tk.t === 'id' && LIB_CLASSES.has(tk.v)) {
      const j = nextMeaningful(toks, i + 1);
      const nameTok = toks[j];
      if (nameTok && nameTok.t === 'id' && !TYPES.has(nameTok.v)) {
        let args = '';
        let after = nextMeaningful(toks, j + 1);
        if (toks[after] && toks[after].t === 'op' && toks[after].v === '(') {
          const argToks = [];
          let depth = 0, m = after;
          for (; m < toks.length; m++) {
            const t = toks[m];
            if (t.t === 'nl') continue;
            if (t.t === 'op' && t.v === '(') { depth++; if (depth === 1) continue; }
            if (t.t === 'op' && t.v === ')') { depth--; if (depth === 0) break; }
            argToks.push(t);
          }
          args = joinToks(argToks);
          after = nextMeaningful(toks, m + 1);
        }
        emit(`const ${nameTok.v} = new ${tk.v}(${args});`);
        i = (toks[after] && toks[after].t === 'op' && toks[after].v === ';') ? after + 1 : Math.max(after, j + 1);
        pendingType = false; declConst = false;
        continue;
      }
    }

    // ---------- типы и объявления ----------
    if (tk.t === 'id' && TYPES.has(tk.v)) {
      lastTypes.push(tk.v);
      if (tk.v === 'const') { emit('const '); declConst = true; pendingType = true; i++; continue; }
      pendingType = true;
      i++;
      // указатели: char*/const char* — это просто строка, остальное не умеем
      let k = nextMeaningful(toks, i);
      if (toks[k] && toks[k].t === 'op' && (toks[k].v === '*' || toks[k].v === '&')) {
        const isChar = tk.v === 'char' || lastTypes.includes('char');
        if (isChar && toks[k].v === '*') {
          i = k + 1;                       // пропускаем звёздочку, дальше обычное имя
          continue;
        }
        error(tk.line, 'указатели и ссылки не поддерживаются');
      }
      continue;
    }

    if (tk.t === 'id' && pendingType) {
      // что идёт после имени: '(' → функция, иначе переменная
      const k = nextMeaningful(toks, i + 1);
      const after = toks[k];
      const name = tk.v;

      if (after && after.t === 'op' && after.v === '(') {
        // параметры: копируем, вырезая типы
        const params = [];
        let depthP = 0, j = k;
        let paramTokens = [];
        for (; j < toks.length; j++) {
          const t = toks[j];
          if (t.t === 'nl') continue;
          if (t.t === 'op' && t.v === '(') { depthP++; if (depthP === 1) continue; }
          if (t.t === 'op' && t.v === ')') { depthP--; if (depthP === 0) break; }
          paramTokens.push(t);
        }
        // режем параметры по запятым верхнего уровня
        const groups = [[]];
        let pd = 0;
        for (const t of paramTokens) {
          if (t.t === 'op' && (t.v === '(' || t.v === '[')) pd++;
          if (t.t === 'op' && (t.v === ')' || t.v === ']')) pd--;
          if (t.t === 'op' && t.v === ',' && pd === 0) groups.push([]);
          else groups[groups.length - 1].push(t);
        }
        for (const grp of groups) {
          const cleaned = grp.filter((t) => !(t.t === 'id' && TYPES.has(t.v)) && !(t.t === 'op' && (t.v === '*' || t.v === '&')));
          if (cleaned.length && !(cleaned.length === 1 && cleaned[0].v === 'void')) params.push(cleaned.map((t) => t.v).join(''));
        }
        const afterParams = toks[nextMeaningful(toks, j + 1)];
        if (afterParams && afterParams.t === 'op' && afterParams.v === ';') {
          // прототип функции — не нужен
          i = nextMeaningful(toks, j + 1) + 1;
          pendingType = false; declConst = false;
          continue;
        }
        emit(`async function ${name}(${params.join(', ')}) `);
        i = j + 1;
        pendingType = false; declConst = false;
        continue;
      }

      emit(declConst ? '' : 'let ');
      emit(name);
      pendingType = false; declConst = false;
      i++;

      // массив: int a[3]; или int a[] = {1,2,3};
      const b1 = nextMeaningful(toks, i);
      if (toks[b1] && toks[b1].t === 'op' && toks[b1].v === '[') {
        // размерности: int a[3]; int m[2][3]; (любое число измерений)
        const dims = [];
        let j = b1, k = b1;
        while (toks[j] && toks[j].t === 'op' && toks[j].v === '[') {
          let size = '';
          k = j + 1;
          while (k < toks.length && !(toks[k].t === 'op' && toks[k].v === ']')) { size += toks[k].v; k++; }
          dims.push(size.trim() || '1');
          j = nextMeaningful(toks, k + 1);
        }
        const b2 = j;
        if (toks[b2] && toks[b2].t === 'op' && toks[b2].v === '=') {
          emit(' = ');
          i = b2 + 1;
          const b3 = nextMeaningful(toks, i);
          if (toks[b3] && toks[b3].v === '{') { i = b3 + 1; emit('['); braceStack.push('arr'); }
        } else {
          // без инициализатора — нули нужной формы
          const expr = `new Array(${dims[0]})${initRest(dims, 0)}`;
          emit(` = ${dims.length === 1 ? `new Array(${dims[0]}).fill(0)` : expr}`);
          i = k + 1;
        }
      }
      continue;
    }

    // ---------- yield() — отдать управление (у нас это пустой вызов) ----------
    if (tk.t === 'id' && tk.v === 'yield') {
      const p0 = prevMeaningful(toks, i);
      const isMember = p0 >= 0 && toks[p0].t === 'op' && toks[p0].v === '.';
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (!isMember && nx && nx.t === 'op' && nx.v === '(') { emit('rt.yield'); i++; continue; }
    }

    // ---------- макрос с параметрами: следим за числом аргументов ----------
    if (tk.t === 'id' && macroFns.has(tk.v) && tk.v !== 'yield') {
      const po = nextMeaningful(toks, i + 1);
      if (toks[po] && toks[po].t === 'op' && toks[po].v === '(') {
        let depth = 0, n = 1, empty = true;
        for (let k = po; k < toks.length; k++) {
          const t = toks[k];
          if (t.t === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) { depth++; continue; }
          if (t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) { depth--; if (!depth) break; continue; }
          if (t.t === 'op' && t.v === ',' && depth === 1) { n++; continue; }
          if (t.t !== 'nl') empty = false;
        }
        const need = macroFns.get(tk.v);
        const got = empty ? 0 : n;
        if (got !== need) error(tk.line, `Макрос ${tk.v} ждёт ${need} арг., а получил ${got}`);
      }
    }

    // ---------- for (int x : массив) → for (let x of массив) ----------
    if (tk.t === 'id' && tk.v === 'for') {
      const po = nextMeaningful(toks, i + 1);
      if (toks[po] && toks[po].t === 'op' && toks[po].v === '(') {
        let depth = 0, colon = -1, semi = false;
        for (let k = po; k < toks.length; k++) {
          const t = toks[k];
          if (t.t === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) { depth++; continue; }
          if (t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) { depth--; if (!depth) break; continue; }
          if (depth !== 1) continue;
          if (t.t === 'op' && t.v === ';') { semi = true; break; }
          if (t.t === 'op' && t.v === ':') colon = k;
        }
        if (colon > 0 && !semi) {
          const ids = [];
          for (let k = po + 1; k < colon; k++) if (toks[k].t === 'id') ids.push(toks[k].v);
          const name = ids[ids.length - 1];
          if (name) {
            emit(`for (let ${name} of `);
            i = colon + 1;
            continue;
          }
        }
      }
    }

    // ---------- delay → await ----------
    if (tk.t === 'id' && (tk.v === 'delay' || tk.v === 'delayMicroseconds')) {
      const p = prevMeaningful(toks, i);
      const isMember = p >= 0 && toks[p].t === 'op' && toks[p].v === '.';
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (!isMember && nx && nx.v === '(') {
        emit(`await rt.${tk.v}`);
        i++;
        continue;
      }
    }

    // ---------- фигурные скобки массивов {1,2,3} → [1,2,3] ----------
    if (tk.t === 'op' && (tk.v === '{' || tk.v === '}')) {
      if (tk.v === '{') {
        // литерал массива встречается после '=' или ',' — блок кода после ')' или '{'
        const p = prevMeaningful(toks, i);
        // вложенные фигурные скобки внутри литерала массива — тоже массив
        const inArray = braceStack[braceStack.length - 1] === 'arr';
        const isLiteral = inArray
          || (p >= 0 && toks[p].t === 'op' && (toks[p].v === '=' || toks[p].v === ',' || toks[p].v === '['));
        braceStack.push(isLiteral ? 'arr' : 'block');
        emit(isLiteral ? '[' : '{');
        i++;
        continue;
      }
      const kind = braceStack.pop() || 'block';
      emit(kind === 'arr' ? ']' : '}');
      i++;
      continue;
    }

    if (tk.t === 'str') { emit(tk.v); i++; continue; }
    if (tk.t === 'num') { emit(tk.v); i++; continue; }

    // ---------- sizeof(x) / sizeof(int) ----------
    if (tk.t === 'id' && tk.v === 'sizeof') {
      const open = nextMeaningful(toks, i + 1);
      if (toks[open] && toks[open].t === 'op' && toks[open].v === '(') {
        const first = nextMeaningful(toks, open + 1);
        let q = first;
        let typeName = '';
        while (toks[q] && toks[q].t === 'id' && TYPES.has(toks[q].v)) {
          typeName += (typeName ? '_' : '') + toks[q].v;
          q = nextMeaningful(toks, q + 1);
        }
        if (typeName && toks[q] && toks[q].t === 'op' && toks[q].v === ')') {
          const bytes = TYPE_BYTES[typeName] ?? TYPE_BYTES[typeName.replace(/^unsigned_/, 'unsigned_')] ?? 4;
          emit(String(bytes));
          i = nextMeaningful(toks, q + 1);
          continue;
        }
        // sizeof(выражение) — считаем длину массива в элементах
        const operand = readOperand(toks, open + 1);
        let endPos = operand.end;
        const closePos = nextMeaningful(toks, endPos);
        if (toks[closePos] && toks[closePos].t === 'op' && toks[closePos].v === ')') endPos = nextMeaningful(toks, closePos + 1);
        emit(`rt.sizeof(${operand.text})`);
        i = endPos;
        continue;
      }
    }

    // ---------- приведение типа: (int)x, (byte)x, (float)x ----------
    if (tk.t === 'op' && tk.v === '(') {
      const typeIdx = nextMeaningful(toks, i + 1);
      const t1 = toks[typeIdx];
      if (t1 && t1.t === 'id') {
        let k = typeIdx;
        let words = [];
        while (toks[k] && toks[k].t === 'id' && TYPES.has(toks[k].v)) {
          words.push(toks[k].v);
          k = nextMeaningful(toks, k + 1);
        }
        const closeIdx = k;
        const key = words.join('_').replace(/^(const|static|volatile|auto|register|inline)_?/, '');
        const info = CAST_INFO[key] || CAST_INFO[words[words.length - 1]];
        const closeOk = toks[closeIdx] && toks[closeIdx].t === 'op' && toks[closeIdx].v === ')';
        if (info && closeOk && words.length) {
          const afterCast = nextMeaningful(toks, closeIdx + 1);
          const nt = toks[afterCast];
          const operandStarts = nt && (nt.t === 'id' || nt.t === 'num' || nt.t === 'str'
            || (nt.t === 'op' && ['(', '-', '+', '!', '~'].includes(nt.v)));
          if (operandStarts) {
            const operand = readOperand(toks, closeIdx + 1);
            const v = operand.text;
            const wrap = {
              i32: `rt.i32(${v})`,
              b8: `rt.b8(${v})`,
              chr: `rt.chr(${v})`,
              num: `Number(${v})`,
              bool: `!!(${v})`,
              str: `rt.str(${v})`,
            }[info];
            emit(wrap);
            i = operand.end;
            continue;
          }
        }
      }
    }

    // ---------- F("текст") — строка во флеш-памяти, для нас просто строка ----------
    if (tk.t === 'id' && tk.v === 'F') {
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (nx && nx.t === 'op' && nx.v === '(') { i++; continue; }
    }

    // ---------- .length() — в Arduino это метод, в JS — свойство ----------
    if (tk.t === 'op' && tk.v === '.') {
      const nameIdx = nextMeaningful(toks, i + 1);
      const nm = toks[nameIdx];
      if (nm && nm.t === 'id' && nm.v === 'length') {
        const p1 = nextMeaningful(toks, nameIdx + 1);
        const p2 = p1 < toks.length ? nextMeaningful(toks, p1 + 1) : -1;
        if (toks[p1] && toks[p1].v === '(' && toks[p2] && toks[p2].v === ')') {
          emit('.length');
          i = nextMeaningful(toks, p2 + 1);
          continue;
        }
      }
    }

    // ---------- вызов своей функции ----------
    if (tk.t === 'id' && userFns.has(tk.v)) {
      const p = prevMeaningful(toks, i);
      const isMember = p >= 0 && toks[p].t === 'op' && toks[p].v === '.';
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (!isMember && nx && nx.t === 'op' && nx.v === '(') {
        emit(`await ${tk.v}`);
        i++;
        continue;
      }
    }

    // ---------- всё остальное ----------
    emit(tk.v);
    if (tk.t === 'id') {
      const nx = toks[nextMeaningful(toks, i + 1)];
      if (!(nx && nx.t === 'op' && (nx.v === '(' || nx.v === '.' || nx.v === '['))) emit(' ');
    } else {
      emit(' ');
    }
    i++;
  }

  const js = out.join('');
  if (errors.length === 0 && !/async function\s+setup\s*\(/.test(js)) {
    errors.push({ line: 1, msg: 'Не найден setup() — любой скетч Arduino начинается с void setup() { … }' });
  }
  if (errors.length === 0 && !/async function\s+loop\s*\(/.test(js)) {
    warnings.push({ line: 1, msg: 'Нет loop() — скетч выполнится один раз' });
  }
  return { js, errors, warnings };
}

/** Проверка баланса скобок — подсказывает строку, где скетч «сломался». */
export function bracketHint(js) {
  const stack = [];
  let line = 1;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < js.length; i++) {
    const c = js[i];
    if (c === '\n') line++;
    if ('([{'.includes(c)) stack.push({ c, line });
    if (')]}'.includes(c)) {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) return { line, msg: `лишняя или непарная «${c}»` };
    }
  }
  if (stack.length) return { line: stack[stack.length - 1].line, msg: `не закрыта «${stack[stack.length - 1].c}»` };
  return null;
}
