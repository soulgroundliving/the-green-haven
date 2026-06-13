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

  // ===== Record the paid-mark into Firestore verifiedSlips (PaymentStore SoT) via a CF.
  // SlipOK case: verifySlip already wrote the canonical dedup doc server-side — nothing to do.
  // Manual/cash case: the admin-gated recordManualPayment CF upserts the deterministic
  // `manual_<bld>_<room>_<yearBE>_<m>` doc + a BILL_PAID_MANUAL audit row (verifiedSlips is no
  // longer client-writable — see tasks/todo-verifiedslips-cf-only.md). Non-fatal: a paid-mark
  // UI must never hard-fail on a mirror hiccup.
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

// Record an admin paid-mark into Firestore verifiedSlips (PaymentStore SoT) so the bill grid
// picks it up + it survives a localStorage cache clear. The write now goes through the
// admin-gated recordManualPayment CF (Admin SDK) — verifiedSlips is no longer client-writable.
//   • SlipOK case: verifySlip already wrote the canonical dedup doc → nothing to mirror.
//   • Manual/cash case: the CF upserts the deterministic manual_<bld>_<room>_<yearBE>_<m> doc,
//     server-stamps verifiedBy/ip, and writes a BILL_PAID_MANUAL audit row. The CF's dedup
//     guard refuses to clobber a CF-written SlipOK record.
async function _mirrorPaymentToVerifiedSlips(d) {
  // SlipOK: the canonical verifiedSlips doc already exists (verifySlip CF) — no mirror needed.
  if (window.slipVerified && window.slipData?.ref) return;

  const fb = window.firebase;
  if (!fb?.functions?.httpsCallable) {
    console.warn('[billing] Firebase functions not ready — skipping manual payment record');
    return;
  }
  // Admin-gated CF (SE1). building is canonical (rooms/nest); year is BE 4-digit (CF normalises);
  // the CF stamps the billing-month timestamp + verifiedBy/ip server-side.
  await fb.functions.httpsCallable('recordManualPayment')({
    building: d.building,
    room: String(d.room),
    year: d.year,
    month: d.month,
    amount: d.total,
    mode: 'cash',
    receiptNo: d.no,
  });
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
      // Stamp WHEN the payment was recorded — the live-payment "ชำระวันนี้" count
      // (updatePVStats → paidRoomsToday) buckets by paidAt within today. saveBillToFirebase
      // previously wrote status:'paid' with NO paidAt, so that count stayed 0 even right after
      // marking paid. Prefer the slip's real transfer time when present, else now.
      paidAt: (window.slipVerified && window.slipData && window.slipData.transferDate)
        ? window.slipData.transferDate
        : new Date().toISOString(),
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
