/**
 * Связка страницы элемента курса с симулятором RoboSim.
 *
 * Симулятор открыт в iframe с того же сайта, поэтому страница Moodle может
 * просто заглянуть в его window: забрать схему (`__sim.schematic.toJSON()`),
 * текст скетча из редактора и прогнать автопроверку задания (`__sim.checkTask`).
 * Всё это уходит на сервер в submit.php, а оттуда — в журнал оценок.
 *
 * @module     mod_robosim/player
 * @copyright  2026 RoboSim
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
(function() {
    'use strict';

    var STR = {
        loading: 'Симулятор загружается…',
        ready: 'Симулятор готов. Соберите схему и нажмите «Сдать работу».',
        notask: 'В этом элементе курса нет задания для автопроверки: работу проверит учитель.',
        passed: 'Задание пройдено',
        failed: 'Задание не пройдено',
        sent: 'Работа сдана',
        sentscore: 'Работа сдана, результат: ',
        sending: 'Отправляем…',
        error: 'Не удалось отправить работу: ',
        noframe: 'Симулятор ещё не загрузился — подождите пару секунд.',
        offline: 'Страница симулятора недоступна.',
        needrun: 'Сначала нажмите «Старт» в симуляторе и дайте схеме поработать пару секунд: ' +
            'часть проверок смотрит на работающую схему. Нажмите кнопку ещё раз, чтобы всё равно сдать.'
    };

    function ready(fn) {
        if (document.readyState !== 'loading') {
            fn();
        } else {
            document.addEventListener('DOMContentLoaded', fn);
        }
    }

    ready(function() {
        var root = document.querySelector('[data-region="robosim"]');
        if (!root) {
            return;
        }

        var frame = root.querySelector('[data-region="frame"]');
        var statusEl = root.querySelector('[data-region="status"]');
        var checksEl = root.querySelector('[data-region="checks"]');
        var task = root.getAttribute('data-task') || '';
        var cmid = root.getAttribute('data-cmid');
        var sesskey = root.getAttribute('data-sesskey');
        var wwwroot = (root.getAttribute('data-wwwroot') || '').replace(/\/$/, '');
        var external = root.getAttribute('data-external') === '1';
        var loaded = false;
        // Нажатие «Сдать», когда схема ни разу не запускалась: первый раз
        // предупреждаем, второе нажатие отправляет работу как есть.
        var needRunWarned = false;

        function setStatus(text, kind) {
            if (!statusEl) {
                return;
            }
            statusEl.textContent = text;
            statusEl.className = 'robosim-status' + (kind ? ' robosim-status-' + kind : '');
        }

        function renderChecks(items) {
            if (!checksEl) {
                return;
            }
            checksEl.innerHTML = '';
            if (!items || !items.length) {
                return;
            }
            var list = document.createElement('ul');
            list.className = 'robosim-checklist';
            items.forEach(function(item) {
                var li = document.createElement('li');
                var mark = item.ok ? '✓ ' : (item.skipped ? '· ' : '✗ ');
                li.className = 'robosim-check ' + (item.ok ? 'ok' : (item.skipped ? 'skip' : 'fail'));
                li.textContent = mark + (item.text || '');
                if (!item.ok && item.hint) {
                    var hint = document.createElement('span');
                    hint.className = 'robosim-check-hint';
                    hint.textContent = ' — ' + item.hint;
                    li.appendChild(hint);
                }
                list.appendChild(li);
            });
            checksEl.appendChild(list);
        }

        /** Доступ к внутренностям симулятора (только для своей копии). */
        function sim() {
            try {
                if (external) {
                    return null;
                }
                var win = frame && frame.contentWindow;
                var doc = frame && frame.contentDocument;
                if (!win || !doc) {
                    return null;
                }
                return {win: win, doc: doc, api: win.__sim || null};
            } catch (e) {
                return null;
            }
        }

        /** Собирает текущее состояние работы ученика. */
        function collect() {
            var s = sim();
            if (!s || !s.api || !s.api.schematic) {
                return null;
            }
            var code = '';
            var editor = s.doc.getElementById('code');
            if (editor) {
                code = editor.value || '';
            }
            var result = {schematic: JSON.stringify(s.api.schematic.toJSON()), code: code,
                score: 0, passed: false, checks: ''};
            if (task) {
                try {
                    var res = s.api.checkTask(task);
                    if (res) {
                        result.score = Math.round(res.score || 0);
                        result.passed = !!res.passed;
                        result.needRun = !!res.needRun;
                        result.checks = JSON.stringify((res.items || []).map(function(i) {
                            return {text: i.text, ok: !!i.ok, hint: i.hint || '', skipped: !!i.skipped};
                        }));
                        renderChecks(res.items || []);
                    }
                } catch (e) {
                    result.checks = JSON.stringify([{text: 'Автопроверка не запустилась', ok: false,
                        hint: String(e && e.message || e)}]);
                }
            }
            return result;
        }

        function post(action) {
            var data = collect();
            if (!data) {
                setStatus(STR.noframe, 'warn');
                return Promise.resolve(null);
            }
            if (!task) {
                // Без задания «сдача» — это просто фиксация работы.
                data.score = 100;
                data.passed = true;
                renderChecks([]);
            }
            if (data.needRun && action === 'submit' && !needRunWarned) {
                // Проверки, которые смотрят на работающую схему, ещё не выполнялись.
                needRunWarned = true;
                setStatus(STR.needrun, 'warn');
                return Promise.resolve(null);
            }
            needRunWarned = false;
            setStatus(STR.sending, 'busy');
            var body = new URLSearchParams();
            body.set('id', cmid);
            body.set('sesskey', sesskey);
            body.set('action', action);
            body.set('schematic', data.schematic);
            body.set('code', data.code);
            body.set('score', String(data.score));
            body.set('passed', data.passed ? '1' : '0');
            body.set('checks', data.checks);

            return fetch(wwwroot + '/mod/robosim/submit.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
                body: body.toString()
            }).then(function(response) {
                return response.json();
            }).then(function(json) {
                if (!json || json.error) {
                    throw new Error((json && json.message) || 'unknown');
                }
                var parts = [];
                if (task) {
                    parts.push(json.passed ? STR.passed : STR.failed);
                }
                if (json.saved) {
                    parts.push(STR.sentscore + json.score + '%');
                } else {
                    parts.push((json.passed ? STR.passed : STR.failed) + ' — ' + json.score + '%');
                }
                if (json.grade !== null && json.grade !== undefined) {
                    parts.push('оценка: ' + json.grade);
                }
                setStatus(parts.join('. '), json.passed ? 'ok' : 'warn');
                if (json.saved && json.attemptsleft !== null && json.attemptsleft !== undefined) {
                    setStatus(parts.join('. ') + '. Осталось попыток: ' + json.attemptsleft, json.passed ? 'ok' : 'warn');
                }
                return json;
            }).catch(function(error) {
                setStatus(STR.error + (error.message || error), 'fail');
                return null;
            });
        }

        if (frame) {
            frame.addEventListener('load', function() {
                loaded = true;
                if (!external) {
                    setStatus(STR.ready, 'ok');
                }
            });
            if (!external) {
                setStatus(STR.loading, 'busy');
            }
            if (!task) {
                var help = document.createElement('div');
                help.className = 'robosim-note';
                help.textContent = STR.notask;
                checksEl.parentNode.insertBefore(help, checksEl);
            }
        }

        root.addEventListener('click', function(event) {
            var button = event.target.closest('[data-action]');
            if (!button) {
                return;
            }
            var action = button.getAttribute('data-action');
            if (action === 'check' || action === 'submit') {
                event.preventDefault();
                button.disabled = true;
                post(action).then(function() {
                    button.disabled = false;
                });
            }
        });

        // Сообщение из симулятора (на будущее): он может попросить сдать работу.
        window.addEventListener('message', function(event) {
            if (event.origin !== window.location.origin) {
                return;
            }
            if (event.data && event.data.robosim === 'submit') {
                post('submit');
            }
        });

        window.addEventListener('beforeunload', function() {
            if (loaded) {
                // Ничего не мешаем: несохранённая работа остаётся в автосохранении браузера.
            }
        });
    });
})();
