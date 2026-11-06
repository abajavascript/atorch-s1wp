---
name: github-pages-app
description: Stack, file layout, module structure, event wiring, and docs for static single-page tools hosted on GitHub Pages (plain HTML, CSS, ES modules, no build step, no backend). Use when creating or changing a GitHub Pages app, a browser tool for a device or meter, or when the user mentions GitHub Pages, static site, index.html, vanilla JS, or a page with no server.
---

# GitHub Pages app

One static page that runs from GitHub Pages and from `localhost`. No server, no build, no framework.

Related skills, read when the task touches them:
- `web-ui-layout`: HTML skeleton, CSS components, responsive rules.
- `browser-dialogs`: every confirmation or choice dialog.
- `browser-file-logging`: TSV or JSONL logs written to a file the user picks.
- `web-bluetooth-device`: BLE meters, BMS, loads, and other devices.
- `firebase-auth-pages`: sign-in, when the app needs a user.

## Stack

- HTML, one CSS file, JavaScript ES modules loaded with `<script type="module" src="js/app.js">`.
- No npm, bundler, TypeScript, or UI framework. Modern Chrome, Edge, and Android Chrome are the targets; top-level `await`, `?.`, `??` are fine.
- Third-party code comes from jsDelivr (or the vendor CDN for Firebase) with an exact version in the URL. Never `@latest`.
- If a CDN library fails to load, the rest of the page still works (show a short message in its container).
- All paths are relative (`css/app.css`, `js/app.js`). Pages serves the site under `/<repo>/`, so a leading `/` breaks it.
- Bluetooth, the file picker, wake lock, and Firebase popups need a secure context: HTTPS or `localhost`. Opening `index.html` from disk is not supported.

Run locally from the project folder:

```
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.

## File layout

```
index.html            all markup, including <dialog> elements
favicon.svg           plus favicon.ico for older browsers
css/app.css           the only stylesheet
js/app.js             wiring: DOM lookups, events, rendering
js/<feature>.js       one module per concern (ble, log, chart, auth, protocol)
doc/prd.md            what the app must do
doc/adr.md            why it is built this way
README.md             how to open and use it
tools/                optional helper scripts (favicon packing etc.)
```

## Module roles

- Pure modules (`protocol.js`, formatters) export constants and functions. No DOM, no state.
- Stateful modules export a factory: `createBle({ onPacket, onLink })`, `createLogger({ onFile, onRows, onError })`. They return an object of methods and report changes only through the callbacks. Call callbacks with `?.`.
- Stateful modules never query the document. The exception is a module that owns one container passed in (`createChart(container)`).
- Logic modules that need a user decision receive an async `decide` callback from `app.js`. They never open dialogs themselves.
- `app.js` is the only file that calls `document.getElementById`.

## Event wiring in app.js

Collect elements once, by id:

```js
const elements = Object.fromEntries(
  ['connect', 'disconnect', 'status', 'error', 'startLog', 'stopLog']
    .map((id) => [id, document.getElementById(id)])
);
```

Wrap every async handler so errors land in one place:

```js
function showError(error) {
  if (error?.name === 'AbortError') return;
  elements.error.textContent = error?.message || String(error);
}

async function guarded(action) {
  try {
    elements.error.textContent = '';
    await action();
  } catch (error) {
    showError(error);
  }
}

elements.connect.addEventListener('click', () => guarded(() => ble.connect()));
```

Rules:
- Only `addEventListener`. No inline `onclick` attributes and no `element.onclick =`.
- Long multi-step actions use a re-entry flag and disable their button until done, then call the sync function in `finally`.
- Button enabled state comes from one function per area (`syncLogButtons()`, `setLinkState(state)`), called after every state change. Do not toggle `disabled` ad hoc in many places.
- Groups of similar controls use `data-*` attributes and one loop (`for (const button of chips.querySelectorAll('button'))`).
- Toggle buttons use `aria-pressed="true|false"` as their state.
- Page lifecycle: flush and shut down in `pagehide`, not `unload` or `beforeunload`. Use `visibilitychange` for things that need a visible tab (wake lock).
- Feature-detect at startup (`navigator.bluetooth`, `window.showSaveFilePicker`) and write a plain-language message into `#error`.
- Clocks and elapsed timers use one `setInterval(render, 1000)`.

## Rendering

- Set text with `textContent`. Build lists with `document.createElement` and `replaceChildren`. Never put data into `innerHTML`.
- Empty values show `—`.
- Numbers use a fixed number of digits per quantity and a unit: `formatFixed(value, 1, 'V')`.
- Local times shown to people use `DD.MM.YYYY HH:MM:SS`; durations use `hhh:mm:ss`. Timestamps in files use `YYYY-MM-DD HH:MM:SS +HH:MM`.

## Code style

Two-space indent, single quotes, semicolons, `const` by default, small named functions, early returns. Comments only state a constraint the code cannot show (browser quirks, device behavior).

## Docs

- `README.md`: what the page is for, the hosted link, supported browsers, how to run locally, how to use the main flow.
- `doc/prd.md`: sections `User`, `In scope`, `Out of scope`, numbered `Requirements`, data formats, `Done when`.
- `doc/adr.md`: numbered short decisions, each stating the choice and why.

A behavior change updates the product brief, a structural change updates the decision notes, and a usage change updates the README, in the same change as the code.

## Before finishing

- [ ] Works from `http://127.0.0.1:8000/` with no console errors
- [ ] Layout checked at phone width (360px) and desktop
- [ ] Missing API or CDN failure shows a message instead of a blank page
- [ ] Docs updated where behavior changed
