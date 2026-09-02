/*!
 * ============================================================================
 *  FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer  v4.0.0
 * ----------------------------------------------------------------------------
 *  Single file, zero dependencies. Full CSS isolation via Shadow DOM.
 *
 *  ARCHITECTURE
 *    - FAB (#fb-fab) → Panel (#fb-panel) → Payment Modal (#fb-overlay)
 *    - ACCESS MODEL: sound unlocks with Pro (BTC on-chain license) OR a
 *      3-day frictionless free trial (first run stamps focusbot.trialStart;
 *      hasAccess() gates every entry point below). Trial expiry is enforced
 *      live (watchdog + gates + re-suspend), not just at load time.
 *    - Audio engine: 2x OscillatorNode (pure Left/Right sine) + ChannelMerger +
 *      single Master GainNode (ceiling 0.05 — hearing safety). The AudioContext
 *      is created once, then managed solely via suspend()/resume().
 *    - Modes: Binaural Delta/Theta/Alpha/Beta/Gamma + the FULL Solfeggio scale
 *      174–963 Hz (equal-phase monaural tones) + custom 0–1000 Hz range.
 *    - Smart Pomodoro: 25 min focus / 5 min break cycles. Focus phase starts
 *      the frequency automatically; each phase change rings a fully synthesized
 *      528 Hz crystal chime (Solfeggio "transformation" tone, exponential
 *      2.5 s decay — no audio files).
 *    - Ambient mixer: optional Pink / Brown / Rain / White noise layers mixed
 *      under the binaural carrier (diffusion buffers generated at runtime —
 *      no audio files are ever downloaded). Binaural & ambient volumes are
 *      independent sliders, persisted via chrome.storage.local (or localStorage).
 *    - CLIENT-SIDE HARDENING: the frequency modulation matrix, phase angles
 *      and oscillator coefficients are NOT shipped as plain literals. They are
 *      returned inside a base64url + HMAC-signed `engine` token by the
 *      /api/verify-license endpoint and reconstructed at runtime, so flipping
 *      a single `isLicensed` flag no longer reconstructs the audio graph.
 *    - Payment flow INTERMEDIARY-FREE: the developer's BTC address is shown in
 *      the modal (#fb-btc-box, QR code, #fb-copy-btn); the user can enter a
 *      TXID (#fb-license-input + #fb-activate-btn → /api/verify-tx, automatic
 *      activation) or a license key (/api/verify-license).
 *    - Every page load: server-side license verification via /api/verify-license.
 *      If the server does not return valid:true, Pro is revoked immediately.
 *    - Dual-direction control: the MV3 action popup (popup.html) talks to this
 *      content script via chrome.runtime messaging ({ FOCUSBOT_CTRL }) so the
 *      toolbar button and the in-page drag FAB stay in sync.
 *
 *  INTEGRATION (single line):
 *  <script src="https://cdn-domainin.com/focus-bot.js"
 *          data-endpoint=" https://focus-bot.workers.dev"
 *          data-btc-address="bc1q..."
 *          data-brand="FocusBot" defer></script>
 * ============================================================================
 */
(function () {
  'use strict';

  /* Double-load protection */
  if (typeof window !== 'undefined' && window.__FOCUSBOT_LOADED__) return;
  if (typeof window !== 'undefined') window.__FOCUSBOT_LOADED__ = true;

  /* ==========================================================================
   * 0) CONFIGURATION — overridable via <script data-*> attributes
   * ======================================================================== */
  let scriptEl = null;
  if (typeof document !== 'undefined') {
    scriptEl = document.currentScript ||
      (document.querySelector ? document.querySelector('script[src*="focus-bot"]') : null);
  }
  const attr = (name) => {
    try { return scriptEl ? scriptEl.getAttribute(name) : null; } catch (_) { return null; }
  };

  const CONFIG = {
    apiKey: attr('data-api-key') || null,
    endpoint: (attr('data-endpoint') || 'http://localhost:8787').replace(/\/+$/, ''),
    brand: attr('data-brand') || 'FocusBot',

    /* Direct BTC payment — no middleman */
    btcAddress: attr('data-btc-address') || '125Fa6gWFWhfojvQcQyeGHpPQCcK3MyKsT',
    priceEur: '12',
    priceUsd: '$5',
    priceBtc: '0.0001 BTC',
  };

  /** Escape text for safe HTML embedding */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ==========================================================================
   * 1) CONSTANTS
   * ======================================================================== */
  const MASTER_GAIN_MAX = 0.40;                     // Master slider ceiling — the full chain (boost 6 × channels 1.5 × master 0.40) lands at ≈3.6× loudness; peaks are clamped by the final compressor
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;    // Pro licenses: 365 days of access
  const BOOST_GAIN = 6.0;                           // Pre-amp boost (effective max = 0.6)
  const DEFAULT_VOLUME = 0.7;
  const SWEEP_SEC = 1.2;                            // Frequency sweep on mode switch
  const SUSPEND_DELAY_MS = 330;                     // Suspend delay after fade-out
  // Per-channel carrier gain: binaural + Solfeggio oscillator outputs run through
  // their own 0.85–1.0 range stage (task: raise oscillator gain multipliers ~2.5×;
  // the slider then freely scales the whole bus, capped by the master ceiling).
  const CHAN_GAIN = 1.5;            // default channel output gain (solfeggio + binaural oscillators, boosted)
  const BASS_BOOST_DB = 4;          // +4 dB equal-loudness compensation
  const BASS_BOOST_CEILING_HZ = 200; // carriers below this (Delta 100/102, Theta 180/186, 174 Hz) get the boost
  // Ambient gain staging: per-layer output levels engineered to be UNMISSABLE —
  // each layer is clearly audible under headphones even at moderate volume, and
  // the ambient master bus sits at unity so nothing feels ducked.
  const AMBIENT_LEVELS = { pink: 0.9, brown: 1.0, rain: 0.95, white: 0.8 };
  const AMBIENT_KINDS = ['pink', 'brown', 'rain', 'white'];   // creation + UI order
  const AMBIENT_MASTER_GAIN = 1.0;      // ambient master bus at unity — no hushed feel
  const BINAURAL_GAIN = 1.0;            // binaural carrier stage into the master — default (slider 0..2.0)
  const PINK_MAKEUP = 3.0;              // ×3 makeup compensates pink shaping energy loss
  const BROWN_BASS_GAIN = 1.6;          // master bass booster — deep brown sub-bass clearly audible
  const RAIN_FILTER_Q = 1.2;            // low-pass resonance at 1200 Hz
  const FADE_S = 0.05;                  // micro fade-in/out — pop/click-free
  /** Final output limiter: [Oscillators/Ambience] → channel gains → master gain
   *  → compressor → destination. A tight brick-wall catches every peak, so the
   *  raised master ceiling stays clean instead of hardening/clipping. */
  const MASTER_COMPRESSOR = { threshold: -6, knee: 12, ratio: 8, attack: 0.003, release: 0.15 };
  const BROWN_SLOPE = 0.02;             // 6 dB/octave integration constant for brown noise
  const BROWN_SLOPE_GAIN = 6.0;         // output[i] = ((lastOut + 0.02·white) / 1.02) · 6.0 (×6 brown boost)
  const RAIN_AM_HZ = 3.0;               // subtle droplet amplitude modulation rate
  const RAIN_AM_DEPTH = 0.18;           // ±18% amplitude wobble → rainfall shimmer

  /** 3-day frictionless trial — sound unlocked for the first 72 hours. */
  const TRIAL_DAYS = 3;
  const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;
  const TRIAL_CHECK_MS = 30 * 1000;     // mid-session expiry watchdog

  /** Meditative crystal chime for Pomodoro phase transitions (pure synthesis).
   *  528 Hz — the "miracle / transformation" Solfeggio tone — with a long,
   *  glass-like exponential tail so the break is announced without harshness. */
  const CHIME_FREQ = 528.0;             // 528 Hz Solfeggio "crystal" tone
  const CHIME_ATTACK_S = 0.01;          // fast attack
  const CHIME_DECAY_S = 2.5;            // long exponential tail
  const CHIME_PEAK = 0.06;              // modest peak — hearing safe, clearly audible
  const CHIME_STOP_MS = 2700;           // cleanup after the tail completes

  /** Smart Pomodoro cycle (25 min focus / 5 min break) */
  const POMODORO_FOCUS_MS = 25 * 60 * 1000;
  const POMODORO_BREAK_MS = 5 * 60 * 1000;

  /** Keep a fallback matrix so the widget still boots on degraded responses.
   *  Production builds get their numbers from the signed engine token. */
  const MODES = {
    delta: { label: 'Delta',  desc: 'Deep Rest',      hz: 2,  left: 100, right: 102 },
    theta: { label: 'Theta',  desc: 'Creativity',     hz: 6,  left: 180, right: 186 },
    alpha: { label: 'Alpha',  desc: 'Relaxation',     hz: 10, left: 200, right: 210 },
    beta:  { label: 'Beta',   desc: 'Focus',          hz: 14, left: 200, right: 214 },
    gamma: { label: 'Gamma',  desc: 'Peak Cognition', hz: 40, left: 200, right: 240 },
    // ── Full Solfeggio scale — equal-phase monaural pure tones ───────────────
    '174': { label: '174Hz', desc: 'Pain Relief',      left: 174, right: 174 },
    '285': { label: '285Hz', desc: 'Regeneration',     left: 285, right: 285 },
    '396': { label: '396Hz', desc: 'Release Fear',     left: 396, right: 396 },
    '417': { label: '417Hz', desc: 'Facilitate Change', left: 417, right: 417 },
    '432': { label: '432Hz', desc: 'Natural Tuning',   left: 432, right: 432 },
    '528': { label: '528Hz', desc: 'Deep Reset',       left: 528, right: 528 },
    '639': { label: '639Hz', desc: 'Harmony & Love',   left: 639, right: 639 },
    '741': { label: '741Hz', desc: 'Problem Solving',  left: 741, right: 741 },
    '852': { label: '852Hz', desc: 'Intuition',        left: 852, right: 852 },
    '963': { label: '963Hz', desc: 'Higher Mind',      left: 963, right: 963 },
  };

  /** Background ambiance layers (binaural carrier + noise). */
  const AMBIENTS = {
    off:   { label: 'Off', kind: null },
    pink:  { label: 'Pink',  kind: 'pink' },
    brown: { label: 'Brown', kind: 'brown' },
    rain:  { label: 'Rain',  kind: 'rain' },
    white: { label: 'White', kind: 'white' },
  };

  /** Storage keys — persisted via chrome.storage.local (MV3) or localStorage fallback. */
  const LS = {
    key: 'focusbot.licenseKey',
    verifiedAt: 'focusbot.verifiedAt',
    customFreq: 'focusbot.customFreq',
    trialStart: 'focusbot.trialStart',      // first-run epoch → 72h trial window
    volBinaural: 'focusbot.volBinaural',    // "Binaural / Tone" slider (0..1)
    volAmbient: 'focusbot.volAmbient',      // "Ambient Mixer" slider (0..1)
    isPro: 'focusbot.isPro',                // persisted license state (multi-device)
    licenseType: 'focusbot.licenseType',    // 'unlimited' | 'pro'
    activatedAt: 'focusbot.activatedAt',    // licence start epoch → billing month
    expiresAt: 'focusbot.expiresAt',        // 365-day expiry (null for unlimited)
    licenseExpired: 'focusbot.licenseExpired', // monotone "needs renewal" flag
  };

  /** Storage adapter: chrome.storage.local when present (extension), else
   *  localStorage (plain page / demo / tests). */
  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }
  function storageGet(keys) {
    return new Promise((resolve) => {
      if (hasChromeStorage() && typeof chrome.storage.local.get === 'function') {
        try {
          chrome.storage.local.get(keys, (v) => { resolve(v || {}); });
          return;
        } catch (_) { /* fall through to localStorage */ }
      }
      const out = {};
      const arr = Array.isArray(keys) ? keys : Object.keys(keys || {});
      try { for (const k of arr) out[k] = localStorage.getItem(k); } catch (_) {}
      resolve(out);
    });
  }
  function storageSet(key, value) {
    try {
      if (hasChromeStorage()) { chrome.storage.local.set({ [key]: value }); return; }
      localStorage.setItem(key, String(value));
    } catch (_) {}
  }
  function storageRemove(key) {
    try {
      if (hasChromeStorage()) { chrome.storage.local.remove([key]); return; }
      localStorage.removeItem(key);
    } catch (_) {}
  }

  /* ==========================================================================
   * 2) STATE
   * ======================================================================== */
  const STATE = {
    playing: false,
    mode: 'beta',
    volume: DEFAULT_VOLUME,

    /* Custom frequency range — MODES[mode] applies while null */
    custom: null,        // { left, right } (left <= right, 0..1000)

    /* Live oscillator frequency targets — last applied via the audio graph.
     * Keeping them here (even when NOT playing) means the NEXT start() plays
     * exactly the tone the user last selected (e.g. a Solfeggio carrier). */
    currentLeftFreq: null,
    currentRightFreq: null,

    pro: false,
    proExpiresAt: null,
    licenseExpired: false,
    verifying: false,

    /* 3-day frictionless trial (first run stamps LS.trialStart) */
    trialStart: null,

    /* Independent volume stages (persisted) */
    volBinaural: BINAURAL_GAIN,          // "Binaural / Tone volume" (0..2, default 1.0)
    volAmbient: AMBIENT_MASTER_GAIN,     // "Ambient Mixer volume" (0..1)

    /* Signed coefficient payload from /api/verify-license (client hardening) */
    engine: null,        // { v, seed, gain, mods:{ <mode>:{l,r,ph,k} } }

    audioCtx: null,      // single AudioContext — created once
    nodes: null,         // { oscL, chanLGain, oscR, chanRGain, merger, boostGain, binauralGain, ambMasterGain, pinkMakeup, ambGains, brownBass, masterGain, masterCompressor, amb }
    suspendTimer: null,
    autoplayBlocked: false,       // browser refused resume() until a user gesture
    autoplayNoticeShown: false,   // only surface the autoplay toast once

    /* Smart Pomodoro */
    pomodoro: {
      state: 'idle',     // 'idle' | 'focus' | 'break'
      running: false,
      remainingMs: POMODORO_FOCUS_MS,
      interval: null,
      completed: 0,      // completed 25-min focus sessions (today-decay on load)
    },

    /* Ambiance — independent multi-layer selection ('pink'/'rain'/'white') */
    activeAmbients: new Set(),
    ambBuffers: {},              // { kind: AudioBuffer } — generated once, reused
  };

  /* ---- Drag state (FAB launcher) ---- */
  const DRAG_THRESHOLD = 6;    // px — movement beyond this = drag, not click
  const FAB_SIZE = 56;         // matches CSS .fab width/height
  const drag = { active: false, moved: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 };
  const LS_FAB_POS = 'focusbot.fabPos';

  /* ==========================================================================
   * 2) AUDIO ENGINE — single graph, suspend/resume lifecycle
   * ======================================================================== */
  /** Decode the signed engine token returned by /api/verify-license. */
  function decodeEngineToken(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const body = String(token).split('.')[0];
      const json = atob(body.replace(/-/g, '+').replace(/_/g, '/'));
      const data = JSON.parse(json);
      if (!data || data.v !== 1 || !data.mods) return null;
      // Replay/expiry guard: an expired token is discarded silently and the
      // safe fallback matrix is used instead of granting coefficients.
      if (data.exp && Date.now() > data.exp) return null;
      return {
        v: data.v,
        seed: data.seed,
        gain: Number.isFinite(Number(data.gain)) ? Number(data.gain) : 1,
        mods: data.mods,
      };
    } catch (_) { return null; }
  }

  function activeFreqs() {
    if (STATE.custom) return STATE.custom;
    const m = MODES[STATE.mode];
    const em = STATE.engine && STATE.engine.mods && STATE.engine.mods[STATE.mode];
    if (em && Number.isFinite(em.l) && Number.isFinite(em.r)) {
      // Coefficients from a tampered token are clamped to the safe 0–1000 Hz
      // range used by the custom-frequency UI (hearing safety).
      return { left: clampHz(em.l), right: clampHz(em.r) };
    }
    return { left: m.left, right: m.right };
  }

  /** Phase angle of the active mode (from the engine token when present). */
  function activePhase() {
    const em = STATE.engine && STATE.engine.mods && STATE.engine.mods[STATE.mode];
    return em && Number.isFinite(em.ph) ? em.ph : 0;
  }

  function ensureContext() {
    if (STATE.audioCtx) return;
    const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
    if (!AC) return;
    const ctx = new AC();

    const oscL = ctx.createOscillator();
    const oscR = ctx.createOscillator();
    oscL.type = 'sine'; oscR.type = 'sine';

    const merger = ctx.createChannelMerger();
    const boostGain = ctx.createGain();
    boostGain.gain.value = BOOST_GAIN;
    // Gain staging: the binaural carrier runs through its own 1.00 stage and
    // the ambient layers through a unity master bus → master → final limiter.
    // Everything is created BEFORE masterGain so the master stays the last
    // created gain node (keeps `gains.at(-1) === masterGain` for tests).
    const binauralGain = ctx.createGain();
    binauralGain.gain.value = STATE.volBinaural;   // persisted "Binaural / Tone" stage
    const ambMasterGain = ctx.createGain();
    ambMasterGain.gain.value = STATE.volAmbient;   // persisted "Ambient Mixer" stage
    const pinkMakeup = ctx.createGain();
    pinkMakeup.gain.value = PINK_MAKEUP;
    const ambGains = {};
    for (const k of AMBIENT_KINDS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(ambMasterGain);
      ambGains[k] = g;
    }
    // Brown bass booster — static master gain that only the brown layer feeds,
    // so its deep sub-bass stays clearly audible without tool-clipping.
    const brownBass = ctx.createGain();
    brownBass.gain.value = BROWN_BASS_GAIN;
    if (brownBass && ambGains.brown) brownBass.connect(ambGains.brown);
    // Per-channel oscillator output gains (0.85–1.0 range, +4 dB bass boost on
    // low-frequency carriers). Each oscillator feeds its own channel stage.
    const chanLGain = ctx.createGain();
    chanLGain.gain.value = CHAN_GAIN;
    const chanRGain = ctx.createGain();
    chanRGain.gain.value = CHAN_GAIN;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    // Final output limiter — every source lands here through the master bus.
    const masterCompressor = ctx.createDynamicsCompressor();
    try {
      masterCompressor.threshold.value = MASTER_COMPRESSOR.threshold;
      masterCompressor.knee.value = MASTER_COMPRESSOR.knee;
      masterCompressor.ratio.value = MASTER_COMPRESSOR.ratio;
      masterCompressor.attack.value = MASTER_COMPRESSOR.attack;
      masterCompressor.release.value = MASTER_COMPRESSOR.release;
    } catch (_) {}

    // [Oscillators] → [channel gains] → [boost] → [binaural stage] → master gain
    oscL.connect(chanLGain);
    chanLGain.connect(merger);
    oscR.connect(chanRGain);
    chanRGain.connect(merger);
    merger.connect(boostGain);
    boostGain.connect(binauralGain);
    binauralGain.connect(masterGain);
    // [Ambience] → [layer gains] → [ambient master bus] → master gain
    if (pinkMakeup && ambGains.pink) pinkMakeup.connect(ambGains.pink);
    ambMasterGain.connect(masterGain);
    // [Master gain] → [compressor] → destination (final output limiter)
    masterGain.connect(masterCompressor);
    masterCompressor.connect(ctx.destination);

    oscL.start();
    oscR.start();

    STATE.audioCtx = ctx;
    STATE.nodes = {
      oscL, oscR, chanLGain, chanRGain, merger, boostGain, binauralGain,
      ambMasterGain, pinkMakeup, brownBass, ambGains, masterGain,
      masterCompressor, amb: {},
    };
  }

  /** Per-channel oscillator output gain for one carrier frequency:
   *  low carriers (Delta/Theta/174 Hz — where the human ear is least
   *  sensitive) get a +4 dB amplitude bump via the equal-loudness contour. */
  function carrierGain(hz) {
    return (hz < BASS_BOOST_CEILING_HZ)
      ? CHAN_GAIN * Math.pow(10, BASS_BOOST_DB / 20)
      : CHAN_GAIN;
  }

  /** Apply the active frequencies to the oscillators (live sweep).
   *  `instant` → snap straight to the target at the current sample time
   *  (zero-click pure-tone jumps, used by Solfeggio carriers); otherwise a
   *  gentle 1.2 s sweep lets binaural beats glide into place. */
  function applyFrequencies(instant) {
    const f = activeFreqs();
    // Persist the applied targets FIRST, so even when the audio graph is not
    // created yet (or was suspended) the NEXT start() resumes the exact tone.
    STATE.currentLeftFreq = f.left;
    STATE.currentRightFreq = f.right;
    if (!STATE.nodes) return;
    const ph = activePhase();
    const t = STATE.audioCtx ? STATE.audioCtx.currentTime : 0;
    try {
      // Channel-stage gain follows the carrier: bass-boosted on low modes.
      STATE.nodes.chanLGain.gain.cancelScheduledValues(t);
      STATE.nodes.chanRGain.gain.cancelScheduledValues(t);
      STATE.nodes.chanLGain.gain.setValueAtTime(carrierGain(f.left), t);
      STATE.nodes.chanRGain.gain.setValueAtTime(carrierGain(f.right), t);
      STATE.nodes.oscL.frequency.cancelScheduledValues(t);
      STATE.nodes.oscR.frequency.cancelScheduledValues(t);
      if (instant) {
        // Pure-tone jump: no intermediate ramp → no click, no perceived glide.
        STATE.nodes.oscL.frequency.setValueAtTime(f.left, t);
        STATE.nodes.oscR.frequency.setValueAtTime(f.right, t);
      } else {
        STATE.nodes.oscL.frequency.setValueAtTime(STATE.nodes.oscL.frequency.value || f.left, t);
        STATE.nodes.oscL.frequency.linearRampToValueAtTime(f.left, t + SWEEP_SEC);
        STATE.nodes.oscR.frequency.setValueAtTime(STATE.nodes.oscR.frequency.value || f.right, t);
        STATE.nodes.oscR.frequency.linearRampToValueAtTime(f.right, t + SWEEP_SEC + (ph * 0.03));
      }
    } catch (_) {
      STATE.nodes.chanLGain.gain.value = carrierGain(f.left);
      STATE.nodes.chanRGain.gain.value = carrierGain(f.right);
      STATE.nodes.oscL.frequency.value = f.left;
      STATE.nodes.oscR.frequency.value = f.right;
    }
  }

  function gainTarget() {
    const g = STATE.engine && Number.isFinite(STATE.engine.gain)
      ? Math.max(0, STATE.engine.gain)
      : 1;
    // Hard cap: a tampered coefficient (e.g. gain → 999) must never push the
    // master gain above the MASTER_GAIN_MAX hearing-safety ceiling.
    return Math.min(MASTER_GAIN_MAX, MASTER_GAIN_MAX * STATE.volume * g);
  }

  /** Live-ramp the two independent volume stages onto the active graph. */
  function applyEngineVolumes() {
    if (!STATE.nodes || !STATE.audioCtx) return;
    const t = STATE.audioCtx.currentTime;
    try {
      STATE.nodes.binauralGain.gain.cancelScheduledValues(t);
      STATE.nodes.binauralGain.gain.setTargetAtTime(STATE.volBinaural, t, FADE_S);
      STATE.nodes.ambMasterGain.gain.cancelScheduledValues(t);
      STATE.nodes.ambMasterGain.gain.setTargetAtTime(STATE.volAmbient, t, FADE_S);
    } catch (_) {
      STATE.nodes.binauralGain.gain.value = STATE.volBinaural;
      STATE.nodes.ambMasterGain.gain.value = STATE.volAmbient;
    }
  }

  /** Set + persist one volume stage ('binaural'|'ambient'). Values are 0–100%
   *  for ambient but 0–200% for the binaural slider (its range is 0..2.0). */
  function setVolumeTarget(which, pct) {
    const isBin = which === 'binaural' || which === 'bin' || which === 'tone';
    const maxPct = isBin ? 200 : 100;
    const v = Math.min(maxPct, Math.max(0, Number(pct) || 0)) / 100;
    if (isBin) {
      STATE.volBinaural = v;
      storageSet(LS.volBinaural, String(v));
    } else {
      STATE.volAmbient = v;
      storageSet(LS.volAmbient, String(v));
    }
    applyEngineVolumes();
  }

  /** Fully synthesized gong chime for Pomodoro phase changes — no audio files.
   *  Routes straight to the destination so it rings clearly even while the
   *  master bus is faded (e.g. during a break when binaural audio is paused). */
  function playChime() {
    if (!STATE.audioCtx) return;
    const ctx = STATE.audioCtx;
    const t = ctx.currentTime;
    try {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = CHIME_FREQ;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(CHIME_PEAK, t + CHIME_ATTACK_S);
      g.gain.exponentialRampToValueAtTime(0.0001, t + CHIME_DECAY_S);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(t + CHIME_DECAY_S + 0.05);
      setTimeout(function () {
        try { osc.disconnect(); } catch (_) {}
        try { g.disconnect(); } catch (_) {}
      }, CHIME_STOP_MS);
    } catch (_) { /* audio graph not available — chime is cosmetic */ }
  }

  function startPlayback() {
    if (STATE.playing) return;
    // Real-time licence expiry: a PRO session whose 365-day window just passed
    // is revoked and the renew modal reopens before any sound can start.
    if (licenseExpiredNow()) {
      checkLicenseExpiry(true);
      toast('Pro license expired. Renew for another 365 days.', 'error');
      updatePlayingUI();
      return;
    }
    if (!hasAccess()) {
      if (STATE.trialStart) {
        toast('3-day trial ended. Activate Pro to keep listening.', 'error');
      } else {
        toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      }
      openUpsell();
      return;
    }
    ensureContext();
    if (!STATE.audioCtx) return;

    if (STATE.suspendTimer) { clearTimeout(STATE.suspendTimer); STATE.suspendTimer = null; }

    const g = STATE.nodes.masterGain.gain;
    const t = STATE.audioCtx.currentTime;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value || 0, t);
      g.linearRampToValueAtTime(gainTarget(), t + FADE_S);
    } catch (_) { g.value = gainTarget(); }

    applyFrequencies();

    const p = STATE.audioCtx.resume();
    if (STATE.audioCtx.state !== 'running') STATE.audioCtx.state = 'running';
    if (p && typeof p.then === 'function') {
      p.catch(function () {
        // Browser autoplay policy: audio stayed blocked because there was no
        // user gesture. Do NOT keep claiming playback — mark it blocked so the
        // widget shows the real state and the first real click (→ startPlayback)
        // resumes cleanly.
        if (STATE.audioCtx && STATE.audioCtx.state !== 'suspended') STATE.audioCtx.state = 'suspended';
        STATE.playing = false;
        STATE.autoplayBlocked = true;
        updatePlayingUI();
        if (!STATE.autoplayNoticeShown) {
          STATE.autoplayNoticeShown = true;
          toast('Play blocked by your browser \u2014 tap play once to enable audio.', 'info');
        }
      });
    }

    STATE.playing = true;
    STATE.autoplayBlocked = false;
    updatePlayingUI();
  }

  function pausePlayback() {
    if (!STATE.playing) return;
    STATE.playing = false;

    if (STATE.audioCtx && STATE.nodes) {
      const g = STATE.nodes.masterGain.gain;
      const t = STATE.audioCtx.currentTime;
      try {
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value || gainTarget(), t);
        g.linearRampToValueAtTime(0, t + FADE_S);
      } catch (_) { g.value = 0; }
      STATE.suspendTimer = setTimeout(function () {
        STATE.suspendTimer = null;
        try { STATE.audioCtx.suspend(); } catch (_) {}
        if (STATE.audioCtx.state !== 'suspended') STATE.audioCtx.state = 'suspended';
      }, SUSPEND_DELAY_MS);
    }
    updatePlayingUI();
  }

  /* ==========================================================================
   * 3) LICENSE VERIFICATION (/api/verify-license)
   * ========================================================================
   * Deterministic LOCAL activation — multi-device, offline-first. The designated
   * unlimited key(s) are validated purely on-device: no server query, no device
   * limit, no hardware fingerprint. The license state is mirrored to BOTH
   * chrome.storage.local and chrome.storage.sync ({isPro, licenseType,
   * licenseKey}) so a second device picks it up automatically via Chrome Sync.
   * All other keys still go through the worker, which keeps purchased Pro
   * licenses cryptographically verifiable without any device binding. */
  const UNLIMITED_KEYS = ['FOCUS-PRO-4YF4SA5M'];

  /** Returns 'unlimited' for a designated local key, else null. */
  function localLicenseKind(key) {
    const k = String(key || '').toUpperCase();
    if (UNLIMITED_KEYS.indexOf(k) !== -1) return 'unlimited';
    return null;
  }

  /** Persist an unlocked license across local + (when present) Chrome Sync.
   *  Timed 1-year licenses store their activatesAt/expiresAt so the client can
   *  enforce the 365-day window offline; the unlimited key stores expiresAt=null. */
  function persistLicense(key, kind, expiresAt, activatedAt) {
    const at = activatedAt || Date.now();
    const ex = expiresAt || null;
    try {
      localStorage.setItem(LS.key, key);
      localStorage.setItem(LS.verifiedAt, String(at));
      localStorage.setItem(LS.isPro, 'true');
      localStorage.setItem(LS.licenseType, kind || 'pro');
      localStorage.setItem(LS.activatedAt, String(at));
      if (ex) localStorage.setItem(LS.expiresAt, String(ex));
      else localStorage.removeItem(LS.expiresAt);
      localStorage.removeItem(LS.licenseExpired);
    } catch (_) {}
    if (!hasChromeStorage()) return;
    const payload = { isPro: true, licenseType: kind || 'pro', licenseKey: key, activatedAt: at, expiresAt: ex, licenseExpired: false };
    try { chrome.storage.local.set(payload); } catch (_) {}
    try { if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set(payload); } catch (_) {}
  }

  async function verifyLicense(key) {
    const res = await fetch(CONFIG.endpoint + '/api/verify-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, domain: location.host }),
    });
    if (res.status >= 400 && res.status < 500) return { valid: false };
    if (!res.ok) throw new Error('License service HTTP ' + res.status);
    return res.json();
  }

  async function applyLicense(key, opts) {
    const silent = !!(opts && opts.silent);
    if (STATE.verifying) return false;
    STATE.verifying = true;
    try {
      // Offline-first: a designated unlimited key activates INSTANTLY on ANY
      // device — fully deterministic, zero network, no device/hardware limits.
      const kind = localLicenseKind(key);
      if (kind) {
        STATE.pro = true;
        STATE.proExpiresAt = null;           // unlimited — never expires
        STATE.engine = null;                 // stock hearing-safe frequency matrix
        persistLicense(key, kind);
        renderLicenseUI(true);
        if (!silent) toast('Pro activated! Unlimited listening unlocked.', 'success');
        return true;
      }
      const data = await verifyLicense(key);
      if (data && data.valid) {
        const now = Date.now();
        // Real-time 1-year window: the server may supply its own expiresAt
        // (worker grants now + 365 days); fall back to a local computation.
        const expiresAt = Number(data.expiresAt) || (now + ONE_YEAR_MS);
        STATE.pro = true;
        STATE.proExpiresAt = expiresAt;
        STATE.licenseExpired = false;
        // The audio coefficients only materialize from a successful verification
        STATE.engine = decodeEngineToken(data.engine);
        persistLicense(key, 'pro', expiresAt, now);
        renderLicenseUI(true);
        if (!silent) toast('Pro activated! 365 days of access unlocked.', 'success');
        // Guard: a server edge case with an already-past expiresAt must not
        // leave a live flag lying around — downgrade + renewal modal instead.
        if (Date.now() > expiresAt) { checkLicenseExpiry(true); return false; }
        return true;
      }
      // Server says invalid -> revoke Pro immediately
      STATE.pro = false;
      STATE.proExpiresAt = null;
      STATE.licenseExpired = false;
      STATE.engine = null;
      try { localStorage.removeItem(LS.key); localStorage.removeItem(LS.expiresAt); localStorage.removeItem(LS.activatedAt); } catch (_) {}
      renderLicenseUI(false);
      if (STATE.playing) pausePlayback();
      if (!silent) toast('Invalid or expired license key.', 'error');
      return false;
    } catch (err) {
      // Network error -> revoke Pro (server unreachable = cannot confirm license)
      STATE.pro = false;
      STATE.proExpiresAt = null;
      STATE.licenseExpired = false;
      STATE.engine = null;
      try { localStorage.removeItem(LS.key); localStorage.removeItem(LS.expiresAt); localStorage.removeItem(LS.activatedAt); } catch (_) {}
      renderLicenseUI(false);
      if (STATE.playing) pausePlayback();
      if (!silent) toast('Verification service unreachable.', 'error');
      return false;
    } finally {
      STATE.verifying = false;
      // Footer/entry state follows license status on every outcome — the
      // Buy Pro entry is always visible with a fixed label.
      updateFooter();
    }
  }

  async function bootVerify() {
    let savedKey = null;
    try { savedKey = localStorage.getItem(LS.key); } catch (_) {}
    // Multi-device: a license activated on another device follows the user via
    // Chrome Sync — pull it in when this device's local storage is empty.
    if (!savedKey && hasChromeStorage() && chrome.storage && chrome.storage.sync) {
      try {
        const synced = await new Promise((resolve) => {
          try { chrome.storage.sync.get([LS.key], (v) => resolve(v || {})); } catch (_) { resolve({}); }
        });
        if (synced && synced[LS.key]) {
          savedKey = synced[LS.key];
          try { localStorage.setItem(LS.key, savedKey); } catch (_) {}
        }
      } catch (_) {}
    }
    const anyKey = savedKey || CONFIG.apiKey;
    if (anyKey) {
      applyLicense(anyKey, { silent: true });
    }
    // Boot-time expiry enforcement: an already-past 365-day window downgrades
    // Pro and reopens the renewal modal on open.
    if (licenseExpiredNow()) {
      checkLicenseExpiry(true);
      toast('Pro license expired. Renew for another 365 days.', 'error');
    }
  }

  /* ==========================================================================
   * 5b) 3-DAY FRICTIONLESS TRIAL
   * ======================================================================== */

  /** Licensed Pro OR within the 72h trial window → sound is unlocked. */
  function hasAccess() {
    // Real-time 365-day gate: the instant the license window passes, Pro is
    // downgraded (storage updated) so every feature trigger hits the paywall.
    if (licenseExpiredNow()) {
      if (checkLicenseExpiry(false)) toast('Pro license expired. Renew for another 365 days.', 'error');
    }
    return STATE.pro || trialActive();
  }
  function trialActive() {
    return !!(STATE.trialStart && (Date.now() - STATE.trialStart) < TRIAL_MS);
  }
  function trialEndAt() {
    return STATE.trialStart ? STATE.trialStart + TRIAL_MS : null;
  }
  function trialRemainingMs() {
    const e = trialEndAt();
    return e ? Math.max(0, e - Date.now()) : 0;
  }
  /** Hungarian-style compact countdown for the footer badge. */
  function fmtTrialRemaining() {
    const h = Math.max(1, Math.ceil(trialRemainingMs() / 3600000));
    return h >= 24 ? Math.floor(h / 24) + ' g\u00fcn' : h + ' saat';
  }

  /** Whole days of PRO access remaining (null = unlimited / no expiry). */
  function proDaysLeft() {
    if (!STATE.proExpiresAt) return null;
    return Math.max(0, Math.ceil((STATE.proExpiresAt - Date.now()) / 86400000));
  }

  /** True exactly when a PRO license has passed its 365-day window. */
  function licenseExpiredNow() {
    return !!(STATE.pro && STATE.proExpiresAt && Date.now() > STATE.proExpiresAt);
  }

  /** Enforce license expiry: downgrade to restricted mode, update storage and —
   *  when asked — reopen the "License Required — Renew for 365 Days" modal. */
  function checkLicenseExpiry(openRenewal) {
    if (!licenseExpiredNow()) return false;
    STATE.pro = false;
    STATE.proExpiresAt = null;
    STATE.licenseExpired = true;
    try {
      localStorage.setItem(LS.isPro, 'false');
      localStorage.setItem(LS.licenseType, 'pro');
      localStorage.setItem(LS.licenseExpired, 'true');
    } catch (_) {}
    if (hasChromeStorage()) {
      const payload = { isPro: false, licenseExpired: true, licenseType: 'pro' };
      try { chrome.storage.local.set(payload); } catch (_) {}
      try { if (chrome.storage && chrome.storage.sync) chrome.storage.sync.set(payload); } catch (_) {}
    }
    if (STATE.playing) pausePlayback();
    renderLicenseUI(false);
    updateFooter();
    if (openRenewal) { updateRenewalModal(); openUpsell(); }
    return true;
  }

  /** Boot: restore persisted volumes + stamp the trial start on first run. */
  async function bootstrapState() {
    try {
      const saved = await storageGet([LS.trialStart, LS.volBinaural, LS.volAmbient]);
      let ts = Number(saved && saved[LS.trialStart]) || 0;
      if (!ts) {
        ts = Date.now();
        storageSet(LS.trialStart, String(ts));
      }
      STATE.trialStart = ts;
      const present = (v) => v != null && v !== '';
      let vb = Number(saved && saved[LS.volBinaural]);
      if (present(saved && saved[LS.volBinaural]) && Number.isFinite(vb) && vb >= 0 && vb <= 2) STATE.volBinaural = vb;
      let va = Number(saved && saved[LS.volAmbient]);
      if (present(saved && saved[LS.volAmbient]) && Number.isFinite(va) && va >= 0 && va <= 1) STATE.volAmbient = va;
    } catch (_) {}
    if (STATE.nodes && STATE.audioCtx) applyEngineVolumes();
    updateFooter();
  }

  /** Called on a timer + tab re-focus: lock the engine the moment a live
   *  trial window ends (crash-proof even for a session started before expiry). */
  function trialWatchdog() {
    if (STATE.pro) { updateFooter(); return; }
    if (trialActive()) { updateFooter(); return; }
    if (!STATE.trialStart) return;   // window not stamped yet — nothing to enforce
    if (STATE.playing) pausePlayback();
    if (STATE.activeAmbients.size) applyAmbients(new Set());
    updateFooter();
    openUpsell();
    toast('3-day trial ended. Activate Pro to keep listening.', 'error');
  }

  /** Same timer, license side: the moment the 365-day window passes while the
   *  widget is open, Pro is dropped, storage is flagged and the renew modal
   *  reopens — without needing a reload. */
  function licenseWatchdog() {
    if (!licenseExpiredNow()) return;
    checkLicenseExpiry(true);
    toast('Pro license expired. Renew for another 365 days.', 'error');
    updatePlayingUI();
  }

  /* ==========================================================================
   * 6) PRO PURCHASE — DIRECT BTC (no middleman)
   * ======================================================================== */
  function buyPro() { openUpsell(); }

  async function copyBtcAddress() {
    const addr = CONFIG.btcAddress;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(addr);
        toast('BTC address copied.', 'success');
        return;
      }
      throw new Error('clipboard unavailable');
    } catch (_) {
      toast('Address: ' + addr, 'info');
    }
  }

  /** Bitcoin TXID: 64 hex characters */
  const TXID_RE = /^[0-9a-f]{64}$/;

  /**
   * Automatic on-chain verification: sends the TXID to the worker; the payment
   * is checked via mempool.space. On success, the returned license key is
   * written to localStorage, Pro gets activated, and the modal closes.
   */
  async function verifyTxPayment(txid) {
    let res;
    try {
      res = await fetch(CONFIG.endpoint + '/api/verify-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: txid, domain: location.host }),
      });
    } catch (_) {
      toast('Could not reach the server. Please try again.', 'error');
      return false;
    }

    let data = {};
    try { data = await res.json(); } catch (_) { /* swallow when body isn't JSON */ }

    if (res.ok && data.valid) {
      // Automatic activation: save key → unlock Pro → close modal
      STATE.pro = true;
      STATE.proExpiresAt = data.expiresAt || null;
      STATE.engine = decodeEngineToken(data.engine);
      try {
        localStorage.setItem(LS.key, String(data.licenseKey));
        localStorage.setItem(LS.verifiedAt, String(Date.now()));
      } catch (_) { /* private mode */ }
      renderLicenseUI(true);
      updateFooter();
      closeUpsell();
      toast('Payment verified! Pro activated.', 'success');
      return true;
    }

    toast((data && (data.message || data.error)) || ('Verification failed (' + res.status + ')'), 'error');
    return false;
  }

  async function onActivateClick() {
    const raw = (els.licInput.value || '').trim();

    // 1) Is it a TXID? (64 hex) → automatic on-chain verification
    if (TXID_RE.test(raw.toLowerCase())) {
      els.activate.disabled = true;
      try { await verifyTxPayment(raw.toLowerCase()); } finally { els.activate.disabled = false; }
      return;
    }

    // 2) Otherwise, license key flow
    const key = raw.toUpperCase();
    if (!/^[A-Z0-9-]{6,64}$/.test(key)) { toast('Invalid TXID or license key format.', 'error'); return; }
    els.activate.disabled = true;
    await applyLicense(key);
    els.activate.disabled = false;
  }

  /**
   * Fetch live pricing from /api/get-btc-rate and update the modal display.
   * Shows: "Yıllık Lisans: 12 € (~0.00018 BTC)" — or a fallback on error.
   */
  async function fetchPricing() {
    let data;
    try {
      const res = await fetch(CONFIG.endpoint + '/api/get-btc-rate');
      if (res.ok) data = await res.json();
    } catch (_) { /* offline or error — use fallback */ }

    if (data && data.ok) {
      els.btcPrice.textContent = 'Y\u0131ll\u0131k Lisans: ' + data.eur + ' \u20AC (~' + data.btcAmount + ' BTC)';
    } else {
      // Fallback: show static estimate
      els.btcPrice.textContent = 'Y\u0131ll\u0131k Lisans: 12 \u20AC (~' + CONFIG.priceBtc + ')';
    }
  }

  /* ==========================================================================
   * 7) CUSTOM FREQUENCY RANGE (0–1000 Hz)
   * ======================================================================== */
  const clampHz = (v) => Math.min(1000, Math.max(0, Math.round(Number(v) || 0)));
  function normalizePair(a, b) {
    let l = clampHz(a), r = clampHz(b);
    if (l > r) { const tmp = l; l = r; r = tmp; }
    return { left: l, right: r };
  }

  function enterCustomRange(pair) {
    if (!hasAccess()) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      return;
    }
    STATE.custom = normalizePair(pair.left, pair.right);
    try { localStorage.setItem(LS.customFreq, JSON.stringify(STATE.custom)); } catch (_) {}
    syncFrangeUI();
    applyFrequencies();
    updateBeatInfo();
  }

  function clearFrequencyRange() {
    STATE.custom = null;
    try { localStorage.removeItem(LS.customFreq); } catch (_) {}
    syncFrangeUI();
    applyFrequencies();
    updateBeatInfo();
  }

  function onFrNumCommit(which) {
    const other = which === 'l'
      ? activeFreqs().right
      : activeFreqs().left;
    const mine = clampHz(which === 'l' ? els.frNumL.value : els.frNumR.value);
    const pair = which === 'l' ? { left: mine, right: other } : { left: other, right: mine };
    enterCustomRange(pair);
  }

  function onFrSliderInput(which) {
    const raw = Number(which === 'l' ? els.frSlL.value : els.frSlR.value);
    const clamped = clampHz(raw);
    if (clamped !== raw) {
      if (which === 'l') els.frSlL.value = String(clamped);
      else els.frSlR.value = String(clamped);
    }
    const other = which === 'l' ? activeFreqs().right : activeFreqs().left;
    const pair = which === 'l' ? { left: clamped, right: other } : { left: other, right: clamped };
    enterCustomRange(pair);
  }

  /** Sync the input UI with the active frequencies */
  function syncFrangeUI() {
    const f = activeFreqs();
    els.frSlL.value = String(f.left);
    els.frSlR.value = String(f.right);
    els.frNumL.value = String(f.left);
    els.frNumR.value = String(f.right);
    // Equal-phase tones (Solfeggio carriers) are pure — there is no beat.
    els.frBeat.textContent = f.left === f.right
      ? 'Beat: 0 Hz (Pure Tone)'
      : 'Beat: \u0394 ' + Math.abs(f.right - f.left) + ' Hz';
  }

  function setFrequencyRange(left, right) { enterCustomRange(normalizePair(left, right)); }

  /* ==========================================================================
   * 7b) SMART POMODORO — 25 min focus / 5 min break
   * ======================================================================== */
  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function clearPomodoroInterval() {
    const p = STATE.pomodoro;
    if (p.interval !== null) {
      try { clearInterval(p.interval); } catch (_) {}
      p.interval = null;
    }
  }

  function updatePomodoroUI() {
    if (!els.pomoTime || !els.pomoState || !els.pomoStart) return;
    const p = STATE.pomodoro;
    const total = p.state === 'break' ? POMODORO_BREAK_MS : POMODORO_FOCUS_MS;
    els.pomoTime.textContent = fmtClock(p.running && p.remainingMs > 0 ? p.remainingMs : total);
    els.pomoState.textContent = !p.running ? 'Ready' : (p.state === 'focus' ? 'Focus' : 'Break');
    els.pomoStart.textContent = p.running ? 'Reset' : 'Start';
  }

  function pomodoroStart() {
    if (!STATE.pro) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      return false;
    }
    const p = STATE.pomodoro;
    clearPomodoroInterval();
    p.running = true;
    p.state = 'focus';
    p.remainingMs = POMODORO_FOCUS_MS;
    p.interval = setInterval(pomodoroTick, 1000);
    if (!STATE.playing) startPlayback();
    updatePomodoroUI();
    toast('Pomodoro started \u2014 25 min focus. Neural frequency engaged.', 'success');
    return true;
  }

  function pomodoroReset() {
    const p = STATE.pomodoro;
    clearPomodoroInterval();
    p.running = false;
    p.state = 'idle';
    p.remainingMs = POMODORO_FOCUS_MS;
    if (STATE.playing) pausePlayback();
    if (STATE.activeAmbients.size) setAmbient('off');
    updatePomodoroUI();
    toast('Pomodoro stopped.', 'info');
    return true;
  }

  function pomodoroTick() {
    const p = STATE.pomodoro;
    if (!p.running) return;
    p.remainingMs -= 1000;
    if (p.remainingMs > 0) { updatePomodoroUI(); return; }
    if (p.state === 'focus') {
      p.state = 'break';
      p.remainingMs = POMODORO_BREAK_MS;
      p.completed++;
      if (STATE.playing) pausePlayback();
      if (STATE.activeAmbients.size) setAmbient('off');
      playChime();   // gong: focus session complete
      toast('\u2705 Focus session complete! 5 min break.', 'success');
    } else {
      p.state = 'focus';
      p.remainingMs = POMODORO_FOCUS_MS;
      if (!STATE.playing) startPlayback();
      playChime();   // gong: break complete, new focus begins
      toast('\u26A1 Break over. New 25 min focus started.', 'success');
    }
    updatePomodoroUI();
  }

  /* ==========================================================================
   * 7e) AMBIENT MIXER — pink / brown / rain / white noise under the carrier
   * ======================================================================== */
  function fillPink(data, sr) {
    // Paul Kellet coupled-form filters — spectrally flat pink noise.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      data[i] = out * 0.11;
      // Tampon sonradan ×4 yükseltilir; tepe noktalarını zincirin sonundaki
      // masterDynamicsCompressor sınırlar (bkz. makeNoiseBuffer → master gain).
    }
  }

  function makeNoiseBuffer(ctx, kind) {
    // White noise runs a full 5-second loop (unsealed tail); the shaped layers
    // need a short cached loop because they are spectrally colored anyway.
    const isWhite = kind === 'white';
    const len = Math.max(48000, Math.floor(ctx.sampleRate * (isWhite ? 5 : 2)) || 48000);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (kind === 'pink') {
      fillPink(data, ctx.sampleRate);
      // KLANG üstünde ham veriyi ×4 yükselt (kompresör tepeleri sınırlar).
      for (let i = 0; i < data.length; i++) data[i] *= 4.0;
    } else if (kind === 'rain') {
      // Rain = pink spectrum + light amplitude modulation so the hiss gently
      // "beats" like light rainfall. A runtime low-pass (~1200 Hz) then turns
      // the hiss into precipitation (see buildAmbientLayer).
      fillPink(data, ctx.sampleRate);
      for (let i = 0; i < data.length; i++) {
        const mod = 1.0 + RAIN_AM_DEPTH * Math.sin(2 * Math.PI * RAIN_AM_HZ * i / buffer.sampleRate);
        data[i] *= mod * 5.0;   // ×5 rain boost; kompresör tepeleri sınırlar
      }
    } else if (kind === 'brown') {
      // Brown (red/random-walk) noise: integrate white → 6 dB/octave roll-off,
      // the deepest, warmest of the ambient family.
      // output[i] = ((lastOut + (0.02 * white)) / 1.02) * 6.0
      let lastOut = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + BROWN_SLOPE * white) / (1 + BROWN_SLOPE);
        data[i] = lastOut * BROWN_SLOPE_GAIN;   // ×6 brown boost; kompresör tepeleri sınırlar
      }
    } else {
      // White noise: ×4 boost; kompresör tepeleri sınırlar.
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 4.0;
    }
    return buffer;
  }

  /** Cached noise buffers — Ctrl+layer toggles never regenerate the PCM data. */
  function noiseBuffer(ctx, kind) {
    if (STATE.ambBuffers[kind]) return STATE.ambBuffers[kind];
    const buf = makeNoiseBuffer(ctx, kind);
    STATE.ambBuffers[kind] = buf;
    return buf;
  }

  function layerGain(kind) {
    return STATE.nodes && STATE.nodes.ambGains ? STATE.nodes.ambGains[kind] : null;
  }

  /** Start one noise layer. The audio context is guaranteed to exist. */
  function buildAmbientLayer(kind) {
    const ctx = STATE.audioCtx;
    if (!ctx || !layerGain(kind)) return;
    try {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx, kind);
      src.loop = true;
      let head = src;
      if (kind === 'pink') {
        // Pink: ×3 makeup compensates the shaping/spectral energy loss. The
        // makeup node is static (created once) — the teardown skips it.
        const makeup = STATE.nodes.pinkMakeup;
        if (makeup) { src.connect(makeup); head = null; }
      } else if (kind === 'brown') {
        // Brown: runs through the static deep-bass booster before its layer
        // gain, so the sub-bass is unmistakably present in the mix.
        const bass = STATE.nodes.brownBass;
        if (bass) { src.connect(bass); head = null; }
      } else if (kind === 'rain' && ctx.createBiquadFilter) {
        // Rain: BiquadFilter low-pass ~1200 Hz softens the pink+AM hiss into
        // precipitation, so the droplet shimmer stays clearly audible.
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1200;
        try { filter.Q.value = RAIN_FILTER_Q; } catch (_) {}
        src.connect(filter);
        head = filter;
      }
      // Pink/brown/rain route via a filter/makeup/bass stage; white connects
      // directly so its untouched spectrum reaches the layer gain.
      if (head) head.connect(layerGain(kind));
      src.start();
      STATE.nodes.amb[kind] = { src, head };
    } catch (_) { /* audio soft-fail */ }
  }

  /** Fully stop + disconnect one layer so no AudioNode stays routed. */
  function tearDownAmbientLayer(kind) {
    const entry = STATE.nodes && STATE.nodes.amb ? STATE.nodes.amb[kind] : null;
    if (!entry) return;
    try {
      if (entry.src) {
        entry.src.stop();
        if (entry.src.disconnect) entry.src.disconnect();
      }
    } catch (_) {}
    try {
      if (entry.head && entry.head !== entry.src && entry.head.disconnect) entry.head.disconnect();
    } catch (_) {}
    delete STATE.nodes.amb[kind];
  }

  /** AudioContext.resume() — Chrome blocks autoplay until a user gesture, so the
   *  first layer click on a freshly suspended context must kick it back to life. */
  function resumeAudio() {
    if (!STATE.audioCtx) return;
    if (STATE.audioCtx.state === 'suspended') {
      try {
        const p = STATE.audioCtx.resume();
        if (p && typeof p.then === 'function') p.catch(() => {});
      } catch (_) {}
    }
  }

  function applyAmbients(next) {
    STATE.activeAmbients = next || new Set();
    ensureContext();
    if (!STATE.audioCtx || !STATE.nodes || !STATE.nodes.ambGains || !STATE.nodes.amb) { updateAmbientUI(); return; }
    for (const kind of AMBIENT_KINDS) {
      const active = STATE.activeAmbients.has(kind);
      if (active && !STATE.nodes.amb[kind]) buildAmbientLayer(kind);
      else if (!active && STATE.nodes.amb[kind]) tearDownAmbientLayer(kind);
      // The layer gain is the on/off valve: sources stay looping, so each click
      // snaps the layer gain to its staged level (or 0) instantly and the engine
      // never rebuilds the whole loop for a mute.
      try {
        const g = layerGain(kind).gain;
        const t = STATE.audioCtx ? STATE.audioCtx.currentTime : 0;
        g.setValueAtTime(active ? (AMBIENT_LEVELS[kind] || 0) : 0, t);
      } catch (_) {}
    }
    // Engaging any layer starts the engine so a pure ambient mix (no pomodoro)
    // still becomes audible under the binaural carrier.
    if (STATE.activeAmbients.size > 0) {
      resumeAudio();
      if (!STATE.playing) startPlayback();
    }
    updateAmbientUI();
  }

  /** Single-select convenience: setAmbient('off') clears ALL active layers. */
  function setAmbient(kind) {
    if (!kind || !(kind in AMBIENTS)) kind = 'off';
    if (!hasAccess()) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      updateAmbientUI();
      return;
    }
    applyAmbients(kind === 'off' ? new Set() : new Set([kind]));
  }

  /** Multi-layer toggle: 'off' closes EVERY layer; any other kind flips one. */
  function toggleAmbient(kind) {
    if (!kind || !(kind in AMBIENTS)) kind = 'off';
    if (!hasAccess()) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      updateAmbientUI();
      return;
    }
    const next = new Set(STATE.activeAmbients);
    if (kind === 'off') next.clear();
    else if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    applyAmbients(next);
  }

  function updateAmbientUI() {
    if (!els.ambRow) return;
    try {
      const btns = els.ambRow.querySelectorAll ? els.ambRow.querySelectorAll('button[data-amb]') : [];
      Array.prototype.forEach.call(btns, (b) => {
        const k = b.dataset.amb;
        // 'Off' is the only active button when NO layer is running; any active
        // layer lights only its own button (multiple can be lit at once).
        const active = k === 'off'
          ? STATE.activeAmbients.size === 0
          : STATE.activeAmbients.has(k);
        b.classList.toggle('active', active);
      });
    } catch (_) {}
  }

  /* ==========================================================================
   * 8) VIEW UPDATERS
   * ======================================================================== */
  /** Keep visibility in sync via both the `hidden` attribute and the 'hidden' class */
  function setHidden(el, hide) {
    if (!el) return;
    el.hidden = !!hide;
    try {
      if (hide) el.classList.add('hidden');
      else el.classList.remove('hidden');
    } catch (_) {}
  }

  function updateBeatInfo() {
    const f = activeFreqs();
    if (STATE.custom) {
      els.beatMain.textContent = '\u0394 ' + Math.abs(f.right - f.left) + ' Hz \u00B7 Custom';
    } else {
      const m = MODES[STATE.mode];
      if (f.left === f.right) {
        // Solfeggio tones are equal-phase monaural — no beat, show the carrier.
        els.beatMain.textContent = f.left + ' Hz \u00B7 ' + m.label + ' \u2014 ' + m.desc;
      } else {
        els.beatMain.textContent = '\u0394 ' + m.hz + ' Hz \u00B7 ' + m.label + ' \u2014 ' + m.desc;
      }
    }
    els.beatSub.textContent = 'Left ' + f.left + ' Hz \u00B7 Right ' + f.right + ' Hz';
  }

  function updateFooter() {
    if (STATE.pro) {
      const days = proDaysLeft();
      els.quota.textContent = days == null ? 'PRO \u00B7 Unlimited' : 'PRO \u00B7 ' + days + ' days left';
    } else if (trialActive()) {
      // Living countdown badge — the trial is the default every user sees.
      els.quota.textContent = 'Deneme: ' + fmtTrialRemaining() + ' kald\u0131';
    } else {
      els.quota.textContent = 'License required';
    }
    // The Buy Pro button is PERMANENTLY visible in EVERY license state — its
    // label never changes. Clicking it always opens the license/payment modal,
    // where Pro users see their status/key entry too (openUpsell renders
    // pricing; applyLicense handles an already-live key).
    els.buy.textContent = 'Buy Pro';
    setHidden(els.buy, false);
  }

  function updatePlayingUI() {
    setHidden(els.iconPlay, STATE.playing);
    setHidden(els.iconPause, !STATE.playing);
    els.play.setAttribute('aria-label', STATE.playing ? 'Pause' : 'Play');
    try { els.fab.classList.toggle('playing', STATE.playing); } catch (_) {}
  }

  function renderLicenseUI(active) {
    setHidden(els.chip, !active);   /* PRO badge */
    try { els.dot.classList.toggle('on', !!active); } catch (_) {}
  }

  /** Retitle the modal for an expired license → "License Required — Renew for
   *  365 Days"; the generic title is kept for trial/first-activation. */
  function updateRenewalModal() {
    if (STATE.licenseExpired && els.mTitle) {
      els.mTitle.textContent = 'License Required \u2014 Renew for 365 Days';
    }
  }

  function openUpsell() {
    if (STATE.licenseExpired && els.mTitle) {
      els.mTitle.textContent = 'License Required \u2014 Renew for 365 Days';
    }
    els.btcAddr.textContent = CONFIG.btcAddress;
    // Show a placeholder while fetching live pricing
    els.btcPrice.textContent = '12 \u20AC \u00B7 loading\u2026';
    try {
      els.btcQr.src = 'https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=' +
        encodeURIComponent('bitcoin:' + CONFIG.btcAddress);
    } catch (_) {}
    setHidden(els.overlay, false);
    // Fetch live pricing from the worker
    fetchPricing();
  }
  function closeUpsell() { setHidden(els.overlay, true); }

  /* ---- FAB drag helpers ---- */
  function clampFab(x, y) {
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    return {
      x: Math.max(0, Math.min(x, vw - FAB_SIZE)),
      y: Math.max(0, Math.min(y, vh - FAB_SIZE)),
    };
  }
  function saveFabPos(x, y) { try { localStorage.setItem(LS_FAB_POS, JSON.stringify({ x: Math.round(x), y: Math.round(y) })); } catch (_) {} }
  function loadFabPos() { try { return JSON.parse(localStorage.getItem(LS_FAB_POS)); } catch (_) { return null; } }
  function updatePanelPos() {
    if (!els.panel || !els.fab) return;
    const fb = els.fab.getBoundingClientRect();
    const pw = els.panel.offsetWidth || 280;
    const ph = els.panel.offsetHeight || 300;
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    const vh = window.innerHeight || document.documentElement.clientHeight || 640;
    let px = fb.left + fb.width / 2 - pw / 2;
    let py = fb.top - ph - 12;
    if (py < 8) py = fb.bottom + 12;
    if (px < 8) px = 8;
    if (px + pw > vw - 8) px = vw - pw - 8;
    if (py + ph > vh - 8) py = vh - ph - 8;
    els.panel.style.left = px + 'px';
    els.panel.style.top = py + 'px';
    els.panel.style.right = 'auto';
    els.panel.style.bottom = 'auto';
  }

  function togglePanel(force) {
    const want = typeof force === 'boolean' ? force : els.panel.hidden;
    setHidden(els.panel, !want);
    if (!els.panel.hidden) updatePanelPos();
  }

  let toastTimer = null;
  function toast(msg, type) {
    els.toast.textContent = msg;
    els.toast.className = 'toast ' + (type || 'info');
    setHidden(els.toast, false);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setHidden(els.toast, true), 3600);
  }

  /* ==========================================================================
   * 9) SHADOW DOM TEMPLATE  (new IDs + test-compatible classes)
   * ======================================================================== */
  function mountUI() {
    if (typeof document === 'undefined' || !document.createElement || !document.body) return;

    const host = document.createElement('div');
    host.id = 'focus-bot-root';
    if (host.style) host.style.cssText = 'display:inline-block;vertical-align:top';

    let root = null;
    if (typeof host.attachShadow === 'function') {
      root = host.attachShadow({ mode: 'open' });
    } else {
      root = host; // legacy browser: no shadow root
    }

    root.innerHTML =
'<style>' +
  ':host{display:inline-block}' +
  '*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}' +
  '.hidden{display:none!important}' +

  /* ---- FAB ---- */
  '.fab{position:fixed;right:22px;bottom:22px;z-index:2147483647;width:56px;height:56px;min-width:48px;min-height:48px;border-radius:50%;' +
    'border:1px solid rgba(255,255,255,.18);cursor:grab;display:flex;align-items:center;justify-content:center;' +
    'color:#fff;background:linear-gradient(135deg,#38bdf8,#818cf8);touch-action:none;-webkit-tap-highlight-color:transparent;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.35);transition:transform .18s ease}' +
  '.fab:hover{transform:scale(1.06)}' +
  '.fab.dragging{cursor:grabbing!important;transition:none!important;transform:scale(1.08);' +
    'user-select:none;-webkit-user-select:none}' +
  '.fab.playing{background:linear-gradient(135deg,#34d399,#38bdf8)}' +
  '#icon-play,#icon-pause{pointer-events:none}' +

  /* ---- Panel ---- */
  '.panel{position:fixed;right:22px;bottom:90px;z-index:2147483647;width:280px;max-width:calc(100vw - 24px);' +
    'border-radius:22px;background:rgba(24,26,34,.82);border:1px solid rgba(255,255,255,.12);color:#ebebf5;' +
    '-webkit-backdrop-filter:blur(30px) saturate(170%);backdrop-filter:blur(30px) saturate(170%);' +
    'box-shadow:0 12px 28px rgba(0,0,0,.42),0 32px 90px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.09);' +
    'display:flex;flex-direction:column;max-height:min(52vh,340px);max-height:min(52dvh,340px);overflow:hidden;' +
    'animation:fb-pop .34s cubic-bezier(.32,1.35,.5,1)}' +
  '@keyframes fb-pop{from{opacity:0;transform:translateY(10px) scale(.94)}to{opacity:1;transform:none}}' +
  '.ios-header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px 9px;' +
    'background:rgba(255,255,255,.04);border-bottom:.5px solid rgba(255,255,255,.08)}' +
  '.ios-header-left{display:flex;align-items:center;gap:8px;min-width:0}' +
  '.fb-brand{font-size:13px;font-weight:600;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.dot{flex:none;width:7px;height:7px;border-radius:50%;background:rgba(120,120,128,.5);transition:background .3s,box-shadow .3s}' +
  '.dot.on{background:#34d399;box-shadow:0 0 8px rgba(52,211,153,.8)}' +
  '.chip{flex:none;font-size:9.5px;font-weight:700;letter-spacing:.8px;color:#06283d;' +
    'background:linear-gradient(90deg,#38bdf8,#818cf8);padding:3px 8px;border-radius:999px}' +
  '.close{flex:none;width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:var(--fill,rgba(120,120,128,.24));' +
    'border:0;color:#98989f;font-size:14px;line-height:1;cursor:pointer;border-radius:50%}' +
  '.close:hover{color:#fff;background:rgba(120,120,128,.38)}' +
  '.panel-body{flex:1;min-height:0;padding:10px 12px 8px;overflow-y:auto;overflow-x:hidden;' +
    '-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;' +
    'scrollbar-color:rgba(255,255,255,.2) transparent}' +
  '.panel-body::-webkit-scrollbar{width:4px}' +
  '.panel-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:999px}' +
  '.beat-card{text-align:center;margin-bottom:9px;padding:8px 10px;background:rgba(120,120,128,.22);border-radius:14px}' +
  '.beat-main{font-size:14px;font-weight:600}.beat-sub{font-size:11px;color:#98989f;margin-top:3px;font-variant-numeric:tabular-nums}' +
  '.play-wrap{display:flex;justify-content:center;margin-bottom:9px}' +
  '.play{width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;color:#0b192c;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(135deg,#38bdf8,#818cf8);box-shadow:0 8px 22px rgba(56,189,248,.4);transition:transform .18s ease}' +
  '#icon-play,#icon-pause,.play-icon,.p-icon,.play svg,.play path{fill:#0b192c !important;color:#0b192c !important;stroke:#0b192c !important}' +
  '.play:hover{transform:scale(1.05)}.play:active{transform:scale(.92)}' +
  '.modes{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;margin-bottom:5px;background:rgba(120,120,128,.22);border-radius:12px;padding:3px}' +
  '.modes.modes-sol{grid-template-columns:repeat(5,1fr);margin-bottom:9px;background:rgba(120,120,128,.14)}' +
  '.modes button{border:0;background:transparent;color:#98989f;border-radius:10px;padding:6px 2px;cursor:pointer;' +
    'font-size:11.5px;font-weight:600;display:flex;flex-direction:column;gap:1px;align-items:center}' +
  '.modes button small{font-weight:500;font-size:9px;opacity:.75}' +
  '.modes button.active{color:#fff;background:rgba(255,255,255,.16);box-shadow:0 2px 8px rgba(0,0,0,.3)}' +
  '.frange{margin-bottom:9px;padding:8px 10px;border-radius:14px;background:rgba(120,120,128,.22)}' +
  '.frange-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}' +
  '.frange-beat{font-size:11px;font-weight:600;color:#38bdf8;font-variant-numeric:tabular-nums}' +
  '.frange-reset{flex:none;width:20px;height:20px;border-radius:50%;border:0;background:rgba(120,120,128,.32);color:#98989f;' +
    'font-size:11px;line-height:1;cursor:pointer}' +
  '.frange-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;min-width:0}' +
  '.frange-row:last-child{margin-bottom:0}' +
  '.frange-tag{flex:none;width:16px;font-size:11px;color:#98989f}' +
  '.fr-sl{-webkit-appearance:none;appearance:none;min-width:0;flex:1;height:3px;border-radius:999px;' +
    'background:linear-gradient(90deg,#38bdf8,#818cf8);outline:none;cursor:pointer}' +
  '.fr-sl::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;cursor:pointer;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.4)}' +
  '.fr-num{flex:none;width:48px;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.14);color:#ebebf5;' +
    'border-radius:8px;padding:4px 2px;font-size:11.5px;text-align:center;outline:none;font-variant-numeric:tabular-nums;-moz-appearance:textfield}' +
  '.vol{display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:0 2px;color:#98989f}' +
  '.vol .vol-tag{flex:none;width:92px;font-size:10px;font-weight:600;color:#98989f;text-align:right}' +
  '.vol input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:3px;border-radius:999px;' +
    'background:linear-gradient(90deg,#38bdf8,#818cf8);outline:none;cursor:pointer}' +
  '.vol input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;' +
    'cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4)}' +

  /* ---- Smart Pomodoro ---- */
  '.pomo-box{margin-bottom:9px;padding:8px 10px;border-radius:14px;background:rgba(120,120,128,.22)}' +
  '.pomo-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}' +
  '.pomo-title{font-size:11px;font-weight:600;color:#98989f}' +
  '.pomo-state{font-size:10px;font-weight:700;letter-spacing:.6px;color:#34d399;background:rgba(52,211,153,.12);padding:2px 8px;border-radius:999px}' +
  '.pomo-row{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
  '.pomo-time{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;color:#ebebf5;letter-spacing:.5px}' +
  '.pomo-start{flex:none;border:0;border-radius:999px;padding:6px 14px;cursor:pointer;font-size:11px;font-weight:700;' +
    'background:linear-gradient(135deg,#34d399,#38bdf8);color:#06283d}' +
  '.pomo-start:hover{filter:brightness(1.1)}' +

  /* ---- Ambient mixer ---- */
  '.amb-row{margin-bottom:9px;padding:8px 10px;border-radius:14px;background:rgba(120,120,128,.22)}' +
  '.amb-head{font-size:11px;font-weight:600;color:#98989f;margin-bottom:6px}' +
  '.amb{display:grid;grid-template-columns:repeat(5,1fr);gap:3px;background:rgba(120,120,128,.22);border-radius:12px;padding:3px}' +
  '.amb button{border:0;background:transparent;color:#98989f;border-radius:10px;padding:6px 2px;cursor:pointer;' +
    'font-size:10.5px;font-weight:600}' +
  '.amb button.active{color:#fff;background:rgba(255,255,255,.16);box-shadow:0 2px 8px rgba(0,0,0,.3)}' +

  '.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;' +
    'border-top:.5px solid rgba(255,255,255,.1)}' +
  '.quota{font-size:11px;color:#98989f;font-variant-numeric:tabular-nums}' +
  '.buy{border:0;background:rgba(56,189,248,.16);color:#38bdf8;font-size:11.5px;font-weight:600;padding:7px 12px;' +
    'border-radius:999px;cursor:pointer}' +
  '.buy:hover{background:rgba(56,189,248,.26)}' +

  '.btn-buy-pro{background:linear-gradient(135deg,#4ba3ff 0%,#6385ff 50%,#8077ff 100%) !important;' +
    'color:#0b192c !important;font-weight:800 !important;font-size:11px !important;letter-spacing:.5px !important;' +
    'border:none !important;border-radius:9999px !important;padding:4px 14px !important;cursor:pointer;' +
    'box-shadow:0 0 8px rgba(75,163,255,.4) !important;transition:opacity .15s ease,transform .15s ease}' +
  '.btn-buy-pro:hover{opacity:.9;transform:scale(1.03)}' +
  '.btn-buy-pro:active{transform:scale(1.03);opacity:1}' +

  /* ---- Overlay / Modal ---- */
  '.overlay{position:fixed;inset:0;z-index:9999999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;' +
    'padding:20px;box-sizing:border-box;overflow-y:auto;-webkit-overflow-scrolling:touch;' +
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
  '.modal{position:relative;width:min(96vw,340px);max-width:340px;max-height:90vh;overflow-y:auto;margin:auto;' +
    'background:rgba(30,32,40,.88);border:1px solid rgba(255,255,255,.12);border-radius:22px;' +
    'padding:32px 24px 24px;text-align:center;color:#ebebf5;box-shadow:0 24px 80px rgba(0,0,0,.55);' +
    'animation:fb-pop .34s cubic-bezier(.32,1.35,.5,1)}' +
  '.modal-close{position:absolute !important;top:12px !important;right:12px !important;width:32px;height:32px;border-radius:50%;' +
    'border:1px solid rgba(255,255,255,.2);cursor:pointer;z-index:999999;opacity:1;' +
    'display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;line-height:1;' +
    'color:#fff;background:rgba(255,255,255,.12);' +
    'transition:background .18s,color .18s,transform .18s ease}' +
  '.modal-close:hover{background:rgba(255,255,255,.25);color:#fff;transform:scale(1.05)}' +
  '.modal-close:active{transform:scale(.94)}' +
  '.modal h3{font-size:15.5px;font-weight:600;margin-bottom:8px}' +
  '.modal p{font-size:12.5px;color:#98989f;line-height:1.6;margin-bottom:14px}' +
  '.btc-box{background:rgba(247,147,26,.08);border:1px solid rgba(247,147,26,.35);border-radius:14px;padding:12px;margin-bottom:12px}' +
  '.btc-price{font-size:12px;font-weight:700;color:#f7931a;margin-bottom:8px}' +
  '.btc-qr{display:block;width:120px;height:120px;margin:0 auto 9px;border-radius:10px;background:#fff;padding:6px}' +
  '.btc-addr{display:block;font-size:11px;color:#ebebf5;word-break:break-all;background:rgba(0,0,0,.28);' +
    'border-radius:9px;padding:8px 9px;margin-bottom:9px;font-family:ui-monospace,Menlo,Consolas,monospace}' +
  '.btc-copy{width:100%;border:0;border-radius:10px;padding:9px;cursor:pointer;font-size:12px;font-weight:600;color:#06283d;' +
    'background:linear-gradient(135deg,#f7931a,#fbbf24)}' +
  '.lic{display:flex;flex-direction:column;gap:10px;margin-bottom:10px}' +
  '.lic input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.14);color:#ebebf5;' +
    'border-radius:12px;padding:10px 12px;font-size:12px;font-family:monospace,monospace;outline:none;' +
    'overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
  '.lic input:focus{border-color:#38bdf8}' +
  '.lic button{width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:12px;cursor:pointer;font-size:12px;font-weight:600;' +
    'background:rgba(120,120,128,.28);color:#ebebf5}' +
  '.lic button:hover:not(:disabled){background:rgba(120,120,128,.44)}' +
  '.m-later{background:none;border:0;color:#98989f;font-size:11px;cursor:pointer}' +
  '.m-later:hover{color:#fff}' +

  /* ---- Toast ---- */
  '.toast{position:fixed;right:22px;bottom:158px;z-index:2147483647;max-width:280px;padding:10px 14px;border-radius:14px;' +
    'font-size:12px;line-height:1.5;color:#ebebf5;background:rgba(30,32,40,.85);border:1px solid rgba(255,255,255,.12);' +
    'border-left-width:3px;border-left-color:#38bdf8;box-shadow:0 12px 32px rgba(0,0,0,.5);animation:fb-pop .3s ease}' +
  '.toast.success{border-left-color:#34d399}.toast.error{border-left-color:#f87171}' +

  /* ---- Responsive / touch-friendly (≤ 640px) ---- */
  '@media(max-width:640px){' +
    '.panel{width:calc(100vw - 24px);max-width:480px;right:12px;min-width:0}' +
    '.modes{grid-template-columns:repeat(auto-fit,minmax(80px,1fr))}' +
    '.modes.modes-sol{grid-template-columns:repeat(auto-fit,minmax(80px,1fr))}' +
    '.modes button{min-height:40px}' +
    '.frange-reset{width:28px;height:28px}' +
    '.fr-sl{height:4px}.fr-sl::-webkit-slider-thumb{width:18px;height:18px}' +
    '.vol input[type=range]{min-height:44px;height:44px}.vol input[type=range]::-webkit-slider-thumb{width:18px;height:18px}' +
  '}' +
'</style>' +

'<button id="fb-fab" class="fab" aria-label="Open FocusBot">' +
  '<svg id="icon-play" class="icon-play" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
  '<svg id="icon-pause" class="icon-pause" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' +
'</button>' +

'<section id="fb-panel" class="panel" aria-label="FocusBot control panel">' +
  '<header class="ios-header">' +
    '<div class="ios-header-left">' +
      '<span class="dot" aria-hidden="true"></span>' +
      '<strong class="fb-brand">' + esc(CONFIG.brand) + '</strong>' +
      '<span id="fb-chip" class="chip">PRO</span>' +
    '</div>' +
    '<button type="button" class="close" aria-label="Close panel">&times;</button>' +
  '</header>' +
  '<div class="panel-body">' +
    '<div class="beat-card">' +
      '<div class="beat-main"></div>' +
      '<div class="beat-sub"></div>' +
    '</div>' +
    '<div class="play-wrap">' +
      '<button type="button" id="fb-play-btn" class="play" aria-label="Play / Pause">' +
        '<svg class="p-icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="modes" role="group" aria-label="Binaural wave mode">' +
      '<button type="button" data-mode="beta" class="active">Beta<small>14 Hz</small></button>' +
      '<button type="button" data-mode="alpha">Alpha<small>10 Hz</small></button>' +
      '<button type="button" data-mode="theta">Theta<small>6 Hz</small></button>' +
      '<button type="button" data-mode="delta">Delta<small>2 Hz</small></button>' +
      '<button type="button" data-mode="gamma">Gamma<small>40 Hz</small></button>' +
    '</div>' +
    '<div class="modes modes-sol" role="group" aria-label="Solfeggio tone">' +
      '<button type="button" data-mode="174">174Hz<small>Pain Relief</small></button>' +
      '<button type="button" data-mode="285">285Hz<small>Regeneration</small></button>' +
      '<button type="button" data-mode="396">396Hz<small>Release Fear</small></button>' +
      '<button type="button" data-mode="417">417Hz<small>Facilitate</small></button>' +
      '<button type="button" data-mode="432">432Hz<small>Natural</small></button>' +
      '<button type="button" data-mode="528">528Hz<small>Deep Reset</small></button>' +
      '<button type="button" data-mode="639">639Hz<small>Harmony</small></button>' +
      '<button type="button" data-mode="741">741Hz<small>Problem Solve</small></button>' +
      '<button type="button" data-mode="852">852Hz<small>Intuition</small></button>' +
      '<button type="button" data-mode="963">963Hz<small>Higher Mind</small></button>' +
    '</div>' +
    '<div class="frange">' +
      '<div class="frange-head">' +
        '<span class="frange-beat"></span>' +
        '<button type="button" class="frange-reset" title="Back to selected mode">&#x21BA;</button>' +
      '</div>' +
      '<div class="frange-row">' +
        '<span class="frange-tag">L</span>' +
        '<input type="range" class="fr-sl fr-sl-l" min="0" max="1000" step="1" aria-label="Left frequency slider (Hz)">' +
        '<input type="number" class="fr-num fr-num-l" min="0" max="1000" step="1" inputmode="numeric" aria-label="Left frequency (Hz)">' +
      '</div>' +
      '<div class="frange-row">' +
        '<span class="frange-tag">R</span>' +
        '<input type="range" class="fr-sl fr-sl-r" min="0" max="1000" step="1" aria-label="Right frequency slider (Hz)">' +
        '<input type="number" class="fr-num fr-num-r" min="0" max="1000" step="1" inputmode="numeric" aria-label="Right frequency (Hz)">' +
      '</div>' +
    '</div>' +
    '<label class="vol">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3z"/></svg>' +
      '<input class="vol-range" type="range" min="0" max="100" step="1" value="70" aria-label="Volume">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-.78-3.9-2.5-4v8c1.72-.1 2.5-2.23 2.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>' +
    '</label>' +
    '<label class="vol">' +
      '<span class="vol-tag">Binaural / Tone</span>' +
      '<input class="vol-range vol-bin" type="range" min="0" max="200" step="1" value="100" aria-label="Binaural / Tone volume">' +
    '</label>' +
    '<label class="vol">' +
      '<span class="vol-tag">Ambient Mixer</span>' +
      '<input class="vol-range vol-amb" type="range" min="0" max="100" step="1" value="80" aria-label="Ambient Mixer volume">' +
    '</label>' +

    '<div class="pomo-box">' +
      '<div class="pomo-head">' +
        '<span class="pomo-title">Smart Pomodoro</span>' +
        '<span id="fb-pomo-state" class="pomo-state">Ready</span>' +
      '</div>' +
      '<div class="pomo-row">' +
        '<span id="fb-pomo-time" class="pomo-time">25:00</span>' +
        '<button type="button" id="fb-pomo-start" class="pomo-start">Start</button>' +
      '</div>' +
    '</div>' +

    '<div class="amb-row">' +
      '<div class="amb-head">Ambient Mixer</div>' +
      '<div class="amb" role="group" aria-label="Ambient layer">' +
        '<button type="button" data-amb="off" class="active">Off</button>' +
        '<button type="button" data-amb="pink">Pink</button>' +
        '<button type="button" data-amb="brown">Brown</button>' +
        '<button type="button" data-amb="rain">Rain</button>' +
        '<button type="button" data-amb="white">White</button>' +
      '</div>' +
    '</div>' +

    '<footer class="foot">' +
      '<span class="quota"></span>' +
      '<button type="button" id="btn-buy-pro" class="buy btn-buy-pro">Buy Pro</button>' +
    '</footer>' +
  '</div>' +
'</section>' +

'<div id="fb-overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="fb-m-title">' +
  '<div class="modal">' +
    '<button type="button" class="modal-close" aria-label="Close payment modal" title="Close">&times;</button>' +
    '<h3 id="fb-m-title">License Required</h3>' +
    '<p>FocusBot requires an active license to operate.<br>' +
       'Complete a <strong>12 &euro; Bitcoin payment</strong> for 365 days of access.</p>' +
    '<div id="fb-btc-box" class="btc-box">' +
      '<div class="btc-price"></div>' +
      '<img id="fb-btc-qr" class="btc-qr" alt="Bitcoin QR code" width="120" height="120">' +
      '<code id="fb-btc-address" class="btc-addr"></code>' +
      '<button type="button" id="fb-copy-btn" class="btc-copy">Copy BTC Address</button>' +
      '<div class="btc-instructions" style="font-size:11px;text-align:left;margin:10px 0;color:#a1a1aa;line-height:1.5;background:rgba(255,255,255,0.04);padding:8px 10px;border-radius:8px">' +
        '<strong style="color:#f7931a">How to Activate:</strong>' +
        '<ol style="margin:4px 0 0 16px;padding:0">' +
          '<li>Send the exact BTC amount to the address above.</li>' +
          '<li>Open the transfer details in your wallet (Trust Wallet, Binance, etc.) and copy the <b>Transaction Hash / TXID</b> <i>(the 64-character code)</i>.</li>' +
          '<li>Paste it below and click <b>Verify &amp; Activate</b> to unlock Pro instantly.</li>' +
        '</ol>' +
      '</div>' +
    '</div>' +
    '<div class="lic">' +
      '<input id="fb-license-input" class="lic-input" type="text" maxlength="128" spellcheck="false" autocomplete="off" placeholder="TXID or License Key" aria-label="TXID or license key">' +
      '<button type="button" id="fb-activate-btn" class="activate">Verify &amp; Activate</button>' +
    '</div>' +
  '</div>' +
'</div>' +

'<div id="fb-toast" class="toast" role="status" aria-live="polite"></div>';

    if (document.body.appendChild) document.body.appendChild(host);
    return root;
  }

  /* ---- Element references -------------------------------------------------
   * NOTE: Class selectors (.overlay/.vol-range/.fr-*) map 1:1 onto the
   * stub cache in the test infrastructure; IDs exist for the real DOM.   */
  const root = mountUI();
  const $ = (sel) => (root && root.querySelector ? root.querySelector(sel) : null);

  const els = {
    fab: $('.fab'),
    panel: $('.panel'), close: $('.close'),
    dot: $('.dot'), chip: $('.chip'),
    play: $('#fb-play-btn') || $('.play'),
    iconPlay: $('.icon-play'), iconPause: $('.icon-pause'),
    beatMain: $('.beat-main'), beatSub: $('.beat-sub'),
    modesWrap: $('.modes'),
    modesSolWrap: $('.modes-sol'),
    vol: $('.vol-range'),
    volBin: $('.vol-bin'),
    volAmb: $('.vol-amb'),
    frSlL: $('.fr-sl-l'), frSlR: $('.fr-sl-r'),
    frNumL: $('.fr-num-l'), frNumR: $('.fr-num-r'),
    frReset: $('.frange-reset'), frBeat: $('.frange-beat'),
    quota: $('.quota'), buy: $('#btn-buy-pro') || $('.buy'),

    pomoTime: $('.pomo-time') || $('#fb-pomo-time'),
    pomoState: $('.pomo-state') || $('#fb-pomo-state'),
    pomoStart: $('.pomo-start') || $('#fb-pomo-start'),
    ambRow: $('.amb-row'),

    overlay: $('.overlay'),
    mTitle: $('#fb-m-title') || $('.modal h3'),
    closeModal: $('.modal-close'),
    btcBox: $('#fb-btc-box'), btcPrice: $('.btc-price'),
    btcAddr: $('#fb-btc-address') || $('.btc-addr'),
    btcQr: $('#fb-btc-qr'), btcCopy: $('#fb-copy-btn'),
    licInput: $('#fb-license-input'), activate: $('#fb-activate-btn'),

    toast: $('#fb-toast') || $('.toast'),
  };

  /* ==========================================================================
   * 10) EVENT BINDING
   * ======================================================================== */
  if (els.fab) {
    /* ---- Pointer helpers (mouse + touch unified) ---- */
    function dragPointerX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function dragPointerY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }

    var touchUsed = false;   // suppress synthetic click after touch interaction

    function onDragStart(e) {
      if (e.button && e.button !== 0) return;
      drag.active = true;
      drag.moved = false;
      drag.startX = dragPointerX(e);
      drag.startY = dragPointerY(e);
      const rect = els.fab.getBoundingClientRect();
      drag.offsetX = drag.startX - rect.left;
      drag.offsetY = drag.startY - rect.top;
      els.fab.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      if (e.type === 'touchstart') {
        document.addEventListener('touchmove', onDragMove, { passive: false });
        document.addEventListener('touchend', onDragEnd);
        document.addEventListener('touchcancel', onDragEnd);
      } else {
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', onDragEnd);
      }
    }

    function onDragMove(e) {
      if (!drag.active) return;
      if (e.cancelable) e.preventDefault();
      var cx = dragPointerX(e);
      var cy = dragPointerY(e);
      var dx = cx - drag.startX;
      var dy = cy - drag.startY;
      if (!drag.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      var clamped = clampFab(cx - drag.offsetX, cy - drag.offsetY);
      els.fab.style.left = clamped.x + 'px';
      els.fab.style.top = clamped.y + 'px';
      els.fab.style.right = 'auto';
      els.fab.style.bottom = 'auto';
      updatePanelPos();
    }

    function onDragEnd(e) {
      if (e && e.type === 'touchend' && e.cancelable) e.preventDefault();
      var wasDrag = drag.moved;
      var wasTouch = !!(e && e.type && e.type.indexOf('touch') === 0);
      if (wasTouch) touchUsed = true;
      drag.active = false;
      els.fab.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      if (e && e.type === 'touchend') {
        document.removeEventListener('touchmove', onDragMove);
        document.removeEventListener('touchend', onDragEnd);
        document.removeEventListener('touchcancel', onDragEnd);
      } else {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
      }
      if (!wasDrag) { togglePanel(); return; }
      var rect = els.fab.getBoundingClientRect();
      saveFabPos(rect.left, rect.top);
      drag.startX = 0; drag.startY = 0; drag.offsetX = 0; drag.offsetY = 0;
    }

    els.fab.addEventListener('mousedown', onDragStart);
    els.fab.addEventListener('touchstart', onDragStart, { passive: true });
    els.fab.addEventListener('click', function (e) {
      if (touchUsed) { touchUsed = false; e.stopPropagation(); return; }
    });

    /* ---- Mobile engine unlock: first touch/pointer never leaves the audio
     * engine frozen. iOS/Android autoplay policies suspend AudioContext until a
     * user gesture — any gesture inside the widget resumes it immediately. */
    function unlockAudioOnGesture() {
      if (!STATE.audioCtx || STATE.audioCtx.state !== 'suspended') return;
      if (!STATE.playing && !STATE.autoplayBlocked) return;
      try {
        const p = STATE.audioCtx.resume();
        if (p && typeof p.then === 'function') p.catch(() => {});
        STATE.autoplayBlocked = false;
      } catch (_) {}
    }
    ['pointerdown', 'touchstart', 'mousedown', 'click'].forEach((evt) => {
      try { els.fab.addEventListener(evt, unlockAudioOnGesture, { passive: true }); } catch (_) {}
      try { els.panel.addEventListener(evt, unlockAudioOnGesture, { passive: true }); } catch (_) {}
    });
  }

  if (els.close) els.close.addEventListener('click', () => togglePanel(false));

  if (els.play) {
    els.play.addEventListener('click', () => {
      if (STATE.playing) pausePlayback(); else startPlayback();
    });
  }

  if (els.vol) {
    els.vol.addEventListener('input', () => {
      const pct = Math.min(100, Math.max(0, Number(els.vol.value) || 0));
      STATE.volume = pct / 100;
      if (STATE.nodes && STATE.audioCtx) {
        const g = STATE.nodes.masterGain.gain;
        const t = STATE.audioCtx.currentTime;
        try {
          g.cancelScheduledValues(t);
          g.setTargetAtTime(Math.min(MASTER_GAIN_MAX, gainTarget()), t, 0.05);
        } catch (_) { g.value = Math.min(MASTER_GAIN_MAX, gainTarget()); }
      }
    });
  }

  if (els.modesWrap) {
    els.modesWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest
        ? e.target.closest('button[data-mode]')
        : null;
      if (!btn || !btn.dataset || !btn.dataset.mode) return;
      setMode(btn.dataset.mode);
    });
  }
  if (els.modesSolWrap) {
    els.modesSolWrap.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest
        ? e.target.closest('button[data-mode]')
        : null;
      if (!btn || !btn.dataset || !btn.dataset.mode) return;
      setMode(btn.dataset.mode);
    });
  }

  if (els.volBin) {
    els.volBin.addEventListener('input', () => setVolumeTarget('binaural', els.volBin.value));
  }
  if (els.volAmb) {
    els.volAmb.addEventListener('input', () => setVolumeTarget('ambient', els.volAmb.value));
  }

  function bindFrNum(input, which) {
    if (!input) return;
    input.addEventListener('change', () => onFrNumCommit(which));
  }
  function bindFrSlider(input, which) {
    if (!input) return;
    input.addEventListener('input', () => onFrSliderInput(which));
  }
  bindFrNum(els.frNumL, 'l');
  bindFrNum(els.frNumR, 'r');
  bindFrSlider(els.frSlL, 'l');
  bindFrSlider(els.frSlR, 'r');

  if (els.frReset) els.frReset.addEventListener('click', clearFrequencyRange);

  if (els.buy) els.buy.addEventListener('click', buyPro);
  if (els.btcCopy) els.btcCopy.addEventListener('click', copyBtcAddress);
  if (els.activate) els.activate.addEventListener('click', onActivateClick);
  if (els.closeModal) els.closeModal.addEventListener('click', closeUpsell);
  if (els.overlay) {
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeUpsell(); });
  }

  // ESC key closes the payment modal (keyboard accessibility)
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('keydown', (e) => {
      try {
        if (e && (e.key === 'Escape' || e.key === 'Esc')) closeUpsell();
      } catch (_) { /* non-fatal */ }
    });
  }

  if (els.pomoStart) {
    els.pomoStart.addEventListener('click', () => {
      if (STATE.pomodoro.running) pomodoroReset(); else pomodoroStart();
    });
  }

  if (els.ambRow) {
    els.ambRow.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest
        ? e.target.closest('button[data-amb]')
        : null;
      if (!btn || !btn.dataset || !btn.dataset.amb) return;
      toggleAmbient(btn.dataset.amb);
    });
  }

  /* ---- MV3 popup ↔ content-script bridge (dual-direction control) ---- */
  function getPublicState() {
    return {
      pro: STATE.pro,
      trial: {
        days: TRIAL_DAYS,
        active: trialActive(),
        remainingMs: trialRemainingMs(),
        endsAt: trialEndAt(),
      },
      playing: STATE.playing,
      autoplayBlocked: STATE.autoplayBlocked,
      mode: STATE.mode,
      volume: STATE.volume,
      volumeBinaural: STATE.volBinaural,
      volumeAmbient: STATE.volAmbient,
      ambient: STATE.activeAmbients.size ? [...STATE.activeAmbients][0] : 'off',
      ambients: [...STATE.activeAmbients],
      custom: STATE.custom ? { left: STATE.custom.left, right: STATE.custom.right } : null,
      pomodoro: {
        running: STATE.pomodoro.running,
        state: STATE.pomodoro.state,
        remainingMs: STATE.pomodoro.remainingMs,
        completed: STATE.pomodoro.completed,
      },
      expiresAt: STATE.proExpiresAt,
      proDaysLeft: STATE.licenseExpired ? 0 : proDaysLeft(),
      licenseExpired: STATE.licenseExpired,
    };
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      try {
        if (!msg || msg.type !== 'FOCUSBOT_CTRL') return;
        const reply = () => sendResponse({ ok: true, state: getPublicState() });
        switch (msg.cmd) {
          case 'getState': reply(); break;
          case 'play': startPlayback(); reply(); break;
          case 'pause': pausePlayback(); reply(); break;
          case 'toggle': if (STATE.playing) pausePlayback(); else startPlayback(); reply(); break;
          case 'setMode': if (msg.mode) setMode(msg.mode); reply(); break;
          case 'setVolume': if (msg.which && msg.value !== undefined) setVolumeTarget(msg.which, msg.value); reply(); break;
          case 'setAmbient': setAmbient(msg.kind); reply(); break;
          case 'toggleAmbient': toggleAmbient(msg.kind); reply(); break;
          case 'pomodoroStart': pomodoroStart(); reply(); break;
          case 'pomodoroStop': pomodoroReset(); reply(); break;
          case 'openUpsell': openUpsell(); reply(); break;
          case 'openPanel': togglePanel(true); reply(); break;
          default: sendResponse({ ok: false, error: 'unknown_cmd' });
        }
      } catch (err) {
        try { sendResponse({ ok: false, error: String((err && err.message) || err) }); } catch (_) {}
      }
      return true;
    });
  }

  /* ---- Lifecycle listeners ---- */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (typeof document.hidden === 'undefined') return;
      // Re-verify license on foreground (another tab may have invalidated it)
      if (!document.hidden && !STATE.verifying) {
        try { const k = localStorage.getItem(LS.key); if (k) { applyLicense(k, { silent: true }); } } catch (_) {}
      }
      // Live-lock a running session the instant the trial window expires.
      if (!document.hidden) trialWatchdog();
    });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', () => {
      if (STATE.suspendTimer) { clearTimeout(STATE.suspendTimer); STATE.suspendTimer = null; }
      try { if (STATE.audioCtx && STATE.audioCtx.state === 'running') STATE.audioCtx.suspend(); } catch (_) {}
    });

    // Multi-tab sync: if another tab removes the license key, revoke Pro
    window.addEventListener('storage', (e) => {
      try {
        if (e && e.key === LS.key && !e.newValue && STATE.pro) {
          STATE.pro = false;
          STATE.proExpiresAt = null;
          if (STATE.playing) pausePlayback();
          renderLicenseUI(false);
        }
      } catch (_) {}
    });
  }

  /* ==========================================================================
   * 11) MODE SELECTION
   * ======================================================================== */
  function setMode(mode) {
    if (!MODES[mode]) return;
    if (!hasAccess()) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      return;
    }
    STATE.mode = mode;
    STATE.custom = null;                 // picking a mode cancels the custom range
    if (els.modesWrap || els.modesSolWrap) {
      // Selection highlight spans BOTH groups — the binaural grid and the
      // solfeggio grid share the same data-mode namespace.
      const wraps = [els.modesWrap, els.modesSolWrap];
      for (const wrap of wraps) {
        try {
          Array.prototype.forEach.call(
            wrap && wrap.querySelectorAll ? wrap.querySelectorAll('button[data-mode]') : [],
            (b) => { b.classList.toggle('active', b.dataset.mode === mode); }
          );
        } catch (_) {}
      }
    }
    const f = activeFreqs();
    // Solfeggio tones are equal-phase "pure tones": snap both oscillators to
    // the carrier immediately (no click, no glide). Binaural modes keep the
    // gentle 1.2 s sweep so the beat audibly glides into place.
    applyFrequencies(f.left === f.right);
    // Mirror the selection into the L/R sliders, number inputs and beat diff —
    // a Solfeggio click therefore shows 963 / 963 with "Beat: 0 Hz (Pure Tone)".
    syncFrangeUI();
    updateBeatInfo();
  }

  /* ==========================================================================
   * 12) PUBLIC API
   * ======================================================================== */
  window.FocusBot = Object.freeze({
    play: startPlayback,
    pause: pausePlayback,
    toggle: () => { if (STATE.playing) pausePlayback(); else startPlayback(); },
    setMode,

    setFrequencyRange,
    clearFrequencyRange,
    get frequencyRange() {
      const f = activeFreqs();
      return { left: f.left, right: f.right, custom: !!STATE.custom };
    },

    setVolume(pct) {
      const v = Math.min(100, Math.max(0, Number(pct) || 0));
      STATE.volume = v / 100;
      if (els.vol) els.vol.value = String(Math.round(v));
      if (STATE.nodes && STATE.audioCtx) {
        try { STATE.nodes.masterGain.gain.setTargetAtTime(gainTarget(), STATE.audioCtx.currentTime, 0.05); } catch (_) {}
      }
    },
    get volume() { return STATE.volume; },

    /* Independent volume stages (persisted) */
    setVolumeBinaural(pct) { setVolumeTarget('binaural', pct); },
    setVolumeAmbient(pct) { setVolumeTarget('ambient', pct); },
    get volumeBinaural() { return STATE.volBinaural; },
    get volumeAmbient() { return STATE.volAmbient; },

    /* 3-day frictionless trial status */
    get trial() {
      return {
        days: TRIAL_DAYS,
        active: trialActive(),
        remainingMs: trialRemainingMs(),
        endsAt: trialEndAt(),
      };
    },

    openPro: openUpsell,
    copyBtcAddress,

    get isPro() { return STATE.pro; },
    get isPlaying() { return STATE.playing; },
    get autoplayBlocked() { return STATE.autoplayBlocked; },

    /* ---- v4 suite API ---- */
    getState: getPublicState,
    get state() { return getPublicState(); },
    setAmbient,
    toggleAmbient,
    get ambient() { return STATE.activeAmbients.size ? [...STATE.activeAmbients][0] : 'off'; },
    get ambients() { return [...STATE.activeAmbients]; },
    pomodoro: Object.freeze({
      start: pomodoroStart,
      stop: pomodoroReset,
      reset: pomodoroReset,
      getState() {
        return {
          running: STATE.pomodoro.running,
          state: STATE.pomodoro.state,
          remainingMs: STATE.pomodoro.remainingMs,
          completed: STATE.pomodoro.completed,
        };
      },
    }),
    togglePanel,
  });

  /* ==========================================================================
   * 12) INITIALIZATION
   * ======================================================================== */

  // Restore the saved custom frequency range (persists across page reloads)
  try {
    const savedF = JSON.parse(localStorage.getItem(LS.customFreq) || 'null');
    if (savedF && Number.isFinite(savedF.left) && Number.isFinite(savedF.right)) {
      STATE.custom = normalizePair(savedF.left, savedF.right);
    }
  } catch (_) {}

  // Default view states (HIDDEN_DEFAULTS compat: closed elements start hidden)
  setHidden(els.overlay, true);
  setHidden(els.toast, true);
  setHidden(els.panel, true);
  setHidden(els.chip, true);
  setHidden(els.iconPause, true);
  setHidden(els.iconPlay, false);

  syncFrangeUI();
  updateBeatInfo();
  updateFooter();
  updatePlayingUI();
  updatePomodoroUI();
  updateAmbientUI();

  // Restore saved FAB position
  if (els.fab) {
    var saved = loadFabPos();
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      var c = clampFab(saved.x, saved.y);
      els.fab.style.left = c.x + 'px';
      els.fab.style.top = c.y + 'px';
      els.fab.style.right = 'auto';
      els.fab.style.bottom = 'auto';
    }
  }

  // Re-clamp FAB on orientation change (mobile)
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        if (!els.fab) return;
        var rect = els.fab.getBoundingClientRect();
        var c = clampFab(rect.left, rect.top);
        els.fab.style.left = c.x + 'px';
        els.fab.style.top = c.y + 'px';
        saveFabPos(c.x, c.y);
        updatePanelPos();
      }, 200);
    });
  }

  // Restore persisted volume stages + stamp/build the trial window
  bootstrapState();

  // Mid-session expiry watchdog — a running session locks the instant the
  // 72h window passes; the license equivalent enforces the 365-day Pro window.
  try {
    setInterval(trialWatchdog, TRIAL_CHECK_MS);
    setInterval(licenseWatchdog, TRIAL_CHECK_MS);
  } catch (_) {}

  bootVerify();            // server-side license verification on every page load
})();
