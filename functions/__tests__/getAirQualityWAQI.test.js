/**
 * Unit tests for getAirQualityWAQI — Gen1 onCall CF (WAQI API proxy with cache).
 *
 * Stubs: firebase-admin (Module._load), firebase-functions/v1 (Module._load),
 *        global.fetch (patched before require).
 *
 * Run: node --test functions/__tests__/getAirQualityWAQI.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// ── Stub state ────────────────────────────────────────────────────────────────

let stubState = {};
let captured  = {};

function resetStubs(overrides = {}) {
  stubState = {
    cacheExists:    false,
    cacheData:      null,
    cacheGetError:  null,
    cacheSetError:  null,
    waqiOk:         true,
    waqiStatus:     200,
    waqiBody: {
      status: 'ok',
      data: {
        aqi:          65,
        dominentpol:  'pm25',
        iaqi: {
          t: { v: 32 },
          h: { v: 70 },
          w: { v: 3.5 },
          p: { v: 1010 },
        },
        city:         { name: 'Sai Mai' },
        time:         { iso: '2026-01-01T00:00:00+07:00' },
        attributions: [{ name: 'Thai PCD', url: 'http://aqmthai.com' }],
        idx:          12345,
      },
    },
    waqiError: null,
    omOk:      true,
    omBody:    { current: { pm2_5: 22.1, pm10: 38.5 } },
    omError:   null,
    ...overrides,
  };
  captured = {
    fetchCalls:        [],  // [{ url, opts }]
    firestoreSetCalls: [],  // [{ data, opts }]
  };
}
resetStubs();

// ── Firestore stub factory ────────────────────────────────────────────────────

function makeFirestoreStub() {
  return {
    doc: () => ({
      get: async () => {
        if (stubState.cacheGetError) throw stubState.cacheGetError;
        return { exists: stubState.cacheExists, data: () => stubState.cacheData };
      },
      set: async (data, opts) => {
        if (stubState.cacheSetError) throw stubState.cacheSetError;
        captured.firestoreSetCalls.push({ data, opts });
      },
    }),
  };
}

// ── Module._load interception (must run BEFORE require('../getAirQualityWAQI.js')) ──

let capturedCallHandler = null;

const _origLoad = Module._load;

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
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({
        https: {
          onCall: (fn) => { capturedCallHandler = fn; return fn; },
          HttpsError,
        },
      }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, request, parent, ...rest);
};

// ── global.fetch stub ─────────────────────────────────────────────────────────

const _origFetch = typeof global.fetch === 'function' ? global.fetch : null;

global.fetch = async (url, opts) => {
  captured.fetchCalls.push({ url, opts });

  if (url.includes('waqi.info')) {
    if (stubState.waqiError) throw stubState.waqiError;
    return {
      ok:     stubState.waqiOk,
      status: stubState.waqiStatus,
      json:   async () => stubState.waqiBody,
    };
  }

  // Open-Meteo
  if (stubState.omError) throw stubState.omError;
  return {
    ok:     stubState.omOk,
    status: 200,
    json:   async () => stubState.omBody,
  };
};

// ── Require CF after all stubs are in place ───────────────────────────────────

delete require.cache[require.resolve('../getAirQualityWAQI.js')];
require('../getAirQualityWAQI.js');

after(() => {
  Module._load = _origLoad;
  if (_origFetch === null) delete global.fetch;
  else global.fetch = _origFetch;
});

// ── Context helpers ───────────────────────────────────────────────────────────

const authCtx    = { auth: { uid: 'line:Uabc', token: {} } };
const noAuthCtx  = { auth: null };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getAirQualityWAQI', () => {
  beforeEach(() => {
    resetStubs();
    process.env.WAQI_API_TOKEN = 'test-token';
  });

  // 1. Handler captured at module load
  it('captures the onCall handler during module load', () => {
    assert.ok(
      typeof capturedCallHandler === 'function',
      'capturedCallHandler must be a function after require'
    );
  });

  // 2. No auth → throws unauthenticated
  it('throws unauthenticated when caller has no auth context', async () => {
    await assert.rejects(
      () => capturedCallHandler({}, noAuthCtx),
      (err) => {
        assert.equal(err.code, 'unauthenticated');
        return true;
      }
    );
  });

  // 3. Fresh cache → returns payload with cached:true, no fetch issued
  it('returns cached payload with cached:true without fetching when cache is fresh', async () => {
    const freshPayload = { aqi: 50, mainPollutant: 'PM2.5', mainLabel: 'PM2.5', concentration: 18.0 };
    resetStubs({
      cacheExists: true,
      cacheData:   { fetchedAt: Date.now() - 1000, payload: freshPayload },
    });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, true);
    assert.equal(result.aqi, 50);
    assert.equal(captured.fetchCalls.length, 0, 'no fetch calls expected on fresh cache hit');
  });

  // 4. Stale cache → calls WAQI fetch
  it('falls through to WAQI fetch when cache is stale', async () => {
    resetStubs({
      cacheExists: true,
      cacheData:   { fetchedAt: Date.now() - 7200000, payload: { aqi: 50 } },
    });

    await capturedCallHandler({}, authCtx);

    assert.ok(
      captured.fetchCalls.some(c => c.url.includes('waqi.info')),
      'must issue a fetch to waqi.info when cache is stale'
    );
  });

  // 5. No cache + valid WAQI + valid Open-Meteo → cached:false, correct fields
  it('returns cached:false, aqi:65, concentration:22.1 on a fresh successful fetch', async () => {
    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 65);
    assert.equal(result.concentration, 22.1);
  });

  // 6. Missing WAQI_API_TOKEN → throws failed-precondition
  it('throws failed-precondition when WAQI_API_TOKEN env var is absent', async () => {
    delete process.env.WAQI_API_TOKEN;

    await assert.rejects(
      () => capturedCallHandler({}, authCtx),
      (err) => {
        assert.equal(err.code, 'failed-precondition');
        return true;
      }
    );
  });

  // 7. WAQI HTTP error + stale cache → returns stale payload with stale:true
  it('returns stale cache with stale:true when WAQI errors and stale data exists', async () => {
    resetStubs({
      cacheExists: true,
      cacheData:   { fetchedAt: Date.now() - 7200000, payload: { aqi: 50 } },
      waqiError:   new Error('WAQI down'),
    });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, true);
    assert.equal(result.stale, true);
    assert.equal(result.aqi, 50);
  });

  // 8. WAQI HTTP error + no cache → throws unavailable
  it('throws unavailable when WAQI errors and no cache exists', async () => {
    resetStubs({ waqiError: new Error('connection reset') });

    await assert.rejects(
      () => capturedCallHandler({}, authCtx),
      (err) => {
        assert.equal(err.code, 'unavailable');
        return true;
      }
    );
  });

  // 9. WAQI status !== 'ok' → throws unavailable
  it('throws unavailable when WAQI response status is not ok', async () => {
    resetStubs({
      waqiBody: { status: 'error', data: 'Unknown station' },
    });

    await assert.rejects(
      () => capturedCallHandler({}, authCtx),
      (err) => {
        assert.equal(err.code, 'unavailable');
        return true;
      }
    );
  });

  // 10. Open-Meteo fails → concentration:null but WAQI data still returned
  it('returns concentration:null when Open-Meteo fetch fails but WAQI succeeds', async () => {
    resetStubs({ omError: new Error('Open-Meteo timeout') });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 65);
    assert.equal(result.concentration, null, 'concentration must be null when Open-Meteo fails');
  });

  // 11. Cache set error → best-effort, request still succeeds
  it('succeeds despite cache write error (best-effort cache write)', async () => {
    resetStubs({ cacheSetError: new Error('quota exceeded') });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, false);
    assert.equal(result.aqi, 65);
    assert.equal(
      captured.firestoreSetCalls.length, 0,
      'set must have been attempted but threw, so captures array stays empty'
    );
  });

  // 12. Cache get throws → falls through to WAQI fetch
  it('falls through to WAQI fetch when cache get throws', async () => {
    resetStubs({ cacheGetError: new Error('Firestore unavailable') });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.cached, false);
    assert.ok(
      captured.fetchCalls.some(c => c.url.includes('waqi.info')),
      'must still fetch WAQI after cache read error'
    );
  });

  // 13. Output includes attribution array with name and url
  it('includes attribution array with name and url from WAQI response', async () => {
    const result = await capturedCallHandler({}, authCtx);

    assert.ok(Array.isArray(result.attribution), 'attribution must be an array');
    assert.equal(result.attribution.length, 1);
    assert.equal(result.attribution[0].name, 'Thai PCD');
    assert.equal(result.attribution[0].url, 'http://aqmthai.com');
  });

  // 14. Output includes stationId from data.idx
  it('includes stationId field mapped from WAQI data.idx', async () => {
    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.stationId, 12345);
  });

  // 15. weatherIcon is always empty string
  it('sets weatherIcon to empty string (WAQI does not provide icons)', async () => {
    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.weatherIcon, '');
  });

  // 16. dominentpol pm10 → mainPollutant PM10, concentration uses pm10
  it('maps dominentpol pm10 → mainPollutant PM10 and uses pm10 concentration from Open-Meteo', async () => {
    resetStubs({
      waqiBody: {
        status: 'ok',
        data: {
          aqi:          85,
          dominentpol:  'pm10',
          iaqi: {
            t: { v: 30 },
            h: { v: 65 },
            w: { v: 2.0 },
            p: { v: 1005 },
            pm10: { v: 60 },
          },
          city:         { name: 'Sai Mai' },
          time:         { iso: '2026-01-01T01:00:00+07:00' },
          attributions: [{ name: 'Thai PCD', url: 'http://aqmthai.com' }],
          idx:          12345,
        },
      },
    });

    const result = await capturedCallHandler({}, authCtx);

    assert.equal(result.mainPollutant, 'PM10');
    assert.equal(result.concentration, 38.5, 'concentration for pm10 must use Open-Meteo pm10 value');
  });
});
