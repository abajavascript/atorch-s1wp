---
name: web-ui-layout
description: Mobile-first layout, HTML skeleton, and a single-stylesheet CSS component set (panels, action bars, toggle chips, metric cards, link log, dialogs, packet details) for static dashboard pages. Use when adding or restyling UI in a GitHub Pages app, building a device dashboard, or when the user mentions layout, responsive, mobile, CSS, or styling.
---

# Web UI layout

Dark, mobile-first, one column on phones, a metric grid on wider screens. No CSS framework.

## Principles

- One stylesheet, `css/app.css`. Section order: tokens, base elements, layout, components, third-party overrides, media queries last.
- Style by class and by state attributes (`[aria-pressed="true"]`, `:disabled`, `[hidden]`, `:empty`). Use ids only for JS lookup, never for layout.
- Mobile first: base rules are for a 360px phone; one `@media (min-width: 720px)` block widens things.
- Touch targets are at least 44px high (`button`, `select`, `input`, `summary`).
- Live numbers use `font-variant-numeric: tabular-nums` so they do not jitter.
- Long text (device names, error messages, hex) gets `overflow-wrap: anywhere`.
- Body is capped at `max-width: 960px` and centered.
- Colors come from the custom properties in the starter stylesheet. Each chart series has one color, used by its chip and its line.

Copy [base.css](base.css) as the starting `css/app.css` and extend it.

## Page skeleton

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111827">
<title>Device name</title>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon.ico" sizes="32x32">
<link rel="stylesheet" href="css/app.css">
</head>
<body>
<header class="page-header">
  <h1>Device name</h1>
  <p class="muted">One line on what the page does.</p>
</header>

<section class="panel" aria-label="Connection">
  <div class="actions">
    <button id="connect" type="button">Connect</button>
    <button id="disconnect" type="button" disabled>Disconnect</button>
  </div>
  <p>Status: <strong id="status">Disconnected</strong></p>
  <p id="error" class="error" role="alert"></p>
</section>

<section class="metrics" aria-label="Live readings">
  <article class="metric">
    <div class="name">Voltage</div>
    <div class="value" id="metric-voltage">—</div>
  </article>
</section>

<details class="panel">
  <summary>Packet details</summary>
  <pre id="raw">Waiting for data…</pre>
</details>

<!-- dialogs go here, see browser-dialogs -->
<script type="module" src="js/app.js"></script>
</body>
</html>
```

## Components

| Class | Use |
|---|---|
| `.page-header` | Title and one-line description |
| `.panel` | A `section` or `details` card for one area; give sections an `aria-label` |
| `.actions` | Row of buttons that wraps on narrow screens |
| `.chips` | Toggle buttons with `data-series` and `aria-pressed` |
| `.metrics` / `.metric` | Card grid; card holds `.name`, `.value`, optional `.detail`; `.metric.wide` spans the row on phones |
| `.note`, `.muted` | Secondary text |
| `.error` | The single `#error` line, hidden when empty |
| `.link-log` | Short newest-first event list with a `time` per row and the state as a class |
| `pre` | Hex dumps and decoded fields |
| `dialog` | Confirmations, see `browser-dialogs` |
| `button.secondary` | Cancel and less important actions |

Rules:
- Every `button` has `type="button"` unless it submits a `method="dialog"` form.
- Buttons that need data or a connection start `disabled` in HTML.
- Hide with the `hidden` attribute, not inline styles.
- Hints that only matter at first load can be hidden after a timeout from JS.
- Third-party widget overrides are scoped under the container class (`.chart .u-legend`).

## Checks

- [ ] No horizontal scroll at 360px
- [ ] Buttons wrap instead of overflowing
- [ ] Values do not shift width while updating
- [ ] Dialog fits on a phone (`max-width: min(440px, calc(100vw - 32px))`)
