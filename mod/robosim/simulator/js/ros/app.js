/**
 * app.js (ROS-режим) — собирает квартиру, робота, SLAM, терминал и задания.
 *
 * Режим живёт отдельно от редактора скетчей: это второй «экран» симулятора,
 * как в оригинале — «Плата» и «Робот». Пока вкладка ROS активна, крутится
 * свой цикл: физика → публикация топиков → карта → отрисовка → проверка задач.
 */

import { makeWorld, roomAt } from './world.js';
import { Robot } from './robot.js';
import { OccupancyGrid } from './slam.js';
import { RosBus } from './bus.js';
import { RosView } from './view.js';
import { execute, complete } from './terminal.js';
import { loadProgress, saveProgress, markSolved } from '../classroom.js';

/** Задания ROS-режима — та же идея, что и у заданий по схемам, но события из мира. */
export const ROS_TASKS = [
  {
    id: 'ros-map',
    title: 'Построить карту квартиры',
    level: 'Первый',
    topic: 'SLAM',
    text: 'Поездите по квартире так, чтобы /slam_toolbox собрал ≥ 85 % доступной площади. Смотрите на серые ячейки: это «свободно, проверено лидаром».',
    check: (s) => s.coverage >= 0.85,
    progress: (s) => `${Math.round(s.coverage * 100)} %`,
  },
  {
    id: 'ros-trash',
    title: 'Убрать мусор',
    level: 'Второй',
    topic: 'Действия',
    text: 'Соберите минимум 5 из 6 предметов: подъезжайте ближе 0.5 м и нажимайте «Собрать» (или публикуйте true в /gripper).',
    check: (s) => s.collected >= 5,
    progress: (s) => `${s.collected} / ${s.total}`,
  },
  {
    id: 'ros-home',
    title: 'Вернуться на док-станцию',
    level: 'Третий',
    topic: 'Навигация',
    text: 'После уборки вернитесь на док-станцию и остановитесь: расстояние меньше 0.35 м, скорость около нуля. Батарея на доке заряжается.',
    check: (s) => s.collected >= 5 && s.atDock && s.stopped,
    progress: (s) => (s.collected < 5 ? 'сначала уберите мусор' : s.atDock ? (s.stopped ? 'готово' : 'остановитесь') : 'не на доке'),
  },
];

export function createRosMode({ onLog = () => {}, onTasksChanged = () => {} } = {}) {
  const world = makeWorld();
  const robot = new Robot(world);
  const slam = new OccupancyGrid(world, 0.05);
  const ros = new RosBus();
  const progress = loadProgress();

  const state = {
    mode: 'slam',
    showRays: true,
    showPath: true,
    collected: 0,
    total: world.trash.length,
    trash: world.trash.map((t) => ({ ...t, collected: false })),
    coverage: 0,
    atDock: false,
    stopped: true,
    ranges: new Float32Array(robot.rays),
    time: 0,
    running: false,
    repeat: null,          // { topic, msg, hz, acc }
    keys: new Set(),
    pad: { v: 0, w: 0 },
    solved: {},
  };

  // ------------------------------------------------------------------ граф ----
  ros.addNode('/robot_driver', {
    description: 'Дифференциальный привод: /cmd_vel → /odom + /joint_states',
    publishes: ['/odom', '/joint_states'],
    subscribes: ['/cmd_vel'],
    params: { max_speed: 0.55, wheel_separation: 0.32, frame_id: 'base_link' },
  });
  ros.addNode('/lidar', {
    description: 'Двумерный лидар: 240 лучей, до 8 м',
    publishes: ['/scan'],
    params: { samples: 240, range_min: 0.12, range_max: 8.0, frame_id: 'laser' },
  });
  ros.addNode('/slam_toolbox', {
    description: 'Построение карты по /scan (режим mapping)',
    publishes: ['/map'],
    subscribes: ['/scan'],
    params: { resolution: 0.05, mode: 'mapping', max_laser_range: 8.0, minimum_travel_distance: 0.1 },
  });
  ros.addNode('/battery_monitor', {
    description: 'Состояние батареи робота',
    publishes: ['/battery_state'],
    params: { low_threshold: 15.0, full_voltage: 8.4 },
  });
  ros.addNode('/imu', {
    description: 'Ориентация и угловая скорость',
    publishes: ['/imu'],
    params: { frame_id: 'imu_link' },
  });
  ros.addNode('/garbage_collector', {
    description: 'Манипулятор для сбора мусора',
    publishes: ['/trash_collected'],
    subscribes: ['/gripper'],
  });
  ros.addNode('/teleop_twist_keyboard', {
    description: 'Клавиатурное управление WASD → /cmd_vel',
    publishes: ['/cmd_vel'],
  });

  ros.advertise('/cmd_vel', 'geometry_msgs/msg/Twist', '/teleop_twist_keyboard');
  ros.advertise('/odom', 'nav_msgs/msg/Odometry', '/robot_driver');
  ros.advertise('/scan', 'sensor_msgs/msg/LaserScan', '/lidar');
  ros.advertise('/map', 'nav_msgs/msg/OccupancyGrid', '/slam_toolbox');
  ros.advertise('/battery_state', 'sensor_msgs/msg/BatteryState', '/battery_monitor');
  ros.advertise('/imu', 'sensor_msgs/msg/Imu', '/imu');
  ros.advertise('/joint_states', 'sensor_msgs/msg/JointState', '/robot_driver');
  ros.advertise('/trash_collected', 'std_msgs/msg/Int32', '/garbage_collector');
  ros.advertise('/gripper', 'std_msgs/msg/Bool', '/garbage_collector');

  // ------------------------------------------------------------------- DOM ----
  const $ = (id) => document.getElementById(id);
  const canvas = $('rosCanvas');
  const view = new RosView(canvas, { world, robot, slam });

  const el = {
    coverage: $('rosCoverage'),
    trash: $('rosTrash'),
    battery: $('rosBattery'),
    pose: $('rosPose'),
    room: $('rosRoom'),
    taskList: $('rosTasks'),
    termOut: $('rosTermOut'),
    termIn: $('rosTermIn'),
    hudState: $('rosState'),
  };

  // ---------------------------------------------------------------- вывод ----
  function print(lines, cls = '') {
    if (!el.termOut) return;
    for (const line of [].concat(lines)) {
      const div = document.createElement('div');
      div.className = `term-line ${cls}`.trim();
      div.textContent = line;
      el.termOut.appendChild(div);
    }
    while (el.termOut.childElementCount > 400) el.termOut.firstElementChild.remove();
    el.termOut.scrollTop = el.termOut.scrollHeight;
  }

  function printCmd(cmd) {
    const div = document.createElement('div');
    div.className = 'term-line term-cmd';
    div.innerHTML = '<span class="term-prompt">student@robosim:~$</span> ';
    div.appendChild(document.createTextNode(cmd));
    el.termOut.appendChild(div);
    el.termOut.scrollTop = el.termOut.scrollHeight;
  }

  // --------------------------------------------------------------- действия ----
  const actions = {
    stop() {
      robot.stop();
      state.repeat = null;
      ros.publish('/cmd_vel', { linear: { x: 0 }, angular: { z: 0 } });
    },
    publishCmd(linear, angular, { repeatHz = 0 } = {}) {
      ros.publish('/cmd_vel', { linear: { x: linear }, angular: { z: angular } });
      robot.cmd(linear, angular);
      state.repeat = repeatHz > 0 ? { topic: '/cmd_vel', msg: { linear: { x: linear }, angular: { z: angular } }, hz: repeatHz, acc: 0 } : null;
    },
    collect() {
      const near = state.trash.find((t) => !t.collected && robot.distanceTo(t.x, t.y) < 0.5);
      if (!near) {
        ros.publish('/gripper', { data: true });
        return 'рядом нет мусора — подъедьте ближе 0.5 м (в HUD видно расстояние до ближайшего предмета)';
      }
      near.collected = true;
      state.collected++;
      ros.publish('/gripper', { data: true });
      ros.publish('/trash_collected', { data: state.collected });
      onLog(`Собран предмет «${near.kind}» (${state.collected}/${state.total})`);
      return `собрано: ${near.kind}. Всего ${state.collected} из ${state.total}`;
    },
  };

  const ctx = {
    ros, robot, world, slam, state,
    actions: {
      ...actions,
      reset() { resetRobot(); },
      focus() {},
    },
  };

  function runCommand(line) {
    if (!line.trim()) return;
    printCmd(line);
    let res;
    try {
      res = execute(line, ctx);
    } catch (e) {
      res = { lines: [`внутренняя ошибка: ${e.message}`], error: true };
    }
    if (res.clear) el.termOut.innerHTML = '';
    if (res.lines?.length) print(res.lines, res.error ? 'term-err' : '');
    if (res.error) onLog('Терминал: команда не выполнена');
  }

  // ------------------------------------------------------------ публикация ----
  let pubAcc = 0;
  let slamAcc = 0;
  let taskAcc = 0;
  let drawAcc = 0;
  const PUB_DT = 1 / 20;
  const SLAM_DT = 1 / 12;
  const TASK_DT = 1 / 5;

  function publishScan() {
    const ranges = state.ranges;
    ros.publish('/scan', {
      stamp: ros.clock,
      frame_id: 'laser',
      ranges,
      range_max: robot.maxRange,
    });
  }

  function publishAll() {
    ros.publish('/odom', {
      stamp: ros.clock,
      x: robot.x, y: robot.y, theta: robot.theta,
      v: robot.v, w: robot.w,
    });
    publishScan();
    ros.publish('/imu', { theta: robot.theta, w: robot.w, accel: Math.abs(robot.v) * 0.2 });
    const half = 0.16;
    const vLeft = robot.v - robot.w * half;
    const vRight = robot.v + robot.w * half;
    ros.publish('/joint_states', {
      left: robot.odom - (robot.w * robot.odom) % 1,
      right: robot.odom,
      vLeft, vRight,
    });
    ros.publish('/battery_state', {
      percentage: robot.battery,
      voltage: 6.0 + (robot.battery / 100) * 2.4,
      charging: robot.charging,
    });
    ros.publish('/map', {
      width: slam.w, height: slam.h, resolution: slam.res,
      coverage: state.coverage,
    });
  }

  // ------------------------------------------------------------------ задачи ----
  function snapshot() {
    state.coverage = slam.coverage();
    state.atDock = robot.distanceTo(world.dock.x, world.dock.y) < 0.35;
    state.stopped = Math.abs(robot.v) < 0.02 && Math.abs(robot.w) < 0.05;
    return state;
  }

  function updateTaskProgress() {
    if (!el.taskList) return;
    for (const t of ROS_TASKS) {
      const card = el.taskList.querySelector(`.ros-task[data-id="${t.id}"] .ros-task-progress`);
      if (card) card.textContent = t.progress(state);
    }
  }

  function checkTasks() {
    const snap = snapshot();
    let changed = false;
    for (const t of ROS_TASKS) {
      const done = t.check(snap);
      if (done !== state.solved[t.id]) {
        state.solved[t.id] = done;
        changed = true;
        if (done) {
          markSolved(progress, t.id, { title: t.title });
          saveProgress(progress);
          print([`[TASK] ✔ «${t.title}» выполнено`], 'term-ok');
          onLog(`ROS-задание выполнено: ${t.title}`);
        }
      }
    }
    if (changed) renderTasks();
    else updateTaskProgress();
  }

  function renderTasks() {
    if (!el.taskList) return;
    el.taskList.innerHTML = '';
    for (const t of ROS_TASKS) {
      const done = Boolean(state.solved[t.id]);
      const item = document.createElement('div');
      item.className = `ros-task${done ? ' done' : ''}`;
      item.dataset.id = t.id;
      item.innerHTML = `
        <div class="ros-task-head">
          <span class="ros-task-mark">${done ? '✔' : '○'}</span>
          <span class="ros-task-title">${t.title}</span>
          <span class="ros-task-progress">${t.progress(state)}</span>
        </div>
        <div class="ros-task-topic">${t.level} · ${t.topic}</div>
        <div class="ros-task-text">${t.text}</div>`;
      el.taskList.appendChild(item);
    }
    onTasksChanged();
  }

  // ------------------------------------------------------------------- шаг ----
  let last = 0;
  let rafId = 0;

  function teleopStep() {
    const k = state.keys;
    const up = k.has('w') || k.has('arrowup') || k.has('ц');
    const down = k.has('s') || k.has('arrowdown') || k.has('ы');
    const left = k.has('a') || k.has('arrowleft') || k.has('ф');
    const right = k.has('d') || k.has('arrowright') || k.has('в');
    const keyV = (up ? 0.4 : 0) + (down ? -0.4 : 0);
    const keyW = (left ? 1.0 : 0) + (right ? -1.0 : 0);
    // экранный пульт важнее клавиш: на телефоне клавиатуры нет
    const v = state.pad.v || keyV;
    const w = state.pad.w || keyW;
    const active = Boolean(v || w);
    if (active) {
      robot.cmd(v, w);
      state.repeat = { topic: '/cmd_vel', msg: { linear: { x: v }, angular: { z: w } }, hz: 10, acc: 0, fromKeys: true };
    } else if (state.repeat?.fromKeys) {
      robot.cmd(0, 0);
      state.repeat = null;
    }
  }

  function tick(now) {
    if (!state.running) return;
    rafId = requestAnimationFrame(tick);
    if (!last) last = now;
    const dt = Math.min(0.12, (now - last) / 1000);
    last = now;
    state.time += dt;
    ros.clock += dt;

    teleopStep();
    const hit = robot.step(dt);
    if (hit) {
      onLog('Столкновение — робот остановлен');
      ros.pushLog('collision');
      state.repeat = null;
    }

    // повторная публикация (ros2 topic pub ... -r 10)
    if (state.repeat) {
      state.repeat.acc += dt;
      const period = 1 / state.repeat.hz;
      while (state.repeat.acc >= period) {
        state.repeat.acc -= period;
        ros.publish(state.repeat.topic, state.repeat.msg);
      }
    }

    pubAcc += dt;
    if (pubAcc >= PUB_DT) {
      pubAcc = 0;
      state.ranges = robot.scan();
      publishAll();
    }

    slamAcc += dt;
    if (slamAcc >= SLAM_DT) {
      slamAcc = 0;
      slam.update(robot.pose(), state.ranges);
      view.invalidate();
    }

    taskAcc += dt;
    if (taskAcc >= TASK_DT) {
      taskAcc = 0;
      snapshot();
      checkTasks();
      updateHud();
    }

    drawAcc += dt;
    if (drawAcc >= 1 / 30) {
      drawAcc = 0;
      view.draw({ ranges: state.ranges, trash: state.trash });
    }
  }

  function updateHud() {
    if (el.coverage) el.coverage.textContent = `${Math.round(state.coverage * 100)} %`;
    if (el.trash) el.trash.textContent = `${state.collected} / ${state.total}`;
    if (el.battery) el.battery.textContent = `${Math.round(robot.battery)} %`;
    if (el.pose) el.pose.textContent = `x=${robot.x.toFixed(2)} y=${robot.y.toFixed(2)} θ=${Math.round((robot.theta * 180) / Math.PI)}°`;
    if (el.room) el.room.textContent = roomAt(world, robot.x, robot.y);
    if (el.hudState) {
      const near = state.trash
        .filter((t) => !t.collected)
        .map((t) => robot.distanceTo(t.x, t.y))
        .sort((a, b) => a - b)[0];
      el.hudState.textContent = near !== undefined && near < 0.9
        ? `мусор рядом: ${near.toFixed(2)} м — жмите «Собрать» (E)`
        : 'ищите мусор: он отмечен оранжевым';
    }
  }

  // ------------------------------------------------------------- управление ----
  function bindButtons() {
    const on = (id, ev, fn) => {
      const node = $(id);
      if (node) node.addEventListener(ev, fn);
    };

    on('rosModeSlam', 'click', () => setMode('slam'));
    on('rosModeTruth', 'click', () => setMode('truth'));
    on('rosRays', 'click', () => {
      view.showRays = !view.showRays;
      $('rosRays').classList.toggle('active', view.showRays);
    });
    on('rosPath', 'click', () => {
      view.showPath = !view.showPath;
      $('rosPath').classList.toggle('active', view.showPath);
    });
    on('rosCollect', 'click', () => runCommand('collect'));
    on('rosReset', 'click', () => resetRobot(true));
    on('rosTermClear', 'click', () => { el.termOut.innerHTML = ''; });
    on('rosHelp', 'click', () => runCommand('help'));

    // экранный «пульт» — для тач-экранов и для тех, кому неудобна клавиатура
    for (const [id, dx, dw] of [['rosPadF', 0.4, 0], ['rosPadB', -0.4, 0], ['rosPadL', 0, 1.0], ['rosPadR', 0, -1.0]]) {
      const node = $(id);
      if (!node) continue;
      const press = (e) => {
        e.preventDefault();
        state.pad = { v: dx, w: dw };
        ros.publish('/cmd_vel', { linear: { x: dx }, angular: { z: dw } });
      };
      const release = () => {
        state.pad = { v: 0, w: 0 };
      };
      node.addEventListener('pointerdown', press);
      node.addEventListener('pointerup', release);
      node.addEventListener('pointerleave', release);
      node.addEventListener('pointercancel', release);
    }

    if (el.termIn) {
      const history = [];
      let hIdx = -1;
      el.termIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const line = el.termIn.value;
          if (line.trim()) { history.push(line); hIdx = history.length; }
          el.termIn.value = '';
          runCommand(line);
          e.preventDefault();
        } else if (e.key === 'ArrowUp') {
          if (history.length && hIdx > 0) { hIdx--; el.termIn.value = history[hIdx]; }
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          if (hIdx < history.length - 1) { hIdx++; el.termIn.value = history[hIdx]; }
          else { hIdx = history.length; el.termIn.value = ''; }
          e.preventDefault();
        } else if (e.key === 'Tab') {
          const hits = complete(el.termIn.value);
          if (hits.length === 1) {
            el.termIn.value = hits[0];
          } else if (hits.length > 1) {
            print(hits.slice(0, 8).map((h) => `  ${h}`), 'term-dim');
            const common = hits.reduce((a, b) => {
              let i = 0;
              while (i < a.length && i < b.length && a[i] === b[i]) i++;
              return a.slice(0, i);
            });
            if (common) el.termIn.value = common;
          }
          e.preventDefault();
        } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
          el.termOut.innerHTML = '';
          e.preventDefault();
        }
      });
    }

    window.addEventListener('keydown', onKeys);
    window.addEventListener('keyup', onKeysUp);
    window.addEventListener('resize', () => view._resize());
  }

  function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  function onKeys(e) {
    if (!state.running || isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (k === 'e') { runCommand('collect'); return; }
    state.keys.add(k);
  }

  function onKeysUp(e) {
    state.keys.delete(e.key.toLowerCase());
  }

  function setMode(mode) {
    state.mode = mode;
    view.mode = mode;
    $('rosModeSlam')?.classList.toggle('active', mode === 'slam');
    $('rosModeTruth')?.classList.toggle('active', mode === 'truth');
    view.invalidate();
  }

  function resetRobot(keepMap = false) {
    robot.reset();
    state.repeat = null;
    if (!keepMap) {
      slam.reset();
      view.invalidate();
    }
    robot.path = [{ x: robot.x, y: robot.y }];
    onLog(keepMap ? 'Робот возвращён на док-станцию' : 'Мир сброшен: карта и мусор обнулены');
  }

  function fullReset() {
    resetRobot(false);
    state.trash = world.trash.map((t) => ({ ...t, collected: false }));
    state.collected = 0;
    renderTasks();
  }

  // ------------------------------------------------------------------- API ----
  function start() {
    if (state.running) return;
    state.running = true;
    last = 0;
    view._resize();
    view.invalidate();
    if (el.taskList && !el.taskList.childElementCount) renderTasks();
    updateHud();
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    state.running = false;
    cancelAnimationFrame(rafId);
    state.keys.clear();
    state.pad = { v: 0, w: 0 };
    robot.stop();
  }

  function boot() {
    bindButtons();
    setMode('slam');
    renderTasks();
    print([
      'ROS 2 — симулятор квартиры. Узлы уже запущены: /robot_driver, /lidar, /slam_toolbox, /battery_monitor.',
      'Введите help — список команд. WASD или стрелки — управление, E — собрать мусор.',
    ], 'term-dim');
    start();
  }

  return {
    start, pause, boot, state, robot, slam, ros, view, world,
    runCommand, resetRobot, fullReset, setMode, renderTasks, snapshot,
    checkTasks, ROS_TASKS,
  };
}
