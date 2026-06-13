# Plan — Make `verifiedSlips` truly CF-only, then deny client writes

**Status:** **Phases 1–4 DONE** (branch `verifiedslips-cf-only` off `origin/main`). Phase 1+2 = both CFs (`recordManualPayment` + `clearRoomPaymentSlips`) + 19 tests + `PAYMENT_RESET` audit + index registration (`9d4b81b`). **Phase 3 = the 3 client sites rewired to call the CFs; Phase 4 = rule flipped to `allow write: if false` + rules test inverted.** Verified green: `test:rules` **344/344** (incl. the inverted "email admin CANNOT write directly"); payment-family functions tests **58/58** (recordManualPayment + clearRoomPaymentSlips + verifySlip + verifyDepositSlip). Still NO prod impact until deployed. **REMAINING: Phase 5 — owner-gated deploy in LOCKSTEP (CFs first, then rule).**
**Origin:** security review of `verifyDepositSlip.js` flagged `verifiedSlips/{id}` `allow write: if isAdmin();` lets a live admin browser token poison/forge/delete the SlipOK dedup fence (block a legit verify, plant a fake dedup record, corrupt the audit).
**Why the obvious one-liner was rejected:** grep gate (`feedback_rule_tighten_trace_clients`) found **3 live, wired admin client write/delete paths** that depend on the current rule. Flipping to `write: if false` would break all three AND fail `npm run test:rules` (the `email admin can write` → `assertSucceeds` test). Unlike the `actionAudit` sibling — which has **zero** client writers — `verifiedSlips` does.

**Core insight:** `submitManualVerify` lets an admin type an arbitrary `txid` and write a real-slip-shaped doc — "admin writes an arbitrary verifiedSlips doc" is a *shipped feature*, identical to the attack. A rule alone can't separate malicious from legitimate. The only real fix: move the writes server-side into admin callable CFs (Admin SDK bypasses rules), where a CF can enforce invariants a rule can't (refuse to clobber a CF-written SlipOK doc; server-stamp `verifiedBy`/`ip` from verified context; log audit). **Bonus:** manual payments + resets become auditable (today they're client writes with no server trail).

---

## The 3 client paths being moved (verified live + wired)

| # | Client fn | File:line | Op | Doc id |
|---|-----------|-----------|----|--------|
| 1 | `_mirrorPaymentToVerifiedSlips` (← `markRoomPaid` ← bill grid) | `shared/dashboard-bill-payment-status.js:70` | `setDoc merge` | `manual_<b>_<r>_<y>_<m>` (cash) / real ref (SlipOK) |
| 2 | `submitManualVerify` (bank-statement override modal) | `shared/dashboard-payment-verify.js:388` | `setDoc` | `mv_<ts>` / typed `txid` |
| 3 | `_deleteVerifiedSlipsForRoomMonth` (← reset room payment) | `shared/dashboard-bill.js:1290` | `deleteDoc` | deterministic ids + room-query-by-timestamp |

Path-1 SlipOK branch is redundant server-side (`verifySlip` already wrote the canonical dedup doc) → collapses into the same idempotent CF upsert.

---

## Design: 2 new admin callable CFs (SE1), then flip the rule

### Phase 1 — `recordManualPayment` CF (replaces paths 1-cash + 2) — ✅ DONE (`9d4b81b`)
- [ ] **New `functions/recordManualPayment.js`** — `functions.region('asia-southeast1').https.onCall`, admin-guard copied from `refundBill.js:58-65` (`context.auth.token.admin !== true` → `permission-denied`).
  - Input: `{ building, room, year, month, amount, mode: 'cash'|'override', txid?, sender?, bankCode?, receiptNo?, overrideReason?, slipMeta? }`. Validate at boundary (room, amount>0; `override` requires `overrideReason` + `txid` for traceability — mirror refundBill's "reason is part of the audit trail").
  - **Dedup-fence aware** (`verifyDepositSlip.js:295-310` pattern): `runTransaction` → `tx.get(verifiedRef)`; if an existing doc has no `manualEntry`/`manualOverride` flag (i.e. a CF-written SlipOK record), **return success without clobbering** (idempotent no-op) — never overwrite the canonical dedup record. Else upsert the manual doc.
  - **Server-stamp** `verifiedBy`/`verifiedAt`/`ip` from `context.auth.token` + `rawRequest.ip`, NOT client input (the current client sets `verifiedBy` from `SecurityUtils.getSecureSession()` — untrusted).
  - In-tx `appendActionAudit(tx, firestore, { action: 'BILL_PAID_MANUAL', targetType:'payment', targetId: txid, building, roomId, amount, source:'recordManualPayment', idempotencyKey })` — already a VALID_ACTION.
  - **Why:** one CF covers both the cash mirror and the bank-statement override (same operation, different metadata); the dedup guard is the actual security fix the rule couldn't express.
- [ ] **Export** `exports.recordManualPayment = require('./recordManualPayment').recordManualPayment;` at **top-level** in `functions/index.js` (§7-CCC: never indented, or CI skips it).
- [ ] **Unit test** `functions/__tests__/recordManualPayment.test.js` — mirror `verifyDepositSlip.test.js` tx-mock style: admin-guard rejects non-admin; cash upsert writes manual doc + audit; override requires reason; **dedup guard refuses to clobber an existing SlipOK doc**; idempotent re-call.

### Phase 2 — `clearRoomPaymentSlips` CF (replaces path 3) — ✅ DONE (`9d4b81b`)
- [ ] **New `functions/clearRoomPaymentSlips.js`** — same admin-guard + region. Input `{ building, room, year, month }`.
  - Admin SDK: delete deterministic `manual_*` ids + query `verifiedSlips where room == room`, filter by `timestamp`→(yearBE, month), delete matches (the `dashboard-bill.js:1290-1310` logic, server-side, no rules friction).
  - In-tx/batch `appendActionAudit({ action:'PAYMENT_RESET', ... })`.
- [ ] **Add `'PAYMENT_RESET'`** to `VALID_ACTIONS` in `functions/_actionAudit.js:53` (+ one-line comment). *(NOTE: `_actionAudit.js` is already modified on the deposit branch — see Risks re: branch.)*
- [ ] **Export** at top-level in `functions/index.js`. **Unit test** `functions/__tests__/clearRoomPaymentSlips.test.js`.

### Phase 3 — Rewire the 3 client sites to call the CFs — ✅ DONE
- [x] Reused the existing helper `window.firebase.functions.httpsCallable('<name>')` (set up SE1 at `dashboard.html:129` `getFunctions(app,'asia-southeast1')` → `:170`), same as `refundBill`/`voidInvoice`.
- [x] `_mirrorPaymentToVerifiedSlips` (`shared/dashboard-bill-payment-status.js`) → cash branch calls `recordManualPayment({mode:'cash'})`; **SlipOK branch now early-returns** (verifySlip already wrote the canonical doc — the old client mirror was pure redundancy). Kept non-fatal `.catch()` at the `markRoomPaid` call site.
- [x] `submitManualVerify` (`shared/dashboard-payment-verify.js`) → calls `recordManualPayment({mode:'override'})`; kept `bankConfirmed` gate + `ghAlert` UX; **made `txid` required** (the CF requires a bank ref in override mode — added to the field check + a `*` on the label); `receiptNo` now from `res.data.docId`; CF errors surface in the existing `catch`.
- [x] `_deleteVerifiedSlipsForRoomMonth` (`shared/dashboard-bill.js`) → calls `clearRoomPaymentSlips`; kept the client-state cleanup (`PaymentStore._remove`/`payment_status`/`_notify`/`renderPaymentStatus`).
- [x] **Self-conflict check (§7-G):** re-read all 3 diffs end-to-end — cash docId `manual_<bld>_<r>_<yearBE>_<m>` written by the markRoomPaid CF == the deterministic id the reset CF deletes (year is BE 4-digit, CF `toBE` no-ops); override `mv_<txid>` found by the reset's room+billing-month query. No broken assumption; the 3 callers don't consume a return value the old `setDoc`/`deleteDoc` gave. All 3 files pass `node --check`.

### Phase 4 — Flip the rule + tests (the actual ask) — ✅ DONE
- [x] `firestore.rules:317-320` → `allow write: if false;` + rewrote the comment (admin writes now go via the `recordManualPayment`/`clearRoomPaymentSlips` callables).
- [x] `firestore.rules.test.js` → `'email admin CANNOT write directly (CF-only via Admin SDK)'` is now `assertFails`; kept anon-cannot-write; admin-can-read untouched (separate block). Updated header-comment line 17.
- [x] `firebase emulators:exec --only firestore --project=demo-test 'npm run test:rules'` → **344/344 green**.
- [x] Payment-family functions tests → **58/58 green** (recordManualPayment + clearRoomPaymentSlips + verifySlip + verifyDepositSlip). No `functions/` code touched this phase, so the rest of the 2428-suite is unaffected.

### Phase 5 — Hand off for deploy (owner-gated)
- [ ] Deploy is owner-only and **must be all together** (rules + 2 CFs in lockstep — flipping the rule before the CFs deploy would break the 3 admin flows): `firebase deploy --only functions:recordManualPayment,functions:clearRoomPaymentSlips` **then** `firebase deploy --only firestore:rules`. I will NOT deploy — hand off with this exact sequence + a live-verify checklist (mark a cash payment, do a manual override, reset a room → all succeed; anon/admin direct console write → denied).
- [ ] Update `lifecycle_verifyslip.md` / `firestore_schema_canonical.md` + add a §7 stub if a new anti-pattern emerges. Handoff doc.

---

## Risks / open decisions
- **Branch (NEEDS YOUR CALL):** current branch is `deposit-premovein-phase1` (pushed, unmerged) with uncommitted deposit work touching the SAME files this plan edits (`functions/index.js` append points, `functions/_actionAudit.js` VALID_ACTIONS, `firestore.rules`). Options: **(a)** fresh branch off `origin/main`, ship this pre-existing security fix independently (later merge-conflicts the deposit branch on those 3 files); **(b)** stack on the deposit branch (couples a security fix to an unrelated feature PR); **(c)** wait until the deposit branch merges, then branch off updated main. Recommend **(c)** if deposit merges soon, else **(a)**.
- **Latency:** client `setDoc`/`deleteDoc` → callable round-trip (SE1). Negligible for admin ops; the cash-mirror stays non-fatal.
- **Behavior parity:** the CF must reproduce the exact doc shape PaymentStore + the ออกบิล grid read (`timestamp` inside billing month for yearBE/month derivation; `manualEntry`/`manualOverride` flags). Port field-by-field from the 3 sources, not from memory (§7-H).
- **No §7-I issue:** CFs fire on the existing explicit admin button/modal click — no programmatic auto-click; the preview→wait-for-click UX is unchanged.

## Scope this plan does NOT cover
- Migrating the one-shot `tools/migrations/done/backfill-verifiedSlips-from-rtdb.js` (already in `done/`, runs via Admin SDK/node — unaffected by the rule).
- Touching `verifySlip`/`verifyBookingSlip`/`verifyDepositSlip` write logic (they already use Admin SDK; the rule change is transparent to them).
