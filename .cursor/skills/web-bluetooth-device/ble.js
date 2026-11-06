const STEP_TIMEOUT_MS = 20000;
const MAX_DELAY_MS = 15000;

export function createBle({ profile, onPacket, onLink }) {
  let device = null;
  let notifyCharacteristic = null;
  let writeCharacteristic = null;
  let userDisconnect = true;
  let linking = false;
  let reconnectTimer = null;
  let pollTimer = null;
  let attempt = 0;
  let wakeLock = null;
  let writes = Promise.resolve();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && device && !userDisconnect) requestWakeLock();
  });

  function report(state, message) {
    onLink?.({ state, message });
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on HTTPS or localhost. iPhone and iPad cannot connect.');
    }
    clearReconnect();
    report('selecting', 'Selecting device…');
    let selected;
    try {
      selected = await navigator.bluetooth.requestDevice({
        filters: profile.filters,
        optionalServices: [profile.service]
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
    clearReconnect();
    await teardownLink();
    if (device) device.removeEventListener('gattserverdisconnected', handleDisconnected);
    device = null;
    await releaseWakeLock();
    report('disconnected', 'Disconnected by user.');
  }

  function shutdown() {
    userDisconnect = true;
    clearReconnect();
    const current = notifyCharacteristic;
    detach();
    if (current) current.stopNotifications().catch(() => {});
    if (device?.gatt?.connected) device.gatt.disconnect();
    releaseWakeLock();
  }

  async function openLink() {
    linking = true;
    try {
      const previous = notifyCharacteristic;
      detach();
      if (previous) {
        try { await previous.stopNotifications(); } catch { /* already stopped */ }
      }
      const server = await step('gatt.connect', () => device.gatt.connect());
      const service = await step(`get service ${uuidLabel(profile.service)}`, () => server.getPrimaryService(profile.service));
      const notify = await step(`get characteristic ${uuidLabel(profile.notify)}`, () => service.getCharacteristic(profile.notify));
      if (profile.write != null) {
        writeCharacteristic = profile.write === profile.notify
          ? notify
          : await step(`get characteristic ${uuidLabel(profile.write)}`, () => service.getCharacteristic(profile.write));
      }
      notify.addEventListener('characteristicvaluechanged', handleNotification);
      notifyCharacteristic = notify;
      await step('start notifications', () => notify.startNotifications());
      if (profile.onReady) await step('device init', () => profile.onReady(api));
      startPolling();
      await requestWakeLock();
    } catch (error) {
      detach();
      if (device?.gatt?.connected) device.gatt.disconnect();
      throw error;
    } finally {
      linking = false;
    }
  }

  async function step(label, action) {
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
      const error = new Error(`${label} failed`);
      error.step = label;
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function write(bytes) {
    const job = writes.then(async () => {
      if (!writeCharacteristic) throw new Error('Not connected, or this device has no write characteristic.');
      const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
      if (writeCharacteristic.properties.write) await writeCharacteristic.writeValueWithResponse(data);
      else await writeCharacteristic.writeValueWithoutResponse(data);
    });
    writes = job.catch(() => {});
    return job;
  }

  function startPolling() {
    stopPolling();
    if (!profile.poll) return;
    pollTimer = setInterval(() => {
      profile.poll.run(api).catch((error) => console.warn('Poll failed', error));
    }, profile.poll.everyMs);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function handleNotification(event) {
    const value = event.target.value;
    // The DataView buffer can be reused by the browser; copy before keeping bytes.
    onPacket(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
  }

  function handleDisconnected() {
    detach();
    if (userDisconnect || !device) return;
    // A failed openLink() also drops GATT; its own catch schedules the retry.
    if (linking || reconnectTimer) return;
    scheduleReconnect('Link lost. The browser reported the drop and did not include a reason.');
  }

  function scheduleReconnect(prefix) {
    if (userDisconnect || !device || reconnectTimer) return;
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_DELAY_MS);
    report('reconnecting', `${prefix} Reconnect attempt ${attempt} in ${Math.round(delay / 1000)} s.`);
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
    const current = notifyCharacteristic;
    detach();
    if (current) {
      try { await current.stopNotifications(); } catch (error) { console.warn(error); }
    }
    if (device?.gatt?.connected) device.gatt.disconnect();
  }

  function detach() {
    stopPolling();
    writeCharacteristic = null;
    if (!notifyCharacteristic) return;
    notifyCharacteristic.removeEventListener('characteristicvaluechanged', handleNotification);
    notifyCharacteristic = null;
  }

  function clearReconnect() {
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

  const api = {
    connect,
    disconnect,
    shutdown,
    write,
    isConnected: () => Boolean(device?.gatt?.connected),
    isReconnecting: () => Boolean(reconnectTimer)
  };
  return api;
}

export function createFramer({ header, frameLength, maxBuffer = 4096 }) {
  let buffer = new Uint8Array(0);

  function push(bytes) {
    buffer = concat(buffer, bytes);
    const frames = [];
    for (;;) {
      const start = indexOf(buffer, header);
      if (start < 0) {
        buffer = buffer.slice(Math.max(0, buffer.length - header.length + 1));
        break;
      }
      if (start > 0) buffer = buffer.slice(start);
      const length = frameLength(buffer);
      if (length == null) break;
      if (length < header.length) {
        buffer = buffer.slice(1);
        continue;
      }
      if (buffer.length < length) break;
      frames.push(buffer.slice(0, length));
      buffer = buffer.slice(length);
    }
    if (buffer.length > maxBuffer) buffer = new Uint8Array(0);
    return frames;
  }

  return {
    push,
    reset: () => { buffer = new Uint8Array(0); }
  };
}

function concat(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function indexOf(bytes, pattern) {
  outer: for (let i = 0; i <= bytes.length - pattern.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function uuidLabel(uuid) {
  return typeof uuid === 'number' ? `0x${uuid.toString(16).toUpperCase().padStart(4, '0')}` : uuid;
}

function describeError(error) {
  if (!error) return '';
  const name = error.name && error.name !== 'Error' ? error.name : '';
  const message = (error.message || '').replace(/[.\s]+$/, '');
  if (name && message) return `: ${name}: ${message}`;
  if (name || message) return `: ${name || message}`;
  return '';
}
