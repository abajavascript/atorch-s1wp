import { DEVICE_NAME, NOTIFY_UUID, SERVICE_UUID } from './protocol.js';

const STEP_TIMEOUT_MS = 20000;
const MAX_DELAY_MS = 15000;

const STEPS = {
  connect: 'gatt.connect',
  service: 'get service 0xFFE0',
  characteristic: 'get characteristic 0xFFE1',
  notify: 'start notifications'
};

export function createBle({ onPacket, onLink }) {
  let device = null;
  let characteristic = null;
  let userDisconnect = true;
  let linking = false;
  let reconnectTimer = null;
  let attempt = 0;
  let wakeLock = null;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && device && !userDisconnect) {
      requestWakeLock();
    }
  });

  function report(state, message) {
    onLink?.({ state, message });
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on HTTPS or localhost. iPhone cannot connect.');
    }
    clearTimer();
    report('selecting', 'Selecting device…');
    let selected;
    try {
      selected = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID]
      });
    } catch (error) {
      if (device?.gatt?.connected) report('connected', connectedLabel());
      else report('disconnected', `No device selected${describeError(error)}`);
      return;
    }
    userDisconnect = true;
    if (device) device.removeEventListener('gattserverdisconnected', handleDisconnected);
    await teardownLink();
    userDisconnect = false;
    device = selected;
    device.addEventListener('gattserverdisconnected', handleDisconnected);
    report('connecting', `Connecting to ${device.name || 'BLE device'}…`);
    try {
      await openLink();
      report('connected', connectedLabel());
    } catch (error) {
      scheduleReconnect(`Connect failed at ${error.step || 'unknown step'}${describeError(error.cause || error)}.`);
    }
  }

  async function disconnect() {
    userDisconnect = true;
    clearTimer();
    await teardownLink();
    if (device) device.removeEventListener('gattserverdisconnected', handleDisconnected);
    device = null;
    await releaseWakeLock();
    report('disconnected', 'Disconnected by user.');
  }

  function shutdown() {
    userDisconnect = true;
    clearTimer();
    const current = characteristic;
    detachCharacteristic();
    if (current) current.stopNotifications().catch(() => {});
    if (device?.gatt?.connected) device.gatt.disconnect();
    releaseWakeLock();
  }

  async function openLink() {
    linking = true;
    try {
      const previous = characteristic;
      detachCharacteristic();
      if (previous) {
        try { await previous.stopNotifications(); } catch { /* already stopped */ }
      }
      const server = await step('connect', () => device.gatt.connect());
      const service = await step('service', () => server.getPrimaryService(SERVICE_UUID));
      const next = await step('characteristic', () => service.getCharacteristic(NOTIFY_UUID));
      next.addEventListener('characteristicvaluechanged', handleNotification);
      characteristic = next;
      try {
        await step('notify', () => next.startNotifications());
      } catch (error) {
        detachCharacteristic();
        throw error;
      }
      await requestWakeLock();
    } catch (error) {
      if (device?.gatt?.connected) device.gatt.disconnect();
      throw error;
    } finally {
      linking = false;
    }
  }

  async function step(key, action) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`No answer within ${STEP_TIMEOUT_MS / 1000} s`);
        error.name = 'TimeoutError';
        reject(error);
      }, STEP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([action(), timeout]);
    } catch (cause) {
      const error = new Error(`${STEPS[key]} failed`);
      error.step = STEPS[key];
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function handleNotification(event) {
    const value = event.target.value;
    onPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  function handleDisconnected() {
    detachCharacteristic();
    if (userDisconnect || !device) return;
    // A failed openLink() also drops GATT; its own catch schedules the retry.
    if (linking || reconnectTimer) return;
    scheduleReconnect('Link lost. The browser reported the drop and did not include a reason.');
  }

  function scheduleReconnect(prefix) {
    if (userDisconnect || !device || reconnectTimer) return;
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_DELAY_MS);
    report('reconnecting', `${prefix} Reconnect attempt ${attempt} in ${formatSeconds(delay)}.`);
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (userDisconnect || !device) return;
      const current = attempt;
      try {
        await openLink();
        attempt = 0;
        report('connected', `Reconnected on attempt ${current}. ${connectedLabel()}`);
      } catch (error) {
        if (userDisconnect) return;
        scheduleReconnect(`Reconnect attempt ${current} failed at ${error.step || 'unknown step'}${describeError(error.cause || error)}. Still retrying.`);
      }
    }, delay);
  }

  async function teardownLink() {
    const current = characteristic;
    detachCharacteristic();
    if (current) {
      try { await current.stopNotifications(); } catch (error) { console.warn(error); }
    }
    if (device?.gatt?.connected) device.gatt.disconnect();
  }

  function detachCharacteristic() {
    if (!characteristic) return;
    characteristic.removeEventListener('characteristicvaluechanged', handleNotification);
    characteristic = null;
  }

  function clearTimer() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    attempt = 0;
  }

  function connectedLabel() {
    return `Connected: ${device?.name || 'BLE device'}`;
  }

  async function requestWakeLock() {
    if (!navigator.wakeLock || wakeLock || document.visibilityState !== 'visible') return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch (error) {
      console.warn('Wake lock unavailable', error);
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch { /* already released */ }
    wakeLock = null;
  }

  return {
    connect,
    disconnect,
    shutdown,
    isConnected: () => Boolean(device?.gatt?.connected),
    isReconnecting: () => Boolean(reconnectTimer)
  };
}

function describeError(error) {
  if (!error) return '';
  const name = error.name && error.name !== 'Error' ? error.name : '';
  const message = (error.message || '').replace(/[.\s]+$/, '');
  if (name && message) return `: ${name}: ${message}`;
  if (name || message) return `: ${name || message}`;
  return '';
}

function formatSeconds(ms) {
  return `${Math.round(ms / 1000)} s`;
}
