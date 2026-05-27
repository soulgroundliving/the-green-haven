// ===== PAYMENT STATUS TRACKING =====
function loadPS(){return JSON.parse(localStorage.getItem('payment_status')||'{}');}
function savePS(ps){localStorage.setItem('payment_status',JSON.stringify(ps));}

function markRoomPaid(d){
  const ps=loadPS();
  const key=`${d.year}_${d.month}`;
  if(!ps[key])ps[key]={};
  ps[key][d.room]={
    status:'paid', amount:d.total, date:new Date().toISOString(),
    receiptNo:d.no, eNew:d.eNew, eOld:d.eOld, wNew:d.wNew, wOld:d.wOld,
    slip:window.slipVerified?{
      amount:window.slipData.amount,
      sender:window.slipData.sender,
      receiver:window.slipData.receiver,
      ref:window.slipData.ref,
      tDate:window.slipData.tDate,
      transferDate:window.slipData.transferDate,  // ISO datetime — for on-time gamification
      dueDate:`${d.year}-${String(d.month).padStart(2,'0')}-05`,  // 5th of billing month
      amountOk:window.slipData.amountOk
    }:null
  };
  savePS(ps);
  renderPaymentStatus();

  // ===== Mirror to Firestore verifiedSlips so PaymentStore picks up + survives cache clear.
  // SlipOK case: CF already wrote at functions/verifySlip.js:248. Our setDoc+merge with the
  // same transactionId is idempotent. Manual case: synthetic deterministic docId
  // `manual_<building>_<room>_<year>_<month>` so re-marking same month overwrites cleanly.
  _mirrorPaymentToVerifiedSlips(d).catch(e =>
    console.warn('[billing] verifiedSlips mirror failed:', e?.message));

  // ===== SYNC BILL STATUS → bills_YYYY (tenant app reads this) =====
  if (typeof BillingSystem !== 'undefined') {
    const yr = parseInt(d.year);
    const bill = BillingSystem.getBillByMonthYear(d.room, d.month, yr);
    if (bill) {
      BillingSystem.updateBillStatus(bill.billId, 'paid', yr);
    }
  }

  // ===== SYNC PAYMENT RECORD → payment_{building}_{room} (tenant history) =====
  try {
    const fbBuilding = (typeof getBuildingInfo === 'function')
      ? getBuildingInfo(window.currentBuilding).firebaseBuilding
      : (window.CONFIG?.getBuildingConfig?.(window.currentBuilding) || 'rooms');
    const phKey = `payment_${fbBuilding}_${d.room}`;
    const history = JSON.parse(localStorage.getItem(phKey) || '[]');
    history.unshift({
      billId: d.no,
      month: d.month,
      year: parseInt(d.year),
      amount: d.total,
      paidAt: new Date().toISOString(),
      method: window.slipVerified ? 'PromptPay' : 'Cash',
      slipOkVerified: !!window.slipVerified
    });
    localStorage.setItem(phKey, JSON.stringify(history));
  } catch(e) { console.warn('payment history sync failed', e); }

  // ===== SAVE BILL TO FIREBASE FOR TENANT APP =====
  saveBillToFirebase(d);
}

// Mirror admin manual paid-mark to Firestore verifiedSlips so PaymentStore subscription
// (Phase 2b SoT) picks it up — survives localStorage cache clear. Idempotent:
//   • SlipOK case: real transactionId; setDoc+merge no-ops if CF already wrote.
//   • Manual case: deterministic synthetic ID; re-marking same month overwrites.
// Doc shape mirrors functions/verifySlip.js:248 so PaymentStore subscription parses uniformly.
async function _mirrorPaymentToVerifiedSlips(d) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) {
    console.warn('[billing] Firebase not ready — skipping verifiedSlips mirror');
    return;
  }
  const fs = window.firebase.firestoreFunctions;
  const db = window.firebase.firestore();
  const isSlipOk = !!(window.slipVerified && window.slipData?.ref);
  const docId = isSlipOk
    ? String(window.slipData.ref)
    : `manual_${d.building}_${d.room}_${d.year}_${d.month}`;
  // Construct timestamp inside the billing month (CE year, 5th @ noon BKK) so PaymentStore
  // subscription's yearBE/month derivation (timestamp.year/month → +543) keys correctly,
  // even when admin marks paid in a different calendar month than the bill belongs to.
  const yearCE = parseInt(d.year) - 543;
  const billingTs = new Date(yearCE, parseInt(d.month) - 1, 5, 12, 0, 0);
  const ref = fs.doc(fs.collection(db, 'verifiedSlips'), docId);
  await fs.setDoc(ref, {
    transactionId: docId,
    building: d.building,
    room: String(d.room),
    amount: d.total,
    expectedAmount: d.total,
    sender: isSlipOk ? window.slipData.sender : '(บันทึกโดย admin)',
    receiver: isSlipOk ? (window.slipData.receiver || '') : '',
    bankCode: isSlipOk ? (window.slipData.bankCode || '') : '',
    date: isSlipOk && window.slipData.tDate ? window.slipData.tDate : billingTs.toISOString(),
    timestamp: billingTs,
    verifiedAt: new Date(),
    verified: true,
    receiptNo: d.no,
    manualEntry: !isSlipOk,
    yearBE: parseInt(d.year),
    month: parseInt(d.month)
  }, { merge: true });
}

async function saveBillToFirebase(d){
  try {
    if (!window.firebaseDatabase || !window.firebaseSet) {
      console.warn('⚠️ Firebase not initialized, skipping bill save');
      return;
    }

    // Create bill object with all necessary data for tenant app
    const billObject = {
      billId: d.no,
      room: d.room,
      building: d.building,
      month: d.month,
      year: d.year,
      status: 'paid',
      billDate: d.dateStr,
      totalCharge: d.total,
      charges: {
        rent: d.rent,
        rentLabel: d.rentLabel,
        electric: {
          cost: d.eCost || 0,
          old: d.eOld || 0,
          new: d.eNew || 0,
          units: d.eUnits || 0,
          rate: d.eRate || 8
        },
        water: {
          cost: d.wCost || 0,
          old: d.wOld || 0,
          new: d.wNew || 0,
          units: d.wUnits || 0,
          rate: d.wRate || 20
        },
        trash: d.trash || 0,
        common: d.other || 0,
        penalty: d.lateFee || 0
      },
      meterReadings: {
        electric: { old: d.eOld || 0, new: d.eNew || 0, units: d.eUnits || 0 },
        water: { old: d.wOld || 0, new: d.wNew || 0, units: d.wUnits || 0 }
      },
      note: d.note || '',
      createdAt: new Date().toISOString(),
      slipVerified: window.slipVerified,
      slipData: window.slipVerified && window.slipData ? {
        amount: window.slipData.amount,
        sender: window.slipData.sender,
        receiver: window.slipData.receiver,
        ref: window.slipData.ref,
        tDate: window.slipData.tDate,
        transferDate: window.slipData.transferDate,  // ISO — actual transfer time
        dueDate: `${d.year}-${String(d.month).padStart(2,'0')}-05`,
        paidOnTime: window.slipData.transferDate
          ? new Date(window.slipData.transferDate) <= new Date(`${d.year}-${String(d.month).padStart(2,'0')}-05T23:59:59`)
          : null
      } : null
    };

    // Save to Firebase: bills/{building}/{roomId}/{billId}
    // Tenant app expects: bills/{building}/{room} as an object with billIds as keys
    const firebaseRef = window.firebaseRef;

    // Determine Firebase building ID. currentBuilding may be a canonical id
    // ('rooms', 'nest', 'test1', …) or a legacy alias ('old', 'new'); the
    // helper normalises both into the canonical id used as the Firestore doc id.
    const fbBuildingId = window.CONFIG.getBuildingConfig(window.currentBuilding);

    // Idempotent path: reuse existing bill's RTDB key for same room/month/year
    // so re-issue (auto then manual click, or admin re-generates) overwrites
    // in-place. Falls back to d.no when no bill exists (first issue, or
    // admin deleted a bill that needs regenerating).
    let targetBillId = d.no;
    const cached = window.BillStore?._cache?.[fbBuildingId]?.[d.room];
    if (cached) {
      const match = Object.entries(cached).find(([, b]) =>
        Number(b.month) === Number(d.month) && String(b.year) === String(d.year)
      );
      if (match) {
        targetBillId = match[0];
        billObject.billId = targetBillId;  // keep field aligned with path
      }
    }

    // Save bill at bills/{building}/{room}/{billId}
    const billsRef = firebaseRef(window.firebaseDatabase, `bills/${fbBuildingId}/${d.room}/${targetBillId}`);
    await window.firebaseSet(billsRef, billObject);
  } catch (error) {
    console.error('❌ Error saving bill to Firebase:', error);
  }
}
