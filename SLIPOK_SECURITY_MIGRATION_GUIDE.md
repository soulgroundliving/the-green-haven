# 🔐 SlipOK Security Migration Guide

**Objective:** Move SlipOK API from client-side to secure backend (Firebase Cloud Function)

**Timeline:** 3-4 hours
**Risk Level:** Low (backward compatible)
**Rollback:** Easy (keep old code in comments)

---

## 📋 Overview

### Current State (INSECURE):
- API keys exposed in client-side JavaScript
- Direct client → SlipOK API calls
- No server-side rate limiting
- No audit logging

### Target State (SECURE):
- API keys in backend only (Firebase environment variables)
- Client → Cloud Function → SlipOK API
- Server-side rate limiting
- Complete audit logging
- Duplicate slip detection

---

## 🚀 Step-by-Step Deployment

### Phase 1: Prepare Backend (30 minutes)

#### 1.1 Create Firebase Project Settings
If you haven't already, set up Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init functions
```

#### 1.2 Add Dependencies to `functions/package.json`

```bash
cd functions
npm install node-fetch form-data firebase-admin
```

#### 1.3 Set Environment Variables

Store SlipOK API keys securely:

```bash
# Set environment variables in Firebase
firebase functions:config:set slipok.api_key="SLIPOK8P4B99Z"
firebase functions:config:set slipok.api_url="https://api.slipok.com/api/line/apikey/62328"

# Verify they're set
firebase functions:config:get
```

#### 1.4 Deploy Cloud Function

```bash
firebase deploy --only functions:verifySlip,functions:cleanupRateLimits
```

**Note the Cloud Function URL that appears**, it will look like:
```
https://us-central1-your-project-id.cloudfunctions.net/verifySlip
```

---

### Phase 2: Update Client Code (1 hour)

#### 2.1 Add Secure Client Library to HTML Files

**In `tenant.html` (add before closing `</body>`):**

```html
<!-- Secure SlipOK client (must be after Firebase SDK) -->
<script src="/shared/slipok-secure-client.js"></script>
```

**In `dashboard.html` (add before closing `</body>`):**

```html
<!-- Secure SlipOK client (must be after Firebase SDK) -->
<script src="/shared/slipok-secure-client.js"></script>
```

#### 2.2 Update Configuration URL

**In `slipok-secure-client.js`, update line 14:**

```javascript
// Replace with your actual Cloud Function URL
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip';
```

#### 2.3 Update Tenant App

**In `tenant.html`, find line 5016:**

Old code:
```javascript
verifySlipWithSlipOK(e.target.result, file);
```

Replace with:
```javascript
verifySlipSecureApp(file);
```

**In `tenant.html`, find the `verifySlipWithSlipOK` function (line ~5021):**

Replace the entire function with:
```javascript
// Old function - replace with secure version
// verifySlipWithSlipOK is now handled by verifySlipSecureApp
```

#### 2.4 Update Dashboard

**In `dashboard.html`, find line 7000 `verifySlip` function:**

Replace the direct API call section with:
```javascript
async function verifySlip(file) {
  await verifySlipSecureDashboard(file);
}
```

**In `dashboard.html`, find line 8765 `verifyWithSlipOK` function:**

Update to use secure endpoint:
```javascript
async function verifyWithSlipOK() {
  if(!selectedSlipFile || !selectedPaymentId) {
    alert('❌ กรุณาเลือกการแจ้งและรูปสลิป');
    return;
  }

  await verifySlipSecureDashboard(selectedSlipFile);
  // Rest of the function remains the same
}
```

---

### Phase 3: Remove Exposed API Keys (15 minutes)

#### 3.1 Delete Old API Key Constants

**In `dashboard.html`, delete these lines:**
```javascript
const SLIPOK_URL = 'https://api.slipok.com/api/line/apikey/62328';
const SLIPOK_KEY = 'SLIPOK8P4B99Z';
```

**In `tenant.html`, delete the SLIPOK API endpoint from verifySlipWithSlipOK function.**

#### 3.2 Keep Old Code as Fallback (Optional)

Comment out old functions instead of deleting:
```javascript
/*
// OLD CODE - DEPRECATED - Use verifySlipSecure instead
async function verifySlipWithSlipOK(slipImage, file) {
  // ... old code ...
}
*/
```

---

### Phase 4: Testing (45 minutes)

#### 4.1 Test Tenant App Flow

1. Login to tenant app
2. Go to payment page
3. Upload valid slip image
4. **Expected:** Shows "ตรวจสอบ..." message
5. **Expected:** SlipOK result appears in ~3 seconds
6. **Expected:** Amount verified or warning shown
7. **Expected:** Receipt auto-generates

#### 4.2 Test Dashboard Flow

1. Login to dashboard
2. Go to payment verification page
3. Upload valid slip image
4. **Expected:** Shows loading state
5. **Expected:** Verification result appears
6. **Expected:** Can approve payment

#### 4.3 Test Rate Limiting

1. Try uploading 4 slips in quick succession
2. **Expected:** 4th request shows "Too many requests"
3. **Expected:** Can retry after 1 minute

#### 4.4 Test Duplicate Detection

1. Upload same slip twice (within 24 hours)
2. **Expected:** First upload succeeds
3. **Expected:** Second upload shows "Duplicate slip" error

#### 4.5 Test Error Cases

- Invalid slip image: Should show error
- Amount mismatch: Should show warning
- Offline: Should show connection error
- Wrong file type: Should reject

---

### Phase 5: Verify Security (30 minutes)

#### 5.1 Check API Keys are Removed

1. Open tenant.html in browser
2. Open Developer Tools → Search: "SLIPOK8P4B99Z"
3. **Expected:** No results found

#### 5.2 Check Cloud Function is Called

1. Upload slip from tenant app
2. Open browser Network tab (DevTools → Network)
3. Look for request to `cloudfunctions.net/verifySlip`
4. **Expected:** POST request with base64 image
5. **Expected:** Response has `success: true`

#### 5.3 Check Firestore Logging

1. Go to Firebase Console
2. Look at `slipVerificationLog` collection
3. **Expected:** Each verification is logged
4. **Expected:** Fields: building, room, amount, status, timestamp

#### 5.4 Rotate API Keys

Now that old keys are not in client code:
```bash
# Generate new API keys from SlipOK
# Update in Firebase:
firebase functions:config:set slipok.api_key="NEW_KEY_HERE"

# Redeploy
firebase deploy --only functions
```

---

## 📊 Monitoring

### Cloud Function Logs

```bash
# View logs
firebase functions:log

# Or in Firebase Console:
# → Functions → Select verifySlip → Logs
```

### Database Collections to Monitor

**`slipVerificationLog`**
- Records every verification attempt
- Track success/failure rates
- Monitor rate limit hits

**`verifiedSlips`**
- All successfully verified slips
- Use for duplicate detection
- Audit trail of all payments

**`rateLimits`**
- Current rate limit usage
- Auto-cleaned daily

---

## 🔄 Rollback Plan

If something goes wrong:

### Option 1: Revert to Old Code (1 minute)
1. Revert HTML changes to use old functions
2. Revert deleted API key constants
3. Redeploy

### Option 2: Disable Cloud Function (5 minutes)
1. Update `slipok-secure-client.js` to check function health
2. Fall back to client-side if function is down
3. Alert user to try again later

**Add fallback:**
```javascript
const FALLBACK_ENABLED = true; // Set to false to require Cloud Function

async function verifySlipSecure(...) {
  try {
    // Call Cloud Function
  } catch (error) {
    if (FALLBACK_ENABLED) {
      console.warn('⚠️ Cloud Function failed, using fallback...');
      // Fall back to old client-side call
    } else {
      throw error;
    }
  }
}
```

---

## 🎯 Success Checklist

- [ ] Cloud Function deployed and working
- [ ] Environment variables set (no keys in code)
- [ ] Tenant app calls Cloud Function securely
- [ ] Dashboard calls Cloud Function securely
- [ ] Old API keys removed from client code
- [ ] Rate limiting working (3 requests/min)
- [ ] Duplicate detection working
- [ ] Audit logging working
- [ ] All tests passed
- [ ] Error handling working
- [ ] No API keys in browser Network tab
- [ ] Firestore collections populated correctly

---

## 📈 Performance Impact

**Before:** Direct client → SlipOK API
- Latency: ~1-3 seconds
- Exposure: API key in client

**After:** Client → Cloud Function → SlipOK API
- Latency: ~2-4 seconds (adds ~1 second for function overhead)
- Security: API key hidden on backend
- Benefits: Rate limiting, logging, duplicate detection

**Expected Load:**
- 100 verifications/day = $0.00 (within free tier)
- 1000 verifications/day = ~$1-2/month

---

## 💡 Future Enhancements

1. **Webhook Integration:** Instead of polling, have SlipOK notify your backend
2. **Batch Verification:** Verify multiple slips at once
3. **Image Pre-processing:** Enhance blurry slip images
4. **Receipt Automation:** Auto-generate PDF receipts without admin approval
5. **Analytics Dashboard:** Track verification success rates

---

## 📞 Troubleshooting

### Issue: "Cloud Function not found"
**Solution:** Check URL matches deployed function
```bash
firebase functions:list
```

### Issue: "API key not recognized"
**Solution:** Verify environment variables are set
```bash
firebase functions:config:get
```

### Issue: "CORS errors"
**Solution:** Cloud Function already handles CORS, check browser console

### Issue: "Rate limit not working"
**Solution:** Check `rateLimits` collection in Firestore
- May need to wait for cleanup job to run (daily at 2 AM)

### Issue: "Old function still being called"
**Solution:** Check HTML doesn't reference old JavaScript
- Search for `SLIPOK_URL` - should be 0 results
- Search for `verifySlipWithSlipOK` - update all calls

---

## 📚 References

- [Firebase Cloud Functions Documentation](https://firebase.google.com/docs/functions)
- [SlipOK API Documentation](https://www.slipok.com/api-docs)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)
- [Environment Variables in Cloud Functions](https://firebase.google.com/docs/functions/config-env)

---

## ✅ Sign-Off

**Before deploying to production:**

- [ ] All team members reviewed the changes
- [ ] Security review completed
- [ ] Load testing passed
- [ ] Disaster recovery plan agreed upon
- [ ] Monitoring/alerting configured

**Deployment Date:** ___________
**Deployed By:** ___________
**Status:** ✅ Production / ⚠️ Staging / ❌ Rolled back
