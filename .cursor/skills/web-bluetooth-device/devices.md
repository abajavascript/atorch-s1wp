# Device notes

Treat anything marked "unverified" as a starting hypothesis. Confirm it against captured frames and the device screen before relying on it, then update this file.

## Atorch S1WP (AC energy meter) — verified

Source: the atorch-s1wp project (`js/protocol.js`).

- Name `S1WP_BLE`, service `0xFFE0`, notify characteristic `0xFFE1`. The meter sends readings unprompted, so no writes are needed.
- Frame: starts `FF 55`, at least 31 bytes, one frame per notification. Byte 2 `01` is the report message, byte 3 `01` is the AC meter type.
- Fields (big-endian):

| Offset | Bytes | Field | Scale |
|---|---|---|---|
| 4 | 3 | voltage | ×0.1 V |
| 7 | 3 | current | ×0.001 A |
| 10 | 3 | power | ×0.1 W |
| 13 | 4 | energy | ×0.01 kWh |
| 17 | 3 | price | raw |
| 20 | 2 | frequency | ×0.1 Hz |
| 22 | 2 | power factor | ×0.001 |
| 24 | 2 | temperature | °C |
| 26 | 2 + 1 + 1 | runtime | hours, minutes, seconds |
| 30 | 1 | standby | raw |

- Checksum not verified.
- Sample: `ff 55 01 01 00 08 4a 00 00 ce 00 00 90 00 00 11 1d 00 00 64 01 f4 01 49 00 20 01 4c 26 05 3c 00 00 00 00 7e`

## Atorch DL24 (DC electronic load) — unverified

- Expected to use the same Atorch family framing: `FF 55`, report message `01`, DC device type `02`, on `0xFFE0` / `0xFFE1`.
- DC field layout differs from S1WP (it has capacity in mAh and no frequency or power factor). Capture frames and map the offsets before decoding.
- Load control commands also start `FF 55` and carry a checksum. Out of scope for monitoring unless the product brief adds it.

## Atorch GR2PWS — unknown

- No protocol facts recorded yet. Follow "Adding a new device" in the skill and record the results here.

## JK BMS — unverified

- Commonly service `0xFFE0`, characteristic `0xFFE1` for both notify and write. Names often start with `JK-` or `JK_`.
- The BMS waits for request commands. A device-info request and a cell-info request are written after connect, so put them in `onReady`.
- Response frames start `55 AA EB 90`, are about 300 bytes, and arrive split across notifications. Use `createFramer`. The frame type byte follows the header.
- The checksum is commonly a byte sum of the frame body. Verify against captures.
- Layouts differ between hardware and firmware versions. Record the version along with the offsets.
- Cell voltages vary by pack size, so log them as JSONL or with one column per cell set from the cell count.
