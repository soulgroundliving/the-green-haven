# 📊 PHASE 1: MONITORING & VERIFICATION

**Purpose:** Track Phase 1 execution and verify success
**Duration:** Ongoing during Phase 1 setup
**Success Criteria:** All items should show green checkmarks

---

## 📈 REAL-TIME MONITORING

### What to Watch During Execution

**Terminal Output Checklist:**

```
Step 1/3: Installing dependencies in functions/ directory...
├─ ✅ Should see: "npm notice"
├─ ✅ Should see: "added XX packages"
├─ ✅ Should NOT see: "ERR!" or "error"
└─ ⏱️ Should complete in 2-3 minutes
```

```
Step 2/3: Firebase Login
├─ ✅ Browser may open (Google sign-in)
├─ ✅ If already logged in: Press Enter to skip
├─ ✅ Should NOT see: "Authentication failed"
└─ ⏱️ Should complete in 1-5 minutes
```

```
Enter SlipOK API Key...
├─ ✅ Enter key or press Enter for default
├─ ✅ Should show: Your key (masked if long)
└─ ⏱️ Should complete in <1 minute
```

```
Setting environment variables...
├─ ✅ Should see: firebase functions:config:set commands
├─ ✅ Should see: verification output with your values
├─ ✅ Should NOT see: "ERROR" or "failed"
└─ ⏱️ Should complete in 1-2 minutes
```

```
Step 4/4: Deploying Cloud Function to Firebase...
├─ ✅ Should see: "i deploying functions"
├─ ✅ Should see: "Running build script"
├─ ✅ Should see: "✓ Function URL (verifySlip):"
├─ ✅ Should show your URL: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip
├─ ✅ Should NOT see: "ERROR" or "FAILED"
└─ ⏱️ Should complete in 2-3 minutes
```

```
✅ PHASE 1 COMPLETE!
├─ ✅ Should see: All success messages
├─ ✅ Should see: Next steps instructions
└─ ⏱️ Total time should be 4-15 minutes
```

---

## 🔍 VERIFICATION STEPS (After Script Completes)

### Check 1: Cloud Function URL Saved

**What to verify:**
```
Did you copy the URL that looks like:
https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip
```

**If YES:** ✅ Continue
**If NO:**
- Scroll up in terminal to find it
- Copy it now before proceeding

---

### Check 2: Firebase Console Verification

**Steps:**

1. Open browser: https://console.firebase.google.com
2. Select your project (e.g., "green-haven-prod")
3. Go to: **Functions** (left sidebar)
4. Look for: **verifySlip**

**What you should see:**
```
Function Name: verifySlip
Status: ✅ (green check mark)
Region: us-central1
Trigger: HTTPS
Trigger URL: https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip
```

**If you see above:** ✅ Success - Continue to Phase 2
**If not listed:** ❌ Try again or troubleshoot

---

### Check 3: Environment Variables Verification

**In terminal, run:**
```bash
firebase functions:config:get
```

**Expected output:**
```json
{
  "slipok": {
    "api_key": "SLIPOK8P4B99Z",
    "api_url": "https://api.slipok.com/api/line/apikey/62328"
  }
}
```

**What to verify:**
- ✅ Both `api_key` and `api_url` are present
- ✅ Values match what you entered
- ✅ No error messages

**If above matches:** ✅ Environment variables set correctly
**If different:** ⚠️ May need to update them

---

### Check 4: Cloud Function Logs

**In terminal, run:**
```bash
firebase functions:log
```

**Look for recent logs showing:**
```
Deployment complete
verifySlip function deployed successfully
No errors in startup
```

**What to verify:**
- ✅ Recent logs (within last 5 minutes)
- ✅ "Deployment complete" message
- ✅ No "ERROR" or "FAILED" messages

**If above matches:** ✅ Function is healthy
**If errors present:** ⚠️ May indicate deployment issue

---

### Check 5: Function Health Check

**In terminal, run:**
```bash
firebase functions:describe verifySlip
```

**Expected output:**
```
Function: verifySlip
Status: ACTIVE
Runtime: nodejs18
Memory: 256 MB
Timeout: 60 seconds
```

**What to verify:**
- ✅ Status is ACTIVE
- ✅ Runtime is nodejs18 or higher
- ✅ Timeout is 60+ seconds

**If above matches:** ✅ Function is active and healthy
**If different:** ⚠️ May need adjustment

---

## 📋 VERIFICATION CHECKLIST

After Phase 1 script completes, verify:

### Terminal Output
- [ ] No error messages during execution
- [ ] Cloud Function URL displayed
- [ ] "PHASE 1 COMPLETE!" message shown
- [ ] URL saved (e.g., copied to notepad)

### Firebase Console
- [ ] Project loads successfully
- [ ] verifySlip function listed under Functions
- [ ] Function shows green status (active)
- [ ] Trigger URL matches your Cloud Function URL

### Environment Variables
- [ ] `firebase functions:config:get` shows your config
- [ ] `slipok.api_key` is set
- [ ] `slipok.api_url` is set
- [ ] Values match what you entered

### Cloud Function Status
- [ ] `firebase functions:describe verifySlip` shows ACTIVE
- [ ] Runtime is nodejs18 or higher
- [ ] No recent error logs

### Documentation
- [ ] Saved Cloud Function URL in safe place
- [ ] Ready to update Phase 2 with URL
- [ ] All 4 verification checks passed

---

## ⚠️ ISSUES & SOLUTIONS

### Issue: "Cloud Function URL not displayed"

**Symptoms:**
- Script completes but no URL shown
- Or URL is incomplete/wrong format

**Quick Fix:**
```bash
# Get the URL from Firebase Console
firebase functions:describe verifySlip
# Look for "Trigger URL" field
```

**Or in console:**
1. Go to: https://console.firebase.google.com
2. Functions → verifySlip
3. Copy the trigger URL

---

### Issue: "Environment variables not set"

**Symptoms:**
- `firebase functions:config:get` returns empty
- Or shows different values than entered

**Quick Fix:**
```bash
# Set them again
firebase functions:config:set slipok.api_key="SLIPOK8P4B99Z"
firebase functions:config:set slipok.api_url="https://api.slipok.com/api/line/apikey/62328"

# Verify
firebase functions:config:get

# Redeploy
firebase deploy --only functions:verifySlip
```

---

### Issue: "Function shows ERROR status"

**Symptoms:**
- Firebase Console shows red X or warning
- Function is not available
- Logs show errors

**Quick Fix:**
```bash
# Check recent logs
firebase functions:log

# Redeploy
firebase deploy --only functions:verifySlip

# If still failing, check:
# 1. Do you have firebase-admin installed? (npm install -g firebase-admin)
# 2. Is Node.js version correct? (node --version)
# 3. Are credentials valid? (firebase login)
```

---

### Issue: "Deployment timeout"

**Symptoms:**
- Script takes >5 minutes to deploy
- Or shows "timeout" error
- Or hangs during deployment

**Quick Fix:**
```bash
# Try deploying manually
firebase deploy --only functions:verifySlip

# If still fails, try:
# 1. Check internet connection
# 2. Try again later (Firebase servers might be slow)
# 3. Clear Firebase cache: rm -rf .firebase (then try again)
```

---

## 🔧 MANUAL VERIFICATION COMMANDS

### Quick Health Check

Run all these commands:

```bash
# Check Node.js
node --version

# Check npm
npm --version

# Check Firebase CLI
firebase --version

# Check logged in account
firebase auth:login

# List all functions
firebase functions:list

# Check verifySlip specifically
firebase functions:describe verifySlip

# View config
firebase functions:config:get

# View recent logs
firebase functions:log --limit 10
```

**All should complete without errors** ✅

---

## 📊 SUCCESS METRICS

### Timing

| Step | Expected Time | Actual Time | Status |
|------|---|---|---|
| Dependencies install | 2-3 min | ___ | ✅/❌ |
| Firebase login | 1-5 min | ___ | ✅/❌ |
| Credentials entry | <1 min | ___ | ✅/❌ |
| Env vars setup | 1-2 min | ___ | ✅/❌ |
| Deployment | 2-3 min | ___ | ✅/❌ |
| **TOTAL** | **4-15 min** | **___** | **✅/❌** |

---

### Function Metrics

After deployment, the function should have:

```
Name:           verifySlip
Status:         ACTIVE (✅)
Runtime:        nodejs18+
Memory:         256 MB (configurable)
Timeout:        60 seconds (configurable)
Region:         us-central1
Trigger Type:   HTTPS
Public:         Yes (requires authentication via code)
```

---

## 📞 SUPPORT MATRIX

| Issue | Solution |
|-------|----------|
| No URL displayed | Check Firebase Console |
| Status shows ERROR | Redeploy function |
| Timeout during deployment | Retry or check internet |
| Env vars not set | Run config:set again |
| Function not accessible | Check Firebase rules |
| Logs show errors | Read error details carefully |

---

## ✅ READY FOR PHASE 2?

### Phase 1 is complete when:

✅ Script shows "PHASE 1 COMPLETE!"
✅ Cloud Function URL is saved
✅ Firebase Console shows verifySlip as ACTIVE
✅ Environment variables are set
✅ No errors in logs

### Phase 2 can begin when:

✅ All above verified
✅ Cloud Function URL ready to use
✅ Within 30 minutes of Phase 1 completion
✅ Ready to update HTML files

---

## 🎯 NEXT STEPS

### Immediately after verification:

1. **Save Cloud Function URL**
   - This is critical for Phase 2
   - Format: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip`
   - Keep safe until Phase 2

2. **Note your Project ID**
   - Visible in URL: `https://console.firebase.google.com/project/YOUR_PROJECT_ID`
   - You'll need this for Phase 2

3. **Review Phase 2**
   - Read: `PHASE2_UPDATE_HTML.md`
   - Note: You'll update HTML files with the Cloud Function URL
   - Time: ~1 hour for Phase 2

### Begin Phase 2:

**When ready, follow:** `PHASE2_UPDATE_HTML.md`

This guides you through:
- Updating `slipok-secure-client.js` with your Cloud Function URL
- Modifying `tenant.html`
- Modifying `dashboard.html`
- Verification checklist

---

**Phase 1 execution complete? Continue to Phase 2!** ✅

