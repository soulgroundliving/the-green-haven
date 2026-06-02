/**
 * Gapless running RECEIPT number — Core Readiness Roadmap 1.2a.
 *
 * Collection: counters/receipt_{building}_{BE}   { seq, docType, building, be, updatedAt }
 * Format:     RCP-{building}-{BE}-{NNNNN}   (5-digit zero-pad, resets each BE year)
 * Rule:       read: admin · write: false (CF / Admin-SDK only).
 *
 * WHY this exists: สรรพากร requires a sequential, gapless, persistent receipt
 * number (เลขที่ใบเสร็จรับเงิน). The old schemes (RCP-{initial}{room}-{YYMM} in
 * _billFlex, RCP-{room}-{Date.now()} in invoice-receipt-manager) were per-render,
 * collision-prone, and non-sequential. This is the single counter of record.
 *
 * GAPLESS CONTRACT — the number MUST be assigned inside the SAME Firestore
 * transaction as the payment-record write (verifiedSlips create). A duplicate or
 * failed payment then never consumes a number (the whole tx rolls back), so the
 * sequence has no unexplained gaps. assignReceiptNo() therefore takes the caller's
 * live `tx` rather than running its own transaction.
 *
 * Firestore "all reads before writes" rule: the caller must perform ALL of its
 * own tx.get() reads (e.g. the slip-dedup read) BEFORE calling assignReceiptNo(),
 * which does the final read (the counter) followed by the first write. Do not
 * issue any tx.get() after this call.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const SEQ_PAD = 5;

// Firestore doc-id segment safety (mirrors _actionAudit._sanitiseSegment).
function _safeBuilding(b) {
  return String(b == null || b === '' ? 'rooms' : b).replace(/[\/.#$\[\]]/g, '_');
}

/**
 * Render the display string for a (building, BE, seq) triple. Pure — no I/O.
 * Exposed so readers/tests can format without touching the counter.
 */
function formatReceiptNo(building, be, seq) {
  return `RCP-${_safeBuilding(building)}-${be}-${String(seq).padStart(SEQ_PAD, '0')}`;
}

/**
 * Assign the next gapless receipt number INSIDE the caller's transaction.
 *
 * @param {FirebaseFirestore.Transaction} tx — the caller's live transaction.
 *   Must have done all its other reads already (see "all reads before writes").
 * @param {FirebaseFirestore.Firestore} db — admin.firestore() instance.
 * @param {{ building: string, be: number }} ctx — building id + Buddhist-Era year.
 * @returns {Promise<{ seq: number, receiptNo: string, counterRef: DocumentReference }>}
 */
async function assignReceiptNo(tx, db, { building, be }) {
  if (!tx || typeof tx.get !== 'function' || typeof tx.set !== 'function') {
    throw new Error('assignReceiptNo: tx must be a Firestore transaction');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('assignReceiptNo: db must be an admin Firestore instance');
  }
  const beNum = Number(be);
  if (!Number.isInteger(beNum) || beNum < 2400 || beNum > 3000) {
    throw new Error(`assignReceiptNo: invalid BE year '${be}'`);
  }

  const safeBuilding = _safeBuilding(building);
  const counterRef = db.collection('counters').doc(`receipt_${safeBuilding}_${beNum}`);

  // LAST read in the tx — the caller's other reads (slip dedup) ran before this.
  const snap = await tx.get(counterRef);
  const current = (snap.exists && Number(snap.data().seq)) || 0;
  const seq = current + 1;

  // First write in the tx — merge so the doc is created on the first receipt of
  // the year and incremented thereafter.
  tx.set(counterRef, {
    seq,
    docType: 'receipt',
    building: safeBuilding,
    be: beNum,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { seq, receiptNo: formatReceiptNo(safeBuilding, beNum, seq), counterRef };
}

module.exports = { assignReceiptNo, formatReceiptNo };
