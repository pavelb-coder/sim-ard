/**
 * terminal.js — терминал в стиле ROS 2.
 *
 * Разбирает команды `ros2 topic/node/param/...`, отдаёт строки вывода и,
 * если команда что-то делает (например, публикует скорость), дергает
 * колбэки из ctx.actions. Никакого DOM: модуль тестируется в Node.
 */

const num = (v, digits = 2) => (Number.isFinite(v) ? Number(v).toFixed(digits) : String(v));

/** Простой разбор аргументов с кавычками: pub /cmd_vel geometry_msgs/msg/Twist "{...}" */
export function splitArgs(line) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Достать значения из YAML-подобной строки Twist — так пишут в реальном терминале. */
export function parseTwist(text) {
  const t = String(text || '');
  const grab = (section, axis) => {
    const reSection = new RegExp(`${section}\\s*:\\s*\\{([^}]*)\\}`, 'i');
    const m = reSection.exec(t);
    if (m) {
      const reAxis = new RegExp(`${axis}\\s*:\\s*(-?[\\d.]+(?:e-?\\d+)?)`, 'i');
      const a = reAxis.exec(m[1]);
      if (a) return Number(a[1]);
    }
    const reFlat = new RegExp(`${section}[.\\s]*${axis}\\s*:\\s*(-?[\\d.]+)`, 'i');
    const f = reFlat.exec(t);
    return f ? Number(f[1]) : 0;
  };
  return { linear: grab('linear', 'x'), angular: grab('angular', 'z') };
}

// -------------------------------------------------------------- форматирование ----

export function formatMessage(topic, msg) {
  if (!msg) return ['данных пока нет — узел ещё не публиковал сообщение'];
  const t = topic.replace(/^\//, '');
  if (t === 'scan') {
    const ranges = msg.ranges || [];
    const show = [];
    for (let i = 0; i < ranges.length; i += Math.max(1, Math.floor(ranges.length / 8))) {
      show.push(num(ranges[i], 2));
    }
    return [
      'header:',
      `  stamp: {sec: ${Math.floor(msg.stamp || 0)}}`,
      `  frame_id: "${msg.frame_id || 'laser'}"`,
      'angle_min: -3.1415927',
      'angle_max: 3.1415927',
      `angle_increment: ${num((Math.PI * 2) / Math.max(1, ranges.length - 1), 6)}`,
      'range_min: 0.12',
      `range_max: ${num(msg.range_max ?? 8, 1)}`,
      `ranges: [${show.join(', ')}, …]  # всего ${ranges.length}`,
    ];
  }
  if (t === 'odom') {
    return [
      'header: {frame_id: "odom"}',
      'pose:',
      '  pose:',
      `    position: {x: ${num(msg.x, 3)}, y: ${num(msg.y, 3)}, z: 0.0}`,
      `    orientation: {yaw: ${num(msg.theta, 3)}}`,
      'twist:',
      `  twist: {linear: {x: ${num(msg.v, 3)}}, angular: {z: ${num(msg.w, 3)}}}`,
    ];
  }
  if (t === 'cmd_vel') {
    return [
      `linear:`,
      `  x: ${num(msg.linear?.x ?? 0, 3)}`,
      `angular:`,
      `  z: ${num(msg.angular?.z ?? 0, 3)}`,
    ];
  }
  if (t === 'map') {
    return [
      `header: {frame_id: "map"}`,
      `info: {width: ${msg.width}, height: ${msg.height}, resolution: ${num(msg.resolution, 2)}}`,
      `origin: {x: 0.0, y: 0.0}`,
      `data: <${msg.width * msg.height} ячеек: -1 неизвестно, 0 свободно, 100 занято>`,
      `# исследовано ${num((msg.coverage || 0) * 100, 0)} % доступной площади`,
    ];
  }
  if (t === 'battery_state') {
    return [
      `percentage: ${num(msg.percentage, 1)}`,
      `voltage: ${num(msg.voltage, 2)}`,
      `charging: ${msg.charging ? 'true' : 'false'}`,
    ];
  }
  if (t === 'imu') {
    return [
      'orientation:',
      `  yaw: ${num(msg.theta, 3)}`,
      'angular_velocity:',
      `  z: ${num(msg.w, 3)}`,
      `linear_acceleration: {x: ${num(msg.accel ?? 0, 2)}, y: 0.0, z: 9.81}`,
    ];
  }
  if (t === 'joint_states') {
    return [
      'name: ["wheel_left_joint", "wheel_right_joint"]',
      `position: [${num(msg.left, 2)}, ${num(msg.right, 2)}]`,
      `velocity: [${num(msg.vLeft, 2)}, ${num(msg.vRight, 2)}]`,
    ];
  }
  if (t === 'trash_collected') return [`data: ${msg.data}`];
  if (t === 'gripper') return [`data: ${msg.data}`];
  return [JSON.stringify(msg)];
}

const ok = (lines) => ({ lines: Array.isArray(lines) ? lines : [lines] });
const err = (text) => ({ lines: [text], error: true });

// ------------------------------------------------------------------- команды ----

const HELP = [
  'Доступные команды (всё локально, интернет не нужен):',
  '  ros2 topic list [-t]              список топиков (с типами)',
  '  ros2 topic echo /scan             последнее сообщение топика',
  '  ros2 topic hz /scan               частота публикации',
  '  ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}}" [-r 10]',
  '  ros2 node list                    узлы графа',
  '  ros2 node info /slam_toolbox      что узел публикует и слушает',
  '  ros2 param list [узел] / get / set',
  '  ros2 service list                 сервисы',
  '  ros2 launch robosim bringup.launch.py',
  '  status                            отчёт: карта, мусор, батарея',
  '  collect                           собрать мусор рядом с роботом',
  '  stop                              остановить робота',
  '  clear                             очистить терминал',
  'Подсказка: WASD или стрелки тоже дают /cmd_vel, как teleop_twist_keyboard.',
];

export function execute(line, ctx) {
  const raw = String(line || '').trim();
  if (!raw) return ok([]);
  const args = splitArgs(raw);
  const cmd = args[0].toLowerCase();

  if (cmd === 'help' || cmd === '?') return ok(HELP);
  if (cmd === 'clear') return { lines: [], clear: true };
  if (cmd === 'stop') { ctx.actions.stop(); return ok(['робот остановлен (нулевая /cmd_vel)']); }
  if (cmd === 'status') return ok(statusReport(ctx));
  if (cmd === 'collect') return ok([ctx.actions.collect()]);

  if (cmd !== 'ros2') {
    return err(`команда «${args[0]}» не найдена. Введите help.`);
  }

  const group = (args[1] || '').toLowerCase();

  if (group === 'topic') return cmdTopic(args.slice(2), ctx);
  if (group === 'node') return cmdNode(args.slice(2), ctx);
  if (group === 'param') return cmdParam(args.slice(2), ctx);
  if (group === 'service') {
    return ok([
      'Сервисы платформы:',
      '  /slam_toolbox/save_map        (slam_toolbox/srv/SaveMap)',
      '  /slam_toolbox/reset           (std_srvs/srv/Empty)',
      '  /robot_driver/reset_odometry  (std_srvs/srv/Empty)',
      '  /battery_monitor/charge       (std_srvs/srv/Trigger)',
    ]);
  }
  if (group === 'launch') {
    const file = args[3] || 'bringup.launch.py';
    return ok([
      `[INFO] [launch]: запускаю ${file}`,
      '[INFO] [robot_driver-1]: процесс стартовал (симуляция уже работает)',
      '[INFO] [lidar-2]: 240 лучей, 8.0 м',
      '[INFO] [slam_toolbox-3]: режим mapping, разрешение 0.05 м',
    ]);
  }
  if (group === 'run') {
    const node = args[3] || args[2];
    if (node && ctx.ros.nodes.has(`/${node}`)) return ok([`[INFO] [${node}]: уже запущен`]);
    return err(`пакет или узел «${node}» не найден. Есть: ros2 node list`);
  }
  if (group === 'pkg') return ok(['Пакеты: robosim, slam_toolbox, teleop_twist_keyboard, robot_driver', 'lidar', 'battery_monitor']);
  return err(`неизвестная группа «${args[1]}». Введите help.`);
}

function cmdTopic(rest, ctx) {
  const sub = (rest[0] || '').toLowerCase();
  const { ros } = ctx;

  if (sub === 'list') {
    const withTypes = rest.includes('-t') || rest.includes('--with-types');
    const list = ros.topicList();
    if (!list.length) return ok(['топиков нет']);
    return ok(withTypes ? list.map((t) => `${t.name} [${t.type}]`) : list.map((t) => t.name));
  }

  if (sub === 'echo') {
    const name = norm(rest[1]);
    if (!name) return err('укажите топик: ros2 topic echo /scan');
    const t = ros.topic(name);
    if (!t) return err(`топик ${name} не найден. Список: ros2 topic list`);
    return ok(formatMessage(name, t.last));
  }

  if (sub === 'hz') {
    const name = norm(rest[1]);
    const t = ros.topic(name);
    if (!t) return err(`топик ${name} не найден`);
    const hz = ros.hz(name);
    return ok([`average rate: ${num(hz, 1)}  (${t.count} сообщений всего)`]);
  }

  if (sub === 'info') {
    const name = norm(rest[1]);
    const t = ros.topic(name);
    if (!t) return err(`топик ${name} не найден`);
    return ok([
      `Топик: ${t.name}`,
      `  Тип: ${t.type}`,
      `  Публикует: ${t.node || '—'}`,
      `  Сообщений: ${t.count}`,
      `  Частота: ${num(ros.hz(name), 1)} Гц`,
    ]);
  }

  if (sub === 'pub') {
    const name = norm(rest[1]);
    if (!name) return err('укажите топик: ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "..."');
    const t = ros.topic(name);
    if (!t) return err(`топик ${name} не найден`);
    // аргументы могут быть в любом порядке: тип и «yaml»
    const payload = rest.slice(2).filter((a) => !a.startsWith('-')).join(' ');
    const rateIdx = rest.findIndex((a) => a === '-r' || a === '--rate');
    const rate = rateIdx >= 0 ? Number(rest[rateIdx + 1]) || 10 : 0;
    const once = rest.includes('--once');

    if (name === '/cmd_vel') {
      const twist = parseTwist(payload);
      ctx.actions.publishCmd(twist.linear, twist.angular, { repeatHz: once ? 0 : rate });
      return ok([
        `publisher: linear.x=${num(twist.linear, 2)}, angular.z=${num(twist.angular, 2)}`,
        rate ? `публикую с частотой ${rate} Гц (нажмите stop, чтобы остановить)` : 'опубликовано 1 сообщение',
      ]);
    }
    if (name === '/gripper') {
      const on = /true|1/i.test(payload);
      return ok([on ? ctx.actions.collect() : 'захват разжат']);
    }
    return err(`публикация в ${name} не поддерживается в симуляторе (есть /cmd_vel и /gripper)`);
  }

  return err(`неизвестная подкоманда topic «${rest[0]}». Есть: list, echo, hz, info, pub`);
}

function cmdNode(rest, ctx) {
  const sub = (rest[0] || '').toLowerCase();
  const { ros } = ctx;
  if (sub === 'list') return ok(ros.nodeList());
  if (sub === 'info') {
    const name = norm(rest[1]);
    const n = ros.nodes.get(name);
    if (!n) return err(`узел ${name} не найден. Список: ros2 node list`);
    return ok([
      `${name}`,
      `  ${n.description}`,
      '  Публикует:',
      ...(n.publishes.length ? n.publishes.map((t) => `    ${t}`) : ['    —']),
      '  Подписан:',
      ...(n.subscribes.length ? n.subscribes.map((t) => `    ${t}`) : ['    —']),
    ]);
  }
  return err('используйте: ros2 node list | ros2 node info /имя');
}

function cmdParam(rest, ctx) {
  const sub = (rest[0] || '').toLowerCase();
  const { ros } = ctx;
  if (sub === 'list') {
    const node = norm(rest[1]);
    const names = node ? [node] : ros.nodeList();
    const lines = ['/robot_driver:', '/lidar:', '/slam_toolbox:', '/battery_monitor:'];
    const out = [];
    for (const n of names) {
      const nodeInfo = ros.nodes.get(n);
      const params = nodeInfo?.params || {};
      if (!Object.keys(params).length) continue;
      out.push(`  ${n}:`);
      for (const [k, v] of Object.entries(params)) out.push(`    ${k}: ${JSON.stringify(v)}`);
    }
    return ok(out.length ? out : lines);
  }
  if (sub === 'get') {
    const node = norm(rest[1]);
    const key = rest[2];
    if (!key) return err('ros2 param get /slam_toolbox resolution');
    const value = ros.getParam(node, key);
    if (value === undefined) return err(`параметр ${key} у ${node} не найден`);
    return ok([`${node.startsWith('/') ? node : '/' + node} ${key}: ${JSON.stringify(value)}`]);
  }
  if (sub === 'set') {
    const node = norm(rest[1]);
    const key = rest[2];
    const valueRaw = rest.slice(3).join(' ');
    const value = /^-?[\d.]+$/.test(valueRaw) ? Number(valueRaw) : /^(true|false)$/i.test(valueRaw) ? valueRaw.toLowerCase() === 'true' : valueRaw;
    if (!key) return err('ros2 param set /slam_toolbox mode mapping');
    const done = ros.setParam(node, key, value);
    return done
      ? ok([`Set parameter successful`])
      : err(`узел ${node} не найден или параметр только для чтения`);
  }
  return err('используйте: ros2 param list | get | set');
}

function statusReport(ctx) {
  const { robot, slam, state } = ctx;
  return [
    `Карта: исследовано ${num(slam.coverage() * 100, 1)} % доступной площади`,
    `Мусор: собрано ${state.collected} из ${ctx.world.trash.length}`,
    `Батарея: ${num(robot.battery, 0)} %${robot.charging ? ' (на доке, заряжается)' : ''}`,
    `Пробег: ${num(robot.odom, 1)} м, столкновений: ${robot.collisions}`,
    `Позиция: x=${num(robot.x, 2)}, y=${num(robot.y, 2)}, θ=${num((robot.theta * 180) / Math.PI, 0)}°`,
  ];
}

const norm = (name) => {
  if (!name) return null;
  const n = String(name);
  return n.startsWith('/') ? n : `/${n}`;
};

/** Подсказки для Tab: возвращает варианты завершения текущей строки. */
export function complete(line) {
  const all = [
    'help', 'status', 'collect', 'stop', 'clear',
    'ros2 topic list', 'ros2 topic list -t', 'ros2 topic echo /scan', 'ros2 topic echo /odom',
    'ros2 topic hz /scan', 'ros2 topic hz /odom',
    'ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}}" -r 10',
    'ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{angular: {z: 0.8}}"',
    'ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0}}"',
    'ros2 node list', 'ros2 node info /slam_toolbox', 'ros2 node info /robot_driver',
    'ros2 param list', 'ros2 param get /slam_toolbox resolution', 'ros2 param set /slam_toolbox mode mapping',
    'ros2 service list', 'ros2 launch robosim bringup.launch.py',
  ];
  const s = line.trim();
  if (!s) return all;
  const hits = all.filter((c) => c.startsWith(s));
  return hits.length ? hits : all.filter((c) => c.includes(s));
}
