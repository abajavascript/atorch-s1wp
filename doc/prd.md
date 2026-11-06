# Product brief

This page watches one Atorch S1WP energy meter and records energy consumption. Initial purpose was to test hybrid-inverter battery capacity by discharge with specific load. Charge the battery full, zero the accumulated energy, then watch and log the output until the battery is empty.

How to open the page and run a test is in the [README](../README.md). Why the page is built this way is in [adr.md](adr.md).

## User

One person, at the meter, with Chrome or Edge on a computer, or Chrome on Android. The phone or computer stays near the meter for the whole discharge.

## In scope

- Connect to the meter named `S1WP_BLE` and show live readings.
- Reconnect when the Bluetooth link drops, and say so in the link log.
- Show device energy, a baseline, and accumulated energy since that baseline.
- Show when the baseline was set, how long the accumulation has been running, and the current time next to device energy.
- Plot power, voltage, and current together. Power factor and temperature can be turned on. Energy is not plotted.
- Keep the chart when accumulated energy is zeroed.
- Write readings to a tab-separated file the user chooses in the browser.

## Out of scope

- Configuring the meter: tariffs, timers, relay, or any setting.
- Accounts, a server, or uploading the log.
- iPhone and iPad. Those browsers have no Web Bluetooth.
- Restoring the baseline or the chosen file after a reload.
- Checking the packet checksum. Bytes that are not decoded stay visible under packet details.

## Requirements

1. After a reading arrives, show voltage (V), current (A), power (W), power factor, temperature (°C), frequency (Hz), meter runtime, and device energy (kWh).
2. **Zero accumulated** is available only after a reading. It sets the baseline to the current device energy and records that moment. Accumulated energy is device energy minus the baseline, shown in kWh and Wh. The baseline line shows the local time it was set (`DD.MM.YYYY HH:MM:SS`). The accumulated line shows elapsed time as `hhh:mm:ss`. Device energy keeps the meter total and shows the current local time, updated every second.
3. Zeroing does not clear or restart the chart. Later readings continue the same lines.
4. The chart starts with power, voltage, and current visible, each on its own scale. The user can show or hide power factor and temperature. A gap longer than 3 seconds breaks the line. Hovering a point shows the value, the elapsed time, and the clock time.
5. **Start logging** asks for a new file or an existing one. A new file gets a header. An empty existing file starts a new log. A file that already has this log’s header can be appended or overridden. Any other non-empty file can only be overridden or cancelled.
6. The store list is every reading, or one averaged row every 5 seconds, 10 seconds, 30 seconds, 1 minute, 5 minutes, or 10 minutes. Averaged rows use the mean of voltage, current, power, power factor, and temperature, and the last sample’s energy, baseline, frequency, and runtime.
7. Each finished row is written before the next one starts. Stopping the log, changing the store interval, zeroing, or leaving the page writes a partial interval if one is open.
8. A dropped link reconnects on its own and keeps using the same file. Disconnect stops reconnecting. Closing the page disconnects and writes the last finished row.
9. A reload forgets the chosen file and the baseline. Logging again and picking the same file appends.

## Log columns

`timestamp`, `voltage_v`, `current_a`, `power_w`, `energy_kwh`, `baseline_kwh`, `accumulated_kwh`, `power_factor`, `temperature_c`, `frequency_hz`, `runtime`.

Timestamps look like `2026-11-05 19:30:43 +02:00`. Before a baseline exists, the baseline and accumulated columns are empty.

## Done when

A full discharge can be watched live, the accumulated energy matches the meter total minus the value at zero, and the TSV contains the readings from that run.
