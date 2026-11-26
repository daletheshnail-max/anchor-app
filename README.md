# Anchor — your calm operating system

An offline-first web app for managing ADHD, depression, and addiction recovery.
Built to plug into Dale's Agent OS. The public site is a static Vite build. SOS is never paywalled.

## Run it

```
npm install
npm run build
npm run preview
```

Preview serves the production site at http://127.0.0.1:4173 . **Double-click `Anchor.bat`** after a build to serve `dist/` on `127.0.0.1:5599` instead.

Serving (rather than opening `index.html` as a file) is deliberate: it gives a **stable origin** so your data reliably persists in the browser's localStorage. Opening the raw source file does not run the app — JSX is compiled at build time.

The Claude Code preview config name is `anchor` (it serves `dist/` on port 5599). Always launch on the same port — localStorage is keyed to the origin, so a different port = a fresh empty app.

GitHub Pages deploys **only from `main`**, after `npm run build`. Do not push this staging branch to `main` until the owner says the live site can change.

## Simple vs Full view

The Home screen defaults to a **Simple view** — just the daily essentials (recovery day-count, quick mood check-in, today's intention, water, habits, plus the always-present SOS). Everything else (75 cards across sleep, mind, body, focus, progress) is one tap away:

- **"Show everything"** on Home flips to Full view (all cards).
- **"Customize"** (or Settings → *Home layout*) lets you pick exactly which cards appear on your Simple home — per-card toggles grouped by section, with *Reset to defaults*.

The choice is saved (in `state.ui`) so it sticks between sessions.

## Install on your phone (Android PWA)

The landing page (`#/`) repeats these steps. Anchor is an installable **PWA** (`manifest.webmanifest` + a build-generated `sw.js` + `icons/`). It runs full-screen and works **offline** once installed. Installing needs **HTTPS** (or localhost).

1. **Host the `dist/` folder** on any static host with HTTPS. GitHub Pages does this from `main` only, and only after the production build.
2. **Add to Home screen:** Android Chrome → menu → **Add to Home screen** / Install app. iPhone Safari → Share → **Add to Home Screen**.
3. The installed app opens the tool (`#/app`). The public URL opens the landing page first, with Terms, Privacy, and a Support button that does not take payment.

**Privacy:** your logs stay in localStorage on the device. The service worker caches the app shell only. Back up via Settings → *Export backup*. The Anchor is not a medical device. In an emergency, call 112.

## The four modules

| Module | What it does |
|---|---|
| **Flow** | Visual routine player. One step at a time, big calming timer, **auto-advances** so there are no decisions mid-routine. Snooze / skip without guilt. |
| **Co-Pilot** | Body-doubling focus session (25 / 50 min). State your goal, the Agent "works alongside" you with check-ins, review at the end. |
| **Anchor** | 2-tap mood check-in. Logging **Low** or **Anxious** auto-opens a CBT thought record (trigger → thought → evidence → reframe). 5-4-3-2-1 grounding too. |
| **Recovery** (the ⚓ SOS button, on every screen) | Urge-surf wave timer, TIPP distress skills, paced breathing, and **compassionate** streak tracking. A relapse never zeroes you or shows red — it preserves your total recovery days and pivots to self-forgiveness. |

## Crisis contacts (verify these are current)

Hard-coded SA lines, shown on the landing page and the SOS screen, tap-to-dial. They are refreshed from the app on load so an old localStorage copy cannot keep a stale official number. SOS is never paywalled.
- **SADAG Suicide Crisis Line — 0800 567 567** (24h)
- **DSD Substance Abuse Helpline — 0800 12 13 14** (24h, SMS 32312)
- **Cipla Mental Health — 0800 456 789** (24h, SMS 31393)
- **SADAG office, 8am–8pm — 011 234 4837** (not a 24-hour line)
- **Emergency — 112**

Add your own people (sponsor, therapist) in Settings → Recovery.

## Your data

Everything is stored **only in this browser** (localStorage key `anchorOS.v1`). There is no server, no cloud, nothing leaves your machine unless you enable the Agent OS bridge.
**Back it up:** Settings → Your data → *Export backup*. A browser clean-up would otherwise wipe your streak history.

## Agent OS integration

The app exposes a stable bridge on `window.WellnessOS`:

```js
window.WellnessOS.getState()                 // full live state object
window.WellnessOS.emit('type', {payload})    // queue a custom event
window.WellnessOS.flush()                     // POST queued events now
window.WellnessOS.pushInbox(['a nudge'])     // show a message on Home
window.WellnessOS.eventTypes                  // the 9 emitted event types
```

When enabled in Settings, the app POSTs to your endpoint:
```json
{ "source": "anchor-os", "sentAt": "<iso>", "events": [
  { "v": 1, "source": "anchor-os", "ts": "<iso>", "type": "anchor.mood_logged", "payload": { "mood": "low", "energy": 2 } }
] }
```
Emitted events: `flow.routine_completed`, `flow.routine_exited`, `copilot.session_started`,
`copilot.session_done`, `anchor.mood_logged`, `anchor.thought_record`,
`recovery.urge_surf_started`, `recovery.urge_surf_done`, `recovery.relapse_logged`.

## Public pages

- `#/` landing, including **Add to Home screen** steps and the crisis lines
- `#/app` the tool (installed PWA start)
- `#/app?sos=1` opens SOS immediately
- `#/terms` short terms (not a medical device; emergency 112)
- `#/privacy` data stays in localStorage
- `#/support` **Support The Anchor** placeholder — no payment wiring

## Tech

React 18 + Tailwind, compiled with Vite (`npm run build` → `dist/`). State = `useReducer` + Context,
persisted to localStorage. The service worker is generated at build time and precaches the static shell.
There is no in-browser Babel.

Headless check (production preview must already be running):

```
npm run build
npm run preview
npm run test:browser
```

*Not a medical device. A support tool. In an emergency, call 112.*
