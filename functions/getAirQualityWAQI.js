/**
 * getAirQualityWAQI — World Air Quality Index API proxy with 1-hour Firestore cache.
 *
 * Why a separate CF from getAirQuality (IQAir): WAQI uses station-level data
 * (e.g. Thai PCD government sensors) instead of IQAir's city aggregate, so the
 * AQI value tracks the official iqair.com/saimai-50 page much closer. IQAir
 * Community tier blocks /v2/nearest_station (permission_denied), so we use
 * WAQI as the free station-grade alternative.
 *
 * The token is server-side only (functions/.env → process.env.WAQI_API_TOKEN).
 * Frontend calls this CF instead of api.waqi.info directly so the token never
 * reaches the browser.
 *
 * Cache: Firestore system/airQualityCacheWAQI. 1-hour TTL → ~720 calls/month
 * for one location, well under WAQI's 1000/sec rate limit and unlimited daily.
 *
 * Stale-on-error fallback: if WAQI errors and we have ANY cached value,
 * serve the stale one with `stale: true`. Better than blanking the card.
 *
 * Output shape: identical to getAirQuality so frontend can swap callable name
 * with no other changes — { aqi, mainPollutant, mainLabel, concentration,
 * temp, humidity, windKmh, pressure, weatherIcon, city, attribution[] }.
 */
const functions = require('firebase-functions');
const admin     = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const DEFAULT_LAT = 13.92;          // Sai Mai (The Green Haven)
const DEFAULT_LON = 100.64;
const CACHE_DOC   = 'system/airQualityCacheWAQI';
const CACHE_TTL   = 60 * 60 * 1000;  // 1 hour

// WAQI's `dominentpol` codes → readable Thai labels.
const POLLUTANT_LABELS = {
  pm25: { code: 'PM2.5', label: 'PM2.5' },
  pm10: { code: 'PM10',  label: 'PM10' },
  o3:   { code: 'O3',    label: 'โอโซน (O₃)' },
  no2:  { code: 'NO2',   label: 'NO₂' },
  so2:  { code: 'SO2',   label: 'SO₂' },
  co:   { code: 'CO',    label: 'CO' }
};

function _normalize(waqiData, openMeteoData) {
  const d = waqiData?.data || {};
  const iaqi = d.iaqi || {};
  const code = String(d.dominentpol || 'pm25').toLowerCase();
  const pol = POLLUTANT_LABELS[code] || POLLUTANT_LABELS.pm25;
  // WAQI's iaqi.pm25.v is US AQI (0-500), NOT μg/m³. Open-Meteo gives us the
  // concentration in μg/m³ free — backfill the missing field for the card UI.
  const om = openMeteoData?.current || {};
  const concentration = code === 'pm10' ? Number(om.pm10)
                      : code === 'pm25' ? Number(om.pm2_5)
                      : null;
  return {
    aqi:           Number(d.aqi)           || 0,
    mainPollutant: pol.code,
    mainLabel:     pol.label,
    concentration: concentration != null && !isNaN(concentration)
                     ? Number(concentration.toFixed(1))
                     : null,
    timestamp:     d.time?.iso || d.time?.s || new Date().toISOString(),
    city:          d.city?.name || null,
    stationId:     d.idx || null,
    // Weather payload from WAQI's iaqi (Thai PCD stations report these too)
    temp:     Number(iaqi.t?.v)  || 0,
    humidity: Number(iaqi.h?.v)  || 0,
    windKmh:  Math.round((Number(iaqi.w?.v) || 0) * 3.6),  // m/s → km/h
    pressure: Number(iaqi.p?.v)  || 0,
    weatherIcon: '',  // WAQI doesn't return weather icons; frontend uses Open-Meteo emoji
    // Attribution (required by WAQI ToS — frontend should surface at least one)
    attribution: Array.isArray(d.attributions)
      ? d.attributions.map(a => ({ name: a.name || '', url: a.url || '' }))
      : []
  };
}

exports.getAirQualityWAQI = functions
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

    // 2. Cache stale or missing — fetch fresh
    const token = process.env.WAQI_API_TOKEN;
    if (!token) {
      throw new functions.https.HttpsError('failed-precondition',
        'WAQI_API_TOKEN not configured on server');
    }
    const waqiUrl     = `https://api.waqi.info/feed/geo:${lat};${lon}/?token=${token}`;
    const openMeteoUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm2_5,pm10&timezone=Asia%2FBangkok`;

    let payload;
    try {
      const [wqRes, omRes] = await Promise.all([
        fetch(waqiUrl),
        fetch(openMeteoUrl).catch(() => null)
      ]);
      if (!wqRes.ok) throw new Error(`WAQI HTTP ${wqRes.status}`);
      const wqJson = await wqRes.json();
      if (wqJson.status !== 'ok') {
        throw new Error(`WAQI status=${wqJson.status} (${wqJson.data || 'unknown'})`);
      }
      const omJson = omRes && omRes.ok ? await omRes.json().catch(() => null) : null;
      payload = _normalize(wqJson, omJson);
    } catch (e) {
      console.warn('WAQI fetch failed:', e?.message);
      // 3. Stale-cache fallback
      try {
        const snap = await cacheRef.get();
        if (snap.exists && snap.data().payload) {
          return { ...snap.data().payload, cached: true, stale: true, error: e?.message };
        }
      } catch (_) {}
      throw new functions.https.HttpsError('unavailable',
        'Air quality service unavailable: ' + (e?.message || 'unknown'));
    }

    // 4. Write fresh cache (best-effort)
    try {
      await cacheRef.set({ payload, fetchedAt: Date.now() }, { merge: false });
    } catch (e) {
      console.warn('cache write failed:', e?.message);
    }

    return { ...payload, cached: false };
  });
