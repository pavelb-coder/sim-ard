/**
 * ui-tasks.js — панель заданий: список, карточка, кнопка «Проверить».
 *
 * Модуль ничего не знает про схемный редактор и рантаймы: он получает
 * «хуки» от app.js и рисует интерфейс. Так движок проверок остаётся чистым
 * и тестируемым, а интерфейс — заменяемым.
 */

import { TASKS, LEVELS, solutionOf, taskById } from './tasks.js';
import { evaluate } from './checker.js';
import { progressStats, markSolved, resultsCsv, resultsJson, download, buildShareUrl } from './classroom.js';

const el = (tag, cls = '', text = '') => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class TasksPanel {
  /**
   * @param {object} opts
   *   root    — контейнер панели
   *   progress — объект прогресса (мутабельный)
   *   hooks   — { getContext, run, loadTask, loadSolution, syncSchematic, notify, onProgress }
   */
  constructor({ root, progress, hooks }) {
    this.root = root;
    this.progress = progress;
    this.hooks = hooks;
    this.currentId = TASKS[0]?.id || null;
    this.result = null;
    this.showHint = false;
    this._build();
  }

  // ---------------------------------------------------------------- каркас ----
  _build() {
    this.root.innerHTML = `
      <div class="drawer-head">
        <h2>Задания</h2>
        <span class="badge" id="taskProgressBadge">0 / 0</span>
        <span class="spacer"></span>
        <button class="btn btn-small" id="taskExportCsv" title="Скачать журнал в CSV">Журнал CSV</button>
        <button class="btn btn-small" id="taskExportJson" title="Скачать результаты в JSON">JSON</button>
        <button class="btn btn-small" id="taskShare" title="Ссылка на схему для класса">Ссылка</button>
        <button class="icon-btn" id="taskClose" title="Закрыть" aria-label="Закрыть">✕</button>
      </div>
      <div class="drawer-body">
        <nav class="task-list" id="taskList"></nav>
        <section class="task-card" id="taskCard"></section>
      </div>`;

    this.listEl = this.root.querySelector('#taskList');
    this.cardEl = this.root.querySelector('#taskCard');
    this.badgeEl = this.root.querySelector('#taskProgressBadge');

    this.root.querySelector('#taskClose').addEventListener('click', () => this.close());
    this.root.querySelector('#taskShare').addEventListener('click', () => this._share());
    this.root.querySelector('#taskExportCsv').addEventListener('click', () => {
      const csv = resultsCsv(TASKS, this.progress);
      download('robosim-журнал.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
      this.hooks.notify('Журнал сохранён в CSV');
    });
    this.root.querySelector('#taskExportJson').addEventListener('click', () => {
      download('robosim-результаты.json', resultsJson(TASKS, this.progress), 'application/json');
      this.hooks.notify('Результаты сохранены в JSON');
    });

    this.renderList();
    this.renderCard();
    this.updateBadge();
  }

  _share() {
    try {
      const url = buildShareUrl(this.hooks.syncSchematic());
      navigator.clipboard?.writeText(url).catch(() => {});
      window.prompt('Ссылка на схему — скопируйте и отправьте в класс:', url);
    } catch (err) {
      this.hooks.notify(`Не удалось собрать ссылку: ${err.message}`);
    }
  }

  // ----------------------------------------------------------------- список ----
  renderList() {
    this.listEl.innerHTML = '';
    let lastLevel = null;
    for (const task of TASKS) {
      if (task.level !== lastLevel) {
        lastLevel = task.level;
        this.listEl.appendChild(el('div', 'task-group', `${task.level} · ${LEVELS[task.level] || ''}`));
      }
      const solved = Boolean(this.progress[task.id]?.solved);
      const b = el('button', `task-item${task.id === this.currentId ? ' active' : ''}${solved ? ' solved' : ''}`);
      b.innerHTML = `<span class="task-tick">${solved ? '✓' : task.level}</span>
        <span class="task-name">${esc(task.title)}</span>
        <span class="task-min">${task.minutes}′</span>`;
      b.addEventListener('click', () => this.select(task.id));
      this.listEl.appendChild(b);
    }
  }

  updateBadge() {
    const s = progressStats(this.progress, TASKS);
    if (this.badgeEl) this.badgeEl.textContent = `${s.solved} / ${s.total}`;
    this.hooks.onProgress?.(s);
    return s;
  }

  select(id) {
    this.currentId = id;
    this.result = null;
    this.showHint = false;
    this.renderList();
    this.renderCard();
    this.cardEl.scrollTop = 0;
  }

  // ---------------------------------------------------------------- карточка ----
  renderCard() {
    const task = taskById(this.currentId);
    if (!task) { this.cardEl.innerHTML = '<p class="muted">Задания не загрузились.</p>'; return; }
    const solved = Boolean(this.progress[task.id]?.solved);
    const res = this.result;

    const checksHtml = task.checks.map((c, i) => {
      const r = res?.items?.[i];
      const state = !r ? '' : r.ok ? 'ok' : (r.skipped ? 'skip' : 'bad');
      const icon = !r ? '•' : r.ok ? '✓' : (r.skipped ? '▶' : '✕');
      const detail = r && !r.ok && r.detail ? `<div class="check-detail">${esc(r.detail)}</div>` : '';
      const kindName = { schema: 'схема', code: 'код', behavior: 'работа' }[c.kind] || '';
      return `<li class="check ${state}">
        <span class="check-icon">${icon}</span>
        <div class="check-body">
          <div class="check-text">${esc(c.text)} <span class="check-kind">${kindName}</span></div>
          ${detail}
        </div>
      </li>`;
    }).join('');

    const verdict = res
      ? `<div class="verdict ${res.passed ? 'ok' : (res.items.some((i) => i.ok) ? 'part' : 'bad')}">
           ${res.passed
    ? `Задание выполнено! ${solved ? 'Отметка в журнале обновлена.' : 'Результат записан в журнал.'}`
    : (res.needRun
      ? `Выполнено ${res.items.filter((i) => i.ok).length} из ${res.items.length}. Запустите скетч («Старт») — пункты про работу проверяются по работающей схеме.`
      : `Выполнено ${res.items.filter((i) => i.ok).length} из ${res.items.length}. Посмотрите, что не сходится, и попробуйте снова.`)}
         </div>`
      : '';

    const hintHtml = this.showHint
      ? `<div class="task-hint">${task.checks.filter((c) => c.hint).map((c) => `<p>💡 ${esc(c.hint)}</p>`).join('') || '<p>Подсказок нет — задание простое.</p>'}</div>`
      : '';

    this.cardEl.innerHTML = `
      <header class="task-head">
        <div>
          <h3>${esc(task.title)}</h3>
          <div class="task-meta">
            <span class="chip">${task.level} · ${LEVELS[task.level] || ''}</span>
            <span class="chip">${esc(task.topic)}</span>
            <span class="chip">~${task.minutes} мин</span>
            ${solved ? '<span class="chip ok">выполнено</span>' : ''}
          </div>
        </div>
      </header>
      <p class="task-brief">${esc(task.brief)}</p>
      <div class="task-goals">
        <b>Что должно получиться</b>
        <ul>${task.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
      </div>
      <div class="task-checks">
        <b>Проверки</b>
        <ul>${checksHtml}</ul>
      </div>
      ${verdict}
      ${hintHtml}
      <footer class="task-actions">
        <button class="btn btn-run" id="taskCheck">Проверить</button>
        <button class="btn" id="taskRun">Старт</button>
        <button class="btn" id="taskStart">С нуля</button>
        <button class="btn" id="taskHint">Подсказка</button>
        <button class="btn" id="taskSolution" title="Загрузить готовое решение">Эталон</button>
      </footer>`;

    this.cardEl.querySelector('#taskCheck').addEventListener('click', () => this.check());
    this.cardEl.querySelector('#taskRun').addEventListener('click', () => this.hooks.run?.());
    this.cardEl.querySelector('#taskStart').addEventListener('click', () => {
      this.hooks.loadTask?.(task);
      this.result = null;
      this.renderCard();
      this.hooks.notify(`Задание «${task.title}»: стартовое состояние загружено`);
    });
    this.cardEl.querySelector('#taskSolution').addEventListener('click', () => {
      const sol = solutionOf(task);
      if (!sol) return;
      this.hooks.loadSolution?.(sol);
      this.result = null;
      this.renderCard();
      this.hooks.notify('Загружен эталон — сравните со своей схемой');
    });
    this.cardEl.querySelector('#taskHint').addEventListener('click', () => {
      this.showHint = !this.showHint;
      this.renderCard();
    });
  }

  // ---------------------------------------------------------------- проверка ----
  check() {
    const task = taskById(this.currentId);
    if (!task) return;
    const ctx = this.hooks.getContext();
    const res = evaluate(task, ctx);
    this.result = res;
    if (res.passed) {
      markSolved(this.progress, task.id, { score: res.score, title: task.title });
      this.updateBadge();
      this.renderList();
    }
    this.renderCard();
    this.hooks.notify(res.passed ? `«${task.title}» — зачёт!` : `«${task.title}»: ${res.items.filter((i) => i.ok).length} из ${res.items.length}`);
    return res;
  }

  // ------------------------------------------------------------------ окно ----
  open(id = null) {
    if (id) this.select(id);
    this.root.classList.remove('hidden');
    this.root.setAttribute('aria-hidden', 'false');
  }

  close() {
    this.root.classList.add('hidden');
    this.root.setAttribute('aria-hidden', 'true');
  }

  toggle(id = null) {
    if (this.root.classList.contains('hidden')) this.open(id);
    else this.close();
  }

  get isOpen() { return !this.root.classList.contains('hidden'); }
}
