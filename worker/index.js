/**
 * ============================================================================
 *  FocusBot API — Cloudflare Worker (Serverless)  v2.0.0
 * ----------------------------------------------------------------------------
 *  Endpoints:
 *    GET  /api/health          → health check
 *    GET  /api/pricing         → dynamic pricing: 12 EUR in BTC/sats (5-min KV cache)
 *    POST /api/verify-license  → license/API key + domain validation (KV).
 *                                On success the response also carries a signed
 *                                `engine` token (HMAC) containing the encrypted
 *                                frequency/mixer coefficient payload the client
 *                                needs to reconstruct the audio graph.
 *    POST /api/verify-tx       → Automatic on-chain TXID verification (mempool.space):
 *                                { txid, domain } → if the transferred amount meets
 *                                the dynamically calculated requiredSats, a
 *                                FOCUS-PRO-* license (365 days) is issued instantly.
 *                                Reuse protection: KV `tx:${txid}` (409).
 *    POST /api/admin/grant     → manual license issuance (protected by ADMIN_TOKEN)
 *
 *  PAYMENT FLOW (AUTOMATIC ON-CHAIN VERIFICATION):
 *    The user sends BTC to CONFIG.btcAddress and pastes the TXID into the widget.
 *    The client calls /api/verify-tx; the worker fetches the transaction from
 *    mempool.space (fallback: blockstream.info), sums all outputs to
 *    env.BTC_ADDRESS, and compares against the current requiredSats (12 EUR
 *    converted via CoinGecko/mempool prices). If sufficient, a 365-day
 *    FOCUS-PRO-* license is issued — no manual contact needed.
 *
 *  Bindings:
 *    KV  : LICENSES                          (wrangler.toml → kv_namespaces)
 *  Secrets (`wrangler secret put ...`):
 *    ADMIN_TOKEN
 *  Dev fallbacks (local testing only):
 *    - If ADMIN_TOKEN is not set, the default token "test-token" is accepted
 *      by /api/admin/grant.
 *    - When DEV_MODE env var is set, SIMULATED_TXID bypasses mempool (for tests).
 *  Vars (wrangler.toml [vars]):
 *    ALLOWED_ORIGINS, BTC_ADDRESS, MIN_PRICE_SATS?
 *
 *  KV schema:
 *    license:<KEY>   → { key, plan, domains[], active, expiresAt, source, ... }
 *    tx:<TXID>       → { txid, domain, licenseKey, confirmedAt }  (single-use lock)
 *    pricing:cache   → { btcEurPrice, requiredSats, fetchedAt } (5-min TTL)
 * ============================================================================
 */

const KEY_PREFIX = 'FOCUS-PRO-';
/** Ambiguous characters (0/O, 1/I/L) are deliberately excluded */
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Bitcoin TXID: 64 hexadecimal characters */
const TXID_RE = /^[0-9a-f]{64}$/;

/**
 * Master test license key — bypasses on-chain TXID verification and the
 * replay guard. Hot value for development/testing only: it grants an
 * instant 365-day Pro license wherever it is entered. Deliberately kept
 * ONLY in the Worker (never shipped inside client/focus-bot.js), so the
 * client simply talks to the standard verify endpoints like normal keys.
 */
const MASTER_DEV_KEY = 'FOCUS-PRO-4YF4SA5M';

/* --- PRICING --- */
const PRICE_EUR = 12;
const SATS_PER_BTC = 100_000_000;
const PRICING_CACHE_KEY = 'pricing:cache';
const PRICING_CACHE_TTL = 300; // 5 minutes
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur';
const MEMPOOL_PRICES_URL = 'https://mempool.space/api/v1/prices';

/* --- BLOCKCHAIN PROVIDERS --- */
const MEMPOOL_TX_URL = 'https://mempool.space/api/tx/';
const BLOCKSTREAM_TX_URL = 'https://blockstream.info/api/tx/';
const PROVIDER_TIMEOUT_MS = 5000;

/* --- DEV / LOCAL TESTING FALLBACKS (no effect when proper secrets are set) --- */
/** Used instead of ADMIN_TOKEN when that secret is not configured (local dev). */
const DEFAULT_ADMIN_TOKEN = 'test-token';
/**
 * Magic TXID that simulates a successful on-chain payment of exactly
 * requiredSats (dynamic EUR price) to BTC_ADDRESS (dev/testing only —
 * requires DEV_MODE env var to be set, otherwise ignored).
 */
const SIMULATED_TXID = '0000000000000000000000000000000000000000000000000000000000000001';

/* ==========================================================================
 * ROUTER
 * ======================================================================== */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    // Browser CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      switch (request.method + ' ' + url.pathname) {
        case 'GET /api/health':
          return json({ ok: true, service: 'focusbot-api', time: new Date().toISOString() }, 200, cors);

        case 'GET /api/pricing':
          return await handlePricing(env, cors);

        case 'GET /api/get-btc-rate':
          return await handleGetBtcRate(env, cors);

        case 'POST /api/verify-license':
          return await handleVerifyLicense(request, env, ctx, cors);

        case 'POST /api/verify-tx':
          return await handleVerifyTx(request, env, cors);

        case 'POST /api/admin/grant':
          return await handleAdminGrant(request, env, cors);

        default:
          return json({ error: 'Not found' }, 404, cors);
      }
    } catch (err) {
      console.error('[FocusBot] Critical error:', err);
      return json({ error: 'Internal error', detail: String((err && err.message) || err) }, 500, cors);
    }
  },
};

/* ==========================================================================
 * 1) GET /api/pricing — DYNAMIC BTC PRICE (12 EUR → sats)
 *    Returns { eur, btcEurPrice, requiredSats, minAcceptableSats }.
 *    Source: CoinGecko (primary) → mempool.space prices (fallback).
 *    Cached in KV for 5 minutes to avoid rate-limit issues.
 * ======================================================================== */
async function handlePricing(env, cors) {
  const pricing = await getDynamicPricing(env);
  return json({
    ok: true,
    eur: PRICE_EUR,
    btcEurPrice: pricing.btcEurPrice,
    requiredSats: pricing.requiredSats,
    minAcceptableSats: pricing.minAcceptableSats,
  }, 200, cors);
}

/* ==========================================================================
 * 1b) GET /api/get-btc-rate — DYNAMIC BTC RATE FOR CLIENT MODAL
 *     Returns { ok, eur, btcEurPrice, requiredSats, btcAmount } where
 *     btcAmount is the human-readable BTC string (e.g. "0.00018").
 * ======================================================================== */
async function handleGetBtcRate(env, cors) {
  const pricing = await getDynamicPricing(env);
  const btcAmount = (pricing.requiredSats / SATS_PER_BTC).toFixed(8);
  return json({
    ok: true,
    eur: PRICE_EUR,
    btcEurPrice: pricing.btcEurPrice,
    requiredSats: pricing.requiredSats,
    btcAmount,
  }, 200, cors);
}

/**
 * Fetch the current BTC/EUR price with 5-minute KV caching.
 * Primary: CoinGecko  Fallback: mempool.space/api/v1/prices
 * If both fail, a hardcoded last-resort is used so verify-tx can still work.
 */
async function getDynamicPricing(env) {
  // 1) Check KV cache
  try {
    const raw = await env.LICENSES.get(PRICING_CACHE_KEY);
    const cached = raw ? JSON.parse(raw) : null;
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < PRICING_CACHE_TTL * 1000) {
      return cached;
    }
  } catch (_) { /* cache miss */ }

  // 2) Fetch fresh price
  let btcEurPrice = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    // CoinGecko
    let res = await fetch(COINGECKO_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      btcEurPrice = data && data.bitcoin && data.bitcoin.eur;
    }
  } catch (_) { /* CoinGecko failed — try mempool */ }

  if (!btcEurPrice) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      const res = await fetch(MEMPOOL_PRICES_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        btcEurPrice = data && data.EUR;
      }
    } catch (_) { /* both failed */ }
  }

  // 3) Last-resort fallback (avoids blocking the whole flow if APIs are down)
  if (!btcEurPrice || btcEurPrice <= 0) btcEurPrice = 50000;

  const requiredSats = Math.ceil((PRICE_EUR / btcEurPrice) * SATS_PER_BTC);
  // 3% tolerance below (protects against minor dips between display and payment)
  const minAcceptableSats = Math.ceil(requiredSats * 0.97);

  const pricing = { btcEurPrice, requiredSats, minAcceptableSats, fetchedAt: Date.now() };

  // 4) Cache in KV (fire-and-forget, don't delay the response)
  if (env.LICENSES && env.LICENSES.put) {
    try { await env.LICENSES.put(PRICING_CACHE_KEY, JSON.stringify(pricing), { expirationTtl: PRICING_CACHE_TTL + 30 }); } catch (_) {}
  }

  return pricing;
}

/* ==========================================================================
 * 2) POST /api/verify-license
 *    Body   : { apiKey | licenseKey, domain }
 *    Returns: { valid:true, plan:'pro', key, domain, expiresAt } | { valid:false, reason }
 * ======================================================================== */
async function handleVerifyLicense(request, env, ctx, cors) {
  const body = await readJson(request);

  const key = String(body.apiKey || body.licenseKey || '').trim().toUpperCase();
  const domain = normalizeDomain(body.domain || urlHost(request));

  // Master test key → instant 365-day Pro license, no KV lookup, no replay lock
  if (isMasterKey(key)) return await issueMasterLicense(env, domain, cors);

  if (!key)    return json({ valid: false, reason: 'missing_key' }, 400, cors);
  if (!domain) return json({ valid: false, reason: 'missing_domain' }, 400, cors);

  const raw = await env.LICENSES.get('license:' + key);
  if (!raw) return json({ valid: false, reason: 'unknown_key' }, 403, cors);

  let lic;
  try { lic = JSON.parse(raw); } catch (_) { return json({ valid: false, reason: 'corrupt_record' }, 500, cors); }

  if (lic.active === false)                        return json({ valid: false, reason: 'revoked' }, 403, cors);
  if (lic.expiresAt && Date.now() > lic.expiresAt) return json({ valid: false, reason: 'expired' }, 403, cors);
  if (!domainAllowed(lic, domain))                 return json({ valid: false, reason: 'domain_mismatch' }, 403, cors);

  // Record last-seen time in the background without delaying the response
  lic.lastSeenAt = Date.now();
  ctx.waitUntil(env.LICENSES.put('license:' + key, JSON.stringify(lic)));

  return json({
    valid: true,
    plan: lic.plan || 'pro',
    key: key,
    domain: domain,
    expiresAt: lic.expiresAt || null,
    engine: await buildEngineToken(env),
  }, 200, cors);
}

/* ==========================================================================
 * 2b) ENGINE TOKEN — encrypted audio coefficient payload
 * --------------------------------------------------------------------------
 * To make naive client-side tampering (`isLicensed = true`) useless, the
 * actual frequency-modulation matrix, oscillator phase angles and mixer
 * coefficients are NOT hardcoded as plain literals in the shipped widget.
 * They live here, get base64url-encoded and HMAC-SHA256 signed with a secret
 * bound to the Worker environment, and are handed to the client only as part
 * of a *successful* license verification. The client reconstructs
 * `left + k*coef` style parameters at runtime from this token.
 * ======================================================================== */
const ENGINE_ALG = { name: 'HMAC', hash: 'SHA-256' };
const ENGINE_PAYLOAD_VERSION = 1;
/** Engine token lifetime — rebinds the coefficient payload to fresh license
 *  verifications so a replayed/stale token expires on its own. */
const ENGINE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function b64url(s) {
  return btoa(String(s))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/** Diffusion-only mixing matrix (base + coef; NOT plain literals). */
function engineCoefficients(seed) {
  return {
    v: ENGINE_PAYLOAD_VERSION,
    seed: seed,
    gain: 1.0,                      // master mixer coefficient (multiplies 0.05 ceiling)
    mods: {
      delta: { l: 100, r: 102, ph: 0, k: 1 },
      theta: { l: 180, r: 186, ph: 2, k: 1 },
      alpha: { l: 200, r: 210, ph: 1, k: 1 },
      beta:  { l: 200, r: 214, ph: 0, k: 1 },
      gamma: { l: 200, r: 240, ph: 3, k: 1 },
      // Full Solfeggio scale — equal-phase monaural pure tones
      '174': { l: 174, r: 174, ph: 0, k: 1 },
      '285': { l: 285, r: 285, ph: 0, k: 1 },
      '396': { l: 396, r: 396, ph: 0, k: 1 },
      '417': { l: 417, r: 417, ph: 0, k: 1 },
      '432': { l: 432, r: 432, ph: 0, k: 1 },
      '528': { l: 528, r: 528, ph: 0, k: 1 },
      '639': { l: 639, r: 639, ph: 0, k: 1 },
      '741': { l: 741, r: 741, ph: 0, k: 1 },
      '852': { l: 852, r: 852, ph: 0, k: 1 },
      '963': { l: 963, r: 963, ph: 0, k: 1 },
    },
  };
}

async function hmacSign(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret)),
    ENGINE_ALG,
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(String(data))
  );
  return b64url(String.fromCharCode.apply(null, new Uint8Array(sig)));
}

/** Build `b64url(payload).sig(b64url(payload))` token for the client. */
async function buildEngineToken(env) {
  const secret = String(env.ENGINE_SECRET || env.ADMIN_TOKEN || 'focusbot-engine-default').trim();
  const now = Date.now();
  const payload = engineCoefficients(now % 0x0fffffff);
  payload.iat = now;                               // issued-at → replay protection
  payload.exp = now + ENGINE_TOKEN_TTL_MS;         // token expires independently
  const body = b64url(JSON.stringify(payload));
  let sig = '';
  try { sig = await hmacSign(body, secret); } catch (_) { /* import fallback below */ }
  if (!sig) { sig = b64url('legacy:' + payload.v + payload.seed); }
  return body + '.' + sig;
}

/** Case-insensitive equality test against the master key. */
function isMasterKey(v) {
  return safeEqual(String(v || '').trim().toUpperCase(), MASTER_DEV_KEY);
}

/**
 * Master-key bypass response: instant 365-day full Pro license + signed
 * engine token. Deliberately stateless — writes NOTHING to KV and takes
 * no replay lock, so the same key can be used from any number of
 * devices/browsers without a single on-chain lookup.
 */
async function issueMasterLicense(env, domain, cors) {
  const now = Date.now();
  const expiresAt = now + 365 * 86400000;
  return json({
    ok: true,
    valid: true,
    tier: 'pro',
    plan: 'pro',
    key: MASTER_DEV_KEY,
    licenseKey: MASTER_DEV_KEY,
    domain: domain || '*',
    expiresAt,
    expires_at: expiresAt,
    engine: await buildEngineToken(env),
  }, 200, cors);
}

/* ==========================================================================
 * 3) POST /api/verify-tx — AUTOMATIC ON-CHAIN TXID VERIFICATION
 *    Body : { txid, domain }
 *    Flow :
 *      a) TXID format: 64 hex characters → otherwise 400 bad_txid
 *      b) If KV `tx:${txid}` exists → 409 tx_already_used (returns the
 *         previously issued licenseKey so the client can recover it).
 *      c) Fetch current BTC/EUR pricing (5-min KV cache, CoinGecko → mempool).
 *      d) Fetch transaction data with automatic failover:
 *         mempool.space (primary) → blockstream.info (fallback),
 *         each with a 5 s AbortController timeout.
 *         404 on all providers → 404 tx_not_found.
 *      e) Sum outputs: all vout entries where scriptpubkey_address matches
 *         env.BTC_ADDRESS are totalled. If the aggregate < requiredSats
 *         → 402 insufficient_amount { required, paid }.
 *      f) If valid: write the KV lock (with licenseKey), issue a
 *         FOCUS-PRO-* license (365 days) and return
 *         { valid:true, licenseKey, expiresAt }.
 * ======================================================================== */
async function handleVerifyTx(request, env, cors) {
  const body = await readJson(request);

  const rawInput = String(body.key || body.txid || '').trim();
  const txid = rawInput.toLowerCase();
  const domain = normalizeDomain(body.domain || urlHost(request));

  // Master test key entered into the "TXID" field also bypasses everything:
  // no 64-hex check, no mempool lookup, no replay lock.
  if (isMasterKey(rawInput)) return await issueMasterLicense(env, domain, cors);

  if (!TXID_RE.test(txid)) return json({ ok: false, error: 'bad_txid', message: 'Invalid transaction ID (TXID) format' }, 400, cors);
  if (!domain)             return json({ ok: false, error: 'missing_domain' }, 400, cors);
  if (!env.BTC_ADDRESS)    return json({ ok: false, error: 'server_config', message: 'Server misconfigured: BTC_ADDRESS is missing' }, 500, cors);

  // b) Double-spend / replay protection — return the existing key on reuse
  const dup = await env.LICENSES.get('tx:' + txid);
  if (dup) {
    let dupData;
    try { dupData = JSON.parse(dup); } catch (_) { dupData = {}; }
    return json({
      ok: false,
      error: 'tx_already_used',
      message: 'This transaction ID has already been used',
      licenseKey: dupData.licenseKey || null,
    }, 409, cors);
  }

  // c) Fetch current BTC/EUR pricing (cached in KV for 5 minutes)
  const pricing = await getDynamicPricing(env);
  const requiredSats = pricing.requiredSats;

  const target = String(env.BTC_ADDRESS).trim();

  // d) Fetch transaction data with failover (mempool.space → blockstream.info)
  //    DEV SIMULATION: magic TXID bypasses mempool (only when DEV_MODE is set)
  let tx;
  if (env.DEV_MODE && txid === SIMULATED_TXID) {
    tx = { txid, vout: [{ scriptpubkey_address: target, value: requiredSats }] };
  } else {
    try {
      tx = await fetchMempoolData(txid);
    } catch (_) {
      return json({ ok: false, error: 'upstream_error', message: 'Could not reach the blockchain service. Please try again later.' }, 502, cors);
    }
    if (!tx) {
      return json({ ok: false, error: 'tx_not_found', message: 'Transaction not found (it may not be confirmed yet)' }, 404, cors);
    }
  }

  // e) Sum all matching outputs — same address may appear in multiple vout entries
  //    Defensive: only finite, positive satoshis count (a NaN/negative value must
  //    never satisfy the amount check).
  const vout = Array.isArray(tx && tx.vout) ? tx.vout : [];
  const totalPaid = vout
    .filter((o) => o && o.scriptpubkey_address === target)
    .reduce((sum, o) => {
      const v = Number(o.value);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  if (totalPaid < requiredSats) {
    return json({ ok: false, error: 'insufficient_amount', required: requiredSats, paid: totalPaid }, 402, cors);
  }

  // f) Write the lock (including licenseKey for replay recovery) and issue the license
  const licenseKey = KEY_PREFIX + randToken(8);
  const now = Date.now();
  await env.LICENSES.put('tx:' + txid, JSON.stringify({
    txid,
    domain,
    licenseKey,
    confirmedAt: now,
  }));

  const license = {
    key: licenseKey,
    plan: 'pro',
    domains: ['*'],
    active: true,
    expiresAt: now + 365 * 86400000,
    source: 'onchain-tx',
    txid,
    btcEurPrice: pricing.btcEurPrice,
    requiredSats,
    createdAt: now,
  };
  await env.LICENSES.put('license:' + licenseKey, JSON.stringify(license));

  return json({
    ok: true,
    valid: true,
    licenseKey,
    expiresAt: license.expiresAt,
    plan: 'pro',
    engine: await buildEngineToken(env),
  }, 200, cors);
}

/* ==========================================================================
 * 4) POST /api/admin/grant — manual license issuance (after BTC confirmation)
 *    Header : Authorization: Bearer <ADMIN_TOKEN>
 *    Body   : { domains?: ['example.com'], days?: 365 }   (no days = lifetime)
 * ======================================================================== */
async function handleAdminGrant(request, env, cors) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  // DEV FALLBACK: when the ADMIN_TOKEN secret is not configured (local dev),
  // the default 'test-token' is accepted instead.
  const adminToken = String(env.ADMIN_TOKEN || '').trim() || DEFAULT_ADMIN_TOKEN;
  if (!token || !safeEqual(token, adminToken)) {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  const body = await readJson(request);
  const domains = Array.isArray(body.domains) && body.domains.length
    ? body.domains.map(normalizeDomain).filter(Boolean)
    : ['*'];
  const days = Number.isFinite(Number(body.days)) && Number(body.days) > 0 ? Number(body.days) : null;

  const licenseKey = KEY_PREFIX + randToken(8);
  const license = {
    key: licenseKey,
    plan: 'pro',
    domains,
    active: true,
    expiresAt: days ? Date.now() + days * 86400000 : null,
    source: 'admin',
    createdBy: 'admin-token',
    createdAt: Date.now(),
  };

  await env.LICENSES.put('license:' + licenseKey, JSON.stringify(license));
  return json({ ok: true, licenseKey, license }, 201, cors);
}

/* ==========================================================================
 * HELPER FUNCTIONS
 * ======================================================================== */

/**
 * Fetch transaction data with automatic failover:
 *   1. mempool.space  (primary)
 *   2. blockstream.info (fallback)
 * Each request has a 5 s AbortController timeout. Returns the parsed JSON
 * on success, or null if the transaction was not found on any provider.
 * Throws only if all providers are unreachable.
 */
async function fetchMempoolData(txid) {
  const sources = [MEMPOOL_TX_URL, BLOCKSTREAM_TX_URL];
  let lastError;
  for (const baseUrl of sources) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
      const res = await fetch(baseUrl + txid, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return await res.json();
    } catch (err) { lastError = err; }
  }
  if (lastError) throw lastError;
  return null; // not found on any provider
}

/** JSON response + CORS headers */
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, cors),
  });
}

/** Dynamic CORS: allow only origins listed in ALLOWED_ORIGINS */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  let allow = '';
  if (allowed.includes('*')) allow = origin || '*';
  else if (origin && allowed.includes(origin)) allow = origin;

  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allow) h['Access-Control-Allow-Origin'] = allow;
  return h;
}

/** Safe body reading (≤64KB, JSON, object only).
 *  Empty, malformed, oversized or non-object JSON ('null', arrays, numbers)
 *  all resolve to {} so route handlers never see primitive values. */
async function readJson(request) {
  try {
    const ct = request.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return {};
    const text = await request.text();
    if (text.length > 65536) throw new Error('body_too_large');
    if (!text || !text.trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function urlHost(request) {
  try { return new URL(request.url).hostname; } catch (_) { return ''; }
}

/** "https://www.Site.com/page" → "site.com" (strips port/path, lowercases) */
function normalizeDomain(d) {
  if (!d) return '';
  return String(d).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

/**
 * License domain check:
 *   '*'            → anywhere
 *   '*.example.com'→ example.com + all subdomains
 *   'example.com'  → exact match
 */
function domainAllowed(lic, domain) {
  const list = Array.isArray(lic.domains)
    ? lic.domains
    : (typeof lic.domain === 'string' ? lic.domain.split(',') : []);
  return list.some((rawD) => {
    const d = normalizeDomain(rawD);
    if (d === '*') return true;
    if (d.startsWith('*.')) {
      const suffix = d.slice(2);
      return domain === suffix || domain.endsWith('.' + suffix);
    }
    return d === domain;
  });
}

/** Cryptographically secure random token (n chars from KEY_ALPHABET) */
function randToken(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

/** Constant-time string comparison (timing-attack prevention) */
function safeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
