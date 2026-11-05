const SERIES = {
  power: { label: 'Power', unit: 'W', color: '#fbbf24', digits: 1 },
  voltage: { label: 'Voltage', unit: 'V', color: '#60a5fa', digits: 1 },
  current: { label: 'Current', unit: 'A', color: '#34d399', digits: 3 },
  powerFactor: { label: 'Power factor', unit: '', color: '#c084fc', digits: 3 },
  temperature: { label: 'Temperature', unit: '°C', color: '#f87171', digits: 0 }
};

const GAP_SECONDS = 3;

export function createChart(canvas) {
  const history = Object.fromEntries(Object.keys(SERIES).map((key) => [key, []]));
  let active = 'power';
  let origin = null;
  const context = canvas.getContext('2d');
  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);

  function push(sample, timeMs) {
    if (origin == null) origin = timeMs;
    const t = (timeMs - origin) / 1000;
    for (const key of Object.keys(SERIES)) {
      const points = history[key];
      const previous = points[points.length - 1];
      const gap = Boolean(previous) && t - previous.t > GAP_SECONDS;
      points.push({ t, y: sample[key], gap });
    }
    draw();
  }

  function clear() {
    for (const key of Object.keys(history)) history[key].length = 0;
    origin = null;
    draw();
  }

  function setActive(key) {
    if (!SERIES[key]) return;
    active = key;
    draw();
  }

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, width, height);

    const pad = { left: 68 * ratio, right: 16 * ratio, top: 28 * ratio, bottom: 32 * ratio };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const points = history[active];
    const meta = SERIES[active];
    const title = meta.unit ? `${meta.label} (${meta.unit})` : meta.label;

    context.fillStyle = '#e5e7eb';
    context.font = `${13 * ratio}px system-ui, sans-serif`;
    context.fillText(title, pad.left, 18 * ratio);

    if (!points.length || plotWidth <= 0 || plotHeight <= 0) {
      context.fillStyle = '#9ca3af';
      context.font = `${13 * ratio}px system-ui, sans-serif`;
      context.fillText('Waiting for data', pad.left, pad.top + 20 * ratio);
      return;
    }

    let minY = Infinity;
    let maxY = -Infinity;
    let maxT = 0;
    for (const point of points) {
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      maxT = Math.max(maxT, point.t);
    }
    if (minY === maxY) {
      const cushion = Math.abs(minY) * 0.05 || 1;
      minY -= cushion;
      maxY += cushion;
    } else {
      const span = maxY - minY;
      minY -= span * 0.08;
      maxY += span * 0.08;
    }
    if (maxT <= 0) maxT = 1;

    context.strokeStyle = '#1f2937';
    context.lineWidth = ratio;
    context.fillStyle = '#9ca3af';
    context.font = `${11 * ratio}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    for (let step = 0; step <= 4; step += 1) {
      const y = pad.top + (plotHeight * step) / 4;
      const value = maxY - ((maxY - minY) * step) / 4;
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillText(value.toFixed(meta.digits), 8 * ratio, y);
    }

    const drawn = downsample(points, Math.max(2, Math.floor(plotWidth / ratio)));
    context.beginPath();
    context.strokeStyle = meta.color;
    context.lineWidth = 2 * ratio;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    drawn.forEach((point, index) => {
      const x = pad.left + (point.t / maxT) * plotWidth;
      const y = pad.top + ((maxY - point.y) / (maxY - minY)) * plotHeight;
      const next = drawn[index + 1];
      const isolated = (index === 0 || point.gap) && (!next || next.gap);
      if (index === 0 || point.gap) context.moveTo(x, y);
      else context.lineTo(x, y);
      if (isolated) context.lineTo(x + 0.01, y);
    });
    context.stroke();

    context.textBaseline = 'alphabetic';
    context.fillStyle = '#9ca3af';
    context.font = `${11 * ratio}px system-ui, sans-serif`;
    context.fillText('0:00', pad.left, height - 10 * ratio);
    const elapsed = formatElapsed(maxT);
    const elapsedWidth = context.measureText(elapsed).width;
    context.fillText(elapsed, width - pad.right - elapsedWidth, height - 10 * ratio);
  }

  draw();
  return { push, clear, setActive, redraw: draw };
}

function downsample(points, buckets) {
  if (points.length <= buckets) return points;
  const sampled = [];
  const size = points.length / buckets;
  for (let index = 0; index < buckets; index += 1) {
    const start = Math.floor(index * size);
    const end = Math.min(points.length, Math.floor((index + 1) * size));
    if (end <= start) continue;
    let gapAt = -1;
    for (let at = start; at < end; at += 1) if (points[at].gap) gapAt = at;
    if (gapAt > start) sampled.push(points[gapAt - 1]);
    if (gapAt >= start) sampled.push(points[gapAt]);
    if (end - 1 > gapAt) sampled.push(points[end - 1]);
  }
  return sampled;
}

function formatElapsed(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}
