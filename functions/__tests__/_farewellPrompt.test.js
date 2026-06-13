/**
 * Unit tests for _farewellPrompt.js (Meaning Layer #16-v2, PURE layer).
 * Run: node --test functions/__tests__/_farewellPrompt.test.js
 *
 * The anonymization test (`buildFarewellPromptInput` / `statsToUserContent`
 * carry NO PII) is the LOAD-BEARING PDPA §28 cross-border guard — if it fails,
 * the prompt sent to Claude (US) would leak identifiable tenant data.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  NAME_PLACEHOLDER,
  tenureFromDates,
  buildFarewellPromptInput,
  statsToUserContent,
  renderWithName,
} = require('../_farewellPrompt.js');

const DAY = 86400000;
const MOVE_IN = Date.parse('2024-01-15T00:00:00Z');
const NOW = Date.parse('2026-06-12T00:00:00Z'); // 2y 4m after move-in

// A realistic tenant doc carrying plenty of PII alongside the earned stats.
const TENANT = {
  name: 'สมชาย ใจดี',
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '081-234-5678',
  email: 'somchai@example.com',
  tenantId: 'TID-abc123',
  contractId: 'CON-xyz789',
  linkedAuthUid: 'line:Uffff0000',
  building: 'rooms',
  roomId: '28',
  idCardNumber: '1234567890123',
  lease: { moveInDate: '2024-01-15', startDate: '2024-01-15', endDate: '2026-07-01' },
  gamification: {
    points: 1240,
    badges: [{ id: 'a', emoji: '🏅' }, { id: 'b', emoji: '🌱' }, { id: 'c' }],
    dailyStreak: 17,
    marketplaceStats: { tradesCompleted: 9 },
  },
};

describe('tenureFromDates', () => {
  it('computes years + months as coarse buckets (no raw date)', () => {
    const t = tenureFromDates(MOVE_IN, NOW);
    assert.equal(t.years, 2);
    assert.equal(t.months, 28);
    assert.equal(t.text, '2 ปี 4 เดือน');
  });
  it('handles sub-month tenure', () => {
    const t = tenureFromDates(NOW - 10 * DAY, NOW);
    assert.equal(t.years, 0);
    assert.equal(t.text, 'น้อยกว่า 1 เดือน');
  });
  it('returns an unknown descriptor on bad/missing input', () => {
    assert.equal(tenureFromDates(0, NOW).text, 'ไม่ทราบระยะเวลา');
    assert.equal(tenureFromDates(NOW, NOW - DAY).text, 'ไม่ทราบระยะเวลา'); // now before move-in
  });
});

describe('buildFarewellPromptInput — stats extraction', () => {
  it('extracts the earned stats from the tenant doc', () => {
    const input = buildFarewellPromptInput(TENANT, NOW);
    assert.equal(input.points, 1240);
    assert.equal(input.badgeCount, 3);
    assert.equal(input.dailyStreak, 17);
    assert.equal(input.tradesCompleted, 9);
    assert.equal(input.tenureText, '2 ปี 4 เดือน');
    assert.equal(input.tenureYears, 2);
  });
  it('falls back to lease.startDate when moveInDate is absent', () => {
    const t = { lease: { startDate: '2024-01-15' }, gamification: {} };
    assert.equal(buildFarewellPromptInput(t, NOW).tenureText, '2 ปี 4 เดือน');
  });
  it('clamps negatives / non-numbers to 0 and tolerates an empty doc', () => {
    const t = { gamification: { points: -5, dailyStreak: 'x', marketplaceStats: {} } };
    const input = buildFarewellPromptInput(t, NOW);
    assert.equal(input.points, 0);
    assert.equal(input.dailyStreak, 0);
    assert.equal(input.tradesCompleted, 0);
    assert.equal(input.badgeCount, 0);
    assert.deepEqual(buildFarewellPromptInput(null, NOW).points, 0);
  });
});

describe('PDPA §28 guard — prompt input carries NO PII', () => {
  // Identifying values that MUST NOT appear anywhere in what we send abroad.
  // (Bare stat numbers like a streak of 28 may coincidentally equal a roomId,
  // but an UNLABELLED number carries no identifying power — the invariant is
  // that no IDENTIFIER STRING, contact detail, or DATE crosses the border, and
  // that no number is ever labelled as a room/identifier in the payload.)
  const IDENTIFIERS = [
    TENANT.name, TENANT.firstName, TENANT.lastName, TENANT.phone, TENANT.email,
    TENANT.tenantId, TENANT.contractId, TENANT.linkedAuthUid, TENANT.idCardNumber,
    '2024-01-15', '2026-07-01', 'somchai', 'rooms',
  ];

  it('buildFarewellPromptInput output contains none of the identifiers', () => {
    const input = buildFarewellPromptInput(TENANT, NOW);
    const blob = JSON.stringify(input);
    for (const id of IDENTIFIERS) {
      assert.ok(!blob.includes(id), `prompt input leaked identifier: "${id}" in ${blob}`);
    }
    // Whitelist: ONLY the expected stat keys are present — no identity fields
    // could have slipped through (this is the real guard, stronger than substring).
    assert.deepEqual(
      Object.keys(input).sort(),
      ['badgeCount', 'dailyStreak', 'points', 'tenureMonths', 'tenureText', 'tenureYears', 'tradesCompleted'],
    );
  });

  it('statsToUserContent (the actual model payload) contains none of the identifiers', () => {
    const content = statsToUserContent(buildFarewellPromptInput(TENANT, NOW));
    for (const id of IDENTIFIERS) {
      assert.ok(!content.includes(id), `model payload leaked identifier: "${id}"`);
    }
    // It must instruct the model to use the placeholder, not a real name.
    assert.ok(content.includes(NAME_PLACEHOLDER));
  });

  it('never labels a number as a room/identifier (no re-identification handle)', () => {
    // Even when a stat number coincidentally equals the roomId, the payload
    // must not present it AS a room/house/unit/id — that labelling is what
    // would turn a bare number into a quasi-identifier.
    const t = { ...TENANT, gamification: { ...TENANT.gamification, dailyStreak: 28 } };
    const content = statsToUserContent(buildFarewellPromptInput(t, NOW));
    assert.ok(!/(ห้อง|บ้านเลขที่|ยูนิต|รหัส)\s*[0-9]/i.test(content), content);
    assert.ok(!/\b(room|unit|house|id)\s*[:#]?\s*[0-9]/i.test(content), content);
  });
});

describe('renderWithName — local name templating (after prose returns)', () => {
  it('replaces every placeholder with the real name', () => {
    const out = renderWithName(`ขอบคุณ ${NAME_PLACEHOLDER} ที่อยู่กับเรา ${NAME_PLACEHOLDER}`, 'สมชาย');
    assert.equal(out, 'ขอบคุณ สมชาย ที่อยู่กับเรา สมชาย');
    assert.ok(!out.includes(NAME_PLACEHOLDER));
  });
  it('returns prose unchanged when the model omitted the placeholder', () => {
    assert.equal(renderWithName('ขอบคุณสำหรับทุกช่วงเวลา', 'สมชาย'), 'ขอบคุณสำหรับทุกช่วงเวลา');
  });
  it('falls back to a neutral term when no name is given', () => {
    assert.equal(renderWithName(`สวัสดี ${NAME_PLACEHOLDER}`, ''), 'สวัสดี คุณ');
    assert.equal(renderWithName(`สวัสดี ${NAME_PLACEHOLDER}`, null), 'สวัสดี คุณ');
  });
  it('coerces non-string prose safely', () => {
    assert.equal(renderWithName(null, 'x'), '');
    assert.equal(renderWithName(undefined, 'x'), '');
  });
});
