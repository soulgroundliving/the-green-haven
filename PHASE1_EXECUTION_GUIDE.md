# 🚀 PHASE 1: EXECUTION GUIDE - Step by Step

**Estimated Time:** 15-20 minutes
**Status:** Ready to Execute
**Goal:** Deploy Cloud Function and configure Firebase environment variables

---

## ⚠️ BEFORE YOU START

### Prerequisites Checklist

- [ ] Node.js installed? Run: `node --version` (should show v14+)
- [ ] npm installed? Run: `npm --version` (should show v6+)
- [ ] PowerShell or Command Prompt open
- [ ] Located in correct folder: `C:\Users\usEr\Downloads\The_green_haven`
- [ ] Have your SlipOK credentials ready:
  - API Key: `SLIPOK8P4B99Z` (or your new key)
  - API URL: `https://api.slipok.com/api/line/apikey/62328` (or yours)
- [ ] Google account for Firebase login
- [ ] 20 minutes available (don't interrupt the process)

---

## 🎬 EXECUTION STEPS

### Step 1: Open Terminal

**Windows PowerShell:**
```powershell
# Press Windows key, type "PowerShell", press Enter
```

**Command Prompt:**
```cmd
# Press Windows key, type "cmd", press Enter
```

**macOS/Linux Terminal:**
```bash
# Open Terminal application
```

---

### Step 2: Navigate to Project Folder

```powershell
cd C:\Users\usEr\Downloads\The_green_haven
```

**Verify you're in the right place:**
```powershell
dir PHASE1_SETUP.bat
# Should show: PHASE1_SETUP.bat
```

---

### Step 3: Run the Automated Setup Script

```powershell
.\PHASE1_SETUP.bat
```

**What you'll see:**

```
🔐 SlipOK Security Migration - Phase 1 Setup
============================================================

✓ Node.js is installed
v18.17.0

✓ npm is installed
9.8.1

Step 1/3: Installing dependencies in functions/ directory...
npm notice
npm notice New minor version of npm available: 9.8.1 -> 10.2.4
...
npm packages installed
✓ Dependencies installed

Step 2/3: Firebase Login (if needed)
If you're already logged in, press Enter. Otherwise, sign in with your Google account.
```

---

### Step 4: Firebase Login (First Time)

**What to expect:**
1. Script asks you to login
2. Browser opens with Google sign-in
3. Select your Google account
4. Grant permissions to Firebase CLI
5. Browser shows "Success!"
6. Return to terminal

**If already logged in:**
- Press Enter to skip

**Save credentials:**
- Firebase CLI saves your token locally
- You won't need to login again

---

### Step 5: Enter SlipOK API Credentials

**Script prompts:**

```
Enter SlipOK API Key (press Enter to use default):
```

**Your options:**
- Option 1: Enter new API key if you have one
- Option 2: Press Enter to use default: `SLIPOK8P4B99Z`

**Then:**

```
Enter SlipOK API URL (press Enter to use default):
```

**Your options:**
- Option 1: Enter new API URL if you have one
- Option 2: Press Enter to use default: `https://api.slipok.com/api/line/apikey/62328`

---

### Step 6: Watch Environment Variables Being Set

**Script shows:**

```
Setting environment variables...
```

**Behind the scenes:**
```bash
firebase functions:config:set slipok.api_key="SLIPOK8P4B99Z"
firebase functions:config:set slipok.api_url="https://api.slipok.com/api/line/apikey/62328"
```

**What it means:**
- Firebase stores these securely (not in code)
- Cloud Function will access them from environment
- Can be updated later without code changes

---

### Step 7: Verify Environment Variables

**Script shows:**

```
✓ Environment variables set. Verifying:

{
  "slipok": {
    "api_key": "SLIPOK8P4B99Z",
    "api_url": "https://api.slipok.com/api/line/apikey/62328"
  }
}
```

**What to verify:**
- ✅ `slipok.api_key` is set
- ✅ `slipok.api_url` is set
- ✅ Values are correct

---

### Step 8: Cloud Function Deployment

**Script shows:**

```
Step 4/4: Deploying Cloud Function to Firebase...

This may take 1-2 minutes...
```

**What's happening:**
1. Cloud Function code being uploaded
2. Dependencies being installed in Firebase
3. Function being compiled
4. Function being registered
5. Routes being configured

**What you'll see:**
```
i  deploying functions
Running build script: npm --prefix "$RESOURCE_DIR" run build
...
✓ Function URL (verifySlip): https://us-central1-your-project-id.cloudfunctions.net/verifySlip
✓ Deployment complete
```

---

### Step 9: SAVE THE CLOUD FUNCTION URL ⭐

**This is CRITICAL for Phase 2!**

Look for line that says:
```
https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip
```

**Copy this URL** - you'll need it in Phase 2!

**Save it somewhere safe:**
- Paste into notepad
- Write it down
- Copy to clipboard

**Example:**
```
https://us-central1-green-haven-prod.cloudfunctions.net/verifySlip
```

---

### Step 10: Phase 1 Completion

**Script shows:**

```
✅ PHASE 1 COMPLETE!

📝 NEXT STEPS:
   1. Copy your Cloud Function URL from above
   2. Update SLIPOK_CLOUD_FUNCTION_URL in shared/slipok-secure-client.js
   3. Run PHASE2_UPDATE_HTML.bat

Press any key to continue...
```

---

## ✅ PHASE 1 SUCCESS INDICATORS

### What Should Happen

✅ **Dependencies Install**
- `npm install` completes without errors
- See "packages installed" or similar message

✅ **Firebase Login**
- Browser opens with Google sign-in (or skipped if already logged in)
- Returns to terminal successfully

✅ **Environment Variables Set**
- `firebase functions:config:set` commands execute
- Verify command shows your API credentials

✅ **Cloud Function Deploys**
- Deployment takes 1-2 minutes
- See "Function URL" line with your Cloud Function URL
- No error messages

✅ **Script Completes**
- "PHASE 1 COMPLETE!" message appears
- Cloud Function URL displayed

---

## ❌ TROUBLESHOOTING

### Issue: "npm: command not found"

**Cause:** Node.js/npm not installed or not in PATH

**Solution:**
1. Install Node.js from https://nodejs.org/
2. Restart computer
3. Try again

---

### Issue: "Firebase not found"

**Cause:** Firebase CLI not installed

**Solution:**
- Script should install automatically
- If not: `npm install -g firebase-tools`
- Try again

---

### Issue: "Permission denied" or "Access denied"

**Cause:** PowerShell execution policy

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# Then run: .\PHASE1_SETUP.bat
```

---

### Issue: "Firebase login failed"

**Cause:** Google account issue or browser problem

**Solution:**
1. Close browser if opened
2. Run in Command Prompt instead of PowerShell
3. Use different Google account
4. Check internet connection

---

### Issue: "Deployment failed"

**Cause:** Firebase project issue

**Solution:**
1. Check Firebase Console: https://console.firebase.google.com
2. Verify project exists and is active
3. Check you're logged in to correct account
4. Try deploying manually:
   ```bash
   firebase deploy --only functions:verifySlip
   ```

---

### Issue: "API key error"

**Cause:** Invalid SlipOK credentials

**Solution:**
1. Verify API key is correct: `SLIPOK8P4B99Z`
2. Verify API URL is correct
3. Contact SlipOK support if unsure

---

## 📊 WHAT'S BEING DEPLOYED

### Cloud Function Files

**From:** `functions/verifySlip.js`
- 398 lines of secure code
- Rate limiting logic
- Duplicate detection
- Firestore logging
- Amount validation

**Dependencies (will be installed):**
- firebase-admin (Firebase server SDK)
- firebase-functions (Cloud Functions framework)
- node-fetch (HTTP requests)
- form-data (File handling)

### Firebase Configuration

**Environment Variables Created:**
```
slipok.api_key = "SLIPOK8P4B99Z"
slipok.api_url = "https://api.slipok.com/api/line/apikey/62328"
```

**These are stored in Firebase, NOT in code**

---

## 🔒 SECURITY CHECK

### What's Being Protected

✅ **API Keys**
- Stored in Firebase environment variables
- Not in client code
- Not in version control
- Not visible in browser

✅ **Code**
- Deployed to Google's secure servers
- Encrypted in transit
- Run in isolated environment
- Monitored for issues

✅ **Data**
- User data not exposed
- Audit trail in Firestore
- Access controlled by Firebase rules

---

## 📝 AFTER PHASE 1 COMPLETES

### Immediate (Right after script finishes)

1. **Save Cloud Function URL**
   - Copy from terminal output
   - Paste into notepad for Phase 2
   - Example: `https://us-central1-green-haven-prod.cloudfunctions.net/verifySlip`

2. **Verify Deployment**
   - Go to: https://console.firebase.google.com
   - Select your project
   - Go to: Functions
   - Look for: "verifySlip" - should show green checkmark

3. **Optional: Check Logs**
   ```bash
   firebase functions:log
   ```
   - Should show deployment logs
   - Look for "Deployment complete"

### Next (Within 30 minutes)

1. **Update Cloud Function URL in code**
   - Open `shared/slipok-secure-client.js`
   - Find line 14
   - Replace `YOUR_PROJECT_ID` with your actual project ID
   - Example:
     ```javascript
     const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-green-haven-prod.cloudfunctions.net/verifySlip';
     ```

2. **Begin Phase 2**
   - Follow `PHASE2_UPDATE_HTML.md`
   - Update tenant.html and dashboard.html
   - Estimated time: 1 hour

---

## ⏱️ TIMELINE ESTIMATE

```
Start script:              0:00
Firebase login:            0:05-1:00 (depends on first-time auth)
Install dependencies:      1:00-2:00
Enter credentials:         2:00-2:30
Deploy Cloud Function:     2:30-4:00
Script complete:           4:00-4:30

TOTAL: 4-5 minutes (if already logged in)
       or 10-15 minutes (first-time Firebase login)
```

---

## ✨ SUCCESS CRITERIA

### Phase 1 is successful when:

✅ Script completes without errors
✅ Cloud Function URL is displayed
✅ Firebase Console shows "verifySlip" function deployed
✅ Environment variables are set (you can verify with: `firebase functions:config:get`)
✅ You have saved the Cloud Function URL

### Phase 1 is unsuccessful if:

❌ Script shows error messages
❌ No Cloud Function URL displayed
❌ Firebase Console doesn't show the function
❌ "Deployment failed" message

**If unsuccessful:** Run again or check Troubleshooting section

---

## 💡 TIPS FOR SUCCESS

1. **Stay Connected**
   - Don't close terminal during deployment
   - Keep internet connection stable
   - Don't interrupt the process

2. **Save Important Info**
   - Cloud Function URL (needed for Phase 2)
   - Your Firebase Project ID
   - SlipOK API credentials

3. **Don't Skip Steps**
   - Complete full Firebase login if prompted
   - Enter credentials exactly as shown
   - Wait for deployment to complete

4. **If Something Goes Wrong**
   - Read error message carefully
   - Check Troubleshooting section
   - Try running script again
   - Run `firebase login` manually if needed

---

## 🎯 WHAT'S NEXT AFTER PHASE 1

### Phase 2: Update HTML Files (1 hour)

**What you'll do:**
- Update `slipok-secure-client.js` with Cloud Function URL
- Modify `tenant.html` (3 sections)
- Modify `dashboard.html` (3 sections)
- Verify changes with search

**Where:** Follow `PHASE2_UPDATE_HTML.md`

### Phase 3: Remove API Keys (15 min)

**What you'll do:**
- Delete old API key constants
- Verify removal
- Commit to Git

**Where:** Follow `PHASE3_REMOVE_API_KEYS.md`

### Phase 4: Test & Verify (45 min)

**What you'll do:**
- Test both apps
- Verify rate limiting
- Check Firestore logging
- Sign off

**Where:** Follow `PHASE4_TEST_AND_VERIFY.md`

---

## 📞 GETTING HELP

### If Script Fails

1. **Check error message** - read it carefully
2. **See Troubleshooting** - section in this guide
3. **Check internet** - verify you're connected
4. **Try again** - sometimes temporary issues

### If You're Stuck

1. **Check Firebase Console** - verify project exists
2. **Run Firebase login** - re-authenticate
3. **Check Node.js** - verify installation
4. **Check Firestore** - ensure Firebase is set up

---

## 📋 CHECKLIST TO START PHASE 1

- [ ] Node.js installed (`node --version` works)
- [ ] npm installed (`npm --version` works)
- [ ] Terminal/PowerShell open
- [ ] In correct folder: `C:\Users\usEr\Downloads\The_green_haven`
- [ ] Have SlipOK API Key ready
- [ ] Have SlipOK API URL ready
- [ ] Have Google account for Firebase
- [ ] Ready to save Cloud Function URL
- [ ] Have 20 minutes available

**All checked?** → Run:

```powershell
.\PHASE1_SETUP.bat
```

---

## 🎉 YOU'RE READY!

Everything is prepared and documented. Phase 1 is automated and straightforward.

**Next action:** Open PowerShell and run `.\PHASE1_SETUP.bat`

This will deploy your secure Cloud Function and prepare for Phase 2.

**Estimated total time: 15-20 minutes**

Good luck! 🚀

