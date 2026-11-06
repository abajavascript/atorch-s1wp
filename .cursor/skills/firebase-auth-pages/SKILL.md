---
name: firebase-auth-pages
description: Add Firebase Authentication (Google sign-in or email link) to a static GitHub Pages app using the modular SDK from the gstatic CDN, with a createAuth factory, popup sign-in, authorized domains, API key restrictions, and Firestore rules keyed by uid. Use when a GitHub Pages or static page needs login, user accounts, per-user data, or when the user mentions Firebase, auth, sign in, or Google login.
---

# Firebase Auth on GitHub Pages

Auth is optional per app. Device monitoring and local logging keep working signed out unless the product brief says otherwise.

## Setup checklist

- [ ] Firebase project created and a Web app registered. Copy its config object.
- [ ] Authentication: enable the providers needed (Google first).
- [ ] Authentication, Settings, Authorized domains: add `<user>.github.io`. `localhost` is there by default. Add `127.0.0.1` too if you test with that address.
- [ ] Google Cloud Console, Credentials, browser API key: restrict HTTP referrers to `https://<user>.github.io/*`, `http://localhost:*/*`, and `https://<project>.firebaseapp.com/*` (the sign-in handler runs there).
- [ ] If data is stored: Firestore or Realtime Database rules check `request.auth.uid`.

The config object is public by design and lives in `js/firebase-config.js`. Security comes from rules and the authorized domains, not from hiding the key.

## Module

`js/auth.js`, same factory style as the other stateful modules. Pin one SDK version for all Firebase imports.

```js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/<version>/firebase-app.js';
import {
  GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/<version>/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

export function createAuth({ onUser }) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();

  onAuthStateChanged(auth, (user) => onUser?.(user ? {
    uid: user.uid,
    name: user.displayName || user.email,
    email: user.email
  } : null));

  async function signIn() {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') return;
      throw error;
    }
  }

  return { app, signIn, signOut: () => signOut(auth) };
}
```

## Rules

- Use `signInWithPopup`. The redirect flow needs the auth helper on the same domain as the page, and GitHub Pages cannot host it, so redirect sign-in breaks in browsers that block third-party storage.
- Call `signIn()` straight from a click handler (wrapped in `guarded`) so the popup is not blocked.
- `onAuthStateChanged` is the only source of the current user. Do not cache the user in `localStorage`. The SDK persists the session itself.
- In `app.js`, one `renderUser(user)` sets the signed-in name, toggles the Sign in and Sign out buttons, and shows or hides gated panels with `hidden`.
- Until the first `onUser` call the state is unknown. Keep gated controls disabled until then instead of flashing the signed-out view.
- Auth errors go through `showError`. Show `error.message`, but map common codes (`auth/unauthorized-domain`, `auth/network-request-failed`) to plain sentences.
- Sign out asks for confirmation with `ask()` only if it would lose unsaved work.
- Data paths are per user: `users/{uid}/...`.

Firestore rules starting point:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Docs

- The product brief lists what needs sign-in and what works signed out.
- The decision notes record the provider choice, popup over redirect, and where data lives.
- The README says which domains are authorized, so a fork knows to add its own.
