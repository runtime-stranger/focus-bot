/* Local dev worker server — mounts worker/index.js on an in-memory KV.
   Lets you exercise the full API (verify-tx / verify-license / get-btc-rate)
   against a real HTTP endpoint without wrangler or a Cloudflare account. */
import { createServer } from 'node:http';
import worker from '../worker/index.js';

const PORT = Number(process.env.PORT || 8787);

class MemKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  async delete(k) { this.map.delete(k); }
}

const env = {
  LICENSES: new MemKV(),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || 'local-dev-token',
  ALLOWED_ORIGINS: '*',
  BTC_ADDRESS: process.env.BTC_ADDRESS || 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
  DEV_MODE: '1',
};

function corsError(res, msg) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: msg })); }

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const url = 'http://' + (req.headers.host || 'localhost:' + PORT) + req.url;
  const init = { method: req.method, headers: Object.assign({}, req.headers) };
  if (body.length) init.body = body; // keep original bytes (json)

  let resp;
  try {
    resp = await worker.fetch(new Request(url, init), env, { waitUntil() {} });
  } catch (err) {
    corsError(res, 'local worker error: ' + String((err && err.message) || err));
    return;
  }
  res.writeHead(resp.status, Object.fromEntries(resp.headers));
  res.end(Buffer.from(await resp.arrayBuffer()));
}).listen(PORT, () => {
  console.log('[focus-bot-worker] http://localhost:' + PORT);
  console.log('[focus-bot-worker] master key  : FOCUS-PRO-4YF4SA5M');
});