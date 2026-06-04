/**
 * Storage security rules unit tests.
 *
 * Why this exists: storage.rules has the same "silent catastrophe" risk as
 * firestore.rules — a wrong write rule lets one tenant overwrite another's
 * lease PDF, a wrong read rule leaks vaccine books across rooms after
 * archive. Until 2026-05-27 these were UNTESTED (firestore.rules had 300+
 * cases, storage.rules had 0). This suite covers the highest-risk paths.
 *
 * What it covers (~25 critical paths, NOT exhaustive — focus is on
 * "would-be-disaster" paths):
 *   1. Default deny — random/unknown paths
 *   2. Pets — claim-match (read + write), file type, size, cross-room denial
 *   3. Leases — admin write, tenant claim/SoT read, cross-room denial
 *   4. Booking slips — CF-only write (always denied for clients), owner read
 *   5. Booking KYC — owner upload + Firestore status gate (paid/kyc_pending)
 *   6. Checklists — claim-match + path-integrity gate (instanceId building/room match)
 *   7. Community documents — admin write, public read
 *   8. Marketplace — owner write via Firestore ownerUid cross-check
 *
 * Storage rules cross-reference Firestore via firestore.get() — both
 * emulators MUST be running. Tests seed Firestore docs before storage ops.
 *
 * Runs against Firebase Local Emulator started by:
 *   firebase emulators:exec --only storage,firestore --project=demo-test 'npm run test:storage'
 */

const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getDownloadURL, deleteObject, getBytes } = require('firebase/storage');
const { setDoc, doc } = require('firebase/firestore');
const { readFileSync } = require('node:fs');
const { describe, before, after, beforeEach, it } = require('node:test');

let testEnv;

// Auth contexts ---------------------------------------------------------
const EMAIL_ADMIN = (uid = 'admin-1') => testEnv.authenticatedContext(uid, {
  admin: true,
  firebase: { sign_in_provider: 'password' }
});

// LIFF-linked tenant: custom-token UID + room/building claims
const LIFF_TENANT = (uid = 'line:U001', room = '101', building = 'rooms') =>
  testEnv.authenticatedContext(uid, {
    room, building,
    firebase: { sign_in_provider: 'custom' }
  });

// LIFF prospect (booking flow): role claim, no room/building yet
const PROSPECT = (uid = 'book:U001') =>
  testEnv.authenticatedContext(uid, {
    role: 'prospect',
    firebase: { sign_in_provider: 'custom' }
  });

const UNAUTH = () => testEnv.unauthenticatedContext();

// Test data builders ----------------------------------------------------
// Tiny valid PNG (8x8 transparent) — keeps uploads under any size limit.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
  0x08, 0x06, 0x00, 0x00, 0x00, 0xC4, 0x0F, 0xBE, 0x8B, 0x00, 0x00, 0x00,
  0x0B, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]);

// Oversized payload generator. Storage rule cap is 10 MB; KYC cap is 5 MB.
function oversized(mb) { return new Uint8Array(mb * 1024 * 1024); }

const PNG_META = { contentType: 'image/png' };
const PDF_META = { contentType: 'application/pdf' };
const EXE_META = { contentType: 'application/x-msdownload' };

// Firestore seeders -----------------------------------------------------
async function seedFirestoreDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

async function seedTenant(building = 'rooms', roomId = '101', extra = {}) {
  await seedFirestoreDoc(`tenants/${building}/list/${roomId}`, {
    name: 'Test',
    linkedAuthUid: 'line:U001',
    tenantId: 'TENANT_1',
    building, roomId,
    ...extra,
  });
}

async function seedBooking(bookingId, prospectUid, status = 'pending') {
  await seedFirestoreDoc(`bookings/${bookingId}`, { prospectUid, status });
}

async function seedChecklistInstance(instanceId, building, roomId) {
  await seedFirestoreDoc(`checklistInstances/${instanceId}`, { building, roomId });
}

async function seedMarketplacePost(postId, ownerUid) {
  await seedFirestoreDoc(`marketplace/${postId}`, { ownerUid, status: 'active' });
}

// Lifecycle ------------------------------------------------------------
before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test',
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[0] || 'localhost',
      port: parseInt(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[1] || '9199', 10),
    },
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || 'localhost',
      port: parseInt(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || '8080', 10),
    },
  });
});

after(async () => { if (testEnv) await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
});

// Tests ---------------------------------------------------------------

describe('Default deny', () => {
  it('unauthenticated user cannot upload to random path', async () => {
    const storage = UNAUTH().storage();
    await assertFails(uploadBytes(ref(storage, 'random/not-a-real-path/file.png'), TINY_PNG, PNG_META));
  });

  it('admin cannot upload to random path (catch-all deny)', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertFails(uploadBytes(ref(storage, 'random/not-a-real-path/file.png'), TINY_PNG, PNG_META));
  });
});

describe('Pets — claim-match read/write', () => {
  it('LIFF tenant with matching claim CAN upload pet photo (image, <10MB)', async () => {
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'pets/rooms/101/pet-1/photo.png'), TINY_PNG, PNG_META));
  });

  it('LIFF tenant CANNOT upload to OTHER room (claim mismatch)', async () => {
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'pets/rooms/999/pet-1/photo.png'), TINY_PNG, PNG_META));
  });

  it('LIFF tenant CANNOT upload .exe (wrong contentType)', async () => {
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'pets/rooms/101/pet-1/evil.exe'), TINY_PNG, EXE_META));
  });

  it('LIFF tenant CANNOT upload oversize file (>10MB)', async () => {
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'pets/rooms/101/pet-1/huge.png'), oversized(11), PNG_META));
  });

  it('Admin CAN upload to any pets path', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'pets/rooms/999/pet-x/admin.png'), TINY_PNG, PNG_META));
  });

  it('LIFF tenant CANNOT read other room\'s pet photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage();
      await uploadBytes(ref(storage, 'pets/rooms/999/pet-x/private.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(getBytes(ref(storage, 'pets/rooms/999/pet-x/private.png')));
  });

  it('LIFF tenant CANNOT delete own pet photo (admin-only delete)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage();
      await uploadBytes(ref(storage, 'pets/rooms/101/pet-1/photo.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(deleteObject(ref(storage, 'pets/rooms/101/pet-1/photo.png')));
  });
});

describe('Leases — admin write, tenant claim-match read', () => {
  it('Admin CAN upload lease document', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'leases/rooms/101/lease-1/contract.pdf'), TINY_PNG, PDF_META));
  });

  it('LIFF tenant CANNOT upload lease (admin-only write)', async () => {
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'leases/rooms/101/lease-1/contract.pdf'), TINY_PNG, PDF_META));
  });

  it('LIFF tenant with matching claim CAN read own room lease', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'leases/rooms/101/lease-1/contract.pdf'), TINY_PNG, PDF_META);
    });
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertSucceeds(getBytes(ref(storage, 'leases/rooms/101/lease-1/contract.pdf')));
  });

  it('LIFF tenant CANNOT read OTHER room\'s lease', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'leases/rooms/999/lease-x/contract.pdf'), TINY_PNG, PDF_META);
    });
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(getBytes(ref(storage, 'leases/rooms/999/lease-x/contract.pdf')));
  });

  it('LIFF tenant CAN read own lease via SoT fallback (claim drift)', async () => {
    // Simulate §7-Z/§7-HH: claim says wrong building, but Firestore SoT confirms tenant ownership
    await seedTenant('rooms', '101', { linkedAuthUid: 'line:U001' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'leases/rooms/101/lease-1/contract.pdf'), TINY_PNG, PDF_META);
    });
    // Tenant has stale "nest" claim but Firestore tenant doc says line:U001 owns rooms/101
    const storage = LIFF_TENANT('line:U001', '999', 'nest').storage();
    await assertSucceeds(getBytes(ref(storage, 'leases/rooms/101/lease-1/contract.pdf')));
  });
});

describe('Booking slips — CF-only write', () => {
  it('Nobody can write directly (CF-only)', async () => {
    const adminStorage = EMAIL_ADMIN().storage();
    await assertFails(uploadBytes(ref(adminStorage, 'bookings/B-1/slips/slip.png'), TINY_PNG, PNG_META));
  });

  it('Booking owner CAN read their slip', async () => {
    await seedBooking('B-1', 'book:U001', 'paid');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'bookings/B-1/slips/slip.png'), TINY_PNG, PNG_META);
    });
    const storage = PROSPECT('book:U001').storage();
    await assertSucceeds(getBytes(ref(storage, 'bookings/B-1/slips/slip.png')));
  });

  it('Random user CANNOT read someone else\'s slip', async () => {
    await seedBooking('B-1', 'book:U001', 'paid');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'bookings/B-1/slips/slip.png'), TINY_PNG, PNG_META);
    });
    const storage = PROSPECT('book:U-OTHER').storage();
    await assertFails(getBytes(ref(storage, 'bookings/B-1/slips/slip.png')));
  });
});

describe('Booking KYC — owner upload with status gate', () => {
  it('Owner CAN upload KYC when booking.status == paid', async () => {
    await seedBooking('B-1', 'book:U001', 'paid');
    const storage = PROSPECT('book:U001').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'bookings/B-1/kyc/id.pdf'), TINY_PNG, PDF_META));
  });

  it('Owner CAN upload KYC when booking.status == kyc_pending', async () => {
    await seedBooking('B-1', 'book:U001', 'kyc_pending');
    const storage = PROSPECT('book:U001').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'bookings/B-1/kyc/id.pdf'), TINY_PNG, PDF_META));
  });

  it('Owner CANNOT upload KYC when booking.status == pending', async () => {
    await seedBooking('B-1', 'book:U001', 'pending');
    const storage = PROSPECT('book:U001').storage();
    await assertFails(uploadBytes(ref(storage, 'bookings/B-1/kyc/id.pdf'), TINY_PNG, PDF_META));
  });

  it('Non-owner CANNOT upload KYC even when paid', async () => {
    await seedBooking('B-1', 'book:U001', 'paid');
    const storage = PROSPECT('book:U-OTHER').storage();
    await assertFails(uploadBytes(ref(storage, 'bookings/B-1/kyc/id.pdf'), TINY_PNG, PDF_META));
  });

  it('KYC upload >5MB rejected even when paid', async () => {
    await seedBooking('B-1', 'book:U001', 'paid');
    const storage = PROSPECT('book:U001').storage();
    await assertFails(uploadBytes(ref(storage, 'bookings/B-1/kyc/big.pdf'), oversized(6), PDF_META));
  });
});

describe('Checklists — path-integrity gate', () => {
  it('Tenant CAN upload to own instance when path matches Firestore building+roomId', async () => {
    await seedChecklistInstance('inst-1', 'rooms', '101');
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'checklists/rooms/101/inst-1/photo.png'), TINY_PNG, PNG_META));
  });

  it('Tenant CANNOT upload when path roomId mismatches Firestore instance', async () => {
    // Instance is for room 999 but path claims room 101 — path-integrity gate must block
    await seedChecklistInstance('inst-X', 'rooms', '999');
    const storage = LIFF_TENANT('line:U001', '101', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'checklists/rooms/101/inst-X/forge.png'), TINY_PNG, PNG_META));
  });

  it('Tenant CANNOT upload with mismatched claim', async () => {
    await seedChecklistInstance('inst-1', 'rooms', '101');
    const storage = LIFF_TENANT('line:U001', '999', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'checklists/rooms/101/inst-1/forge.png'), TINY_PNG, PNG_META));
  });

  it('Admin CAN read any checklist photo', async () => {
    await seedChecklistInstance('inst-1', 'rooms', '101');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'checklists/rooms/101/inst-1/photo.png'), TINY_PNG, PNG_META);
    });
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(getBytes(ref(storage, 'checklists/rooms/101/inst-1/photo.png')));
  });
});

describe('Community Documents — public read, admin write', () => {
  it('Any signed-in tenant CAN read community documents', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'communityDocuments/rules/file.pdf'), TINY_PNG, PDF_META);
    });
    const storage = LIFF_TENANT().storage();
    await assertSucceeds(getBytes(ref(storage, 'communityDocuments/rules/file.pdf')));
  });

  it('Unauthenticated user CANNOT read community documents', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'communityDocuments/rules/file.pdf'), TINY_PNG, PDF_META);
    });
    const storage = UNAUTH().storage();
    await assertFails(getBytes(ref(storage, 'communityDocuments/rules/file.pdf')));
  });

  it('Admin CAN upload community document', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'communityDocuments/rules/new.pdf'), TINY_PNG, PDF_META));
  });

  it('Tenant CANNOT upload community document', async () => {
    const storage = LIFF_TENANT().storage();
    await assertFails(uploadBytes(ref(storage, 'communityDocuments/rules/forge.pdf'), TINY_PNG, PDF_META));
  });
});

describe('Marketplace — owner write via Firestore cross-check', () => {
  it('Post owner CAN upload listing image', async () => {
    await seedMarketplacePost('post-1', 'line:U001');
    const storage = LIFF_TENANT('line:U001').storage();
    await assertSucceeds(uploadBytes(ref(storage, 'marketplace/post-1/photo.png'), TINY_PNG, PNG_META));
  });

  it('Non-owner CANNOT upload to someone else\'s listing', async () => {
    await seedMarketplacePost('post-1', 'line:U001');
    const storage = LIFF_TENANT('line:U-OTHER').storage();
    await assertFails(uploadBytes(ref(storage, 'marketplace/post-1/forge.png'), TINY_PNG, PNG_META));
  });

  it('Any signed-in user CAN read marketplace images', async () => {
    await seedMarketplacePost('post-1', 'line:U001');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'marketplace/post-1/photo.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U-VIEWER').storage();
    await assertSucceeds(getBytes(ref(storage, 'marketplace/post-1/photo.png')));
  });

  it('Owner CAN delete own listing image', async () => {
    await seedMarketplacePost('post-1', 'line:U001');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'marketplace/post-1/photo.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U001').storage();
    await assertSucceeds(deleteObject(ref(storage, 'marketplace/post-1/photo.png')));
  });

  it('Non-owner CANNOT delete', async () => {
    await seedMarketplacePost('post-1', 'line:U001');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'marketplace/post-1/photo.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U-OTHER').storage();
    await assertFails(deleteObject(ref(storage, 'marketplace/post-1/photo.png')));
  });

  it('Upload to non-existent marketplace post is denied', async () => {
    // Doc must exist FIRST per rule contract (addDoc → upload)
    const storage = LIFF_TENANT('line:U001').storage();
    await assertFails(uploadBytes(ref(storage, 'marketplace/no-such-post/photo.png'), TINY_PNG, PNG_META));
  });
});

describe('Deposits — admin-only settlement evidence (Slice C)', () => {
  it('Admin CAN upload a damage photo (image, <10MB)', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'deposits/rooms/15/damage_1.png'), TINY_PNG, PNG_META));
  });

  it('Admin CAN upload a refund slip (PDF)', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertSucceeds(uploadBytes(ref(storage, 'deposits/rooms/15/slip_1.pdf'), TINY_PNG, PDF_META));
  });

  it('LIFF tenant CANNOT upload deposit evidence (admin-only write)', async () => {
    const storage = LIFF_TENANT('line:U001', '15', 'rooms').storage();
    await assertFails(uploadBytes(ref(storage, 'deposits/rooms/15/damage_x.png'), TINY_PNG, PNG_META));
  });

  it('LIFF tenant CANNOT read deposit evidence (admin-only read — dispute photos)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'deposits/rooms/15/damage_1.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U001', '15', 'rooms').storage();
    await assertFails(getBytes(ref(storage, 'deposits/rooms/15/damage_1.png')));
  });

  it('Admin CANNOT upload oversize file (>10MB)', async () => {
    const storage = EMAIL_ADMIN().storage();
    await assertFails(uploadBytes(ref(storage, 'deposits/rooms/15/huge.png'), oversized(11), PNG_META));
  });

  it('LIFF tenant CANNOT delete deposit evidence (admin-only delete)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), 'deposits/rooms/15/damage_1.png'), TINY_PNG, PNG_META);
    });
    const storage = LIFF_TENANT('line:U001', '15', 'rooms').storage();
    await assertFails(deleteObject(ref(storage, 'deposits/rooms/15/damage_1.png')));
  });
});
