<div align="center">

# FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer

**Manifest V3 Chrome extension** that synthesizes binaural frequencies, Solfeggio tones and ambient noise in real time with the **Web Audio API** — bundled with a **Smart Pomodoro timer** and a privacy-first, **Bitcoin-only** licensing model.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Web Audio API](https://img.shields.io/badge/Audio-Web%20Audio%20API-38bdf8)
![Zero-Telemetry](https://img.shields.io/badge/Telemetry-None-0f766e)
![License](https://img.shields.io/badge/License-Proprietary-F7931A)

**3-day frictionless free trial · €12 one-time · Bitcoin · No subscriptions.**
Everything runs locally in your browser. Nothing is tracked, recorded, or uploaded.

</div>

---

## What is FocusBot?

FocusBot is a lightweight, **offline-first** Chrome extension for deep work. It synthesizes precise neural frequencies in real time inside your tab using the native **Web Audio API** — zero audio downloads, zero streaming, zero latency. It pairs a **Smart Pomodoro timer** with an **ambient noise mixer**, all inside one floating widget that stays in sync through the MV3 action popup.

- **Zero telemetry** — no analytics, no trackers, no crash reporting.
- **100% Offline-First** — all sound is generated on your device.
- **One-time license** — 3-day free trial, then €12 for 365 days, payable in Bitcoin with no payment processor in the middle.

---

## Key Features

### Neural Frequencies — Delta to Gamma
Each binaural mode targets a specific cognitive state via exact left/right pairs:

| Mode | Left → Right (Hz) | Best For |
|---|---|---|
| **Delta** | 100 → 102 (Δ2) | Deep, restorative sleep |
| **Theta** | 180 → 186 (Δ6) | Creativity & meditation |
| **Alpha** | 200 → 210 (Δ10) | Relaxed focus & learning |
| **Beta** | 200 → 214 (Δ14) | Active concentration |
| **Gamma** | 200 → 240 (Δ40) | Peak cognition |

You can dial in any **custom binaural range** (0–1000 Hz) at any time.

### Full Solfeggio Spectrum — 174 Hz to 963 Hz
All ten Solfeggio tones delivered as equal-phase mono carriers, including the famous **432 Hz** and **528 Hz**:

**174 · 285 · 396 · 417 · 432 · 528 · 639 · 741 · 852 · 963 Hz**

### Ambient Noise Layers
**Pink · Brown · Rain · White** noise beds synthesize at runtime under your tones, each with an independent on/off toggle and its own volume stage — engineered to be clearly audible thanks to a unity ambient bus, pink makeup gain, and a dedicated brown deep-bass booster.

### Smart Pomodoro
25-minute focus / 5-minute break cycles that **auto-start the frequencies** with each focus phase and **auto-pause on breaks**. A soft synthesized **528 Hz crystal chime** marks every phase transition (2.5 s exponential tail — no audio file).

### Privacy-Focused Bitcoin License
- **3-day frictionless trial** — no license, no key, no payment history; a live countdown badge shows the remaining window.
- **€12 one-time, 365 days** — pay in Bitcoin directly to the developer's address; no payment processor or middleman.
- Paste your **TXID** (or a license key) to activate instantly via the Cloudflare Worker.

---

## Privacy, Permissions & Licensing

- **Zero telemetry** — FocusBot tracks nothing. Every preference, your trial window and your license state stay in your local browser (`chrome.storage.local`).
- **Minimal permissions** — only `storage` (plus the Web Audio API for synthesis). No browsing history, tabs, camera, microphone, or location access.
- **Bitcoin-only payments** — no credit card, bank, or billing address is ever requested, processed, or stored.

> *(Payment Note: To maximize user privacy and prevent unauthorized recurring card charges, FocusBot exclusively accepts Bitcoin for lifetime licenses. No credit card details, billing addresses, or personal financial data are ever requested, processed, or stored.)*

Read the full **[Privacy Policy →](privacy.html)**.

---

## Architecture & Technical Details

### Web Audio API Graph
FocusBot builds a **single `AudioContext`** exactly once, then manages playback purely through `suspend()` / `resume()` — eliminating context leaks and decoding churn. The graph is a structured pipeline:

- **Binaural engine** — two oscillators into a merger (L/R), gated behind a verified license.
- **Ambient buses** — Pink, Brown, Rain and White noise buffers generated at runtime.
- **Independent stages** — separate binaural/tone and ambient master gains, a deep-bass booster for Brown, and a final compressor to prevent clipping.
- **Clean teardown** — on `pagehide` the suspend timer is cleared and the context is suspended; nothing leaks in the background.

### License Hardening
- The `AudioContext` is **never constructed** without a verified license; flipping a flag cannot reconstruct the graph.
- Frequency coefficients are delivered as a **base64url + HMAC-SHA256 signed** `engine` token on every license verification; a tampered token falls back to a safe matrix.
- **Re-verification on every page load** and on tab foreground — if the server stops confirming the license, Pro is revoked immediately.
- A **trial watchdog** runs on a timer and on tab focus to live-lock the engine the instant the 72-hour trial window expires.

### Cloudflare Worker Endpoints

| Route | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `POST /api/verify-license` | License key → `{ valid, plan, expiresAt, engine }` |
| `POST /api/verify-tx` | BTC TXID → on-chain verification → auto activation |
| `GET /api/pricing` | Live EUR → satoshi conversion (cache + fallback) |
| `POST /api/admin/grant` | Issue licenses (admin token) |

---

## Development Setup

```bash
npm install      # no runtime dependencies
npm test         # test suite, zero external calls (Node.js >= 18)
npm run package  # rebuild the release ZIPs (MV3 flat bundle)
```

**Test the suite:**
```bash
npm test
```

**Build the extension bundles:**
```bash
npm run package
```
Writes `focus-bot-extension.zip` and `focus-bot-webstore-v1.3.0.zip` to the repo root.

### Install the extension locally (Chrome / Brave / Edge)

1. Download `focus-bot-extension.zip` from the **Releases** page and unzip it to a memorable folder.
2. Open `chrome://extensions` (Chrome / Brave) or `edge://extensions` (Edge).
3. Enable **Developer Mode** (top-right), click **Load unpacked** (top-left), and select the folder containing `manifest.json`.

---

## Repository Layout

```
client/
  manifest.json     MV3 manifest (permissions, CSP, icons)
  focus-bot.js      Widget engine — audio graph, license, trial
  focus-bot.css     Widget & Buy Pro styles
  popup.html|js     MV3 action popup (toolbar control)
  index.html        In-repo demo / local test page
  privacy.html      Bundled privacy page
index.html          Public landing page (GitHub Pages / Vercel / Netlify)
privacy.html        Public privacy policy page
worker/             Cloudflare Worker license API
tests/              Headless test suite (node)
scripts/            Package + icon generators
```

---

## Legal Disclaimer

FocusBot is a sound-synthesis and productivity tool. It is **not** a medical device and is not intended to diagnose, treat, or cure any cognitive, neurological, or psychiatric condition. Blockchain payments are irreversible — verify all payment parameters before broadcasting.

---

## License

**Proprietary Commercial Software.** All rights reserved. Unauthorized copying, redistribution, or re-sale is prohibited. See the [Privacy Policy](privacy.html) for data-handling details.

---

*Last updated: September 2026 | FocusBot v1.3.0*
