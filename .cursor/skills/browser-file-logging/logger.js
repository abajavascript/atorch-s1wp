export function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function tsvFormat({ columns }) {
  const header = ['timestamp', ...columns.map((column) => column.name)].join('\t');
  return {
    extension: '.tsv',
    mime: 'text/tab-separated-values',
    description: 'Tab-separated values',
    header,
    isOwnFile: (text) => text.startsWith(header),
    row: (record, date) => [
      formatTimestamp(date),
      ...columns.map((column) => cell(column.value(record)))
    ].join('\t')
  };
}

export function jsonlFormat({ id, version = 1 }) {
  const header = JSON.stringify({ log: id, version });
  return {
    extension: '.jsonl',
    mime: 'application/x-ndjson',
    description: 'JSON lines',
    header,
    isOwnFile: (text) => {
      const end = text.indexOf('\n');
      try {
        const first = JSON.parse(end < 0 ? text : text.slice(0, end));
        return first?.log === id && first?.version === version;
      } catch {
        return false;
      }
    },
    row: (record, date) => JSON.stringify({ timestamp: formatTimestamp(date), ...record })
  };
}

export function averageAggregate(keys) {
  return (entries) => {
    const last = entries[entries.length - 1];
    const record = { ...last.record };
    for (const key of keys) {
      record[key] = entries.reduce((sum, entry) => sum + entry.record[key], 0) / entries.length;
    }
    return record;
  };
}

export function fixed(digits) {
  return (value) => (value == null || Number.isNaN(value) ? '' : Number(value).toFixed(digits));
}

function cell(value) {
  return value == null ? '' : String(value).replace(/[\t\r\n]+/g, ' ');
}

export function createLogger({ format, formats, aggregate = (entries) => entries[entries.length - 1].record, suggestedName, pickerId, onFile, onRows, onError }) {
  const available = formats?.length ? formats : format ? [format] : [];
  if (!available.length) throw new Error('createLogger needs a format.');
  let handle = null;
  let active = available[0];
  let logging = false;
  let intervalMs = 0;
  let queue = Promise.resolve();
  let rowsWritten = 0;
  let bucket = [];
  let bucketStarted = 0;
  let needsLeadingNewline = false;

  function formatForName(name) {
    const lower = String(name).toLowerCase();
    return available.find((item) => lower.endsWith(item.extension.toLowerCase())) || available[0];
  }

  function setIntervalSeconds(seconds) {
    const parsed = Number(seconds);
    intervalMs = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) * 1000 : 0;
  }

  async function openForLogging(kind, decide) {
    if (logging) return false;
    if (kind === 'new') {
      // The save picker creates a missing name. It also clears an existing file before returning.
      assertPicker(window.showSaveFilePicker, 'showSaveFilePicker');
      await replace(await pickFile('save'));
    } else if (kind === 'existing') {
      // The open picker keeps existing bytes so append can still read them.
      assertPicker(window.showOpenFilePicker, 'showOpenFilePicker');
      const next = await pickFile('open');
      const permission = await next.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Write permission was not granted for that file.');
      const text = await (await next.getFile()).text();
      if (text.length === 0) {
        await replace(next);
      } else {
        const chosen = formatForName(next.name);
        const canAppend = chosen.isOwnFile(text);
        const action = await decide({ name: next.name, canAppend });
        if (action === 'append') {
          if (!canAppend) throw new Error('That file does not start with this log header.');
          await adopt(next, !text.endsWith('\n'));
        } else if (action === 'override') {
          await replace(next);
        } else {
          return false;
        }
      }
    } else {
      return false;
    }
    logging = true;
    bucket = [];
    bucketStarted = 0;
    return true;
  }

  async function adopt(next, leadingNewline) {
    await queue;
    handle = next;
    active = formatForName(next.name);
    needsLeadingNewline = leadingNewline;
    resetCount(next);
  }

  async function replace(next) {
    await queue;
    handle = next;
    active = formatForName(next.name);
    needsLeadingNewline = false;
    resetCount(next);
    const writable = await next.createWritable();
    let committed = false;
    try {
      if (active.header) await writable.write(`${active.header}\n`);
      await writable.close();
      committed = true;
    } finally {
      if (!committed) {
        try { await writable.abort(); } catch { /* close already finished */ }
      }
    }
  }

  function resetCount(next) {
    rowsWritten = 0;
    onRows?.(0);
    onFile?.(next.name);
  }

  async function stop() {
    logging = false;
    await flushPartial();
  }

  function onRecord(record, date = new Date()) {
    if (!logging || !handle) return;
    if (!intervalMs) {
      enqueue([active.row(record, date)]).catch(() => {});
      return;
    }
    const now = date.getTime();
    if (bucket.length && now - bucketStarted >= intervalMs) {
      const entries = bucket;
      bucket = [];
      enqueue([active.row(aggregate(entries), entries[entries.length - 1].date)]).catch(() => {});
    }
    if (!bucket.length) bucketStarted = now;
    bucket.push({ record, date });
  }

  async function flushPartial() {
    const entries = bucket;
    bucket = [];
    bucketStarted = 0;
    if (!entries.length || !handle) {
      await queue;
      return;
    }
    await enqueue([active.row(aggregate(entries), entries[entries.length - 1].date)]);
  }

  function enqueue(lines) {
    const prefix = needsLeadingNewline ? '\n' : '';
    needsLeadingNewline = false;
    const text = prefix + lines.map((line) => `${line}\n`).join('');
    const job = queue.then(() => commit(text, lines.length));
    queue = job.catch((error) => onError?.(error));
    return job;
  }

  async function commit(text, count) {
    if (!handle) throw new Error('No log file is selected.');
    const size = (await handle.getFile()).size;
    // close() is what replaces the real file. Until then Chrome keeps a .crswap sibling.
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(size);
      await writable.write(text);
    } finally {
      await writable.close();
    }
    rowsWritten += count;
    onRows?.(rowsWritten);
  }

  function pickerTypes(plain) {
    return available.map((item) => ({
      description: item.description,
      accept: plain ? { 'text/plain': [item.extension] } : { [item.mime]: [item.extension] }
    }));
  }

  async function pickFile(kind) {
    const open = kind === 'save' ? window.showSaveFilePicker : window.showOpenFilePicker;
    const options = (types) => ({
      id: pickerId,
      types,
      // All files stays in the dialog. A name with no known extension uses the first format.
      ...(kind === 'save' ? { suggestedName: suggestedName || `log${available[0].extension}` } : { multiple: false })
    });
    let chosen;
    try {
      chosen = await open(options(pickerTypes(false)));
    } catch (error) {
      // Some platforms reject the MIME type with a TypeError; text/plain is accepted everywhere.
      if (error?.name === 'AbortError' || !(error instanceof TypeError)) throw error;
      chosen = await open(options(pickerTypes(true)));
    }
    return kind === 'save' ? chosen : chosen[0];
  }

  return {
    openForLogging,
    stop,
    onRecord,
    flushPartial,
    setIntervalSeconds,
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
