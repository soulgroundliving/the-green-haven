/**
 * Gapless running INVOICE number — Core Readiness Roadmap 1.2 (sibling of
 * _receiptCounter.js, which mints the RECEIPT side).
 *
 * Collection: counters/invoice_{building}_{BE}   { seq, docType, building, be, updatedAt }
 * Format:     INV-{building}-{BE}-{NNNNN}   (5-digit zero-pad, per-building, per-BE-year)
 * Rule:       read: admin · write: false (CF / Admin-SDK only).
 *
 * WHY this exists: สรรพากร requires a sequential, gapless, persistent invoice
 * number (เลขที่ใบแจ้งหนี้). The old schemes (INV-{initial}{room}-{YYMM} in
 * _billFlex, TGH-{yr}{mo}-{room}-{MMSS} in dashboard-bill) were per-render,
 * collision-prone (same room twice in one minute = identical number), and
 * non-sequential. This is the single counter of record.
 *
 * GAPLESS CONTRACT — the number MUST be assigned inside the SAME Firestore
 * transaction as the invoice-record write (invoices/{key} create). A re-notify
 * or failed write then never consumes a number (the whole tx rolls back, or the
 * deterministic-key dedup returns the existing number), so the sequence has no
 * unexplained gaps. assignInvoiceNo() therefore takes the caller's live `tx`
 * rather than running its own transaction.
 *
 * Firestore "all reads before writes" rule: the caller must perform ALL of its
 * own tx.get() reads (e.g. the invoices/{key} dedup read) BEFORE calling
 * assignInvoiceNo(), which does the final read (the counter) followed by the
 * first write. Do not issue any tx.get() after this call.
 *
 * Sibling, not generalized: the receipt counter is on the verifySlip money-flow
 * path; duplicating ~3 hardcoded strings here keeps that path untouched (minimal
 * blast radius) at no real DRY cost.
 */
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const SEQ_PAD = 5;

// Firestore doc-id segment safety (mirrors _receiptCounter._safeBuilding).
function _safeBuilding(b) {
  return String(b == null || b === '' ? 'rooms' : b).replace(/[\/.#$\[\]]/g, '_');
}

/**
 * Render the display string for a (building, BE, seq) triple. Pure — no I/O.
 * Exposed so readers/tests can format without touching the counter.
 */
function formatInvoiceNo(building, be, seq) {
  return `INV-${_safeBuilding(building)}-${be}-${String(seq).padStart(SEQ_PAD, '0')}`;
}

/**
 * Assign the next gapless invoice number INSIDE the caller's transaction.
 *
 * @param {FirebaseFirestore.Transaction} tx — the caller's live transaction.
 *   Must have done all its other reads already (see "all reads before writes").
 * @param {FirebaseFirestore.Firestore} db — admin.firestore() instance.
 * @param {{ building: string, be: number }} ctx — building id + Buddhist-Era year.
 * @returns {Promise<{ seq: number, invoiceNo: string, counterRef: DocumentReference }>}
 */
async function assignInvoiceNo(tx, db, { building, be }) {
  if (!tx || typeof tx.get !== 'function' || typeof tx.set !== 'function') {
    throw new Error('assignInvoiceNo: tx must be a Firestore transaction');
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('assignInvoiceNo: db must be an admin Firestore instance');
  }
  const beNum = Number(be);
  if (!Number.isInteger(beNum) || beNum < 2400 || beNum > 3000) {
    throw new Error(`assignInvoiceNo: invalid BE year '${be}'`);
  }

  const safeBuilding = _safeBuilding(building);
  const counterRef = db.collection('counters').doc(`invoice_${safeBuilding}_${beNum}`);

  // LAST read in the tx — the caller's other reads (invoice dedup) ran before this.
  const snap = await tx.get(counterRef);
  const current = (snap.exists && Number(snap.data().seq)) || 0;
  const seq = current + 1;

  // First write in the tx — merge so the doc is created on the first invoice of
  // the year and incremented thereafter.
  tx.set(counterRef, {
    seq,
    docType: 'invoice',
    building: safeBuilding,
    be: beNum,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { seq, invoiceNo: formatInvoiceNo(safeBuilding, beNum, seq), counterRef };
}

module.exports = { assignInvoiceNo, formatInvoiceNo };
