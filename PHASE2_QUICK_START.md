# ⚡ PHASE 2: QUICK START (5-Minute Overview)

**Use this:** If you've completed Phase 1 and want to start Phase 2 immediately
**Time:** 5 minutes to review before starting

---

## 📌 PHASE 2 IN 30 SECONDS

**What:** Update HTML files to use secure Cloud Function instead of direct SlipOK API
**Where:** `tenant.html` and `dashboard.html`
**Changes:** 3 sections per file
**Time:** ~1 hour
**Difficulty:** Easy (copy-paste code changes)

---

## 🎯 WHAT YOU'LL DO

### 1. Update Configuration (5 min)
**File:** `shared/slipok-secure-client.js`
**Line:** 14
**Change:** Replace URL with your Cloud Function URL

```javascript
// REPLACE THIS:
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip';

// WITH YOUR ACTUAL PROJECT ID:
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_REAL_PROJECT_ID.cloudfunctions.net/verifySlip';
```

### 2. Update Tenant App (30 min)
**File:** `tenant.html`
**Changes:**
- Line ~5016: Change function call
- Line ~5021: Replace function body
- Before `</body>`: Add import

### 3. Update Dashboard (30 min)
**File:** `dashboard.html`
**Changes:**
- Line ~7000: Update function
- Line ~8765: Update function
- Before `</body>`: Add import

---

## 📋 STEP-BY-STEP

### Start Phase 2:
```
1. Open: PHASE2_UPDATE_HTML.md (detailed instructions)
2. Gather: Your Cloud Function URL from Phase 1
3. Follow: Each step in order
4. Verify: Search for API keys (should find 0 results)
5. Commit: git commit -m "..."
```

### That's it! Then proceed to Phase 3.

---

## 🔧 TOOLS NEEDED

- Text editor (VS Code, Sublime, Notepad++)
- Your Cloud Function URL (saved from Phase 1)
- 1-2 hours available

---

## ⏱️ TIME BREAKDOWN

| Task | Time |
|------|------|
| Update slipok-secure-client.js | 5 min |
| Update tenant.html | 30 min |
| Update dashboard.html | 30 min |
| Verify changes | 10 min |
| Commit to Git | 5 min |
| **TOTAL** | **~1.5 hours** |

---

## ✅ SUCCESS = 3 Things

1. ✅ Both HTML files updated with new imports
2. ✅ Cloud Function URL configured in slipok-secure-client.js
3. ✅ No API keys visible in HTML files

---

## 📞 WHERE TO GET HELP

**Detailed Guide:** `PHASE2_UPDATE_HTML.md`
- Exact line numbers
- Before/after examples
- Verification commands

**Transition Guide:** `PHASE1_TO_PHASE2_TRANSITION.md`
- What to expect
- Troubleshooting
- Timeline

---

## 🚀 READY TO START?

**Open:** `PHASE2_UPDATE_HTML.md`

**Follow:** Step by step

**Verify:** Use search commands provided

**Commit:** Use git to save progress

---

## NEXT AFTER PHASE 2

✓ Phase 2: Update HTML (1 hour) ← YOU ARE HERE
→ Phase 3: Remove API keys (15 min)
→ Phase 4: Test & verify (45 min)

**Then: Production ready!**

