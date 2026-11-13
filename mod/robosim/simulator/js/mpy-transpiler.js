/**
 * mpy-transpiler.js — MicroPython → JavaScript.
 *
 * Нужен для Raspberry Pi Pico: школьный код на MicroPython переводится в JS
 * построчно (отступы → фигурные скобки), а вызовы machine/time уходят в
 * рантайм. Это подмножество, а не полный Python: нет классов, генераторов,
 * срезов и исключений — про каждое такое место транслятор честно скажет.
 *
 * Карта строк (lineMap) позволяет показать ошибку на строке исходника,
 * даже если после раскрытия блоков строк в JS стало больше.
 */

const MODULES = new Set(['machine', 'time', 'utime', 'math', 'random', 'sys', 'gc']);

export function transpilePython(source) {
  const errors = [];
  const warnings = [];
  const out = [];
  const lineMap = [];
  const declared = new Set();
  const functions = new Set();

  const src = source.split('\n');

  // первый проход: имена функций (их вызовы надо будет await-ить)
  for (const raw of src) {
    const m = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(raw);
    if (m) functions.add(m[1]);
  }

  const stack = [];       // уровни отступа открытых блоков
  let blockReturnNeeded = false;

  const emit = (srcLine, text) => {
    for (const part of String(text).split('\n')) {
      out.push(part);
      lineMap.push(srcLine);
    }
  };

  const closeTo = (indent) => {
    while (stack.length && indent <= stack[stack.length - 1]) {
      stack.pop();
      emit(0, '}');
    }
  };

  for (let i = 0; i < src.length; i++) {
    const lineNo = i + 1;
    const raw = src[i].replace(/\t/g, '    ');
    const withoutComment = stripComment(raw);
    if (!withoutComment.trim()) { emit(lineNo, ''); continue; }

    const indent = withoutComment.length - withoutComment.trimStart().length;
    const text = withoutComment.trim();

    closeTo(indent);

    // ---- блоки ----
    let m;

    if ((m = /^def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*:?$/.exec(text))) {
      const params = m[2].split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).join(', ');
      emit(lineNo, `async function ${m[1]}(${params}) {`);
      stack.push(indent);
      continue;
    }
    if ((m = /^if\s+(.+):$/.exec(text))) {
      emit(lineNo, `if (${expr(m[1], lineNo)}) {`);
      stack.push(indent); continue;
    }
    if ((m = /^elif\s+(.+):$/.exec(text))) {
      emit(lineNo, `else if (${expr(m[1], lineNo)}) {`);
      stack.push(indent); continue;
    }
    if (/^else\s*:$/.test(text)) {
      emit(lineNo, 'else {');
      stack.push(indent); continue;
    }
    if ((m = /^while\s+(.+):$/.exec(text))) {
      const cond = m[1].trim() === 'True' ? '!rt.stopped' : expr(m[1], lineNo);
      emit(lineNo, `while (${cond}) {`);
      stack.push(indent); continue;
    }
    if ((m = /^for\s+([A-Za-z_]\w*)\s+in\s+range\s*\((.*)\)\s*:$/.exec(text))) {
      const args = m[2].split(',').map((a) => a.trim());
      const v = m[1];
      const from = expr(args[0] ?? '0', lineNo);
      const to = expr(args[1] ?? args[0] ?? '0', lineNo);
      const step = args[2] ? expr(args[2], lineNo) : '1';
      const cmp = args[2] && /^-/.test(args[2].trim()) ? '>' : '<';
      emit(lineNo, `for (let ${v} = ${from}; ${v} ${cmp} ${to}; ${v} += ${step}) {`);
      stack.push(indent); continue;
    }
    if ((m = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text))) {
      emit(lineNo, `for (const ${m[1]} of ${expr(m[2], lineNo)}) {`);
      stack.push(indent); continue;
    }
    if (/^try\s*:$/.test(text) || /^except/.test(text) || /^finally\s*:$/.test(text)) {
      errors.push({ line: lineNo, msg: 'try/except в MicroPython-трансляторе не поддерживается' });
      stack.push(indent);
      continue;
    }
    if (/^class\s+/.test(text)) {
      errors.push({ line: lineNo, msg: 'классы в MicroPython-трансляторе не поддерживаются' });
      continue;
    }

    // ---- импорты ----
    if (/^import\s+/.test(text)) {
      const mod = text.replace(/^import\s+/, '').split(',')[0].trim();
      if (!MODULES.has(mod)) warnings.push({ line: lineNo, msg: `Модуль «${mod}» не поддерживается — пропущен` });
      emit(lineNo, ';');
      continue;
    }
    if (/^from\s+\S+\s+import\s+/.test(text)) {
      const mod = /^from\s+(\S+)/.exec(text)[1];
      if (!MODULES.has(mod)) warnings.push({ line: lineNo, msg: `Модуль «${mod}» не поддерживается — пропущен` });
      emit(lineNo, ';');
      continue;
    }

    // ---- простые операторы ----
    if (/^pass\b/.test(text)) { emit(lineNo, ';'); continue; }
    if (/^break\b/.test(text)) { emit(lineNo, 'break;'); continue; }
    if (/^continue\b/.test(text)) { emit(lineNo, 'continue;'); continue; }
    if ((m = /^return\b\s*(.*)$/.exec(text))) { emit(lineNo, `return ${m[1] ? expr(m[1], lineNo) : ''};`); continue; }

    // присваивание
    if ((m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(text)) && !/==/.test(text.slice(0, text.indexOf('=') + 2))) {
      const name = m[1];
      const value = expr(m[2], lineNo);
      if (declared.has(name)) emit(lineNo, `${name} = ${value};`);
      else { declared.add(name); emit(lineNo, `let ${name} = ${value};`); }
      continue;
    }
    if ((m = /^([A-Za-z_]\w*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/.exec(text))) {
      emit(lineNo, `${m[1]} ${m[2]} ${expr(m[3], lineNo)};`);
      continue;
    }

    // выражение-оператор (вызов функции, метода)
    emit(lineNo, `${expr(text, lineNo)};`);
  }

  closeTo(-1);
  if (blockReturnNeeded) emit(0, '}');

  if (!errors.length && !functions.size && !/while\s*\(!rt\.stopped\)|for\s*\(/.test(out.join('\n'))) {
    warnings.push({ line: 1, msg: 'В скетче нет цикла — программа выполнится один раз и завершится' });
  }

  return { js: out.join('\n'), lineMap, errors, warnings };

  // ------------------------------------------------------------ выражения ----
  function expr(text, lineNo) {
    let s = String(text).trim();

    // f-строки → шаблонные литералы
    s = s.replace(/(^|[\s(=,])f"([^"]*)"/g, (_, pre, body) => `${pre}\`${body.replace(/\{([^}]*)\}/g, '${$1}')}\``);

    s = s
      .replace(/\bmachine\./g, '')
      .replace(/\butime\.sleep_ms\b/g, 'rt.sleepMs')
      .replace(/\btime\.sleep_ms\b/g, 'rt.sleepMs')
      .replace(/\butime\.sleep\b/g, 'rt.sleepSeconds')
      .replace(/\btime\.sleep\b/g, 'rt.sleepSeconds')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/\bnot\s+/g, '!')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bis not\b/g, '!==')
      .replace(/\bis\b/g, '===')
      .replace(/\bprint\s*\(/g, 'rt.mpPrint(');

    if (/\bawait\b/.test(s)) {
      // уже с await
    } else if (/(^|[^\w.])rt\.sleep/.test(s)) {
      s = s.replace(/(^|[^\w.])(rt\.sleep\w*\s*\()/g, '$1await $2');
    }

    // вызовы своих функций — тоже await (они async)
    for (const fn of functions) {
      const re = new RegExp(`(^|[^\\w.])(${fn}\\s*\\()`, 'g');
      s = s.replace(re, (all, pre, call) => (pre.includes('await') ? all : `${pre}await ${call}`));
    }

    if (/\/\//.test(s)) {
      s = s.replace(/\/\//g, '/');
      warnings.push({ line: lineNo, msg: 'Целочисленное деление // заменено на обычное /' });
    }
    if (/[:\]]/.test(s) && /\w\s*\[[^\]]*:[^\]]*\]/.test(s)) {
      errors.push({ line: lineNo, msg: 'Срезы списков ([a:b]) не поддерживаются' });
    }
    return s;
  }
}

function stripComment(line) {
  let out = '', quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { out += c; if (c === quote && line[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === '#') break;
    out += c;
  }
  return out;
}
