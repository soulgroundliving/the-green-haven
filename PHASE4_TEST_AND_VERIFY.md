# 🔐 Phase 4: Testing and Verification

**Estimated Time:** 45 minutes
**Status:** Ready to execute manually
**Risk Level:** SAFE (All changes staged, can roll back anytime)

---

## Prerequisites

✅ All previous phases complete:
- Phase 1: Cloud Function deployed
- Phase 2: HTML files updated
- Phase 3: API keys removed
- All changes committed to Git

---

## 🧪 Phase 4.1: Functional Testing

### Test 1.1: Tenant App - Basic Verification

**Steps:**
1. Open `https://your-site.com/tenant.html` in browser
2. Login with test tenant account (e.g., tenant15@test.com)
3. Navigate to "Bills" or "Payment" page
4. Click "Upload Slip" or "Verify Payment"
5. Select a valid slip image from your computer
6. Click verify button

**Expected Outcomes:**
- ✅ Loading state appears ("กำลังตรวจสอบ..." or spinner)
- ✅ Within 2-4 seconds, verification result appears
- ✅ Shows: Amount, Sender, Receiver, Transaction ID
- ✅ Amount matches bill (or shows warning if different)
- ✅ Receipt auto-generates
- ✅ Admin receives real-time notification

**If Failed:**
- Check browser Console (F12 → Console tab) for errors
- Look for network errors in Network tab
- Verify Cloud Function URL is correct in slipok-secure-client.js
- Check Firebase Firestore is accessible

---

### Test 1.2: Dashboard - Basic Verification

**Steps:**
1. Open `https://your-site.com/dashboard.html` in browser
2. Login with admin account
3. Navigate to "Payment Verification" page
4. Click "Verify Slip" button
5. Upload a slip image
6. Click verify button

**Expected Outcomes:**
- ✅ Loading indicator appears
- ✅ Verification completes in 2-4 seconds
- ✅ Shows slip details (amount, sender, date)
- ✅ Shows "✓ Amount Valid" or "⚠️ Amount Warning"
- ✅ Can approve/reject payment
- ✅ Notification sent to tenant

**If Failed:**
- Check browser Console for errors
- Verify slipok-secure-client.js is loaded (check Network tab)
- Check Cloud Function URL configuration
- Verify admin has permission to verify payments

---

## 🔄 Phase 4.2: Rate Limiting Test

**Purpose:** Verify server-side rate limiting prevents abuse
**Limit:** 10 requests per minute per user

**Steps:**
1. Open tenant app payment page
2. Select same image file
3. **Rapidly click upload/verify button 4-5 times in quick succession**
4. Observe results

**Expected Outcomes:**
- ✅ First 3 uploads succeed
- ✅ 4th upload shows error: "Too many requests, please wait..."
- ✅ Shows retry time: "Can retry in 60 seconds"
- ✅ After waiting 60+ seconds, can verify again
- ✅ Check Firestore `rateLimits` collection shows rate limit records

**If All Pass:**
- ✅ Rate limiting is working correctly
- ✅ Server-side protection is active

**If Failed:**
- Check Firebase environment variables are set: `firebase functions:config:get`
- Verify rateLimits collection exists in Firestore
- Check Cloud Function logs: `firebase functions:log`

---

## 🔁 Phase 4.3: Duplicate Detection Test

**Purpose:** Prevent paying same slip twice
**Test Duration:** Can be done within 24 hours after first verification

**Steps:**
1. Tenant uploads slip image (Slip A) and verifies
2. **Within 24 hours**, tenant uploads the **exact same slip image** again
3. Click verify

**Expected Outcomes:**
- ✅ First upload: Success (shows verified result)
- ✅ Second upload: Error message "Duplicate slip detected - This slip was already verified on [date/time]"
- ✅ Check Firestore `verifiedSlips` collection has first slip recorded
- ✅ Check Firestore `slipVerificationLog` has both attempts (one success, one duplicate error)

**If Failed:**
- Check `verifiedSlips` collection has `transactionId` field
- Verify timestamp fields are set correctly
- Check Cloud Function duplicate detection logic in verifySlip.js

---

## ❌ Phase 4.4: Error Handling Tests

### Test 4.4.1: Invalid Image File

**Steps:**
1. Upload non-image file (e.g., .txt, .pdf, random binary)
2. Try to verify

**Expected:**
- ✅ Error: "Invalid image format"
- ✅ User-friendly message in Thai (if configured)
- ✅ No Firebase logging of invalid attempts

---

### Test 4.4.2: Amount Mismatch

**Steps:**
1. Expected bill amount: 2,500 baht
2. Upload slip with different amount: 2,600 baht
3. Verify

**Expected:**
- ✅ Verification succeeds
- ✅ Shows warning: "⚠️ Amount differs by 100 baht (expected 2,500, got 2,600)"
- ✅ Can still approve payment
- ✅ Amount within ±1 baht tolerance shows "✓ Amount Valid"

---

### Test 4.4.3: Network Connection Loss

**Steps:**
1. Start slip verification
2. During verification, disconnect internet (close WiFi or pull network cable)
3. Wait for timeout

**Expected:**
- ✅ Shows error: "Connection lost, please check your internet"
- ✅ Can retry after reconnecting
- ✅ No stuck loading state

---

### Test 4.4.4: Cloud Function Timeout

**Steps:**
1. (This may happen naturally if SlipOK is slow)
2. Wait during verification for >30 seconds

**Expected:**
- ✅ Error: "Verification timed out"
- ✅ User can retry
- ✅ Firestore logs the timeout

---

## 🔒 Phase 4.5: Security Verification

### Test 5.1: Confirm API Keys Removed

**Purpose:** Ensure no credentials in client code

**Steps:**
1. Open tenant.html in browser
2. Press F12 to open Developer Tools
3. Go to Network tab
4. Upload a slip and verify
5. Click the request to `cloudfunctions.net/verifySlip`
6. View the request body and response

**Expected:**
- ✅ Request body shows: base64 image, expectedAmount, building, room/userId
- ✅ **NO** request contains `SLIPOK8P4B99Z` or `api.slipok.com`
- ✅ Response shows: amount, sender, receiver, transactionId
- ✅ **NO** response contains API keys

**Confirm in Console:**
1. Press F12, go to Console tab
2. Type: `document.body.innerHTML.includes('SLIPOK8P4B99Z')`
3. Should return: **false**
4. Type: `document.body.innerHTML.includes('api.slipok.com')`
5. Should return: **false**

---

### Test 5.2: Verify Cloud Function is Called

**Purpose:** Confirm client→Cloud Function→SlipOK flow

**Steps:**
1. Open browser Developer Tools (F12)
2. Go to Network tab
3. Filter by: `cloudfunctions.net` or `POST` requests
4. Upload slip from tenant app
5. Watch for request to `verifySlip` function

**Expected:**
- ✅ Single POST request to `https://us-central1-{PROJECT_ID}.cloudfunctions.net/verifySlip`
- ✅ Request headers include `Authorization: Bearer {ID_TOKEN}`
- ✅ Request body contains base64-encoded image
- ✅ **NO** direct requests to `api.slipok.com`
- ✅ Response time: 2-4 seconds

---

### Test 5.3: Check Firestore Audit Logging

**Purpose:** Verify all verifications are logged

**Steps:**
1. Perform 3-5 verifications (mix of success, errors, rate limits)
2. Go to [Firebase Console](https://console.firebase.google.com)
3. Navigate to Firestore → Collections → `slipVerificationLog`
4. Review recent records

**Expected Records Should Show:**
- Document structure:
  ```
  - building: "rooms" or "nest"
  - room: "15" (room number)
  - userId: "user@test.com"
  - expectedAmount: 2500
  - verifiedAmount: 2500
  - transactionId: "20260404123456"
  - status: "success"
  - timestamp: 2026-04-04T12:34:56Z
  - ipAddress: (client IP)
  - userAgent: (browser info)
  ```

✅ **All verifications should be logged automatically**

---

### Test 5.4: Verify Successful Slips Stored

**Purpose:** Confirm verified slips can be checked for duplicates

**Steps:**
1. Complete a successful verification
2. Go to [Firebase Console](https://console.firebase.google.com)
3. Navigate to Firestore → Collections → `verifiedSlips`
4. Find the record with matching transactionId

**Expected Record Structure:**
```
- transactionId: "20260404123456"
- building: "rooms"
- room: "15"
- userId: "tenant15@test.com"
- amount: 2500
- expectedAmount: 2500
- sender: { displayName: "Bank A", name: "Account Name" }
- receiver: { ... }
- date: "2026-04-04T12:34:56Z"
- bankCode: "KBANK"
- timestamp: (verification time)
- verified: true
```

---

## 📊 Phase 4.6: Performance Monitoring

### Monitor 6.1: Cloud Function Logs

**Steps:**
1. Open terminal/command prompt
2. Run: `firebase functions:log`
3. Perform verifications from tenant app or dashboard
4. Watch logs in real-time

**Expected Output:**
```
✅ [verifySlip] Verification started for room 15
✅ [verifySlip] Rate limit check: PASS
✅ [verifySlip] Duplicate check: No previous verification
✅ [verifySlip] Calling SlipOK API...
✅ [verifySlip] SlipOK response received in 1.2 seconds
✅ [verifySlip] Verification successful: Transaction ID 20260404123456
```

**Check for errors:**
- ❌ Any "Error" messages indicate problems
- ❌ "FAILED" status means verification didn't work
- ⚠️ "RATE_LIMITED" is expected sometimes

---

### Monitor 6.2: Average Response Time

**Measurement:**
- Open Network tab in DevTools
- Upload slip and note time in Network tab
- Repeat 5 times
- Calculate average

**Expected:**
- ✅ 2-4 seconds for successful verification
- ✅ Up to 5 seconds is acceptable
- ⚠️ Over 5 seconds may indicate slowness

**If Slow:**
- Check SlipOK API status
- Check Firebase region (should be close to users)
- Review Cloud Function memory allocation

---

## ✅ Phase 4.7: Complete Verification Checklist

- [ ] Tenant app verification works (upload → verify → receipt)
- [ ] Dashboard verification works (upload → verify → approve)
- [ ] Rate limiting prevents >10 requests/minute
- [ ] Duplicate detection prevents same slip being verified twice
- [ ] Error messages are clear and user-friendly
- [ ] Network errors show helpful messages
- [ ] Amount mismatches show warnings
- [ ] API keys NOT visible in browser DevTools
- [ ] API keys NOT visible in Network requests
- [ ] Cloud Function URL appears in Network requests
- [ ] All verifications logged to Firestore `slipVerificationLog`
- [ ] Successful slips stored in `verifiedSlips` collection
- [ ] Response time is 2-4 seconds average
- [ ] No direct requests to `api.slipok.com`
- [ ] Firebase authentication working (ID tokens used)

---

## 🚨 Rollback Procedure (If Issues Found)

If any tests fail:

**Option 1: Quick Revert (2 minutes)**
```bash
git revert HEAD --no-edit
# Reverts all changes
# Old API keys and functions restored
# Both apps revert to direct SlipOK calls
```

**Option 2: Partial Rollback**
- Keep Phase 1 (Cloud Function) - it works
- Revert Phase 2 & 3 (HTML changes)
- Update HTML again more carefully
- Test again

**Option 3: Hybrid Mode**
- Keep both old and new code
- Update client to try Cloud Function first
- If fails, fall back to old direct call
- Provides reliability while fixing issues

---

## 📝 Sign-Off

**After all tests pass:**

```bash
git add -A
git commit -m "test: Phase 4 - All security migration tests passed

✅ Functional testing: tenant and dashboard verification working
✅ Rate limiting: server-side protection active
✅ Duplicate detection: prevents repeated slip verification
✅ Error handling: user-friendly messages for all error cases
✅ Security verification: no API keys in client code
✅ Cloud Function: properly handling all requests
✅ Firestore logging: audit trail complete
✅ Performance: 2-4 second response times

Security migration complete. Ready for production deployment."
```

---

## 🎉 Migration Complete!

Once Phase 4 passes:
- ✅ SlipOK API is now secure (keys in backend only)
- ✅ Rate limiting prevents abuse
- ✅ Duplicate detection prevents double-payment
- ✅ Complete audit trail in Firestore
- ✅ Ready for production use
- ✅ Can safely rotate API keys without updating client code

**Congratulations! 🎊**

