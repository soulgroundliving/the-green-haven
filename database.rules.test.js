/**
 * Realtime Database security rules unit tests.
 *
 * Covers the 10 paths in config/database.rules.json:
 *   users, bills, payments, maintenance, housekeeping,
 *   meter_readings, rooms_config, tenants, system, financials, audit_logs
 *
 * What each path guards:
 *   bills / payments / meter_readings — tenant reads own room only, admin write only
 *   maintenance / housekeeping        — tenant reads AND writes own room, admin read all
 *   users                             — own read/write, admin read/write
 *   rooms_config / system             — any auth reads, admin writes
 *   tenants / financials / audit_logs — admin only
 *
 * Run locally:
 *   firebase emulators:exec --only database --project=demo-test 'npm run test:rtdb:rules'
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, get, set, update, remove } = require('firebase/database');
const { readFileSync } = require('node:fs');
const { describe, before, after, beforeEach, it } = require('node:test');

let testEnv;

// ── Auth context factories ────────────────────────────────────────────────────

const ADMIN   = (uid = 'admin-1')    => testEnv.authenticatedContext(uid, { admin: true });
const ACCT    = (uid = 'acct-1')     => testEnv.authenticatedContext(uid, { accountant: true });
const TENANT  = (uid = 'line:U001', room = '15', building = 'rooms') =>
  testEnv.authenticatedContext(uid, { room, building });
const UNAUTH  = ()                   => testEnv.unauthenticatedContext();
const NOROOM  = (uid = 'noroom-1')   => testEnv.authenticatedContext(uid, {});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  const rulesStr = JSON.stringify(
    JSON.parse(readFileSync('config/database.rules.json', 'utf8'))
  );
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    database: {
      rules: rulesStr,
      host: process.env.DATABASE_EMULATOR_HOST?.split(':')[0] || 'localhost',
      port: parseInt(process.env.DATABASE_EMULATOR_HOST?.split(':')[1] || '9000', 10),
    },
  });
});

after(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearDatabase(); });

// ── Seed helper ───────────────────────────────────────────────────────────────

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), path), data);
  });
}

// ── 1. Default deny ───────────────────────────────────────────────────────────

describe('default deny', () => {
  it('unauthenticated cannot read root', async () => {
    await assertFails(get(ref(UNAUTH().database(), '/')));
  });

  it('unauthenticated cannot write root', async () => {
    await assertFails(set(ref(UNAUTH().database(), '/unknown/path'), { v: 1 }));
  });

  it('authenticated without claims cannot read unknown path', async () => {
    await assertFails(get(ref(NOROOM().database(), '/unknown_collection')));
  });
});

// ── 2. users/{uid} ───────────────────────────────────────────────────────────

describe('users/{uid}', () => {
  const PATH = '/users/uid-alice';

  it('owner reads own user doc', async () => {
    await seed(PATH, { email: 'alice@test' });
    await assertSucceeds(get(ref(NOROOM('uid-alice').database(), PATH)));
  });

  it('owner writes own user doc', async () => {
    await assertSucceeds(set(ref(NOROOM('uid-alice').database(), PATH), { email: 'new@test' }));
  });

  it('admin reads any user doc', async () => {
    await seed(PATH, { email: 'alice@test' });
    await assertSucceeds(get(ref(ADMIN().database(), PATH)));
  });

  it('admin writes any user doc', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), PATH), { role: 'admin' }));
  });

  it('user A cannot read user B doc', async () => {
    await seed(PATH, { email: 'alice@test' });
    await assertFails(get(ref(NOROOM('uid-bob').database(), PATH)));
  });

  it('unauthenticated cannot read user doc', async () => {
    await seed(PATH, { email: 'alice@test' });
    await assertFails(get(ref(UNAUTH().database(), PATH)));
  });
});

// ── 3. bills/{building}/{room} ────────────────────────────────────────────────

describe('bills/{building}/{room}', () => {
  const PATH = '/bills/rooms/15/B001';

  it('admin reads bill', async () => {
    await seed(PATH, { billId: 'B001', totalCharge: 500 });
    await assertSucceeds(get(ref(ADMIN().database(), PATH)));
  });

  it('admin writes bill', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), PATH), { billId: 'B001' }));
  });

  it('accountant reads all bills (path-level read)', async () => {
    await seed(PATH, { billId: 'B001' });
    await assertSucceeds(get(ref(ACCT().database(), '/bills')));
  });

  it('tenant reads own room bill', async () => {
    await seed(PATH, { billId: 'B001' });
    await assertSucceeds(get(ref(TENANT().database(), PATH)));
  });

  it('tenant reads all bills in own room', async () => {
    await seed(PATH, { billId: 'B001' });
    await assertSucceeds(get(ref(TENANT().database(), '/bills/rooms/15')));
  });

  it('tenant CANNOT read another room bill', async () => {
    await seed('/bills/rooms/99/B001', { billId: 'B001' });
    await assertFails(get(ref(TENANT().database(), '/bills/rooms/99/B001')));
  });

  it('tenant CANNOT write bill', async () => {
    await assertFails(set(ref(TENANT().database(), PATH), { billId: 'B001' }));
  });

  it('unauthenticated cannot read bill', async () => {
    await seed(PATH, { billId: 'B001' });
    await assertFails(get(ref(UNAUTH().database(), PATH)));
  });
});

// ── 4. payments/{building}/{room} ─────────────────────────────────────────────

describe('payments/{building}/{room}', () => {
  const PATH = '/payments/rooms/15/P001';

  it('admin reads payment', async () => {
    await seed(PATH, { amount: 1000 });
    await assertSucceeds(get(ref(ADMIN().database(), PATH)));
  });

  it('admin writes payment', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), PATH), { amount: 1000 }));
  });

  it('tenant reads own room payment', async () => {
    await seed(PATH, { amount: 1000 });
    await assertSucceeds(get(ref(TENANT().database(), PATH)));
  });

  it('tenant CANNOT read another room payment', async () => {
    await seed('/payments/rooms/99/P001', { amount: 500 });
    await assertFails(get(ref(TENANT().database(), '/payments/rooms/99/P001')));
  });

  it('tenant CANNOT write payment', async () => {
    await assertFails(set(ref(TENANT().database(), PATH), { amount: 9999 }));
  });

  it('unauthenticated cannot read payment', async () => {
    await seed(PATH, { amount: 1000 });
    await assertFails(get(ref(UNAUTH().database(), PATH)));
  });
});

// ── 5. maintenance/{building}/{room} ──────────────────────────────────────────

describe('maintenance/{building}/{room}', () => {
  const PATH = '/maintenance/rooms/15/T001';

  it('admin reads all maintenance (top-level)', async () => {
    await seed(PATH, { category: 'electric' });
    await assertSucceeds(get(ref(ADMIN().database(), '/maintenance')));
  });

  it('admin writes maintenance ticket', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), PATH), { category: 'electric' }));
  });

  it('tenant reads own room ticket', async () => {
    await seed(PATH, { category: 'electric' });
    await assertSucceeds(get(ref(TENANT().database(), PATH)));
  });

  it('tenant writes own room ticket (submit request)', async () => {
    await assertSucceeds(set(ref(TENANT().database(), PATH), { category: 'water', status: 'pending' }));
  });

  it('tenant CANNOT read another room ticket', async () => {
    await seed('/maintenance/rooms/99/T001', { category: 'electric' });
    await assertFails(get(ref(TENANT().database(), '/maintenance/rooms/99/T001')));
  });

  it('unauthenticated cannot read maintenance', async () => {
    await seed(PATH, { category: 'electric' });
    await assertFails(get(ref(UNAUTH().database(), PATH)));
  });
});

// ── 5b. behaviorEvents/{building}/{room} — write-own, admin-read-only (Phase 1a) ──

describe('behaviorEvents/{building}/{room}', () => {
  const PATH = '/behaviorEvents/rooms/15/E001';

  it('tenant writes own room events (flush)', async () => {
    await assertSucceeds(set(ref(TENANT().database(), PATH),
      { events: [{ t: 'pv', p: 'home', ts: 1 }], flushedAt: 2, n: 1 }));
  });

  it('tenant CANNOT write another room events', async () => {
    await assertFails(set(ref(TENANT().database(), '/behaviorEvents/rooms/99/E001'),
      { events: [], flushedAt: 1 }));
  });

  it('tenant CANNOT read its own events (admin-only analytics)', async () => {
    await seed(PATH, { events: [{ t: 'pv' }], flushedAt: 1 });
    await assertFails(get(ref(TENANT().database(), PATH)));
  });

  it('admin reads all behaviorEvents (top-level)', async () => {
    await seed(PATH, { events: [{ t: 'pv' }], flushedAt: 1 });
    await assertSucceeds(get(ref(ADMIN().database(), '/behaviorEvents')));
  });

  it('validate rejects a flush missing required children', async () => {
    await assertFails(set(ref(TENANT().database(), PATH), { foo: 'bar' }));
  });

  it('unauthenticated cannot write behaviorEvents', async () => {
    await assertFails(set(ref(UNAUTH().database(), PATH), { events: [], flushedAt: 1 }));
  });
});

// ── 6. housekeeping/{building}/{room} ─────────────────────────────────────────

describe('housekeeping/{building}/{room}', () => {
  it('admin reads housekeeping', async () => {
    await seed('/housekeeping/rooms/15/H001', { task: 'clean' });
    await assertSucceeds(get(ref(ADMIN().database(), '/housekeeping')));
  });

  it('tenant reads own room housekeeping', async () => {
    await seed('/housekeeping/rooms/15/H001', { task: 'clean' });
    await assertSucceeds(get(ref(TENANT().database(), '/housekeeping/rooms/15/H001')));
  });

  it('tenant writes own room housekeeping', async () => {
    await assertSucceeds(set(ref(TENANT().database(), '/housekeeping/rooms/15/H001'), { task: 'clean' }));
  });

  it('tenant CANNOT access another room housekeeping', async () => {
    await seed('/housekeeping/rooms/99/H001', { task: 'clean' });
    await assertFails(get(ref(TENANT().database(), '/housekeeping/rooms/99/H001')));
  });
});

// ── 7. rooms_config ───────────────────────────────────────────────────────────

describe('rooms_config', () => {
  it('any authenticated user reads rooms_config', async () => {
    await seed('/rooms_config/rooms/15', { rent: 5000 });
    await assertSucceeds(get(ref(TENANT().database(), '/rooms_config/rooms/15')));
  });

  it('admin writes rooms_config', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), '/rooms_config/rooms/15'), { rent: 6000 }));
  });

  it('tenant CANNOT write rooms_config', async () => {
    await assertFails(set(ref(TENANT().database(), '/rooms_config/rooms/15'), { rent: 9999 }));
  });

  it('unauthenticated CANNOT read rooms_config', async () => {
    await seed('/rooms_config/rooms/15', { rent: 5000 });
    await assertFails(get(ref(UNAUTH().database(), '/rooms_config/rooms/15')));
  });
});

// ── 8. system ─────────────────────────────────────────────────────────────────

describe('system', () => {
  it('any authenticated user reads system', async () => {
    await seed('/system/config', { version: '1.0' });
    await assertSucceeds(get(ref(TENANT().database(), '/system/config')));
  });

  it('admin writes system', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), '/system/config'), { version: '2.0' }));
  });

  it('tenant CANNOT write system', async () => {
    await assertFails(set(ref(TENANT().database(), '/system/config'), { version: '99' }));
  });
});

// ── 9. tenants (admin-only) ───────────────────────────────────────────────────

describe('tenants (admin-only)', () => {
  it('admin reads tenants', async () => {
    await seed('/tenants/rooms/15', { name: 'Alice' });
    await assertSucceeds(get(ref(ADMIN().database(), '/tenants/rooms/15')));
  });

  it('admin writes tenants', async () => {
    await assertSucceeds(set(ref(ADMIN().database(), '/tenants/rooms/15'), { name: 'Alice' }));
  });

  it('tenant CANNOT read tenants path', async () => {
    await seed('/tenants/rooms/15', { name: 'Alice' });
    await assertFails(get(ref(TENANT().database(), '/tenants/rooms/15')));
  });

  it('unauthenticated CANNOT read tenants', async () => {
    await seed('/tenants/rooms/15', { name: 'Alice' });
    await assertFails(get(ref(UNAUTH().database(), '/tenants/rooms/15')));
  });
});

// ── 10. financials + audit_logs (admin-only) ─────────────────────────────────

describe('financials + audit_logs (admin-only)', () => {
  it('admin reads financials', async () => {
    await seed('/financials/2025', { total: 100000 });
    await assertSucceeds(get(ref(ADMIN().database(), '/financials/2025')));
  });

  it('tenant CANNOT read financials', async () => {
    await seed('/financials/2025', { total: 100000 });
    await assertFails(get(ref(TENANT().database(), '/financials/2025')));
  });

  it('admin reads audit_logs', async () => {
    await seed('/audit_logs/2025', { event: 'login' });
    await assertSucceeds(get(ref(ADMIN().database(), '/audit_logs/2025')));
  });

  it('tenant CANNOT read audit_logs', async () => {
    await seed('/audit_logs/2025', { event: 'login' });
    await assertFails(get(ref(TENANT().database(), '/audit_logs/2025')));
  });
});
