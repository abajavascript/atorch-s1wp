import { createBle } from './ble.js';
import { createChart } from './chart.js';
import { createLogger } from './log.js';
import { decodeAtorch, formatHex } from './protocol.js';

const elements = Object.fromEntries(
  ['connect', 'disconnect', 'status', 'count', 'error', 'connectionNote', 'zero', 'fileName', 'rows',
    'logMode', 'intervalSeconds', 'startLog', 'stopLog', 'logState', 'header', 'raw', 'chips', 'chart',
    'fileChoice', 'fileChoiceText', 'fileAppend', 'fileOverride', 'fileCancel']
    .map((id) => [id, document.getElementById(id)])
);

const valueElements = Object.fromEntries(
  ['voltage', 'current', 'power', 'energy', 'baseline', 'accumulated', 'powerFactor', 'temperature', 'frequency', 'runtime']
    .map((id) => [id, document.getElementById(`metric-${id}`)])
);

let packetCount = 0;
let latest = null;

const chart = createChart(elements.chart);
const logger = createLogger({
  onFile: (name) => {
    elements.fileName.textContent = name;
  },
  onRows: (count) => {
    elements.rows.textContent = String(count);
  },
  onError: (error) => {
    elements.error.textContent = error.message || String(error);
  }
});

const ble = createBle({
  onPacket: (bytes) => {
    showPacket(bytes);
  },
  onStatus: (status) => {
    elements.status.textContent = status;
    if (status.startsWith('Connected')) setLinkState('connected');
    else if (status === 'Reconnecting…' || status === 'Connecting…' || status === 'Selecting device…') {
      setLinkState(status === 'Selecting device…' ? 'connecting' : status === 'Reconnecting…' ? 'reconnecting' : 'connecting');
    } else if (status === 'Disconnected') setLinkState('disconnected');
  },
  onError: (error) => {
    if (error?.name === 'AbortError') return;
    elements.error.textContent = error.message || String(error);
  }
});

function setLinkState(state) {
  elements.connect.disabled = state !== 'disconnected';
  elements.disconnect.disabled = state === 'disconnected';
}

function syncLogButtons() {
  const logging = logger.isLogging();
  elements.startLog.disabled = logging;
  elements.stopLog.disabled = !logging;
  elements.logState.textContent = logging ? 'Logging' : logger.hasFile() ? 'Ready' : 'No file';
  elements.intervalSeconds.disabled = elements.logMode.value !== 'interval';
}

function showError(error) {
  if (error?.name === 'AbortError') return;
  elements.error.textContent = error?.message || String(error);
}

function formatFixed(value, digits, unit) {
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function render(sample) {
  valueElements.voltage.textContent = formatFixed(sample.voltage, 1, 'V');
  valueElements.current.textContent = formatFixed(sample.current, 3, 'A');
  valueElements.power.textContent = formatFixed(sample.power, 1, 'W');
  valueElements.energy.textContent = formatFixed(sample.energy, 2, 'kWh');
  valueElements.powerFactor.textContent = sample.powerFactor.toFixed(3);
  valueElements.temperature.textContent = formatFixed(sample.temperature, 0, '°C');
  valueElements.frequency.textContent = formatFixed(sample.frequency, 1, 'Hz');
  valueElements.runtime.textContent = sample.runtime;

  const baseline = logger.getBaseline();
  if (baseline == null) {
    valueElements.baseline.textContent = '—';
    valueElements.accumulated.textContent = '—';
    return;
  }
  const accumulated = sample.energy - baseline;
  valueElements.baseline.textContent = formatFixed(baseline, 2, 'kWh');
  valueElements.accumulated.textContent = `${accumulated.toFixed(2)} kWh · ${formatWattHours(accumulated)}`;
}

function formatWattHours(kwh) {
  const wattHours = kwh * 1000;
  const digits = Math.abs(wattHours) >= 100 ? 0 : 1;
  return `${wattHours.toFixed(digits)} Wh`;
}

function showPacket(bytes) {
  elements.raw.textContent = `${formatHex(bytes)}\n\nLength: ${bytes.length} bytes`;
  try {
    const decoded = decodeAtorch(bytes);
    latest = decoded;
    packetCount += 1;
    elements.count.textContent = String(packetCount);
    elements.error.textContent = '';
    elements.zero.disabled = false;
    render(decoded);
    chart.push(decoded, Date.now());
    logger.onSample(decoded, new Date());
    elements.header.textContent = [
      `Header bytes [0..3]: ${formatHex(decoded.header)}`,
      `Prefix [0..1]: ${formatHex(decoded.header.slice(0, 2))}`,
      `Type / flags [2..3] (undecoded): ${formatHex(decoded.header.slice(2))}`,
      `Trailing bytes [31..] (undecoded): ${formatHex(decoded.trailing) || '(none)'}`,
      'Checksum: not verified'
    ].join('\n');
  } catch (error) {
    elements.error.textContent = error.message;
  }
}

async function zeroAccumulated() {
  if (!latest) {
    elements.error.textContent = 'Wait for a reading before zeroing accumulated energy.';
    return;
  }
  await logger.flushPartial();
  logger.setBaseline(latest.energy);
  chart.clear();
  chart.push(latest, Date.now());
  render(latest);
}

async function guarded(action) {
  try {
    elements.error.textContent = '';
    await action();
  } catch (error) {
    showError(error);
  }
}

elements.connect.addEventListener('click', () => guarded(() => ble.connect()));
elements.disconnect.addEventListener('click', () => guarded(() => ble.disconnect()));
elements.zero.addEventListener('click', () => guarded(zeroAccumulated));
elements.logMode.addEventListener('change', () => guarded(async () => {
  await logger.flushPartial();
  logger.setMode(elements.logMode.value);
  syncLogButtons();
}));
elements.intervalSeconds.addEventListener('change', () => {
  logger.setIntervalSeconds(elements.intervalSeconds.value);
  elements.intervalSeconds.value = String(Math.max(1, Math.floor(Number(elements.intervalSeconds.value)) || 1));
});
let startingLog = false;

function askFileChoice({ name, canAppend }) {
  elements.fileChoiceText.textContent = canAppend
    ? `${name} already has an S1WP log. Append new rows, or override the file?`
    : `${name} is not an S1WP log. Override it to start a new log, or cancel.`;
  elements.fileAppend.hidden = !canAppend;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (elements.fileChoice.open) elements.fileChoice.close();
      resolve(value);
    };
    const onAppend = () => finish('append');
    const onOverride = () => finish('override');
    const onCancel = () => finish(null);
    const onClose = () => finish(null);
    function cleanup() {
      elements.fileAppend.removeEventListener('click', onAppend);
      elements.fileOverride.removeEventListener('click', onOverride);
      elements.fileCancel.removeEventListener('click', onCancel);
      elements.fileChoice.removeEventListener('close', onClose);
    }
    elements.fileAppend.addEventListener('click', onAppend);
    elements.fileOverride.addEventListener('click', onOverride);
    elements.fileCancel.addEventListener('click', onCancel);
    elements.fileChoice.addEventListener('close', onClose);
    elements.fileChoice.showModal();
  });
}

elements.startLog.addEventListener('click', () => guarded(async () => {
  if (startingLog || logger.isLogging()) return;
  startingLog = true;
  elements.startLog.disabled = true;
  try {
    logger.setMode(elements.logMode.value);
    logger.setIntervalSeconds(elements.intervalSeconds.value);
    await logger.openForLogging(askFileChoice);
  } finally {
    startingLog = false;
    syncLogButtons();
  }
}));
elements.stopLog.addEventListener('click', () => guarded(async () => {
  await logger.stop();
  syncLogButtons();
}));

for (const button of elements.chips.querySelectorAll('button')) {
  button.addEventListener('click', () => {
    chart.setActive(button.dataset.series);
    for (const chip of elements.chips.querySelectorAll('button')) {
      chip.setAttribute('aria-pressed', chip === button ? 'true' : 'false');
    }
  });
}

window.addEventListener('pagehide', () => {
  logger.flushPartial();
  ble.shutdown();
});

if (!navigator.bluetooth) {
  elements.error.textContent = 'Web Bluetooth is unavailable in this browser. Use Chrome or Edge on a computer, or Chrome on Android. iPhone and iPad cannot connect.';
}

setTimeout(() => {
  elements.connectionNote.hidden = true;
}, 10000);

syncLogButtons();
