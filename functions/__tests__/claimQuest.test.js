/**
 * Unit tests for claimQuest — the tap-to-claim entry point (Meaning Layer #1).
 * Covers all three verifyModes (self / auto / admin), per-period idempotency,
 * the self daily cap, energy auto-signal from meter_data, and the player path.
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { periodKeyFor, bkkDateString } = require('../_questEngine');

let tenantDocs, peopleDocs, questDocs, meterDocs, claimDocs;
let lastUpdate, writtenClaims, writtenLedger;

function resetStubs() {
  tenantDocs = {}; peopleDocs = {}; questDocs = {}; meterDocs = {}; claimDocs = {};
  lastUpdate = null; writtenClaims = []; writtenLedger = [];
}
resetStubs();

const SERVER_TS = '__SERVER_TS__';

const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, parent, ...rest) {
  if (id === 'firebase-admin') {
    const firestoreFn = () => ({
      collection: (name) => {
        if (name === 'quests') return { doc: (qid) => ({ get: async () => ({ exists: qid in questDocs, data: () => questDocs[qid] }) }) };
        if (name === 'meter_data') return { doc: (mid) => ({ get: async () => ({ exists: mid in meterDocs, data: () => meterDocs[mid] }) }) };
        if (name === 'tenants') {
          return { doc: (b) => ({ collection: () => ({ doc: (r) => ({ _kind: 'tenant', _key: `${b}/${r}`, get: async () => ({ exists: `${b}/${r}` in tenantDocs, data: () => tenantDocs[`${b}/${r}`] }) }) }) }) };
        }
        if (name === 'people') return { doc: (tid) => ({ _kind: 'people', _key: tid, get: async () => ({ exists: tid in peopleDocs, data: () => peopleDocs[tid] }) }) };
        if (name === 'questClaims') return { doc: (cid) => ({ _kind: 'claim', _claimId: cid, get: async () => ({ exists: cid in claimDocs, data: () => claimDocs[cid] }) }) };
        if (name === 'pointsLedger') return { doc: (lid) => ({ _kind: 'ledger', _ledgerKey: lid }) };
        throw new Error('unexpected collection: ' + name);
      },
      runTransaction: async (fn) => {
        const tx = {
          get: async (ref) => {
            if (ref._kind === 'claim') return { exists: ref._claimId in claimDocs, data: () => claimDocs[ref._claimId] };
            if (ref._kind === 'people') return { exists: ref._key in peopleDocs, data: () => peopleDocs[ref._key] };
            return { exists: ref._key in tenantDocs, data: () => tenantDocs[ref._key] };
          },
          update: async (ref, patch) => { lastUpdate = { key: ref._key, patch }; },
          set: async (ref, doc) => {
            if (ref._kind === 'ledger') { writtenLedger.push({ key: ref._ledgerKey, doc }); }
            else if (ref._kind === 'claim') { claimDocs[ref._claimId] = doc; writtenClaims.push({ id: ref._claimId, doc }); }
          },
        };
        return fn(tx);
      },
    });
    firestoreFn.FieldValue = { serverTimestamp: () => SERVER_TS };
    return { apps: [{}], initializeApp: () => {}, firestore: firestoreFn };
  }
  if (id === 'firebase-functions/v1') {
    class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
    return { region: () => ({ https: { onCall: (h) => h } }), https: { HttpsError } };
  }
  return _origLoad.call(this, id, parent, ...rest);
};

const { claimQuest: handler } = require('../claimQuest');

function ctx({ uid = 'line:U1', admin = false, room = '', building = '', tenantId = '', role = '' } = {}) {
  const token = { admin, room, building };
  if (tenantId) token.tenantId = tenantId;
  if (role) token.role = role;
  return { auth: { uid, token } };
}

function seedTenant(b, r, gamification = {}, extra = {}) {
  tenantDocs[`${b}/${r}`] = { gamification, tenantId: extra.tenantId, ...extra };
}
function seedQuest(qid, q) { questDocs[qid] = { active: true, cadence: 'daily', ...q }; }

const NOW = new Date();
const TODAY = bkkDateString(NOW);
function claimId(qid, tenantId, quest) { return `${qid}__${tenantId}__${periodKeyFor(quest, NOW)}`; }

describe('claimQuest — self mode', () => {
  beforeEach(resetStubs);

  it('awards immediately, writes ledger + claim + questsToday', async () => {
    seedTenant('rooms', '15', { points: 10 });
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 3, title: 'รดน้ำต้นไม้' });
    const r = await handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' }));
    assert.equal(r.success, true);
    assert.equal(r.status, 'self');
    assert.equal(r.reward, 3);
    assert.equal(r.pointsAfter, 13);
    assert.equal(writtenLedger.length, 1);
    assert.equal(writtenLedger[0].doc.source, 'quest');
    assert.equal(writtenLedger[0].doc.points, 3);
    assert.equal(writtenLedger[0].doc.refId, 'q1');
    assert.equal(writtenClaims.length, 1);
    assert.equal(writtenClaims[0].doc.status, 'self');
    assert.equal(lastUpdate.patch['gamification.points'], 13);
    assert.equal(lastUpdate.patch['gamification.questDay'], TODAY);
    assert.equal(lastUpdate.patch['gamification.questSelfToday'], 3);
    assert.ok(lastUpdate.patch['gamification.questsToday'].q1);
  });

  it('is idempotent for the same period → already-exists', async () => {
    seedTenant('rooms', '15', { points: 10 });
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 3 });
    await handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' }));
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' })),
      (e) => e.code === 'already-exists',
    );
    assert.equal(writtenLedger.length, 1, 'no second award');
  });

  it('blocks when the per-day self cap is exceeded', async () => {
    seedTenant('rooms', '15', { points: 0, questDay: TODAY, questSelfToday: 19 });
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 3 }); // 19+3 = 22 > 20
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' })),
      (e) => e.code === 'resource-exhausted',
    );
  });

  it('re-claims after a rejection (rejected is claimable)', async () => {
    seedTenant('rooms', '15', { points: 5 });
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 2 });
    claimDocs[claimId('q1', 'rooms_15', questDocs.q1)] = { status: 'rejected' };
    const r = await handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' }));
    assert.equal(r.status, 'self');
    assert.equal(r.pointsAfter, 7);
  });
});

describe('claimQuest — auto mode', () => {
  beforeEach(resetStubs);

  it('checkin_today satisfied → awards', async () => {
    seedTenant('rooms', '15', { points: 0, lastDailyClaim: TODAY });
    seedQuest('q2', { verifyMode: 'auto', autoSignal: 'checkin_today', rewardPoints: 5 });
    const r = await handler({ building: 'rooms', roomId: '15', questId: 'q2' }, ctx({ room: '15', building: 'rooms' }));
    assert.equal(r.status, 'auto');
    assert.equal(r.pointsAfter, 5);
  });

  it('checkin_today NOT satisfied → failed-precondition, no award', async () => {
    seedTenant('rooms', '15', { points: 0, lastDailyClaim: '2000-01-01' });
    seedQuest('q2', { verifyMode: 'auto', autoSignal: 'checkin_today', rewardPoints: 5 });
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', questId: 'q2' }, ctx({ room: '15', building: 'rooms' })),
      (e) => e.code === 'failed-precondition',
    );
    assert.equal(writtenLedger.length, 0);
  });

  it('login_streak with custom threshold', async () => {
    seedTenant('rooms', '15', { points: 0, dailyStreak: 7 });
    seedQuest('q3', { verifyMode: 'auto', autoSignal: 'login_streak', autoThreshold: 7, rewardPoints: 10 });
    const r = await handler({ building: 'rooms', roomId: '15', questId: 'q3' }, ctx({ room: '15', building: 'rooms' }));
    assert.equal(r.pointsAfter, 10);
  });

  it('energy_month_saver satisfied from meter_data → awards', async () => {
    seedTenant('nest', '101', { points: 0 });
    seedQuest('q4', { verifyMode: 'auto', autoSignal: 'energy_month_saver', rewardPoints: 10 });
    const ceY = Number(NOW.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric' }));
    const mo = Number(NOW.toLocaleString('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric' }));
    const be2 = (ceY + 543) % 100;
    const pMo = mo === 1 ? 12 : mo - 1;
    const pBe2 = mo === 1 ? (be2 + 99) % 100 : be2;
    meterDocs[`nest_${be2}_${mo}_101`] = { eOld: 100, eNew: 150 };  // 50 units now
    meterDocs[`nest_${pBe2}_${pMo}_101`] = { eOld: 0, eNew: 100 };  // 100 units prev
    const r = await handler({ building: 'nest', roomId: '101', questId: 'q4' }, ctx({ room: '101', building: 'nest' }));
    assert.equal(r.status, 'auto');
    assert.equal(r.pointsAfter, 10);
  });

  it('energy_month_saver with no meter data → failed-precondition', async () => {
    seedTenant('nest', '101', { points: 0 });
    seedQuest('q4', { verifyMode: 'auto', autoSignal: 'energy_month_saver', rewardPoints: 10 });
    await assert.rejects(
      () => handler({ building: 'nest', roomId: '101', questId: 'q4' }, ctx({ room: '101', building: 'nest' })),
      (e) => e.code === 'failed-precondition',
    );
  });
});

describe('claimQuest — admin mode', () => {
  beforeEach(resetStubs);

  it('creates a pending claim with NO award', async () => {
    seedTenant('rooms', '15', { points: 50 });
    seedQuest('q5', { verifyMode: 'admin', rewardPoints: 30, title: 'ช่วยยกของ' });
    const r = await handler({ building: 'rooms', roomId: '15', questId: 'q5', note: 'ช่วยป้าห้อง 8' }, ctx({ room: '15', building: 'rooms' }));
    assert.equal(r.status, 'pending');
    assert.equal(r.reward, 0);
    assert.equal(writtenLedger.length, 0, 'no points awarded yet');
    assert.equal(writtenClaims[0].doc.status, 'pending');
    assert.equal(writtenClaims[0].doc.points, 30, 'claim carries the quest reward for review-time award');
    assert.equal(writtenClaims[0].doc.note, 'ช่วยป้าห้อง 8');
    assert.equal(lastUpdate.patch['gamification.points'], undefined, 'balance untouched');
  });

  it('re-submit while pending → already-exists', async () => {
    seedTenant('rooms', '15', { points: 50 });
    seedQuest('q5', { verifyMode: 'admin', rewardPoints: 30 });
    await handler({ building: 'rooms', roomId: '15', questId: 'q5' }, ctx({ room: '15', building: 'rooms' }));
    await assert.rejects(
      () => handler({ building: 'rooms', roomId: '15', questId: 'q5' }, ctx({ room: '15', building: 'rooms' })),
      (e) => e.code === 'already-exists',
    );
  });
});

describe('claimQuest — guards & player path', () => {
  beforeEach(resetStubs);

  it('unauthenticated → unauthenticated', async () => {
    await assert.rejects(() => handler({ questId: 'q1' }, { auth: null }), (e) => e.code === 'unauthenticated');
  });
  it('missing questId → invalid-argument', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '15' }, ctx({ room: '15', building: 'rooms' })), (e) => e.code === 'invalid-argument');
  });
  it('quest not found → not-found', async () => {
    await assert.rejects(() => handler({ building: 'rooms', roomId: '15', questId: 'nope' }, ctx({ room: '15', building: 'rooms' })), (e) => e.code === 'not-found');
  });
  it('inactive quest → failed-precondition', async () => {
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 3, active: false });
    await assert.rejects(() => handler({ building: 'rooms', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'rooms' })), (e) => e.code === 'failed-precondition');
  });
  it('invalid building → invalid-argument', async () => {
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 3 });
    await assert.rejects(() => handler({ building: 'mars', roomId: '15', questId: 'q1' }, ctx({ room: '15', building: 'mars' })), (e) => e.code === 'invalid-argument');
  });

  it('player path (role=player + tenantId) self-claims on people doc', async () => {
    peopleDocs['p-1'] = { gamification: { points: 4 } };
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 2 });
    const r = await handler({ questId: 'q1', tenantId: 'p-1' }, ctx({ uid: 'line:Up', role: 'player', tenantId: 'p-1' }));
    assert.equal(r.status, 'self');
    assert.equal(r.pointsAfter, 6);
    assert.equal(writtenLedger[0].doc.building, null);
  });

  it('player claiming another account → permission-denied', async () => {
    seedQuest('q1', { verifyMode: 'self', rewardPoints: 2 });
    await assert.rejects(
      () => handler({ questId: 'q1', tenantId: 'p-other' }, ctx({ uid: 'line:Up', role: 'player', tenantId: 'p-1' })),
      (e) => e.code === 'permission-denied',
    );
  });
});
