// Vercel API Route — speed test payload generator.
// Returns N bytes of incompressible random data so the client can measure
// real download throughput from the tenant_app speed test UI.
//
// The data is generated per-request (no caching) and randomized so gzip/brotli
// at the edge can't compress it — otherwise compressed responses would skew
// the measured Mbps (looks faster than the wire actually is).
//
// Usage from tenant_app:
//   const t0 = performance.now();
//   const resp = await fetch('/api/speed-test?bytes=2000000', { cache: 'no-store' });
//   const buf  = await resp.arrayBuffer();
//   const ms   = performance.now() - t0;
//   const mbps = (buf.byteLength * 8) / (ms / 1000) / 1_000_000;

import crypto from 'crypto';

const DEFAULT_BYTES = 2_000_000;   // 2 MB — enough signal in ~1-2s on typical home wifi
const MAX_BYTES     = 8_000_000;   // 8 MB hard cap so a misconfigured client can't DOS

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let bytes = Number.parseInt(req.query?.bytes, 10);
  if (!Number.isFinite(bytes) || bytes <= 0) bytes = DEFAULT_BYTES;
  if (bytes > MAX_BYTES) bytes = MAX_BYTES;

  // Random buffer — incompressible, prevents edge gzip from skewing throughput.
  const buf = crypto.randomBytes(bytes);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Encoding', 'identity'); // disable transparent compression
  return res.status(200).send(buf);
}
