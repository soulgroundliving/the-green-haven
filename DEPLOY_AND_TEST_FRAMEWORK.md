# 🚀 DEPLOY & TEST FRAMEWORK - Complete Guide

**Purpose:** Provide comprehensive guidance for deploying and testing the SlipOK security migration
**Scope:** All 4 phases with testing at each stage
**Timeline:** 3-4 hours total

---

## 🎯 DEPLOYMENT PHASES OVERVIEW

### Phase 1: Deploy Cloud Function (15 min)
**Type:** Automated deployment via PHASE1_SETUP.bat
**What:** Deploy verifySlip Cloud Function to Firebase
**Testing:** Firebase Console verification + Health check

### Phase 2: Deploy Client Updates (1 hour)
**Type:** Manual code updates
**What:** Update HTML files to use Cloud Function
**Testing:** Search verification + Code review

### Phase 3: Secure Configuration (15 min)
**Type:** Manual cleanup
**What:** Remove exposed API keys from client code
**Testing:** Search verification + Git review

### Phase 4: End-to-End Testing (45 min)
**Type:** Manual testing
**What:** Test both apps with live data
**Testing:** 14-point verification checklist

---

## 📋 PHASE 1: DEPLOY CLOUD FUNCTION

### 1.1 Pre-Deployment Checklist

```
System Requirements:
  ☐ Node.js installed (node --version)
  ☐ npm installed (npm --version)
  ☐ PowerShell or Command Prompt ready
  ☐ Internet connection stable

Credentials Ready:
  ☐ SlipOK API Key (SLIPOK8P4B99Z or yours)
  ☐ SlipOK API URL (https://api.slipok.com/api/line/apikey/62328 or yours)
  ☐ Google account for Firebase login
  ☐ Empty text editor for saving URL

Ready to Execute:
  ☐ 20 minutes available
  ☐ No interruptions planned
  ☐ Will save Cloud Function URL
```

### 1.2 Execute Phase 1

**Step 1: Open Terminal**
```powershell
# Open PowerShell
# Or Command Prompt (cmd)
```

**Step 2: Navigate to Project**
```powershell
cd C:\Users\usEr\Downloads\The_green_haven
```

**Step 3: Run Setup Script**
```powershell
.\PHASE1_SETUP.bat
```

**Step 4: Follow Prompts**
- API Key: Press Enter or enter your key
- API URL: Press Enter or enter your URL
- Firebase Login: Sign in if prompted
- Wait for deployment: 2-3 minutes

**Step 5: Save URL**
```
URL will appear as:
https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip

Copy and save this URL (you'll need it for Phase 2!)
```

### 1.3 Verify Phase 1 Deployment

**Check 1: Terminal Output**
```
✅ Should show: "PHASE 1 COMPLETE!"
✅ Should show: Cloud Function URL
✅ Should NOT show: Error messages
```

**Check 2: Firebase Console**
```
1. Go to: https://console.firebase.google.com
2. Select your project
3. Click: Functions (left sidebar)
4. Look for: verifySlip
5. Status should be: ✅ Green checkmark (ACTIVE)
```

**Check 3: Environment Variables**
```bash
firebase functions:config:get
```

Expected output:
```json
{
  "slipok": {
    "api_key": "SLIPOK8P4B99Z",
    "api_url": "https://api.slipok.com/api/line/apikey/62328"
  }
}
```

**Check 4: Function Logs**
```bash
firebase functions:log
```

Expected: Recent deployment logs, no errors

### 1.4 Phase 1 Success Criteria

✅ Script completes without errors
✅ Cloud Function URL displayed and saved
✅ Firebase Console shows function as ACTIVE
✅ Environment variables configured
✅ Logs show successful deployment

---

## 📋 PHASE 2: UPDATE & DEPLOY CLIENT CODE

### 2.1 Pre-Update Checklist

```
Prerequisites:
  ☐ Phase 1 completed successfully
  ☐ Cloud Function URL saved
  ☐ Text editor ready (VS Code, Sublime, etc.)
  ☐ 1.5 hours available
  ☐ PHASE2_UPDATE_HTML.md open
```

### 2.2 Update Files

**Update 1: Configure Cloud Function URL**

File: `shared/slipok-secure-client.js`
Line: 14

```javascript
// BEFORE:
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip';

// AFTER (with your actual Project ID):
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-green-haven-prod.cloudfunctions.net/verifySlip';
```

**Update 2: Update Tenant App**

File: `tenant.html`

- Section 1 (Line ~5016): Change function call
- Section 2 (Line ~5021): Replace function
- Section 3 (Before `</body>`): Add import

**Update 3: Update Dashboard**

File: `dashboard.html`

- Section 1 (Line ~7000): Update function
- Section 2 (Line ~8765): Update function
- Section 3 (Before `</body>`): Add import

### 2.3 Verify Phase 2 Updates

**Check 1: Search for API Keys**
```
Search: SLIPOK8P4B99Z
Result: Should find 0 in HTML files (only in docs is ok)

Search: verifySlipSecureApp
Result: Should find in tenant.html

Search: verifySlipSecureDashboard
Result: Should find in dashboard.html

Search: slipok-secure-client.js
Result: Should find 2 imports (tenant.html + dashboard.html)
```

**Check 2: Code Review**
```
Visual check:
  ✅ Both HTML files have new imports
  ✅ Function calls updated correctly
  ✅ Cloud Function URL configured
  ✅ No syntax errors
  ✅ Files save without errors
```

### 2.4 Deploy Phase 2 Changes

**Commit to Git:**
```bash
git add -A
git commit -m "feat: Update tenant and dashboard to use secure Cloud Function

- Updated slipok-secure-client.js with Cloud Function URL
- Updated tenant.html to use verifySlipSecureApp
- Updated dashboard.html to use verifySlipSecureDashboard
- Added secure client library imports

Both apps now call backend Cloud Function instead of SlipOK directly."
```

### 2.5 Phase 2 Success Criteria

✅ All HTML files updated correctly
✅ Cloud Function URL configured
✅ No API keys visible in HTML
✅ Search verification passes
✅ Changes committed to Git

---

## 📋 PHASE 3: REMOVE EXPOSED KEYS

### 3.1 Pre-Cleanup Checklist

```
Prerequisites:
  ☐ Phase 2 completed successfully
  ☐ All HTML files updated
  ☐ Verification passed
  ☐ 15 minutes available
```

### 3.2 Remove API Keys

**Remove from Dashboard:**

File: `dashboard.html`
Lines: ~6943-6944

DELETE:
```javascript
const SLIPOK_URL = 'https://api.slipok.com/api/line/apikey/62328';
const SLIPOK_KEY = 'SLIPOK8P4B99Z';
```

**Remove from Tenant App:**

File: `tenant.html`
Lines: ~5039-5042

DELETE: Any SlipOK API endpoint or key constants

### 3.3 Verify Phase 3 Cleanup

**Check 1: Search for Remaining Keys**
```
Search: SLIPOK8P4B99Z
Result: 0 in HTML files (ok if found in documentation)

Search: api.slipok.com
Result: 0 in HTML files (ok if found in documentation)
```

**Check 2: Verify Cloud Function Still Works**
```bash
firebase functions:describe verifySlip
```

Should show: ACTIVE status

### 3.4 Deploy Phase 3 Changes

**Commit to Git:**
```bash
git add -A
git commit -m "fix: Remove exposed SlipOK API keys from client code

- Deleted SLIPOK_URL and SLIPOK_KEY from dashboard.html
- Removed API credentials from tenant.html
- All API keys now stored in Firebase environment variables only

Security improvement: API credentials no longer visible in browser or source control"
```

### 3.5 Phase 3 Success Criteria

✅ All old API key constants removed
✅ Search confirms 0 keys in client code
✅ Cloud Function still active
✅ Changes committed to Git

---

## 📋 PHASE 4: END-TO-END TESTING

### 4.1 Test Tenant App

**Setup:**
```
1. Open: https://your-site.com/tenant.html
2. Login with: tenant15@test.com (or test tenant)
3. Navigate to: Payment or Bills page
```

**Test 1: Basic Verification**
```
1. Click: "Upload Slip" or "Verify Payment"
2. Select: Valid slip image
3. Click: Verify
4. Expected:
   ✅ Loading indicator appears
   ✅ Result shown in 2-4 seconds
   ✅ Amount displayed
   ✅ Sender/receiver info shown
   ✅ Receipt auto-generates
```

**Test 2: Rate Limiting**
```
1. Upload same image 4 times rapidly
2. Expected:
   ✅ First 3 succeed
   ✅ 4th shows: "Too many requests"
   ✅ Shows: "Retry in 60 seconds"
```

**Test 3: Duplicate Detection**
```
1. Upload slip (Slip A)
2. Wait 10 seconds
3. Upload same slip again
4. Expected:
   ✅ First: Success
   ✅ Second: "Duplicate slip detected"
```

**Test 4: Error Handling**
```
1. Upload invalid file (not an image)
2. Expected: Clear error message
3. Upload with amount mismatch
4. Expected: Warning message shown
```

### 4.2 Test Dashboard

**Setup:**
```
1. Open: https://your-site.com/dashboard.html
2. Login with: admin account
3. Navigate to: Payment Verification
```

**Test 1: Verification**
```
1. Click: "Verify Slip"
2. Upload: Slip image
3. Click: Verify
4. Expected:
   ✅ Loads in 2-4 seconds
   ✅ Amount shown
   ✅ Sender/receiver shown
   ✅ Can approve/reject
```

**Test 2: Real-time Notifications**
```
1. In tenant app: Upload slip (stays logged in)
2. In dashboard: Should see notification
3. Expected:
   ✅ Real-time notification appears
   ✅ Can click to verify
   ✅ User data correct
```

### 4.3 Security Verification

**Check 1: No API Keys in DevTools**
```
1. Open tenant.html in browser
2. Press F12 (Developer Tools)
3. Search: SLIPOK8P4B99Z
4. Expected: 0 results
```

**Check 2: Cloud Function Called**
```
1. Press F12 → Network tab
2. Upload slip
3. Expected:
   ✅ Request to: cloudfunctions.net/verifySlip
   ✅ NO requests to: api.slipok.com
   ✅ Status: 200 (success)
```

**Check 3: Firestore Logging**
```
1. Go to: Firebase Console
2. Firestore → Collections
3. Look for: slipVerificationLog
4. Expected:
   ✅ Recent entries created
   ✅ Fields: building, room, status, timestamp
   ✅ One entry per verification
```

### 4.4 Performance Verification

**Check 1: Response Time**
```
1. Upload slip
2. Note time in Network tab
3. Expected: 2-4 seconds

Acceptable: up to 5 seconds
```

**Check 2: Multiple Concurrent**
```
1. Tenant uploads slip
2. Dashboard accesses simultaneously
3. Expected: Both work without issues
```

### 4.5 14-Point Verification Checklist

- [ ] Tenant app verification works
- [ ] Dashboard verification works
- [ ] Rate limiting works (4th request blocked)
- [ ] Duplicate detection works
- [ ] Error handling clear
- [ ] Amount validation works
- [ ] Receipt generation works
- [ ] Real-time notifications work
- [ ] No API keys visible (DevTools check)
- [ ] Cloud Function called (Network check)
- [ ] Firestore logging working
- [ ] Performance acceptable (2-4 sec)
- [ ] No direct SlipOK API calls
- [ ] All fields populated correctly

---

## ✅ DEPLOYMENT SUCCESS CRITERIA

### Phase 1 Success
✅ Cloud Function deployed
✅ Environment variables configured
✅ Function shows ACTIVE in Firebase Console

### Phase 2 Success
✅ HTML files updated
✅ Cloud Function URL configured
✅ Search verification passes

### Phase 3 Success
✅ API keys removed
✅ Search confirms 0 keys in client code
✅ Cloud Function still works

### Phase 4 Success
✅ Both apps functional
✅ All 14 tests pass
✅ Security verified
✅ Performance acceptable

---

## 🎯 SUMMARY

**Total Time:** ~3-4 hours
**Phases:** 4 sequential phases
**Deployment Type:** Gradual, with verification at each stage
**Rollback:** Available at any point (git revert)

**Result:** Secure SlipOK API with complete audit trail and protection against abuse

---

## 📞 SUPPORT

**During Execution:**
- Check relevant PHASE guide
- See troubleshooting section
- Check Firebase Console logs

**After Completion:**
- You have: Secure API integration
- You can: Rotate keys without code changes
- You have: Complete audit trail

---

**Ready to deploy? Start with Phase 1: `.\PHASE1_SETUP.bat`**

