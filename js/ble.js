import { DEVICE_NAME, NOTIFY_UUID, SERVICE_UUID } from './protocol.js';

export function createBle({ onPacket, onStatus, onError }) {
  let device = null;
  let characteristic = null;
  let userDisconnect = true;
  let reconnectTimer = null;
  let attempt = 0;
  let wakeLock = null;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && device?.gatt?.connected) {
      requestWakeLock();
    }
  });

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is unavailable. Use Chrome or Edge on HTTPS or localhost. iPhone cannot connect.');
    }
    userDisconnect = false;
    clearTimer();
    onStatus('Selecting device…');
    let selected;
    try {
      selected = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
        optionalServices: [SERVICE_UUID]
      });
    } catch (error) {
      onStatus(device?.gatt?.connected ? connectedLabel() : 'Disconnected');
      throw error;
    }
    if (device) device.removeEventListener('gattserverdisconnected', handleDisconnected);
    await teardownLink();
    device = selected;
    device.addEventListener('gattserverdisconnected', handleDisconnected);
    try {
      await openLink();
    } catch (error) {
      scheduleReconnect();
      throw error;
    }
  }

  async function disconnect() {
    userDisconnect = true;
    clearTimer();
    await teardownLink();
    if (device) device.removeEventListener('gattserverdisconnected', handleDisconnected);
    device = null;
    onStatus('Disconnected');
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
    onStatus('Connecting…');
    const previous = characteristic;
    detachCharacteristic();
    if (previous) {
      try { await previous.stopNotifications(); } catch { /* already stopped */ }
    }
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const next = await service.getCharacteristic(NOTIFY_UUID);
    next.addEventListener('characteristicvaluechanged', handleNotification);
    characteristic = next;
    try {
      await next.startNotifications();
    } catch (error) {
      detachCharacteristic();
      throw error;
    }
    attempt = 0;
    await requestWakeLock();
    onStatus(connectedLabel());
  }

  function handleNotification(event) {
    const value = event.target.value;
    onPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }

  function handleDisconnected() {
    detachCharacteristic();
    releaseWakeLock();
    if (userDisconnect || !device) {
      onStatus('Disconnected');
      return;
    }
    scheduleReconnect();
  }

  function scheduleReconnect() {
    if (userDisconnect || !device || reconnectTimer) return;
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 15000);
    onStatus('Reconnecting…');
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (userDisconnect || !device) return;
      try {
        await openLink();
      } catch (error) {
        onError?.(error);
        scheduleReconnect();
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
    await releaseWakeLock();
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
    if (!navigator.wakeLock || wakeLock) return;
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
