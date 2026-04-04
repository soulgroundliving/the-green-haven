# 🔐 Phase 3: Remove Exposed API Keys

**Estimated Time:** 15 minutes
**Status:** Ready to execute manually
**Risk Level:** LOW (Cloud Function already in place, fallback available)

---

## Prerequisites

✅ Phase 2 must be complete:
- HTML files updated to use Cloud Function
- `slipok-secure-client.js` imported in both HTML files
- Cloud Function URL verified and configured
- Old function calls replaced

---

## Step 3.1: Remove API Keys from Dashboard

**File:** `dashboard.html`
**Location:** Around line 6943-6944

**Find and delete these lines:**
```javascript
const SLIPOK_URL = 'https://api.slipok.com/api/line/apikey/62328';
const SLIPOK_KEY = 'SLIPOK8P4B99Z';
```

⚠️ **Important:** Delete completely - these are no longer needed

✅ **Verify:** Search for `SLIPOK_URL` in dashboard.html → Should find 0 results

---

## Step 3.2: Remove API Keys from Tenant App

**File:** `tenant.html`
**Location:** Around line 5039-5042 (inside the old verifySlipWithSlipOK function)

**Find these lines:**
```javascript
const slipokUrl = 'https://api.slipok.com/api/line/apikey/62328';
const slipokKey = 'SLIPOK8P4B99Z';
```

**Delete them completely**

Alternative if they're in a fetch call:
```javascript
fetch('https://api.slipok.com/api/line/apikey/62328', {
  headers: {
    'x-api-key': 'SLIPOK8P4B99Z'
  }
})
```

**Delete the entire old fetch call if it exists**

✅ **Verify:** Search for `SLIPOK8P4B99Z` in tenant.html → Should find 0 results

---

## Step 3.3: Delete Old Function Bodies (Keep as Comments)

Since we already replaced the old functions in Phase 2, now delete their implementation bodies.

**In `tenant.html`:** Around line 5021-5071
- Keep the function signature as a comment
- Delete the implementation code

**Example:**
```javascript
/*
// OLD FUNCTION - DEPRECATED 2026-04-04
// Replaced by verifySlipSecureApp() in slipok-secure-client.js
async function verifySlipWithSlipOK(slipImage, file) {
  // DELETED - Implementation moved to Cloud Function
}
*/
```

---

## Step 3.4: Final Cleanup

### Search and Verify

1. **Search for remaining API key references:**
   ```
   Search for: SLIPOK8P4B99Z
   Result: Should be 0 (or only in SLIPOK_SECURITY_MIGRATION_GUIDE.md)
   ```

2. **Search for old API URL:**
   ```
   Search for: api.slipok.com
   Result: Should be 0 (or only in SLIPOK_SECURITY_MIGRATION_GUIDE.md)
   ```

3. **Search for environment variable references (should still exist):**
   ```
   Search for: SLIPOK_API_KEY
   Result: Should find only in functions/verifySlip.js
   ```

✅ **Expected Result:** No API keys in client-side code, all in backend only

---

## Fallback Safety

If something goes wrong in Phase 3:

**Option 1: Quick Restore**
- Undo all Phase 3 changes (Ctrl+Z or Git revert)
- HTML files will still use Cloud Function
- No impact on functionality

**Option 2: Hybrid Mode**
- Keep old code in comments (as shown above)
- If Cloud Function fails, can uncomment and use old code temporarily
- Gives time to fix any issues

---

## Verification Checklist

- [ ] `SLIPOK_URL` removed from dashboard.html
- [ ] `SLIPOK_KEY` removed from dashboard.html
- [ ] SlipOK API endpoint removed from tenant.html
- [ ] Old function implementation deleted (kept as comments)
- [ ] Search for `SLIPOK8P4B99Z` returns 0 results
- [ ] Search for `api.slipok.com` returns 0 results
- [ ] Search for `SLIPOK_API_KEY` returns matches only in functions/verifySlip.js

---

## Commit to Git

Once verified, commit the changes:

```bash
git add -A
git commit -m "fix: Remove exposed SlipOK API keys from client code

- Deleted SLIPOK_URL and SLIPOK_KEY constants from dashboard.html
- Removed API credentials from tenant.html
- Replaced with secure Cloud Function calls
- All API keys now stored in Firebase environment variables only

Security improvement: API credentials no longer visible in browser DevTools"
```

---

## Next Step

Once Phase 3 is verified and committed:
→ **Run PHASE4_TEST_AND_VERIFY.md**

This is the final phase that ensures everything works correctly before production deployment.

