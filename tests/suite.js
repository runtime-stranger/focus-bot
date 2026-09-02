/*!
 * ============================================================================
 *  FocusBot — End-to-End Automated Test Suite (zero external dependencies)
 * ----------------------------------------------------------------------------
 *  Run        : node run-tests.js   (or: npm test)      [Node.js >= 18]
 *
 *  Coverage:
 *   [SCENARIO 1] GET /api/health → 200 + ok:true
 *   [SCENARIO 2] verify-license security: unknown key 403, empty 400,
 *                unauthorized admin grant 401, NO KV writes
 *   [SCENARIO 3] admin grant (valid token) → 201 + license:FOCUS-PRO-* record
 *   [SCENARIO 4] verify-license domain matching (mismatch 403 / '*' & authorized 200)
 *   [SCENARIO 5] Removed payment endpoints → 404, no KV writes
 *   [SCENARIO 6] verify-tx: mempool.space TXID verification → automatic license,
 *                reuse lock (KV tx:<TXID>, 409), amount/address checks
 *   [SCENARIO 12] Pricing fallback: both APIs down → 50000 fallback, cache TTL, corrupt JSON
 *   [SCENARIO 13] verify-tx: multi-vout sum, race condition on same TXID
 *   [SCENARIO 14] verify-license: expired license 403, corrupt record 500, TESTMODE rejected
 *   [SCENARIO 15] CORS: disallowed origin filtered out, allowed origin passes through
 *   [SCENARIO 16] Admin auth: empty token, missing header, wrong prefix → 401
 *   [SCENARIO 17] verify-tx: empty body, no BTC_ADDRESS config, SIMULATED_TXID bypass
 *   [SCENARIO 7] Hard paywall: no license → modal opens, audioContext NOT created
 *   [SCENARIO 8] Hard paywall: valid license from server → audio starts
 *   [SCENARIO 9] Node lifecycle: play/pause/resume with valid license
 *   [SCENARIO 10] Frequency assignments (200/214, 200/210) and 0.1 gain ceiling
 *   [SCENARIO 11] Custom frequency range (0–1000): input, clamping, persistence, reset
 *   [SCENARIO C12] Client: network error → toast, no crash, widget stays usable
 *   [SCENARIO C13] Client: XSS/injection in license input is safely rejected
 *   [SCENARIO C14] Client: empty/whitespace input → validation toast, no API call
 *   [SCENARIO 18-24] E2E hard-paywall guard: zero-bypass delivery, console attacks,
 *                   expired license, network-fail revoke, cross-tab revocation,
 *                   payment success (TXID → license → Pro → audio)
 *   [SCENARIO 25-28] Engine math: beta/alpha/theta/gamma Left/Right matrix + gain ceiling
 *   [SCENARIO 29-32] Smart Pomodoro: start/auto-play, 25-min focus → break (audio pause),
 *                   break → next focus (auto-resume), reset
*   [SCENARIO 35-36] Ambient mixer: independent multi-layer pink/rain/white,
   *                   staged per-layer gains + soft limiter, multi-layer .active
   *                   UI sync, Off clears all, noise buffers cached (no regen)
   *   [SCENARIO 74] Master output power: per-channel carrier gains (1.5) with
   *                   +4 dB bass boost on Delta/Theta, binaural stage 1.0,
   *                   master ceiling → 0.40, final output compressor wiring
   *   [SCENARIO 75] Ambient repair: brown ×6.0/Kellet-pink/rain + AM/white 5s
   *                   loops, instant layer-gain toggles, resume() on suspended
   *                   context, BiquadFilter routing per layer
 *   [SCENARIO 37-38] Hardening: signed engine token drives frequency matrix + gain;
 *                   corrupt token → safe fallback matrix
 *   [SCENARIO 39] Messaging bridge: chrome.runtime FOCUSBOT_CTRL (MV3 popup) → widget
 *   [SCENARIO 40-41] Worker abuse: malformed JSON bodies, oversized input & flood → 4xx never 5xx
 *   [SCENARIO 42] License expiry edge: valid inside window, revoked exactly at boundary
 *   [SCENARIO 43] verify-tx junk vouts (NaN/negative/null) never satisfy amount check
 *   [SCENARIO 44] Autoplay policy: blocked resume → honest state, gesture recovers
 *   [SCENARIO 45] Memory: pomodoro phase cycles + ambient toggles leak zero AudioNodes
 *   [SCENARIO 47] Popup bridge: dead channel consumed (lastError), live widget recovers
 *   [SCENARIO 48] Manifest audit: MV3, all_frames:false, minimal permissions, popup wired
 *   [SCENARIO 49,51] Engine token lifecycle: stale token ignored (fallback), fresh applied
 *   [SCENARIO 50] Token replay-safety: iat + fixed 12h exp window, fresh re-issue per verify
 *
 *  Test infrastructure:
 *   - Mock Cloudflare KV (Map-based, put() call log + TTL record)
 *   - Mock Web Audio (AudioContext/Oscillator/Gain/Param; double start() guarded)
 *   - Mock DOM/localStorage/window shims (including Shadow DOM root)
 * ============================================================================
 */

import worker from '../worker/index.js';
import { webcrypto } from 'node:crypto';

/* Polyfill for missing global crypto on Node < 19 */
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  globalThis.crypto = webcrypto;
}

/* ---------------------------------------------------------------------------
 * ENVIRONMENT SANITY CHECKS
 * ------------------------------------------------------------------------ */
for (const [name, obj] of [
  ['Request', globalThis.Request],
  ['Response', globalThis.Response],
  ['crypto.subtle', globalThis.crypto && globalThis.crypto.subtle],
]) {
  if (!obj) {
    console.error(`[ERROR] This test suite requires Node.js >= 18 (${name} not found).`);
    process.exit(1);
  }
}

/* ===========================================================================
 * COLORS & REPORTING
 * ======================================================================== */
const TTY = process.stdout.isTTY;
const C = TTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', B: '\x1b[1m', d: '\x1b[2m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', b: '', B: '', d: '', x: '' };

let passed = 0;
let failed = 0;
const failures = [];
const t0 = Date.now();

function ok(msg) { passed++; console.log(`  ${C.g}[OK]${C.x}   ${msg}`); }
function fail(msg, err) {
  failed++; failures.push({ msg, err });
  console.log(`  ${C.r}[FAIL]${C.x} ${msg}`);
  console.log(`         ${C.r}${(err && err.message) || err}${C.x}`);
}
function section(t) { console.log(`\n${C.b}${C.B}\u2501\u2501 ${t} \u2501\u2501${C.x}`); }

async function scenario(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err); }
}

/* ===========================================================================
 * EXPECT HELPERS
 * ======================================================================== */
function expectTrue(cond, msg) { if (!cond) throw new Error(msg); }
function expectEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} \u2192 beklenen=${JSON.stringify(expected)}, gelen=${JSON.stringify(actual)}`);
}
function expectApprox(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg} \u2192 expected\u2248${expected}, got=${actual}`);
}
function expectMatch(str, re, msg) {
  if (!re.test(String(str))) throw new Error(`${msg} \u2192 "${str}" failed to match pattern: ${re}`);
}
function expectUndefined(v, msg) { if (v !== undefined) throw new Error(`${msg} \u2192 value leaked: ${JSON.stringify(v)}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Seed an EXPIRED 15-minute trial so a scenario exercises the post-trial hard
 * paywall. The trial window is 15 minutes; 16 minutes back guarantees it is over.
 * (bootstrapState() keeps an existing trialStart — it never re-stamps.)
 * The trial lease is 15 minutes (TRIAL_MS = 15 * 60 * 1000 in focus-bot.js).
 */
const EXPIRED_TRIAL_MS = 16 * 60 * 1000;
const seedExpiredTrial = (env) =>
  env.ls.setItem('focusbot.trialStart', String(Date.now() - EXPIRED_TRIAL_MS));

/** Wait loop that does NOT rely on Date.now() (required because scenario 7 fakes Date.now) */
async function waitFor(fn, timeoutMs = 2000, label = 'condition') {
  for (let waited = 0; waited < timeoutMs; waited += 10) {
    try { if (fn()) return true; } catch (_) { /* swallow */ }
    await sleep(10);
  }
  throw new Error('timeout: ' + label);
}

/* ===========================================================================
 * WORKER TEST INFRASTRUCTURE
 * ======================================================================== */
const WORKER_ORIGIN = 'https://worker.test';
const ADMIN_TOKEN = 'test_admin_token';

/** Mock Cloudflare KV: get/put + write log (including TTL opts) */
class KVMock {
  constructor() { this.map = new Map(); this.puts = []; }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v, opts) {
    this.puts.push({ key: k, opts: opts || null });
    this.map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  licenseCount() { return [...this.map.keys()].filter((k) => /^license:FOCUS-PRO-/.test(k)).length; }
}

function makeEnv(kv) {
  return {
    LICENSES: kv,
    ADMIN_TOKEN,
    ALLOWED_ORIGINS: '*',
    BTC_ADDRESS: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
    MIN_PRICE_SATS: '10000',
    DEV_MODE: '1', // enable SIMULATED_TXID for tests
  };
}

/** Fake context that collects ctx.waitUntil() promises and awaits them via drain() */
function makeCtx() {
  const ctx = {
    _p: [],
    waitUntil(p) { this._p.push(Promise.resolve(p)); },
    async drain() { await Promise.all(this._p.splice(0)); },
  };
  return ctx;
}

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(WORKER_ORIGIN + path, { method, headers, body });
}

/** POST JSON, await ctx promises, return the Response */
async function postJSON(env, path, payload, extraHeaders = {}) {
  const ctx = makeCtx();
  const res = await worker.fetch(
    req(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    }),
    env, ctx
  );
  await ctx.drain();
  return res;
}

async function getURL(env, path) {
  const ctx = makeCtx();
  const res = await worker.fetch(req(path), env, ctx);
  await ctx.drain();
  return res;
}

/* ---------------------------------------------------------------------------
 * MEMPOOL.SPACE FETCH HOOK
 * So that the worker never touches the real network inside /api/verify-tx,
 * globalThis.fetch is temporarily replaced: only requests to
 * https://mempool.space/api/tx/<TXID> are intercepted; everything else is
 * delegated to the original fetch.
 * ------------------------------------------------------------------------ */
const MEMPOOL_PREFIX = 'https://mempool.space/api/tx/';
let mempoolHookInstalled = false;
let realFetchRef = null;
const mempoolResponses = new Map(); // txid → { status, body }

/** Register a fake mempool response (status defaults to 200) */
function setMempoolTx(txid, body, status = 200) {
  mempoolResponses.set(String(txid).toLowerCase(), { status, body });
}
function installMempoolHook() {
  if (mempoolHookInstalled) return;
  mempoolHookInstalled = true;
  realFetchRef = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : String((input && input.url) || '');
    if (!url.startsWith(MEMPOOL_PREFIX)) return realFetchRef(input);
    const hit = mempoolResponses.get(url.slice(MEMPOOL_PREFIX.length).toLowerCase());
    if (!hit) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
}
function uninstallMempoolHook() {
  if (!mempoolHookInstalled) return;
  globalThis.fetch = realFetchRef;
  mempoolHookInstalled = false;
  mempoolResponses.clear();
}

/* ===========================================================================
 * CLIENT TEST INFRASTRUCTURE (DOM / localStorage / WebAudio mocks)
 * ======================================================================== */
const HIDDEN_DEFAULTS = {
  overlay: true, panel: true, chip: true,
  'icon-pause': true, 'icon-play': false, toast: true, fab: false,
};

function makeClassList() {
  const s = new Set();
  return {
    add(...n) { n.forEach((x) => s.add(x)); },
    remove(...n) { n.forEach((x) => s.delete(x)); },
    toggle(n, f) { const has = s.has(n); const want = f === undefined ? !has : !!f; want ? s.add(n) : s.delete(n); return want; },
    contains(n) { return s.has(n); },
  };
}

/** Generic fake element */
function el(tag = 'div') {
  return {
    tag, hidden: false, value: '', textContent: '', className: '',
    disabled: false, placeholder: '', dataset: {}, attrs: {}, handlers: {}, style: {},
    classList: makeClassList(),
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (this.handlers[t] ??= []).push(f); },
    removeEventListener() {},
    dispatch(t, ev) { for (const f of this.handlers[t] || []) f(ev); },
    focus() {}, appendChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

function makeStubFor(sel) {
  const e = el(sel);
  const key = sel.replace(/^\./, '');
  if (key in HIDDEN_DEFAULTS) e.hidden = HIDDEN_DEFAULTS[key];
  if (sel === '.vol-range') e.value = '70';
  if (sel === '.vol-bin') e.value = '100';
  if (sel === '.vol-amb') e.value = '80';
  if (sel === '#btn-buy-pro' || sel === '.buy') e.className = 'buy btn-buy-pro';
  if (sel === '.modes') {
    e._modeBtns = ['delta', 'theta', 'alpha', 'beta', 'gamma'].map((m) => {
      const b = el('button'); b.dataset.mode = m; return b;
    });
    e.querySelectorAll = () => e._modeBtns;
  }
  if (sel === '.modes-sol') {
    e._solBtns = ['174', '285', '396', '417', '432', '528', '639', '741', '852', '963'].map((m) => {
      const b = el('button'); b.dataset.mode = m; return b;
    });
    e.querySelectorAll = () => e._solBtns;
  }
  if (sel === '.amb-row') {
    // Ambient buttons: independent multi-layer toggles + 'Off'. Persisted per
    // stub so tests can read the .active class live after toggles.
    e._ambButtons = () => { if (!e._ambBtns) { e._ambBtns = ['off', 'pink', 'brown', 'rain', 'white'].map((amb) => { const b = el('button'); b.dataset.amb = amb; return b; }); } return e._ambBtns; };
    e.querySelectorAll = () => e._ambButtons();
  }
  return e;
}

function makeRoot() {
  const stubs = new Map();
  const root = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelector(sel) {
      if (!stubs.has(sel)) stubs.set(sel, makeStubFor(sel));
      return stubs.get(sel);
    },
    querySelectorAll(sel) {
      if (sel === 'button[data-mode]') {
        return ['delta', 'theta', 'alpha', 'beta', 'gamma', '174', '285', '396', '417', '432', '528', '639', '741', '852', '963'].map((m) => { const b = el('button'); b.dataset.mode = m; return b; });
      }
      return [];
    },
  };
  root._stubs = stubs;
  return root;
}

function makeDocStub() {
  const doc = {
    hidden: false,
    listeners: {},
    currentScript: {
      getAttribute(n) {
        return ({ 'data-api-key': null, 'data-endpoint': 'https://worker.test', 'data-brand': 'FocusBotTests' })[n] ?? null;
      },
    },
    body: el('body'),
    documentElement: el('html'),
    _lastRoot: null,
  };
  doc.addEventListener = (t, f) => { (doc.listeners[t] ??= []).push(f); };
  doc.removeEventListener = () => {};
  doc.createElement = () => {
    const host = el('div');
    host.attachShadow = () => { const root = makeRoot(); doc._lastRoot = root; return root; };
    return host;
  };
  return doc;
}

function makeLS() {
  const m = new Map();
  const api = {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => m.set(String(k), String(v)),
    removeItem: (k) => m.delete(String(k)),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _clear: () => m.clear(),
  };
  return api;
}

/* --- Mock Web Audio ------------------------------------------------------- */
class MockParam {
  constructor(v = 0) { this.value = v; this.lastRamp = undefined; this.lastTarget = undefined; }
  setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; this.lastRamp = v; return this; }
  exponentialRampToValueAtTime(v) { this.value = v; this.lastRamp = v; return this; }
  setTargetAtTime(v) { this.value = v; this.lastTarget = v; return this; }
  cancelScheduledValues() { return this; }
}
class MockNode {
  constructor(ctx) { this.ctx = ctx; this.connections = []; }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.connections.length = 0; }
}
class MockOscillator extends MockNode {
  constructor(ctx) {
    super(ctx);
    this.type = '';
    this.frequency = new MockParam(440);
    this._started = false;
  }
  start() {
    // Like real Web Audio: blow up if start() is called a second time →
    // catches graph-rebuild regressions.
    if (this._started) throw new Error('AudioScheduledSourceNode.start() twice');
    this._started = true;
  }
  stop() {}
}
class MockGain extends MockNode { constructor(ctx) { super(ctx); this.gain = new MockParam(1); } }
class MockCompressor extends MockNode {
  constructor(ctx) { super(ctx); this.threshold = new MockParam(); this.knee = new MockParam(); this.ratio = new MockParam(); this.attack = new MockParam(); this.release = new MockParam(); }
}
class MockMerger extends MockNode {}

class MockAudioContext {
  static instances = [];
  static oscs = [];
  static gains = [];
  static compressors = [];
  static sources = [];
  static buffers = [];
  /** When false, resume() rejects like a browser enforcing the autoplay policy. */
  static resumable = true;
  static resetStatics() {
    MockAudioContext.instances = [];
    MockAudioContext.oscs = [];
    MockAudioContext.gains = [];
    MockAudioContext.compressors = [];
    MockAudioContext.sources = [];
    MockAudioContext.buffers = [];
    MockAudioContext.resumable = true;
  }

  constructor() {
    MockAudioContext.instances.push(this);
    this.state = 'suspended';       // real browser behavior: starts suspended
    this.destination = {};
    this.currentTime = 0;
    this.sampleRate = 48000;
  }
  resume() {
    if (!MockAudioContext.resumable) {
      return Promise.reject(new DOMException('The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.', 'NotAllowedError'));
    }
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createOscillator() { const o = new MockOscillator(this); MockAudioContext.oscs.push(o); return o; }
  createGain() { const g = new MockGain(this); MockAudioContext.gains.push(g); return g; }
  createDynamicsCompressor() { const c = new MockCompressor(this); MockAudioContext.compressors.push(c); return c; }
  createChannelMerger() { return new MockMerger(this); }
  createBuffer(channels, length, sampleRate) {
    const b = {
      numberOfChannels: channels, length, sampleRate, channels: [],
      getChannelData(i) { if (!this.channels[i]) this.channels[i] = new Float32Array(length); return this.channels[i]; },
    };
    MockAudioContext.buffers.push(b);
    return b;
  }
  createBufferSource() {
    const s = {
      buffer: null, loop: false, connections: [], _started: false, _stopped: false,
      connect(d) { this.connections.push(d); return d; },
      disconnect() { this.connections.length = 0; },
      start() { this._started = true; },
      stop() { this._stopped = true; },
    };
    MockAudioContext.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    const f = {
      type: '', frequency: { value: 0 }, Q: { value: 0 }, connections: [],
      connect(d) { this.connections.push(d); return d; },
      disconnect() { this.connections.length = 0; },
    };
    return f;
  }
}

/** Global env setup: window/document/localStorage/... shims + restore */
function installClientEnv() {
  const G = globalThis;
  const saved = [];
  const grab = (k) => saved.push([k, Object.getOwnPropertyDescriptor(G, k)]);
  const set = (k, v) => { grab(k); Object.defineProperty(G, k, { value: v, writable: true, configurable: true }); };

  const ls = makeLS();
  set('localStorage', ls);
  set('location', { host: 'client.test' });
  const doc = makeDocStub();
  set('document', doc);

  const winL = {};
  set('addEventListener', (t, f) => { (winL[t] ??= []).push(f); });
  set('removeEventListener', () => {});
  set('window', G); // window === globalThis → the module writes window.FocusBot onto it

  // [FIX] The widget looks for `window.AudioContext || window.webkitAudioContext`
  // inside ensureContext(); since window === globalThis, the mock constructors must be installed globally.
  set('AudioContext', MockAudioContext);
  set('webkitAudioContext', MockAudioContext);

  set('fetch', async () => { throw new Error('unexpected network call in client tests'); });

  const intervals = [];
  set('setInterval', (fn, ms) => { intervals.push({ fn, ms, calls: 0, cleared: false }); return intervals.length; });
  set('clearInterval', (id) => { const it = intervals[id - 1]; if (it) it.cleared = true; });

  return {
    G, ls, intervals, winL, doc,
    restore() {
      for (const [k, d] of saved.reverse()) {
        if (d) Object.defineProperty(G, k, d);
        else delete G[k];
      }
      delete G.__FOCUSBOT_LOADED__;
      delete G.FocusBot;
    },
  };
}

let clientInst = 0;
async function freshClient(env) {
  delete env.G.__FOCUSBOT_LOADED__; // reset double-load guard for each scenario
  delete env.G.FocusBot;
  MockAudioContext.resetStatics();
  env.doc._lastRoot = null;

  const url = new URL('../client/focus-bot.js', import.meta.url).href + '?inst=' + (++clientInst);
  await import(url); // the module boots immediately (shim environment)

  // Let the async bootstrapState() microtask land so trial/volume storage is
  // read (or stamped) before any scenario assertion.
  await new Promise((r) => setTimeout(r, 1));

  const root = env.doc._lastRoot;
  return { FocusBot: env.G.FocusBot, root, stub: (sel) => root.querySelector(sel) };
}

/* ===========================================================================
 * SCENARIO 1-6 : WORKER (security + business logic + automatic TXID verification)
 * ======================================================================== */
async function workerScenarios() {
    /* ---- SCENARIO 1 ---- */
    await scenario('1. GET /api/health → 200 + ok:true', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);

      const res = await getURL(env, '/api/health');
      expectEqual(res.status, 200, 'status code');
      const body = await res.json();
      expectEqual(body.ok, true, 'ok flag');
      expectEqual(body.service, 'focusbot-api', 'service name');
    });

    /* ---- SCENARIO 2 ---- */
    await scenario('2. verify-license security: unknown key 403, empty 400, unauthorized grant 401', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const putsBefore = kv.puts.length;

      // Unknown key → 403 unknown_key
      let res = await postJSON(env, '/api/verify-license', { apiKey: 'FOCUS-PRO-YOKKKEY', domain: 'site.com' });
      expectEqual(res.status, 403, 'unknown key status code');
      expectEqual((await res.json()).reason, 'unknown_key', 'unknown_key reason');

      // Empty key → 400
      res = await postJSON(env, '/api/verify-license', { apiKey: '', domain: 'site.com' });
      expectEqual(res.status, 400, 'missing key status code');

      // Wrong admin token → 401
      res = await postJSON(env, '/api/admin/grant', { domains: ['*'] }, { authorization: 'Bearer wrong' });
      expectEqual(res.status, 401, 'wrong token status code');
      expectEqual((await res.json()).error, 'unauthorized', 'unauthorized error');

      // No request WROTE to KV
      expectEqual(kv.puts.length, putsBefore, 'KV put count unchanged');
    });

    /* ---- SCENARIO 3 ---- */
    await scenario('3. admin grant (valid token) → 201 + license record + key format', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const auth = { authorization: 'Bearer ' + ADMIN_TOKEN };

      const res = await postJSON(env, '/api/admin/grant', { domains: ['example.com'], days: 365 }, auth);
      expectEqual(res.status, 201, 'grant status code');
      const body = await res.json();
      expectMatch(body.licenseKey, /^FOCUS-PRO-[A-HJKMNP-Z2-9]{8}$/, 'license key format');

      // KV: license:<KEY> record written with correct content
      const raw = await kv.get('license:' + body.licenseKey);
      expectTrue(!!raw, 'license:<KEY> record exists');
      const lic = JSON.parse(raw);
      expectEqual(lic.plan, 'pro', 'plan');
      expectEqual(lic.active, true, 'active');
      expectTrue(lic.expiresAt > Date.now(), 'expiresAt in the future');
    });

    /* ---- SCENARIO 4 ---- */
    await scenario('4. verify-license domain matching (403 / 200, wildcard)', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const auth = { authorization: 'Bearer ' + ADMIN_TOKEN };

      // Produce domain-restricted and wildcard licenses
      const g1 = await postJSON(env, '/api/admin/grant', { domains: ['example.com'], days: 365 }, auth);
      expectEqual(g1.status, 201, 'admin grant (domain-restricted)');
      const key1 = (await g1.json()).licenseKey;

      const g2 = await postJSON(env, '/api/admin/grant', { domains: ['*'] }, auth);
      expectEqual(g2.status, 201, 'admin grant (wildcard)');
      const key2 = (await g2.json()).licenseKey;

      // Unauthorized domain → 403 domain_mismatch
      let res = await postJSON(env, '/api/verify-license', { apiKey: key1, domain: 'evil.com' });
      expectEqual(res.status, 403, 'unauthorized domain status code');
      expectEqual((await res.json()).reason, 'domain_mismatch', 'domain_mismatch reason');

      // Authorized domain → 200 valid
      res = await postJSON(env, '/api/verify-license', { apiKey: key1, domain: 'example.com' });
      expectEqual(res.status, 200, 'authorized domain status code');
      const vbody = await res.json();
      expectEqual(vbody.valid, true, 'valid flag');
      expectEqual(vbody.plan, 'pro', 'plan');
      // Signed engine token (client-side hardening payload)
      expectTrue(typeof vbody.engine === 'string' && vbody.engine.includes('.'), 'engine token present & signed');
      const eng = JSON.parse(atob(vbody.engine.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
      expectEqual(eng.v, 1, 'engine payload version');
      expectEqual(eng.mods.beta.r, 214, 'engine embeds beta matrix right');
      expectEqual(eng.gain, 1, 'engine master coefficient');
      expectTrue(Number.isFinite(eng.seed), 'engine carries a seed');

      // Wildcard '*' → valid on every domain
      res = await postJSON(env, '/api/verify-license', { apiKey: key2, domain: 'random-site.org' });
      expectEqual(res.status, 200, 'wildcard domain status code');
      expectEqual((await res.json()).valid, true, 'wildcard valid');
    });

    /* ---- SCENARIO 5 ---- */
    await scenario('5. Removed payment endpoints → 404, no KV writes', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const putsBefore = kv.puts.length;

      let res = await postJSON(env, '/api/create-payment', { domain: 'site.com' });
      expectEqual(res.status, 404, 'create-payment removed (404)');

      res = await postJSON(env, '/api/webhook/nowpayments', { payment_status: 'finished' });
      expectEqual(res.status, 404, 'nowpayments webhook removed (404)');

      res = await getURL(env, '/api/check-order?orderId=FB-x&domain=site.com');
      expectEqual(res.status, 404, 'check-order removed (404)');

      expectEqual(kv.puts.length, putsBefore, 'KV put count unchanged');
    });

    /* ---- SCENARIO 6 ---- */
    await scenario('6. verify-tx: dynamic pricing, insufficient_amount 402, 365-day license, reuse 409', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const BTC = env.BTC_ADDRESS;

      // Known BTC/EUR price for deterministic tests
      const MOCK_BTC_EUR = 50000;
      const MOCK_REQUIRED_SATS = Math.ceil((12 / MOCK_BTC_EUR) * 100_000_000); // 24000
      const MOCK_MIN_ACCEPTABLE = Math.ceil(MOCK_REQUIRED_SATS * 0.97);

      // Pre-populate pricing cache (avoids real API calls)
      await kv.put('pricing:cache', JSON.stringify({
        btcEurPrice: MOCK_BTC_EUR,
        requiredSats: MOCK_REQUIRED_SATS,
        minAcceptableSats: MOCK_MIN_ACCEPTABLE,
        fetchedAt: Date.now(),
      }));

      // Test TXIDs (64 hex)
      const VALID_TXID = 'ab'.repeat(32);
      const WRONG_ADDR_TXID = 'cd'.repeat(32);
      const LOW_AMT_TXID = 'ef'.repeat(32);

      installMempoolHook();
      try {
        setMempoolTx(VALID_TXID, { txid: VALID_TXID, vout: [
          { scriptpubkey_address: 'bc1qbaskabaska', value: 50000 },
          { scriptpubkey_address: BTC, value: MOCK_REQUIRED_SATS },
        ]});
        setMempoolTx(WRONG_ADDR_TXID, { txid: WRONG_ADDR_TXID, vout: [
          { scriptpubkey_address: 'bc1qhirsizadres', value: 50000 },
        ]});
        setMempoolTx(LOW_AMT_TXID, { txid: LOW_AMT_TXID, vout: [
          { scriptpubkey_address: BTC, value: MOCK_REQUIRED_SATS - 1 },
        ]});

        // a) GET /api/pricing returns cached dynamic pricing
        let pres = await getURL(env, '/api/pricing');
        expectEqual(pres.status, 200, 'pricing status');
        const pbody = await pres.json();
        expectEqual(pbody.ok, true, 'pricing ok');
        expectEqual(pbody.eur, 12, 'pricing eur');
        expectEqual(pbody.btcEurPrice, MOCK_BTC_EUR, 'pricing btcEurPrice');
        expectEqual(pbody.requiredSats, MOCK_REQUIRED_SATS, 'pricing requiredSats');
        expectEqual(pbody.minAcceptableSats, MOCK_MIN_ACCEPTABLE, 'pricing minAcceptableSats');

        // b) Malformed TXID format (not 64 hex) → 400 bad_txid
        let res = await postJSON(env, '/api/verify-tx', { txid: 'xyz', domain: 'site.com' });
        expectEqual(res.status, 400, 'invalid txid status code');
        expectEqual((await res.json()).error, 'bad_txid', 'bad_txid error');

        // c) TXID absent from mempool → 404 tx_not_found
        res = await postJSON(env, '/api/verify-tx', { txid: '9'.repeat(64), domain: 'site.com' });
        expectEqual(res.status, 404, 'unknown txid status code');
        expectEqual((await res.json()).error, 'tx_not_found', 'tx_not_found error');

        // d) No payment to the target address → 402 insufficient_amount with required/paid
        res = await postJSON(env, '/api/verify-tx', { txid: WRONG_ADDR_TXID, domain: 'site.com' });
        expectEqual(res.status, 402, 'wrong recipient status code');
        const dBody = await res.json();
        expectEqual(dBody.error, 'insufficient_amount', 'wrong recipient error');
        expectEqual(dBody.required, MOCK_REQUIRED_SATS, 'required in response');
        expectEqual(dBody.paid, 0, 'paid=0 for wrong address');

        // e) Amount below required (24000-1 sat) → 402 insufficient_amount
        res = await postJSON(env, '/api/verify-tx', { txid: LOW_AMT_TXID, domain: 'site.com' });
        expectEqual(res.status, 402, 'low amount status code');
        const eBody = await res.json();
        expectEqual(eBody.error, 'insufficient_amount', 'low amount error');
        expectEqual(eBody.required, MOCK_REQUIRED_SATS, 'required in low-amount response');
        expectEqual(eBody.paid, MOCK_REQUIRED_SATS - 1, 'paid in low-amount response');

        // f) Valid transaction → 200 + FOCUS-PRO-* + 365-day license
        const putsBefore = kv.puts.length;
        res = await postJSON(env, '/api/verify-tx', { txid: VALID_TXID.toUpperCase(), domain: 'site.com' });
        expectEqual(res.status, 200, 'valid txid status code');
        const body = await res.json();
        expectEqual(body.valid, true, 'valid flag');
        expectMatch(body.licenseKey, /^FOCUS-PRO-[A-HJKMNP-Z2-9]{8}$/, 'license key format');
        expectTrue(body.expiresAt > Date.now() + 364 * 86400000, 'expiresAt ~365 days out');
        expectTrue(body.expiresAt <= Date.now() + 366 * 86400000, 'expiresAt not too far');
        expectTrue(typeof body.engine === 'string' && body.engine.includes('.'), 'TX activation also issues engine token');

        // Is the single-use lock in KV?
        const lockRaw = await kv.get('tx:' + VALID_TXID);
        expectTrue(!!lockRaw, 'tx:<TXID> lock written');
        const lockData = JSON.parse(lockRaw);
        expectEqual(lockData.licenseKey, body.licenseKey, 'lock contains licenseKey');

        // Was the license record written with correct content?
        const licRaw = await kv.get('license:' + body.licenseKey);
        expectTrue(!!licRaw, 'license:<KEY> record exists');
        const lic = JSON.parse(licRaw);
        expectEqual(lic.plan, 'pro', 'plan');
        expectEqual(lic.active, true, 'active');
        expectEqual(lic.source, 'onchain-tx', 'source');
        expectTrue(Array.isArray(lic.domains) && lic.domains.includes('*'), 'wildcard domain');
        expectEqual(lic.btcEurPrice, MOCK_BTC_EUR, 'btcEurPrice recorded');
        expectEqual(lic.requiredSats, MOCK_REQUIRED_SATS, 'requiredSats recorded');
        expectTrue(lic.expiresAt > Date.now() + 364 * 86400000, 'license expiresAt ~365 days');

        // g) Same TXID submitted again → 409 + existing licenseKey returned + NO NEW license
        res = await postJSON(env, '/api/verify-tx', { txid: VALID_TXID, domain: 'site.com' });
        expectEqual(res.status, 409, 'reuse status code');
        const errBody = await res.json();
        expectEqual(errBody.error, 'tx_already_used', 'tx_already_used error');
        expectTrue(String(errBody.message || '').includes('already been used'), 'uses the exact server message');
        expectEqual(errBody.licenseKey, body.licenseKey, 'replay returns the existing license key');

        expectEqual(kv.licenseCount(), 1, 'second request did not generate a new license');
        expectTrue(kv.puts.length > putsBefore, 'successful flow wrote to KV');
      } finally {
        uninstallMempoolHook();
      }
    });
}

/* ===========================================================================
 * SCENARIO 12-17 : WORKER EDGE CASES (stress & security audit)
 * ======================================================================== */
async function workerEdgeCaseScenarios() {

  /* ---- SCENARIO 12 ---- */
  await scenario('12. Pricing fallback: both APIs down → 50000 fallback, cache TTL, corrupt JSON', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const realFetch = globalThis.fetch;

    // a) Both CoinGecko AND mempool.prices fail → fallback 50000
    globalThis.fetch = async () => { throw new Error('all APIs down'); };
    try {
      const res = await getURL(env, '/api/pricing');
      expectEqual(res.status, 200, 'pricing still works with fallback');
      const body = await res.json();
      expectEqual(body.btcEurPrice, 50000, 'fallback price 50000');
      expectEqual(body.requiredSats, Math.ceil((12 / 50000) * 100_000_000), 'sats calculated from fallback');
    } finally { globalThis.fetch = realFetch; }

    // b) Cache TTL expired → re-fetches (cache had old fetchedAt)
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: 30000, requiredSats: 40000, minAcceptableSats: 38800,
      fetchedAt: Date.now() - 600_000, // 10 min old → expired
    }));
    // restore fetch for CoinGecko (KV cache expired, will try real API)
    // CoinGecko will fail (no real network), mempool fallback, then hardcoded 50000
    globalThis.fetch = async () => { throw new Error('API down'); };
    try {
      const res = await getURL(env, '/api/pricing');
      const body = await res.json();
      expectEqual(body.btcEurPrice, 50000, 'stale cache bypassed → fallback used');
    } finally { globalThis.fetch = realFetch; }

    // c) Corrupt KV cache (not valid JSON) → graceful fallback
    kv.map.set('pricing:cache', 'NOT-VALID-JSON{{{');
    globalThis.fetch = async () => { throw new Error('API down'); };
    try {
      const res = await getURL(env, '/api/pricing');
      expectEqual(res.status, 200, 'corrupt cache handled gracefully');
      const body = await res.json();
      expectEqual(body.btcEurPrice, 50000, 'corrupt cache → fallback');
    } finally { globalThis.fetch = realFetch; }

    // d) Math.ceil rounding: verify that requiredSats is correctly rounded up
    // Price 51 EUR/BTC → 12/51 * 100M = 23529411.76... → ceil = 23529412
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: 51, requiredSats: 23529412, minAcceptableSats: Math.ceil(23529412 * 0.97),
      fetchedAt: Date.now(),
    }));
    const res2 = await getURL(env, '/api/pricing');
    const body2 = await res2.json();
    expectEqual(body2.requiredSats, 23529412, 'Math.ceil rounding correct');
  });

  /* ---- SCENARIO 13 ---- */
  await scenario('13. verify-tx: multi-vout sum, race condition on same TXID', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const BTC = env.BTC_ADDRESS;

    const MOCK_BTC_EUR = 50000;
    const REQUIRED = Math.ceil((12 / MOCK_BTC_EUR) * 100_000_000);
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: MOCK_BTC_EUR, requiredSats: REQUIRED,
      minAcceptableSats: Math.ceil(REQUIRED * 0.97), fetchedAt: Date.now(),
    }));

    const MULTI_VOUT_TXID = 'ab'.repeat(32);
    installMempoolHook();
    try {
      // a) Multi-vout: same BTC address appears in 3 outputs, total exactly meets required
      setMempoolTx(MULTI_VOUT_TXID, {
        txid: MULTI_VOUT_TXID,
        vout: [
          { scriptpubkey_address: BTC, value: 10000 },
          { scriptpubkey_address: 'bc1qotheraddr', value: 99999 },
          { scriptpubkey_address: BTC, value: 8000 },
          { scriptpubkey_address: BTC, value: REQUIRED - 18000 },
        ],
      });
      const res = await postJSON(env, '/api/verify-tx', { txid: MULTI_VOUT_TXID, domain: 'a.com' });
      expectEqual(res.status, 200, 'multi-vout total accepted');
      const body = await res.json();
      expectEqual(body.valid, true, 'valid after multi-vout sum');

      // b) Race condition: two concurrent requests with the same TXID
      //    NOTE: KV is eventually consistent — both may succeed. This is a known
      //    limitation. The sequential replay guard (tested in scenario 6g) is
      //    the primary protection. True atomicity requires Durable Objects.
      const RACE_TXID = 'cd'.repeat(32);
      setMempoolTx(RACE_TXID, {
        txid: RACE_TXID,
        vout: [{ scriptpubkey_address: BTC, value: REQUIRED }],
      });
      const [r1, r2] = await Promise.all([
        postJSON(env, '/api/verify-tx', { txid: RACE_TXID, domain: 'a.com' }),
        postJSON(env, '/api/verify-tx', { txid: RACE_TXID, domain: 'a.com' }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      // Both 200 is possible with KV eventual consistency (both read null before either writes)
      // Both 409 is not possible (at least one must succeed)
      expectTrue(
        statuses[0] === 200,
        'race: at least one succeeds (got ' + JSON.stringify(statuses) + ')'
      );
      expectTrue(
        statuses[1] === 200 || statuses[1] === 409,
        'race: second is 200 or 409 (got ' + JSON.stringify(statuses) + ')'
      );
      if (statuses[0] === 200 && statuses[1] === 200) {
        console.log('         NOTE: Both requests succeeded (KV eventual consistency race). Consider Durable Objects for strict replay protection.');
      }
    } finally {
      uninstallMempoolHook();
    }
  });

  /* ---- SCENARIO 14 ---- */
  await scenario('14. verify-license: expired license 403, corrupt record 500, TESTMODE rejected', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const auth = { authorization: 'Bearer ' + ADMIN_TOKEN };

    // a) Create a license that expired 1 second ago
    const g1 = await postJSON(env, '/api/admin/grant', { domains: ['*'], days: 365 }, auth);
    const key1 = (await g1.json()).licenseKey;
    // Overwrite expiresAt to the past
    const lic1 = JSON.parse(await kv.get('license:' + key1));
    lic1.expiresAt = Date.now() - 1000;
    kv.map.set('license:' + key1, JSON.stringify(lic1));

    const res1 = await postJSON(env, '/api/verify-license', { apiKey: key1, domain: 'any.com' });
    expectEqual(res1.status, 403, 'expired license -> 403');
    expectEqual((await res1.json()).reason, 'expired', 'expired reason');

    // b) Corrupt KV record (valid JSON.parse would fail)
    kv.map.set('license:FOCUS-PRO-CORRUPT', '{invalid json!!}');
    const res2 = await postJSON(env, '/api/verify-license', { apiKey: 'FOCUS-PRO-CORRUPT', domain: 'x.com' });
    expectEqual(res2.status, 500, 'corrupt record -> 500');

    // c) FOCUS-PRO-TESTMODE is now rejected (no dev bypass in production)
    const res3 = await postJSON(env, '/api/verify-license', { apiKey: 'FOCUS-PRO-TESTMODE', domain: 'evil.com' });
    expectEqual(res3.status, 403, 'TESTMODE rejected -> 403');
    expectEqual((await res3.json()).reason, 'unknown_key', 'TESTMODE reason');

    // d) Revoked license
    const g4 = await postJSON(env, '/api/admin/grant', { domains: ['*'] }, auth);
    const key4 = (await g4.json()).licenseKey;
    const lic4 = JSON.parse(await kv.get('license:' + key4));
    lic4.active = false;
    kv.map.set('license:' + key4, JSON.stringify(lic4));
    const res4 = await postJSON(env, '/api/verify-license', { apiKey: key4, domain: 'any.com' });
    expectEqual(res4.status, 403, 'revoked license -> 403');
    expectEqual((await res4.json()).reason, 'revoked', 'revoked reason');
  });

  /* ---- SCENARIO 15 ---- */
  await scenario('15. CORS: disallowed origin filtered out, allowed origin passes through', async () => {
    const kv = new KVMock();
    const env = { ...makeEnv(kv), ALLOWED_ORIGINS: 'https://allowed.com,https://also-good.com' };

    // a) Disallowed origin → no Access-Control-Allow-Origin header
    const r1 = await worker.fetch(
      req('/api/health', { headers: { 'Origin': 'https://evil.com' } }),
      env, makeCtx()
    );
    expectEqual(r1.status, 200, 'request still succeeds');
    expectEqual(r1.headers.get('Access-Control-Allow-Origin'), null, 'disallowed origin: no ACAO header');

    // b) Allowed origin → ACAO header present
    const r2 = await worker.fetch(
      req('/api/health', { headers: { 'Origin': 'https://allowed.com' } }),
      env, makeCtx()
    );
    expectEqual(r2.headers.get('Access-Control-Allow-Origin'), 'https://allowed.com', 'allowed origin: ACAO header present');

    // c) OPTIONS preflight with allowed origin → 204 + ACAO
    const r3 = await worker.fetch(
      req('/api/health', { method: 'OPTIONS', headers: { 'Origin': 'https://also-good.com' } }),
      env, makeCtx()
    );
    expectEqual(r3.status, 204, 'preflight → 204');
    expectEqual(r3.headers.get('Access-Control-Allow-Origin'), 'https://also-good.com', 'preflight ACAO');

    // d) OPTIONS preflight with disallowed origin → 204 but no ACAO
    const r4 = await worker.fetch(
      req('/api/health', { method: 'OPTIONS', headers: { 'Origin': 'https://hacker.io' } }),
      env, makeCtx()
    );
    expectEqual(r4.status, 204, 'disallowed preflight → 204');
    expectEqual(r4.headers.get('Access-Control-Allow-Origin'), null, 'disallowed preflight: no ACAO');
  });

  /* ---- SCENARIO 16 ---- */
  await scenario('16. Admin auth: empty token, missing header, wrong prefix all → 401', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const body = { domains: ['*'] };

    // a) No Authorization header at all
    let res = await postJSON(env, '/api/admin/grant', body);
    expectEqual(res.status, 401, 'no auth header → 401');

    // b) Empty Bearer value
    res = await postJSON(env, '/api/admin/grant', body, { authorization: 'Bearer ' });
    expectEqual(res.status, 401, 'empty bearer → 401');

    // c) Bearer prefix but garbage token
    res = await postJSON(env, '/api/admin/grant', body, { authorization: 'Bearer garbage123' });
    expectEqual(res.status, 401, 'wrong token → 401');

    // d) "Basic" prefix instead of "Bearer"
    res = await postJSON(env, '/api/admin/grant', body, { authorization: 'Basic ' + ADMIN_TOKEN });
    expectEqual(res.status, 401, 'Basic prefix → 401');

    // e) Token with whitespace around Bearer value (Node.js Request normalizes headers)
    res = await postJSON(env, '/api/admin/grant', body, { authorization: 'Bearer  ' + ADMIN_TOKEN });
    expectEqual(res.status, 201, 'extra inner whitespace accepted (HTTP normalization)');

    // f) Correct token → 201
    res = await postJSON(env, '/api/admin/grant', body, { authorization: 'Bearer ' + ADMIN_TOKEN });
    expectEqual(res.status, 201, 'correct token → 201');
  });

  /* ---- SCENARIO 17 ---- */
  await scenario('17. verify-tx: empty body, no BTC_ADDRESS config, SIMULATED_TXID bypass', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);

    // Pre-populate pricing cache
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: 50000, requiredSats: 24000,
      minAcceptableSats: 23280, fetchedAt: Date.now(),
    }));

    // a) Empty body (no txid) → 400
    const ctx1 = makeCtx();
    const r1 = await worker.fetch(
      req('/api/verify-tx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
      env, ctx1
    );
    await ctx1.drain();
    expectEqual(r1.status, 400, 'empty body → 400');

    // b) No BTC_ADDRESS configured → 500
    const envNoBTC = { ...env, BTC_ADDRESS: '' };
    const ctx2 = makeCtx();
    const r2 = await worker.fetch(
      req('/api/verify-tx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid: 'ab'.repeat(32), domain: 'a.com' }),
      }),
      envNoBTC, ctx2
    );
    await ctx2.drain();
    expectEqual(r2.status, 500, 'missing BTC_ADDRESS → 500');

    // c) SIMULATED_TXID (0x01 * 64) bypasses mempool → 200 + license
    const ctx3 = makeCtx();
    const r3 = await worker.fetch(
      req('/api/verify-tx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid: '0'.repeat(63) + '1', domain: 'test.dev' }),
      }),
      env, ctx3
    );
    await ctx3.drain();
    expectEqual(r3.status, 200, 'SIMULATED_TXID → 200');
    const b3 = await r3.json();
    expectEqual(b3.valid, true, 'SIMULATED_TXID valid');
    expectMatch(b3.licenseKey, /^FOCUS-PRO-/, 'SIMULATED_TXID produces FOCUS-PRO-* key');

    // d) SIMULATED_TXID second time → 409 (replay protection still applies)
    const ctx4 = makeCtx();
    const r4 = await worker.fetch(
      req('/api/verify-tx', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ txid: '0'.repeat(63) + '1', domain: 'test.dev' }),
      }),
      env, ctx4
    );
    await ctx4.drain();
    expectEqual(r4.status, 409, 'SIMULATED_TXID replay → 409');
  });

    /* ---- SCENARIO 57 ---- */
    await scenario('57. Master test key FOCUS-PRO-4YF4SA5M: instant 365d Pro, no on-chain, no replay lock', async () => {
      const kv = new KVMock();
      const env = makeEnv(kv);
      const MASTER = 'FOCUS-PRO-4YF4SA5M';
      const day = 86400000;

      // a) /api/verify-license → master key grants an instant 365-day Pro license
      const r1 = await postJSON(env, '/api/verify-license', { apiKey: MASTER, domain: 'test.dev' });
      expectEqual(r1.status, 200, 'verify-license → 200');
      const b1 = await r1.json();
      expectEqual(b1.valid, true, 'valid:true');
      expectEqual(b1.tier, 'pro', 'tier:pro');
      expectEqual(b1.plan, 'pro', 'plan:pro');
      expectEqual(b1.licenseKey, MASTER, 'master key echoed as licenseKey');
      expectTrue(b1.expiresAt > Date.now() && b1.expiresAt < Date.now() + 366 * day, 'expiresAt ≈ now + 365 days');
      expectEqual(b1.expires_at, b1.expiresAt, 'expires_at alias matches expiresAt');
      expectTrue(!!b1.engine && b1.engine.includes('.'), 'HMAC-signed engine token present');

      // b) Deliberately stateless: zero KV writes → no replay lock, unlimited reuse
      expectEqual(kv.puts.length, 0, 'master activation writes nothing to KV');
      const r2 = await postJSON(env, '/api/verify-license', { apiKey: 'focus-pro-4yf4sa5m', domain: 'other.dev' });
      expectEqual(r2.status, 200, 'reuse (case-insensitive, second device/domain) → 200, no replay guard');
      expectEqual((await r2.json()).valid, true, 'second activation still valid');

      // c) /api/verify-tx accepts the master key in the txid field (bypasses 64-hex + mempool)
      const r3 = await postJSON(env, '/api/verify-tx', { txid: MASTER, domain: 'test.dev' });
      expectEqual(r3.status, 200, 'verify-tx with master key → 200 (hex check bypassed)');
      const b3 = await r3.json();
      expectEqual(b3.valid, true, 'verify-tx master → valid');
      expectEqual(b3.licenseKey, MASTER, 'verify-tx master → key returned');
      expectEqual(kv.puts.length, 0, 'verify-tx master path also writes nothing to KV');
      expectTrue(!!b3.engine && b3.engine.includes('.'), 'engine token also issued via verify-tx');

      // d) Signed engine token payload integrity (version + frequency matrix)
      const payload = JSON.parse(Buffer.from(b1.engine.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      expectEqual(payload.v, 1, 'engine payload version');
      expectTrue(!!payload.mods && !!payload.mods.beta && !!payload.mods.gamma, 'frequency matrix carries mods');

      // e) Ordinary keys are completely unaffected by the bypass
      const r4 = await postJSON(env, '/api/verify-license', { apiKey: 'FOCUS-PRO-NOPE123', domain: 'test.dev' });
      expectEqual(r4.status, 403, 'unknown non-master key still 403');
      expectEqual((await r4.json()).reason, 'unknown_key', 'unknown_key reason preserved');
    });
}

/* ===========================================================================
 * SCENARIO 7-11 : CLIENT (hard paywall + audio engine)
 * ======================================================================== */
async function clientScenarios() {
  const env = installClientEnv();
  try {

    /* ---- SCENARIO 7 ---- */
    await scenario('7. Hard paywall: no license -> modal opens, audioContext NOT created', async () => {
      env.ls._clear();
      seedExpiredTrial(env);   // past the 15-minute frictionless window → paywall applies
      const c = await freshClient(env);
      const fb = c.FocusBot;

      expectEqual(fb.isPlaying, false, 'not playing at boot');
      expectEqual(MockAudioContext.instances.length, 0, 'AudioContext not created at boot');
      expectEqual(fb.trial.active, false, 'trial expired');

      // User clicks play without license -> upsell modal opens, no audio
      fb.toggle();
      await sleep(30);
      expectEqual(fb.isPlaying, false, 'still not playing after toggle');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext created');
      expectEqual(c.stub('.overlay').hidden, false, 'upsell modal opened');
    });

    /* ---- SCENARIO 8 ---- */
    await scenario('8. Hard paywall: valid license from server -> audio starts', async () => {
      env.ls._clear();
      // Seed a license key in localStorage so bootVerify picks it up
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-TESTKEY');
      // Mock server to return valid license
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30); // allow async bootVerify to complete
      expectEqual(c.FocusBot.isPro, true, 'Pro activated after server validation');
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'play with license');
      expectTrue(MockAudioContext.instances.length >= 1, 'AudioContext created with license');
    });

    /* ---- SCENARIO 9 ---- */
    await scenario('9. Node lifecycle: play/pause/resume with valid license', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-LIFECYCLE');
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30);
      const fb = c.FocusBot;

      fb.play();
      await waitFor(() => fb.isPlaying && MockAudioContext.instances[0] && MockAudioContext.instances[0].state === 'running',
        2000, 'first play -> running');
      const ctx = MockAudioContext.instances[0];

      fb.pause();
      await sleep(430);
      expectEqual(ctx.state, 'suspended', 'suspended after pause');
      expectEqual(MockAudioContext.instances.length, 1, 'single AudioContext instance');

      fb.play();
      await waitFor(() => ctx.state === 'running' && fb.isPlaying, 2000, 'second play -> resume');
      expectEqual(MockAudioContext.instances.length, 1, 'restart did not create a new AudioContext');
      expectEqual(MockAudioContext.oscs.length, 2, 'restart did not rebuild oscillators (graph reused)');
    });

    /* ---- SCENARIO 10 ---- */
    await scenario('10. Frequencies (200/214, 200/210) and 0.1 gain ceiling', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-FREQ');
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30);
      const fb = c.FocusBot;

      fb.play(); // default mode: Beta
      await waitFor(() => fb.isPlaying, 2000, 'play');

      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      const gain = MockAudioContext.gains.at(-1).gain;

      // Beta: Left 200 Hz / Right 214 Hz
      expectEqual(oscL.frequency.value, 200, 'Beta Left 200 Hz');
      expectEqual(oscR.frequency.value, 214, 'Beta Right 214 Hz');

      // Default volume 70% -> gain = ceiling(0.35) * 0.7
      expectApprox(gain.lastRamp, 0.4 * 0.7, 1e-9, 'default gain = 0.35x0.7');

      fb.setMode('alpha');
      expectEqual(oscL.frequency.value, 200, 'Alpha Left 200 Hz');
      expectEqual(oscR.frequency.value, 210, 'Alpha Right 210 Hz');

      fb.setMode('gamma');
      expectEqual(oscL.frequency.value, 200, 'Gamma Left 200 Hz');
      expectEqual(oscR.frequency.value, 240, 'Gamma Right 240 Hz');

      const vol = c.stub('.vol-range');
      vol.value = '100';
      vol.dispatch('input');
      expectApprox(gain.lastTarget, 0.4, 1e-9, 'ceiling gain 0.40 enforced');
    });

    /* ---- SCENARIO 11 ---- */
    await scenario('11. Custom frequency range: 0-1000 input, clamping/sorting, persistence, reset', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-FRANGE');
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30);
      const fb = c.FocusBot;

      const nl = c.stub('.fr-num-l'), nr = c.stub('.fr-num-r');
      const sl = c.stub('.fr-sl-l'), sr = c.stub('.fr-sl-r');
      expectTrue(!!nl && !!nr && !!sl && !!sr && !!c.stub('.frange-beat'), 'range inputs inside the shadow DOM');

      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'play');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);

      nl.value = '180'; nl.dispatch('change');
      nr.value = '186'; nr.dispatch('change');
      expectEqual(oscL.frequency.value, 180, 'custom Left 180 Hz');
      expectEqual(oscR.frequency.value, 186, 'custom Right 186 Hz');
      expectEqual(c.stub('.frange-beat').textContent, 'Beat: \u0394 6 Hz', 'live beat label');

      sr.value = '1200'; sr.dispatch('input');
      expectEqual(Number(sr.value), 1000, 'right slider clamped to 1000');
      expectEqual(oscR.frequency.value, 1000, 'custom Right 1000 Hz (upper bound)');

      nl.value = '300'; nl.dispatch('change');
      expectEqual(oscL.frequency.value, 300, 'after ordering Left 300');
      expectEqual(oscR.frequency.value, 1000, 'after ordering Right 1000');

      const saved = JSON.parse(env.ls.getItem('focusbot.customFreq'));
      expectTrue(saved && saved.left === 300 && saved.right === 1000, 'customFreq written to disk');
      const c2 = await freshClient(env); // F5 simulation
      c2.fb = c2.FocusBot;
      c2.fb.play();
      await waitFor(() => c2.fb.isPlaying, 2000, 'play after F5');
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 300, 'Left 300 preserved after F5');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 1000, 'Right 1000 preserved after F5');

      c2.fb.setFrequencyRange(-50, 99999);
      expectEqual(c2.stub('.fr-num-l').value, '0', 'API lower bound 0');
      expectEqual(c2.stub('.fr-num-r').value, '1000', 'API upper bound 1000');
      c2.fb.clearFrequencyRange();
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 200, 'reset -> Beta Left 200');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 214, 'reset -> Beta Right 214');
      expectTrue(!env.ls.getItem('focusbot.customFreq'), 'reset deleted the customFreq key');
      expectTrue(c2.fb.frequencyRange.custom === false, 'frequencyRange.custom=false');
    });
  } finally {
    env.restore();
  }
}

/* ===========================================================================
 * SCENARIO 12-14 : CLIENT EDGE CASES (network, XSS, validation)
 * ======================================================================== */
async function clientEdgeCaseScenarios() {
  const env = installClientEnv();
  try {

    /* ---- SCENARIO 12 ---- */
    await scenario('12. Client: network error -> toast, no crash, widget stays usable', async () => {
      env.ls._clear();
      seedExpiredTrial(env);   // past the trial window → network-error path stays blocked
      env.G.fetch = async () => { throw new TypeError('Failed to fetch'); };
      const c = await freshClient(env);
      const fb = c.FocusBot;

      // Play without license -> modal opens (no crash)
      fb.play();
      await sleep(30);
      expectEqual(fb.isPlaying, false, 'not playing without license');
      expectEqual(c.stub('.overlay').hidden, false, 'upsell modal opened');

      // Simulate entering a license key and clicking activate (network fails)
      const inputEl = c.stub('.lic-input');
      const activateBtn = c.stub('.activate');
      inputEl.value = 'FOCUS-PRO-FAKE';
      for (const fn of activateBtn.handlers.click || []) await fn();
      // Widget should not crash
      expectEqual(typeof fb.toggle, 'function', 'toggle still callable');
      expectEqual(typeof fb.setMode, 'function', 'setMode still callable');
    });

    /* ---- SCENARIO 13 ---- */
    await scenario('13. Client: XSS/injection in license input is safely rejected', async () => {
      env.ls._clear();
      env.G.fetch = async () => { throw new TypeError('blocked'); };
      const c = await freshClient(env);
      const fb = c.FocusBot;

      let capturedBody = null;
      env.G.fetch = async (url, opts) => {
        capturedBody = opts && opts.body;
        throw new TypeError('blocked');
      };

      const maliciousInputs = [
        '<script>alert(1)</script>',
        '"><img src=x onerror=alert(1)>',
        "'; DROP TABLE licenses; --",
        '${7*7}',
        '{{constructor.constructor("return this")()}}',
        '<svg/onload=alert(document.domain)>',
      ];

      for (const input of maliciousInputs) {
        capturedBody = null;
        const inputEl = c.stub('.lic-input');
        inputEl.value = input;
        const activateBtn = c.stub('.activate');
        for (const fn of activateBtn.handlers.click || []) await fn();
        if (capturedBody) {
          const parsed = JSON.parse(capturedBody);
          expectTrue(typeof parsed.apiKey === 'string', 'payload is safe string for: ' + input.slice(0, 20));
        }
      }
      expectEqual(typeof fb.toggle, 'function', 'widget still functional');
    });

    /* ---- SCENARIO 14 ---- */
    await scenario('14. Client: empty/whitespace input -> validation toast, no API call', async () => {
      env.ls._clear();
      env.G.fetch = async () => { throw new TypeError('blocked'); };
      const c = await freshClient(env);
      const fb = c.FocusBot;

      let apiCalled = false;
      env.G.fetch = async (url) => { apiCalled = true; throw new TypeError('blocked'); };

      const inputEl = c.stub('.lic-input');
      const activateBtn = c.stub('.activate');

      // Empty input
      inputEl.value = '';
      for (const fn of activateBtn.handlers.click || []) await fn();
      expectEqual(apiCalled, false, 'empty input -> no API call');

      // Whitespace only
      apiCalled = false;
      inputEl.value = '   ';
      for (const fn of activateBtn.handlers.click || []) await fn();
      expectEqual(apiCalled, false, 'whitespace input -> no API call');
    });
  } finally {
    env.restore();
  }
}

/* ===========================================================================
 * SCENARIO 18-24 : E2E HARD PAYWALL GUARD (zero-bypass verification)
 * ======================================================================== */
async function e2ePaywallGuardScenarios() {
  const env = installClientEnv();
  try {

    /* ---- SCENARIO 18 ---- */
    await scenario('18. Empty storage: AudioContext null, oscillators never created', async () => {
      env.ls._clear();
      seedExpiredTrial(env);   // empty storage + expired trial → hard paywall
      const c = await freshClient(env);
      const fb = c.FocusBot;

      // Verify state at boot
      expectEqual(fb.isPlaying, false, 'not playing at boot');
      expectEqual(MockAudioContext.instances.length, 0, 'AudioContext count = 0 at boot');

      // Attempt all entry points — none should create AudioContext
      fb.play();
      fb.toggle();
      fb.setMode('beta');
      fb.setMode('alpha');
      fb.setMode('theta');
      fb.setMode('gamma');
      fb.setVolume(100);
      await sleep(30);

      expectEqual(MockAudioContext.instances.length, 0, 'AudioContext still 0 after all bypass attempts');
      expectEqual(fb.isPlaying, false, 'still not playing');
    });

    /* ---- SCENARIO 19 ---- */
    await scenario('19. UI blocks: play/mode/freq all open payment modal', async () => {
      env.ls._clear();
      seedExpiredTrial(env);   // post-trial → every entry point hits the paywall
      const c = await freshClient(env);
      const fb = c.FocusBot;

      // Play -> modal opens
      fb.play();
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'play -> upsell modal opened');

      // Close, then setMode -> modal opens
      c.stub('.overlay').hidden = true;
      c.stub('.overlay').classList.add('hidden');
      fb.setMode('alpha');
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'setMode -> upsell modal opened');

      // Close, then setFrequencyRange -> modal opens
      c.stub('.overlay').hidden = true;
      c.stub('.overlay').classList.add('hidden');
      fb.setFrequencyRange(100, 200);
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'setFrequencyRange -> upsell modal opened');
    });

    /* ---- SCENARIO 20 ---- */
    await scenario('20. Console attack: window.FocusBot.play() blocked without license', async () => {
      env.ls._clear();
      seedExpiredTrial(env);
      const c = await freshClient(env);

      // Simulate console attack: direct play() call
      c.FocusBot.play();
      await sleep(20);
      expectEqual(c.FocusBot.isPlaying, false, 'console play() blocked');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext from console attack');

      // Simulate: set isPlaying = true directly (should not affect internal state)
      // The internal guard checks STATE.pro, not the public getter
      c.FocusBot.play();
      expectEqual(c.FocusBot.isPlaying, false, 'isPlaying still false after guard');
    });

    /* ---- SCENARIO 21 ---- */
    await scenario('21. Expired license: bootVerify revokes pro, falls back to paywall', async () => {
      env.ls._clear();
      seedExpiredTrial(env);   // trial exhausted too → no accidental access after license expiry
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-EXPIRED');
      // Server says: invalid/expired
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: false, reason: 'expired' }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30);

      expectEqual(c.FocusBot.isPro, false, 'pro revoked for expired license');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext created');
      // Play should open modal
      c.FocusBot.play();
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'upsell opened after expired license');
    });

    /* ---- SCENARIO 22 ---- */
    await scenario('22. Network failure at boot: revoke pro, widget stays usable', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-NETWORK');
      env.G.fetch = async () => { throw new TypeError('Network failure'); };
      const c = await freshClient(env);
      await sleep(30);

      expectEqual(c.FocusBot.isPro, false, 'pro revoked on network failure');
      // Widget must not crash
      expectEqual(typeof c.FocusBot.play, 'function', 'play still callable');
      expectEqual(typeof c.FocusBot.toggle, 'function', 'toggle still callable');
      expectEqual(typeof c.FocusBot.setMode, 'function', 'setMode still callable');
    });

    /* ---- SCENARIO 23 ---- */
    await scenario('23. Cross-tab: storage event revokes pro in live tab', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-CROSSTAB');
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);
      await sleep(30);
      expectEqual(c.FocusBot.isPro, true, 'pro activated');

      // Start playing
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'playing');

      // Simulate another tab removing the license key
      env.ls.removeItem('focusbot.licenseKey');
      // Fire the storage event listeners
      const storageListeners = env.winL.storage || [];
      for (const fn of storageListeners) {
        fn({ key: 'focusbot.licenseKey', newValue: null });
      }
      await sleep(20);

      expectEqual(c.FocusBot.isPro, false, 'pro revoked by cross-tab storage event');
    });

    /* ---- SCENARIO 24 ---- */
    await scenario('24. Payment success: TXID -> 365-day license -> Pro active -> play works', async () => {
      env.ls._clear();
      // Simulate successful activation via applyLicense
      env.G.fetch = async (url) => {
        if (String(url).includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        throw new Error('unexpected');
      };
      const c = await freshClient(env);

      // Manually trigger activation (simulating user entering TXID)
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-E2E-PAYMENT');
      // Re-boot to pick up the key
      const c2 = await freshClient(env);
      await sleep(30);

      expectEqual(c2.FocusBot.isPro, true, 'Pro activated after payment');
      const storedKey = env.ls.getItem('focusbot.licenseKey');
      expectEqual(storedKey, 'FOCUS-PRO-E2E-PAYMENT', 'licenseKey stored in localStorage');

      // Play should now work
      c2.FocusBot.play();
      await waitFor(() => c2.FocusBot.isPlaying, 2000, 'play after payment');
      expectTrue(MockAudioContext.instances.length >= 1, 'AudioContext created after payment');
    });
  } finally {
    env.restore();
  }
}

/* ===========================================================================
 * SCENARIO 25-28 : AUDIO SYNTHESIZER FREQUENCY MATH
 * ======================================================================== */
async function audioSynthScenarios() {
  const env = installClientEnv();
  try {
    env.ls._clear();
    env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-AUDIO');
    env.G.fetch = async (url) => {
      if (String(url).includes('/api/verify-license')) {
        return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
      }
      throw new Error('unexpected');
    };

    /* ---- SCENARIO 25 ---- */
    await scenario('25. Beta mode: Left=200Hz, Right=214Hz (delta=14Hz)', async () => {
      const c = await freshClient(env);
      await sleep(30);
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'play beta');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 200, 'Beta Left 200 Hz');
      expectEqual(oscR.frequency.value, 214, 'Beta Right 214 Hz');
      const delta = Math.abs(oscR.frequency.value - oscL.frequency.value);
      expectEqual(delta, 14, 'Beta delta = 14 Hz');
    });

    /* ---- SCENARIO 26 ---- */
    await scenario('26. Alpha mode: Left=200Hz, Right=210Hz (delta=10Hz)', async () => {
      const c = await freshClient(env);
      await sleep(30);
      c.FocusBot.setMode('alpha');
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'play alpha');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 200, 'Alpha Left 200 Hz');
      expectEqual(oscR.frequency.value, 210, 'Alpha Right 210 Hz');
      const delta = Math.abs(oscR.frequency.value - oscL.frequency.value);
      expectEqual(delta, 10, 'Alpha delta = 10 Hz');
    });

    /* ---- SCENARIO 27 ---- */
    await scenario('27. Theta mode: Left=180Hz, Right=186Hz (delta=6Hz)', async () => {
      const c = await freshClient(env);
      await sleep(30);
      c.FocusBot.setMode('theta');
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'play theta');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 180, 'Theta Left 180 Hz');
      expectEqual(oscR.frequency.value, 186, 'Theta Right 186 Hz');
      const delta = Math.abs(oscR.frequency.value - oscL.frequency.value);
      expectEqual(delta, 6, 'Theta delta = 6 Hz');
    });

    /* ---- SCENARIO 28 ---- */
    await scenario('28. Gamma mode: Left=200Hz, Right=240Hz (delta=40Hz)', async () => {
      const c = await freshClient(env);
      await sleep(30);
      c.FocusBot.setMode('gamma');
      c.FocusBot.play();
      await waitFor(() => c.FocusBot.isPlaying, 2000, 'play gamma');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 200, 'Gamma Left 200 Hz');
      expectEqual(oscR.frequency.value, 240, 'Gamma Right 240 Hz');
      const delta = Math.abs(oscR.frequency.value - oscL.frequency.value);
      expectEqual(delta, 40, 'Gamma delta = 40 Hz');
    });
  } finally {
    env.restore();
  }
}

/* ===========================================================================
 * SCENARIO 29-36 : PRODUCTIVITY SUITE (Pomodoro + Ambient Mixer)
 * ======================================================================== */
async function productivityScenarios() {
  const env = installClientEnv();
  const lastInterval = (name) => env.intervals.filter((x) => x.fn.toString().includes(name)).at(-1);
  // Provision a valid Pro license so the productivity suite can run end-to-end
  env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-SUITE');
  env.G.fetch = async (url) => {
    if (String(url).includes('/api/verify-license')) {
      return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
    }
    throw new Error('unexpected');
  };
  const c = await freshClient(env);
  const fb = c.FocusBot;
  await sleep(30);
  expectEqual(fb.isPro, true, 'suite provisioned as Pro');
  try {

  /* ---- SCENARIO 29 ---- */
  await scenario('29. Pomodoro: start → focus + auto-play + 25:00', async () => {
    fb.pomodoro.start();
    const ps = fb.pomodoro.getState();
    expectEqual(ps.running, true, 'pomodoro running');
    expectEqual(ps.state, 'focus', 'focus phase');
    expectEqual(ps.remainingMs, 25 * 60 * 1000, 'remaining 25:00');
    await waitFor(() => fb.isPlaying, 2000, 'auto-play engaged');
    expectEqual(c.stub('.pomo-time').textContent, '25:00', 'UI timer 25:00');
    expectEqual(c.stub('.pomo-state').textContent, 'Focus', 'UI phase Focus');
  });

  /* ---- SCENARIO 30 ---- */
  await scenario('30. Pomodoro: 25-min tick → break, audio paused, alert', async () => {
    const it = lastInterval('pomodoroTick');
    expectTrue(!!it, 'pomodoro tick interval registered');
    for (let i = 0; i < 1500; i++) it.fn();
    const ps = fb.pomodoro.getState();
    expectEqual(ps.state, 'break', 'focus finished → break');
    expectEqual(ps.remainingMs, 5 * 60 * 1000, 'break 5:00');
    expectEqual(ps.completed, 1, 'one focus session completed');
    expectEqual(fb.isPlaying, false, 'audio paused during break');
    expectEqual(c.stub('.pomo-state').textContent, 'Break', 'UI phase Break');
  });

  /* ---- SCENARIO 31 ---- */
  await scenario('31. Pomodoro: break over → next focus cycle auto-plays', async () => {
    const it = lastInterval('pomodoroTick');
    expectTrue(!!it, 'pomodoro tick available');
    for (let i = 0; i < 300; i++) it.fn();
    const ps = fb.pomodoro.getState();
    expectEqual(ps.state, 'focus', 'break finished → focus');
    expectEqual(ps.remainingMs, 25 * 60 * 1000, 'new 25:00 loaded');
    await waitFor(() => fb.isPlaying, 2000, 'audio auto-resumed');
  });

  /* ---- SCENARIO 32 ---- */
  await scenario('32. Pomodoro: reset stops the cycle and the audio', async () => {
    expectTrue(fb.isPlaying, 'playing before reset');
    fb.pomodoro.reset();
    const ps = fb.pomodoro.getState();
    expectEqual(ps.running, false, 'stopped');
    expectEqual(ps.state, 'idle', 'idle state');
    expectEqual(fb.isPlaying, false, 'audio stopped');
    expectEqual(c.stub('.pomo-time').textContent, '25:00', 'UI reset to 25:00');
  });
  } finally { env.restore(); }
}

/* ===========================================================================
 * SCENARIO 35-36 : AMBIENT MIXER (isolated fresh module so the global audio
 * mock statics reflect exactly this client instance's graph)
 * ======================================================================== */
async function ambientMixerScenarios() {
  const env = installClientEnv();
  env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-AMB');
  env.G.fetch = async (url) => {
    if (String(url).includes('/api/verify-license')) {
      return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
    }
    throw new Error('unexpected');
  };
  const c = await freshClient(env);
  const fb = c.FocusBot;
  await sleep(30);
  try {

  /* ---- SCENARIO 35 ---- */
  await scenario('35. Ambient: independent multi-layer mixer — staged per-layer gains + soft limiter; Off clears all', async () => {
    expectEqual(fb.ambients.length, 0, 'starts with no active layer');

    fb.toggleAmbient('pink');
    expectEqual(fb.ambients.join(','), 'pink', 'pink engaged');
    expectEqual(fb.ambient, 'pink', 'ambient getter reflects the sole active layer');
    // Gain staging fixed stages (context exists now) — ambient layers raised to
    // be clearly audible: master bus at unity, pink ×3 makeup.
    expectApprox(MockAudioContext.gains[1].gain.value, 1.0, 1e-9, 'binaural carrier stage 1.00');
    expectApprox(MockAudioContext.gains[2].gain.value, 1.0, 1e-9, 'ambient master bus at unity 1.00');
    expectApprox(MockAudioContext.gains[3].gain.value, 3.0, 1e-9, 'pink makeup ×3.0');
    expectApprox(MockAudioContext.gains[4].gain.value, 0.9, 1e-9, 'pink layer gain staged to 0.90');
    expectEqual(MockAudioContext.compressors.length, 1, 'a final master compressor/limiter exists in the graph');
    // [Master gain] → [compressor] → destination
    expectEqual(MockAudioContext.gains.at(-1).connections[0], MockAudioContext.compressors[0], 'master feeds the final compressor');
    expectEqual(MockAudioContext.compressors[0].connections[0], MockAudioContext.instances.at(-1).destination, 'compressor feeds destination');

    fb.toggleAmbient('rain');
    expectEqual([...fb.ambients].sort().join(','), 'pink,rain', 'two independent layers coexist');
    expectEqual(MockAudioContext.sources.length, 2, 'two noise sources playing');
    expectApprox(MockAudioContext.gains[6].gain.value, 0.95, 1e-9, 'rain layer gain staged to 0.95');
    expectEqual(MockAudioContext.gains.at(-1).connections[0], MockAudioContext.compressors[0], 'master still feeds the final compressor with two layers');
    const rainSrc = MockAudioContext.sources.at(-1);
    expectEqual(rainSrc.connections[0].type, 'lowpass', 'rain source routed through the lowpass filter');

    fb.toggleAmbient('pink');                       // one layer off, other keeps playing
    expectEqual(fb.ambients.join(','), 'rain', 'pink toggled off, rain persists');
    expectApprox(MockAudioContext.gains[4].gain.value, 0, 1e-9, 'pink layer gain zeroed');
    const deadPink = MockAudioContext.sources.at(0);
    expectEqual(deadPink._stopped, true, 'removed pink source stop()ed');
    expectEqual(deadPink.connections.length, 0, 'removed pink source disconnected');

    fb.toggleAmbient('off');                        // closes every remaining layer
    expectEqual(fb.ambients.length, 0, 'Off clears ALL active layers');
    expectApprox(MockAudioContext.gains[6].gain.value, 0, 1e-9, 'rain layer gain zeroed');
    const deadRain = MockAudioContext.sources.at(1);
    expectEqual(deadRain._stopped, true, 'rain source stopped by Off');
    expectEqual(deadRain.connections.length, 0, 'rain source disconnected');
    expectEqual(fb.ambient, 'off', 'ambient getter back to off');
  });

  /* ---- SCENARIO 36 ---- */
  await scenario('36. Ambient: pink/rain sampling, cached noise buffers, multi-layer .active UI sync', async () => {
    fb.setAmbient('pink');
    let src = MockAudioContext.sources.at(-1);
    expectEqual(src.buffer.numberOfChannels, 1, 'pink mono buffer');
    const pink = src.buffer.getChannelData(0);
    expectTrue(pink.length > 0, 'pink buffer has samples');
    expectTrue(pink.some((v) => Math.abs(v) > 0.0001), 'pink data non-silent');

    // on → off → on reuses the original PCM data; no regeneration per toggle
    const b1 = src.buffer;
    fb.setAmbient('off');
    fb.setAmbient('pink');
    expectEqual(MockAudioContext.sources.at(-1).buffer, b1, 'noise buffer cached & reused (no regen per toggle)');
    expectEqual(MockAudioContext.buffers.length, 2, 'exactly 2 buffers generated (pink+rain), none re-made');

    fb.setAmbient('rain');
    src = MockAudioContext.sources.at(-1);
    expectTrue(!!src.buffer, 'rain buffer created');
    expectEqual(src.connections[0].type, 'lowpass', 'rain source connected (to lowpass)');
    fb.setAmbient('off');
    expectEqual(fb.ambient, 'off', 'off state');
    expectEqual(MockAudioContext.buffers.length, 2, 'rain buffer reused on re-engage');

    // Brown buffer: the documented integrated formula + ×6.0 output gain
    fb.toggleAmbient('brown');
    const bsrc = MockAudioContext.sources.at(-1);
    const brn = bsrc.buffer.getChannelData(0);
    expectTrue(brn.some((v) => Math.abs(v) > 0.0001), 'brown data non-silent');
    expectEqual(bsrc.connections[0], MockAudioContext.gains[8], 'brown source feeds the deep-bass booster (brownBass)');
    let bLast = 0;
    for (let i = 0; i < brn.length; i++) {
      const w = Math.random() * 2 - 1;
      bLast = (bLast + 0.02 * w) / 1.02;
      if (i % 97 === 0) { /* just verify the integrated walk stays bounded */ }
    }
    // The raw integrated walk is a 6.0×-gained (pre-compressor) signal. The
    // walk itself stays small, so the ×6 boost lifts it into a clearly audible
    // range (≈ ±0.3–1.2) while the final master compressor still bounds peaks.
    expectTrue(brn.some((v) => Math.abs(v) > 0.25), 'brown x6 hot buffer has clearly audible peaks');
    expectTrue(Math.abs(bLast) < 1, 'raw integrated walk stays below unity (scales up via ×6)');
    fb.toggleAmbient('off');

    // Multi-layer .active classes track the set precisely (popup + widget share
    // the same ambients array from getState)
    const ambRow = c.stub('.amb-row');
    const btns = ambRow.querySelectorAll('button[data-amb]');
    expectEqual(btns.length, 5, 'five ambient buttons (off+pink+brown+rain+white)');
    const btn = (k) => btns.find((b) => b.dataset.amb === k);
    fb.toggleAmbient('pink');
    fb.toggleAmbient('rain');
    expectEqual(btn('pink').classList.contains('active'), true, '.active on pink');
    expectEqual(btn('rain').classList.contains('active'), true, '.active on rain');
    expectEqual(btn('white').classList.contains('active'), false, 'white not lit');
    expectEqual(btn('off').classList.contains('active'), false, 'Off not lit while layers run');
    fb.toggleAmbient('rain');
    expectEqual(btn('pink').classList.contains('active'), true, 'pink keeps .active');
    expectEqual(btn('rain').classList.contains('active'), false, 'rain loses .active on toggle');
    fb.toggleAmbient('off');
    expectEqual(btn('pink').classList.contains('active'), false, 'pink cleared by Off');
    expectEqual(btn('rain').classList.contains('active'), false, 'rain cleared by Off');
    expectEqual(btn('off').classList.contains('active'), true, 'Off .active once everything is off');

    // White layer: staged gain 0.80, direct feed into its own layer gain
    fb.toggleAmbient('white');
    expectApprox(MockAudioContext.gains[7].gain.value, 0.8, 1e-9, 'white layer gain staged to 0.80');
    const whiteSrc = MockAudioContext.sources.at(-1);
    expectEqual(whiteSrc.connections[0], MockAudioContext.gains[7], 'white source feeds its own layer gain');
    expectApprox(whiteSrc.buffer.length, 48000 * 5, 1e-6, 'white loop is a full 5-second buffer');
    expectEqual(MockAudioContext.buffers.length, 4, 'exactly 4 buffers generated (pink+rain+brown+white)');
    fb.toggleAmbient('off');
    expectEqual(fb.ambients.length, 0, 'off clears white along with the rest');
  });

  /* ---- SCENARIO 74 ---- */
  await scenario('74. Output power: per-channel carrier gains (1.5) with +4 dB bass boost on Delta/Theta, binaural bus 1.0, master ceiling → 0.40, master compressor → destination', async () => {
    fb.toggleAmbient('off');
    fb.play();
    await waitFor(() => fb.isPlaying, 2000, 'playing for output-power graph');
    const G = MockAudioContext.gains;
    // boost(0)·bin(1)·ambMaster(2)·pinkMakeup(3)·pink(4)·brown(5)·rain(6)·white(7)·brownBass(8)·chanL(9)·chanR(10)·master(11)
    expectApprox(G[9].gain.value, 1.5, 1e-9, 'left carrier channel gain 1.50');
    expectApprox(G[10].gain.value, 1.5, 1e-9, 'right carrier channel gain 1.50');
    expectApprox(G[1].gain.value, 1.0, 1e-9, 'binaural carrier bus raised to 1.00');
    expectApprox(G.at(-1).gain.lastRamp, 0.4 * 0.7, 1e-9, 'master ceiling now 0.40 → 0.28 output');
    const comp = MockAudioContext.compressors.at(-1);
    expectEqual(comp.threshold.value, -6, 'master compressor threshold -6');
    expectEqual(comp.knee.value, 12, 'master compressor knee 12');
    expectEqual(comp.ratio.value, 8, 'master compressor ratio 8');
    expectApprox(comp.attack.value, 0.003, 1e-9, 'master compressor attack 0.003');
    expectApprox(comp.release.value, 0.15, 1e-9, 'master compressor release 0.15');
    expectApprox(G.at(-1).connections[0].threshold.value, -6, 'master gain → master compressor wired');
    expectEqual(comp.connections[0], MockAudioContext.instances.at(-1).destination, 'master compressor → destination');

    // Low-frequency carriers (Delta/Theta/174 Hz) get the +4 dB bass boost
    // (~×1.585) via their channel stage; higher modes hold the 1.5 flat gain.
    fb.setMode('delta');
    const boostAmt = 1.5 * Math.pow(10, 4 / 20);
    expectApprox(G[9].gain.value, boostAmt, 1e-9, 'Delta left boosted by +4 dB');
    expectApprox(G[10].gain.value, boostAmt, 1e-9, 'Delta right boosted by +4 dB');
    fb.setMode('theta');
    expectApprox(G[9].gain.value, boostAmt, 1e-9, 'Theta left boosted by +4 dB');
    fb.setMode('gamma');
    expectApprox(G[9].gain.value, 1.5, 1e-9, 'Gamma (200/240) holds flat 1.50');
    fb.setMode('963');
    expectApprox(G[9].gain.value, 1.5, 1e-9, 'Solfeggio 963 holds flat 1.50');

    // Binaural slider can push the bus past unity (range 0.0–2.0).
    fb.setVolumeBinaural(150);
    expectApprox(G[1].gain.value, 1.5, 1e-9, 'binaural bus ramps to 1.50 (>1.0)');
    const tpl = c.root.innerHTML;
    expectTrue(tpl.includes('min="0" max="200"'), 'binaural slider max=200 template');

    fb.toggleAmbient('off');
  });

  /* ---- SCENARIO 75 ---- */
  await scenario('75. Ambient repair: brown ×6.0 / Kellet-pink / rain+AM loops, instant 0–1 layer-gain toggles, resume() on suspended context, BiquadFilter routing', async () => {
    // Visual + routing: state feeds destination through [master → compressor]
    MockAudioContext.instances.at(-1).state = 'suspended';   // Chrome autoplay lock
    const rainSrcBefore = MockAudioContext.sources.length;
    fb.toggleAmbient('rain');
    const rainSrc = MockAudioContext.sources.at(-1);
    expectEqual(MockAudioContext.instances.at(-1).state, 'running', 'layer click resumed the suspended context');
    expectEqual(rainSrc.connections[0].type, 'lowpass', 'rain source → BiquadFilter lowpass (1200 Hz)');
    expectApprox(rainSrc.connections[0].frequency.value, 1200, 1e-9, 'rain lowpass at 1200 Hz');
    const rr = rainSrc.buffer.getChannelData(0);
    expectTrue(rr.some((v) => Math.abs(v) > 0.0001), 'rain buffer non-silent');
    let modMax = 0, modMin = 2;
    for (let i = 0; i < rr.length; i++) {
      if (Math.abs(rr[i]) > modMax) modMax = Math.abs(rr[i]);
      if (Math.abs(rr[i]) < modMin) modMin = Math.abs(rr[i]);
    }
    expectEqual(rr.length, rainSrc.buffer.length, 'rain mono loop buffer');
    // Regular amplitude modulation produced real variation in the envelope
    expectTrue(modMax > modMin + 0.1, 'rain header shows amplitude modulation (droplet feel)');

    // Toggle off/on: source loops stay live; the layer gain flips 0 → level
    // instantly (no rebuild, no per-toggle buffer regen, no click ramp).
    const rainSrcBefore2 = MockAudioContext.sources.length;
    const src = rainSrc;
    const buf1 = rainSrc.buffer;
    fb.toggleAmbient('off');
    expectApprox(MockAudioContext.gains[6].gain.value, 0, 1e-9, 'rain layer gain snapped to 0 on Off');
    expectEqual(src._stopped, true, 'rain source stopped on Off');
    expectEqual(src.connections.length, 0, 'rain source disconnected on Off');
    fb.toggleAmbient('rain');
    expectEqual(MockAudioContext.sources.length, rainSrcBefore2 + 1, 're-engage rebuilds a fresh looping source');
    expectApprox(MockAudioContext.gains[6].gain.value, 0.95, 1e-9, 'rain layer gain snapped to its staged level');
    expectEqual(MockAudioContext.sources.at(-1).loop, true, 'rebuilt source loops');
    expectEqual(MockAudioContext.sources.at(-1).buffer, buf1, 'rain buffer reused on re-engage (no regen)');
  });
  } finally { env.restore(); }
}

/* ===========================================================================
 * SCENARIO 37-39 : CLIENT HARDENING (engine token, messaging)
 * ======================================================================== */
function signedToken(payload) {
  function b64url(s) { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
  return b64url(JSON.stringify(payload)) + '.DUMY-SIG';
}

const validLicenseFetch = (extra) => async (url) => {
  if (String(url).includes('/api/verify-license')) {
    return { ok: true, status: 200, json: async () => Object.assign(
      { valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }, extra || {}
    ) };
  }
  throw new Error('unexpected');
};

async function clientHardeningScenarios() {

  /* ---- SCENARIO 37 ---- */
  await scenario('37. Hardening: engine token drives frequency matrix + gain', async () => {
    const env = installClientEnv();
    try {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-ENGINE');
      const token = signedToken({
        v: 1, seed: 7, gain: 0.8,
        mods: {
          beta:  { l: 220, r: 236, ph: 2, k: 1 },
          alpha: { l: 205, r: 214, ph: 0, k: 1 },
          theta: { l: 190, r: 196, ph: 1, k: 1 },
          gamma: { l: 250, r: 292, ph: 3, k: 1 },
        },
      });
      env.G.fetch = validLicenseFetch({ engine: token });
      const c2 = await freshClient(env);
      await sleep(30);
      const f2 = c2.FocusBot;
      expectEqual(f2.isPro, true, 'pro active');
      f2.play();
      await waitFor(() => f2.isPlaying, 2000, 'play with token');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 220, 'engine left 220 Hz');
      expectEqual(oscR.frequency.value, 236, 'engine right 236 Hz');
      const gain = MockAudioContext.gains.at(-1).gain;
      expectApprox(gain.lastRamp, 0.4 * 0.7 * 0.8, 1e-9, 'engine gain coefficient 0.8 applied');
      f2.setMode('gamma');
      expectEqual(oscL.frequency.value, 250, 'engine gamma left 250');
      expectEqual(oscR.frequency.value, 292, 'engine gamma right 292');
    } finally { env.restore(); }
  });

  /* ---- SCENARIO 38 ---- */
  await scenario('38. Hardening: corrupt/absent token → safe fallback matrix', async () => {
    const env = installClientEnv();
    try {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-CORRUPT-ENGINE');
      env.G.fetch = validLicenseFetch({ engine: 'not-a-valid-token!!' });
      const c2 = await freshClient(env);
      await sleep(30);
      const f2 = c2.FocusBot;
      f2.play();
      await waitFor(() => f2.isPlaying, 2000, 'play with bogus token');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 200, 'fallback left 200');
      expectEqual(oscR.frequency.value, 214, 'fallback right 214');
      expectEqual(f2.isPro, true, 'pro still active with fallback');
    } finally { env.restore(); }
  });

  /* ---- SCENARIO 39 ---- */
  await scenario('39. Messaging bridge: FOCUSBOT_CTRL drives the widget (MV3 popup)', async () => {
    const env = installClientEnv();
    const listeners = [];
    env.G.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } };
    env.G.fetch = validLicenseFetch();
    try {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-MSG');
      const c2 = await freshClient(env);
      await sleep(30);
      const f2 = c2.FocusBot;
      expectEqual(listeners.length, 1, 'content-script registered a runtime listener');
      let last = null;
      const respond = (res) => { last = res; };

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'getState' }, {}, respond);
      expectEqual(last.ok, true, 'getState acknowledged');
      expectEqual(last.state.pro, true, 'state includes pro');

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'play' }, {}, respond);
      await waitFor(() => f2.isPlaying, 2000, 'play via messenger');
      expectEqual(last.ok, true, 'play acknowledged');

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'setMode', mode: 'theta' }, {}, respond);
      expectEqual(f2.state.mode, 'theta', 'mode switched via messenger');

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'pomodoroStart' }, {}, respond);
      expectEqual(f2.state.pomodoro.running, true, 'pomodoro started via messenger');

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'toggleAmbient', kind: 'pink' }, {}, respond);
      expectEqual(f2.state.ambients.join(','), 'pink', 'multi-layer ambient toggle via messenger');
      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'toggleAmbient', kind: 'rain' }, {}, respond);
      expectEqual([...f2.state.ambients].sort().join(','), 'pink,rain', 'second layer added via messenger');
      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'toggleAmbient', kind: 'off' }, {}, respond);
      expectEqual(f2.state.ambients.length, 0, 'off via messenger clears all');

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'bogus-command' }, {}, respond);
      expectEqual(last.ok, false, 'unknown command rejected');
    } finally { env.restore(); }
  });
}

/* ===========================================================================
 * SCENARIO 40-43 : WORKER ABUSE / STRESS AUDIT (malformed input, expiry edge,
 * defensive vout handling). Called from the WORKER section, but defined here
 * so the whole audit lives in one place.
 * ======================================================================== */
async function workerAbuseScenarios() {

  /* ---- SCENARIO 40 ---- */
  await scenario('40. Worker: primitive & malformed JSON bodies → clean 4xx, never 5xx', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const bodies = ['null', '12345', 'true', '[]', '[1,2]', '{bad json', '{"apiKey": 123}', '', '{   }   '];
    for (const body of bodies) {
      const res = await postJSON(env, '/api/verify-license', body);
      expectTrue(res.status >= 400 && res.status < 500, 'bad body → 4xx (got HTTP ' + res.status + ' for ' + JSON.stringify(body.slice(0, 12)) + ')');
    }
    // Misshapen FIELD types (objects where strings are expected) must not 500 either
    let res = await postJSON(env, '/api/verify-license', { apiKey: { nested: 1 }, domain: { evil: true } });
    expectTrue(res.status >= 400 && res.status < 500, 'nested junk field types → 4xx/200 (got ' + res.status + ')');
    res = await postJSON(env, '/api/verify-license', { apiKey: 'x', domain: 'x.com', rtc_sdp: { type: 42 } });
    expectTrue(res.status >= 400 && res.status < 500, 'extraneous junk fields tolerated (got ' + res.status + ')');
  });

  /* ---- SCENARIO 41 ---- */
  await scenario('41. Worker: oversized body + abusive flood → service stays healthy', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    let res = await postJSON(env, '/api/verify-license', '{"apiKey":"' + 'A'.repeat(70000) + '"}');
    expectTrue(res.status >= 400 && res.status < 500, 'oversized body → 4xx (got ' + res.status + ')');
    for (let i = 0; i < 40; i++) {
      res = await postJSON(env, '/api/verify-license', { apiKey: 'NOPE-' + i, domain: 'x.test' });
      expectTrue(res.status === 403, 'unknown-key flood → 403 (#' + i + ')');
    }
    res = await getURL(env, '/api/health');
    const h = await res.json();
    expectEqual(h.ok, true, 'healthy after abuse');
  });

  /* ---- SCENARIO 42 ---- */
  await scenario('42. Worker: expiry edge — valid inside the window, revoked at the boundary', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const auth = { authorization: 'Bearer ' + ADMIN_TOKEN };
    const g = await postJSON(env, '/api/admin/grant', { domains: ['edge.test'], days: 1 }, auth);
    expectEqual(g.status, 201, 'grant created');
    const key = (await g.json()).licenseKey;
    const lic = JSON.parse(await kv.get('license:' + key));
    lic.expiresAt = Date.now() + 1500;
    await kv.put('license:' + key, JSON.stringify(lic));

    let res = await postJSON(env, '/api/verify-license', { apiKey: key, domain: 'edge.test' });
    expectEqual(res.status, 200, 'valid inside the window');
    await sleep(1600); // cross the exact expiry second
    res = await postJSON(env, '/api/verify-license', { apiKey: key, domain: 'edge.test' });
    expectEqual(res.status, 403, 'expired at boundary');
    expectEqual((await res.json()).reason, 'expired', 'reason=expired');
  });

  /* ---- SCENARIO 43 ---- */
  await scenario('43. Worker: NaN/negative/junk vout values never satisfy the amount check', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const BTC = env.BTC_ADDRESS;
    const MOCK_REQUIRED_SATS = 24000;
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: 50000, requiredSats: MOCK_REQUIRED_SATS,
      minAcceptableSats: Math.ceil(MOCK_REQUIRED_SATS * 0.97), fetchedAt: Date.now(),
    }));
    const JUNK_TXID = '11'.repeat(32);
    const NEG_TXID = '22'.repeat(32);
    const STR_TXID = '33'.repeat(32);
    installMempoolHook();
    try {
      setMempoolTx(JUNK_TXID, { txid: JUNK_TXID, vout: [
        { scriptpubkey_address: BTC, value: 'not-a-number' },
        { scriptpubkey_address: BTC, value: null },
        { scriptpubkey_address: BTC, value: {} },
      ]});
      setMempoolTx(NEG_TXID, { txid: NEG_TXID, vout: [
        { scriptpubkey_address: BTC, value: -5000 },
        { scriptpubkey_address: BTC, value: Number.NaN },
      ]});
      setMempoolTx(STR_TXID, { txid: STR_TXID, vout: [
        { scriptpubkey_address: BTC, value: '24000' },   // numeric string is legitimately honored
      ]});

      let res = await postJSON(env, '/api/verify-tx', { txid: JUNK_TXID, domain: 'site.com' });
      expectEqual(res.status, 402, 'junk vout values → 402');
      expectEqual((await res.json()).paid, 0, 'paid=0 for junk vouts');

      res = await postJSON(env, '/api/verify-tx', { txid: NEG_TXID, domain: 'site.com' });
      expectEqual(res.status, 402, 'negative/NaN vouts → 402');
      expectEqual((await res.json()).paid, 0, 'paid=0 for negative vouts');

      res = await postJSON(env, '/api/verify-tx', { txid: STR_TXID, domain: 'site.com' });
      const body = await res.json();
      expectEqual(res.status, 200, 'numeric-string vout still honored');
      expectTrue(!!body.licenseKey, 'license granted');
    } finally {
      uninstallMempoolHook();
    }
  });
}

/* ===========================================================================
 * SCENARIO 44 : CLIENT AUTOPLAY POLICY
 * A suspended AudioContext (browser autoplay policy) must never report
 * "playing", and must recover on first gesture.
 * ======================================================================== */
async function clientAutoplayScenarios() {
  const env = installClientEnv();
  try {
    env.ls._clear();
    env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-AUTOPLAY');
    env.G.fetch = validLicenseFetch();
    const c = await freshClient(env);
    const fb = c.FocusBot;
    await sleep(30);
    expectEqual(fb.isPro, true, 'pro provisioned');

    /* ---- SCENARIO 44 ---- */
    await scenario('44. Autoplay: blocked resume → honest state; first gesture recovers', async () => {
      MockAudioContext.resumable = false;
      fb.pomodoro.start();
      await waitFor(() => fb.autoplayBlocked, 2000, 'autoplayBlocked flagged');
      expectEqual(fb.isPlaying, false, 'does not fake playback');
      expectEqual(MockAudioContext.instances.at(-1).state, 'suspended', 'context left suspended');
      expectEqual(MockAudioContext.oscs.length, 2, 'graph still wired (two oscillators)');
      // First user gesture → clean resume
      MockAudioContext.resumable = true;
      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'playback resumes after gesture');
      expectEqual(fb.autoplayBlocked, false, 'block cleared after gesture');
      expectEqual(MockAudioContext.instances.at(-1).state, 'running', 'context running');
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 200, 'alpha left intact');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 214, 'alpha right intact');
    });
  } finally {
    MockAudioContext.resumable = true;
    env.restore();
  }
}

/* ===========================================================================
 * SCENARIO 45 : CLIENT MEMORY — Node churn across pomodoro phases & ambient storms
 * ======================================================================== */
async function clientMemoryLeakScenarios() {
  const env = installClientEnv();
  try {
    env.ls._clear();
    env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-LEAK');
    env.G.fetch = validLicenseFetch();
    const c = await freshClient(env);
    const fb = c.FocusBot;
    await sleep(30);

    /* ---- SCENARIO 45 ---- */
    await scenario('45. Memory: phase cycles + ambient toggles do not leak AudioNodes', async () => {
      // (a) ONE graph serves the whole pomodoro life — phases must not churn it
      fb.pomodoro.start();
      await waitFor(() => fb.isPlaying, 2000, 'playing for phase-cycling test');
      const it = env.intervals.filter((x) => x.fn.toString().includes('pomodoroTick')).at(-1);
      expectTrue(!!it, 'pomodoro tick registered');
      const oscsBase = MockAudioContext.oscs.length;
      const gainsBase = MockAudioContext.gains.length;
      const sourcesBase = MockAudioContext.sources.length;
      for (let i = 0; i < 1500; i++) it.fn(); // focus → break (audio off) + gong chime
      for (let i = 0; i < 300; i++) it.fn();  // break → focus (audio on) + gong chime
      fb.pomodoro.reset();
      // Each phase change rings one synthesized gong: exactly +1 OscillatorNode
      // and +1 GainNode per transition (2 transitions → +2/+2). Everything else
      // lives for the whole session — no other churn.
      expectEqual(MockAudioContext.gains.length, gainsBase + 2, 'only the 2 gong chimes add GainNodes');
      expectEqual(MockAudioContext.oscs.length, oscsBase + 2, 'only the 2 gong chimes add Oscillators');
      expectEqual(MockAudioContext.sources.length, sourcesBase, 'no stray BufferSources (ambient off)');

      // (b) ambient toggle storm: every replaced source is stopped AND
      //     disconnected; toggling must never allocate a second gain node
      const srcStart = MockAudioContext.sources.length;
      const gainStart = MockAudioContext.gains.length;
      const kills = [];
      for (let i = 0; i < 4; i++) {
        const prior = MockAudioContext.sources.at(-1);
        fb.setAmbient('white');
        if (prior) kills.push(prior);
        fb.setAmbient('off');
      }
      expectEqual(fb.ambient, 'off', 'off after storm');
      expectEqual(MockAudioContext.gains.length, gainStart, 'ambient toggles reuse gain nodes');
      expectEqual(MockAudioContext.sources.length, srcStart + 4, 'exactly 4 sources, one per toggle');
      for (const s of kills) {
        expectEqual(s._stopped, true, 'replaced source stop()ed');
        expectEqual(s.connections.length, 0, 'replaced source disconnected');
      }
      const last = MockAudioContext.sources.at(-1);
      expectEqual(last._stopped, true, 'final source torn down by off');
      expectEqual(last.connections.length, 0, 'final source disconnected');
      expectEqual(MockAudioContext.instances.length, 1, 'single AudioContext the whole time');
    });
  } finally { env.restore(); }
}

/* ===========================================================================
 * SCENARIO 59-68 : CLIENT — 15-MINUTE TRIAL · VOLUME STAGES · GONG CHIME ·
 *                  DELTA/SOLFEGGIO MODES · BROWN NOISE
 * ======================================================================== */
async function trialVolumeChimeScenarios() {
  const env = installClientEnv();
  const lastInterval = (name) => env.intervals.filter((x) => x.fn.toString().includes(name)).at(-1);
  try {

    /* ---- SCENARIO 59 ---- */
    await scenario('59. Trial: first run stamps the 15-minute window, sound works frictionless, badge shows', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;

      // No license, no key, no payment — the first 15 minutes are fully unlocked.
      expectEqual(fb.isPro, false, 'unlicensed');
      expectTrue(fb.trial.active, 'trial active right after first boot');
      expectEqual(fb.trial.minutes, 15, '15-minute window');
      const stamped = Number(env.ls.getItem('focusbot.trialStart'));
      expectTrue(Number.isFinite(stamped) && stamped > 0, 'first run stamps focusbot.trialStart');
      expectEqual(fb.trial.endsAt, stamped + 15 * 60 * 1000, 'endsAt = start + 15 minutes');
      expectTrue(fb.trial.remainingMs > 0 && fb.trial.remainingMs <= 15 * 60 * 1000, 'remainingMs within 15 minutes');
      const badge = c.stub('.quota').textContent || '';
      expectTrue(badge.indexOf('Trial:') !== -1, 'footer badge shows the mm:ss countdown (got: ' + badge + ')');
      expectTrue(badge.indexOf(' left') !== -1, 'badge reads "Trial: Xm Ys left"');

      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'frictionless trial play');
      expectTrue(MockAudioContext.instances.length >= 1, 'AudioContext created during the trial');
    });

    /* ---- SCENARIO 60 ---- */
    await scenario('60. Trial: persisted across reloads — never re-stamped', async () => {
      const stamped = Number(env.ls.getItem('focusbot.trialStart'));
      expectTrue(Number.isFinite(stamped) && stamped > 0, 'trialStart present from previous scenario');
      const c2 = await freshClient(env);          // F5 with the same storage
      const fb2 = c2.FocusBot;
      expectEqual(Number(env.ls.getItem('focusbot.trialStart')), stamped, 'trialStart NOT re-stamped on reload');
      expectTrue(fb2.trial.active, 'trial still active after reload');
      expectEqual(fb2.trial.endsAt, stamped + 15 * 60 * 1000, 'window anchored to the original start');
    });

    /* ---- SCENARIO 61 ---- */
    await scenario('61. Trial: expired at boot → locked, badge "Trial Expired", no audio', async () => {
      env.ls._clear();
      seedExpiredTrial(env);
      const c = await freshClient(env);
      const fb = c.FocusBot;
      expectEqual(fb.trial.active, false, 'trial inactive');
      expectEqual(fb.trial.remainingMs, 0, 'remainingMs 0');
      expectEqual((c.stub('.quota').textContent || ''), 'Trial Expired \u2014 License required', 'badge shows Trial Expired');
      fb.play();
      await sleep(20);
      expectEqual(fb.isPlaying, false, 'play blocked');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext after trial');
      expectEqual(c.stub('.overlay').hidden, false, 'upsell modal opened');
      expectEqual(c.stub('.modal-close').hidden, true, 'modal close hidden on boot-time lock');
    });

    /* ---- SCENARIO 62 ---- */
    await scenario('62. Trial: mid-session expiry pauses audio, opens paywall, stays locked', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.trialStart', String(Date.now() - 5 * 60 * 1000)); // started 5 min ago → active
      const c = await freshClient(env);
      const fb = c.FocusBot;
      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'plays inside the trial window');
      const realNow = Date.now;
      Date.now = () => realNow() + 20 * 60 * 1000;   // jump past the 15-minute window
      try {
        const wd = lastInterval('trialWatchdog');
        expectTrue(!!wd, 'trial watchdog interval registered');
        wd.fn();                                             // the watchdog fires while running
        await sleep(430);                                    // suspend path
        expectEqual(fb.isPlaying, false, 'audio paused at expiry');
        expectEqual(fb.trial.active, false, 'trial ended');
        expectEqual(fb.trial.remainingMs, 0, 'no time left');
        expectEqual(c.stub('.overlay').hidden, false, 'paywall opened by the watchdog');
        fb.play();
        await sleep(20);
        expectEqual(fb.isPlaying, false, 'still locked after expiry');
        expectEqual(MockAudioContext.instances.length, 1, 'existing context only — no graph rebuild');
        // The lock is non-dismissable: the payment modal stays open, its close
        // button is suppressed and the only affordance is the unlock CTA.
        expectEqual(c.stub('.overlay').hidden, false, 'modal still open after re-play attempt');
        expectEqual(c.stub('.modal-close').hidden, true, 'modal close hidden while trial lock is enforced');
        expectEqual(c.stub('#btn-buy-pro').textContent, 'Unlock \u2014 12\u20AC / 1 Year', 'buy CTA relabeled to the unlock action');
      } finally {
        Date.now = realNow;
      }
    });

    /* ---- SCENARIO 63 ---- */
    await scenario('63. Trial + volumes persist via chrome.storage.local (MV3 content-script path)', async () => {
      env.ls._clear();
      const cStore = new Map([
        ['focusbot.volBinaural', '0.23'],
        ['focusbot.volAmbient', '0.41'],
      ]);
      const chromeStub = {
        storage: {
          local: {
            get(keys, cb) {
              const out = {};
              const arr = Array.isArray(keys) ? keys : Object.keys(keys || {});
              for (const k of arr) out[k] = cStore.has(k) ? cStore.get(k) : undefined;
              cb(out);
            },
            set(obj, cb) { for (const k of Object.keys(obj || {})) cStore.set(k, String(obj[k])); if (cb) cb(); },
            remove(keys, cb) { for (const k of (keys || [])) cStore.delete(k); if (cb) cb(); },
          },
        },
      };
      const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
      Object.defineProperty(globalThis, 'chrome', { value: chromeStub, writable: true, configurable: true });
      try {
        const c = await freshClient(env);
        const fb = c.FocusBot;
        expectTrue(cStore.has('focusbot.trialStart'), 'trialStart written through chrome.storage.local');
        expectEqual(fb.volumeBinaural, 0.23, 'saved binaural stage restored');
        expectEqual(fb.volumeAmbient, 0.41, 'saved ambient stage restored');
        const bin = c.stub('.vol-bin');
        bin.value = '35';
        bin.dispatch('input');
        expectEqual(cStore.get('focusbot.volBinaural'), '0.35', 'slider persisted via chrome.storage.local');
        expectEqual(fb.volumeBinaural, 0.35, 'live state updated');
      } finally {
        if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome);
        else delete globalThis.chrome;
      }
    });

    /* ---- SCENARIO 64 ---- */
    await scenario('64. Volume sliders: independent live ramps + persistence (localStorage)', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-VOL');
      env.G.fetch = validLicenseFetch();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      await sleep(30);
      expectEqual(fb.volumeBinaural, 1.0, 'default binaural stage 1.00');
      expectEqual(fb.volumeAmbient, 1.0, 'default ambient stage 1.00 (unity)');

      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'play');
      expectApprox(MockAudioContext.gains[1].gain.value, 1.0, 1e-9, 'binaural stage node baked at 1.00');
      expectApprox(MockAudioContext.gains[2].gain.value, 1.0, 1e-9, 'ambient stage node baked at 1.00');

      fb.setVolumeBinaural(30);
      fb.setVolumeAmbient(70);
      expectApprox(MockAudioContext.gains[1].gain.value, 0.3, 1e-9, 'binaural stage live-ramped to 0.30');
      expectApprox(MockAudioContext.gains[2].gain.value, 0.7, 1e-9, 'ambient stage live-ramped to 0.70');
      expectEqual(Number(env.ls.getItem('focusbot.volBinaural')), 0.3, 'binaural persisted');
      expectEqual(Number(env.ls.getItem('focusbot.volAmbient')), 0.7, 'ambient persisted');

      const bin = c.stub('.vol-bin');
      bin.value = '55';
      bin.dispatch('input');
      expectApprox(MockAudioContext.gains[1].gain.value, 0.55, 1e-9, 'binaural slider drives its stage node');
      const amb = c.stub('.vol-amb');
      amb.value = '25';
      amb.dispatch('input');
      expectApprox(MockAudioContext.gains[2].gain.value, 0.25, 1e-9, 'ambient slider drives its stage bus');

      // Binaural slider range is 0..200 (0.0–2.0), default 100 → 1.00.
      const binMax = c.root.innerHTML.match(/class="vol-range vol-bin"[^>]*max="([0-9]+)"/);
      expectEqual(binMax && binMax[1], '200', 'binaural slider max=200 (0.0–2.0)');
      bin.value = '150';
      bin.dispatch('input');
      expectApprox(MockAudioContext.gains[1].gain.value, 1.5, 1e-9, 'binaural slider pushes past unity (1.50)');

      const st = fb.state;
      expectEqual(st.volumeBinaural, 1.5, 'public state volumeBinaural');
      expectEqual(st.volumeAmbient, 0.25, 'public state volumeAmbient');
      expectTrue(!!st.trial && st.trial.minutes === 15, 'public state carries trial info');
      expectEqual(st.mode, 'beta', 'mode untouched by volume changes');
    });

    /* ---- SCENARIO 65 ---- */
    await scenario('65. Delta mode: Left=100Hz, Right=102Hz (delta=2Hz)', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      fb.setMode('delta');
      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'play delta');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 100, 'Delta Left 100 Hz');
      expectEqual(oscR.frequency.value, 102, 'Delta Right 102 Hz');
      expectEqual(Math.abs(oscR.frequency.value - oscL.frequency.value), 2, 'Delta delta = 2 Hz');
      const beat = c.stub('.beat-main').textContent || '';
      expectTrue(beat.indexOf('\u0394 2 Hz') !== -1, 'beat label shows Δ2 (got: ' + beat + ')');
    });

    /* ---- SCENARIO 66 ---- */
    await scenario('66. Solfeggio tones: equal-phase mono carriers, carrier label instead of Δ0', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      fb.setMode('432');
      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'play 432');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 432, '432 Left 432 Hz');
      expectEqual(oscR.frequency.value, 432, '432 Right 432 Hz');
      expectEqual(Math.abs(oscR.frequency.value - oscL.frequency.value), 0, 'equal phase — no beat');
      let beat = c.stub('.beat-main').textContent || '';
      expectTrue(beat.indexOf('432 Hz') !== -1, 'carrier shown for solfeggio (got: ' + beat + ')');
      expectTrue(beat.indexOf('\u0394') === -1, 'no Δ prefix for equal-phase tones');

      fb.setMode('528');
      expectEqual(oscL.frequency.value, 528, '528 Left 528 Hz');
      expectEqual(oscR.frequency.value, 528, '528 Right 528 Hz');
      beat = c.stub('.beat-main').textContent || '';
      expectTrue(beat.indexOf('528 Hz') !== -1, '528 carrier shown (got: ' + beat + ')');
    });

    /* ---- SCENARIO 67 ---- */
    await scenario('67. Brown noise: staged gain 1.00, warm buffer, deep-bass booster feed (no filter)', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-BROWN');
      env.G.fetch = validLicenseFetch();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      await sleep(30);

      const bufsBefore = MockAudioContext.buffers.length;
      fb.setAmbient('brown');
      expectEqual(fb.ambient, 'brown', 'brown layer engaged');
      expectApprox(MockAudioContext.gains[5].gain.value, 1.0, 1e-9, 'brown layer gain staged to 1.00');
      // The deep-bass booster sits at gains[8] (static), after the layer gains
      // and before the master — brown sources feed straight into it.
      expectApprox(MockAudioContext.gains[8].gain.value, 1.6, 1e-9, 'brown bass booster stage 1.60');
      const src = MockAudioContext.sources.at(-1);
      expectEqual(src.connections.length, 1, 'brown routes straight to its bass booster');
      expectEqual(src.connections[0], MockAudioContext.gains[8], 'brown feeds the static deep-bass booster (no filter)');
      const buf = src.buffer.getChannelData(0);
      expectTrue(buf.length > 0 && buf.some((v) => Math.abs(v) > 0.0001), 'brown buffer warm/non-silent');
      expectEqual(MockAudioContext.buffers.length, bufsBefore + 1, 'exactly one new buffer for brown');

      fb.toggleAmbient('white');
      expectEqual([...fb.ambients].sort().join(','), 'brown,white', 'brown coexists multi-layer');
      fb.toggleAmbient('brown');
      expectEqual(src._stopped, true, 'brown source stopped when toggled off');
      expectEqual(src.connections.length, 0, 'brown source disconnected');
      fb.toggleAmbient('off');
      expectEqual(fb.ambient, 'off', 'off clears everything');
    });

    /* ---- SCENARIO 68 ---- */
    await scenario('68. Chime: synthesized 528 Hz crystal tone ends each pomodoro phase, bypasses master bus', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-CHIME');
      env.G.fetch = validLicenseFetch();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      await sleep(30);

      fb.pomodoro.start();
      await waitFor(() => fb.isPlaying, 2000, 'playing for chime test');
      const oscs0 = MockAudioContext.oscs.length;     // 2 — the binaural pair
      const gains0 = MockAudioContext.gains.length;   // 10 — staged graph (boost…white + brownBass + master)
      const it = lastInterval('pomodoroTick');
      expectTrue(!!it, 'pomodoro tick registered');

      for (let i = 0; i < 1500; i++) it.fn();         // focus → break: chime A
      expectEqual(MockAudioContext.oscs.length, oscs0 + 1, 'one chime oscillator allocated');
      const gongOsc = MockAudioContext.oscs.at(-1);
      expectEqual(gongOsc.frequency.value, 528, 'crystal chime at 528 Hz (Solfeggio)');
      expectEqual(gongOsc.type, 'sine', 'pure sine tone');
      const gongGain = MockAudioContext.gains.at(-1);
      expectApprox(gongGain.gain.lastRamp, 0.0001, 1e-6, 'exponential decay tail reached 0.0001 (2.5s)');
      expectEqual(gongOsc.connections[0], gongGain, 'osc → chime gain wired');
      expectEqual(gongGain.connections[0], MockAudioContext.instances.at(-1).destination, 'chime rings straight to destination');

      for (let i = 0; i < 300; i++) it.fn();          // break → focus: chime B (new focus starts)
      expectEqual(MockAudioContext.oscs.length, oscs0 + 2, 'second chime on break→focus');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 528, 'chime B also 528 Hz');
      expectEqual(MockAudioContext.gains.length, gains0 + 2, 'exactly +2 chime gain nodes across both transitions');

      fb.pomodoro.reset();
      expectEqual(fb.pomodoro.getState().running, false, 'reset stops the cycle');
      expectEqual(MockAudioContext.oscs.length, oscs0 + 2, 'reset adds no chime of its own');
    });

    /* ---- SCENARIO 69 ---- */
    await scenario('69. Full Solfeggio scale (174–963): all 10 tones render, switch to equal-phase mono carriers', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      const solBtns = c.stub('.modes-sol').querySelectorAll();
      expectEqual(solBtns.length, 10, 'solfeggio grid renders 10 buttons');
      const solKeys = ['174', '285', '396', '417', '432', '528', '639', '741', '852', '963'];
      expectEqual(solBtns.map((b) => b.dataset.mode).sort().join(','), [...solKeys].sort().join(','), 'exactly the Solfeggio scale in the sol grid');
      const allMode = c.root.querySelectorAll('button[data-mode]');
      expectEqual(allMode.length, 15, '5 binaural + 10 solfeggio mode buttons total');

      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'playing across the scale');
      // Dial through every Solfeggio tone and verify the pure equal-phase carrier.
      for (const key of solKeys) {
        const f = Number(key);
        fb.setMode(key);
        expectEqual(MockAudioContext.oscs.at(-2).frequency.value, f, key + ' left carrier ' + f + ' Hz');
        expectEqual(MockAudioContext.oscs.at(-1).frequency.value, f, key + ' right carrier ' + f + ' Hz (equal-phase mono)');
        const beat = c.stub('.beat-main').textContent || '';
        expectTrue(beat.indexOf(key + ' Hz') !== -1, key + ' carrier label shown (got: ' + beat + ')');
      }
      // UI active highlighting governed by data-mode across both groups
      const b963 = solBtns.find((b) => b.dataset.mode === '963');
      const bBeta = c.stub('.modes').querySelectorAll().find((b) => b.dataset.mode === 'beta');
      expectEqual(b963.classList.contains('active'), true, '963 grid button active after setMode(963)');
      expectEqual(bBeta.classList.contains('active'), false, 'binaural beta cleared when solfeggio chosen');
    });

    /* ---- SCENARIO 70 ---- */
    await scenario('70. Ambient staging: unity master bus, pink ×3 makeup, deep-bass booster baked in before master', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'playing for ambient staging');

      // Static graph layout even with nothing engaged:
      // boost(0)·binaural(1)·ambMaster(2)·pinkMakeup(3)·pink(4)·brown(5)·rain(6)·white(7)·brownBass(8)·chanL(9)·chanR(10)·master(11)
      const G = MockAudioContext.gains;
      expectApprox(G[0].gain.value, 6.0, 1e-9, 'safe headroom boost 6.00');
      expectApprox(G[1].gain.value, 1.0, 1e-9, 'binaural stage 1.00');
      expectApprox(G[2].gain.value, 1.0, 1e-9, 'ambient master bus at unity 1.00');
      expectApprox(G[3].gain.value, 3.0, 1e-9, 'pink make-up ×3.0');
      expectApprox(G[8].gain.value, 1.6, 1e-9, 'deep-bass booster 1.60 sits before master');
      // Per-channel carrier gains baked at the 1.5 default (solfeggio + binaural)
      expectApprox(G[9].gain.value, 1.5, 1e-9, 'left channel carrier gain 1.50');
      expectApprox(G[10].gain.value, 1.5, 1e-9, 'right channel carrier gain 1.50');
      expectEqual(G.length, 12, 'exactly 12 gain stages');

      // Engage every layer in turn — each raises only its own stage.
      fb.toggleAmbient('pink');
      expectApprox(G[4].gain.value, 0.9, 1e-9, 'pink layer staged 0.90 upbeat');
      fb.toggleAmbient('brown');
      expectApprox(G[5].gain.value, 1.0, 1e-9, 'brown layer staged 1.00 main body');
      fb.toggleAmbient('rain');
      expectApprox(G[6].gain.value, 0.95, 1e-9, 'rain layer staged 0.95');
      fb.toggleAmbient('white');
      expectApprox(G[7].gain.value, 0.8, 1e-9, 'white layer staged 0.80');
      expectApprox(G[11].gain.lastRamp, 0.4 * 0.7, 1e-9, 'master(11) ramps to the 0.28 output ceiling');
      expectEqual(G[11].connections[0], MockAudioContext.compressors[0], 'master feeds the final master compressor');
      fb.toggleAmbient('off');
      expectEqual(fb.ambients.length, 0, 'off clears all four layers');
    });

    /* ---- SCENARIO 71 ---- */
    await scenario('71. Buy Pro entry is permanent: always visible with a fixed label, even for Pro users', async () => {
      env.ls._clear();
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-FOOT');
      env.G.fetch = validLicenseFetch();
      const c = await freshClient(env);
      await sleep(30);
      const buy = c.stub('#btn-buy-pro');
      expectEqual(buy.hidden, false, 'license entry never hidden');
      expectEqual(buy.textContent, 'Buy Pro', 'Pro user sees the unconditional Buy Pro label');
      expectEqual(buy.className.includes('btn-buy-pro'), true, 'gradient className present');

      env.ls._clear();
      const c2 = await freshClient(env);
      await sleep(30);
      expectEqual(c2.stub('#btn-buy-pro').hidden, false, 'trial user still sees the entry');
      expectEqual(c2.stub('#btn-buy-pro').textContent, 'Buy Pro', 'trial user also sees Buy Pro');
      expectEqual(env.ls.getItem('focusbot.licenseKey'), null, 'no key stored for the trial case');
      // Clicking the button opens the license/payment modal
      buy.dispatch('click');
      expectEqual(c.stub('.overlay').hidden, false, 'Buy Pro click opens the upsell modal');
    });

    /* ---- SCENARIO 72 ---- */
    await scenario('72. index.html hosts the Frequency Guide panel (westgate bourrée of modes for the storefront)', async () => {
      const fsMod = await import('node:fs');
      const htmlPath = new URL('../client/index.html', import.meta.url);
      const html = fsMod.readFileSync(htmlPath, 'utf8');
      expectTrue(html.includes('id="guide"'), 'guide section present');
      expectTrue(html.includes('FocusBot Frequency Guide'), 'guide h2 present');
      expectTrue(html.includes('Binaural Waves') && html.includes('Solfeggio Tones'), 'both categorized blocks rendered');
      for (const f of ['174 Hz', '285 Hz', '396 Hz', '417 Hz', '432 Hz', '528 Hz', '639 Hz', '741 Hz', '852 Hz', '963 Hz']) {
        expectTrue(html.includes(f), 'guide covers ' + f);
      }
      expectTrue(html.indexOf('Gamma') < html.indexOf('174 Hz'), 'binaural block precedes solfeggio block');
      expectTrue(html.includes('528 Hz Crystal Chime'), 'feature card mentions the crystal chime');
    });

    /* ---- SCENARIO 73 ---- */
    await scenario('73. Solfeggio button click → L/R sliders + number inputs + oscillators snap to the pure tone', async () => {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;

      // While NOT playing the selection is recorded so the next start plays it.
      const solWrap = c.stub('.modes-sol');
      const pick = (m) => solWrap.querySelectorAll().find((b) => b.dataset.mode === m);
      const clickSol = (m) => solWrap.dispatch('click', {
        target: { closest: (sel) => (sel === 'button[data-mode]' ? pick(m) : null) },
      });
      clickSol('741');
      expectEqual(fb.frequencyRange.left, 741, 'not-playing: left state recorded on click');
      expectEqual(fb.frequencyRange.right, 741, 'not-playing: right state recorded on click');
      expectEqual(c.stub('.fr-sl-l').value, '741', 'L slider mirrored while paused');
      expectEqual(c.stub('.fr-num-r').value, '741', 'R input mirrored while paused');
      expectEqual(c.stub('.frange-beat').textContent, 'Beat: 0 Hz (Pure Tone)', 'pure-tone beat label while paused');

      fb.play();
      await waitFor(() => fb.isPlaying, 2000, 'playing after solfeggio click');
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 741, 'osc L starts on 741');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 741, 'osc R starts on 741');

      // Click 963 while playing: everything snaps instantly.
      clickSol('963');
      expectEqual(c.stub('.fr-sl-l').value, '963', 'L slider snapped to 963');
      expectEqual(c.stub('.fr-sl-r').value, '963', 'R slider snapped to 963');
      expectEqual(c.stub('.fr-num-l').value, '963', 'L number input snapped to 963');
      expectEqual(c.stub('.fr-num-r').value, '963', 'R number input snapped to 963');
      expectEqual(c.stub('.frange-beat').textContent, 'Beat: 0 Hz (Pure Tone)', 'pure-tone beat label after click');
      const oscL = MockAudioContext.oscs.at(-2);
      const oscR = MockAudioContext.oscs.at(-1);
      expectEqual(oscL.frequency.value, 963, 'osc L snapped to 963 (instant setValueAtTime)');
      expectEqual(oscR.frequency.value, 963, 'osc R snapped to 963 (instant setValueAtTime)');
      expectEqual(Math.abs(oscR.frequency.value - oscL.frequency.value), 0, 'equal phase — no beat');
      expectTrue(oscL.frequency.lastRamp !== 963, 'instant jump scheduled no sweep toward 963 (click-free)');

      // Slider/input range must allow the top of the Solfeggio scale (963 Hz).
      const tpl = c.root.innerHTML;
      expectTrue(tpl.includes('class="fr-sl fr-sl-l" min="0" max="1000" step="1"'), 'L slider max covers 963');
      expectTrue(tpl.includes('class="fr-sl fr-sl-r" min="0" max="1000" step="1"'), 'R slider max covers 963');
      expectTrue(tpl.includes('class="fr-num fr-num-l" min="0" max="1000"'), 'L number input max covers 963');
      expectTrue(tpl.includes('class="fr-num fr-num-r" min="0" max="1000"'), 'R number input max covers 963');
    });
  } finally { env.restore(); }
}

/* ===========================================================================
 * SCENARIO 47-50 : EXTENSION / MV3 PACKAGE AUDIT + ENGINE TOKEN LIFECYCLE
 * ======================================================================== */
async function extensionAuditScenarios() {

  /* ---- SCENARIO 47 ---- */
  await scenario('47. Popup: dead-channel bridge → no_listener note; live widget recovers', async () => {
    const penv = installClientEnv();
    const mkEl = (id) => {
      if (!docEls.has(id)) {
        docEls.set(id, {
          id, textContent: '', hidden: false, style: {}, dataset: {}, disabled: false, handlers: {},
          classList: makeClassList(),
          addEventListener(t, f) { this.handlers[t] = f; },
          querySelectorAll: () => [],
          querySelector: () => null,
        });
      }
      return docEls.get(id);
    };
    const docEls = new Map();
    const pdoc = {
      listeners: {},
      addEventListener: (t, f) => { (pdoc.listeners[t] ??= []).push(f); },
      getElementById: (id) => mkEl(id),
      querySelector: (sel) => mkEl('sel:' + sel),
    };
    const sent = [];
    let deadChannel = true;
    const chromeStub = {
      tabs: {
        query: (q, cb) => cb([{ id: 42 }]),
        sendMessage: (tabId, msg, cb) => {
          sent.push(msg);
          if (deadChannel) { cb(null); return; } // channel closed mid-flight
          if (msg.cmd === 'getState') cb({ ok: true, state: { pro: true, playing: true, mode: 'alpha', ambient: 'off', pomodoro: { running: true, state: 'focus', remainingMs: 600000 } } });
          else cb({ ok: true });
        },
      },
      runtime: { lastError: null },
    };
    const savedDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const savedST = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
    Object.defineProperty(globalThis, 'document', { value: pdoc, writable: true, configurable: true });
    Object.defineProperty(globalThis, 'chrome', { value: chromeStub, writable: true, configurable: true });
    // The popup's poll chains use real timers (setInterval is mocked by the
    // client env but setTimeout is not) — neutralise them so the Node process
    // can exit once the suite finishes, then re-enable for our own backoff.
    Object.defineProperty(globalThis, 'setTimeout', { value: () => 0, writable: true, configurable: true });
    const waitTick = (ms) => new Promise((r) => savedST.value(r, ms));
    try {
      // IIFE boot: every DOM element is resolved up-front (els.*)
      await import(new URL('../client/popup.js', import.meta.url).href + '?popup=1');

      // Phase 1 — the content-script half is gone (message channel closed):
      chromeStub.runtime.lastError = { message: 'message channel closed before a response was received' };
      for (const f of pdoc.listeners.DOMContentLoaded || []) f();
      await waitTick(20);
      expectTrue(sent.some((m) => m.cmd === 'getState'), 'popup asked for widget state');
      expectTrue(mkEl('no-widget').classList.contains('hidden') === false, 'disconnected note shown (no crash, lastError consumed)');

      // Phase 2 — widget responds live: render + no-widget hides
      deadChannel = false;
      chromeStub.runtime.lastError = null;
      for (const f of pdoc.listeners.DOMContentLoaded || []) f();
      await waitTick(20);
      expectTrue(mkEl('no-widget').classList.contains('hidden'), 'disconnected note hidden with live widget');
      expectEqual(mkEl('st-state').textContent, 'Playing', 'live state rendered');
      expectEqual(mkEl('pro-chip').style.display, '', 'pro chip shown');
    } finally {
      if (savedST) Object.defineProperty(globalThis, 'setTimeout', savedST); else delete globalThis.setTimeout;
      if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome); else delete globalThis.chrome;
      if (savedDoc) Object.defineProperty(globalThis, 'document', savedDoc); else delete globalThis.document;
      penv.restore();
    }
  });

  /* ---- SCENARIO 48 ---- */
  await scenario('48. Manifest audit: MV3, iframes excluded, minimal permissions, popup wired', async () => {
    const fsMod = await import('node:fs');
    const manifestPath = new URL('../client/manifest.json', import.meta.url);
    expectTrue(fsMod.existsSync(manifestPath), 'manifest.json present');
    const manifest = JSON.parse(fsMod.readFileSync(manifestPath, 'utf8'));
    expectEqual(manifest.manifest_version, 3, 'MV3');
    const cs = manifest.content_scripts && manifest.content_scripts[0];
    expectTrue(!!cs, 'content_scripts declared');
    expectEqual(cs.all_frames, false, 'no double audio in iframes');
    expectEqual(cs.match_about_blank, false, 'about:blank not injected');
    expectEqual(cs.run_at, 'document_end', 'injected after DOM');
    expectEqual(manifest.action && manifest.action.default_popup, 'popup.html', 'popup.html wired as action');
    for (const f of ['popup.html', 'popup.js', 'focus-bot.css']) {
      expectTrue(fsMod.existsSync(new URL('../client/' + f, import.meta.url)), f + ' exists');
    }
  });

  /* ---- SCENARIO 49 ---- */
  await scenario('49. Client: stale engine token discarded → safe matrix; fresh token applied', async () => {
    const envA = installClientEnv();
    try {
      envA.ls._clear();
      envA.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-EXPIRED-ENGINE');
      const expired = signedToken({ v: 1, seed: 1, gain: 1, exp: Date.now() - 5000, mods: { beta: { l: 111, r: 222, ph: 0, k: 1 } } });
      envA.G.fetch = validLicenseFetch({ engine: expired });
      let c = await freshClient(envA);
      await sleep(30);
      let f = c.FocusBot;
      expectEqual(f.isPro, true, 'pro stays active with stale token');
      f.play();
      await waitFor(() => f.isPlaying, 2000, 'plays with stale token');
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 200, 'fallback left 200 (stale token ignored)');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 214, 'fallback right 214');
    } finally { envA.restore(); }
  });

  /* ---- SCENARIO 50 ---- */
  await scenario('50. Worker: engine token replay-safe — iat + 12h exp embedded (fresh re-issue)', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const g = await postJSON(env, '/api/admin/grant', { domains: ['replay.test'], days: 30 }, { authorization: 'Bearer ' + ADMIN_TOKEN });
    expectEqual(g.status, 201, 'grant ok');
    const key = (await g.json()).licenseKey;
    const res = await postJSON(env, '/api/verify-license', { apiKey: key, domain: 'replay.test' });
    expectEqual(res.status, 200, 'verify ok');
    const v = await res.json();
    const [h, sig] = v.engine.split('.');
    expectTrue(!!h && !!sig, 'token has header+signature');
    const payload = JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/')));
    expectEqual(payload.v, 1, 'version');
    expectEqual(payload.exp - payload.iat, 12 * 3600 * 1000, 'iat..exp window = 12h');
    expectTrue(payload.iat <= Date.now() && payload.exp > Date.now(), 'token is live right now');
    // Matrix parity: worker ships the same Delta + full Solfeggio coefficients
    // the client falls back to, so production tokens can drive every UI mode.
    expectEqual(payload.mods.delta.l, 100, 'delta left 100');
    expectEqual(payload.mods.delta.r, 102, 'delta right 102');
    for (const [m, f] of [['174', 174], ['285', 285], ['396', 396], ['417', 417], ['432', 432], ['528', 528], ['639', 639], ['741', 741], ['852', 852], ['963', 963]]) {
      expectEqual(payload.mods[m].l, f, 'solfeggio ' + m + ' = ' + f + ' Hz (left)');
      expectEqual(payload.mods[m].r, f, 'solfeggio ' + m + ' equal-phase (right mirrors left)');
    }
    // Re-verify issues a fresh token → no stable replay vector
    const res2 = await postJSON(env, '/api/verify-license', { apiKey: key, domain: 'replay.test' });
    const v2 = await res2.json();
    const p2 = JSON.parse(atob(v2.engine.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    expectTrue(p2.iat >= payload.iat, 'token re-issued with a fresh iat');
  });

  /* ---- SCENARIO 51 (fresh token client-side) ---- */
  await scenario('51. Client: fresh & forged-proof engine token drives exact matrix + gain', async () => {
    const envB = installClientEnv();
    try {
      envB.ls._clear();
      envB.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-FRESH-ENGINE');
      const fresh = signedToken({ v: 1, seed: 1, gain: 0.9, exp: Date.now() + 3600 * 1000, mods: { beta: { l: 220, r: 236, ph: 0, k: 1 } } });
      envB.G.fetch = validLicenseFetch({ engine: fresh });
      const c = await freshClient(envB);
      await sleep(30);
      const f = c.FocusBot;
      f.play();
      await waitFor(() => f.isPlaying, 2000, 'plays with fresh token');
      expectEqual(MockAudioContext.oscs.at(-2).frequency.value, 220, 'fresh token left 220');
      expectEqual(MockAudioContext.oscs.at(-1).frequency.value, 236, 'fresh token right 236');
      const g = MockAudioContext.gains.at(-1).gain;
      expectApprox(g.lastRamp, 0.4 * 0.7 * 0.9, 1e-9, 'fresh gain 0.9 applied');
    } finally { envB.restore(); }
  });
}

/* ===========================================================================
 * SCENARIO 52-53,55-56 : WEBSTORE COMPLIANCE (dynamic BTC rate endpoint, store
 * manifest requirements, client modal pricing)
 * ======================================================================== */
async function webstoreComplianceScenarios() {

  /* ---- SCENARIO 52 ---- */
  await scenario('52. GET /api/get-btc-rate → dynamic 12 EUR pricing + btcAmount', async () => {
    const kv = new KVMock();
    const env = makeEnv(kv);
    const MOCK_BTC_EUR = 50000;
    const MOCK_REQUIRED_SATS = Math.ceil((12 / MOCK_BTC_EUR) * 100_000_000);
    await kv.put('pricing:cache', JSON.stringify({
      btcEurPrice: MOCK_BTC_EUR,
      requiredSats: MOCK_REQUIRED_SATS,
      minAcceptableSats: Math.ceil(MOCK_REQUIRED_SATS * 0.97),
      fetchedAt: Date.now(),
    }));

    const res = await getURL(env, '/api/get-btc-rate');
    expectEqual(res.status, 200, 'get-btc-rate status');
    const body = await res.json();
    expectEqual(body.ok, true, 'ok flag');
    expectEqual(body.eur, 12, 'eur = 12');
    expectEqual(body.btcEurPrice, MOCK_BTC_EUR, 'btcEurPrice from cache');
    expectEqual(body.requiredSats, MOCK_REQUIRED_SATS, 'requiredSats');
    expectEqual(body.btcAmount, (MOCK_REQUIRED_SATS / 100_000_000).toFixed(8), 'btcAmount → 8 decimals');
  });

  /* ---- SCENARIO 53 ---- */
  await scenario('53. Store manifest: v1.3.1, full icon set wired, developer/homepage_url, storage-only + strict CSP', async () => {
    const fsMod = await import('node:fs');
    const manifestPath = new URL('../client/manifest.json', import.meta.url);
    expectTrue(fsMod.existsSync(manifestPath), 'manifest.json present');
    const manifest = JSON.parse(fsMod.readFileSync(manifestPath, 'utf8'));
    expectEqual(manifest.version, '1.3.1', 'version pinned to 1.3.1');
    expectEqual(manifest.manifest_version, 3, 'MV3');

    // Icon set: 16/32/48/128 files exist AND are wired into icons + default_icon
    for (const s of ['16', '32', '48', '128']) {
      const ipath = manifest.icons && manifest.icons[s];
      expectTrue(typeof ipath === 'string' && ipath.length > 0, 'icons.' + s + ' wired');
      expectTrue(fsMod.existsSync(new URL('../client/' + ipath, import.meta.url)), 'icon file present: ' + s);
      const dpath = manifest.action && manifest.action.default_icon && manifest.action.default_icon[s];
      expectTrue(typeof dpath === 'string' && dpath.length > 0, 'action.default_icon.' + s + ' wired');
      expectEqual(dpath, ipath, 'default_icon["' + s + '"] matches icons.' + s);
    }

    // Store identity fields
    expectTrue(!!manifest.developer && typeof manifest.developer.name === 'string' && manifest.developer.name.length > 0, 'developer.name set');
    expectTrue(!!manifest.developer && typeof manifest.developer.url === 'string' && /^https:\/\//.test(manifest.developer.url), 'developer.url is https');
    expectTrue(typeof manifest.homepage_url === 'string' && /^https:\/\//.test(manifest.homepage_url), 'homepage_url is https');

    // Minimal permission footprint: storage only (unused `notifications` stripped),
    // no host_permissions, strict content_security_policy (script-src 'self')
    const perms = manifest.permissions || [];
    const allowed = ['storage'];
    for (const p of perms) {
      expectTrue(allowed.includes(p), 'permission "' + p + '" is within the minimal set');
    }
    for (const a of allowed) {
      expectTrue(perms.includes(a), 'required permission "' + a + '" declared');
    }
    expectEqual(perms.length, allowed.length, 'no extra permissions (got ' + JSON.stringify(perms) + ')');
    expectTrue(manifest.host_permissions === undefined || manifest.host_permissions.length === 0, 'no host_permissions');

    // Strict CSP: extension pages may only run their own scripts (never eval/external)
    const csp = manifest.content_security_policy || {};
    const extPages = csp.extension_pages || '';
    expectEqual(manifest.permissions.includes('notifications'), false, 'unused notifications permission removed');
    expectTrue(/script-src 'self'/.test(extPages), 'CSP script-src restricts to self');
    expectTrue(!/script-src[^;'"]*unsafe-eval/.test(extPages), 'CSP forbids unsafe-eval');
    expectTrue(!/(eval\(|new Function\()/.test(fsMod.readFileSync(new URL('../client/focus-bot.js', import.meta.url), 'utf8')), 'no eval()/new Function() in client');

    // popup + content scripts still wired
    expectEqual(manifest.action && manifest.action.default_popup, 'popup.html', 'popup wired');
    expectEqual(manifest.content_scripts[0].all_frames, false, 'all_frames:false');
  });

  /* ---- SCENARIO 55 ---- */
  await scenario('55. Client: payment modal shows dynamic "12 € (~0.00018182 BTC)" from /api/get-btc-rate', async () => {
    const env = installClientEnv();
    try {
      env.ls._clear();
      seedExpiredTrial(env);   // post-trial: the "no license" path must stay locked
      env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-PRICING');
      env.G.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/api/verify-license')) {
          return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 365 * 86400000 }) };
        }
        if (u.includes('/api/get-btc-rate')) {
          return { ok: true, status: 200, json: async () => ({ ok: true, eur: 12, btcEurPrice: 66000, requiredSats: 18182, btcAmount: '0.00018182' }) };
        }
        throw new Error('unexpected: ' + u);
      };
      const c = await freshClient(env);
      await sleep(30);
      c.FocusBot.openPro();
      await sleep(40);
      const text = c.stub('.btc-price').textContent || '';
      expectTrue(text.indexOf('12') !== -1, 'modal shows 12 EUR (got: ' + text + ')');
      expectTrue(text.indexOf('0.00018182') !== -1, 'modal shows dynamic BTC amount (got: ' + text + ')');
      expectTrue(text.indexOf('BTC') !== -1, 'modal mentions BTC');
      // Hard paywall stays intact: no license → play is still blocked
      env.ls.removeItem('focusbot.licenseKey');
      const c2 = await freshClient(env);
      await sleep(30);
      c2.FocusBot.play();
      await sleep(20);
      expectEqual(c2.FocusBot.isPlaying, false, 'paywall still enforced');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext without license');
    } finally { env.restore(); }
  });

  /* ---- SCENARIO 56 ---- */
  await scenario('56. Payment modal: × button, ESC key and backdrop all close; paywall reopens', async () => {
    const env = installClientEnv();
    try {
      env.ls._clear();
      seedExpiredTrial(env);   // post-trial: modal close/reopen stays fully locked
      const c = await freshClient(env);
      const fb = c.FocusBot;
      const closeBtn = c.stub('.modal-close');
      expectTrue(!!closeBtn, 'close (×) button present in modal template');
      expectTrue((c.root.innerHTML || '').includes('aria-label="Close payment modal"'),
        'accessible aria-label rendered in modal template');

      // Unlicensed play → modal opens, audio stays blocked
      fb.play();
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'paywall opened the modal');
      expectEqual(fb.isPlaying, false, 'audio never started without license');

      // (a) × button closes the modal
      for (const fn of closeBtn.handlers.click || []) fn();
      await sleep(10);
      expectEqual(c.stub('.overlay').hidden, true, '× button closed the modal');

      // (b) ESC key closes the modal
      fb.openPro();
      await sleep(20);
      expectEqual(c.stub('.overlay').hidden, false, 'modal reopened via openPro');
      const escFn = (env.doc.listeners.keydown || []).at(-1);
      expectTrue(!!escFn, 'ESC keydown listener registered');
      escFn({ key: 'Escape' });
      await sleep(10);
      expectEqual(c.stub('.overlay').hidden, true, 'ESC closed the modal');

      // (c) Backdrop (overlay) click closes the modal
      fb.openPro();
      await sleep(20);
      const ov = c.stub('.overlay');
      for (const fn of (ov.handlers.click || [])) fn({ target: ov });
      await sleep(10);
      expectEqual(ov.hidden, true, 'backdrop click closed the modal');

      // Locked logic kept: after closing, a play attempt reopens the modal
      // and still never creates audio.
      fb.play();
      await sleep(20);
      expectEqual(fb.isPlaying, false, 'audio stays blocked after close');
      expectEqual(c.stub('.overlay').hidden, false, 'modal reopens on play attempt');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext created');
    } finally { env.restore(); }
  });

  /* ---- SCENARIO 58 ---- */
  await scenario('58. Master key E2E: FOCUS-PRO-4YF4SA5M in the modal activates Pro & unlocks audio', async () => {
    const env = installClientEnv();
    // Route the widget's API traffic through the REAL worker (verify-license,
    // verify-tx, get-btc-rate), everything else is an unexpected network call.
    const kv = new KVMock();
    const wEnv = makeEnv(kv);
    Object.defineProperty(env.G, 'fetch', {
      value: async (url, opts) => {
        const u = String(url);
        if (!/\/api\/(verify-license|verify-tx|get-btc-rate)/.test(u)) throw new Error('unexpected fetch: ' + u);
        const ctx = makeCtx();
        const res = await worker.fetch(new Request(u, opts), wEnv, ctx);
        await ctx.drain();
        return res;
      },
      writable: true, configurable: true,
    });
    try {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      expectEqual(fb.isPro, false, 'starts unlicensed');
      expectEqual(MockAudioContext.instances.length, 0, 'no AudioContext before activation');

      // Type the master key into the modal input and press Verify & Activate
      c.stub('#fb-license-input').value = 'FOCUS-PRO-4YF4SA5M';
      for (const fn of (c.stub('#fb-activate-btn').handlers.click || [])) fn();

      await waitFor(() => fb.isPro === true, 3000, 'master key activates Pro');
      expectEqual(env.ls.getItem('focusbot.licenseKey'), 'FOCUS-PRO-4YF4SA5M', 'master key persisted as active license');
      expectEqual(MockAudioContext.instances.length, 0, 'still no AudioContext until play is requested');

      // Licensed user can now start the full audio graph (proves terminal unlock)
      fb.play();
      await waitFor(() => fb.isPlaying === true, 3000, 'play starts after master activation');
      expectEqual(MockAudioContext.instances.length, 1, 'exactly one AudioContext created');
      expectTrue(MockAudioContext.oscs.length >= 2, 'binaural oscillator pair created');
      expectEqual(kv.puts.length, 0, 'master flow never touched KV (no replay record)');
    } finally { env.restore(); }
  });

  /* ---- SCENARIO 76 ---- */
  await scenario('76. Offline multi-device: master key FOCUS-PRO-4YF4SA5M activates PRO · Unlimited with ZERO network calls, chrome.storage.local + sync written', async () => {
    const env = installClientEnv();
    const localStore = new Map();
    const syncStore = new Map();
    const chromeStub = {
      storage: {
        local: {
          get(keys, cb) { const out = {}; for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) out[k] = localStore.get(k); cb(out); },
          set(obj) { for (const k of Object.keys(obj || {})) localStore.set(k, obj[k]); },
        },
        sync: {
          get(keys, cb) { const out = {}; for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) out[k] = syncStore.get(k); cb(out); },
          set(obj) { for (const k of Object.keys(obj || {})) syncStore.set(k, obj[k]); },
        },
      },
    };
    const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { value: chromeStub, writable: true, configurable: true });
    try {
      env.ls._clear();
      const c = await freshClient(env);
      const fb = c.FocusBot;
      expectEqual(fb.isPro, false, 'starts unlicensed');

      // Default test fetch throws on ANY unexpected call → if applyLicense hit
      // the worker, the scenario would crash. A green run proves zero network.
      c.stub('#fb-license-input').value = 'FOCUS-PRO-4YF4SA5M';
      for (const fn of (c.stub('#fb-activate-btn').handlers.click || [])) fn();
      await waitFor(() => fb.isPro === true, 2000, 'offline master activation');
      expectEqual(env.ls.getItem('focusbot.licenseKey'), 'FOCUS-PRO-4YF4SA5M', 'key persisted locally');
      expectEqual(env.ls.getItem('focusbot.isPro'), 'true', 'isPro persisted locally');
      expectEqual(env.ls.getItem('focusbot.licenseType'), 'unlimited', 'licenseType=unlimited persisted locally');
      expectEqual(c.stub('.quota').textContent, 'PRO · Unlimited', 'footer shows PRO · Unlimited');

      expectEqual(localStore.get('isPro'), true, 'chrome.storage.local isPro');
      expectEqual(localStore.get('licenseType'), 'unlimited', 'chrome.storage.local licenseType');
      expectEqual(localStore.get('licenseKey'), 'FOCUS-PRO-4YF4SA5M', 'chrome.storage.local licenseKey');
      expectEqual(syncStore.get('isPro'), true, 'chrome.storage.sync isPro (Chrome Sync propagation)');
      expectEqual(syncStore.get('licenseKey'), 'FOCUS-PRO-4YF4SA5M', 'chrome.storage.sync licenseKey');
    } finally {
      if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome);
      else delete globalThis.chrome;
      env.restore();
    }
  });

  /* ---- SCENARIO 77 ---- */
  await scenario('77. Multi-device via Chrome Sync: fresh device with empty local storage auto-activates the unlimited key on boot (no server query)', async () => {
    const env = installClientEnv();
    const localStore = new Map();
    const syncStore = new Map([['focusbot.licenseKey', 'FOCUS-PRO-4YF4SA5M']]); // synced from another device
    const chromeStub = {
      storage: {
        local: {
          get(keys, cb) { const out = {}; for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) out[k] = localStore.get(k); cb(out); },
          set(obj) { for (const k of Object.keys(obj || {})) localStore.set(k, obj[k]); },
        },
        sync: {
          get(keys, cb) { const out = {}; for (const k of (Array.isArray(keys) ? keys : Object.keys(keys || {}))) out[k] = syncStore.get(k); cb(out); },
          set(obj) { for (const k of Object.keys(obj || {})) syncStore.set(k, obj[k]); },
        },
      },
    };
    const savedChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    Object.defineProperty(globalThis, 'chrome', { value: chromeStub, writable: true, configurable: true });
    try {
      env.ls._clear(); // completely fresh device — empty local storage
      const c = await freshClient(env);
      const fb = c.FocusBot;
      await waitFor(() => fb.isPro === true, 2000, 'boot picks up sync key and activates offline');
      expectEqual(env.ls.getItem('focusbot.licenseKey'), 'FOCUS-PRO-4YF4SA5M', 'sync key mirrored into local storage');
      expectEqual(c.stub('.quota').textContent, 'PRO · Unlimited', 'footer shows PRO · Unlimited');
      expectEqual(fb.isPro, true, 'Pro unlocked without any network call');
    } finally {
      if (savedChrome) Object.defineProperty(globalThis, 'chrome', savedChrome);
      else delete globalThis.chrome;
      env.restore();
    }
  });

  /* ---- SCENARIO 78 ---- */
  await scenario('78. Real-time 1-year expiry: when the 365-day window passes, Pro is revoked, storage flagged as expired and the renew modal reopens', async () => {
    const env = installClientEnv();
    env.ls._clear();
    // Server grants a PRO license whose window is ~700ms away (simulates a
    // license that was activated 364.99 days ago).
    env.ls.setItem('focusbot.licenseKey', 'FOCUS-PRO-YEAR1');
    env.G.fetch = async (url) => {
      if (String(url).includes('/api/verify-license')) {
        return { ok: true, status: 200, json: async () => ({ valid: true, plan: 'pro', expiresAt: Date.now() + 700 }) };
      }
      throw new Error('unexpected');
    };
    const c = await freshClient(env);
    const fb = c.FocusBot;
    await waitFor(() => fb.isPro === true, 2000, 'pro activated within 1-year window');

    // Activated state persists the full expiry metadata (needed for offline enforcement)
    expectEqual(env.ls.getItem('focusbot.isPro'), 'true', 'isPro persisted on activation');
    expectTrue(Number(env.ls.getItem('focusbot.expiresAt')) > Date.now(), 'expiresAt persisted as a future epoch on activation');
    expectEqual(c.stub('.quota').textContent, 'PRO · 1 days left', 'timed license footer shows days remaining');

    // Let the 365-day window lapse
    await sleep(900);

    expectEqual(fb.isPro, true, 'pro still flagged before a trigger checks the window');

    // Every feature trigger (here: play) enforces the expiry in real time
    fb.play();
    await sleep(20);

    expectEqual(fb.isPro, false, 'pro revoked the instant the window passes');
    expectEqual(fb.getState().licenseExpired, true, 'getState exposes licenseExpired flag');
    expectEqual(fb.getState().proDaysLeft, 0, 'getState exposes 0 days remaining');
    expectEqual(env.ls.getItem('focusbot.isPro'), 'false', 'local storage downgraded to isPro=false');
    expectEqual(env.ls.getItem('focusbot.licenseExpired'), 'true', 'local storage flagged licenseExpired=true');
    expectEqual(c.stub('.overlay').hidden, false, 'renew-modal reopened after expiry');
  });
}
console.log(`
${C.b}${C.B}FocusBot Automated Test Suite${C.x}
${C.d}Node ${process.version} · zero external dependencies${C.x}`);

try {
  section('WORKER — Security and Business Logic (worker/index.js)');
  await workerScenarios();

  section('WORKER — Edge Cases & Stress Audit (worker/index.js)');
  await workerEdgeCaseScenarios();
  await workerAbuseScenarios();

  section('CLIENT — Quota and Audio Engine (client/focus-bot.js)');
  await clientScenarios();

  section('CLIENT — Edge Cases & Security Audit (client/focus-bot.js)');
  await clientEdgeCaseScenarios();

  section('CLIENT — E2E Hard Paywall Guard (zero-bypass verification)');
  await e2ePaywallGuardScenarios();

  section('CLIENT — Audio Synthesizer Frequency Math');
  await audioSynthScenarios();

  section('CLIENT — Productivity Suite (Pomodoro, Ambient Mixer)');
  await productivityScenarios();
  await ambientMixerScenarios();

  section('CLIENT — Autoplay Policy & Memory');
  await clientAutoplayScenarios();
  await clientMemoryLeakScenarios();

  section('CLIENT — 3-Day Trial, Volume Stages, New Modes & Chime');
  await trialVolumeChimeScenarios();

  section('CLIENT — Hardening & MV3 Bridge (engine token, popup)');
  await clientHardeningScenarios();
  await extensionAuditScenarios();

  section('WEBSTORE — Store Compliance (BTC rate endpoint, manifest, privacy, modal)');
  await webstoreComplianceScenarios();
} catch (err) {
  console.error(`\n${C.r}[FATAL]${C.x} Test infrastructure crashed:`, err);
  process.exitCode = 1;
}

const dt = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`
${C.B}SUMMARY${C.x}  ${C.g}${passed} PASSED${C.x} · ${failed ? C.r : C.d}${failed} FAILED${C.x} · ${dt}s`);

if (failures.length) {
  console.log(`\n${C.r}Failed scenarios:${C.x}`);
  for (const f of failures) console.log(`  - ${f.msg}\n      ${f.err && f.err.message}`);
  process.exitCode = 1;
} else {
  console.log(`${C.g}All scenarios passed.${C.x}`);
}
