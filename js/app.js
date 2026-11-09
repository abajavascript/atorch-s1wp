import { createBle } from './ble.js';
import { createChart } from './chart.js';
import { createLogger } from './log.js';
import { SAMPLE_HEX, bytesFromHex, decodeAtorch, formatHex, formatTimestamp } from './protocol.js';

const elements = Object.fromEntries(
  ['connect', 'disconnect', 'status', 'count', 'error', 'linkLog', 'connectionNote', 'demo', 'zero', 'fileName', 'rows',
    'logMode', 'startLog', 'stopLog', 'logState', 'header', 'raw', 'chips', 'chart',
    'fileChoice', 'fileChoiceText', 'fileAppend', 'fileOverride', 'fileCancel',
    'logKind', 'logKindNew', 'logKindExisting', 'logKindCancel']
    .map((id) => [id, document.getElementById(id)])
);

const valueElements = Object.fromEntries(
  ['voltage', 'current', 'power', 'energy', 'baseline', 'accumulated', 'powerFactor', 'temperature', 'frequency', 'runtime']
    .map((id) => [id, document.getElementById(`metric-${id}`)])
);

const capacityTimes = {
  energy: document.getElementById('metric-energy-time'),
  baseline: document.getElementById('metric-baseline-time'),
  accumulated: document.getElementById('metric-accumulated-time')
};

let packetCount = 0;
let latest = null;
let baselineAt = null;

const chart = await createChart(elements.chart);
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

const LINK_LOG_SIZE = 8;
const linkEvents = [];

const ble = createBle({
  onPacket: (bytes) => {
    showPacket(bytes);
  },
  onLink: ({ state, message }) => {
    elements.status.textContent = message;
    setLinkState(state);
    if (state !== 'selecting' && state !== 'connecting') addLinkEvent(state, message);
  }
});

function setLinkState(state) {
  elements.connect.disabled = state !== 'disconnected';
  elements.disconnect.disabled = state === 'disconnected' || state === 'selecting';
}

function addLinkEvent(state, message) {
  linkEvents.unshift({ state, message, time: formatTimestamp(new Date()) });
  linkEvents.length = Math.min(linkEvents.length, LINK_LOG_SIZE);
  elements.linkLog.replaceChildren(...linkEvents.map((event) => {
    const item = document.createElement('li');
    item.className = event.state;
    const time = document.createElement('time');
    time.textContent = event.time;
    item.append(time, event.message);
    return item;
  }));
}

function syncLogButtons() {
  const logging = logger.isLogging();
  elements.startLog.disabled = logging;
  elements.stopLog.disabled = !logging;
  elements.logState.textContent = logging ? 'Logging' : logger.hasFile() ? 'Ready' : 'No file';
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

function formatClock(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(hours).padStart(3, '0')}:${pad(minutes)}:${pad(seconds)}`;
}

function renderCapacityClock() {
  const now = new Date();
  capacityTimes.energy.textContent = formatClock(now);
  if (baselineAt == null) {
    capacityTimes.baseline.textContent = '—';
    capacityTimes.accumulated.textContent = '—';
    return;
  }
  capacityTimes.baseline.textContent = formatClock(baselineAt);
  capacityTimes.accumulated.textContent = formatDuration(now - baselineAt);
}

function applyLogStore() {
  const seconds = Number(elements.logMode.value);
  if (!Number.isInteger(seconds) || seconds < 1) {
    logger.setMode('reading');
    return;
  }
  logger.setMode('interval');
  logger.setIntervalSeconds(seconds);
}

function showPacket(bytes, { demo = false } = {}) {
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
    if (!demo) logger.onSample(decoded, new Date());
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
  baselineAt = new Date();
  render(latest);
  renderCapacityClock();
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
elements.demo.addEventListener('click', () => showPacket(bytesFromHex(SAMPLE_HEX), { demo: true }));
elements.logMode.addEventListener('change', () => guarded(async () => {
  await logger.flushPartial();
  applyLogStore();
  syncLogButtons();
}));
let startingLog = false;

function askFileChoice({ name, canAppend }) {
  const label = name.toLowerCase().endsWith('.jsonl') ? 'Energy Monitor JSONL log' : 'Energy Monitor log';
  elements.fileChoiceText.textContent = canAppend
    ? `${name} already has an ${label}. Append new rows, or override the file?`
    : `${name} is not an ${label}. Override it to start a new log, or cancel.`;
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

function askLogKind() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (elements.logKind.open) elements.logKind.close();
      resolve(value);
    };
    const onNew = () => finish('new');
    const onExisting = () => finish('existing');
    const onCancel = () => finish(null);
    const onClose = () => finish(null);
    function cleanup() {
      elements.logKindNew.removeEventListener('click', onNew);
      elements.logKindExisting.removeEventListener('click', onExisting);
      elements.logKindCancel.removeEventListener('click', onCancel);
      elements.logKind.removeEventListener('close', onClose);
    }
    elements.logKindNew.addEventListener('click', onNew);
    elements.logKindExisting.addEventListener('click', onExisting);
    elements.logKindCancel.addEventListener('click', onCancel);
    elements.logKind.addEventListener('close', onClose);
    elements.logKind.showModal();
  });
}

elements.startLog.addEventListener('click', () => guarded(async () => {
  if (startingLog || logger.isLogging()) return;
  startingLog = true;
  elements.startLog.disabled = true;
  try {
    const kind = await askLogKind();
    if (!kind) return;
    applyLogStore();
    await logger.openForLogging(kind, askFileChoice);
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
    const next = button.getAttribute('aria-pressed') !== 'true';
    const shown = chart.setVisible(button.dataset.series, next);
    button.setAttribute('aria-pressed', shown ? 'true' : 'false');
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
renderCapacityClock();
setInterval(renderCapacityClock, 1000);
