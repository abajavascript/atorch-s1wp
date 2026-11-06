---
name: browser-dialogs
description: One shared pattern for confirmation and choice dialogs in static web apps, using native <dialog> elements and a promise-returning ask() helper. Use when adding a confirmation, a yes/no or multi-choice prompt, an append/override question, a destructive-action check, or a small text-input prompt, or when the user mentions dialog, modal, confirm, or popup.
---

# Browser dialogs

Every question to the user goes through a native `<dialog>` and one `ask()` helper that returns a promise. Never use `alert`, `confirm`, or `prompt`.

## Markup

Dialogs live in `index.html` just before the script tag. Each choice is a button with `data-choice`. The cancel button has an empty `data-choice` and resolves to `null`.

```html
<dialog id="fileChoice" aria-labelledby="fileChoiceText">
  <p id="fileChoiceText" data-message></p>
  <div class="actions">
    <button type="button" data-choice="append">Append</button>
    <button type="button" data-choice="override">Override</button>
    <button type="button" data-choice="" class="secondary">Cancel</button>
  </div>
</dialog>
```

With a text field, add a `label` and `input` above `.actions` and read its value after `ask()` resolves.

## Helper

Put this in `js/dialogs.js` and import it in `app.js`:

```js
export function ask(dialog, { message, hide = [] } = {}) {
  const text = dialog.querySelector('[data-message]');
  if (message != null && text) text.textContent = message;
  for (const button of dialog.querySelectorAll('button[data-choice]')) {
    button.hidden = hide.includes(button.dataset.choice);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('click', onClick);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClick = (event) => {
      const button = event.target.closest('button[data-choice]');
      if (button && dialog.contains(button)) finish(button.dataset.choice || null);
    };
    const onClose = () => finish(null);
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
  });
}
```

Escape closes the dialog and resolves to `null`, the same as Cancel.

## Use

```js
const kind = await ask(elements.logKind);
if (!kind) return;

const action = await ask(elements.fileChoice, {
  message: canAppend
    ? `${name} already has this log. Append new rows, or override the file?`
    : `${name} is not this log. Override it to start a new log, or cancel.`,
  hide: canAppend ? [] : ['append']
});
```

Rules:
- `null` always means cancelled. The caller returns without side effects.
- The message names the file or device and says what each button will do.
- Destructive buttons say the action (`Override`, `Delete`), not `OK`.
- Only `app.js` calls `ask()`. Logic modules receive an async `decide` callback, for example `logger.openForLogging(kind, ({ name, canAppend }) => ask(...))`.
- Disable the button that opened the dialog until the whole flow finishes, so a double tap cannot open two flows.
- Dialog styling comes from the `dialog` rules in the `web-ui-layout` stylesheet.
