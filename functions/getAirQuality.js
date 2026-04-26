/**
 * getAirQuality — IQAir AirVisual API proxy with 1-hour Firestore cache.
 *
 * The Community-tier API key is server-side only (functions/.env →
 * process.env.IQAIR_API_KEY). Frontend calls this CF instead of hitting
 * api.airvisual.com directly so the key never reaches the browser, where
 * it would be visible in DevTools and could be scraped to exhaust our
 * 10,000-call/month quota.
 *
 * Cache: Firestore system/airQualityCache. With one location (Bangkok)
 * and a 1-hour TTL, we make ~720 IQAir calls/month — comfortably under
 * the Community-tier free quota. Every tenant hit during the cache window
 * is a Firestore read, not an IQAir call.
 *
 * Stale-on-error fallback: if IQAir returns an error and we have ANY
 * cached value (even >1h old), serve the stale one with `stale: true`.
 * Better than blanking the card on a transient outage.
 */
const functions = require('firebase-functions');
const admin     = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

// Sai Mai district coords — The Green Haven is here. /v2/nearest_city at these
// coords resolves to "Sai Mai" city (verified via curl 2026-04-26: data.city='Sai Mai').
// /v2/nearest_station was tried but Community tier returns permission_denied
// (station-level access requires Pro tier $295/mo). City aggregate is good enough
// — it's already Sai Mai-specific, just a multi-station average rather than one sensor.
const DEFAULT_LAT = 13.92;
const DEFAULT_LON = 100.64;
const CACHE_DOC   = 'system/airQualityCache';
const CACHE_TTL   = 60 * 60 * 1000;  // 1 hour
// IQAir maps mainus to short codes — surface readable Thai labels client-side.
const POLLUTANT_LABELS = {
  p2: { code: 'PM2.5', label: 'PM2.5' },
  p1: { code: 'PM10',  label: 'PM10' },
  o3: { code: 'O3',    label: 'โอโซน (O₃)' },
  n2: { code: 'NO2',   label: 'NO₂' },
  s2: { code: 'SO2',   label: 'SO₂' },
  co: { code: 'CO',    label: 'CO' }
};

function _normalize(iqairData, openMeteoData) {
  const cur = iqairData?.data?.current?.pollution || {};
  const wx  = iqairData?.data?.current?.weather   || {};
  const code = cur.mainus || 'p2';  // default PM2.5
  const pol = POLLUTANT_LABELS[code] || POLLUTANT_LABELS.p2;
  // IQAir Community tier returns AQI + main pollutant CODE, but no μg/m³
  // concentration (that's Standard tier $295/mo). Open-Meteo gives us pm2_5
  // and pm10 concentrations free — backfill the missing field.
  const om = openMeteoData?.current || {};
  const concentration = code === 'p1' ? Number(om.pm10)
                      : code === 'p2' ? Number(om.pm2_5)
                      : null;
  return {
    aqi:           Number(cur.aqius)       || 0,
    mainPollutant: pol.code,
    mainLabel:     pol.label,
    concentration: concentration != null && !isNaN(concentration) ? Number(concentration.toFixed(1)) : null,
    timestamp:     cur.ts || new Date().toISOString(),
    city:          iqairData?.data?.city   || null,
    // Weather payload (IQAir bundles it in the same response — saves an Open-Meteo call)
    temp:     Number(wx.tp)  || 0,
    humidity: Number(wx.hu)  || 0,
    windKmh:  Math.round((Number(wx.ws) || 0) * 3.6),  // m/s → km/h
    pressure: Number(wx.pr)  || 0,
    weatherIcon: wx.ic || ''
  };
}

exports.getAirQuality = functions
  .region('asia-southeast1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const lat = Number(data?.lat) || DEFAULT_LAT;
    const lon = Number(data?.lon) || DEFAULT_LON;

    const db = admin.firestore();
    const cacheRef = db.doc(CACHE_DOC);

    // 1. Try cache first
    try {
      const snap = await cacheRef.get();
      if (snap.exists) {
        const cached = snap.data();
        const age = Date.now() - (cached.fetchedAt || 0);
        if (age < CACHE_TTL && cached.payload) {
          return { ...cached.payload, cached: true, ageMs: age };
        }
      }
    } catch (e) {
      console.warn('cache read failed (continuing to fetch):', e?.message);
    }

    // 2. Cache stale or missing — fetch from IQAir
    const apiKey = process.env.IQAIR_API_KEY;
    if (!apiKey) {
      throw new functions.https.HttpsError('failed-precondition',
        'IQAIR_API_KEY not configured on server');
    }
    // nearest_city resolves coords→nearest IQAir city. At our default coords
    // (13.92, 100.64) this returns data.city='Sai Mai' (the district we're in),
    // so the AQI is already Sai Mai-specific — no need for nearest_station
    // (which is Pro-tier only on Community key).
    const iqairUrl    = `https://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lon}&key=${apiKey}`;
    const openMeteoUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10&timezone=Asia%2FBangkok`;

    let payload;
    try {
      // Parallel: IQAir for AQI + main pollutant code, Open-Meteo for concentration μg/m³
      const [iqRes, omRes] = await Promise.all([
        fetch(iqairUrl),
        fetch(openMeteoUrl).catch(() => null)
      ]);
      if (!iqRes.ok) throw new Error(`IQAir HTTP ${iqRes.status}`);
      const iqJson = await iqRes.json();
      if (iqJson.status !== 'success') {
        throw new Error(`IQAir status=${iqJson.status} (${iqJson.data?.message || 'unknown'})`);
      }
      const omJson = omRes && omRes.ok ? await omRes.json().catch(() => null) : null;
      payload = _normalize(iqJson, omJson);
    } catch (e) {
      console.warn('IQAir fetch failed:', e?.message);
      // 3. Fall back to stale cache if any (better than nothing on transient outage)
      try {
        const snap = await cacheRef.get();
        if (snap.exists && snap.data().payload) {
          return { ...snap.data().payload, cached: true, stale: true, error: e?.message };
        }
      } catch (_) {}
      throw new functions.https.HttpsError('unavailable',
        'Air quality service unavailable: ' + (e?.message || 'unknown'));
    }

    // 4. Write fresh cache (best-effort — don't fail the request if write errors)
    try {
      await cacheRef.set({ payload, fetchedAt: Date.now() }, { merge: false });
    } catch (e) {
      console.warn('cache write failed:', e?.message);
    }

    return { ...payload, cached: false };
  });
