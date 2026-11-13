/**
 * bus.js — маленькая шина в стиле ROS 2.
 *
 * Здесь нет DDS и процессов: это карта топиков, узлов и параметров, через
 * которую симулятор «разговаривает» со своим же терминалом. Но интерфейс
 * тот же, что у настоящего ROS 2 — topic list, node info, param get,
 * topic echo/hz/pub — поэтому команды из терминала выглядят знакомо.
 */

export class RosBus {
  constructor() {
    this.topics = new Map();   // name → { type, node, last, count, stamps[], subscribers }
    this.nodes = new Map();    // name → { description, publishes[], subscribes[], params{} }
    this.clock = 0;            // секунды симуляции
    this.log = [];
  }

  /** Зарегистрировать узел: что он публикует и слушает. */
  addNode(name, { description = '', publishes = [], subscribes = [], params = {} } = {}) {
    this.nodes.set(name, { name, description, publishes, subscribes, params: { ...params } });
    return name;
  }

  /** Объявить топик (тип в стиле ROS 2: std_msgs/msg/Float32 и т.д.). */
  advertise(name, type, node = '') {
    if (!this.topics.has(name)) {
      this.topics.set(name, { name, type, node, last: null, count: 0, stamps: [], subscribers: 0 });
    }
    return this.topics.get(name);
  }

  /** Публикация сообщения — как publisher.publish(msg). */
  publish(name, msg) {
    const t = this.topics.get(name);
    if (!t) return false;
    t.last = msg;
    t.count++;
    t.stamps.push(this.clock);
    if (t.stamps.length > 60) t.stamps.shift();
    return true;
  }

  subscribe(name) {
    const t = this.topics.get(name);
    if (t) t.subscribers++;
    return Boolean(t);
  }

  topicList() { return [...this.topics.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  nodeList() { return [...this.nodes.keys()].sort(); }
  topic(name) { return this.topics.get(name) || null; }

  /** Частота публикации по последним сообщениям (Гц). */
  hz(name) {
    const t = this.topics.get(name);
    if (!t || t.stamps.length < 2) return 0;
    const span = t.stamps[t.stamps.length - 1] - t.stamps[0];
    return span > 0 ? (t.stamps.length - 1) / span : 0;
  }

  setParam(node, key, value) {
    const n = this.nodes.get(node);
    if (!n) return false;
    n.params[key] = value;
    return true;
  }

  getParam(node, key) {
    const n = this.nodes.get(node);
    return n ? n.params[key] : unwrapParam(node, key);
  }

  pushLog(text) {
    this.log.push({ t: this.clock, text });
    if (this.log.length > 200) this.log.shift();
  }
}

/** Параметры «платформы», которые есть даже без узла (как в ROS 2 — с префиксом). */
const PLATFORM_PARAMS = {
  '/slam_toolbox': { resolution: 0.05, mode: 'mapping', max_laser_range: 8.0, minimum_travel_distance: 0.1 },
  '/lidar': { samples: 240, range_max: 8.0, range_min: 0.12, frame_id: 'laser' },
  '/robot_driver': { max_speed: 0.55, wheel_separation: 0.32, frame_id: 'base_link' },
  '/battery_monitor': { low_threshold: 15.0, full_voltage: 8.4 },
};

function unwrapParam(node, key) {
  const pack = PLATFORM_PARAMS[node];
  return pack ? pack[key] : undefined;
}

export function platformParams(node) { return PLATFORM_PARAMS[node] || null; }
export function platformParamsNodes() { return Object.keys(PLATFORM_PARAMS); }
