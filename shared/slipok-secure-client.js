/**
 * Secure SlipOK Client Integration
 *
 * This file provides secure client-side functions to call the backend
 * Firebase Cloud Function instead of calling SlipOK API directly.
 *
 * Import this in both tenant.html and dashboard.html:
 * <script src="/shared/slipok-secure-client.js"></script>
 */

// ==================== CONFIGURATION ====================
// Use your Firebase Cloud Function URL
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-the-green-haven.cloudfunctions.net/verifySlip';

// Or use a local proxy during development:
// const SLIPOK_CLOUD_FUNCTION_URL = '/api/verifySlip';

// ==================== CLIENT-SIDE SECURE VERIFICATION ====================

/**
 * Verify slip with secure backend function
 * @param {File} file - Image file
 * @param {number} expectedAmount - Expected payment amount
 * @param {string} building - 'rooms' or 'nest'
 * @param {string} room - Room ID
 * @param {string} userId - User ID (if no room)
 * @returns {Promise<object>} - Verification result
 */
async function verifySlipSecure(file, expectedAmount, building, room, userId) {
  try {
    // Convert file to base64
    const fileBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // Extract base64 data (remove data:image/jpeg;base64, prefix)
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    console.log('🔐 Calling secure SlipOK verification...');

    // Call backend function
    const response = await fetch(SLIPOK_CLOUD_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${await getFirebaseIdToken()}`
      },
      body: JSON.stringify({
        file: fileBase64,
        expectedAmount,
        building,
        room,
        userId
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Verification failed');
    }

    console.log('✅ Slip verified securely:', result.data);
    return result;

  } catch (error) {
    console.error('❌ Secure verification failed:', error);
    throw error;
  }
}

/**
 * Get Firebase ID token for authenticated requests
 * @returns {Promise<string>} - ID token
 */
async function getFirebaseIdToken() {
  try {
    const user = firebase.auth().currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    return await user.getIdToken();
  } catch (error) {
    console.error('❌ Failed to get ID token:', error);
    throw error;
  }
}

/**
 * Handle rate limit errors
 * @param {error} error - Error object
 * @returns {object} - Human-readable error message
 */
function handleSlipError(error) {
  const message = error.message || error;

  if (message.includes('429') || message.includes('rate')) {
    return {
      type: 'rate_limit',
      message: '⏱️ Too many requests. Please try again in a few minutes.',
      retryAfter: 60
    };
  }

  if (message.includes('Duplicate')) {
    return {
      type: 'duplicate',
      message: '🚨 This slip has already been verified. Please use a different slip.',
      isDuplicate: true
    };
  }

  if (message.includes('Amount')) {
    return {
      type: 'amount_mismatch',
      message: '⚠️ Slip amount does not match bill amount. Check and try again.',
      allowManual: true
    };
  }

  if (message.includes('CORS') || message.includes('Failed')) {
    return {
      type: 'connection',
      message: '📡 Connection error. Please check your internet connection.',
      allowSkip: true
    };
  }

  return {
    type: 'unknown',
    message: `❌ Verification error: ${message}`,
    allowSkip: true
  };
}

// ==================== REPLACEMENT FUNCTIONS ====================
// These should REPLACE the old verifySlip and verifyWithSlipOK functions

/**
 * NEW: Tenant App Slip Verification (replaces old verifySlipWithSlipOK)
 * Usage: Call this instead of verifySlipWithSlipOK(slipImage, file)
 */
async function verifySlipSecureApp(file) {
  try {
    if (!file) return;

    // Show loading state
    document.getElementById('slipVerifyResult').innerHTML =
      '<div style="text-align: center; color: var(--neutral);">⏳ กำลังตรวจสอบ...</div>';
    document.getElementById('slipVerifyResult').style.display = 'block';

    // Get current payment data
    const expectedAmount = currentPaymentAmount;
    const building = currentBuilding;
    const room = currentRoom;

    // Call secure backend function
    const result = await verifySlipSecure(file, expectedAmount, building, room, null);

    if (result.success) {
      // Process verification success
      const data = result.data;
      slipVerified = true;
      slipData = {
        sender: data.sender?.displayName || data.sender?.name || 'บัญชีผู้โอน',
        amount: data.amount,
        tDate: new Date(data.date).toLocaleTimeString('th-TH'),
        transactionId: data.transactionId,
        bankCode: data.sendingBankCode
      };

      // Display result
      const amountOk = result.amountValid;
      document.getElementById('slipVerifyResult').innerHTML = `
        <div style="background: #e8f5e9; color: #1a5c38; padding: 1rem; border-radius: 6px; border-left: 4px solid #4caf50;">
          <strong>✅ ตรวจสอบสลิปสำเร็จ</strong><br><br>
          ผู้โอน: ${slipData.sender}<br>
          จำนวน: ฿${slipData.amount.toLocaleString()} ${amountOk ? '✅' : '⚠️'}<br>
          เวลา: ${slipData.tDate}<br>
          เลขอ้างอิง: ${slipData.transactionId}<br><br>
          <button onclick="generateReceipt()" style="padding: 10px 20px; background: #4caf50; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-family: 'Sarabun', sans-serif; font-weight: 700;">
            ✅ สร้างใบเสร็จ
          </button>
        </div>
      `;

      // Auto-generate receipt
      setTimeout(() => {
        console.log('🔄 Auto-generating receipt...');
        generateReceipt();
      }, 1500);

    } else {
      throw new Error(result.error || 'Verification failed');
    }

  } catch (error) {
    console.error('❌ Tenant verification failed:', error);
    const errorInfo = handleSlipError(error);

    let html = `<div style="background: #ffebee; color: #c62828; padding: 1rem; border-radius: 6px; border-left: 4px solid #f44336;">
      <strong>❌ ${errorInfo.message}</strong>`;

    if (errorInfo.allowSkip) {
      html += `<br><button onclick="skipSlipVerify()" style="margin-top: 10px; padding: 8px 16px; background: #fff; border: 1px solid #f44336; border-radius: 4px; cursor: pointer; font-size: 0.9rem;">
        ข้ามการตรวจสลิป
      </button>`;
    }

    html += `</div>`;
    document.getElementById('slipVerifyResult').innerHTML = html;
    document.getElementById('slipVerifyResult').style.display = 'block';
  }
}

/**
 * NEW: Dashboard Slip Verification (replaces old verifySlip)
 * Usage: Call this instead of verifySlip(file)
 */
async function verifySlipSecureDashboard(file) {
  try {
    if (!file) return;

    const resultEl = document.getElementById('slipResult');
    const dropText = document.getElementById('slipDropText');

    // Show image preview + loading state
    const reader = new FileReader();
    reader.onload = ev => {
      dropText.innerHTML = `<img src="${ev.target.result}" style="max-height:90px;border-radius:6px;object-fit:contain;margin-bottom:4px;"><br><small style="color:var(--text-muted);">⏳ กำลังตรวจสอบ...</small>`;
    };
    reader.readAsDataURL(file);
    resultEl.innerHTML = '';

    // Get bill data
    const expectedAmount = invoiceData?.total || 0;
    const building = currentBuilding === 'old' ? 'rooms' : 'nest';
    // You'll need to extract room from UI or pass it as parameter

    // Call secure backend function
    const result = await verifySlipSecure(file, expectedAmount, building, selectedRoom, null);

    if (result.success) {
      const d = result.data;
      const amount = d.amount ?? 0;
      const sender = d.sender?.displayName || d.sender?.name || '—';
      const receiver = d.receiver?.displayName || d.receiver?.name || '—';
      const ref = d.transactionId || '—';
      const tDate = d.date ? new Date(d.date).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      const amountOk = result.amountValid;

      slipVerified = true;
      slipData = { amount, sender, receiver, ref, tDate, amountOk };

      resultEl.innerHTML = `
        <div style="background: #e8f5e9; border: 1.5px solid #4caf50; border-radius: 6px; padding: 0.8rem;">
          <div style="font-weight: 700; font-size: 0.88rem; color: #1a5c38; margin-bottom: 6px;">✅ สลิปผ่านการตรวจสอบ!</div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.83rem; border-bottom: 1px solid rgba(0,0,0,.05);">
            <span>ผู้โอน</span><span><strong>${sender}</strong></span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.83rem; border-bottom: 1px solid rgba(0,0,0,.05);">
            <span>ผู้รับ</span><span>${receiver}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.83rem; border-bottom: 1px solid rgba(0,0,0,.05);">
            <span>จำนวนเงิน</span><span style="color: ${amountOk ? '#1a5c38' : '#c62828'}; font-weight: 700;">฿${amount.toLocaleString()} ${amountOk ? '✅' : '⚠️'}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.83rem; border-bottom: 1px solid rgba(0,0,0,.05);">
            <span>วันเวลา</span><span>${tDate}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 0.83rem;">
            <span>เลขอ้างอิง</span><span style="font-size: 0.75rem; word-break: break-all;">${ref}</span>
          </div>
        </div>
      `;

      enableReceiptBtn();
    } else {
      throw new Error(result.error || 'Verification failed');
    }

  } catch (error) {
    console.error('❌ Dashboard verification failed:', error);
    const errorInfo = handleSlipError(error);
    const dropText = document.getElementById('slipDropText');
    const resultEl = document.getElementById('slipResult');

    resultEl.innerHTML = `<div style="color: #c62828; padding: 1rem; background: #ffebee; border-radius: 6px;">
      ${errorInfo.message}
      ${errorInfo.allowSkip ? '<button onclick="skipSlipVerify()" style="margin-top: 6px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; font-size: 0.8rem; background: #fff;">ข้ามการตรวจสลิป</button>' : ''}
    </div>`;
  }
}

// ==================== EXPORT FOR USE ====================
// Make functions globally available
window.verifySlipSecure = verifySlipSecure;
window.verifySlipSecureApp = verifySlipSecureApp;
window.verifySlipSecureDashboard = verifySlipSecureDashboard;
window.handleSlipError = handleSlipError;

console.log('✅ Secure SlipOK client loaded');
