/**
 * Unit tests for getAirQuality.js
 * Run: node --test functions/__tests__/getAirQuality.test.js
 */
const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub state ────────────────────────────────────────────────────────────────
let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    // Cache doc
    cacheExists:   false,
    cacheData:     null,
    cacheGetError: null,
    cacheSetError: null,
    // IQAir fetch
    iqairOk:     true,
    iqairStatus: 200,
    iqairBody: {
      status: 'success',
      data: {
        city: 'Sai Mai',
        current: {
          pollution: { aqius: 55, mainus: 'p2', ts: '2026-01-01T00:00:00.000Z' },
          weather:   { tp: 32, hu: 70, ws: 3.5, pr: 1010, ic: '04d' },
        },
      },
    },
    iqairError: null,
    // Open-Meteo fetch
    omOk:    true,
    omBody:  { current: { pm2_5: 20.3, pm10: 35.1 } },
    omError: null,
    ...overrides,
  };
  captured = {
    fetchCalls:        [],
    firestoreSetCalls: [],
  };
}
resetStubs();

// ── Module._load interception ─────────────────────────────────────────────────
// Must happen BEFORE require('../getAirQuality') so every import inside the CF
// resolves to the stub.  admin.firestore() is called INSIDE the handler (not at
// module load), so a factory approach works fine.

const Module    = require('module');
const _origLoad = Module._load;

let capturedCallHandler = null;

function makeFirestoreStub() {
  return {
    doc: (_path) => ({
      get: async () => {
        if (stubState.cacheGetError) throw stubState.cacheGetError;
        return {
          exists: stubState.cacheExists,
          data:   () => stubState.cacheData,
        };
      },
      set: async (data, opts) => {
        if (stubState.cacheSetError) throw stubState.cacheSetError;
        captured.firestoreSetCalls.push({ data, opts });
      },
    }),
  };
}

Module._load = function (request, parent, ...rest) {
  if (request === 'firebase-admin') {
    return {
      apps:          [{}],
      initializeApp: () => {},
      firestore:     () => makeFirestoreStub(),
    };
  }

  if (request === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) {
        super(msg);
        this.code = code;
      }
    }
    const https = {
      onCall:     (fn) => { capturedCallHandler = fn; return fn; },
      HttpsError,
    };
    // .region(...).runWith({ secrets }).https.onCall(...) — runWith is chainable.
    const builder = { https, runWith: () => builder };
    return {
      region: () => builder,
      https: { HttpsError },
    };
  }

  if (request === 'firebase-functions/params') {
    // defineSecret(name).value() resolves to process.env[name] (the env var
    // Cloud Functions injects from Secret Manager), so the existing
    // process.env-based key tests still drive .value().
    return { defineSecret: (name) => ({ value: () => process.env[name] }) };
  }

  return _origLoad.call(this, request, parent, ...rest);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────
// Install BEFORE require so we're sure it's in place at module parse time,
// even though the CF only calls fetch inside the handler body.
const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;

global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });
  if (url.includes('airvisual.com')) {
    if (stubState.iqairError) throw stubState.iqairError;
    return {
      ok:     stubState.iqairOk,
      status: stubState.iqairStatus,
      json:   async () => stubState.iqairBody,
    };
  }
  // Open-Meteo (air-quality-api.open-meteo.com)
  if (stubState.omError) throw stubState.omError;
  return {
    ok:     stubState.omOk,
    status: 200,
    json:   async () => stubState.omBody,
  };
};

// Load the CF – this registers the onCall handler via the stub above.
delete require.cache[require.resolve('../getAirQuality.js')];
require('../getAirQuality.js');

// ── Restore after suite ───────────────────────────────────────────────────────
after(() => {
  Module._load = _origLoad;
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Context helpers ───────────────────────────────────────────────────────────
const makeContext = (auth = { uid: 'Uabc' }) => ({ auth });

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('getAirQuality', () => {
  beforeEach(() => {
    resetStubs();
    process.env.IQAIR_API_KEY = 'testkey';
  });

  // 1. Handler registration
  it('handler is registered via onCall', () => {
    assert.ok(capturedCallHandler, 'capturedCallHandler should be non-null');
    assert.equal(typeof capturedCallHandler, 'function');
  });

  // 2. Auth gate
  it('throws unauthenticated when context.auth is absent', async () => {
    await assert.rejects(
      () => capturedCallHandler({}, { auth: null }),
      (e) => e.code === 'unauthenticated',
    );
  });

  // 3. Fresh cache (<1 h) → returns cached payload, no fetch
  it('returns cached payload with cached:true when cache is fresh', async () => {
    const freshAge   = 1000; // 1 s old
    const cachedPayload = { aqi: 42, mainPollutant: 'PM2.5', mainLabel: 'PM2.5',
                            concentration: 15.0, temp: 30, humidity: 65,
                            windKmh: 10, pressure: 1008, weatherIcon: '01d',
                            city: 'Sai Mai', timestamp: '2026-01-01T00:00:00.000Z' };
    stubState.cacheExists = true;
    stubState.cacheData   = { fetchedAt: Date.now() - freshAge, payload: cachedPayload };

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, true, 'should be cached:true');
    assert.equal(result.aqi, 42);
    assert.ok(typeof result.ageMs === 'number' && result.ageMs >= freshAge - 50,
              'ageMs should reflect approximate age');
    assert.equal(captured.fetchCalls.length, 0, 'should not call fetch');
  });

  // 4. Stale cache (>1 h) → falls through to IQAir fetch
  it('fetches IQAir when cache is stale (>1 h old)', async () => {
    stubState.cacheExists = true;
    stubState.cacheData   = {
      fetchedAt: Date.now() - 2 * 3600 * 1000,
      payload: { aqi: 42 },
    };

    await capturedCallHandler({}, makeContext());

    assert.ok(
      captured.fetchCalls.some((c) => c.url.includes('airvisual.com')),
      'should call IQAir after stale cache',
    );
  });

  // 5. Happy path: no cache + valid IQAir + valid OpenMeteo
  it('returns full payload with cached:false on fresh fetch', async () => {
    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 55);
    assert.equal(result.mainPollutant, 'PM2.5');
    assert.equal(result.concentration, 20.3);
    assert.equal(result.city, 'Sai Mai');
    assert.equal(result.temp, 32);
    assert.equal(result.humidity, 70);
    // 3.5 m/s × 3.6 = 12.6 → Math.round = 13
    assert.equal(result.windKmh, 13);
    assert.equal(result.pressure, 1010);
    assert.equal(result.weatherIcon, '04d');
    // Cache should have been written
    assert.equal(captured.firestoreSetCalls.length, 1);
    assert.equal(captured.firestoreSetCalls[0].opts.merge, false);
  });

  // 6. Missing IQAIR_API_KEY → failed-precondition before any fetch
  it('throws failed-precondition when IQAIR_API_KEY is absent', async () => {
    delete process.env.IQAIR_API_KEY;

    await assert.rejects(
      () => capturedCallHandler({}, makeContext()),
      (e) => e.code === 'failed-precondition' && /IQAIR_API_KEY/i.test(e.message),
    );
    assert.equal(captured.fetchCalls.length, 0, 'should not fetch when key missing');
  });

  // 7. IQAir HTTP error + stale cache exists → returns stale with stale:true
  it('returns stale cache with stale:true when IQAir HTTP errors', async () => {
    stubState.iqairOk     = false;
    stubState.iqairStatus = 500;
    stubState.cacheExists = true;
    stubState.cacheData   = {
      fetchedAt: Date.now() - 2 * 3600 * 1000,
      payload: { aqi: 99, mainPollutant: 'PM10', city: 'Sai Mai' },
    };

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, true);
    assert.equal(result.stale, true);
    assert.equal(result.aqi, 99);
    assert.ok(result.error, 'error message should be present');
  });

  // 8. IQAir HTTP error + no cache → throws unavailable
  it('throws unavailable when IQAir HTTP errors and no cache exists', async () => {
    stubState.iqairOk     = false;
    stubState.iqairStatus = 503;

    await assert.rejects(
      () => capturedCallHandler({}, makeContext()),
      (e) => e.code === 'unavailable',
    );
  });

  // 9. IQAir status !== 'success' → throws unavailable
  it('throws unavailable when IQAir body status is not success', async () => {
    stubState.iqairBody = { status: 'call_limit_reached', data: { message: 'quota exceeded' } };

    await assert.rejects(
      () => capturedCallHandler({}, makeContext()),
      (e) => e.code === 'unavailable',
    );
  });

  // 10. OpenMeteo fails → concentration is null, IQAir fields still returned
  it('returns payload with concentration:null when OpenMeteo fails', async () => {
    stubState.omError = new Error('open-meteo network error');

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 55, 'aqi from IQAir should still be present');
    assert.equal(result.concentration, null, 'concentration should be null on OM failure');
  });

  // 11. Cache write fails (best-effort) → handler still returns payload
  it('still returns payload when cache write fails', async () => {
    stubState.cacheSetError = new Error('firestore write error');

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 55, 'should return payload despite write failure');
  });

  // 12. Cache get throws → falls through to IQAir fetch (continues normally)
  it('falls through to IQAir fetch when cache get throws', async () => {
    stubState.cacheGetError = new Error('firestore get error');

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 55);
    assert.ok(
      captured.fetchCalls.some((c) => c.url.includes('airvisual.com')),
      'should call IQAir after cache read failure',
    );
  });

  // 13. Default lat/lon used when data is null/undefined
  it('uses default lat/lon when data is null', async () => {
    await capturedCallHandler(null, makeContext());

    const iqCall = captured.fetchCalls.find((c) => c.url.includes('airvisual.com'));
    assert.ok(iqCall, 'should call IQAir');
    assert.ok(iqCall.url.includes('lat=13.92'), 'should include default lat');
    assert.ok(iqCall.url.includes('lon=100.64'), 'should include default lon');
  });

  // 14. lat/lon from data overrides defaults
  it('uses lat/lon from data when provided', async () => {
    await capturedCallHandler({ lat: 13.5, lon: 100.9 }, makeContext());

    const iqCall = captured.fetchCalls.find((c) => c.url.includes('airvisual.com'));
    assert.ok(iqCall, 'should call IQAir');
    assert.ok(iqCall.url.includes('lat=13.5'), 'should use provided lat');
    assert.ok(iqCall.url.includes('lon=100.9'), 'should use provided lon');
  });

  // 15. mainPollutant = 'PM10' when mainus = 'p1'
  it('maps mainus p1 to PM10 with correct concentration from pm10 field', async () => {
    stubState.iqairBody = {
      status: 'success',
      data: {
        city: 'Sai Mai',
        current: {
          pollution: { aqius: 80, mainus: 'p1', ts: '2026-01-01T00:00:00.000Z' },
          weather:   { tp: 30, hu: 60, ws: 2.0, pr: 1005, ic: '02d' },
        },
      },
    };
    stubState.omBody = { current: { pm2_5: 18.5, pm10: 42.7 } };

    const result = await capturedCallHandler({}, makeContext());

    assert.equal(result.mainPollutant, 'PM10');
    assert.equal(result.mainLabel, 'PM10');
    assert.equal(result.concentration, 42.7, 'should use pm10 value for p1 pollutant');
    assert.equal(result.aqi, 80);
  });
});
