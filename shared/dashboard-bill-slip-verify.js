// ===== SLIPOK VERIFICATION =====
// ✅ SlipOK API keys are now secured in Firebase Cloud Functions
// Client no longer exposes API credentials - all calls go through secure backend
window.slipVerified = false;
window.slipData = null;

// === RATE LIMITING (Dashboard) ===
const DASHBOARD_RATE_LIMIT_CONFIG = {
  slipVerification: { maxRequests: 3, windowMs: 60000 }, // 3 requests per minute
  billUpload: { maxRequests: 5, windowMs: 3600000 }       // 5 uploads per hour
};
const dashboardRateLimitTracker = {};

function checkDashboardRateLimit(key) {
  const now = Date.now();
  const config = DASHBOARD_RATE_LIMIT_CONFIG[key];
  if (!config) return true;

  if (!dashboardRateLimitTracker[key]) {
    dashboardRateLimitTracker[key] = [];
  }

  // Remove old requests outside the window
  dashboardRateLimitTracker[key] = dashboardRateLimitTracker[key].filter(time => now - time < config.windowMs);

  if (dashboardRateLimitTracker[key].length >= config.maxRequests) {
    return false;
  }

  dashboardRateLimitTracker[key].push(now);
  return true;
}

function validateSlipFileAdmin(file) {
  const errors = [];
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    errors.push(`❌ ไฟล์ใหญ่เกินไป (สูงสุด ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  // Check file type
  if (!ALLOWED_TYPES.includes(file.type)) {
    errors.push('❌ รูปแบบไฟล์ต้องเป็น JPG, PNG หรือ WebP เท่านั้น');
  }

  return errors;
}

function handleSlipDrop(e){
  e.preventDefault();
  document.getElementById('slipDropArea').classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0];
  if(file) verifySlip(file);
}

async function verifySlip(file){
  if(!file) return;

  // Validate file
  const validationErrors = validateSlipFileAdmin(file);
  if (validationErrors.length > 0) {
    const resultEl = document.getElementById('slipResult');
    resultEl.innerHTML = `<div style="color: #d32f2f; padding: 1rem; background: #ffebee; border-radius: 6px;">${validationErrors.join('<br>')}</div>`;
    return;
  }

  const resultEl = document.getElementById('slipResult');
  const dropText = document.getElementById('slipDropText');

  // Show image preview + loading state
  const reader = new FileReader();
  reader.onload = ev => {
    dropText.innerHTML = `\x3cimg src="${ev.target.result}" style="max-height:90px;border-radius:6px;object-fit:contain;margin-bottom:4px;">\x3cbr>\x3csmall style="color:var(--text-muted);">⏳ กำลังตรวจสอบกับ SlipOK...\x3c/small>`;
  };
  reader.readAsDataURL(file);
  resultEl.innerHTML = '';

  try {
    // Check rate limit
    if (!checkDashboardRateLimit('slipVerification')) {
      throw new Error('⏱️ คำขอมากเกินไป โปรดลองใหม่ในเวลาไม่กี่วินาที');
    }
    // Perf #2: compress slip image before sending to SlipOK. Slips only need
    // text legibility for OCR, so 1200px / q=0.8 is plenty and cuts the
    // base64 payload (and SlipOK bandwidth) typically by 60–80% for phone
    // photos. Files already under 800KB pass through untouched.
    let slipFile = file;
    if (typeof window._compressImageIfLarge === 'function') {
      try {
        slipFile = await window._compressImageIfLarge(file, {
          threshold: 800 * 1024,
          maxPx: 1200,
          quality: 0.8
        });
        if (slipFile !== file) {
          const saved = ((file.size - slipFile.size) / 1024).toFixed(0);
          console.log(`🗜️ Slip compressed: saved ${saved}KB`);
        }
      } catch(e) { /* fall through with original file */ slipFile = file; }
    }
    // Convert file to base64 for Cloud Function
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(slipFile);
    });
    const billTotal = window.invoiceData?.total || 0;
    const room = window.invoiceData?.room || 'unknown';
    // Normalize to canonical building id for the Cloud Function. Accepts legacy
    // aliases ('old'/'new') and any Tier-3F canonical id (e.g. 'test1').
    const buildingRaw = window.CONFIG?.getBuildingConfig?.(window.currentBuilding) || 'rooms';
    // Get Firebase ID token so the CF can verify this is a signed-in admin.
    // dashboard.html exposes auth as window.firebaseAuth; login.html as window.auth.
    const authInstance = window.firebaseAuth || window.auth;
    const idToken = await authInstance?.currentUser?.getIdToken?.();
    if (!idToken) {
      throw new Error('กรุณาเข้าสู่ระบบใหม่ก่อนตรวจสลิป (Session หมดอายุ)');
    }
    // Call Firebase Cloud Function (API key secured server-side)
    const res = await fetch('https://asia-southeast1-the-green-haven.cloudfunctions.net/verifySlip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken
      },
      body: JSON.stringify({ file: base64, expectedAmount: billTotal || 1, building: buildingRaw, room })
    });
    if (!res.ok && res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Cloud Function error ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = await res.json();

    if(json.success && json.data){
      const d = json.data;
      const amount  = d.amount ?? 0;
      const sender  = d.sender?.displayName || d.sender?.name || '—';
      const receiver= d.receiver?.displayName || d.receiver?.name || '—';
      const ref     = d.transRef || d.transactionId || '—';
      // SlipOK returns transTimestamp (ISO) + transDate (YYYYMMDD) + transTime (HH:MM:SS)
      const transferDate = d.transTimestamp || null;
      const tDate   = transferDate ? new Date(transferDate).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'}) : '—';
      const amountOk  = json.amountValid !== undefined ? json.amountValid : (billTotal <= 0 || Math.abs(amount - billTotal) < 1);

      window.slipVerified = true;
      window.slipData = {amount, sender, receiver, ref, tDate, transferDate, amountOk};

      const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      resultEl.innerHTML = `
        <div class="slip-result-ok">
          <div style="font-weight:700;font-size:.88rem;color:var(--green-dark);margin-bottom:6px;">✅ สลิปผ่านการตรวจสอบ!</div>
          <div class="slip-result-row"><span>ผู้โอน</span><span><strong>${_escBill(sender)}</strong></span></div>
          <div class="slip-result-row"><span>ผู้รับ</span><span>${_escBill(receiver)}</span></div>
          <div class="slip-result-row"><span>จำนวนเงิน</span>
            <span class="${amountOk?'slip-amount-ok':'slip-amount-warn'}">฿${amount.toLocaleString()} ${amountOk?'✅':'⚠️ ยอดไม่ตรงกับบิล'}</span></div>
          <div class="slip-result-row"><span>วันเวลา</span><span>${_escBill(tDate)}</span></div>
          <div class="slip-result-row"><span>เลขอ้างอิง</span><span style="font-size:.75rem;word-break:break-all;">${_escBill(ref)}</span></div>
        </div>`;
      enableReceiptBtn();
    } else {
      const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
      const msg = _escBill(json.message || json.data?.message || 'ไม่ทราบสาเหตุ');
      resultEl.innerHTML = `<div class="slip-result-err">❌ <strong>สลิปไม่ผ่าน:</strong> ${msg}<br><small>ลองถ่ายรูปใหม่ให้คมชัดขึ้น หรือตรวจว่าสลิปถูกต้อง</small></div>`;
    }
  } catch(err){
    console.error('❌ verifySlip error:', err);
    const _escBill = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    resultEl.innerHTML = `<div class="slip-result-err">⚠️ เชื่อมต่อ Cloud Function ไม่ได้<br>
      <small>${_escBill(err.message || 'Network error')}</small><br>
      <button data-action="skipSlipVerify" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:.8rem;background:#fff;">ออกใบเสร็จโดยไม่ตรวจสลิป</button>
    </div>`;
  }
}

function skipSlipVerify(){
  window.slipVerified = false;
  window.slipData = null;
  document.getElementById('slipResult').innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0;">ข้ามการตรวจสลิป (รับเงินสด) — กดออกใบเสร็จได้เลย ✅</div>';
  enableReceiptBtn();
}

function enableReceiptBtn(){
  const btn = document.getElementById('btnReceipt');
  btn.disabled = false;
  btn.style.opacity = '';
  btn.style.cursor = '';
  btn.classList.remove('u-op40', 'u-op50', 'u-no-ptr');
  const hint = document.getElementById('billHint');

  // Auto-issue: when QR-locked amount + SlipOK both pass, the receipt is
  // safe to issue without manual click. amountOk=false (partial/wrong)
  // falls through to manual mode so admin reviews edge cases.
  if (window.slipVerified && window.slipData && window.slipData.amountOk) {
    hint.textContent = `✅ ตรวจสลิปผ่าน ฿${window.slipData.amount.toLocaleString()} (${window.slipData.sender}) — กำลังออกใบเสร็จอัตโนมัติ...`;
    setTimeout(() => { if (typeof generateReceipt === 'function') generateReceipt(); }, 800);
    return;
  }
  hint.textContent = window.slipVerified
    ? `⚠️ ตรวจสลิปผ่าน แต่ยอด ฿${window.slipData.amount.toLocaleString()} ไม่ตรงกับบิล — กดออกใบเสร็จเองหากยอมรับ`
    : '✅ พร้อมออกใบเสร็จ — กดปุ่มด้านบน';
}
