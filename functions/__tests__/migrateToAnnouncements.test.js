/**
 * Unit tests for tools/migrate-to-announcements.js
 *
 * Tests pure-helper exports + the migrateCollection orchestrator against a
 * stub Firestore. No real Admin SDK. Run via `npm run test:unit`.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAudience,
  buildNoticePayload,
  buildEventPayload,
  migrateCollection,
  BUILDING_ALIASES,
  MIGRATION_SENDER,
} = require('../../tools/migrate-to-announcements.js');

// ── Stub Firestore Timestamp ─────────────────────────────────────────────────
const TimestampCtor = {
  now: () => ({ __ts: 'now', _seconds: 1_700_000_000 }),
  fromMillis: (ms) => ({ __ts: 'fromMillis', _seconds: Math.floor(ms / 1000) }),
};

// ── Stub Firestore db ────────────────────────────────────────────────────────
function makeStubDb(initial = {}) {
  // initial: { 'collectionName': { docId: data } }
  const state = JSON.parse(JSON.stringify(initial));
  const writes = [];

  const collection = (name) => ({
    get: async () => ({
      size: Object.keys(state[name] || {}).length,
      docs: Object.entries(state[name] || {}).map(([id, data]) => ({
        id,
        data: () => data,
      })),
    }),
    doc: (id) => ({
      get: async () => ({
        exists: !!(state[name] && state[name][id]),
        data: () => state[name] && state[name][id],
      }),
      set: async (payload) => {
        if (!state[name]) state[name] = {};
        state[name][id] = payload;
        writes.push({ collection: name, id, payload });
      },
    }),
  });
  return { db: { collection }, writes, state };
}

// ── normalizeAudience ────────────────────────────────────────────────────────
describe('normalizeAudience', () => {
  it('passes through canonical values', () => {
    assert.deepEqual(normalizeAudience('all'),   { audience: 'all',   warning: '' });
    assert.deepEqual(normalizeAudience('rooms'), { audience: 'rooms', warning: '' });
    assert.deepEqual(normalizeAudience('nest'),  { audience: 'nest',  warning: '' });
  });

  it('aliases old → rooms, new → nest, RentRoom → rooms', () => {
    assert.equal(normalizeAudience('old').audience, 'rooms');
    assert.equal(normalizeAudience('new').audience, 'nest');
    assert.equal(normalizeAudience('RentRoom').audience, 'rooms');
  });

  it('falls back to all with warning on unknown value', () => {
    const out = normalizeAudience('amazon');
    assert.equal(out.audience, 'all');
    assert.match(out.warning, /unknown building/);
  });

  it('falls back to all silently on null/empty', () => {
    assert.deepEqual(normalizeAudience(null), { audience: 'all', warning: '' });
    assert.deepEqual(normalizeAudience(''),   { audience: 'all', warning: '' });
    assert.deepEqual(normalizeAudience(undefined), { audience: 'all', warning: '' });
  });
});

// ── buildNoticePayload ───────────────────────────────────────────────────────
describe('buildNoticePayload', () => {
  it('preserves CF-written broadcastMessage fields', () => {
    const legacy = {
      title: 'แจ้งซ่อมประปา',
      body: 'ปิดน้ำ 13:00-15:00',
      audience: 'rooms',
      sender: { uid: 'admin-1', email: 'admin@x.com' },
      sentAt: { _seconds: 1_690_000_000 },
      status: 'published',
    };
    const { payload, warnings } = buildNoticePayload(legacy, TimestampCtor);
    assert.equal(payload.type, 'notice');
    assert.equal(payload.title, 'แจ้งซ่อมประปา');
    assert.equal(payload.body, 'ปิดน้ำ 13:00-15:00');
    assert.equal(payload.audience, 'rooms');
    assert.deepEqual(payload.sender, legacy.sender);
    assert.equal(payload.sentAt, legacy.sentAt);
    assert.equal(payload.status, 'published');
    assert.equal(payload.migratedAt.__ts, 'now');
    assert.deepEqual(warnings, []);
  });

  it('synthesizes sender + warns when sentAt missing', () => {
    const { payload, warnings } = buildNoticePayload({ title: 't', body: 'b', audience: 'all' }, TimestampCtor);
    assert.deepEqual(payload.sender, MIGRATION_SENDER);
    assert.equal(payload.sentAt, null);
    assert.equal(payload.status, 'published');
    assert.match(warnings.join(' '), /sentAt missing/);
  });

  it('audiences fallback also warns', () => {
    const { warnings } = buildNoticePayload({ title: 't', body: 'b', audience: 'spaceship' }, TimestampCtor);
    assert.match(warnings.join(' '), /audience.*unknown building/);
  });
});

// ── buildEventPayload ────────────────────────────────────────────────────────
describe('buildEventPayload', () => {
  it('maps legacy event fields to C4 shape', () => {
    const legacy = {
      title: 'งานสงกรานต์',
      description: 'รดน้ำดำหัวที่ลานกลาง',
      building: 'all',
      date: '2026-04-13',
      time: '17:00',
      location: 'ลานกลาง',
      createdDate: '2026-03-01T10:00:00Z',
    };
    const { payload, warnings } = buildEventPayload(legacy, TimestampCtor);
    assert.equal(payload.type, 'event');
    assert.equal(payload.title, 'งานสงกรานต์');
    assert.equal(payload.body, 'รดน้ำดำหัวที่ลานกลาง');
    assert.equal(payload.audience, 'all');
    assert.deepEqual(payload.sender, MIGRATION_SENDER);
    assert.equal(payload.location, 'ลานกลาง');
    assert.equal(payload.status, 'published');
    assert.ok(payload.eventDate, 'eventDate set');
    assert.equal(payload.eventDate.__ts, 'fromMillis');
    assert.ok(payload.sentAt, 'sentAt set from createdDate');
    assert.equal(payload.migratedAt.__ts, 'now');
    assert.deepEqual(warnings, []);
  });

  it('falls back to title when description missing', () => {
    const { payload } = buildEventPayload(
      { title: 'X', date: '2026-04-13', time: '10:00', building: 'rooms' },
      TimestampCtor
    );
    assert.equal(payload.body, 'X');
  });

  it('aliases building old/new', () => {
    assert.equal(
      buildEventPayload({ title: 'a', date: '2026-04-13', time: '10:00', building: 'old' }, TimestampCtor)
        .payload.audience,
      'rooms'
    );
    assert.equal(
      buildEventPayload({ title: 'a', date: '2026-04-13', time: '10:00', building: 'new' }, TimestampCtor)
        .payload.audience,
      'nest'
    );
  });

  it('warns + skips eventDate when date is malformed', () => {
    const { payload, warnings } = buildEventPayload(
      { title: 'a', date: 'not-a-date', time: '10:00', building: 'all' },
      TimestampCtor
    );
    assert.equal(payload.eventDate, null);
    assert.match(warnings.join(' '), /eventDate parse failed/);
  });

  it('warns when date missing entirely', () => {
    const { payload, warnings } = buildEventPayload(
      { title: 'a', building: 'all' },
      TimestampCtor
    );
    assert.equal(payload.eventDate, null);
    assert.match(warnings.join(' '), /no date field/);
  });

  it('handles missing time (defaults to 00:00)', () => {
    const { payload } = buildEventPayload(
      { title: 'a', date: '2026-04-13', building: 'all' },
      TimestampCtor
    );
    assert.ok(payload.eventDate);
    assert.equal(payload.eventDate.__ts, 'fromMillis');
  });

  it('sentAt falls back to eventDate when createdDate missing', () => {
    const { payload } = buildEventPayload(
      { title: 'a', date: '2026-04-13', time: '10:00', building: 'all' },
      TimestampCtor
    );
    assert.equal(payload.sentAt, payload.eventDate);
  });
});

// ── migrateCollection (orchestrator) ─────────────────────────────────────────
describe('migrateCollection', () => {
  it('skips docs already migrated (idempotent)', async () => {
    const { db, writes } = makeStubDb({
      broadcastMessages: {
        b1: { title: 'a', body: 'b', audience: 'all', sender: {}, sentAt: {} },
      },
      announcements: {
        b1: { type: 'notice', title: 'a', migratedAt: { _seconds: 1 } },
      },
    });
    const result = await migrateCollection({
      legacyCollection: 'broadcastMessages',
      buildPayload: buildNoticePayload,
      db, TimestampCtor, dryRun: false,
    });
    assert.equal(result.alreadyMigrated, 1);
    assert.equal(result.toMigrate, 0);
    assert.equal(result.written, 0);
    assert.equal(writes.length, 0);
  });

  it('writes new payload when target absent', async () => {
    const { db, writes } = makeStubDb({
      broadcastMessages: {
        b2: { title: 'a', body: 'b', audience: 'rooms', sender: {}, sentAt: {} },
      },
    });
    const result = await migrateCollection({
      legacyCollection: 'broadcastMessages',
      buildPayload: buildNoticePayload,
      db, TimestampCtor, dryRun: false,
    });
    assert.equal(result.toMigrate, 1);
    assert.equal(result.written, 1);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].collection, 'announcements');
    assert.equal(writes[0].id, 'b2');
    assert.equal(writes[0].payload.type, 'notice');
    assert.equal(writes[0].payload.audience, 'rooms');
    assert.equal(writes[0].payload.migratedAt.__ts, 'now');
  });

  it('dry-run does not call set()', async () => {
    const { db, writes } = makeStubDb({
      communityEvents: {
        e1: { title: 't', date: '2026-04-13', time: '10:00', location: 'X', description: 'D', building: 'rooms' },
      },
    });
    const result = await migrateCollection({
      legacyCollection: 'communityEvents',
      buildPayload: buildEventPayload,
      db, TimestampCtor, dryRun: true,
    });
    assert.equal(result.toMigrate, 1);
    assert.equal(result.written, 0);
    assert.equal(writes.length, 0);
  });

  it('preserves doc ID across collections', async () => {
    const { db, writes } = makeStubDb({
      communityEvents: {
        evt_abc123: { title: 't', date: '2026-04-13', time: '10:00', building: 'all' },
      },
    });
    await migrateCollection({
      legacyCollection: 'communityEvents',
      buildPayload: buildEventPayload,
      db, TimestampCtor, dryRun: false,
    });
    assert.equal(writes[0].id, 'evt_abc123');
  });

  it('collects warnings for unknown audience', async () => {
    const { db } = makeStubDb({
      communityEvents: {
        e1: { title: 't', date: '2026-04-13', time: '10:00', building: 'martian' },
      },
    });
    const result = await migrateCollection({
      legacyCollection: 'communityEvents',
      buildPayload: buildEventPayload,
      db, TimestampCtor, dryRun: true,
    });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0].warnings.join(' '), /unknown building/);
  });

  it('empty legacy collection produces zero writes + no errors', async () => {
    const { db, writes } = makeStubDb({});
    const result = await migrateCollection({
      legacyCollection: 'broadcastMessages',
      buildPayload: buildNoticePayload,
      db, TimestampCtor, dryRun: false,
    });
    assert.equal(result.legacySize, 0);
    assert.equal(result.toMigrate, 0);
    assert.equal(result.written, 0);
    assert.equal(writes.length, 0);
  });
});
