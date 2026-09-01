/* Tiny zero-dependency static server for FocusBot's client/ frontend demo. */
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  let filePath = normalize(join(ROOT, p === '/' ? 'index.html' : p));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(ROOT, 'index.html');
  }
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (err) {
    res.writeHead(500); res.end('Server error: ' + err.message);
  }
}).listen(PORT, () => {
  console.log('[focus-bot-demo] http://localhost:' + PORT + '  (serving ' + ROOT + ')');
});