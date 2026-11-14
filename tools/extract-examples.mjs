/**
 * Собирает данные симулятора для плагина Moodle:
 *   mod/robosim/examples.json — встроенные примеры (схема + скетч),
 *   mod/robosim/tasks.json    — учебные задания: цели, критерии, пример-решение.
 *
 * Запуск:  node tools/extract-examples.mjs [путь-к-репозиторию-сайта]
 * По умолчанию берётся $ROBOSIM_SRC или ../sim рядом с этой веткой.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] || process.env.ROBOSIM_SRC || resolve(here, '../../sim'));

const load = async (rel) => import(pathToFileURL(resolve(src, rel)).href);

const { EXAMPLES } = await load('js/examples.js');
const { TASKS } = await load('js/tasks.js');

const examples = EXAMPLES.map((ex) => {
  const parts = ex.schematic?.parts || [];
  const board = ex.boardId || parts.find((p) => /^[a-z0-9]+$/.test(p.type || ''))?.type || '';
  return {
    id: ex.id,
    name: ex.name,
    board,
    code: ex.code || '',
    schematic: ex.schematic || { parts: [], wires: [] },
  };
});

const tasks = TASKS.map((t) => ({
  id: t.id,
  title: t.title,
  level: t.level || 0,
  topic: t.topic || '',
  minutes: t.minutes || 0,
  brief: t.brief || '',
  // цели задания и критерии — по ним учитель видит, что именно проверяется
  goals: (t.goals || []).map((g) => (typeof g === 'string' ? g : g.text || String(g))),
  checks: (t.checks || []).map((c) => ({ id: c.id, kind: c.kind, text: c.text })),
  // готовое решение: id примера, который открывается кнопкой «Решение»
  solutionExample: t.solutionExample || '',
  // с чего начинать: схема-заготовка и скетч (task.start = схема + .code)
  start: {
    schematic: { parts: t.start?.parts || [], wires: t.start?.wires || [] },
    code: t.start?.code || '',
  },
}));

const out = resolve(here, '../mod/robosim');
writeFileSync(`${out}/examples.json`, `${JSON.stringify({ source: src, examples }, null, 1)}\n`);
writeFileSync(`${out}/tasks.json`, `${JSON.stringify({ tasks }, null, 1)}\n`);
console.log(`примеров: ${examples.length}, заданий: ${tasks.length} → mod/robosim/*.json`);
