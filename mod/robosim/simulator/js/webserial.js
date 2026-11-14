/**
 * webserial.js — настоящая плата по USB прямо из браузера (Web Serial API).
 *
 * Симулятор умеет не только «понарошку»: кнопка «Реальная плата» просит у
 * браузера USB-порт (Chrome, Edge, Opera — там есть navigator.serial), открывает
 * его и связывает с монитором порта:
 *   • что пришло с платы — попадает в скетч (Serial.available/read, а для
 *     MicroPython — в /dev/ttyACM0) и печатается в мониторе;
 *   • что напечатал скетч (Serial.print) — уходит на плату.
 *
 * Если браузер не умеет Web Serial (Safari, Firefox, встроенное превью),
 * модуль ничего не ломает: кнопка остаётся, но честно говорит, что нужен
 * Chrome/Edge и настоящая плата.
 */

const BAUD = 9600;

/** Состояние подключения — по нему рисуется кнопка и подпись рядом. */
export const webSerial = {
  supported: typeof navigator !== 'undefined' && 'serial' in navigator,
  connected: false,
  busy: false,
  message: '',
  port: null,
  reader: null,
  writer: null,
  _onData: null,
  _onChange: null,
  _keep: null,        // цикл чтения: пока true — читаем
};

/** Подписать модуль на события интерфейса. */
export function initWebSerial({ onData, onChange } = {}) {
  webSerial._onData = onData || null;
  if (onChange) {
    webSerial._onChange = onChange;
    onChange(webSerial);
  }
  return webSerial;
}

function changed(message) {
  if (typeof message === 'string') webSerial.message = message;
  webSerial._onChange?.(webSerial);
}

/** Подключиться: браузер спросит, какой порт открыть. */
export async function connectWebSerial() {
  if (!webSerial.supported) {
    changed('Web Serial есть только в Chrome, Edge или Opera — и нужна настоящая плата в USB');
    return false;
  }
  if (webSerial.connected || webSerial.busy) return webSerial.connected;
  webSerial.busy = true;
  changed('Выберите плату в списке портов…');
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD, bufferSize: 4096 });
    webSerial.port = port;
    webSerial.writer = port.writable.getWriter();
    webSerial.connected = true;
    webSerial.busy = false;
    webSerial._keep = true;
    changed('Плата подключена — данные идут в монитор порта и в скетч');
    readLoop();
    return true;
  } catch (err) {
    webSerial.busy = false;
    webSerial.connected = false;
    changed(err?.name === 'NotFoundError' ? 'Порт не выбран' : `Не удалось открыть порт: ${err?.message || err}`);
    return false;
  }
}

/** Цикл чтения: строки с платы уходят в скетч и в монитор. */
async function readLoop() {
  const { port } = webSerial;
  const decoder = new TextDecoder();
  try {
    while (webSerial._keep && port?.readable) {
      const reader = port.readable.getReader();
      webSerial.reader = reader;
      try {
        while (webSerial._keep) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            webSerial._onData?.(text);
          }
        }
      } finally {
        reader.releaseLock();
        webSerial.reader = null;
      }
    }
  } catch (err) {
    if (webSerial._keep) changed(`Порт закрылся: ${err?.message || err}`);
  }
}

/** Отправить текст на плату (скетч напечатал в Serial). */
export function webSerialSend(text) {
  if (!webSerial.connected || !webSerial.writer || !text) return false;
  const bytes = new TextEncoder().encode(String(text));
  webSerial.writer.write(bytes).catch(() => {
    /* плату выдернули — об этом сообщит цикл чтения */
  });
  return true;
}

/** Отпустить порт. */
export async function disconnectWebSerial() {
  webSerial._keep = false;
  try { await webSerial.reader?.cancel(); } catch { /* уже закрыт */ }
  try { webSerial.writer?.releaseLock(); } catch { /* уже закрыт */ }
  webSerial.writer = null;
  try { await webSerial.port?.close(); } catch { /* уже закрыт */ }
  webSerial.port = null;
  webSerial.connected = false;
  changed('Плата отключена');
}
