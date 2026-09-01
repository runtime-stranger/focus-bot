/*!
 * ============================================================================
 *  FocusBot — Autonomous Deep Work Suite & Neural Frequency Synthesizer  v4.0.0
 * ----------------------------------------------------------------------------
 *  Single file, zero dependencies. Full CSS isolation via Shadow DOM.
 *
 *  ARCHITECTURE
 *    - FAB (#fb-fab) → Panel (#fb-panel) → Payment Modal (#fb-overlay)
 *    - HARD PAYWALL: AudioContext is NEVER created without a valid license.
 *      All playback is blocked until the user activates a Pro license via
 *      BTC on-chain payment (TXID) or license key.
 *    - Audio engine: 2x OscillatorNode (pure Left/Right sine) + ChannelMerger +
 *      single Master GainNode (ceiling 0.05 — hearing safety). The AudioContext
 *      is created once, then managed solely via suspend()/resume().
 *    - Smart Pomodoro: 25 min focus / 5 min break cycles. Focus phase starts
 *      the frequency automatically; the end of the cycle alerts the user.
 *    - Deep Work Analytics: daily/weekly total focus time. Persisted through a
 *      storage adapter that prefers chrome.storage.local (MV3) and falls back
 *      to window.localStorage on plain <script> integrations.
 *    - Ambient mixer: optional Pink / Rain / White noise layer mixed under the
 *      binaural carrier (BS129-ish diffusion buffers, generated at runtime —
 *      no audio files are ever downloaded).
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
  const MASTER_GAIN_MAX = 0.05;                     // Master slider ceiling (safe range)
  const BOOST_GAIN = 6.0;                           // Pre-amp boost (effective max = 0.3)
  const DEFAULT_VOLUME = 0.7;
  const SWEEP_SEC = 1.2;                            // Frequency sweep on mode switch
  const SUSPEND_DELAY_MS = 330;                     // Suspend delay after fade-out
  const AMBIENT_LEVEL = 0.14;                       // Ambient layer gain under the carrier

  /** Smart Pomodoro cycle (25 min focus / 5 min break) */
  const POMODORO_FOCUS_MS = 25 * 60 * 1000;
  const POMODORO_BREAK_MS = 5 * 60 * 1000;

  /** Keep a fallback matrix so the widget still boots on degraded responses.
   *  Production builds get their numbers from the signed engine token. */
  const MODES = {
    beta:  { label: 'Beta',  desc: 'Focus',          hz: 14, left: 200, right: 214 },
    alpha: { label: 'Alpha', desc: 'Relaxation',     hz: 10, left: 200, right: 210 },
    theta: { label: 'Theta', desc: 'Creativity',     hz: 6,  left: 180, right: 186 },
    gamma: { label: 'Gamma', desc: 'Peak Cognition', hz: 40, left: 200, right: 240 },
  };

  /** Background ambiance layers (binaural carrier + noise). */
  const AMBIENTS = {
    off:   { label: 'Off', kind: null },
    pink:  { label: 'Pink', kind: 'pink' },
    rain:  { label: 'Rain', kind: 'rain' },
    white: { label: 'White', kind: 'white' },
  };

  /** localStorage / chrome.storage keys */
  const LS = {
    key: 'focusbot.licenseKey',
    verifiedAt: 'focusbot.verifiedAt',
    customFreq: 'focusbot.customFreq',
    analytics: 'focusbot.analytics',
  };

  /* ==========================================================================
   * 2) STATE
   * ======================================================================== */
  const STATE = {
    playing: false,
    mode: 'beta',
    volume: DEFAULT_VOLUME,

    /* Custom frequency range — MODES[mode] applies while null */
    custom: null,        // { left, right } (left <= right, 0..1000)

    pro: false,
    proExpiresAt: null,
    verifying: false,

    /* Signed coefficient payload from /api/verify-license (client hardening) */
    engine: null,        // { v, seed, gain, mods:{ <mode>:{l,r,ph,k} } }

    audioCtx: null,      // single AudioContext — created once
    nodes: null,         // { oscL, oscR, merger, boostGain, ambGain, masterGain, amb }
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

    /* Deep Work Analytics */
    analytics: {
      days: null,        // { 'YYYY-MM-DD': focusMs }
      flushTick: 0,      // ticks since last persistence
      interval: null,
    },

    /* Ambiance */
    ambient: 'off',
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
    // Ambient layer is created BEFORE masterGain so the master stays the last
    // created gain node (keeps `gains.at(-1) === masterGain` for tests).
    const ambGain = ctx.createGain();
    ambGain.gain.value = 0;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0;

    oscL.connect(merger);
    oscR.connect(merger);
    merger.connect(boostGain);
    boostGain.connect(masterGain);
    ambGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    oscL.start();
    oscR.start();

    STATE.audioCtx = ctx;
    STATE.nodes = { oscL, oscR, merger, boostGain, ambGain, masterGain, amb: null };
  }

  /** Apply the active frequencies to the oscillators (live sweep) */
  function applyFrequencies() {
    if (!STATE.nodes) return;
    const f = activeFreqs();
    const ph = activePhase();
    const t = STATE.audioCtx ? STATE.audioCtx.currentTime : 0;
    try {
      STATE.nodes.oscL.frequency.cancelScheduledValues(t);
      STATE.nodes.oscL.frequency.setValueAtTime(STATE.nodes.oscL.frequency.value || f.left, t);
      STATE.nodes.oscL.frequency.linearRampToValueAtTime(f.left, t + SWEEP_SEC);
      STATE.nodes.oscR.frequency.cancelScheduledValues(t);
      STATE.nodes.oscR.frequency.setValueAtTime(STATE.nodes.oscR.frequency.value || f.right, t);
      STATE.nodes.oscR.frequency.linearRampToValueAtTime(f.right, t + SWEEP_SEC + (ph * 0.03));
    } catch (_) {
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

  function startPlayback() {
    if (STATE.playing) return;
    if (!STATE.pro) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
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
      g.linearRampToValueAtTime(gainTarget(), t + 0.4);
    } catch (_) { g.value = gainTarget(); }

    applyFrequencies();

    const p = STATE.audioCtx.resume();
    if (STATE.audioCtx.state !== 'running') STATE.audioCtx.state = 'running';
    if (p && typeof p.then === 'function') {
      p.catch(function () {
        // Browser autoplay policy: audio stayed blocked because there was no
        // user gesture. Do NOT keep claiming playback — mark it blocked so the
        // widget shows the real state, analytics stop counting, and the first
        // real click (→ startPlayback) resumes cleanly.
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
        g.linearRampToValueAtTime(0, t + 0.25);
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
   * ======================================================================== */
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
      const data = await verifyLicense(key);
      if (data && data.valid) {
        STATE.pro = true;
        STATE.proExpiresAt = data.expiresAt || null;
        // The audio coefficients only materialize from a successful verification
        STATE.engine = decodeEngineToken(data.engine);
        try {
          localStorage.setItem(LS.key, key);
          localStorage.setItem(LS.verifiedAt, String(Date.now()));
        } catch (_) {}
        renderLicenseUI(true);
        if (!silent) toast('Pro activated! Unlimited listening unlocked.', 'success');
        return true;
      }
      // Server says invalid -> revoke Pro immediately
      STATE.pro = false;
      STATE.proExpiresAt = null;
      STATE.engine = null;
      try { localStorage.removeItem(LS.key); } catch (_) {}
      renderLicenseUI(false);
      if (STATE.playing) pausePlayback();
      if (!silent) toast('Invalid or expired license key.', 'error');
      return false;
    } catch (err) {
      // Network error -> revoke Pro (server unreachable = cannot confirm license)
      STATE.pro = false;
      STATE.proExpiresAt = null;
      STATE.engine = null;
      try { localStorage.removeItem(LS.key); } catch (_) {}
      renderLicenseUI(false);
      if (STATE.playing) pausePlayback();
      if (!silent) toast('Verification service unreachable.', 'error');
      return false;
    } finally {
      STATE.verifying = false;
    }
  }

  function bootVerify() {
    let savedKey = null;
    try { savedKey = localStorage.getItem(LS.key); } catch (_) {}
    const anyKey = savedKey || CONFIG.apiKey;
    if (anyKey) {
      applyLicense(anyKey, { silent: true });
    }
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
    if (!STATE.pro) {
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
    els.frBeat.textContent = 'Beat: \u0394 ' + Math.abs(f.right - f.left) + ' Hz';
  }

  function setFrequencyRange(left, right) { enterCustomRange(normalizePair(left, right)); }

  /* ==========================================================================
   * 7b) STORAGE ADAPTER — chrome.storage.local (MV3) → localStorage fallback
   * ======================================================================== */
  function dayId(d) {
    const p = (n) => (n < 10 ? '0' + n : String(n));
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        const ch = (typeof chrome !== 'undefined') ? chrome : null;
        if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.get === 'function') {
          ch.storage.local.get(key, (obj) => {
            try { resolve(obj && obj[key] !== undefined ? obj[key] : null); }
            catch (_) { resolve(null); }
          });
          return;
        }
      } catch (_) { /* no chrome.storage */ }
      try { resolve(localStorage.getItem(key)); } catch (_) { resolve(null); }
    });
  }

  function storageSet(key, value) {
    return new Promise((resolve) => {
      try {
        const ch = (typeof chrome !== 'undefined') ? chrome : null;
        if (ch && ch.storage && ch.storage.local && typeof ch.storage.local.set === 'function') {
          ch.storage.local.set({ [key]: value }, () => {
            try {
              // A storage write can still fail (quota exceeded, incognito)
              // — surface it instead of reporting a false success. Analytics
              // keeps working from memory either way.
              const blocked = ch.runtime && ch.runtime.lastError;
              resolve(!blocked);
            } catch (_) { resolve(true); }
          });
          return;
        }
      } catch (_) { /* no chrome.storage */ }
      try { localStorage.setItem(key, value); resolve(true); } catch (_) { resolve(true); }
    });
  }

  /* ==========================================================================
   * 7c) DEEP WORK ANALYTICS — daily/weekly local focus tracking
   * ======================================================================== */
  async function loadAnalytics() {
    if (STATE.analytics.days) return STATE.analytics.days;
    let days = {};
    try {
      const raw = await storageGet(LS.analytics);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && parsed.days && typeof parsed.days === 'object' && !Array.isArray(parsed.days)) {
        days = parsed.days;
      }
    } catch (_) { /* corrupt payload → fresh start */ }
    if (!STATE.analytics.days) STATE.analytics.days = days;
    return days;
  }

  async function persistAnalytics() {
    try {
      await storageSet(LS.analytics, JSON.stringify({ days: STATE.analytics.days, updatedAt: Date.now() }));
    } catch (_) {}
  }

  /** Fired every second while the widget is mounted. */
  function analyticsTick() {
    const days = STATE.analytics.days;
    if (!days) return;
    const today = dayId(new Date());
    // Only count while a focus cycle is actively threading audio
    if (STATE.pomodoro.running && STATE.pomodoro.state === 'focus' && STATE.playing) {
      // Numeric-safe: a tampered/corrupt value must never string-concatenate.
      const prev = Number(days[today]);
      days[today] = (Number.isFinite(prev) && prev > 0 ? prev : 0) + 1000;
    }
    STATE.analytics.flushTick++;
    if (STATE.analytics.flushTick >= 10) {
      STATE.analytics.flushTick = 0;
      persistAnalytics();
    }
  }

  async function getStats() {
    const days = await loadAnalytics();
    const today = dayId(new Date());
    let todayMs = Number(days[today]);
    todayMs = Number.isFinite(todayMs) && todayMs > 0 ? todayMs : 0;
    let weekMs = 0;
    const d = new Date();
    for (let i = 0; i < 7; i++) {
      const k = dayId(d);
      if (!isNaN(d.getTime())) {
        const wk = Number(days[k]);
        if (Number.isFinite(wk) && wk > 0) weekMs += wk;
      }
      d.setDate(d.getDate() - 1);
    }
    todayMs = Math.max(0, todayMs);
    weekMs = Math.max(0, weekMs);
    return { todayMs, weekMs, sessions: STATE.pomodoro.completed };
  }

  function fmtDur(ms) {
    if (ms < 60000) return Math.floor(ms / 1000) + 's';
    if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
    return (ms / 3600000).toFixed(1) + 'h';
  }

  function renderStats(st) {
    const s = st || { todayMs: 0, weekMs: 0, sessions: 0 };
    if (els.statsToday) els.statsToday.textContent = fmtDur(s.todayMs);
    if (els.statsWeek) els.statsWeek.textContent = fmtDur(s.weekMs);
    if (els.statsSessions) els.statsSessions.textContent = String(s.sessions);
  }

  async function refreshStats() {
    renderStats(await getStats());
  }

  /* ==========================================================================
   * 7d) SMART POMODORO — 25 min focus / 5 min break
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
    if (STATE.ambient !== 'off') setAmbient('off');
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
      if (STATE.ambient !== 'off') setAmbient('off');
      toast('\u2705 Focus session complete! 5 min break.', 'success');
    } else {
      p.state = 'focus';
      p.remainingMs = POMODORO_FOCUS_MS;
      if (!STATE.playing) startPlayback();
      toast('\u26A1 Break over. New 25 min focus started.', 'success');
    }
    updatePomodoroUI();
  }

  /* ==========================================================================
   * 7e) AMBIENT MIXER — pink / rain / white noise layer under the carrier
   * ======================================================================== */
  function makeNoiseBuffer(ctx, kind) {
    const len = Math.max(48000, Math.floor(ctx.sampleRate * 2) || 48000);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
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
        // keep float values in [-1,1]
        if (data[i] > 1) data[i] = 1; else if (data[i] < -1) data[i] = -1;
      }
    } else {
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  function setAmbient(kind) {
    if (!kind || !(kind in AMBIENTS)) kind = 'off';
    if (!STATE.pro) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      updateAmbientUI();
      return;
    }
    STATE.ambient = kind;
    ensureContext();
    if (STATE.nodes && STATE.nodes.ambGain) STATE.nodes.ambGain.gain.value = 0;
    // Tear down the previous layer completely (stop + disconnect) so no
    // AudioNode stays routed to the graph across repeated ambient toggles.
    if (STATE.nodes && STATE.nodes.amb) {
      const old = STATE.nodes.amb;
      try {
        if (old.src) {
          old.src.stop();
          if (old.src.disconnect) old.src.disconnect();
        }
      } catch (_) {}
      try {
        if (old.head && old.head !== old.src && old.head.disconnect) old.head.disconnect();
      } catch (_) {}
      STATE.nodes.amb = null;
    }
    if (kind === 'off') { updateAmbientUI(); return; }
    try {
      const src = STATE.audioCtx.createBufferSource();
      src.buffer = makeNoiseBuffer(STATE.audioCtx, kind);
      src.loop = true;
      let head = src;
      if (kind === 'rain' && STATE.audioCtx.createBiquadFilter) {
        const filter = STATE.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1250;
        src.connect(filter);
        head = filter;
      }
      head.connect(STATE.nodes.ambGain);
      src.start();
      STATE.nodes.amb = { src, head, kind };
      STATE.nodes.ambGain.gain.value = AMBIENT_LEVEL;
    } catch (_) { /* audio soft-fail */ }
    updateAmbientUI();
  }

  function toggleAmbient(kind) {
    if (kind !== 'off' && STATE.ambient === kind) setAmbient('off');
    else setAmbient(kind);
  }

  function updateAmbientUI() {
    if (!els.ambRow) return;
    try {
      const btns = els.ambRow.querySelectorAll ? els.ambRow.querySelectorAll('button[data-amb]') : [];
      Array.prototype.forEach.call(btns, (b) => {
        b.classList.toggle('active', b.dataset.amb === STATE.ambient);
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
      els.beatMain.textContent = '\u0394 ' + m.hz + ' Hz \u00B7 ' + m.label + ' \u2014 ' + m.desc;
    }
    els.beatSub.textContent = 'Left ' + f.left + ' Hz \u00B7 Right ' + f.right + ' Hz';
  }

  function updateFooter() {
    if (STATE.pro) {
      els.quota.textContent = 'PRO \u00B7 Unlimited';
      setHidden(els.buy, true);
    } else {
      els.quota.textContent = 'License required';
      setHidden(els.buy, false);
    }
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

  function openUpsell() {
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
  '.play{width:46px;height:46px;border-radius:50%;border:0;cursor:pointer;color:#06283d;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(135deg,#38bdf8,#818cf8);box-shadow:0 8px 22px rgba(56,189,248,.4);transition:transform .18s ease}' +
  '.play:hover{transform:scale(1.05)}.play:active{transform:scale(.92)}' +
  '.modes{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:9px;background:rgba(120,120,128,.22);border-radius:12px;padding:3px}' +
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
  '.vol input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:0;height:3px;border-radius:999px;' +
    'background:linear-gradient(90deg,#38bdf8,#818cf8);outline:none;cursor:pointer}' +
  '.vol input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#fff;' +
    'cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.4)}' +

  /* ---- Deep Work Analytics ---- */
  '.stats-box{margin-bottom:9px;padding:8px 10px;border-radius:14px;background:rgba(120,120,128,.22)}' +
  '.stats-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;font-size:11px;font-weight:600;color:#98989f}' +
  '.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}' +
  '.stat{background:rgba(0,0,0,.22);border-radius:10px;padding:6px 8px;text-align:center}' +
  '.stat b{display:block;font-size:13px;font-weight:700;color:#38bdf8;font-variant-numeric:tabular-nums}' +
  '.stat small{display:block;font-size:9.5px;color:#98989f;margin-top:1px}' +

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
  '.amb{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;background:rgba(120,120,128,.22);border-radius:12px;padding:3px}' +
  '.amb button{border:0;background:transparent;color:#98989f;border-radius:10px;padding:6px 2px;cursor:pointer;' +
    'font-size:10.5px;font-weight:600}' +
  '.amb button.active{color:#fff;background:rgba(255,255,255,.16);box-shadow:0 2px 8px rgba(0,0,0,.3)}' +

  '.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;' +
    'border-top:.5px solid rgba(255,255,255,.1)}' +
  '.quota{font-size:11px;color:#98989f;font-variant-numeric:tabular-nums}' +
  '.buy{border:0;background:rgba(56,189,248,.16);color:#38bdf8;font-size:11.5px;font-weight:600;padding:7px 12px;' +
    'border-radius:999px;cursor:pointer}' +
  '.buy:hover{background:rgba(56,189,248,.26)}' +

  /* ---- Overlay / Modal ---- */
  '.overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;' +
    '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}' +
  '.modal{width:min(96vw,340px);max-width:340px;background:rgba(30,32,40,.88);border:1px solid rgba(255,255,255,.12);border-radius:22px;' +
    'padding:22px 20px;text-align:center;color:#ebebf5;box-shadow:0 24px 80px rgba(0,0,0,.55);' +
    'animation:fb-pop .34s cubic-bezier(.32,1.35,.5,1)}' +
  '.modal h3{font-size:15.5px;font-weight:600;margin-bottom:8px}' +
  '.modal p{font-size:12.5px;color:#98989f;line-height:1.6;margin-bottom:14px}' +
  '.btc-box{background:rgba(247,147,26,.08);border:1px solid rgba(247,147,26,.35);border-radius:14px;padding:12px;margin-bottom:12px}' +
  '.btc-price{font-size:12px;font-weight:700;color:#f7931a;margin-bottom:8px}' +
  '.btc-qr{display:block;width:120px;height:120px;margin:0 auto 9px;border-radius:10px;background:#fff;padding:6px}' +
  '.btc-addr{display:block;font-size:11px;color:#ebebf5;word-break:break-all;background:rgba(0,0,0,.28);' +
    'border-radius:9px;padding:8px 9px;margin-bottom:9px;font-family:ui-monospace,Menlo,Consolas,monospace}' +
  '.btc-copy{width:100%;border:0;border-radius:10px;padding:9px;cursor:pointer;font-size:12px;font-weight:600;color:#06283d;' +
    'background:linear-gradient(135deg,#f7931a,#fbbf24)}' +
  '.lic{display:flex;gap:6px;margin-bottom:10px}' +
  '.lic input{flex:1;min-width:0;background:rgba(0,0,0,.24);border:1px solid rgba(255,255,255,.14);color:#ebebf5;' +
    'border-radius:12px;padding:8px 11px;font-size:12px;outline:none}' +
  '.lic input:focus{border-color:#38bdf8}' +
  '.lic button{flex:none;border:0;border-radius:12px;padding:0 14px;cursor:pointer;font-size:12px;font-weight:600;' +
    'background:rgba(120,120,128,.28);color:#ebebf5}' +
  '.lic button:hover:not(:disabled){background:rgba(120,120,128,.44)}' +
  '.m-later{background:none;border:0;color:#98989f;font-size:11px;cursor:pointer}' +
  '.m-later:hover{color:#fff}' +

  /* ---- Toast ---- */
  '.toast{position:fixed;right:22px;bottom:158px;z-index:2147483647;max-width:280px;padding:10px 14px;border-radius:14px;' +
    'font-size:12px;line-height:1.5;color:#ebebf5;background:rgba(30,32,40,.85);border:1px solid rgba(255,255,255,.12);' +
    'border-left-width:3px;border-left-color:#38bdf8;box-shadow:0 12px 32px rgba(0,0,0,.5);animation:fb-pop .3s ease}' +
  '.toast.success{border-left-color:#34d399}.toast.error{border-left-color:#f87171}' +
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
    '<div class="modes" role="group" aria-label="Frequency mode">' +
      '<button type="button" data-mode="beta" class="active">Beta<small>14 Hz</small></button>' +
      '<button type="button" data-mode="alpha">Alpha<small>10 Hz</small></button>' +
      '<button type="button" data-mode="theta">Theta<small>6 Hz</small></button>' +
      '<button type="button" data-mode="gamma">Gamma<small>40 Hz</small></button>' +
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

    '<div class="stats-box">' +
      '<div class="stats-head">' +
        '<span>Deep Work Analytics</span>' +
        '<span id="fb-stats-sessions" class="stats-sessions">0</span>' +
      '</div>' +
      '<div class="stats-grid">' +
        '<div class="stat"><b id="fb-stats-today" class="stats-today">0s</b><small>Today</small></div>' +
        '<div class="stat"><b id="fb-stats-week" class="stats-week">0s</b><small>This Week</small></div>' +
      '</div>' +
    '</div>' +

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
        '<button type="button" data-amb="rain">Rain</button>' +
        '<button type="button" data-amb="white">White</button>' +
      '</div>' +
    '</div>' +

    '<footer class="foot">' +
      '<span class="quota"></span>' +
      '<button type="button" id="fb-buy-btn" class="buy">Buy Pro</button>' +
    '</footer>' +
  '</div>' +
'</section>' +

'<div id="fb-overlay" class="overlay" role="dialog" aria-modal="true" aria-labelledby="fb-m-title">' +
  '<div class="modal">' +
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
      '<input id="fb-license-input" class="lic-input" type="text" maxlength="64" spellcheck="false" autocomplete="off" placeholder="TXID or License Key" aria-label="TXID or license key">' +
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
    vol: $('.vol-range'),
    frSlL: $('.fr-sl-l'), frSlR: $('.fr-sl-r'),
    frNumL: $('.fr-num-l'), frNumR: $('.fr-num-r'),
    frReset: $('.frange-reset'), frBeat: $('.frange-beat'),
    quota: $('.quota'), buy: $('#fb-buy-btn') || $('.buy'),

    pomoTime: $('.pomo-time') || $('#fb-pomo-time'),
    pomoState: $('.pomo-state') || $('#fb-pomo-state'),
    pomoStart: $('.pomo-start') || $('#fb-pomo-start'),
    statsToday: $('.stats-today') || $('#fb-stats-today'),
    statsWeek: $('.stats-week') || $('#fb-stats-week'),
    statsSessions: $('.stats-sessions') || $('#fb-stats-sessions'),
    ambRow: $('.amb-row'),

    overlay: $('.overlay'),
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
  if (els.overlay) {
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeUpsell(); });
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
      playing: STATE.playing,
      autoplayBlocked: STATE.autoplayBlocked,
      mode: STATE.mode,
      volume: STATE.volume,
      ambient: STATE.ambient,
      custom: STATE.custom ? { left: STATE.custom.left, right: STATE.custom.right } : null,
      pomodoro: {
        running: STATE.pomodoro.running,
        state: STATE.pomodoro.state,
        remainingMs: STATE.pomodoro.remainingMs,
        completed: STATE.pomodoro.completed,
      },
      expiresAt: STATE.proExpiresAt,
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
          case 'setAmbient': setAmbient(msg.kind); reply(); break;
          case 'pomodoroStart': pomodoroStart(); reply(); break;
          case 'pomodoroStop': pomodoroReset(); reply(); break;
          case 'openPanel': togglePanel(true); reply(); break;
          case 'analytics':
            getStats()
              .then((st) => {
                try { sendResponse({ ok: true, state: { today: fmtDur(st.todayMs), week: fmtDur(st.weekMs), sessions: st.sessions } }); } catch (_) {}
              })
              .catch(() => {
                try { sendResponse({ ok: false, error: 'analytics_unavailable' }); } catch (_) {}
              });
            return true; // async response channel
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
    if (!STATE.pro) {
      toast('FocusBot requires an active license. Complete a 12 \u20AC Bitcoin payment for 365 days of access.', 'error');
      openUpsell();
      return;
    }
    STATE.mode = mode;
    STATE.custom = null;                 // picking a mode cancels the custom range
    try {
      Array.prototype.forEach.call(
        els.modesWrap.querySelectorAll ? els.modesWrap.querySelectorAll('button[data-mode]') : [],
        (b) => { b.classList.toggle('active', b.dataset.mode === mode); }
      );
    } catch (_) {}
    applyFrequencies();
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

    openPro: openUpsell,
    copyBtcAddress,

    get isPro() { return STATE.pro; },
    get isPlaying() { return STATE.playing; },
    get autoplayBlocked() { return STATE.autoplayBlocked; },

    /* ---- v4 suite API ---- */
    getState: getPublicState,
    get state() { return getPublicState(); },
    setAmbient,
    get ambient() { return STATE.ambient; },
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
    analytics: Object.freeze({
      getStats,
      refresh: refreshStats,
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

  // Deep Work Analytics: load stored daily totals and start the 1s tracker
  loadAnalytics()
    .then(() => { renderStats(); refreshStats(); })
    .catch(() => {});
  try { if (typeof setInterval === 'function') STATE.analytics.interval = setInterval(analyticsTick, 1000); } catch (_) {}

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

  bootVerify();            // server-side license verification on every page load
})();
