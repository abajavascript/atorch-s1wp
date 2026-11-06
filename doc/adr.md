# Architecture decisions

Short notes for a single static page. The product behavior is in [prd.md](prd.md).

## 1. Static page, no backend

The discharge runs for hours next to the meter. A server would add accounts, hosting, and a place for the log to live. The page is HTML, CSS, and JavaScript. GitHub Pages serves it. Bluetooth and the file picker require HTTPS or localhost, so opening the HTML file from disk is not a supported way to run it.

## 2. Web Bluetooth notifications

The meter advertises as `S1WP_BLE` and notifies on service `0xFFE0`, characteristic `0xFFE1`. The page subscribes and decodes each notification. It does not write settings.

Chrome and Edge on a computer, and Chrome on Android, implement this API. iPhone and iPad do not, so they are out of scope. On Android the Bluetooth chooser can stay empty unless Location is on. The tab should stay in the foreground; a screen wake lock is requested while the link is up and the page is visible.

Each GATT step gives up after 20 seconds. If the link drops, retries wait 1 second, then 2, 4, 8, and then 15 seconds, and keep going until the user disconnects or the page closes.

## 3. Accumulated energy is a local baseline

The meter’s energy counter is a running total and is not reset from this page. **Zero accumulated** stores that total as the baseline. Accumulated energy is the later total minus the baseline. The baseline time is kept only in the page, for the clock line and the elapsed timer.

The chart is a separate record of power, voltage, current, power factor, and temperature. Zeroing does not clear it. A reload clears both the baseline and the chart, because nothing about the session is stored.

## 4. The log stays in a file the user picks

Readings are written with the File System Access API. The file dialog lists tab-separated values first and JSON lines second, and still offers All files. The chosen name decides the format: a name ending in `.jsonl` is JSON lines, and every other name is tab-separated. The picker does not report which filter was selected, so the extension is the signal. There is no download-at-the-end step, so a closed tab still leaves the rows that were already committed. The interval modes average a bucket and append one row. A partial bucket is written when logging stops, the interval changes, the baseline is set, or the page hides.

The file handle cannot be restored after a reload. The user picks the same file again and appends.

## 5. Chart library loaded from a CDN

The chart is [uPlot 1.6.32](https://github.com/leeoniya/uPlot), loaded from jsDelivr, with power, voltage, and current on separate scales. Several long series were awkward to keep correct in the earlier hand-drawn canvas. If the library fails to load, the page still shows live numbers and can still log. Energy is omitted because the capacity result is the accumulated total, not a curve.

## 6. Decode only the known fields

Packets are expected to start with `FF 55` and to be at least 31 bytes. Voltage, current, power, energy, frequency, power factor, temperature, and runtime are scaled from fixed offsets. The checksum is not checked. Header flags and trailing bytes are shown as hex and are not interpreted. A bad frame is reported and skipped; the link stays up.
