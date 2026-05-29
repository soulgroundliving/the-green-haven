# LIFF Auth Scaffold Extract — `shared/tenant-liff-auth.js`

**Status:** plan-first — awaiting ✅ from user. Do NOT edit code until approved.
**Triggered by:** B+ audit recommendation. Grade impact: B+ → A- if this + staging env done.

---

## Goal

Extract ~900-1,000 lines of LIFF auth scaffold out of `tenant_app.html` into `shared/tenant-liff-auth.js`.
No behavior change — pure file reorganization. Auth logic stays identical.

## Plan-First Threshold

- ✅ Touches 5+ files (tenant_app.html, shared/tenant-liff-auth.js [new], vercel.json/CSP, possibly build.js)
- ✅ Architectural change — moves core auth module
- ✅ Not trivially reversible if auth breaks for tenants
- **→ Plan-first required per §1**

---

## What Gets Extracted (line numbers from Explore — will re-verify before cutting)

| Block | Lines (approx) | Size | Content |
|-------|----------------|------|---------|
| Auth event hooks | 9552–9629 | ~78 | `_onLiffClaimsReady`, `_taDetectBuilding`, `_taNormalizeRoom`, `detectRoomBuilding` |
| Unlink + claim listeners | 10011–10170 | ~160 | `_applyPlayerMode`, `_applyUnlinkedMode`, `_setupUnlinkStatusListener`, `_setupClaimLossListener` |
| LIFF sign-in core | 10174–10401 | ~228 | `_callLiffSignIn`, UI overlay helpers |
| LIFF init + form flow | 10403–10848 | ~446 | `initLiffAndLink`, form submission, room select, link-status display, admin preview, `initTenantApp` |

**NOT extracting:** Firebase init (lines ~115–222) — foundational infrastructure, not purely LIFF-specific.

**Gap to investigate (Phase 0):** lines ~9630–10010 (~380 lines) — content unknown. May have auth-adjacent code that belongs in this file too.

**Total reduction:** ~912 lines → tenant_app.html shrinks from ~13,943 → ~13,031 lines.

---

## Phases

### Phase 0 — Read and scope (10 min)

- [ ] Read tenant_app.html lines 9550–10015 to understand the ~380-line gap between blocks
- [ ] Identify any auth-adjacent code in the gap that should also move
- [ ] Find the `<script>` load order in tenant_app.html — confirm position for new `<script>` tag
- [ ] Check `build.js` — confirm no bundling step needed for shared/*.js (currently loaded as separate `<script>` tags)
- [ ] Note the actual current line numbers (file grew 870 lines since Explore ran)

### Phase 1 — Create shared/tenant-liff-auth.js (30–45 min)

- [ ] Create file; copy extracted blocks in dependency order:
  1. Module-level state (`let _taRoom = ''`, `let _taBuilding = ''`, etc.)
  2. `_onLiffClaimsReady`
  3. `_taDetectBuilding`, `_taNormalizeRoom`, `detectRoomBuilding`
  4. `_applyPlayerMode`, `_applyUnlinkedMode`
  5. `_setupUnlinkStatusListener`, `_setupClaimLossListener`
  6. UI overlays: `_showAuthErrorBanner`, `_showLiffConnectingOverlay`, `_hideLiffConnectingOverlay`, `_showLiffErrorOverlay`
  7. `_callLiffSignIn`
  8. `initLiffAndLink`
  9. Form helpers: `submitLiffLinkRequest`, `_taPopulateLiffRoomSelect`, `_taWireLiffRoomSelect`, `showLiffLinkForm`, `showRelinkForm`, `submitRelinkRequest`, `showLiffLinkStatus`
  10. `_initAdminPreviewBar`
  11. `initTenantApp`
- [ ] Expose public API via `window.X`:
  ```js
  // Public — called from HTML onclick= attributes or other scripts
  window.detectRoomBuilding = detectRoomBuilding;
  window.initTenantApp = initTenantApp;
  window.submitLiffLinkRequest = submitLiffLinkRequest;
  window.submitRelinkRequest = submitRelinkRequest;
  window.showLiffLinkForm = showLiffLinkForm;
  window.showRelinkForm = showRelinkForm;
  window.showLiffLinkStatus = showLiffLinkStatus;
  window._onLiffClaimsReady = _onLiffClaimsReady;
  ```
- [ ] Private functions (`_callLiffSignIn`, `_applyPlayerMode`, etc.) stay module-internal (no `window.X` needed)
- [ ] Add file-top guard comment: `/* Loaded by tenant_app.html after Firebase SDK + LIFF SDK */`
- [ ] Syntax-check: `node --check shared/tenant-liff-auth.js`

### Phase 2 — Edit tenant_app.html (20–30 min)

- [ ] Insert `<script src="shared/tenant-liff-auth.js"></script>` in the correct position:
  - **After:** Firebase init script, LIFF SDK CDN script, all shared/*.js utilities it depends on (RoomConfigManager, BillStore, etc.)
  - **Before:** The DOMContentLoaded handler that calls `initTenantApp()`
- [ ] Delete the extracted function bodies from tenant_app.html (do NOT leave stubs or comments)
- [ ] Delete the extracted module-level `let _taRoom`, `_taBuilding`, etc. declarations
- [ ] Grep for any remaining references to confirm nothing was missed:
  ```bash
  grep -n "_callLiffSignIn\|initLiffAndLink\|_setupUnlinkStatusListener" tenant_app.html
  # should return 0 results after extraction
  ```

### Phase 3 — CSP hash regen (5 min)

Per §7-II — any inline `<style>` / `<script>` change to tracked HTML requires regen:
- [ ] `npm run csp:hash`
- [ ] `node tools/update-vercel-csp.js`
- [ ] `git add vercel.json tools/csp-hashes.json`

### Phase 4 — Verify (10–15 min)

- [ ] `git push origin main` → wait for Vercel deploy (check deploy succeeded at Vercel dashboard)
- [ ] Chrome MCP: open https://the-green-haven.vercel.app/tenant_app.html
- [ ] Console: zero JS errors on page load
- [ ] Console: `window.initTenantApp` resolves to a function (not undefined)
- [ ] Console: `window._onLiffClaimsReady` resolves to a function
- [ ] Admin: login as admin → confirm admin preview bar renders correctly
- [ ] **Ship gate:** no console errors; both public functions exposed; admin preview visible

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Script load order wrong | Phase 0: map exact `<script>` sequence before touching anything |
| `let` scope leak (§7-CC) | All public functions explicitly set `window.X = fn` |
| CSP hash drift (§7-II) | Phase 3 mandatory — pre-commit hook will also catch it |
| Missing function reference | Phase 2 grep verifies nothing calls moved functions from inline HTML |
| Firebase SDK not ready when file evaluates | New file just defines functions — no immediate calls; `initTenantApp()` is called from DOMContentLoaded |
| 380-line gap has mixed content | Phase 0 investigation — if mixed, extract only auth functions from it, leave rest |

---

## Rollback

```bash
git revert HEAD    # single commit, fast rollback
git push origin main
```

---

## Out of scope for this task

- Firebase init extract (different architectural decision, separate plan if desired)
- Reducing tenant_app.html further (gamification, billing modules — future work)
- Changing any auth behavior

---

## Why

Reduces tenant_app.html by ~900 lines. Establishes the pattern for future module extractions. Directly addresses the "God-file `tenant_app.html` 13,911 lines concentrates all risk" finding from the 9-dim audit (finding #1 in 2026-05-29 audit handoff).
