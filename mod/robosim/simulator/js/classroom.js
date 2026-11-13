/**
 * classroom.js — «режим класса» без сервера и аккаунтов (этап 4).
 *
 * Что умеет:
 *   • собрать ссылку на схему: всё состояние уезжает в #hash, ссылку можно
 *     отправить в чат класса — она откроется у любого без регистрации;
 *   • хранить прогресс по заданиям в localStorage;
 *   • выгрузить результаты в CSV (для журнала) и в JSON (для портфолио).
 *
 * Сервера нет принципиально: школа может работать офлайн, а «синхронизация» —
 * это файл или ссылка, которыми учитель и ученик обмениваются сами.
 */

const b64encode = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64decode = (str) => {
  const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

/** Схема + код → короткая строка для #hash. */
export function encodeProject({ schematic, code = '' } = {}) {
  const payload = { v: 3, s: schematic, c: code };
  const json = JSON.stringify(payload);
  const bytes = (typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(json)
    : Uint8Array.from(unescape(encodeURIComponent(json)), (ch) => ch.charCodeAt(0)));
  return b64encode(bytes);
}

/** #hash → схема и код (или null, если ничего валидного нет). */
export function decodeProject(token) {
  if (!token) return null;
  try {
    const bytes = b64decode(token);
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : decodeURIComponent(escape(String.fromCharCode(...bytes)));
    const data = JSON.parse(json);
    if (!data?.s?.parts) return null;
    return { schematic: data.s, code: data.c || '' };
  } catch {
    return null;
  }
}

export function readHashProject() {
  const m = /(?:^|[#&])p=([^&]+)/.exec(typeof location !== 'undefined' ? location.hash : '');
  return m ? decodeProject(m[1]) : null;
}

export function buildShareUrl({ schematic, code }) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#p=${encodeProject({ schematic, code })}`;
}

// ------------------------------------------------------------------ прогресс ----

const KEY = 'robosim:progress:v1';

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProgress(progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function markSolved(progress, taskId, { score = 100, title = '' } = {}) {
  progress[taskId] = {
    solved: true,
    score,
    title,
    at: new Date().toISOString(),
  };
  saveProgress(progress);
  return progress;
}

export function progressStats(progress, tasks) {
  const solved = tasks.filter((t) => progress[t.id]?.solved).length;
  return { solved, total: tasks.length, percent: Math.round((solved / Math.max(1, tasks.length)) * 100) };
}

// ------------------------------------------------------------------- экспорт ----

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Журнал учителя: по строке на задание. */
export function resultsCsv(tasks, progress, meta = {}) {
  const head = ['Задание', 'Уровень', 'Тема', 'Статус', 'Балл', 'Когда', 'Ученик', 'Класс'];
  const rows = tasks.map((t) => {
    const p = progress[t.id] || {};
    return [
      t.title, t.level, t.topic,
      p.solved ? 'выполнено' : 'не выполнено',
      p.solved ? p.score ?? 100 : 0,
      p.at ? new Date(p.at).toLocaleString('ru-RU') : '',
      meta.student || '', meta.group || '',
    ];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
}

export function resultsJson(tasks, progress, meta = {}) {
  return JSON.stringify({
    app: 'robosim',
    kind: 'progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    student: meta.student || '',
    group: meta.group || '',
    tasks: tasks.map((t) => ({
      id: t.id, title: t.title, level: t.level, topic: t.topic,
      solved: Boolean(progress[t.id]?.solved),
      score: progress[t.id]?.score ?? 0,
      at: progress[t.id]?.at || null,
    })),
  }, null, 2);
}

/** Скачать текст файлом (в браузере). */
export function download(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
