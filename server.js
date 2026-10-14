'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const httpProxy = require('http-proxy');

const PORT = Number(process.env.PORT || 10000);
const REGISTER_TOKEN = process.env.REGISTER_TOKEN;
if (!REGISTER_TOKEN || REGISTER_TOKEN.length < 24) {
  console.error('ERROR: Set REGISTER_TOKEN in Render environment (at least 24 characters).');
  process.exit(1);
}

let tunnelTarget = '';
let lastRegisteredAt = 0;
const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  ws: true,
  proxyTimeout: 120000,
  timeout: 120000
});

proxy.on('error', (err, req, res) => {
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Local tunnel is not connected yet. Start the local manager and refresh.');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
  console.error('Proxy error:', err.message);
});

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/_health') {
    return send(res, 200, {
      ok: true,
      connected: Boolean(tunnelTarget),
      lastRegisteredAt: lastRegisteredAt || null
    });
  }

  if (url.pathname === '/_register' && req.method === 'POST') {
    const supplied = req.headers.authorization || '';
    const expected = `Bearer ${REGISTER_TOKEN}`;
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return send(res, 401, { error: 'Unauthorized' });
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) {
        send(res, 413, { error: 'Payload too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const parsed = new URL(data.url);
        if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.trycloudflare.com') ||
            parsed.username || parsed.password || parsed.port) {
          return send(res, 400, { error: 'Expected an https://*.trycloudflare.com URL' });
        }
        tunnelTarget = parsed.origin;
        lastRegisteredAt = Date.now();
        console.log('Tunnel registered:', parsed.hostname);
        return send(res, 200, { ok: true, target: tunnelTarget });
      } catch {
        return send(res, 400, { error: 'Invalid JSON or tunnel URL' });
      }
    });
    return;
  }

  if (url.pathname.startsWith('/_register')) {
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (!tunnelTarget) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    return res.end('Tunnel not registered. Start the local tunnel manager, then refresh.');
  }

  // Do not forward internal bridge endpoints to the local application.
  proxy.web(req, res, { target: tunnelTarget, secure: true });
});

server.on('upgrade', (req, socket, head) => {
  if (!tunnelTarget) return socket.destroy();
  proxy.ws(req, socket, head, { target: tunnelTarget, secure: true });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Bridge listening on ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
