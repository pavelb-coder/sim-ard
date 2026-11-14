/**
 * app.js — сборка приложения: редактор кода, схемный редактор, рантаймы плат,
 * осциллограф.
 *
 * Поток запуска (может быть несколько плат одновременно):
 *   для каждой платы: транспайлер C++ или MicroPython → AsyncFunction
 *   драйвер кадра: 4 подшага решателя + отсчёт осциллографа, затем отрисовка
 */

import { Schematic } from './schematic.js';
import { PARTS, fmtR, BOARDS_LIST } from './parts.js';
import { BOARDS } from './boards.js';
import { Circuit } from './circuit.js';
import { ArduinoRuntime } from './runtime.js';
import { transpile, bracketHint } from './transpiler.js';
import { transpilePython } from './mpy-transpiler.js';
import { createLibraries, checkIncludes } from './libraries.js';
import { Scope, TIME_DIVS, VOLT_DIVS } from './scope.js';
import { EXAMPLES, defaultCodeFor } from './examples.js';
import { TASKS, taskById, solutionOf } from './tasks.js';
import { CheckContext } from './checker.js';
import { lint } from './hints.js';
import { TasksPanel } from './ui-tasks.js';
import { loadProgress, readHashProject, decodeProject } from './classroom.js';
import { createRosMode } from './ros/app.js';
import { webSerial, initWebSerial, connectWebSerial, disconnectWebSerial, webSerialSend } from './webserial.js';

const $ = (id) => document.getElementById(id);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const codeEl = $('code');
const hlEl = $('highlight');
const gutterEl = $('gutter');
const serialEl = $('serialOut');
const problemsEl = $('problemsOut');
const statusEl = $('statusText');
const warnEl = $('warnText');

let running = false;
let runtimes = new Map();      // boardId → ArduinoRuntime
let activeBoardId = null;
let timerHandle = null;
let lastSolve = null;

// ------------------------------------------------------------------ схема ----
const schematic = new Schematic({
  svg: $('svg'),
  onChange: () => {
    circuit.setSchematic(schematic.parts, schematic.wires);
    syncTabs();
    updateStats();
    scheduleAutosave();
    refreshHints();
    buildScopeChannels();
    if (running) solveOnce(1 / 60);
  },
});

let circuit = new Circuit([], []);

schematic.onHoverPin = (info) => {
  const el = $('probe');
  if (!info) { el.textContent = 'наведите на вывод — покажу напряжение'; return; }
  const v = circuit.pinVoltage(info.compId, info.pin);
  const part = schematic.part(info.compId);
  const name = part ? (PARTS[part.type]?.name || part.type) : info.compId;
  el.textContent = v === null ? `${name}.${info.pin}: нет данных` : `${name}.${info.pin} = ${v.toFixed(2)} В`;
};

// при наведении на провод — куда он идёт
schematic.onHoverWire = (w) => {
  const el = $('probe');
  if (!w) { el.textContent = 'наведите на вывод — покажу напряжение'; return; }
  const label = (end) => {
    const part = schematic.part(end.compId);
    const pin = part ? PARTS[part.type].pins(part).find((q) => q.id === end.pin) : null;
    return `${part?.ref || end.compId} ${pin?.label || end.pin}`;
  };
  el.textContent = `провод ${label(w.a)} → ${label(w.b)} · Del — удалить`;
};

// ------------------------------------------------------------------ палитра ----
const CATS = ['Платы', 'Питание', 'Приборы', 'Компоненты', 'Датчики', 'Модули', 'Связь'];
const SOURCE_TYPES = new Set(['battery9', 'batteryAA', 'psu']);
const INSTRUMENTS = new Set(['scope', 'multimeter', 'logicprobe']);
const palette = $('palette');
for (const cat of CATS) {
  const head = document.createElement('div');
  head.className = 'cat';
  head.textContent = cat;
  palette.appendChild(head);
  for (const [type, def] of Object.entries(PARTS)) {
    if (def.category !== cat) continue;
    const b = document.createElement('button');
    b.className = 'pal-item';
    b.dataset.type = type;
    b.innerHTML = `${iconFor(type)}<span>${def.name}</span>`;
    b.addEventListener('click', () => {
      const spot = freeSpot(type);
      const part = schematic.addPart(type, spot.x, spot.y, initialProps(type));
      if (def.board) {
        part.props.code = defaultCodeFor(type, part.props.lang);
        activeBoardId = part.id;
        syncTabs();
        showBoard(part);
      }
      updateStats();
    });
    palette.appendChild(b);
  }
}

function initialProps(type) {
  const spec = BOARDS[type];
  if (spec) return { lang: spec.defaultLang, code: '' };
  return {};
}

function iconFor(type) {
  const c = 'width="26" height="18" viewBox="0 0 26 18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"';
  switch (type) {
    case 'uno': return `<svg ${c} aria-hidden="true"><rect x="3" y="3" width="20" height="12" rx="2" fill="#1276b0" stroke="#1276b0"/><path d="M6 3v-1M10 3v-1M14 3v-1M18 3v-1"/></svg>`;
    case 'esp32': return `<svg ${c} aria-hidden="true"><rect x="3" y="3" width="20" height="12" rx="2" fill="#2f3b46"/><rect x="9" y="5" width="8" height="5" rx="1" fill="#4a5b6b"/></svg>`;
    case 'pico': return `<svg ${c} aria-hidden="true"><rect x="4" y="3" width="18" height="12" rx="2" fill="#1f4d3a"/><rect x="9" y="5" width="8" height="5" rx="1" fill="#3d7a5c"/></svg>`;
    case 'rpi5': return `<svg ${c} aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2" fill="#12583a"/><rect x="4" y="6" width="7" height="5" rx="1" fill="#b7c3cc"/><rect x="13" y="6" width="6" height="6" rx="1" fill="#151c23"/><rect x="4" y="13" width="16" height="2" rx="1" fill="#0a2f1e"/></svg>`;
    case 'nano': return `<svg ${c} aria-hidden="true"><rect x="3" y="6" width="20" height="7" rx="1.5" fill="#1276b0" stroke="#1276b0"/><path d="M6 6v-1M10 6v-1M14 6v-1M18 6v-1M6 13v1M10 13v1M14 13v1M18 13v1"/></svg>`;
    case 'promini': return `<svg ${c} aria-hidden="true"><rect x="5" y="6" width="16" height="6" rx="1.5" fill="#0f6d74"/><path d="M7 6v-1M10 6v-1M13 6v-1M16 6v-1M7 12v1M10 12v1M13 12v1M16 12v1"/></svg>`;
    case 'leonardo': return `<svg ${c} aria-hidden="true"><rect x="3" y="3" width="20" height="12" rx="2" fill="#1276b0" stroke="#1276b0"/><rect x="3" y="7" width="3" height="4" rx="1" fill="#c3ccd4"/><path d="M9 3v-1M13 3v-1M17 3v-1"/></svg>`;
    case 'mega': return `<svg ${c} aria-hidden="true"><rect x="1" y="4" width="24" height="10" rx="2" fill="#1276b0" stroke="#1276b0"/><path d="M6 4v-1M9 4v-1M12 4v-1M15 4v-1M18 4v-1M21 4v-1M6 14v1M9 14v1M12 14v1M15 14v1M18 14v1M21 14v1"/></svg>`;
    case 'led': return `<svg ${c} aria-hidden="true"><path d="M2 9h5M19 9h5"/><path d="M9 4l6 5-6 5z" fill="#ffd7c9" stroke="#ff8a3d"/><path d="M16 3v12" stroke="#ff8a3d"/></svg>`;
    case 'resistor': return `<svg ${c} aria-hidden="true"><path d="M2 9h4l2-4 3 8 3-8 3 8 2-4h5"/></svg>`;
    case 'capacitor': return `<svg ${c} aria-hidden="true"><path d="M2 9h8M16 9h8"/><path d="M10 3v12M16 3v12"/></svg>`;
    case 'electrolytic': return `<svg ${c} aria-hidden="true"><path d="M2 9h8M18 9h6"/><path d="M10 3v12"/><path d="M16 3a 6 6 0 0 1 0 12" /></svg>`;
    case 'inductor': return `<svg ${c} aria-hidden="true"><path d="M2 9h3a4 4 0 0 1 8 0a4 4 0 0 1 8 0h3"/></svg>`;
    case 'button': return `<svg ${c} aria-hidden="true"><path d="M2 12h6M18 12h6"/><path d="M8 12h3M15 12h3"/><path d="M9 6h8" stroke="#9fb6c9"/></svg>`;
    case 'pot': return `<svg ${c} aria-hidden="true"><rect x="5" y="5" width="16" height="6" rx="1"/><path d="M13 11v6M10 2l3 3 3-3"/></svg>`;
    case 'ldr': return `<svg ${c} aria-hidden="true"><circle cx="13" cy="9" r="6"/><path d="M7 5l12 8M7 9h12M7 13l12-8"/></svg>`;
    case 'pir': return `<svg ${c} aria-hidden="true"><path d="M4 13a9 9 0 0 1 18 0z"/><circle cx="13" cy="8" r="2.5" stroke="#ffd166"/></svg>`;
    case 'dht11': return `<svg ${c} aria-hidden="true"><rect x="6" y="4" width="14" height="10" rx="1"/><path d="M9 7h8"/></svg>`;
    case 'hcsr04': return `<svg ${c} aria-hidden="true"><rect x="2" y="5" width="22" height="8" rx="1"/><circle cx="8" cy="9" r="2.5"/><circle cx="18" cy="9" r="2.5"/></svg>`;
    case 'servo': return `<svg ${c} aria-hidden="true"><rect x="5" y="6" width="16" height="8" rx="2"/><circle cx="13" cy="6" r="3"/><path d="M13 3v-3"/></svg>`;
    case 'lcd1602': return `<svg ${c} aria-hidden="true"><rect x="2" y="4" width="22" height="11" rx="1" fill="#0d3a1f" stroke="#1d6b38"/><path d="M5 8h16M5 11h10" stroke="#7ef29d"/></svg>`;
    case 'oled': return `<svg ${c} aria-hidden="true"><rect x="6" y="2" width="14" height="14" rx="2" fill="#04121f" stroke="#24405c"/><path d="M8 7h10M8 10h6" stroke="#9ad7ff"/></svg>`;
    case 'buzzer': return `<svg ${c} aria-hidden="true"><path d="M6 13a7 7 0 0 1 14 0z"/><path d="M2 13h4M20 13h4"/></svg>`;
    case 'diode': return `<svg ${c} aria-hidden="true"><path d="M2 9h5M19 9h5"/><path d="M9 4l6 5-6 5z"/><path d="M15 4v10"/></svg>`;
    case 'npn': return `<svg ${c} aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M2 9h4M6 4v10"/><path d="M6 6l6-2M6 12l6 2"/><path d="M13 11l-3 3 4 0"/></svg>`;
    case 'rgbled': return `<svg ${c} aria-hidden="true"><circle cx="13" cy="8" r="5" fill="#ff5544" stroke="#ff5544"/><circle cx="9" cy="11" r="4" fill="#28d17c" stroke="#28d17c"/><circle cx="17" cy="11" r="4" fill="#3b82f6" stroke="#3b82f6"/><path d="M9 13v4M13 13v4M17 13v4"/></svg>`;
    case 'toggle': return `<svg ${c} aria-hidden="true"><path d="M2 13h6M18 13h6"/><path d="M8 13h10"/><path d="M13 13l6-7"/><circle cx="19" cy="6" r="2.4"/></svg>`;
    case 'seg7': return `<svg ${c} aria-hidden="true"><rect x="7" y="1" width="12" height="16" rx="1.5"/><path d="M9 4h8M9 9h8M9 14h8" stroke="#ff8a3d"/></svg>`;
    case 'relay': return `<svg ${c} aria-hidden="true"><rect x="3" y="4" width="20" height="11" rx="1.5"/><rect x="5" y="6" width="8" height="7" rx="1" fill="#2f74b8" stroke="#2f74b8"/><path d="M15 12l5-4"/><circle cx="20" cy="12" r="1.4"/></svg>`;
    case 'joystick': return `<svg ${c} aria-hidden="true"><rect x="3" y="4" width="20" height="11" rx="2"/><circle cx="13" cy="9" r="4"/><circle cx="13" cy="9" r="1.2"/></svg>`;
    case 'battery9': return `<svg ${c} aria-hidden="true"><rect x="8" y="4" width="12" height="13" rx="1.5" fill="#1b2430"/><rect x="10" y="2" width="4" height="2.5" rx="1" fill="#c0392b" stroke="#c0392b"/><rect x="15" y="2" width="3" height="2.5" rx="1"/><path d="M14 9v4M12 11h4" stroke="#ffd166"/></svg>`;
    case 'batteryAA': return `<svg ${c} aria-hidden="true"><rect x="2" y="5" width="22" height="10" rx="2"/><rect x="5" y="7" width="4" height="6" rx="1" fill="#3d5a7a" stroke="#3d5a7a"/><rect x="10" y="7" width="4" height="6" rx="1" fill="#c0392b" stroke="#c0392b"/><rect x="15" y="7" width="4" height="6" rx="1" fill="#3d5a7a" stroke="#3d5a7a"/></svg>`;
    case 'psu': return `<svg ${c} aria-hidden="true"><rect x="3" y="4" width="20" height="12" rx="2"/><rect x="5" y="6" width="9" height="5" rx="1" fill="#04121f" stroke="#24405c"/><circle cx="19" cy="9" r="2.5"/><path d="M8 16v2M14 16v2"/></svg>`;
    case 'scope': return `<svg ${c} aria-hidden="true"><rect x="3" y="3" width="20" height="12" rx="2" fill="#04121f" stroke="#24405c"/><path d="M5 10l3-4 3 8 3-8 3 4h4" stroke="#ffd166" stroke-width="1.2"/></svg>`;
    case 'multimeter': return `<svg ${c} aria-hidden="true"><rect x="3" y="2" width="20" height="14" rx="2"/><rect x="5" y="4" width="10" height="6" rx="1" fill="#0b1a14" stroke="#2c5c46"/><circle cx="19" cy="7" r="3"/><path d="M8 16v2M13 16v2M18 16v2"/></svg>`;
    case 'logicprobe': return `<svg ${c} aria-hidden="true"><path d="M2 9h5"/><rect x="7" y="2" width="11" height="14" rx="3"/><circle cx="12.5" cy="7" r="2.4" fill="#3fd07a" stroke="#3fd07a"/><circle cx="12.5" cy="12" r="1.4"/><path d="M12.5 16v2"/></svg>`;
    case 'ledBicolor': return `<svg ${c} aria-hidden="true"><path d="M2 6h4M2 12h4M18 9h6"/><circle cx="11" cy="9" r="6" fill="#ff5544" stroke="#ff5544"/><circle cx="20" cy="9" r="0"/></svg>`;
    case 'ledBar': return `<svg ${c} aria-hidden="true"><rect x="1" y="6" width="24" height="6" rx="2"/><path d="M5 7.5v3M9 7.5v3M13 7.5v3M17 7.5v3M21 7.5v3" stroke="#7ef29d"/></svg>`;
    case 'traffic': return `<svg ${c} aria-hidden="true"><rect x="8" y="1" width="10" height="16" rx="3"/><circle cx="13" cy="5" r="2" fill="#ff5a4d" stroke="#ff5a4d"/><circle cx="13" cy="9" r="2" fill="#ffd166" stroke="#ffd166"/><circle cx="13" cy="13" r="2" fill="#3fd07a" stroke="#3fd07a"/></svg>`;
    case 'pnp': return `<svg ${c} aria-hidden="true"><circle cx="12" cy="9" r="6"/><path d="M2 9h4M6 4v10"/><path d="M6 6l6-2M6 12l6 2"/><path d="M12 5l-3-2 4-1"/></svg>`;
    case 'mosfet': return `<svg ${c} aria-hidden="true"><rect x="7" y="3" width="7" height="12" rx="1"/><path d="M2 9h5M9 3v12"/><path d="M14 5h6M14 13h6M20 5v8"/></svg>`;
    case 'tip120': return `<svg ${c} aria-hidden="true"><circle cx="13" cy="9" r="7"/><path d="M2 9h4M6 4v10"/><path d="M6 6l6-2M6 12l6 2"/><path d="M6 3v12"/></svg>`;
    case 'l298n': return `<svg ${c} aria-hidden="true"><rect x="2" y="3" width="22" height="12" rx="2"/><rect x="6" y="5" width="10" height="6" rx="1" fill="#4a5b6b"/><path d="M6 17v2M13 17v2M20 17v2"/></svg>`;
    case 'dcmotor': return `<svg ${c} aria-hidden="true"><rect x="4" y="4" width="14" height="10" rx="2"/><circle cx="11" cy="9" r="3.4"/><path d="M18 9h5"/></svg>`;
    case 'keypad': return `<svg ${c} aria-hidden="true"><rect x="4" y="2" width="18" height="14" rx="2"/><path d="M8 6h2M12 6h2M16 6h2M8 10h2M12 10h2M16 10h2"/></svg>`;
    case 'sr595': return `<svg ${c} aria-hidden="true"><rect x="6" y="2" width="14" height="14" rx="1.5"/><path d="M10 4v-2M13 4v-2M16 4v-2M10 16v2M13 16v2M16 16v2" /><path d="M9 8h8M9 11h5" stroke="#3fd07a"/></svg>`;
    case 'sr165': return `<svg ${c} aria-hidden="true"><rect x="6" y="2" width="14" height="14" rx="1.5"/><path d="M10 4v-2M13 4v-2M16 4v-2"/><path d="M20 6h4M20 12h4"/><path d="M9 9h8"/></svg>`;
    case 'stepper28byj': return `<svg ${c} aria-hidden="true"><rect x="2" y="5" width="10" height="9" rx="1"/><circle cx="18" cy="9" r="5"/><circle cx="18" cy="9" r="1.6"/><path d="M18 4v2"/></svg>`;
    case 'usbcable': return `<svg ${c} aria-hidden="true"><path d="M4 12c4-6 14 6 18 0"/><rect x="1" y="9" width="5" height="6" rx="1.2"/><rect x="20" y="9" width="5" height="6" rx="1.2"/></svg>`;
    default: return `<svg ${c} aria-hidden="true"><rect x="4" y="4" width="18" height="10" rx="2"/></svg>`;
  }
}

function freeSpot(type) {
  const def = PARTS[type];
  const w = def.w || 70, h = def.h || 40;
  const c = screenCenterWorld();
  const offsets = [
    [0, 0], [0, -(h + 110)], [-(w + 120), -(h + 40)], [w + 120, -(h + 40)],
    [0, h + 110], [-(w + 120), h + 40], [w + 120, h + 40], [0, -(2 * h + 160)],
    [-(2 * w), 0], [2 * w, 0], [-(2 * w), -(h + 160)], [2 * w, -(h + 160)],
  ];
  const boxes = schematic.parts.map((p) => {
    const d = PARTS[p.type];
    return { x1: p.x - d.w / 2, y1: p.y - d.h / 2, x2: p.x + d.w / 2, y2: p.y + d.h / 2 };
  });
  for (const [dx, dy] of offsets) {
    const x = c.x + dx, y = c.y + dy;
    const box = { x1: x - w / 2 - 12, y1: y - h / 2 - 12, x2: x + w / 2 + 12, y2: y + h / 2 + 12 };
    const clash = boxes.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1);
    if (!clash) return { x, y };
  }
  return { x: c.x + w, y: c.y - h - 120 };
}

function screenCenterWorld() {
  const r = $('svg').getBoundingClientRect();
  return {
    x: (r.width / 2 - schematic.view.x) / schematic.view.s,
    y: (r.height / 2 - schematic.view.y) / schematic.view.s,
  };
}

function updateStats() {
  $('statParts').textContent = `${schematic.parts.length} деталей`;
  $('statWires').textContent = `${schematic.wires.length} проводов`;
}

// ------------------------------------------------------------------ платы ----
const boards = () => schematic.parts.filter((p) => p.__def?.board);
const activeBoard = () => schematic.part(activeBoardId) || boards()[0] || null;

function syncTabs() {
  const wrap = $('sketchTabs');
  const list = boards();
  if (!list.length) { wrap.innerHTML = '<span class="tab-empty">На схеме нет платы</span>'; return; }
  wrap.innerHTML = list.map((b) => {
    const spec = BOARDS[b.type];
    const lang = b.props.lang === 'mpy' ? 'MicroPython' : 'C++';
    const active = b.id === activeBoard()?.id ? ' active' : '';
    return `<button class="sketch-tab${active}" data-board="${b.id}">
      <b>${spec.short}</b><i>${lang}</i></button>`;
  }).join('');
  wrap.querySelectorAll('.sketch-tab').forEach((el) => {
    el.addEventListener('click', () => {
      syncEditorToBoard();
      activeBoardId = el.dataset.board;
      showBoard(schematic.part(activeBoardId));
      syncTabs();
    });
  });
}

function syncEditorToBoard() {
  const b = activeBoard();
  if (b) b.props.code = codeEl.value;
}

function showBoard(part) {
  if (!part) return;
  activeBoardId = part.id;
  codeEl.value = part.props.code ?? defaultCodeFor(part.type, part.props.lang);
  $('langBadge').textContent = part.props.lang === 'mpy' ? 'MicroPython' : 'Arduino C++';
  refreshEditor();
}

// ---------------------------------------------------------------- редактор ----
const KW = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'true', 'false', 'default', 'import', 'from', 'in', 'and', 'or', 'not', 'def', 'elif', 'pass', 'while']);
const TYPES = new Set(['void', 'int', 'float', 'double', 'long', 'short', 'char', 'bool', 'boolean', 'byte', 'word', 'unsigned', 'const', 'static', 'String', 'uint8_t', 'int8_t', 'uint16_t', 'int16_t', 'uint32_t', 'int32_t']);
const CONSTS = new Set(['HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN', 'PI', 'True', 'False', 'None']);

const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function highlight(src) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|^([ \t]*#[^\n]*)|\b([A-Za-z_]\w*)\b|(\d+(?:\.\d+)?)/gm;
  let out = '', last = 0, m;
  while ((m = re.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    const [text, com, str, pre, word, num] = m;
    let cls = '';
    if (com && !pre) cls = 'tok-com';
    else if (str) cls = 'tok-str';
    else if (pre) cls = 'tok-pre';
    else if (word) {
      const after = src.slice(m.index + text.length).match(/^\s*\(/);
      if (KW.has(word)) cls = 'tok-kw';
      else if (TYPES.has(word)) cls = 'tok-type';
      else if (CONSTS.has(word)) cls = 'tok-const';
      else if (after) cls = 'tok-fn';
    } else if (num) cls = 'tok-num';
    out += cls ? `<span class="${cls}">${escapeHtml(text)}</span>` : escapeHtml(text);
    last = m.index + text.length;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function refreshEditor() {
  const src = codeEl.value;
  hlEl.innerHTML = highlight(src) + '\n';
  const lines = src.split('\n').length;
  gutterEl.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  syncScroll();
}
function syncScroll() {
  hlEl.scrollTop = codeEl.scrollTop;
  hlEl.scrollLeft = codeEl.scrollLeft;
  gutterEl.scrollTop = codeEl.scrollTop;
}
codeEl.addEventListener('input', () => { refreshEditor(); syncEditorToBoard(); scheduleAutosave(); refreshHints(); });
codeEl.addEventListener('scroll', syncScroll);
codeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = codeEl.selectionStart, en = codeEl.selectionEnd;
    codeEl.setRangeText('  ', s, en, 'end');
    refreshEditor();
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
});

// ----------------------------------------------------------------- консоль ----
const lastOutEndedWithNewline = new Map();   // boardId → печатал ли он перевод строки

function appendSerial(text, kind = 'out', boardPart = null) {
  const many = boards().length > 1 && boardPart;
  // Serial.print() печатает без перевода строки — подпись платы ставим только
  // в начале строки, иначе «[Uno] A0=[Uno] 511» вместо «[Uno] A0=511».
  const atLineStart = boardPart ? (lastOutEndedWithNewline.get(boardPart.id) ?? true) : true;
  const prefix = many && (kind !== 'usb' && kind !== 'in') && atLineStart ? `[${BOARDS[boardPart.type].short}] ` : '';
  if (boardPart) lastOutEndedWithNewline.set(boardPart.id, String(text).endsWith('\n'));
  const span = document.createElement('span');
  if (kind === 'sys') span.className = 'sys';
  if (kind === 'err') span.className = 'err';
  if (kind === 'usb') span.className = 'usb';
  // Serial Arduino — это и есть USB: всё, что скетч печатает, уходит в кабель,
  // к второй плате или на настоящий компьютер (Web Serial).
  if (kind === 'out' && boardPart && boardPart.props?.lang !== 'mpy') usbSend(boardPart.id, text);
  if (kind === 'out') webSerialSend(text);
  span.textContent = prefix + text;
  // наблюдения для автопроверки заданий
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    trace.serial.push((prefix + line).slice(0, 200));
  }
  if (trace.serial.length > 400) trace.serial.splice(0, trace.serial.length - 400);
  serialEl.appendChild(span);
  serialEl.scrollTop = serialEl.scrollHeight;
  while (serialEl.childNodes.length > 800) serialEl.removeChild(serialEl.firstChild);
}

let problems = [];
function setProblems(list) {
  problems = list;
  $('problemsCount').textContent = String(list.length);
  $('problemsCount').classList.toggle('bad', list.length > 0);
  problemsEl.innerHTML = list.map((p, i) =>
    `<div class="problem ${p.level === 'warn' ? 'warn' : ''}" data-i="${i}">
       <b>${escapeHtml(p.msg)}</b>${p.line ? ` <span class="ln">строка ${p.line}</span>` : ''}
     </div>`).join('');
  problemsEl.querySelectorAll('.problem').forEach((el) => {
    el.addEventListener('click', () => {
      const p = problems[Number(el.dataset.i)];
      if (p?.line) focusLine(p.line);
    });
  });
}

function focusLine(line) {
  const lines = codeEl.value.split('\n');
  const upto = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
  codeEl.focus();
  codeEl.setSelectionRange(upto, upto + (lines[line - 1] || '').length);
  const lh = codeEl.scrollHeight / Math.max(1, lines.length);
  codeEl.scrollTop = Math.max(0, (line - 3) * lh);
  syncScroll();
}

const setStatus = (text, cls = '') => { statusEl.textContent = text; statusEl.className = cls; };
/** Сгоревшая деталь — сообщение в монитор порта (как «дым» из железа). */
function reportBurns() {
  const list = circuit.burnedNow || [];
  if (!list.length) return;
  for (const b of list) appendSerial(`\n✗ ${b.text}\n`, 'err', null);
  burnNotice = list[list.length - 1].text;
  burnNoticeAt = Date.now();
  warnEl.textContent = `⚠ ${burnNotice}`;
  showSerialTab?.();
  circuit.burnedNow = [];     // забрали — очередь пуста
}

let burnNotice = null;      // сообщение о сгоревшей детали держим на виду 10 секунд
let burnNoticeAt = 0;

const updateWarnings = (warnings) => {
  const w = warnings?.find((x) => x.level === 'danger') || warnings?.[0];
  if (w) { warnEl.textContent = `⚠ ${w.text}`; return; }
  if (burnNotice && Date.now() - burnNoticeAt < 10000) { warnEl.textContent = `⚠ ${burnNotice}`; return; }
  warnEl.textContent = '';
};

// --------------------------------------------------- настоящая плата по USB ----
/**
 * Web Serial: настоящая Arduino, воткнутая в USB компьютера, работает вместе
 * с симулятором. Что пришло с платы — уходит в скетч (Serial.read) и в монитор;
 * что скетч напечатал — уходит на плату. Без поддержки в браузере кнопка
 * просто честно об этом говорит.
 */
initWebSerial({
  onData: (text) => {
    for (const rt of runtimes.values()) rt.feedSerial(text);
    appendSerial(text, 'usb');
  },
  onChange: (st) => {
    const btn = $('realUsbBtn');
    const label = $('realUsbState');
    if (!btn || !label) return;
    btn.textContent = st.connected ? 'Отключить плату' : 'Реальная плата';
    btn.disabled = st.busy;
    label.textContent = st.message || (st.supported ? '' : 'Web Serial: нужен Chrome, Edge или Opera');
    label.classList.toggle('ok', st.connected);
  },
});

$('realUsbBtn').addEventListener('click', async () => {
  if (webSerial.connected) await disconnectWebSerial();
  else await connectWebSerial();
});

// ------------------------------------------------------------- библиотеки ----
const steppers = [];          // экземпляры библиотеки Stepper — их крутит драйвер кадров
let stepperOwner = null;      // плата, к которой относится текущий скетч

function makeBus(boardPart) {
  const spec = BOARDS[boardPart.type];
  const pinsOf = (part) => PARTS[part.type].pins(part);
  return {
    steppers,
    addStepper(obj) { obj.boardId = boardPart.id; steppers.push(obj); },
    /** библиотека Stepper сообщает шаг — двигатель на схеме получает поворот */
    stepMotor(st, dir) {
      for (const pin of st.pins) {
        const motor = this.partOnPin(pin, 'stepper28byj');
        if (!motor) continue;
        motor.props.half = (Number(motor.props.half) || 0) + 2 * dir;
        motor.props.libTick = Date.now();
        return;
      }
    },
    partOnPin(pinNum, type) {
      const pin = spec.pins.find((p) => p.num === Number(pinNum));
      if (!pin) return null;
      const net = circuit.netOf(boardPart.id, pin.id);
      if (!net) return null;
      return schematic.parts.find((p) => p.type === type && pinsOf(p).some((pp) => circuit.netOf(p.id, pp.id) === net)) || null;
    },
    firstOfType(type) { return schematic.parts.find((p) => p.type === type) || null; },
    changed(part) { schematic.refreshPart(part.id); },
  };
}

function mpyGlobals(rt) {
  const Pin = (num, mode) => rt.machinePin(num, mode ?? 'IN');
  Pin.OUT = 'OUT'; Pin.IN = 'IN'; Pin.PULL_UP = 'PULL_UP'; Pin.PULL_DOWN = 'PULL_DOWN'; Pin.OPEN_DRAIN = 'OPEN_DRAIN';
  const pinNum = (x) => (typeof x === 'number' ? x : x?.num ?? x?.id ?? x);
  const PWM = (x) => rt.pwmPin(pinNum(x), 1000);
  const ADC = (x) => rt.adcPin(pinNum(x));
  return {
    Pin, PWM, ADC,
    machine: { Pin, PWM, ADC },
    time: { sleep: (s) => rt.sleepSeconds(s), sleep_ms: (ms) => rt.sleepMs(ms), ticks_ms: () => rt.millis() },
    utime: { sleep: (s) => rt.sleepSeconds(s), sleep_ms: (ms) => rt.sleepMs(ms) },
    // pyserial: порт Arduino, воткнутой в USB. Строки — как в железе (bytes → str).
    serial: {
      Serial: (port = '/dev/ttyACM0', baud = 9600) => rt.usbSerial(port, baud),
      serial_for_url: (url = '/dev/ttyACM0', baud = 9600) => rt.usbSerial(url, baud),
    },
    str: String, int: (x) => Math.trunc(Number(x)), float: Number, len: (x) => (x?.length ?? String(x).length),
    range: (a, b, s = 1) => { const out = []; if (b === undefined) { b = a; a = 0; } for (let i = a; i < b; i += s) out.push(i); return out; },
  };
}

// ------------------------------------------------------------------- USB ----
/**
 * USB-связь двух плат: Serial одной появляется в /dev/ttyACM0 другой.
 *
 * Соединение — не провод: у платы есть разъём «USB», у детали «USB-кабель» —
 * два конца A и B. Если конец кабеля и разъём платы попали на один узел схемы,
 * платы связаны. Электрически это ничего не закорачивает: вывод USB не имеет
 * номера и в решатель цепи не попадает.
 */
const usbLinks = new Map();       // boardId → { peer, cable }
let usbSig = '';

function usbBoardsOn(net) {
  if (!net) return null;
  return schematic.parts.find((p) => BOARDS[p.type] && circuit.netOf(p.id, 'USB') === net) || null;
}

function updateUsbLinks() {
  const cables = schematic.parts.filter((p) => p.type === 'usbcable');
  const sig = `${cables.length}:${schematic.wires.length}:${schematic.parts.length}`;
  if (sig === usbSig) return usbLinks;
  usbSig = sig;
  usbLinks.clear();
  for (const cable of cables) {
    const a = usbBoardsOn(circuit.netOf(cable.id, 'A'));
    const b = usbBoardsOn(circuit.netOf(cable.id, 'B'));
    if (!a || !b || a.id === b.id) continue;
    usbLinks.set(a.id, { peer: b.id, cable: cable.id });
    usbLinks.set(b.id, { peer: a.id, cable: cable.id });
  }
  return usbLinks;
}

/** Данные от платы `fromId` уходят второй плате и в настоящий компьютер. */
function usbSend(fromId, text) {
  updateUsbLinks();
  const link = usbLinks.get(fromId);
  if (!link) return false;
  const peer = runtimes.get(link.peer);
  const cable = schematic.parts.find((p) => p.id === link.cable);
  if (cable) { cable.props = cable.props || {}; cable.props.usbAt = performance.now(); schematic.refreshPart(cable.id); }
  if (!peer) return false;
  peer.feedSerial(text);
  return true;
}

// --------------------------------------------------------------- запуск ----
function exactAttack(err, lineMap, offset = 0) {
  const stack = String(err?.stack || '');
  const m = /sketch_[\w-]+\.js:(\d+):(\d+)/.exec(stack);
  if (!m) return null;
  const line = Number(m[1]) - offset;      // строка внутри тела скетча
  if (line < 1) return 1;
  if (lineMap) return lineMap[line - 1] ?? line;
  return line;
}

/**
 * Скетч исполняется синхронно между кадрами: пока он идёт, цепь ещё «не знает»
 * о свежих digitalWrite. Если внутри скетча читают вывод, пересчитываем цепь
 * сразу — иначе сканирование матрицы клавиатуры видит уровни прошлого кадра.
 * Не больше FORCE_SOLVES за кадр, чтобы не уронить FPS.
 */
let forcedSolves = 0;
let forcedFrame = -1;
function syncCircuitForRead() {
  // лимит считается на кадр драйвера: сбрасываем при смене кадра
  if (forcedFrame !== frameCount) { forcedFrame = frameCount; forcedSolves = 0; }
  if (forcedSolves > 24) return;
  let dirty = false;
  for (const rt of runtimes.values()) if (rt.events?.length) { dirty = true; break; }
  if (!dirty) return;
  forcedSolves++;
  circuit.solve(runtimes, 1 / 60);
}

function prepareBoard(part) {
  const spec = BOARDS[part.type];
  const lang = part.props.lang === 'mpy' ? 'mpy' : 'cpp';
  const src = part.props.code ?? '';
  const errors = [];
  const warnings = [];

  if (lang === 'cpp') {
    for (const msg of checkIncludes(src)) errors.push({ msg, line: 1, level: 'danger' });
  }

  const bus = makeBus(part);
  const libs = createLibraries(bus);
  const rt = new ArduinoRuntime({
    spec,
    boardId: part.id,
    onSerial: (t, kind) => appendSerial(t, kind || 'out', part),
    onFrame: () => {},
    onPinChange: (n) => recordFlip(part.id, n),
    readPin: (n) => {
      syncCircuitForRead();
      const v = circuit.voltageOf(part.id, n);
      recordAnalog(part.id, n, v, spec);
      return v;
    },
    onTone: (boardId, pin, freq, dur, on) => handleTone(part, pin, freq, on),
    // Pi пишет в /dev/ttyACM0 — данные уходят Arduino и в монитор порта
    onUsbWrite: (text) => { appendSerial(text, 'usb', part); usbSend(part.id, text); },
    onPulseIn: (boardId, pin) => handlePulseIn(part, pin),
  });

  let body, lineMap = null;
  // AsyncFunction оборачивает тело в «function anonymous(…\n) {\n» — это +2 строки,
  // плюс наша строка «use strict» — итого первая строка скетча = 3-я в теле.
  let lineOffset = 3;
  if (lang === 'mpy') {
    const t = transpilePython(src);
    errors.push(...t.errors.map((e) => ({ ...e, level: 'danger' })));
    warnings.push(...t.warnings.map((w) => ({ ...w, level: 'warn' })));
    body = t.js;
    lineMap = t.lineMap;
    lineOffset = 3 + (t.js.match(/^\n*/)[0].length);
  } else {
    const t = transpile(src);
    errors.push(...t.errors.map((e) => ({ ...e, level: 'danger' })));
    warnings.push(...t.warnings.map((w) => ({ ...w, level: 'warn' })));
    body = `${t.js}\n//# sourceURL=sketch_${part.id}.js\nreturn { setup: typeof setup === "function" ? setup : null, loop: typeof loop === "function" ? loop : null };`;
    lineOffset = 3 + (t.js.match(/^\n*/)[0].length);
    if (t.errors.length === 0 && /async function loop\s*\(/.test(t.js)) body = body.replace('//# sourceURL', '//# sourceURL');
  }

  const globals = { ...rt.globals(), ...libs, ...mpyGlobals(rt) };
  // имена становятся параметрами функции — зарезервированные слова JS нельзя
  const RESERVED = new Set(['yield', 'let', 'static', 'await', 'enum', 'implements', 'interface',
    'package', 'private', 'protected', 'public', 'arguments', 'eval', 'class', 'function']);
  const names = Object.keys(globals).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && !RESERVED.has(k));
  let fn = null;
  try {
    fn = new AsyncFunction(...names, `"use strict";\n${body}\n//# sourceURL=sketch_${part.id}.js`);
  } catch (e) {
    const hint = lang === 'cpp' ? bracketHint(body) : null;
    errors.push({ msg: `Синтаксис: ${e.message}${hint ? ' — ' + hint.msg : ''}`, line: hint?.line || 1, level: 'danger' });
  }

  return {
    part, rt, lang, errors, warnings, fn, names,
    values: names.map((n) => globals[n]),
    lineMap, lineOffset,
  };
}

async function run() {
  if (running) await stopAll();
  syncEditorToBoard();

  const list = boards();
  if (!list.length) {
    // Схема без платы: источник питания + детали. Скетча нет, но цепь
    // считается по-настоящему — диоды горят, осциллограф рисует сигнал.
    const hasSource = schematic.parts.some((p) => SOURCE_TYPES.has(p.type));
    // приборы (мультиметр, пробник, осциллограф) работают и без питания:
    // омметр сам подаёт испытательный ток, пробник просто смотрит уровни
    const hasMeter = schematic.parts.some((p) => INSTRUMENTS.has(p.type));
    if (!hasSource && !hasMeter) {
      setProblems([{ msg: 'На схеме нет платы. Перетащите Arduino Uno, ESP32 или Pico — или поставьте источник питания (раздел «Питание»), чтобы собрать схему без платы', line: 0, level: 'danger' }]);
      showProblemsTab();
      return;
    }
    setProblems([]);
    runtimes = new Map();
    circuit.setSchematic(schematic.parts, schematic.wires);
    resetTrace();
    running = true;
    $('stopBtn').disabled = false;
    setStatus(hasSource ? 'Схема под питанием' : 'Приборы включены', 'ok');
    startTimer();
    startDriver();
    return;
  }

  const prepared = list.map(prepareBoard);
  const bad = prepared.find((p) => p.errors.length);
  if (bad) {
    const name = BOARDS[bad.part.type].short;
    setProblems(bad.errors.map((e) => ({ ...e, msg: prepared.length > 1 ? `${name}: ${e.msg}` : e.msg })));
    showProblemsTab();
    setStatus('Ошибка в скетче', '');
    return;
  }

  setProblems(prepared.flatMap((p) => p.warnings.map((w) => ({ ...w, msg: prepared.length > 1 ? `${BOARDS[p.part.type].short}: ${w.msg}` : w.msg }))));

  runtimes = new Map(prepared.map((p) => [p.part.id, p.rt]));
  circuit.setSchematic(schematic.parts, schematic.wires);
  usbSig = '';
  updateUsbLinks();
  resetTrace();
  trace.hasRun = true;
  running = true;
  $('stopBtn').disabled = false;
  $('serialInput').disabled = false;
  $('sendBtn').disabled = false;
  setStatus('Симуляция идёт', 'ok');
  startTimer();
  startDriver();

  for (const p of prepared) startSketch(p);
}

function startSketch(prep) {
  const { part, rt, lang, fn, names, values, lineMap, lineOffset } = prep;
  (async () => {
    try {
      if (lang === 'mpy') {
        await fn(...values);
      } else {
        const api = await fn(...values);
        if (api?.setup) await api.setup();
        await rt.delay(0);
        while (running && runtimes.get(part.id) === rt) {
          if (api?.loop) await api.loop();
          await rt.delay(0);
        }
      }
    } catch (e) {
      if (e?.name !== 'StopSketch') {
        const line = exactAttack(e, lineMap, lineOffset || 0);
        const prefix = boards().length > 1 ? `${BOARDS[part.type].short}: ` : '';
        appendSerial(`\n✗ ${prefix}${e?.name || 'Ошибка'}: ${e?.message}\n`, 'err', null);
        setProblems([{ msg: `${prefix}${e?.name || 'Ошибка'}: ${e?.message}`, line, level: 'danger' }]);
        showProblemsTab();
        setStatus('Скетч упал', '');
      }
    }
  })();
}

// звук только если зуммер реально подключён к этому выводу
function handleTone(boardPart, pin, freq, on) {
  const spec = BOARDS[boardPart.type];
  const p = spec.pins.find((x) => x.num === Number(pin));
  if (!p) return;
  const net = circuit.netOf(boardPart.id, p.id);
  const buzzer = schematic.parts.find((part) => part.type === 'buzzer' &&
    (circuit.netOf(part.id, '1') === net || circuit.netOf(part.id, '2') === net));
  if (!buzzer) return;
  beep(freq, on);
}

// pulseIn: спрашиваем у дальномера расстояние и переводим в микросекунды
function handlePulseIn(boardPart, pin) {
  const spec = BOARDS[boardPart.type];
  const p = spec.pins.find((x) => x.num === Number(pin));
  if (!p) return 0;
  const net = circuit.netOf(boardPart.id, p.id);
  const sonar = schematic.parts.find((part) => part.type === 'hcsr04' && circuit.netOf(part.id, 'ECHO') === net);
  if (!sonar) return 0;
  const cm = Number(sonar.props?.distance ?? 50);
  trace.sonarDistances.push(Math.round(cm));
  if (trace.sonarDistances.length > 40) trace.sonarDistances.shift();
  return Math.round(cm * 58);   // 58 мкс на сантиметр — паспортная величина HC-SR04
}

let audioCtx = null, osc = null;
function beep(freq, on) {
  if (!on || !freq) {
    if (osc) { try { osc.stop(); } catch { /* уже остановлен */ } osc = null; }
    return;
  }
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (osc) { osc.frequency.value = freq; return; }
    osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    g.gain.value = 0.03;
    osc.frequency.value = freq;
    osc.type = 'square';
    osc.connect(g).connect(audioCtx.destination);
    osc.start();
  } catch { /* звук не критичен */ }
}

// --------------------------------------------------------------- драйвер ----
const SUB = 4;
const scope = new Scope($('scopeCanvas'));
let driverLast = performance.now();
let frameCount = 0;

function solveOnce(dt) {
  const res = circuit.solve(runtimes, dt);
  lastSolve = res;
  schematic.applySim(res.partInfo, runtimes);
  // прозвонка мультиметра пищит, пока щупы замкнуты (если зуммер молчит)
  {
    const buzzing = schematic.parts.some((p) => res.partInfo.get(p.id)?.sounding);
    const cont = !buzzing && schematic.parts.some((p) => p.type === 'multimeter'
      && (p.props?.mode || 'V') === 'CONT' && res.partInfo.get(p.id)?.continuity);
    if (cont) beep(2400, true);
    else if (!buzzing) beep(0, false);
  }
  updateWarnings(res.warnings);
  reportBurns();
  $('statIter').textContent = res.ok ? `MNA: ${res.iterations ?? '—'} итер.` : 'цепь не решается';
  return res;
}

/** Библиотека Stepper ставит шаги в очередь — здесь они превращаются в digitalWrite. */
function tickSteppers(dt) {
  if (!steppers.length) return;
  for (const st of steppers) {
    const rt = runtimes.get(st.boardId);
    if (!rt) continue;
    st.tick(dt, (pin, v) => rt.digitalWrite(pin, v));
  }
}

/** Отсчёты для детали-осциллографа: у каждого щупа свой буфер на ~2 с. */
const SCOPE_PART_LEN = 140;
const PWM_PERIOD = 24;   // отсчётов на период — на экране видно ~6 периодов
function sampleScopeParts() {
  for (const part of schematic.parts) {
    if (part.type !== 'scope') continue;
    const tr = part.__trace || (part.__trace = { ch1: [], ch2: [], max: 5 });
    // На выводе с ШИМ среднее напряжение — это прямая линия. Но осциллограф
    // должен показать прямоугольник, поэтому на таком узле дорисовываем
    // настоящие импульсы: 0 ↔ Vcc по скважности вывода платы.
    const sample = (pinId, key) => {
      const d = circuit.dutyOfNet(circuit.netOf(part.id, pinId));
      if (!d || d.duty <= 0.005 || d.duty >= 0.995) { tr[key + 'pwm'] = null; return circuit.pinVoltage(part.id, pinId); }
      tr[key + 'pwm'] = d;
      const ph = part['__ph' + key] = ((part['__ph' + key] || 0) + 1) % PWM_PERIOD;
      return ph < d.duty * PWM_PERIOD ? d.vcc * 0.99 : 0;
    };
    const v1 = sample('CH1', 'ch1');
    const v2 = sample('CH2', 'ch2');
    tr.ch1.push(v1 === null ? 0 : v1);
    tr.ch2.push(v2 === null ? 0 : v2);
    if (tr.ch1.length > SCOPE_PART_LEN) { tr.ch1.shift(); tr.ch2.shift(); }
    const peak = Math.max(...tr.ch1.map(Math.abs), ...tr.ch2.map(Math.abs));
    tr.max = peak > 12 ? 24 : peak > 5 ? 12 : 5;
  }
}

function sampleScope() {
  if (!scopeOn) return;
  const vals = scope.channels.map((ch) => {
    if (!ch.source) return null;
    // у платы — по номеру вывода (там же известна скважность ШИМ), у детали — по имени вывода
    return ch.source.board
      ? circuit.voltageOf(ch.source.boardId, Number(ch.source.pin))
      : circuit.pinVoltage(ch.source.boardId, ch.source.pin);
  });
  scope.push(vals);
}

function startDriver() {
  driverLast = performance.now();
  const tick = () => {
    if (!running) return;
    const now = performance.now();
    const frameDt = Math.min(0.05, Math.max(0.002, (now - driverLast) / 1000));
    driverLast = now;
    const dt = frameDt / SUB;
    let res = null;
    for (let i = 0; i < SUB; i++) {
      res = circuit.solve(runtimes, dt);
      lastSolve = res;
      sampleScope();
    }
    tickSteppers(dt * SUB);
    if (res) {
      schematic.applySim(res.partInfo, runtimes);
      updateWarnings(res.warnings);
      reportBurns();
      $('statIter').textContent = res.ok ? `MNA: ${res.iterations ?? '—'} итер.` : 'цепь не решается';
    }
    updateScopePwm();
    sampleTrace(res);
    sampleScopeParts();
    if (++frameCount % 2 === 0) scope.draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopAll() {
  for (const rt of runtimes.values()) rt.stop();
  running = false;
  runtimes = new Map();
  steppers.length = 0;
  $('stopBtn').disabled = true;
  $('serialInput').disabled = true;
  $('sendBtn').disabled = true;
  clearInterval(timerHandle);
  timerHandle = null;
  if (statusEl.classList.contains('ok')) setStatus('Остановлено');
  solveOnce(1 / 60);
  return new Promise((res) => setTimeout(res, 40));
}

/** Сгоревшие детали заменяем на новые: в симуляторе это кнопка «Сброс». */
function reviveBurned() {
  let n = 0;
  for (const p of schematic.parts) {
    if (!p.props?.burned) continue;
    delete p.props.burned;
    p.__over = 0;
    p.__burnShown = false;      // чтобы новое перегорание снова нарисовало копоть
    schematic.refreshPart(p);
    n++;
  }
  if (n) {
    burnNotice = null;
    appendSerial(`\n⌁ заменили сгоревшие детали: ${n}\n`, 'sys', null);
    circuit.setSchematic(schematic.parts, schematic.wires);
  }
}

function reset() {
  stopAll();
  reviveBurned();
  $('timer').textContent = '00:00.0';
  scope.clear();
  setStatus('Сброшено');
}

function startTimer() {
  const t0 = performance.now();
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    const ms = performance.now() - t0;
    const s = ms / 1000;
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
  }, 100);
}

// ------------------------------------------------------------ осциллограф ----
let scopeOn = false;

function buildScopeControls() {
  const tSel = $('timeDiv');
  TIME_DIVS.forEach((v) => {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = v < 1 ? `${v * 1000} мс` : `${v} с`;
    tSel.appendChild(o);
  });
  tSel.value = String(scope.timeDiv);
  tSel.addEventListener('change', () => { scope.timeDiv = Number(tSel.value); scope.draw(); });

  const vSel = $('voltDiv');
  VOLT_DIVS.forEach((v) => {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = `${v} В`;
    vSel.appendChild(o);
  });
  vSel.value = String(scope.voltDiv);
  vSel.addEventListener('change', () => { scope.voltDiv = Number(vSel.value); scope.draw(); });

  $('scopeBtn').addEventListener('click', () => {
    scopeOn = !scopeOn;
    $('scopeWrap').classList.toggle('hidden', !scopeOn);
    if (scopeOn) { buildScopeChannels(); setTimeout(() => scope._resize(), 30); }
  });
  $('scopePause').addEventListener('click', () => {
    scope.paused = !scope.paused;
    $('scopePause').textContent = scope.paused ? 'Продолжить' : 'Пауза';
  });
  $('scopeClear').addEventListener('click', () => scope.clear());
  window.addEventListener('resize', () => { if (scopeOn) scope._resize(); });
}

function buildScopeChannels() {
  const wrap = $('scopeChannels');
  const options = [];
  // деталь могли удалить — щуп на несуществующем выводе снимаем
  const alive = new Set(schematic.parts.map((p) => `${p.id}|`));
  for (const ch of scope.channels) {
    if (ch.source && ![...alive].some((pre) => ch.source.key?.startsWith(pre))) scope.setChannel(ch.index, null);
  }
  // выводы плат
  for (const b of boards()) {
    const spec = BOARDS[b.type];
    for (const p of spec.pins) {
      if (typeof p.num !== 'number') continue;
      options.push({ value: `${b.id}|${p.id}`, label: `${spec.short} · ${p.label}`, board: true, num: p.num });
    }
  }
  // и выводы всех остальных деталей — щуп можно повесить на любой узел
  for (const part of schematic.parts) {
    if (part.__def?.board) continue;
    const name = part.ref || part.__def?.name || part.type;
    for (const pin of part.__def.pins(part)) {
      options.push({ value: `${part.id}|${pin.id}`, label: `${name} · ${pin.label}`, board: false });
    }
  }
  wrap.innerHTML = scope.channels.map((ch, i) => `
    <div class="scope-ch">
      <span class="scope-dot" style="background:${ch.color}"></span>
      <select class="mini-select" data-ch="${i}">
        <option value="">—</option>
        ${options.map((o) => `<option value="${o.value}" ${ch.source?.key === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>`).join('');

  wrap.querySelectorAll('select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.ch);
      if (!sel.value) { scope.setChannel(i, null); }
      else {
        const [compId, pinId] = sel.value.split('|');
        const opt = options.find((o) => o.value === sel.value);
        // старые ссылки хранили номер вывода платы («b1|9») — поддерживаем и их
        const legacy = !opt && /^\d+$/.test(pinId);
        scope.setChannel(i, {
          key: sel.value,
          boardId: compId,
          pin: opt?.board || legacy ? (legacy ? Number(pinId) : opt.num) : pinId,
          board: !!(opt?.board || legacy),
          label: opt ? opt.label.replace(' · ', ' ') : (legacy ? compId + ' ' + pinId : compId),
        });
      }
      scope.draw();
    });
  });
}

function updateScopePwm() {
  if (!scopeOn) return;
  for (const ch of scope.channels) {
    if (!ch.source) continue;
    if (ch.source.board) {
      const rt = runtimes.get(ch.source.boardId);
      const st = rt?.pins.get(ch.source.pin);
      const b = schematic.part(ch.source.boardId);
      ch.source.pwm = (st && st.mode === 'OUTPUT' && st.pwm > 0 && st.pwm < 255)
        ? { duty: st.pwm / 255, vcc: b ? BOARDS[b.type].vcc : 5, freq: 490 }
        : null;
      continue;
    }
    // щуп на выводе детали, но узел связан с ШИМ-выводом платы через резистор:
    // прибор должен показать прямоугольник, а не среднее
    const d = circuit.dutyOfNet(circuit.netOf(ch.source.boardId, ch.source.pin));
    ch.source.pwm = (d && d.duty > 0.005 && d.duty < 0.995) ? { duty: d.duty, vcc: d.vcc, freq: 490 } : null;
  }
}

// ------------------------------------------------------------------ кнопки ----
const CONSOLE_TABS = {
  serial: ['serialOut', 'tabSerial'],
  problems: ['problemsOut', 'tabProblems'],
  hints: ['hintsOut', 'tabHints'],
};

function switchTab(name) {
  for (const [key, [body, tab]] of Object.entries(CONSOLE_TABS)) {
    $(body).classList.toggle('hidden', key !== name);
    $(tab).classList.toggle('tab-active', key === name);
  }
  if (name === 'hints') refreshHints();
}
function showProblemsTab() { switchTab('problems'); }
function showSerialTab() { switchTab('serial'); }

$('runBtn').addEventListener('click', run);
$('stopBtn').addEventListener('click', () => { stopAll(); });
$('resetBtn').addEventListener('click', () => { if (appMode === 'ros') rosApp?.fullReset(); else reset(); });
$('tabSerial').addEventListener('click', showSerialTab);
$('tabProblems').addEventListener('click', showProblemsTab);
$('tabHints').addEventListener('click', () => switchTab('hints'));
$('clearConsoleBtn').addEventListener('click', () => { serialEl.innerHTML = ''; });
$('sendBtn').addEventListener('click', () => sendFromMonitor());
$('serialInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendFromMonitor(); }
});

/** Строка из монитора порта — в скетч (Serial.read) и на настоящую плату. */
function sendFromMonitor() {
  const el = $('serialInput');
  const text = el.value;
  el.value = '';
  if (!text) return;
  appendSerial(`> ${text}\n`);
  for (const rt of runtimes.values()) rt.feedSerial(`${text}\n`);
  webSerialSend(`${text}\n`);
}
$('labelsBtn').addEventListener('click', () => {
  const on = schematic.toggleLabels();
  $('labelsBtn').classList.toggle('active', on);
  setStatus(on ? 'Подписи элементов включены' : 'Подписи элементов скрыты');
});
$('deleteBtn').addEventListener('click', () => schematic.removeSelected());
$('clearBtn').addEventListener('click', () => { if (confirm('Очистить схему?')) schematic.clear(); });
$('wipeBtn').addEventListener('click', () => {
  if (confirm('Очистить рабочее пространство? Схема, провода, код и монитор порта будут стёрты.')) clearWorkspace();
});

/** Полная очистка: схема, провода, скетчи, монитор, проблемы, осциллограф, счётчики. */
async function clearWorkspace() {
  await stopAll();
  schematic.clear();
  serialEl.innerHTML = '';
  setProblems([]);
  $('hintsOut').innerHTML = '';
  $('problemsCount').textContent = '0';
  if ($('hintsCount')) $('hintsCount').textContent = '0';
  codeEl.value = '';
  refreshEditor();
  activeBoardId = null;
  syncTabs();
  scope.clear();
  scopeOn = false;
  $('scopeWrap').classList.add('hidden');
  resetTrace();
  $('timer').textContent = '00:00.0';
  updateStats();
  buildScopeChannels();
  refreshHints();
  setStatus('Рабочее пространство очищено');
  scheduleAutosave();
}

window.addEventListener('keydown', (e) => {
  if (appMode === 'ros') return;                       // у ROS-режима свои клавиши
  if (e.target === codeEl || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); schematic.removeSelected(); }
  if (e.key === 'Escape') { schematic.pending = null; schematic.render(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') { e.preventDefault(); tasksPanel?.toggle(); }
});

// ----------------------------------------------------------- файлы и примеры ----
$('saveBtn').addEventListener('click', () => {
  syncEditorToBoard();
  const data = { app: 'robosim', version: 2, schematic: schematic.toJSON(), code: codeEl.value };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.robosim';
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus('Файл сохранён');
});

$('openBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.schematic) schematic.fromJSON(data.schematic);
    if (data.code && !data.schematic) {
      const b = activeBoard();
      if (b) { b.props.code = data.code; showBoard(b); }
    }
    schematic.centerBoard();
    syncTabs();
    setStatus(`Открыт ${file.name}`);
  } catch (err) {
    setStatus('Не удалось открыть файл');
    appendSerial(`✗ ${err.message}\n`, 'err');
  } finally {
    e.target.value = '';
  }
});

const exSelect = $('exampleSelect');
for (const ex of EXAMPLES) {
  const opt = document.createElement('option');
  opt.value = ex.id;
  opt.textContent = ex.name;
  exSelect.appendChild(opt);
}
exSelect.addEventListener('change', () => {
  const ex = EXAMPLES.find((e) => e.id === exSelect.value);
  exSelect.value = '';
  if (ex) loadExample(ex);
});

/** Вывод платы по «человеческому» имени: A0, D9, GP25, 13. */
function pinBySelector(spec, want) {
  const w = String(want).trim();
  const a = /^A(\d+)$/i.exec(w);
  if (a) return spec.pins.filter((p) => p.kind === 'analog')[Number(a[1])] || null;
  const d = /^D(\d+)$/i.exec(w);
  if (d) return spec.pins.find((p) => p.num === Number(d[1])) || null;
  const byLabel = spec.pins.find((p) => p.label === w);
  if (byLabel) return byLabel;
  return spec.pins.find((p) => typeof p.num === 'number' && p.num === Number(w)) || null;
}

/** Какие каналы осциллографа включить для этого примера. */
function applyExampleScope(ex) {
  for (let i = 0; i < scope.channels.length; i++) scope.setChannel(i, null);
  const found = [];
  const b = boards()[0];
  if (b && ex?.scope?.length) {
    const spec = BOARDS[b.type];
    for (const want of ex.scope) {
      const p = pinBySelector(spec, want);
      if (p) found.push({ key: `${b.id}|${p.id}`, boardId: b.id, pin: p.num, board: true, label: `${spec.short} ${p.label}` });
    }
  }
  found.slice(0, 4).forEach((src, i) => scope.setChannel(i, src));

  if (ex?.timeDiv) scope.timeDiv = ex.timeDiv;
  $('timeDiv').value = String(scope.timeDiv);

  scopeOn = found.length > 0;
  $('scopeWrap').classList.toggle('hidden', !scopeOn);
  buildScopeChannels();
  scope.clear();
  if (scopeOn) setTimeout(() => scope._resize(), 40);
}

async function loadExample(ex) {
  await stopAll();
  serialEl.innerHTML = '';
  burnNotice = null;
  warnEl.textContent = '';
  schematic.fromJSON(ex.schematic);
  schematic.centerBoard();
  circuit.setSchematic(schematic.parts, schematic.wires);
  const list = boards();
  const primary = ex.boardId || list[0]?.id || null;
  for (const b of list) {
    if (ex.extraCode && ex.extraCode[b.id] != null) b.props.code = ex.extraCode[b.id];
    else if (b.id === primary) b.props.code = ex.code || defaultCodeFor(b.type, b.props.lang);
    else b.props.code = defaultCodeFor(b.type, b.props.lang);
  }
  activeBoardId = primary;
  syncTabs();
  if (activeBoard()) showBoard(activeBoard());
  else {
    // пример вообще без платы: в редакторе — пояснение, что тут происходит
    codeEl.value = ex.code || '';
    $('langBadge').textContent = 'без скетча';
    refreshEditor();
  }
  updateStats();
  setProblems([]);
  setStatus(`Пример: ${ex.name}`);
  applyExampleScope(ex);
  if (ex.autorun) setTimeout(run, 50);
}


// ------------------------------------------- наблюдения для автопроверки ----
/*
 * Пока скетч работает, симулятор записывает то, что видит «снаружи»:
 * сколько раз переключался вывод, какие скважности ШИМ были, как менялась
 * яркость светодиодов, углы серво, текст на LCD, расстояния дальномера.
 * Проверки заданий читают именно эти наблюдения — подделать их из скетча
 * нельзя, потому что пишет их сам симулятор.
 */
const trace = {
  hasRun: false,
  startedAt: 0,
  seconds: 0,
  pinFlips: {},        // 'b1:9' → сколько раз менялся вывод
  pinPwm: {},          // 'b1:9' → какие скважности принимал
  leds: {},            // 'l1'  → максимальная яркость
  ledSpread: 0,        // разброс яркости (для «регулятора яркости»)
  analog: {},          // 'b1:14' → { min, max }
  servos: {},          // 'srv' → { min, max }
  lcd: {},             // 'lcd' → строки на экране
  sonarDistances: [],  // расстояния, которые прочитал скетч
  pressSeen: false,
  ledWhilePressed: 0,
  serial: [],
  _ledMin: Infinity,
  _ledMax: 0,
};

function resetTrace() {
  trace.hasRun = false;
  trace.startedAt = performance.now();
  trace.seconds = 0;
  trace.pinFlips = {};
  trace.pinPwm = {};
  trace.leds = {};
  trace.ledSpread = 0;
  trace.analog = {};
  trace.servos = {};
  trace.lcd = {};
  trace.sonarDistances = [];
  trace.pressSeen = false;
  trace.ledWhilePressed = 0;
  trace.serial = [];
  trace._ledMin = Infinity;
  trace._ledMax = 0;
}

function recordFlip(boardId, num) {
  const key = `${boardId}:${num}`;
  trace.pinFlips[key] = (trace.pinFlips[key] || 0) + 1;
}

function recordAnalog(boardId, num, volts, spec) {
  const adcMax = spec?.adcMax || 1023;
  const vcc = spec?.vcc || 5;
  const raw = Math.max(0, Math.min(adcMax, Math.round((volts / vcc) * adcMax)));
  const key = `${boardId}:${num}`;
  const cur = trace.analog[key] || { min: raw, max: raw };
  cur.min = Math.min(cur.min, raw);
  cur.max = Math.max(cur.max, raw);
  trace.analog[key] = cur;
}

let traceClock = 0;
function sampleTrace(res) {
  if (!running) return;
  const now = performance.now();
  if (now - traceClock < 40) return;          // 25 раз в секунду — достаточно
  traceClock = now;
  trace.seconds = Math.round(((now - trace.startedAt) / 1000) * 10) / 10;

  for (const [boardId, rt] of runtimes) {
    for (const [num, st] of rt.pins) {
      if (st.mode !== 'OUTPUT') continue;
      const key = `${boardId}:${num}`;
      const arr = trace.pinPwm[key] || (trace.pinPwm[key] = []);
      if (arr.length < 120 && !arr.includes(st.pwm)) arr.push(st.pwm);
    }
  }

  let maxLed = 0;
  const info = res?.partInfo;
  if (info) {
    for (const [id, pi] of info) {
      const part = schematic.part(id);
      if (!part || part.type !== 'led') continue;
      const b = Math.max(0, pi.brightness || 0);
      trace.leds[id] = Math.max(trace.leds[id] || 0, b);
      maxLed = Math.max(maxLed, b);
    }
  }
  trace._ledMin = Math.min(trace._ledMin, maxLed);
  trace._ledMax = Math.max(trace._ledMax, maxLed);
  trace.ledSpread = Math.max(0, trace._ledMax - trace._ledMin);

  for (const p of schematic.parts) {
    if (p.type === 'button' && p.props?.pressed) {
      trace.pressSeen = true;
      trace.ledWhilePressed = Math.max(trace.ledWhilePressed, maxLed);
    } else if (p.type === 'servo') {
      const a = Number(p.props?.angle ?? 0);
      const s = trace.servos[p.id] || { min: a, max: a };
      s.min = Math.min(s.min, a);
      s.max = Math.max(s.max, a);
      trace.servos[p.id] = s;
    } else if (p.type === 'lcd1602') {
      trace.lcd[p.id] = [...(p.props?.lines || [])];
    }
  }
}

/** Контекст для движка проверок: схема + код активной платы + наблюдения. */
function currentContext() {
  const b = activeBoard();
  return new CheckContext({
    parts: schematic.parts,
    wires: schematic.wires,
    code: codeEl.value,
    lang: b?.props?.lang === 'mpy' ? 'mpy' : 'cpp',
    trace,
  });
}

// ------------------------------------------------------------- подсказки ----
let hintsTimer = null;
function refreshHints() {
  clearTimeout(hintsTimer);
  hintsTimer = setTimeout(() => {
    const b = activeBoard();
    const spec = b ? PARTS[b.type].spec : null;
    const cx = currentContext();
    const list = lint({
      code: codeEl.value,
      lang: b?.props?.lang === 'mpy' ? 'mpy' : 'cpp',
      ctx: {
        spec,
        ledWithoutResistor: cx.ledWithoutResistor(),
        usedAnalogPins: cx.usedAnalogPins(),
      },
    });
    renderHints(list);
  }, 200);
}

function renderHints(list) {
  const out = $('hintsOut');
  $('hintsCount').textContent = String(list.length);
  $('hintsCount').classList.toggle('bad', list.length > 0);
  if (!list.length) {
    out.innerHTML = '<div class="hint-row"><b>Подсказок нет.</b> Схема и скетч выглядят рабочими — запускайте.</div>';
    return;
  }
  out.innerHTML = list.map((h, i) =>
    `<div class="hint-row ${h.level}" data-i="${i}"><b>${escapeHtml(h.text)}</b><span class="hint-ln">строка ${h.line}</span></div>`).join('');
  out.querySelectorAll('.hint-row').forEach((row) => {
    row.addEventListener('click', () => {
      const h = list[Number(row.dataset.i)];
      if (h?.line) focusLine(h.line);
    });
  });
}

// --------------------------------------------------- загрузка схемы целиком ----
/** Поставить на холст схему и раздать скетчи платам. */
function applyBundle({ schematic: schema, code = '', extraCode = {} }, { primaryId = null } = {}) {
  stopAll();
  serialEl.innerHTML = '';
  resetTrace();
  schematic.fromJSON(schema);
  schematic.centerBoard();
  const list = boards();
  const primary = primaryId || list[0]?.id || null;
  for (const b of list) {
    if (extraCode && extraCode[b.id] != null) b.props.code = extraCode[b.id];
    else if (b.id === primary) b.props.code = code || defaultCodeFor(b.type, b.props.lang);
    else b.props.code = defaultCodeFor(b.type, b.props.lang);
  }
  activeBoardId = primary;
  syncTabs();
  if (activeBoard()) showBoard(activeBoard());
  circuit.setSchematic(schematic.parts, schematic.wires);
  updateStats();
  setProblems([]);
  solveOnce(1 / 60);
  scope.clear();
  scopeOn = false;
  $('scopeWrap').classList.add('hidden');
  buildScopeChannels();
  refreshHints();
}

function openTask(task) {
  applyBundle({ schematic: task.start, code: task.start.code });
  setStatus(`Задание: ${task.title}`);
  showProblemsTab();
  switchTab('problems');
}

function openSolution(solution) {
  // Решение — это обычный пример, поэтому грузим его как пример:
  // так же открываются вкладки плат, каналы осциллографа и автозапуск.
  loadExample(solution);
  setStatus('Загружено решение задания — сравните со своей схемой');
}

// -------------------------------------------------------------- задания ----
const progress = loadProgress();
let tasksPanel = null;

function initTasks() {
  tasksPanel = new TasksPanel({
    root: $('taskDrawer'),
    progress,
    hooks: {
      getContext: currentContext,
      run: () => run(),
      loadTask: openTask,
      loadSolution: openSolution,
      syncSchematic: () => {
        syncEditorToBoard();
        return { schematic: schematic.toJSON(), code: codeEl.value };
      },
      notify: (text) => setStatus(text),
      onProgress: (stat) => { $('tasksBadge').textContent = `${stat.solved}/${stat.total}`; },
    },
  });
  $('tasksBtn').addEventListener('click', () => tasksPanel.toggle());
}

// --------------------------------------------------------------- режимы ----
/** Два экрана, как в оригинале: «Плата» и «Робот» (ROS 2). */
let appMode = 'sim';
let rosApp = null;
let rosBooted = false;

function ensureRos() {
  if (rosBooted) { rosApp.start(); return; }
  rosApp = createRosMode({
    onLog: (text) => setStatus(text),
    onTasksChanged: () => {
      const solved = Object.values(rosApp?.state?.solved || {}).filter(Boolean).length;
      $('rosTaskCount').textContent = `${solved}/3`;
    },
  });
  rosBooted = true;
  rosApp.boot();
}

function setMode(mode) {
  if (mode !== 'sim' && mode !== 'ros') return;
  if (mode === appMode) return;
  appMode = mode;
  const ros = mode === 'ros';
  $('rosLayout').classList.toggle('hidden', !ros);
  document.querySelector('.workspace').classList.toggle('hidden', ros);
  $('modeSimBtn').classList.toggle('active', !ros);
  $('modeRosBtn').classList.toggle('active', ros);
  $('modeSimBtn').setAttribute('aria-selected', String(!ros));
  $('modeRosBtn').setAttribute('aria-selected', String(ros));
  for (const id of ['tasksBtn', 'runBtn', 'stopBtn', 'timer', 'exampleSelect', 'saveBtn', 'openBtn']) {
    $(id)?.classList.toggle('hidden', ros);          // инструменты платы в ROS-режиме не нужны
  }
  if (ros) {
    tasksPanel?.close();
    if (runtimes.size) stopAll();
    ensureRos();
    setStatus('ROS 2: квартира — постройте карту, уберите мусор, вернитесь на док');
  } else {
    rosApp?.pause();
    setStatus('Симулятор платы');
  }
}

$('modeSimBtn').addEventListener('click', () => setMode('sim'));
$('modeRosBtn').addEventListener('click', () => setMode('ros'));

// ------------------------------------------------------------- автозапуск ----
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      syncEditorToBoard();
      localStorage.setItem('robosim:autosave', JSON.stringify({ schematic: schematic.toJSON() }));
    } catch { /* приватный режим — не страшно */ }
  }, 500);
}

function keepCentered() {
  const stage = $('stage');
  if (!stage || typeof ResizeObserver === 'undefined') return;
  let last = '';
  new ResizeObserver(() => {
    const key = `${stage.clientWidth}x${stage.clientHeight}`;
    if (key === last) return;
    last = key;
    if (!schematic.userMoved) schematic.centerBoard();
    if (scopeOn) scope._resize();
  }).observe(stage);
}

function boot() {
  buildScopeControls();
  $('labelsBtn').classList.toggle('active', schematic.showLabels !== false);
  initTasks();

  // схема из ссылки (#p=…) важнее локального автосохранения
  const shared = readHashProject();
  if (shared) {
    applyBundle({ schematic: shared.schematic, code: shared.code });
    setStatus('Схема открыта по ссылке');
    refreshHints();
    keepCentered();
    return;
  }

  let restored = null;
  try {
    const raw = localStorage.getItem('robosim:autosave');
    if (raw) restored = JSON.parse(raw);
  } catch { /* нет сохранения */ }

  if (restored?.schematic?.parts?.length) {
    schematic.fromJSON(restored.schematic);
    schematic.centerBoard();
    activeBoardId = boards()[0]?.id || null;
    syncTabs();
    if (activeBoard()) showBoard(activeBoard());
    circuit.setSchematic(schematic.parts, schematic.wires);
    updateStats();
    solveOnce(1 / 60);
    setStatus('Схема восстановлена — нажмите «Старт»');
  } else {
    loadExample(EXAMPLES[0]);
  }
  refreshHints();
  keepCentered();
  if (location.hash.replace('#', '').startsWith('ros')) setMode('ros');
}

window.__sim = {
  get ros() { return rosApp; },
  setMode, get mode() { return appMode; },
  get schematic() { return schematic; },
  get circuit() { return circuit; },
  get runtimes() { return runtimes; },
  get scope() { return scope; },
  get trace() { return trace; },
  get last() { return lastSolve; },
  get tasks() { return TASKS; },
  get tasksPanel() { return tasksPanel; },
  get progress() { return progress; },
  context: currentContext,
  checkTask: (id) => { tasksPanel.select(id); return tasksPanel.check(); },
  openTask: (id) => { tasksPanel.open(id); },
  openTask, openSolution, applyBundle, resetTrace,
  run, stopAll, solveOnce, refreshHints,
};

boot();
