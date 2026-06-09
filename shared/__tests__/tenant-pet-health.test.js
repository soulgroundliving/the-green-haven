'use strict';

/**
 * Unit tests for shared/tenant-pet-health.js — Meaning Layer #9 pure helpers.
 *
 * Only the pure layer is tested here (healthTypeMeta / validateHealthInput /
 * buildHealthEntry / sortHealthLog). The render + Firestore (repository) paths
 * need DOM + LIFF claims and are verified via a static harness + on real LINE
 * (§7-J / feedback_static_harness_for_authgated_ui).
 *
 * The module is a browser IIFE that, in a node realm (no window/document),
 * exports the pure helpers via module.exports — so a plain require() works.
 *
 * Run: node --test shared/__tests__/tenant-pet-health.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
    HEALTH_TYPES,
    healthTypeMeta,
    validateHealthInput,
    buildHealthEntry,
    sortHealthLog,
} = require('../tenant-pet-health.js');

describe('healthTypeMeta', () => {
    test('resolves each known type to its emoji + label', () => {
        assert.equal(healthTypeMeta('vet').emoji, '🩺');
        assert.equal(healthTypeMeta('vaccine').label, 'วัคซีน');
        assert.equal(healthTypeMeta('weight').key, 'weight');
        assert.equal(healthTypeMeta('med').emoji, '💊');
        assert.equal(healthTypeMeta('note').key, 'note');
    });

    test('every catalog entry has key/emoji/label/color', () => {
        for (const t of HEALTH_TYPES) {
            assert.ok(t.key && t.emoji && t.label && t.color, `incomplete meta: ${JSON.stringify(t)}`);
        }
    });

    for (const bad of [undefined, null, '', 'garbage', 0, {}, 'VET']) {
        test(`unknown ${JSON.stringify(bad)} → 'note' fallback (never throws/undefined)`, () => {
            const m = healthTypeMeta(bad);
            assert.equal(m.key, 'note');
        });
    }
});

describe('validateHealthInput', () => {
    const valid = { type: 'vet', date: '2026-06-10', title: 'ตรวจสุขภาพประจำปี', note: 'ปกติดี', weightKg: 5.2 };

    test('accepts a well-formed entry', () => {
        assert.deepEqual(validateHealthInput(valid), { ok: true });
    });

    test('accepts an empty/absent weight (optional)', () => {
        assert.equal(validateHealthInput({ ...valid, weightKg: '' }).ok, true);
        assert.equal(validateHealthInput({ ...valid, weightKg: null }).ok, true);
        const { weightKg, ...noWeight } = valid;
        assert.equal(validateHealthInput(noWeight).ok, true);
    });

    test('rejects an unknown / missing type', () => {
        assert.equal(validateHealthInput({ ...valid, type: 'surgery' }).ok, false);
        assert.equal(validateHealthInput({ ...valid, type: '' }).ok, false);
    });

    test('rejects a missing / malformed date (must be YYYY-MM-DD)', () => {
        assert.equal(validateHealthInput({ ...valid, date: '' }).ok, false);
        assert.equal(validateHealthInput({ ...valid, date: '10/06/2026' }).ok, false);
        assert.equal(validateHealthInput({ ...valid, date: '2026-6-1' }).ok, false);
    });

    test('rejects an empty / whitespace title', () => {
        assert.equal(validateHealthInput({ ...valid, title: '' }).ok, false);
        assert.equal(validateHealthInput({ ...valid, title: '   ' }).ok, false);
    });

    test('rejects an over-long title (>120) and note (>500)', () => {
        assert.equal(validateHealthInput({ ...valid, title: 'x'.repeat(121) }).ok, false);
        assert.equal(validateHealthInput({ ...valid, title: 'x'.repeat(120) }).ok, true);
        assert.equal(validateHealthInput({ ...valid, note: 'y'.repeat(501) }).ok, false);
        assert.equal(validateHealthInput({ ...valid, note: 'y'.repeat(500) }).ok, true);
    });

    test('rejects a non-positive / out-of-range / non-numeric weight', () => {
        assert.equal(validateHealthInput({ ...valid, weightKg: 0 }).ok, false);
        assert.equal(validateHealthInput({ ...valid, weightKg: -3 }).ok, false);
        assert.equal(validateHealthInput({ ...valid, weightKg: 250 }).ok, false);
        assert.equal(validateHealthInput({ ...valid, weightKg: 'abc' }).ok, false);
    });

    test('returns a Thai error string on failure', () => {
        const r = validateHealthInput({ ...valid, title: '' });
        assert.equal(r.ok, false);
        assert.ok(typeof r.error === 'string' && r.error.length > 0);
    });
});

describe('buildHealthEntry', () => {
    const NOW = 1749513600000; // fixed ms → deterministic id + createdAt

    test('normalises a full input into a persisted entry', () => {
        const e = buildHealthEntry({
            type: 'weight', date: '2026-06-10', title: '  ชั่งน้ำหนัก  ', note: '  4.8 กก.  ',
            weightKg: '4.8', fileURL: 'https://x/y.pdf', filePath: 'pets/rooms/15/p/health_1.pdf', fileName: 'lab.pdf',
        }, NOW);
        assert.equal(e.id, 'ph_' + NOW);
        assert.equal(e.type, 'weight');
        assert.equal(e.date, '2026-06-10');
        assert.equal(e.title, 'ชั่งน้ำหนัก');     // trimmed
        assert.equal(e.note, '4.8 กก.');           // trimmed
        assert.equal(e.weightKg, 4.8);             // coerced to number
        assert.equal(e.fileURL, 'https://x/y.pdf');
        assert.equal(e.fileName, 'lab.pdf');
        assert.equal(e.createdAt, new Date(NOW).toISOString());
    });

    test('weightKg is null when blank; file fields null when absent', () => {
        const e = buildHealthEntry({ type: 'note', date: '2026-06-10', title: 'จด', weightKg: '' }, NOW);
        assert.equal(e.weightKg, null);
        assert.equal(e.fileURL, null);
        assert.equal(e.filePath, null);
        assert.equal(e.fileName, null);
        assert.equal(e.note, '');
    });

    test('an unknown type collapses to the note key (mirrors healthTypeMeta)', () => {
        const e = buildHealthEntry({ type: 'bogus', date: '2026-06-10', title: 'x' }, NOW);
        assert.equal(e.type, 'note');
    });
});

describe('sortHealthLog', () => {
    test('orders newest first by date, tie-broken by createdAt desc', () => {
        const log = [
            { id: 'a', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'b', date: '2026-06-10', createdAt: '2026-06-10T08:00:00.000Z' },
            { id: 'c', date: '2026-06-10', createdAt: '2026-06-10T09:00:00.000Z' },
        ];
        const out = sortHealthLog(log);
        assert.deepEqual(out.map(e => e.id), ['c', 'b', 'a']);
    });

    test('is immutable — does not mutate the input array', () => {
        const log = [{ id: 'a', date: '2026-01-01' }, { id: 'b', date: '2026-06-10' }];
        const before = log.map(e => e.id);
        sortHealthLog(log);
        assert.deepEqual(log.map(e => e.id), before);
    });

    test('non-array input → empty array', () => {
        assert.deepEqual(sortHealthLog(null), []);
        assert.deepEqual(sortHealthLog(undefined), []);
        assert.deepEqual(sortHealthLog('nope'), []);
    });
});
