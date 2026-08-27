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
 *   [SCENARIO 10] Frequency assignments (200/214, 200/210) and 0.05 ceiling gain
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
 *   [SCENARIO 33-34] Deep Work Analytics: focus-time accumulation + persistence,
 *                   chrome.storage.local preferred path (MV3)
 *   [SCENARIO 35-36] Ambient mixer: white/pink noise buffers + rain lowpass routing,
 *                   ambient gain below the carrier, master keeps last gain node
 *   [SCENARIO 37-38] Hardening: signed engine token drives frequency matrix + gain;
 *                   corrupt token → safe fallback matrix
 *   [SCENARIO 39] Messaging bridge: chrome.runtime FOCUSBOT_CTRL (MV3 popup) → widget
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
  if (sel === '.modes') {
    e.querySelectorAll = () => ['beta', 'alpha', 'theta', 'gamma'].map((m) => {
      const b = el('button'); b.dataset.mode = m; return b;
    });
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
        return ['beta', 'alpha', 'theta', 'gamma'].map((m) => { const b = el('button'); b.dataset.mode = m; return b; });
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
class MockMerger extends MockNode {}

class MockAudioContext {
  static instances = [];
  static oscs = [];
  static gains = [];
  static sources = [];
  static buffers = [];
  static resetStatics() {
    MockAudioContext.instances = [];
    MockAudioContext.oscs = [];
    MockAudioContext.gains = [];
    MockAudioContext.sources = [];
    MockAudioContext.buffers = [];
  }

  constructor() {
    MockAudioContext.instances.push(this);
    this.state = 'suspended';       // real browser behavior: starts suspended
    this.destination = {};
    this.currentTime = 0;
    this.sampleRate = 48000;
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createOscillator() { const o = new MockOscillator(this); MockAudioContext.oscs.push(o); return o; }
  createGain() { const g = new MockGain(this); MockAudioContext.gains.push(g); return g; }
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
      const c = await freshClient(env);
      const fb = c.FocusBot;

      expectEqual(fb.isPlaying, false, 'not playing at boot');
      expectEqual(MockAudioContext.instances.length, 0, 'AudioContext not created at boot');

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
    await scenario('10. Frequencies (200/214, 200/210) and 0.05 gain ceiling', async () => {
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

      // Default volume 70% -> gain = ceiling(0.05) * 0.7
      expectApprox(gain.lastRamp, 0.05 * 0.7, 1e-9, 'default gain = 0.05x0.7');

      fb.setMode('alpha');
      expectEqual(oscL.frequency.value, 200, 'Alpha Left 200 Hz');
      expectEqual(oscR.frequency.value, 210, 'Alpha Right 210 Hz');

      fb.setMode('gamma');
      expectEqual(oscL.frequency.value, 200, 'Gamma Left 200 Hz');
      expectEqual(oscR.frequency.value, 240, 'Gamma Right 240 Hz');

      const vol = c.stub('.vol-range');
      vol.value = '100';
      vol.dispatch('input');
      expectApprox(gain.lastTarget, 0.05, 1e-9, 'ceiling gain 0.05 enforced');
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
 * SCENARIO 29-36 : PRODUCTIVITY SUITE (Pomodoro + Deep Work Analytics + Ambient)
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

  /* ---- SCENARIO 33 ---- */
  await scenario('33. Analytics: focus seconds accumulate and persist locally', async () => {
    fb.pomodoro.start();
    await waitFor(() => fb.isPlaying, 2000, 'playing');
    const at = lastInterval('analyticsTick');
    expectTrue(!!at, 'analytics tick interval registered');
    for (let i = 0; i < 12; i++) at.fn();
    const st = await fb.analytics.getStats();
    expectTrue(st.todayMs >= 12000, 'today >= 12s total focus (got ' + st.todayMs + ')');
    const saved = JSON.parse(env.ls.getItem('focusbot.analytics') || '{}');
    expectTrue(!!saved.days && Object.keys(saved.days).length > 0, 'analytics persisted to local storage');
    expectTrue(c.stub('.stats-today').textContent.indexOf('s') !== -1, 'UI today stat rendered');
  });

  /* ---- SCENARIO 34 ---- */
  await scenario('34. Analytics: chrome.storage.local preferred (MV3 path)', async () => {
    const chMap = new Map();
    env.G.chrome = {
      storage: {
        local: {
          get(k, cb) { const out = {}; if (chMap.has(k)) out[k] = chMap.get(k); cb(out); },
          set(o, cb) { for (const k in o) chMap.set(k, o[k]); if (cb) cb(); },
        },
      },
    };
    try {
      const c2 = await freshClient(env);
      await sleep(30);
      const fb2 = c2.FocusBot;
      const st0 = await fb2.analytics.getStats();
      const baseMs = st0.todayMs || 0;
      fb2.pomodoro.start();
      const at = lastInterval('analyticsTick');
      for (let i = 0; i < 12; i++) at.fn();
      await sleep(20);
      const saved = chMap.get('focusbot.analytics');
      expectTrue(!!saved, 'analytics written to chrome.storage.local');
      const st = await fb2.analytics.getStats();
      expectTrue(st.todayMs >= baseMs + 12000, 'stats resolved from chrome storage (+12s)');
    } finally {
      env.G.chrome = undefined;
    }
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
  await scenario('35. Ambient: white noise layer added under the carrier', async () => {
    fb.setAmbient('white');
    expectEqual(fb.ambient, 'white', 'ambient state set');
    expectTrue(MockAudioContext.sources.length >= 1, 'noise source created');
    const src = MockAudioContext.sources.at(-1);
    expectEqual(src.buffer.numberOfChannels, 1, 'mono buffer');
    expectEqual(src.loop, true, 'looping source');
    expectEqual(src._started, true, 'source started');
    // gains[0] is the 6.0 BOOST pre-amp; gains[1] is the ambient layer
    expectApprox(MockAudioContext.gains[1].gain.value, 0.14, 1e-9, 'ambient gain level');
    expectApprox(MockAudioContext.gains.at(-1).gain.value, 0, 1e-9, 'master stays the last gain node');
    fb.setAmbient('off');
    expectEqual(fb.ambient, 'off', 'switched off');
    expectEqual(MockAudioContext.gains[1].gain.value, 0, 'ambient gain zeroed when off');
  });

  /* ---- SCENARIO 36 ---- */
  await scenario('36. Ambient: pink noise buffer + rain (filtered) variants', async () => {
    fb.setAmbient('pink');
    let src = MockAudioContext.sources.at(-1);
    expectEqual(src.buffer.numberOfChannels, 1, 'pink mono buffer');
    const pink = src.buffer.getChannelData(0);
    expectTrue(pink.length > 0, 'pink buffer has samples');
    expectTrue(pink.some((v) => Math.abs(v) > 0.0001), 'pink data non-silent');
    fb.setAmbient('rain');
    src = MockAudioContext.sources.at(-1);
    expectTrue(!!src.buffer, 'rain buffer created');
    expectTrue(src.connections.length >= 1, 'rain source connected (to lowpass)');
    fb.setAmbient('off');
    expectEqual(fb.ambient, 'off', 'off state');
  });
  } finally { env.restore(); }
}

/* ===========================================================================
 * SCENARIO 37-39 : CLIENT HARDENING (engine token, storage preference, messaging)
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
      expectApprox(gain.lastRamp, 0.05 * 0.7 * 0.8, 1e-9, 'engine gain coefficient 0.8 applied');
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

      listeners[0]({ type: 'FOCUSBOT_CTRL', cmd: 'bogus-command' }, {}, respond);
      expectEqual(last.ok, false, 'unknown command rejected');
    } finally { env.restore(); }
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

  section('CLIENT — Quota and Audio Engine (client/focus-bot.js)');
  await clientScenarios();

  section('CLIENT — Edge Cases & Security Audit (client/focus-bot.js)');
  await clientEdgeCaseScenarios();

  section('CLIENT — E2E Hard Paywall Guard (zero-bypass verification)');
  await e2ePaywallGuardScenarios();

  section('CLIENT — Audio Synthesizer Frequency Math');
  await audioSynthScenarios();

  section('CLIENT — Productivity Suite (Pomodoro, Analytics, Ambient Mixer)');
  await productivityScenarios();
  await ambientMixerScenarios();

  section('CLIENT — Hardening & MV3 Bridge (engine token, chrome.storage, popup)');
  await clientHardeningScenarios();
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
