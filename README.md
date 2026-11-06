# Atorch S1WP monitor

This page connects to an Atorch S1WP energy meter over Bluetooth Low Energy and records energy stats and consumption. The primary need was to collect data for hybrid inverter battery capacity test. Charge the battery fully, zero the accumulated energy, then watch and log the output until the battery is empty. Readings can be stored in a local file chosen in the browser, tab-separated by default or JSON lines when the name ends in `.jsonl`. The first version displays and logs measurements; it does not configure the meter.

## Open the page

The hosted page is [https://abajavascript.github.io/atorch-s1wp/](https://abajavascript.github.io/atorch-s1wp/). What the app must do is in [doc/prd.md](doc/prd.md). Why it is built this way is in [doc/adr.md](doc/adr.md).

Chrome or Edge on a computer, and Chrome on Android, can connect. iPhone and iPad cannot. Open the site over HTTPS or from localhost. A file opened from disk cannot use Bluetooth or save to a chosen file.

To try it on this computer, from this folder:

```
python -m http.server 8000
```

Then open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). On Android, turn Location on or the Bluetooth device list can stay empty, and keep the tab in the foreground during a test.

## Capacity test

Connect to `S1WP_BLE`. After the battery is full, press **Zero accumulated**. Device energy stays the meter’s running total. Baseline is that total at the moment you zero. Accumulated is device energy minus the baseline, shown in kWh and Wh. The chart shows power, voltage, and current together, each on its own scale. Power factor and temperature can be turned on beside them. Hover a point to read its value, the elapsed time, and the clock time. Energy is not plotted.

Press **Start logging**. **New file** creates a log when you enter a name. The file dialog defaults to tab-separated (`.tsv`). Choose JSON lines for a `.jsonl` file. Any other name, including All files, stays tab-separated. **Existing file** keeps the current contents: an empty file starts a new log, and a file that already holds an S1WP log of that format can be appended to or overridden. Store every reading, or one averaged row every 5 seconds, 10 seconds, 30 seconds, 1 minute, 5 minutes, or 10 minutes. A tab-separated file has one header line. A JSON lines file starts with `{"log":"s1wp","version":1}` and then one JSON object per row. Timestamps look like `2026-11-05 19:30:43 +02:00`. Closing the page saves the last finished row and disconnects. If the Bluetooth link drops, the page reconnects and keeps appending to the same file.
