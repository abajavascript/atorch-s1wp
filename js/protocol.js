export const SERVICE_UUID = 0xffe0;
export const NOTIFY_UUID = 0xffe1;
// Advertised Bluetooth names. Append a name to offer another similar model in the chooser.
export const DEVICE_NAME = ['S1WP_BLE', 'GR2PWS_BLE'];

export const SAMPLE_HEX = 'ff 55 01 01 00 08 4a 00 00 ce 00 00 90 00 00 11 1d 00 00 64 01 f4 01 49 00 20 01 4c 26 05 3c 00 00 00 00 7e';

export function readUnsignedBE(bytes, start, length) {
  let result = 0;
  for (let offset = 0; offset < length; offset += 1) {
    result = result * 256 + bytes[start + offset];
  }
  return result;
}

export function decodeAtorch(bytes) {
  if (bytes.length < 31) {
    throw new Error(`Packet too short: ${bytes.length} bytes (need >= 31)`);
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0x55) {
    throw new Error('Unexpected packet header (expected FF 55)');
  }

  const hours = readUnsignedBE(bytes, 26, 2);
  const minutes = bytes[28];
  const seconds = bytes[29];
  const runtime = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return {
    voltage: readUnsignedBE(bytes, 4, 3) * 0.1,
    current: readUnsignedBE(bytes, 7, 3) * 0.001,
    power: readUnsignedBE(bytes, 10, 3) * 0.1,
    energy: readUnsignedBE(bytes, 13, 4) * 0.01,
    price: readUnsignedBE(bytes, 17, 3),
    frequency: readUnsignedBE(bytes, 20, 2) * 0.1,
    powerFactor: readUnsignedBE(bytes, 22, 2) * 0.001,
    temperature: readUnsignedBE(bytes, 24, 2),
    runtime,
    standby: bytes[30],
    header: [...bytes.slice(0, 4)],
    trailing: [...bytes.slice(31)]
  };
}

export function formatHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

export function bytesFromHex(hex) {
  const parts = hex.trim().split(/\s+/);
  const bytes = new Uint8Array(parts.length);
  parts.forEach((part, index) => {
    const value = Number.parseInt(part, 16);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`Invalid hex byte: ${part}`);
    }
    bytes[index] = value;
  });
  return bytes;
}

export function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
