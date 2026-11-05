import { formatTimestamp } from './protocol.js';

export const HEADER = [
  'timestamp',
  'voltage_v',
  'current_a',
  'power_w',
  'energy_kwh',
  'baseline_kwh',
  'accumulated_kwh',
  'power_factor',
  'temperature_c',
  'frequency_hz',
  'runtime'
].join('\t');

const PICKER_TYPES = [{
  description: 'Tab-separated values',
  accept: { 'text/tab-separated-values': ['.tsv'] }
}];

export function createLogger({ onFile, onRows, onError }) {
  let handle = null;
  let logging = false;
  let mode = 'reading';
  let intervalSeconds = 1;
  let baseline = null;
  let queue = Promise.resolve();
  let rowsWritten = 0;
  let bucket = [];
  let bucketStarted = 0;
  let needsLeadingNewline = false;

  function setMode(nextMode) {
    mode = nextMode === 'interval' ? 'interval' : 'reading';
  }

  function setIntervalSeconds(value) {
    const parsed = Number(value);
    intervalSeconds = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
  }

  function setBaseline(value) {
    baseline = value;
  }

  function getBaseline() {
    return baseline;
  }

  async function openForLogging(decide) {
    if (logging) return false;
    // The open picker keeps existing bytes. The save picker would erase them first.
    assertPicker(window.showOpenFilePicker, 'showOpenFilePicker');
    const [next] = await pickFile('open');
    const permission = await next.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      throw new Error('Write permission was not granted for that file.');
    }
    const text = await (await next.getFile()).text();
    if (text.length === 0) {
      await replace(next);
    } else {
      const canAppend = text.startsWith(HEADER);
      const action = await decide({ name: next.name, canAppend });
      if (action === 'append') {
        if (!canAppend) throw new Error('That file does not start with the S1WP log header.');
        await adopt(next, { leadingNewline: !text.endsWith('\n') });
      } else if (action === 'override') {
        await replace(next);
      } else {
        return false;
      }
    }
    start();
    return true;
  }

  async function adopt(next, { leadingNewline = false }) {
    await queue;
    handle = next;
    needsLeadingNewline = leadingNewline;
    rowsWritten = 0;
    onRows?.(0);
    onFile?.(next.name);
  }

  async function replace(next) {
    await queue;
    handle = next;
    needsLeadingNewline = false;
    rowsWritten = 0;
    onRows?.(0);
    onFile?.(next.name);
    const writable = await next.createWritable();
    let committed = false;
    try {
      await writable.write(`${HEADER}\n`);
      await writable.close();
      committed = true;
    } finally {
      if (!committed) {
        try { await writable.abort(); } catch { /* close already finished */ }
      }
    }
  }

  function start() {
    if (!handle) throw new Error('Choose a log file first.');
    logging = true;
    bucket = [];
    bucketStarted = 0;
  }

  async function stop() {
    logging = false;
    await flushPartial();
  }

  function onSample(sample, date = new Date()) {
    if (!logging || !handle) return;
    const stamped = {
      ...sample,
      baseline,
      accumulated: baseline == null ? null : sample.energy - baseline
    };
    if (mode === 'reading') {
      enqueue(linePrefix() + formatRow(stamped, date) + '\n').catch(() => {});
      return;
    }
    const now = date.getTime();
    if (!bucketStarted) bucketStarted = now;
    bucket.push({ sample: stamped, date });
    if (now - bucketStarted >= intervalSeconds * 1000) {
      const entries = bucket;
      bucket = [];
      bucketStarted = 0;
      enqueue(linePrefix() + formatAggregate(entries) + '\n').catch(() => {});
    }
  }

  async function flushPartial() {
    if (!bucket.length || !handle) {
      bucket = [];
      bucketStarted = 0;
      await queue;
      return;
    }
    const entries = bucket;
    bucket = [];
    bucketStarted = 0;
    await enqueue(linePrefix() + formatAggregate(entries) + '\n');
  }

  function linePrefix() {
    if (!needsLeadingNewline) return '';
    needsLeadingNewline = false;
    return '\n';
  }

  function enqueue(text) {
    const job = queue.then(() => commit(text));
    queue = job.catch((error) => onError?.(error));
    return job;
  }

  async function commit(text) {
    if (!handle) throw new Error('No log file is selected.');
    const file = await handle.getFile();
    const size = file.size;
    // close() is what replaces the real file. Until then Chrome keeps a .crswap sibling.
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(size);
      await writable.write(text);
    } finally {
      await writable.close();
    }
    rowsWritten += countDataLines(text);
    onRows?.(rowsWritten);
  }

  return {
    openForLogging,
    start,
    stop,
    onSample,
    flushPartial,
    setMode,
    setIntervalSeconds,
    setBaseline,
    getBaseline,
    isLogging: () => logging,
    hasFile: () => Boolean(handle),
    rowsWritten: () => rowsWritten
  };
}

function assertPicker(fn, name) {
  if (typeof fn !== 'function') {
    throw new Error(`This page cannot write a chosen file (${name} is missing). Open it from http://localhost or HTTPS in Chrome or Edge.`);
  }
}

async function pickFile(kind) {
  const open = kind === 'save' ? window.showSaveFilePicker : window.showOpenFilePicker;
  try {
    return await open(pickerOptions(kind, PICKER_TYPES));
  } catch (error) {
    if (error?.name === 'AbortError' || !(error instanceof TypeError)) throw error;
    return open(pickerOptions(kind, [{
      description: 'Tab-separated values',
      accept: { 'text/plain': ['.tsv'] }
    }]));
  }
}

function pickerOptions(kind, types) {
  if (kind === 'save') return { suggestedName: 'atorch-s1wp.tsv', types };
  return { multiple: false, types };
}

function countDataLines(text) {
  return text.split('\n').filter((line) => line && !line.startsWith('timestamp\t')).length;
}

function formatRow(sample, date) {
  return [
    formatTimestamp(date),
    sample.voltage.toFixed(1),
    sample.current.toFixed(3),
    sample.power.toFixed(1),
    sample.energy.toFixed(2),
    sample.baseline == null ? '' : Number(sample.baseline).toFixed(2),
    sample.accumulated == null ? '' : Number(sample.accumulated).toFixed(2),
    sample.powerFactor.toFixed(3),
    sample.temperature.toFixed(0),
    sample.frequency.toFixed(1),
    sample.runtime
  ].join('\t');
}

function formatAggregate(entries) {
  const last = entries[entries.length - 1];
  const average = (key) => entries.reduce((sum, entry) => sum + entry.sample[key], 0) / entries.length;
  return formatRow({
    ...last.sample,
    voltage: average('voltage'),
    current: average('current'),
    power: average('power'),
    powerFactor: average('powerFactor'),
    temperature: average('temperature')
  }, last.date);
}
