/**
 * Unit tests for claimWellnessQuizPoints — server-side trust closes the
 * client-side localStorage gap shipped in Session A.
 *
 * Coverage matrix:
 *   - Auth: unauthenticated, claim mismatch (tenant + player)
 *   - Validation: missing articleId, missing answers, length mismatch, unknown building
 *   - Article: not found, no quiz field
 *   - Idempotency: already-claimed this month → already-exists
 *   - Grading: pass 3/3, pass 2/3, fail 1/3, pass 1/1, fail 0/1
 *   - Path: tenant + player
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;          // keyed by `${building}/${roomId}`
let peopleDocs;          // keyed by tenantId
let articleDocs;         // keyed by articleId
let markerDocs;          // keyed by full path
let lastTenantUpdate;
let lastPeopleUpdate;
let writtenMarkers;
let writtenLedger;       // pointsLedger rows appended via appendPointsLedger

function resetStubs() {
  tenantDocs = {};
  peopleDocs = {};
  articleDocs = {};
  markerDocs = {};
  lastTenantUpdate = null;
  lastPeopleUpdate = null;
  writtenMarkers = [];
  writtenLedger = [];
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

function tenantDocRef(building, roomId) {
  const key = `${building}/${roomId}`;
  return {
    _key: key,
    _kind: 'tenant',
    get: async () => ({ exists: key in tenantDocs, data: () => tenantDocs[key] }),
    collection: (subName) => ({
      doc: (markerId) => {
        const fullKey = `tenants/${building}/list/${roomId}/${subName}/${markerId}`;
        return {
          _key: fullKey,
          _kind: 'marker',
          get: async () => ({ exists: fullKey in markerDocs, data: () => markerDocs[fullKey] }),
        };
      },
    }),
  };
}

function peopleDocRef(tenantId) {
  return {
    _key: tenantId,
    _kind: 'people',
    get: async () => ({ exists: tenantId in peopleDocs, data: () => peopleDocs[tenantId] }),
    collection: (subName) => ({
      doc: (markerId) => {
        const fullKey = `people/${tenantId}/${subName}/${markerId}`;
        return {
          _key: fullKey,
          _kind: 'marker',
          get: async () => ({ exists: fullKey in markerDocs, data: () => markerDocs[fullKey] }),
        };
      },
    }),
  };
}

function articleDocRef(articleId) {
  return {
    _key: articleId,
    _kind: 'article',
    get: async () => ({ exists: articleId in articleDocs, data: () => articleDocs[articleId] }),
  };
}

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'tenants') {
          return {
            doc: (building) => ({
              collection: () => ({
                doc: (roomId) => tenantDocRef(building, roomId),
              }),
            }),
          };
        }
        if (name === 'people') {
          return { doc: (tenantId) => peopleDocRef(tenantId) };
        }
        if (name === 'wellness_articles') {
          return { doc: (articleId) => articleDocRef(articleId) };
        }
        if (name === 'pointsLedger') {
          return { doc: (id) => ({ _kind: 'ledger', _ledgerKey: id }) };
        }
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => {
            if (ref._kind === 'tenant') {
              return { exists: ref._key in tenantDocs, data: () => tenantDocs[ref._key] };
            }
            if (ref._kind === 'people') {
              return { exists: ref._key in peopleDocs, data: () => peopleDocs[ref._key] };
            }
            if (ref._kind === 'marker') {
              return { exists: ref._key in markerDocs, data: () => markerDocs[ref._key] };
            }
            throw new Error('unexpected ref kind: ' + ref._kind);
          },
          set: async (ref, patch) => {
            if (ref._kind === 'ledger') { writtenLedger.push({ key: ref._ledgerKey, patch }); return; }
            if (ref._kind !== 'marker') throw new Error('tx.set should only target marker refs');
            markerDocs[ref._key] = patch;
            writtenMarkers.push({ key: ref._key, patch });
          },
          update: async (ref, patch) => {
            if (ref._kind === 'tenant') lastTenantUpdate = { key: ref._key, patch };
            else if (ref._kind === 'people') lastPeopleUpdate = { key: ref._key, patch };
            else throw new Error('tx.update on unexpected ref kind: ' + ref._kind);
          },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return {
      apps: [{}],
      initializeApp: () => {},
      firestore: firestoreFn,
    };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    }
    return {
      region: () => ({ https: { onCall: (h) => h } }),
      https: { HttpsError },
    };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { claimWellnessQuizPoints: handler } = require('../claimWellnessQuizPoints');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', role = '' } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (role) token.role = role;
  return { auth: { uid, token } };
}

function seedTenant(building, roomId, fields) {
  tenantDocs[`${building}/${roomId}`] = { gamification: {}, ...fields };
}

function seedPlayer(tenantId, fields) {
  peopleDocs[tenantId] = { gamification: {}, ...fields };
}

const SAMPLE_QUIZ_3Q = [
  { q: 'Q1', options: ['a', 'b', 'c'], correctIdx: 0 },
  { q: 'Q2', options: ['a', 'b', 'c'], correctIdx: 1 },
  { q: 'Q3', options: ['a', 'b', 'c'], correctIdx: 2 },
];

const SAMPLE_QUIZ_1Q = [
  { q: 'Q1', options: ['a', 'b'], correctIdx: 0 },
];

function seedArticle(articleId, quiz) {
  articleDocs[articleId] = { quiz };
}

describe('claimWellnessQuizPoints — auth + validation', () => {
  beforeEach(resetStubs);

  it('unauthenticated → unauthenticated', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
        { auth: null },
      ),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('missing articleId → invalid-argument', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', answers: [0, 1, 2] },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'invalid-argument' && /articleId/.test(e.message),
    );
  });

  it('article not found → not-found', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'ghost-article', answers: [0] },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'not-found',
    );
  });

  it('article has no quiz field → invalid-argument', async () => {
    articleDocs['no-quiz-article'] = { title: 'just a body, no quiz' };
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'no-quiz-article', answers: [0] },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'invalid-argument' && /no quiz/.test(e.message),
    );
  });

  it('answers length mismatch → invalid-argument', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1] },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'invalid-argument' && /expected 3 answers/.test(e.message),
    );
  });

  it('claim mismatch (tenant) → permission-denied', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedTenant('rooms', '15', { linkedAuthUid: 'line:Uowner', tenantId: 't-owner' });
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
      ),
      (e) => e.code === 'permission-denied',
    );
  });

  it('unknown building → invalid-argument', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    await assert.rejects(
      () => handler(
        { building: 'amazon', roomId: 'A1', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
        ctx({ room: 'A1', building: 'amazon' }),
      ),
      (e) => e.code === 'invalid-argument' && /unknown building/.test(e.message),
    );
  });
});

describe('claimWellnessQuizPoints — grading + idempotency (tenant path)', () => {
  beforeEach(resetStubs);

  it('pass 3/3 → marker passed:true, +10 pts', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedTenant('rooms', '15', { name: 'Tenant 15', gamification: { points: 50 } });
    const r = await handler(
      { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.success, true);
    assert.equal(r.passed, true);
    assert.equal(r.score, 3);
    assert.equal(r.reward, 10);
    assert.equal(r.pointsAfter, 60);
    assert.equal(writtenMarkers.length, 1);
    assert.equal(writtenMarkers[0].patch.passed, true);
    assert.equal(lastTenantUpdate.patch['gamification.points'], 60);
    // pointsLedger row written in the same tx
    assert.equal(writtenLedger.length, 1);
    assert.equal(writtenLedger[0].patch.source, 'wellness_quiz');
    assert.equal(writtenLedger[0].patch.points, 10);
    assert.equal(writtenLedger[0].patch.balanceAfter, 60);
  });

  it('pass 2/3 → marker passed:true, +10 pts (still passes at threshold)', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedTenant('rooms', '15', { name: 'Tenant 15', gamification: { points: 100 } });
    const r = await handler(
      { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 0] /* Q3 wrong */ },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.score, 2);
    assert.equal(r.reward, 10);
    assert.equal(lastTenantUpdate.patch['gamification.points'], 110);
  });

  it('fail 1/3 → marker passed:false, NO points', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedTenant('rooms', '15', { name: 'Tenant 15', gamification: { points: 100 } });
    const r = await handler(
      { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 0, 0] /* only Q1 right */ },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, false);
    assert.equal(r.score, 1);
    assert.equal(r.reward, 0);
    assert.equal(writtenMarkers[0].patch.passed, false);
    assert.equal(lastTenantUpdate, null, 'no points update should occur on fail');
    assert.equal(writtenLedger.length, 0, 'no ledger row on a failed quiz (reward 0)');
  });

  it('pass 1/1 (100% threshold) → marker passed:true, +10 pts', async () => {
    seedArticle('quick-tip', SAMPLE_QUIZ_1Q);
    seedTenant('rooms', '15', { name: 'Tenant 15', gamification: { points: 0 } });
    const r = await handler(
      { building: 'rooms', roomId: '15', articleId: 'quick-tip', answers: [0] },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.passThreshold, 1);
    assert.equal(r.reward, 10);
  });

  it('fail 0/1 → marker passed:false, NO points', async () => {
    seedArticle('quick-tip', SAMPLE_QUIZ_1Q);
    seedTenant('rooms', '15', { name: 'Tenant 15', gamification: { points: 0 } });
    const r = await handler(
      { building: 'rooms', roomId: '15', articleId: 'quick-tip', answers: [1] /* wrong */ },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, false);
    assert.equal(r.score, 0);
    assert.equal(r.reward, 0);
  });

  it('already-claimed this month → already-exists', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedTenant('rooms', '15', { name: 'Tenant 15' });
    // First claim succeeds
    await handler(
      { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
      ctx({ room: '15', building: 'rooms' }),
    );
    // Second claim in same month → already-exists
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'already-exists',
    );
  });
});

describe('claimWellnessQuizPoints — player path', () => {
  beforeEach(resetStubs);

  it('player passes → marker in people subcoll + points incremented', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedPlayer('t-player', { gamification: { points: 200 } });
    const r = await handler(
      { tenantId: 't-player', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
      ctx({ uid: 'line:Uplayer', role: 'player', tenantId: 't-player' }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.reward, 10);
    assert.equal(r.pointsAfter, 210);
    assert.equal(writtenMarkers[0].key,
      'people/t-player/wellnessQuizPassed/sleep-bedroom_' + writtenMarkers[0].patch.monthKey);
    assert.equal(lastPeopleUpdate.patch['gamification.points'], 210);
    // player ledger row: tenantId only, no building/roomId
    assert.equal(writtenLedger.length, 1);
    assert.equal(writtenLedger[0].patch.tenantId, 't-player');
    assert.equal(writtenLedger[0].patch.building, null);
    assert.equal(writtenLedger[0].patch.points, 10);
  });

  it('player tenantId mismatch → permission-denied', async () => {
    seedArticle('sleep-bedroom', SAMPLE_QUIZ_3Q);
    seedPlayer('t-player', {});
    await assert.rejects(
      () => handler(
        { tenantId: 't-player', articleId: 'sleep-bedroom', answers: [0, 1, 2] },
        ctx({ uid: 'line:Uattacker', role: 'player', tenantId: 't-other' }),
      ),
      (e) => e.code === 'permission-denied',
    );
  });
});
