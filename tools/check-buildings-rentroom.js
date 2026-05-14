/**
 * Read-only probe: compare buildings/RentRoom vs buildings/rooms in Firestore.
 * Run with: node tools/check-buildings-rentroom.js
 * Auth via Firebase CLI ADC (firebase login already done).
 *
 * Outputs a field-by-field diff and tells you whether buildings/RentRoom
 * can be safely archived (deleted) from Firestore.
 *
 * NEVER MUTATES.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'the-green-haven' });
}

const db = admin.firestore();

const FIELDS_THAT_MATTER = [
  'promptpayNumber', 'companyName', 'ownerName', 'address', 'contact',
  'displayName', 'status', 'internet',
];

function hasValue(v) {
  return v !== undefined && v !== null && v !== '';
}

async function main() {
  const [rentRoomSnap, roomsSnap] = await Promise.all([
    db.doc('buildings/RentRoom').get(),
    db.doc('buildings/rooms').get(),
  ]);

  const rr  = rentRoomSnap.exists ? rentRoomSnap.data() : null;
  const can = roomsSnap.exists    ? roomsSnap.data()    : null;

  console.log('\n══════════════════════════════════════════');
  console.log('  buildings/RentRoom vs buildings/rooms');
  console.log('══════════════════════════════════════════\n');

  if (!rr) {
    console.log('✅  buildings/RentRoom does NOT exist — nothing to clean up.\n');
    process.exit(0);
  }

  console.log(`  buildings/RentRoom   exists:  YES`);
  console.log(`  buildings/rooms      exists:  ${can ? 'YES' : 'NO (not seeded yet!)'}\n`);

  const onlyInRr   = [];
  const diffFields = [];

  for (const field of FIELDS_THAT_MATTER) {
    const rrVal  = getNestedPayment(rr,  field);
    const canVal = can ? getNestedPayment(can, field) : undefined;
    const rrHas  = hasValue(rrVal);
    const canHas = hasValue(canVal);

    if (rrHas && !canHas) {
      onlyInRr.push({ field, value: rrVal });
    } else if (rrHas && canHas && String(rrVal) !== String(canVal)) {
      diffFields.push({ field, rrVal, canVal });
    }
  }

  if (onlyInRr.length === 0 && diffFields.length === 0) {
    console.log('✅  buildings/rooms has all the same data as buildings/RentRoom.');
    console.log('    Safe to delete buildings/RentRoom from Firebase Console.\n');
    console.log('  How to delete:');
    console.log('  1. Firebase Console → Firestore → buildings → RentRoom → ⋮ → Delete document');
    console.log('  2. OR run:  node tools/delete-buildings-rentroom.js  (create if needed)\n');
  } else {
    if (onlyInRr.length > 0) {
      console.log('⚠️   Fields ONLY in buildings/RentRoom (would be lost on delete):');
      for (const { field, value } of onlyInRr) {
        console.log(`    ${field}: ${JSON.stringify(value)}`);
      }
      console.log();
    }
    if (diffFields.length > 0) {
      console.log('⚠️   Fields with DIFFERENT values:');
      for (const { field, rrVal, canVal } of diffFields) {
        console.log(`    ${field}:`);
        console.log(`      RentRoom: ${JSON.stringify(rrVal)}`);
        console.log(`      rooms:    ${JSON.stringify(canVal)}`);
      }
      console.log();
    }
    console.log('  ACTION REQUIRED:');
    console.log('  1. Admin → Dashboard → Buildings → ✏️ แก้ไข rooms');
    console.log('  2. Save the rooms building with the correct values above.');
    console.log('  3. Re-run this script — if output is "✅ Safe", delete buildings/RentRoom.\n');
  }

  // Also list ALL fields in RentRoom so nothing is missed
  console.log('  All fields in buildings/RentRoom:');
  for (const [k, v] of Object.entries(rr)) {
    console.log(`    ${k}: ${JSON.stringify(v)}`);
  }
  console.log();
}

// payment config may be nested under .payment.* or top-level
function getNestedPayment(doc, field) {
  if (doc[field] !== undefined) return doc[field];
  if (doc.payment?.[field] !== undefined) return doc.payment[field];
  return undefined;
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
