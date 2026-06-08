/**
 * Unit tests for _questEngine — pure quest logic (Meaning Layer #1).
 * No firebase mock needed; every function is pure.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_SELF_DAILY_CAP,
  bkkDateString,
  bkkWeekKey,
  periodKeyFor,
  isWithinWindow,
  resolveState,
  isClaimableState,
  evaluateAutoSignal,
  selfCapCheck,
  isValidCadence,
  isValidVerifyMode,
  isValidAutoSignal,
} = require('../_questEngine');

// A fixed instant: 2026-06-08 is a Monday (BKK). 12:00 UTC = 19:00 BKK.
const MON = new Date('2026-06-08T12:00:00Z');
const WED = new Date('2026-06-10T12:00:00Z');
// 2026-06-07 is a Sunday; at 18:00 UTC it is 01:00 BKK on the 8th (still Mon wk).
const SUN_LATE = new Date('2026-06-07T18:00:00Z');

describe('bkkDateString / bkkWeekKey', () => {
  it('emits BKK calendar date YYYY-MM-DD', () => {
    assert.equal(bkkDateString(MON), '2026-06-08');
    // 2026-06-07T18:00Z → +7h → 2026-06-08 01:00 BKK
    assert.equal(bkkDateString(SUN_LATE), '2026-06-08');
  });

  it('week key is the Monday of the BKK week', () => {
    assert.equal(bkkWeekKey(MON), '2026-06-08');
    assert.equal(bkkWeekKey(WED), '2026-06-08');       // same week → same Monday
    assert.equal(bkkWeekKey(SUN_LATE), '2026-06-08');  // rolls into Mon 8th in BKK
  });

  it('week key for a true Sunday resolves to the prior Monday', () => {
    const trueSun = new Date('2026-06-14T06:00:00Z'); // 13:00 BKK Sun 14th
    assert.equal(bkkDateString(trueSun), '2026-06-14');
    assert.equal(bkkWeekKey(trueSun), '2026-06-08');   // Mon of that week
  });
});

describe('periodKeyFor', () => {
  it('daily → BKK date', () => {
    assert.equal(periodKeyFor({ cadence: 'daily' }, MON), '2026-06-08');
  });
  it('weekly → week Monday', () => {
    assert.equal(periodKeyFor({ cadence: 'weekly' }, WED), '2026-06-08');
  });
  it('once → constant "once"', () => {
    assert.equal(periodKeyFor({ cadence: 'once' }, MON), 'once');
  });
  it('missing cadence defaults to daily', () => {
    assert.equal(periodKeyFor({}, MON), '2026-06-08');
  });
});

describe('isWithinWindow', () => {
  it('true when no dates set', () => {
    assert.equal(isWithinWindow({}, MON), true);
  });
  it('false before startDate', () => {
    assert.equal(isWithinWindow({ startDate: '2026-06-09' }, MON), false);
  });
  it('false after endDate', () => {
    assert.equal(isWithinWindow({ endDate: '2026-06-07' }, MON), false);
  });
  it('true inside the window', () => {
    assert.equal(isWithinWindow({ startDate: '2026-06-01', endDate: '2026-06-30' }, MON), true);
  });
  it('ignores unparseable dates (treated as open)', () => {
    assert.equal(isWithinWindow({ startDate: 'not-a-date' }, MON), true);
  });
});

describe('resolveState', () => {
  const quest = { active: true, cadence: 'daily' };

  it('inactive when active === false', () => {
    assert.equal(resolveState({ active: false }, null, MON), 'inactive');
  });
  it('locked when outside the window', () => {
    assert.equal(resolveState({ active: true, startDate: '2026-06-09' }, null, MON), 'locked');
  });
  it('available with no claim', () => {
    assert.equal(resolveState(quest, null, MON), 'available');
  });
  it('pending when a pending claim exists', () => {
    assert.equal(resolveState(quest, { status: 'pending' }, MON), 'pending');
  });
  it('rejected when admin declined', () => {
    assert.equal(resolveState(quest, { status: 'rejected' }, MON), 'rejected');
  });
  for (const s of ['self', 'auto', 'approved']) {
    it(`claimed when status === ${s}`, () => {
      assert.equal(resolveState(quest, { status: s }, MON), 'claimed');
    });
  }
});

describe('isClaimableState', () => {
  it('available and rejected are claimable', () => {
    assert.equal(isClaimableState('available'), true);
    assert.equal(isClaimableState('rejected'), true);
  });
  it('claimed / pending / locked / inactive are not', () => {
    for (const s of ['claimed', 'pending', 'locked', 'inactive']) {
      assert.equal(isClaimableState(s), false, s);
    }
  });
});

describe('evaluateAutoSignal', () => {
  it('checkin_today — satisfied only when checkedInToday', () => {
    assert.equal(evaluateAutoSignal({ autoSignal: 'checkin_today' }, { checkedInToday: true }).satisfied, true);
    assert.equal(evaluateAutoSignal({ autoSignal: 'checkin_today' }, { checkedInToday: false }).satisfied, false);
    assert.equal(evaluateAutoSignal({ autoSignal: 'checkin_today' }, {}).satisfied, false);
  });

  it('login_streak — default threshold 7', () => {
    assert.equal(evaluateAutoSignal({ autoSignal: 'login_streak' }, { dailyStreak: 7 }).satisfied, true);
    assert.equal(evaluateAutoSignal({ autoSignal: 'login_streak' }, { dailyStreak: 6 }).satisfied, false);
  });
  it('login_streak — custom threshold', () => {
    assert.equal(evaluateAutoSignal({ autoSignal: 'login_streak', autoThreshold: 3 }, { dailyStreak: 3 }).satisfied, true);
    assert.equal(evaluateAutoSignal({ autoSignal: 'login_streak', autoThreshold: 3 }, { dailyStreak: 2 }).satisfied, false);
  });

  it('unknown / removed signal (e.g. energy) → not satisfied', () => {
    // energy_month_saver was cut from v1 — it now falls through to unknown-signal.
    assert.equal(evaluateAutoSignal({ autoSignal: 'energy_month_saver' }, {}).satisfied, false);
  });

  it('unknown signal → not satisfied', () => {
    assert.equal(evaluateAutoSignal({ autoSignal: 'nope' }, {}).satisfied, false);
    assert.equal(evaluateAutoSignal({}, {}).reason, 'unknown-signal');
  });
});

describe('selfCapCheck', () => {
  const today = '2026-06-08';

  it('allows when under the default cap', () => {
    const r = selfCapCheck({ questDay: today, questSelfToday: 5, today, reward: 3 });
    assert.equal(r.allowed, true);
    assert.equal(r.newTotal, 8);
    assert.equal(r.cap, DEFAULT_SELF_DAILY_CAP);
  });

  it('allows exactly at the cap', () => {
    const r = selfCapCheck({ questDay: today, questSelfToday: 7, today, reward: 3 });
    assert.equal(r.allowed, true);
    assert.equal(r.newTotal, 10);
  });

  it('blocks when over the cap', () => {
    const r = selfCapCheck({ questDay: today, questSelfToday: 9, today, reward: 3 });
    assert.equal(r.allowed, false);
    assert.equal(r.newTotal, 12);
  });

  it('resets the running total when the stamped day rolled over', () => {
    const r = selfCapCheck({ questDay: '2026-06-07', questSelfToday: 19, today, reward: 3 });
    assert.equal(r.prior, 0);
    assert.equal(r.newTotal, 3);
    assert.equal(r.allowed, true);
  });

  it('honors a custom cap', () => {
    const r = selfCapCheck({ questDay: today, questSelfToday: 4, today, reward: 3, cap: 5 });
    assert.equal(r.allowed, false); // 7 > 5
    assert.equal(r.cap, 5);
  });
});

describe('validators', () => {
  it('cadence', () => {
    for (const c of ['daily', 'weekly', 'once']) assert.equal(isValidCadence(c), true);
    assert.equal(isValidCadence('hourly'), false);
  });
  it('verifyMode', () => {
    for (const v of ['auto', 'self', 'admin']) assert.equal(isValidVerifyMode(v), true);
    assert.equal(isValidVerifyMode('peer'), false);
  });
  it('autoSignal', () => {
    for (const s of ['checkin_today', 'login_streak']) assert.equal(isValidAutoSignal(s), true);
    assert.equal(isValidAutoSignal('energy_month_saver'), false); // cut from v1
    assert.equal(isValidAutoSignal('telepathy'), false);
  });
});
