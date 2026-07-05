# Anchor — your calm operating system

A single-file, offline-first web app for managing ADHD, depression, and addiction recovery.
Built to plug into Dale's Agent OS. No build step, no internet required.

## Run it

**Double-click `Anchor.bat`.** It starts a tiny local server on `127.0.0.1:5599` and opens the app in your browser. Fully offline — localhost only, no internet, libraries vendored in `vendor/`.

Serving (rather than opening `index.html` as a file) is deliberate: it gives a **stable origin** so your data reliably persists in the browser's localStorage. Opening the raw file works visually but some browsers won't persist localStorage on a `file://` origin — and your history is the one thing this app must not lose.

Manual equivalent:
```
python -m http.server 5599 --directory C:\AI-Scripts\wellness-app
```
then open http://127.0.0.1:5599 . The Claude Code preview config name is `anchor`.
Always launch on the same port — localStorage is keyed to the origin, so a different port = a fresh empty app.

## Simple vs Full view

The Home screen defaults to a **Simple view** — just the daily essentials (recovery day-count, quick mood check-in, today's intention, water, habits, plus the always-present SOS). Everything else (75 cards across sleep, mind, body, focus, progress) is one tap away:

- **"Show everything"** on Home flips to Full view (all cards).
- **"Customize"** (or Settings → *Home layout*) lets you pick exactly which cards appear on your Simple home — per-card toggles grouped by section, with *Reset to defaults*.

The choice is saved (in `state.ui`) so it sticks between sessions.

## Install on your phone (Android PWA)

Anchor is an installable **PWA** (`manifest.webmanifest` + `sw.js` + `icons/`). It runs full-screen with its own icon and works **offline** once installed. Installing needs **HTTPS**, so you host the folder once, then install from the phone:

1. **Host it (2 min, free):** go to **app.netlify.com/drop** and drag the whole `wellness-app` folder onto the page. You get an `https://<name>.netlify.app` URL. (Create a free account to keep the URL permanent.)
   - Alternatives: Cloudflare Pages, GitHub Pages, Vercel — any static host with HTTPS.
2. **Install on Android:** open that URL in **Chrome** → **⋮ menu → Add to Home screen / Install app** → confirm. Anchor now launches like a native app, offline.
3. **Quick test without hosting:** run the local server (`Anchor.bat`) and expose it over HTTPS with a tunnel, e.g. `winget install cloudflare.cloudflared` then `cloudflared tunnel --url http://localhost:5599`. Install the temporary `https://…trycloudflare.com` URL on your phone. (URL changes each run — good for trials, not permanent.)

**Privacy:** only the empty app shell is on the web. All your logs stay in your phone's browser storage — nothing personal is uploaded. Back up via Settings → *Export backup*.

## The four modules

| Module | What it does |
|---|---|
| **Flow** | Visual routine player. One step at a time, big calming timer, **auto-advances** so there are no decisions mid-routine. Snooze / skip without guilt. |
| **Co-Pilot** | Body-doubling focus session (25 / 50 min). State your goal, the Agent "works alongside" you with check-ins, review at the end. |
| **Anchor** | 2-tap mood check-in. Logging **Low** or **Anxious** auto-opens a CBT thought record (trigger → thought → evidence → reframe). 5-4-3-2-1 grounding too. |
| **Recovery** (the ⚓ SOS button, on every screen) | Urge-surf wave timer, TIPP distress skills, paced breathing, and **compassionate** streak tracking. A relapse never zeroes you or shows red — it preserves your total recovery days and pivots to self-forgiveness. |

## Crisis contacts (verify these are current)

Hard-coded SA national lines, shown on the SOS screen and tap-to-dial:
- **SADAG Suicide Crisis Line — 0800 567 567** (24h)
- **SADAG Mental Health Line — 011 234 4837**
- **Substance Abuse Helpline — 0800 12 13 14** (SMS 32312)
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

## Tech

React 18 + Tailwind, vendored locally in `vendor/` (offline). State = `useReducer` + Context,
persisted to localStorage. In-browser Babel keeps it zero-install; for a production build, port the
`text/babel` block to a Vite project (optional future optimization).

*Not a medical device. A support tool. In an emergency, call the numbers above.*
