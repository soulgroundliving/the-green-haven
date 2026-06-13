# Plan — Make `verifiedSlips` truly CF-only, then deny client writes

**Status:** awaiting approval (plan-first: security rule + auth-model change, 5+ files, not single-revert).
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

### Phase 1 — `recordManualPayment` CF (replaces paths 1-cash + 2)
- [ ] **New `functions/recordManualPayment.js`** — `functions.region('asia-southeast1').https.onCall`, admin-guard copied from `refundBill.js:58-65` (`context.auth.token.admin !== true` → `permission-denied`).
  - Input: `{ building, room, year, month, amount, mode: 'cash'|'override', txid?, sender?, bankCode?, receiptNo?, overrideReason?, slipMeta? }`. Validate at boundary (room, amount>0; `override` requires `overrideReason` + `txid` for traceability — mirror refundBill's "reason is part of the audit trail").
  - **Dedup-fence aware** (`verifyDepositSlip.js:295-310` pattern): `runTransaction` → `tx.get(verifiedRef)`; if an existing doc has no `manualEntry`/`manualOverride` flag (i.e. a CF-written SlipOK record), **return success without clobbering** (idempotent no-op) — never overwrite the canonical dedup record. Else upsert the manual doc.
  - **Server-stamp** `verifiedBy`/`verifiedAt`/`ip` from `context.auth.token` + `rawRequest.ip`, NOT client input (the current client sets `verifiedBy` from `SecurityUtils.getSecureSession()` — untrusted).
  - In-tx `appendActionAudit(tx, firestore, { action: 'BILL_PAID_MANUAL', targetType:'payment', targetId: txid, building, roomId, amount, source:'recordManualPayment', idempotencyKey })` — already a VALID_ACTION.
  - **Why:** one CF covers both the cash mirror and the bank-statement override (same operation, different metadata); the dedup guard is the actual security fix the rule couldn't express.
- [ ] **Export** `exports.recordManualPayment = require('./recordManualPayment').recordManualPayment;` at **top-level** in `functions/index.js` (§7-CCC: never indented, or CI skips it).
- [ ] **Unit test** `functions/__tests__/recordManualPayment.test.js` — mirror `verifyDepositSlip.test.js` tx-mock style: admin-guard rejects non-admin; cash upsert writes manual doc + audit; override requires reason; **dedup guard refuses to clobber an existing SlipOK doc**; idempotent re-call.

### Phase 2 — `clearRoomPaymentSlips` CF (replaces path 3)
- [ ] **New `functions/clearRoomPaymentSlips.js`** — same admin-guard + region. Input `{ building, room, year, month }`.
  - Admin SDK: delete deterministic `manual_*` ids + query `verifiedSlips where room == room`, filter by `timestamp`→(yearBE, month), delete matches (the `dashboard-bill.js:1290-1310` logic, server-side, no rules friction).
  - In-tx/batch `appendActionAudit({ action:'PAYMENT_RESET', ... })`.
- [ ] **Add `'PAYMENT_RESET'`** to `VALID_ACTIONS` in `functions/_actionAudit.js:53` (+ one-line comment). *(NOTE: `_actionAudit.js` is already modified on the deposit branch — see Risks re: branch.)*
- [ ] **Export** at top-level in `functions/index.js`. **Unit test** `functions/__tests__/clearRoomPaymentSlips.test.js`.

### Phase 3 — Rewire the 3 client sites to call the CFs
- [ ] Find the dashboard's existing `httpsCallable` helper (how `refundBill`/`voidInvoice` are invoked from `shared/dashboard-*.js`) — reuse it, SE1 region.
- [ ] `_mirrorPaymentToVerifiedSlips` → call `recordManualPayment` (keep non-fatal `.catch()` for the cash mirror so a paid-mark UI never hard-fails on a mirror hiccup).
- [ ] `submitManualVerify` → call `recordManualPayment` with `mode:'override'`; keep the `bankStatementConfirmed` gate + `ghAlert` UX; surface CF errors in the existing `catch`.
- [ ] `_deleteVerifiedSlipsForRoomMonth` → call `clearRoomPaymentSlips`; keep the local cache/`PaymentStore._remove`/`payment_status` cleanup + re-render (those are client-state, stay client-side).
- [ ] **Self-conflict check (§7-G):** re-read all session diffs end-to-end — the paid-mark → grid-refresh → reset flow spans these 3 files + PaymentStore; confirm no broken assumption (e.g. a caller awaiting a return value the old `setDoc` gave).

### Phase 4 — Flip the rule + tests (the actual ask)
- [ ] `firestore.rules:319` → `allow write: if false;` + fix the stale comment (`// CF writes, admin reads` → note admin writes go via `recordManualPayment`/`clearRoomPaymentSlips` callables).
- [ ] `firestore.rules.test.js:367-375` → `'email admin can write'` becomes **admin direct-write now FAILS** (`assertFails`); keep anon-cannot-write; keep admin-can-read. Update the header-comment line 17.
- [ ] `npm run test:rules` → **green**.
- [ ] `npm test` (functions) → new CF tests + existing verifySlip/verifyDepositSlip/verifyBookingSlip suites green.

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
