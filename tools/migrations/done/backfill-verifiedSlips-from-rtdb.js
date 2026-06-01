// One-shot historical recovery: backfill Firestore verifiedSlips from RTDB bills.
//
// Why: before commit e8b80d6, admin manual paid-marks persisted ONLY to
//   localStorage + RTDB bills/{building}/{room}/{billId}.status='paid'.
//   Cache clear wiped localStorage; renderPaymentStatus → PaymentStore.listForMonth()
//   reads only Firestore verifiedSlips (+ legacy localStorage) so historical paid
//   statuses disappeared from the UI even though the bills survived in RTDB.
//
// What: scan RTDB bills/* for status='paid' → mirror to Firestore verifiedSlips
//   using the same deterministic docId scheme as _mirrorPaymentToVerifiedSlips
//   (`manual_<building>_<room>_<year>_<month>`). Skips if doc already exists, so
//   the script is safe to re-run.
//
// How to run:
//   1. Open https://the-green-haven.vercel.app/dashboard.html (logged in as admin)
//   2. Open DevTools console (F12 → Console)
//   3. Paste the contents of this file and press Enter
//   4. Watch the summary at the end
//
// Idempotent. Safe to run multiple times. Toggle DRY_RUN to scan-only mode first.

(async () => {
  const DRY_RUN = false;  // ← set to true to scan without writing anything

  console.log('🔄 Backfilling Firestore verifiedSlips from RTDB bills (DRY_RUN=' + DRY_RUN + ')...');

  // Sanity checks — must run on dashboard logged in as admin
  if (!window.firebase || !window.firebaseDatabase || !window.firebaseGet || !window.firebaseRef) {
    console.error('❌ Firebase not loaded. Open dashboard.html logged in as admin and retry.');
    return;
  }
  if (!window.firebaseAuth?.currentUser) {
    console.error('❌ Not signed in. Log in as admin and retry.');
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();

  // Read entire bills tree from RTDB
  let billsRoot;
  try {
    const snap = await window.firebaseGet(window.firebaseRef(window.firebaseDatabase, 'bills'));
    billsRoot = snap.val() || {};
  } catch (e) {
    console.error('❌ Failed to read RTDB bills:', e.message);
    return;
  }

  const summary = { scanned: 0, paid: 0, written: 0, skipped_existing: 0, skipped_invalid: 0, errors: 0 };
  const writtenIds = [];
  const errorDetails = [];

  for (const building of Object.keys(billsRoot)) {
    const rooms = billsRoot[building] || {};
    for (const room of Object.keys(rooms)) {
      const bills = rooms[room] || {};
      for (const billId of Object.keys(bills)) {
        summary.scanned++;
        const b = bills[billId];
        if (!b || b.status !== 'paid') continue;
        summary.paid++;

        const year = b.year;
        const month = b.month;
        if (!year || !month) {
          summary.skipped_invalid++;
          console.warn(`⚠️ Skip ${building}/${room}/${billId}: missing year/month`);
          continue;
        }

        const docId = `manual_${building}_${room}_${year}_${month}`;
        const docRef = fs.doc(fs.collection(db, 'verifiedSlips'), docId);

        try {
          const existing = await fs.getDoc(docRef);
          if (existing.exists()) {
            summary.skipped_existing++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`[DRY] would write ${docId} (฿${b.totalCharge || b.total || 0})`);
            summary.written++;
            continue;
          }

          // Timestamp inside billing month (CE) — same scheme as live mirror helper,
          // so PaymentStore subscription keys it under (yearBE, month) correctly.
          const yearCE = parseInt(year) - 543;
          const billingTs = new Date(yearCE, parseInt(month) - 1, 5, 12, 0, 0);
          // Prefer real paidAt timestamp from RTDB if present
          const ts = b.paidAt ? new Date(b.paidAt) : billingTs;

          await fs.setDoc(docRef, {
            transactionId: docId,
            building,
            room: String(room),
            amount: b.totalCharge || b.total || 0,
            expectedAmount: b.totalCharge || b.total || 0,
            sender: '(backfilled from RTDB)',
            receiver: '',
            bankCode: '',
            date: ts.toISOString(),
            timestamp: ts,
            verifiedAt: new Date(),
            verified: true,
            receiptNo: b.billId || billId,
            manualEntry: true,
            backfilled: true,
            backfilledAt: new Date().toISOString(),
            yearBE: parseInt(year),
            month: parseInt(month)
          });
          summary.written++;
          writtenIds.push(docId);
          if (summary.written % 10 === 0) console.log(`  …wrote ${summary.written} so far`);
        } catch (e) {
          summary.errors++;
          errorDetails.push({ docId, msg: e.message });
        }
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 BACKFILL SUMMARY' + (DRY_RUN ? ' (DRY RUN — no writes)' : ''));
  console.log(`   Scanned:           ${summary.scanned} bills`);
  console.log(`   Paid (eligible):   ${summary.paid} bills`);
  console.log(`   Written:           ${summary.written} verifiedSlips docs`);
  console.log(`   Skipped (exists):  ${summary.skipped_existing}`);
  console.log(`   Skipped (no y/m):  ${summary.skipped_invalid}`);
  console.log(`   Errors:            ${summary.errors}`);
  if (errorDetails.length) console.log('   Error details:', errorDetails);
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ Done. Reload the Billing & Payment page to see restored statuses.');
  return summary;
})();
