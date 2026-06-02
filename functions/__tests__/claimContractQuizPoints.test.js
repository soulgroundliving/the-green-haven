/**
 * Unit tests for claimContractQuizPoints — server-side trust closes the
 * client-side localStorage gap for the contract quiz.
 *
 * Server grades each answer by KIND:
 *   - 'leaseEndDate' → compared to tenant.lease.endDate
 *   - 'monthlyRent'  → compared to tenant.lease.monthlyRent (digits only)
 *   - 'policy'       → looked up in POLICY_ANSWERS map
 *
 * Coverage: auth, validation, grading (pass 3/3, pass 2/3, fail 1/3, fail 0/3),
 * idempotency, lease-shape resilience (slim vs legacy), normalization.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantDocs;
let markerDocs;
let lastTenantUpdate;
let writtenMarkers;
let writtenLedger;       // pointsLedger rows appended via appendPointsLedger

function resetStubs() {
  tenantDocs = {};
  markerDocs = {};
  lastTenantUpdate = null;
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
          return { doc: () => ({ get: async () => ({ exists: false, data: () => null }) }) };
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
            if (ref._kind !== 'tenant') throw new Error('tx.update should only target tenant refs');
            lastTenantUpdate = { key: ref._key, patch };
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

const { claimContractQuizPoints: handler, _internal } = require('../claimContractQuizPoints');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '' } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  return { auth: { uid, token } };
}

function seedTenant(building, roomId, fields) {
  tenantDocs[`${building}/${roomId}`] = { gamification: {}, ...fields };
}

const SAMPLE_LEASE = {
  endDate: '2026-12-31',
  monthlyRent: 8500,
};

function passingAnswers() {
  return [
    { kind: 'leaseEndDate', userAnswer: '2026-12-31' },
    { kind: 'monthlyRent',  userAnswer: '8,500 บาท' /* digits stripped → 8500 */ },
    { kind: 'policy', q: 'ต้องแจ้งย้ายออกล่วงหน้าอย่างน้อยกี่วัน?', userAnswer: '30 วัน' },
  ];
}

describe('claimContractQuizPoints — auth + validation', () => {
  beforeEach(resetStubs);

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', answers: passingAnswers() },
        { auth: null },
      ),
      (e) => e.code === 'unauthenticated',
    );
  });

  it('missing building → invalid-argument', async () => {
    await assert.rejects(
      () => handler(
        { roomId: '15', answers: passingAnswers() },
        ctx({ room: '15' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });

  it('claim mismatch → permission-denied', async () => {
    seedTenant('rooms', '15', {
      linkedAuthUid: 'line:Uowner',
      tenantId: 't-owner',
      lease: SAMPLE_LEASE,
    });
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', answers: passingAnswers() },
        ctx({ uid: 'line:Uattacker', tenantId: 't-attacker' }),
      ),
      (e) => e.code === 'permission-denied',
    );
  });

  it('unknown building → invalid-argument', async () => {
    await assert.rejects(
      () => handler(
        { building: 'amazon', roomId: 'A1', answers: passingAnswers() },
        ctx({ room: 'A1', building: 'amazon' }),
      ),
      (e) => e.code === 'invalid-argument',
    );
  });
});

describe('claimContractQuizPoints — grading (tenant path)', () => {
  beforeEach(resetStubs);

  it('pass 3/3 → marker passed:true, +20 pts', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: SAMPLE_LEASE,
      gamification: { points: 100 },
    });
    const r = await handler(
      { building: 'rooms', roomId: '15', answers: passingAnswers() },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.score, 3);
    assert.equal(r.reward, 20);
    assert.equal(r.pointsAfter, 120);
    assert.equal(writtenMarkers[0].patch.passed, true);
    assert.equal(lastTenantUpdate.patch['gamification.points'], 120);
    // pointsLedger row written in the same tx
    assert.equal(writtenLedger.length, 1);
    assert.equal(writtenLedger[0].patch.source, 'contract_quiz');
    assert.equal(writtenLedger[0].patch.points, 20);
    assert.equal(writtenLedger[0].patch.balanceAfter, 120);
  });

  it('pass 2/3 (one wrong) → +20 pts', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: SAMPLE_LEASE,
      gamification: { points: 200 },
    });
    const answers = passingAnswers();
    answers[2].userAnswer = '60 วัน'; // policy Q wrong
    const r = await handler(
      { building: 'rooms', roomId: '15', answers },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, true);
    assert.equal(r.score, 2);
    assert.equal(r.reward, 20);
  });

  it('fail 1/3 → marker passed:false, NO pts', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: SAMPLE_LEASE,
      gamification: { points: 100 },
    });
    const answers = passingAnswers();
    answers[1].userAnswer = '9000';   // rent wrong
    answers[2].userAnswer = '60 วัน'; // policy wrong
    const r = await handler(
      { building: 'rooms', roomId: '15', answers },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, false);
    assert.equal(r.score, 1);
    assert.equal(r.reward, 0);
    assert.equal(writtenMarkers[0].patch.passed, false);
    assert.equal(lastTenantUpdate, null);
    assert.equal(writtenLedger.length, 0, 'no ledger row on a failed quiz (reward 0)');
  });

  it('fail 0/3 → marker passed:false', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: SAMPLE_LEASE,
      gamification: {},
    });
    const r = await handler(
      { building: 'rooms', roomId: '15', answers: [
        { kind: 'leaseEndDate', userAnswer: '2027-01-01' },
        { kind: 'monthlyRent',  userAnswer: '9999' },
        { kind: 'policy', q: 'ต้องแจ้งย้ายออกล่วงหน้าอย่างน้อยกี่วัน?', userAnswer: '7 วัน' },
      ] },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.passed, false);
    assert.equal(r.score, 0);
  });

  it('rent normalization — "8,500 บาท" matches 8500 numeric', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: { endDate: '2026-12-31', monthlyRent: 8500 },
      gamification: {},
    });
    const r = await handler(
      { building: 'rooms', roomId: '15', answers: [
        { kind: 'monthlyRent', userAnswer: '8,500 บาท' },
      ] },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.score, 1);
  });

  it('legacy contract shape — reads tenant.contract.endDate as fallback', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      contract: { endDate: '2026-12-31', monthlyRent: 8500 }, // legacy shape
      gamification: {},
    });
    const r = await handler(
      { building: 'rooms', roomId: '15', answers: [
        { kind: 'leaseEndDate', userAnswer: '2026-12-31' },
        { kind: 'monthlyRent', userAnswer: '8500' },
      ] },
      ctx({ room: '15', building: 'rooms' }),
    );
    assert.equal(r.score, 2);
  });

  it('already-claimed this month → already-exists', async () => {
    seedTenant('rooms', '15', {
      name: 'Tenant 15',
      lease: SAMPLE_LEASE,
      gamification: {},
    });
    await handler(
      { building: 'rooms', roomId: '15', answers: passingAnswers() },
      ctx({ room: '15', building: 'rooms' }),
    );
    await assert.rejects(
      () => handler(
        { building: 'rooms', roomId: '15', answers: passingAnswers() },
        ctx({ room: '15', building: 'rooms' }),
      ),
      (e) => e.code === 'already-exists',
    );
  });
});

describe('claimContractQuizPoints — internal helpers', () => {
  it('POLICY_ANSWERS has all 4 canonical questions', () => {
    assert.equal(_internal.POLICY_ANSWERS['ต้องแจ้งย้ายออกล่วงหน้าอย่างน้อยกี่วัน?'], '30 วัน');
    assert.equal(_internal.POLICY_ANSWERS['เงินประกัน (deposit) ปกติกี่เดือน?'], '2 เดือน');
    assert.equal(_internal.POLICY_ANSWERS['ผิดสัญญาก่อนครบกำหนด จะเสียอะไร?'], 'ไม่ได้เงินประกันคืน');
    assert.equal(_internal.POLICY_ANSWERS['ค่าเช่าต้องชำระภายในวันที่เท่าไรของเดือน?'], 'วันที่ 5');
  });

  it('CONTRACT_QUIZ_REWARD is 20', () => {
    assert.equal(_internal.CONTRACT_QUIZ_REWARD, 20);
  });
});
