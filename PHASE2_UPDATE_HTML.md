# 🔐 Phase 2: Update Client Code

**Estimated Time:** 1 hour
**Status:** Ready to execute manually

---

## Prerequisites

✅ Phase 1 must be complete:
- Cloud Function deployed to Firebase
- Environment variables set (slipok.api_key, slipok.api_url)
- Cloud Function URL noted

---

## Step 2.1: Update Configuration URL

**File:** `shared/slipok-secure-client.js`
**Line:** 13-14

**Find this:**
```javascript
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip';
```

**Replace with your actual Cloud Function URL** (from Phase 1 deployment output):
```javascript
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_ACTUAL_PROJECT_ID.cloudfunctions.net/verifySlip';
```

✅ **Verify:** The URL should:
- Start with `https://us-central1-`
- End with `.cloudfunctions.net/verifySlip`
- Match the function URL from `firebase deploy` output

---

## Step 2.2: Update Tenant App (`tenant.html`)

### 2.2.1: Add Import (before closing `</body>`)

**Location:** Last part of `tenant.html`, before closing `</body>` tag (around line 5200+)

**Add this line:**
```html
<!-- Secure SlipOK client (must be after Firebase SDK) -->
<script src="/shared/slipok-secure-client.js"></script>
```

**✅ Verify:** The line imports `slipok-secure-client.js` from `/shared/`

---

### 2.2.2: Update File Upload Handler

**Location:** `tenant.html` around line 5016 (in the file input change event)

**Find this:**
```javascript
verifySlipWithSlipOK(e.target.result, file);
```

**Replace with:**
```javascript
verifySlipSecureApp(file);
```

✅ **Verify:** The function name changed from `verifySlipWithSlipOK` to `verifySlipSecureApp`

---

### 2.2.3: Replace Old Function (Keep as Fallback)

**Location:** `tenant.html` around line 5021-5071 (the entire `verifySlipWithSlipOK` function)

**Replace the entire function body with:**
```javascript
// ==================== DEPRECATED FUNCTION ====================
// OLD CODE: This function is now replaced by secure version in slipok-secure-client.js
// Keeping for reference only - DO NOT USE

async function verifySlipWithSlipOK(slipImage, file) {
  console.warn('⚠️ OLD FUNCTION CALLED - This should not happen. Use verifySlipSecureApp instead.');

  // Old code commented out for safety - use Cloud Function instead
  // const formData = new FormData();
  // formData.append('files', file);
  // formData.append('amount', expectedAmount);
  // ...
}
```

✅ **Verify:** Old function is replaced but code is preserved as comment

---

## Step 2.3: Update Dashboard (`dashboard.html`)

### 2.3.1: Add Import (before closing `</body>`)

**Location:** Last part of `dashboard.html`, before closing `</body>` tag (around line 12700+)

**Add this line:**
```html
<!-- Secure SlipOK client (must be after Firebase SDK) -->
<script src="/shared/slipok-secure-client.js"></script>
```

✅ **Verify:** The line imports `slipok-secure-client.js` from `/shared/`

---

### 2.3.2: Update verifySlip Function

**Location:** `dashboard.html` around line 7000

**Find this function:**
```javascript
async function verifySlip(file) {
  // ... old code with direct API call ...
}
```

**Replace entire function with:**
```javascript
async function verifySlip(file) {
  // Secure verification via Cloud Function
  await verifySlipSecureDashboard(file);
}
```

✅ **Verify:** Function now simply calls `verifySlipSecureDashboard`

---

### 2.3.3: Update verifyWithSlipOK Function

**Location:** `dashboard.html` around line 8765

**Find this section:**
```javascript
async function verifyWithSlipOK() {
  if(!selectedSlipFile || !selectedPaymentId) {
    alert('❌ กรุณาเลือกการแจ้งและรูปสลิป');
    return;
  }

  // ... old code with direct API call ...
}
```

**Replace with:**
```javascript
async function verifyWithSlipOK() {
  if(!selectedSlipFile || !selectedPaymentId) {
    alert('❌ กรุณาเลือกการแจ้งและรูปสลิป');
    return;
  }

  // Secure verification via Cloud Function
  await verifySlipSecureDashboard(selectedSlipFile);

  // Rest of function that shows results continues below
  // (Keep any existing result display code)
}
```

✅ **Verify:** The function now calls `verifySlipSecureDashboard` instead of direct API call

---

## Step 2.4: Mark Old Code as Fallback (Optional but Recommended)

### In `tenant.html`:

**Find these lines around line 5039-5042:**
```javascript
const verifySlipUrl = 'https://api.slipok.com/api/line/apikey/62328';
const verifySlipKey = 'SLIPOK8P4B99Z';
```

**Keep them but comment out for now:**
```javascript
// ==================== OLD API KEYS - DEPRECATED ====================
// These will be deleted in Phase 3
// DO NOT USE - Use Cloud Function instead
// const verifySlipUrl = 'https://api.slipok.com/api/line/apikey/62328';
// const verifySlipKey = 'SLIPOK8P4B99Z';
```

✅ **Verify:** Keys are commented out, not deleted yet

---

## Verification Checklist

After completing all updates:

- [ ] `slipok-secure-client.js` has correct Cloud Function URL
- [ ] `tenant.html` imports `slipok-secure-client.js`
- [ ] `tenant.html` file upload calls `verifySlipSecureApp()`
- [ ] `tenant.html` old `verifySlipWithSlipOK` function is replaced
- [ ] `dashboard.html` imports `slipok-secure-client.js`
- [ ] `dashboard.html` `verifySlip()` calls `verifySlipSecureDashboard()`
- [ ] `dashboard.html` `verifyWithSlipOK()` calls `verifySlipSecureDashboard()`
- [ ] Old API key constants are commented out

---

## Search Commands (for Verification)

Use Find & Replace in your editor:

1. **Search for remaining SlipOK API references:**
   - Search: `SLIPOK8P4B99Z`
   - Should find: 0 results (or only in SLIPOK_SECURITY_MIGRATION_GUIDE.md)

2. **Search for old function calls:**
   - Search: `verifySlipWithSlipOK`
   - Should find: 0 calls (only definition and comments)
   - Search: `verifyWithSlipOK`
   - Should find: only in dashboard.html (updated to use Cloud Function)

3. **Search for new function calls:**
   - Search: `verifySlipSecureApp`
   - Should find: in tenant.html
   - Search: `verifySlipSecureDashboard`
   - Should find: in dashboard.html

---

## Next Step

Once Phase 2 is complete:
→ **Run PHASE3_REMOVE_API_KEYS.bat**

