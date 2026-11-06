---
name: web-bluetooth-device
description: Principles and a reusable Web Bluetooth transport for browser apps that monitor BLE devices such as energy meters, battery management systems, and electronic loads (Atorch S1WP, Atorch DL24, Atorch GR2PWS, JK BMS). Covers device profiles, GATT steps with timeouts, auto-reconnect, wake lock, command writes, polling, frame reassembly, and decoder rules. Use when connecting a web page to a BLE device, adding a new device protocol, decoding notifications, or when the user mentions Bluetooth, BLE, GATT, Web Bluetooth, BMS, meter, or packet decoding.
---

# Web Bluetooth device

The transport is generic. Each device adds one protocol module. Copy [ble.js](ble.js) into `js/ble.js` unchanged and write `js/protocol-<device>.js`. Known device facts are in [devices.md](devices.md).

## Module split

| File | Owns | Never does |
|---|---|---|
| `js/ble.js` | requestDevice, GATT steps, reconnect, wake lock, writes, polling | decode bytes, touch the DOM |
| `js/protocol-<device>.js` | UUIDs, name filter, the profile, decoder, command encoders, sample frames | keep state other than a framer, touch the DOM |
| `js/app.js` | wiring: bytes to decoder to render, chart, and logger | parse bytes itself |

## Device profile

```js
export const PROFILE = {
  filters: [{ namePrefix: 'JK-' }],   // or [{ name: 'S1WP_BLE' }]
  service: 0xffe0,
  notify: 0xffe1,
  write: 0xffe1,                      // omit for notify-only devices
  onReady: async (link) => {          // runs after every connect and reconnect
    await link.write(COMMAND_DEVICE_INFO);
  },
  poll: { everyMs: 1000, run: (link) => link.write(COMMAND_READ) } // only if the device needs a request per reading
};

const ble = createBle({ profile: PROFILE, onPacket, onLink });
```

## Connection rules

- States reported through `onLink`: `selecting`, `connecting`, `connected`, `reconnecting`, `disconnected`. The page shows the message and keeps a short newest-first link log of the non-transient ones.
- Filter the chooser by `name` or `namePrefix`, and list the service in `optionalServices`.
- Each GATT step times out after 20 s, and the error names the step (`get characteristic 0xFFE1 failed: TimeoutError`).
- A dropped link retries on the same device without the chooser, after 1, 2, 4, 8, then every 15 s, until the user presses Disconnect or the page closes.
- Init commands go in `onReady` so they run again after every reconnect.
- Remove the old notification listener before adding a new one. Stop notifications on teardown.
- Request a screen wake lock while connected and visible, and request it again on `visibilitychange`.
- On `pagehide`, call `ble.shutdown()`. It does not await anything.
- Connect stays enabled only while disconnected. Disconnect stays enabled except while the chooser is open.

## Writes

- All writes go through `link.write(bytes)`, which runs them one at a time. It uses write-with-response when the characteristic supports it.
- Monitoring apps write only read requests and init commands. Commands that change settings, relays, or loads need explicit scope in the product brief and a confirmation with `ask()` from `browser-dialogs`.

## Frames

- If a frame can span several notifications (JK BMS, any frame larger than about 20 bytes on a small MTU), feed every notification through `createFramer({ header, frameLength })` and decode only complete frames. Call `framer.reset()` when the link state becomes `connected`.
- `frameLength(buffer)` returns the full frame length once enough bytes are present to know it, otherwise `null`.

## Decoder rules

- `decode<Device>(bytes)` is pure. It checks the header and minimum length and throws an `Error` with the reason. The caller shows the error, skips the frame, and keeps the link up.
- Verify the checksum when it is known. If it is not verified, say so in the decision notes and in the packet details panel.
- Read fields from named offsets with `readUnsignedBE` / `readUnsignedLE`. Apply the scale where the field is read (`* 0.1`). One place per field.
- Return a plain object with camelCase keys in base units: `voltage` (V), `current` (A), `power` (W), `energy` (kWh), `temperature` (°C), `capacity` (Ah). Keep the same key names across devices so the chart and logger stay reusable.
- Keep bytes you do not decode (`header`, `trailing`) and show them as hex under Packet details.
- Export a `SAMPLE_HEX` frame captured from a real device. A **Decode sample packet** button runs it through the decoder without a device and without logging.

## Adding a new device

1. Find the advertised name, service, and characteristics with `chrome://bluetooth-internals` or nRF Connect on a phone.
2. Capture raw notifications in hex (the Packet details panel shows them). Save several frames covering different loads.
3. Check whether the device sends data by itself or needs a request command, and whether frames are split.
4. Write the profile, decoder, and `SAMPLE_HEX`. Compare decoded values against the device screen.
5. Record the protocol facts and their source in [devices.md](devices.md) and in the project's decision notes.

## Platform

Web Bluetooth works in Chrome and Edge on desktop and in Chrome on Android, over HTTPS or `localhost`. iPhone and iPad cannot connect. On Android, Location must be on or the chooser can stay empty, and the tab must stay in the foreground.
