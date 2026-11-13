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
  enum: 'enum пока не поддерживается — используйте const int',
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
      s += q; i++; push('str', s); continue;
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
  let declConst = false;     // было const — не печатать let
  const braceStack = [];     // 'block' | 'arr' — чтобы закрыть литерал скобкой ]

  const emit = (s) => out.push(s);
  const error = (line, msg) => errors.push({ line, msg });
  const warn = (line, msg) => warnings.push({ line, msg });

  while (i < toks.length) {
    const tk = toks[i];

    if (tk.t === 'nl') { emit('\n'); i++; continue; }

    // ---------- препроцессор ----------
    if (tk.t === 'op' && tk.v === '#') {
      const j = nextMeaningful(toks, i + 1);
      const dir = toks[j] ? toks[j].v : '';
      if (dir === 'include') {
        // #include <Servo.h> — ничего не делаем: классы из libraries.js
        // уже в области видимости, а неизвестный заголовок ловит checkIncludes()
      } else if (dir === 'define') {
        const nameTok = toks[nextMeaningful(toks, j + 1)];
        if (nameTok) {
          emit(`const ${nameTok.v} = `);
          let k = nextMeaningful(toks, nextMeaningful(toks, j + 1) + 1);
          let any = false;
          while (k < toks.length && toks[k].t !== 'nl') {
            emit(toks[k].t === 'str' ? toks[k].v : toks[k].v);
            if (toks[k].t === 'id' || toks[k].t === 'op') emit(' ');
            any = true; k++;
          }
          emit(any ? ';\n' : 'undefined;\n');
        }
      } else if (dir !== '') {
        warn(tk.line, `Директива #${dir} пропущена`);
      }
      // проматываем до конца строки
      while (i < toks.length && toks[i].t !== 'nl') i++;
      continue;
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
      if (tk.v === 'const') { emit('const '); declConst = true; pendingType = true; i++; continue; }
      pendingType = true;
      i++;
      // мусор после типа: указатели/ссылки
      let k = nextMeaningful(toks, i);
      if (toks[k] && toks[k].t === 'op' && (toks[k].v === '*' || toks[k].v === '&')) {
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
