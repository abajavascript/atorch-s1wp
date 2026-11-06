---
name: browser-file-logging
description: Append-only TSV or JSONL logging from a static web page into a file the user picks, using the File System Access API, with new/existing/append/override flow, interval averaging, and flush on stop or page hide. Use when a page must record readings, measurements, events, or telemetry to a local file, or when the user mentions TSV, JSONL, CSV, log file, export, or saving data in the browser.
---

# Browser file logging

Rows go straight into a file the user picks. There is no download-at-the-end step, so a closed tab keeps every row already committed.

Copy [logger.js](logger.js) into `js/log.js`. It holds the logger factory, the TSV and JSONL formats, the timestamp formatter, and the averaging helper.

## Format choice

- TSV: one header line, one row per record, fixed columns. Default for measurements that open in a spreadsheet.
- JSONL: a first line `{"log":"<id>","version":1}`, then one JSON object per line. Use it for events, nested data, or columns that change between devices (BMS cell voltages). A missing value is `null`.

The file dialog lists every format in the order given to `createLogger`. The first is the default. Give `suggestedName` that format's extension. All files (`*.*`) stays in the dialog. The picker does not report which filter was selected, so the file name decides:

- A name ending in a listed extension uses that format. `.jsonl` is JSONL, `.tsv` is TSV.
- Every other name, including a file chosen as All files, uses the first format.

Append is allowed only when the contents match that format's header.

Column and field rules:
- The first column or field is `timestamp`, formatted `YYYY-MM-DD HH:MM:SS +HH:MM` in local time.
- TSV column names are snake_case with a unit suffix: `voltage_v`, `current_a`, `power_w`, `energy_kwh`, `temperature_c`.
- Each numeric column has fixed decimals (`fixed(3)`). In TSV a missing value is an empty cell. In JSONL it is `null`.
- The header is part of the file contract. Changing columns means a new header (or a new JSONL `version`), and old files can no longer be appended.

## Wiring

```js
import { averageAggregate, createLogger, fixed, jsonlFormat, tsvFormat } from './log.js';

const columns = [
  { name: 'voltage_v', value: (r) => fixed(1)(r.voltage) },
  { name: 'current_a', value: (r) => fixed(3)(r.current) },
  { name: 'energy_kwh', value: (r) => fixed(2)(r.energy) },
  { name: 'runtime', value: (r) => r.runtime }
];

const logger = createLogger({
  formats: [tsvFormat({ columns }), jsonlFormat({ id: 'device' })],
  aggregate: averageAggregate(['voltage', 'current', 'power']),
  suggestedName: 'device-log.tsv',
  pickerId: 'device-log',
  onFile: (name) => { elements.fileName.textContent = name; },
  onRows: (count) => { elements.rows.textContent = String(count); },
  onError: showError
});
```

Pass `format` instead of `formats` when the page writes only one format. The JSONL `row` spreads the record, so pass a flat object whose keys are the field names. Use `null` for a missing value.

The caller adds derived fields (baseline, accumulated) to the record before `logger.onRecord(record, date)`.

## Start flow

1. **Start logging** asks New file or Existing file with `ask()` from `browser-dialogs`.
2. New file: the save picker, then a header is written.
3. Existing file: the open picker, then read/write permission is requested.
   - Empty file: a header is written.
   - Starts with this log's header: the user chooses Append or Override.
   - Anything else: Override or Cancel only.
4. Cancel at any step leaves logging off and the file untouched.

`logger.openForLogging(kind, decide)` implements steps 2 and 3. `decide({ name, canAppend })` resolves to `'append'`, `'override'`, or `null`.

## Store interval

- Every record, or one row per interval: 5, 10, 30, 60, 300, or 600 seconds (`setIntervalSeconds(0)` means every record).
- Averaged rows take the mean of continuous quantities (voltage, current, power, power factor, temperature) and the last record's counters and states (energy, runtime, frequency, baseline).
- A partial interval is written by `flushPartial()`. Call it when logging stops, the interval changes, a baseline or other derived value changes, and on `pagehide`.

## Write rules

- Writes go through one promise queue, so rows commit in order and one finishes before the next starts.
- Each commit opens a writable with `keepExistingData: true`, seeks to the end, writes, and closes. The close is what makes the data durable.
- Appending to a file that does not end in a newline adds one first.
- A write error goes to `onError` and later rows still try.
- The file handle cannot survive a reload. The README says to pick the same file again and append.

## Browser support

Chrome and Edge on desktop support both pickers. Android Chrome support depends on the version, so the logger checks `window.showSaveFilePicker` and `window.showOpenFilePicker` and throws a plain-language error when one is missing. Test the full flow on the target phone. The page also needs HTTPS or `localhost`.
