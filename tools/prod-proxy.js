#!/usr/bin/env node
/**
 * Minimal HTTP->HTTPS proxy to the live Vercel deployment so Claude's preview
 * browser (which is pinned to localhost) can drive the real production site
 * and capture its console. Debug/audit use only — do not commit as a dev tool.
 */
const http = require('http');
const https = require('https');

const TARGET_HOST = 'the-green-haven.vercel.app';
const PORT = 8787;

process.on('uncaughtException', (err) => console.error('uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('unhandled:', err && err.message));

const server = http.createServer((req, res) => {
  try {
    const opts = {
      host: TARGET_HOST,
      port: 443,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: TARGET_HOST },
    };
    const proxied = https.request(opts, (pr) => {
      const headers = { ...pr.headers };
      delete headers['strict-transport-security'];
      try { res.writeHead(pr.statusCode || 502, headers); } catch (_) {}
      pr.on('error', () => {});
      pr.pipe(res).on('error', () => {});
    });
    proxied.on('error', (err) => {
      try {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('proxy error: ' + err.message);
      } catch (_) {}
    });
    req.on('error', () => {});
    res.on('error', () => {});
    req.pipe(proxied).on('error', () => {});
  } catch (err) {
    try { res.end('handler error: ' + err.message); } catch (_) {}
  }
});
server.on('clientError', (err, sock) => { try { sock.end(); } catch (_) {} });

server.listen(PORT, () => {
  console.log(`proxy -> https://${TARGET_HOST} on http://localhost:${PORT}`);
});
