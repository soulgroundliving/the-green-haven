# 9-Dimension Re-Audit Remediation Plan (run 2)

> **▶ NEW forward-looking program (2026-06-02):** [core-readiness-roadmap.md](core-readiness-roadmap.md) — Core readiness for "เปิดตรวจจริง" (accountant/tax/investor) + the blueprint's 3 future features (Behavioral Intelligence · Trust System · Autonomous Ops). ✅ approved 2026-06-02; **Phase 0 (pointsLedger append-only event log) shipped** (PR #227 `96ca28a`, deployed). This file below = the (mostly-done) 9-dim audit remediation.

---

## ▶▶▶ ACTIVE PLAN (2026-06-03) — Roadmap Phase 2: Revenue categories (`otherIncome` reconcile) · ✅ SHIPPED to branch (stacked on #240) · PR pending

**Scope:** roadmap Phase 2 "Revenue categories". **Re-scoped after data-reality check** (user-approved): pet fee + marketplace fee have NO charge field (grep 0) → can't be categories. The real gap = `aggregateMonthlyRevenue` sums only rent/elec/water/trash but `totalRevenue` = bill total (incl. `lateFee`/`other`/`common`) → the category breakdown doesn't reconcile to the total. Fix = add `otherIncome = max(0, total − rent − elec − water − trash)`.

### Shipped
- **CF** `aggregateMonthlyRevenue.js`: `otherIncome` in month + annual + byBuilding buckets (reconciling remainder) + JSDoc. +2 reconciliation tests (**30/30**).
- **Readers** `tax-filing.html`: report table gains an "อื่นๆ" column (header + per-room computed + total row); CSV export gains "รายได้อื่นๆ". **§7-L** compute-if-missing fallback (`data.otherIncome ?? max(0, total−sum4)`) so pre-existing taxSummary docs reconcile without re-aggregation.
- CSP regen (§7-II — tax-filing.html inline changed). `lifecycle_tax_filing.md` schema + verifier updated.

### Deferred (no data — named, not dropped)
pet fee / marketplace fee as distinct categories — need upstream fee-capture (no `charges.petFee`/commission field exists). `other`/`common`/`lateFee` all roll into `otherIncome` for now.

### Gate
node --check ✓ · CF tests 30/30 ✓ · mojibake 0 ✓ · CSP regen ✓ · stacked on #240 → clean separate diff (+58/−17).

### Open (owner)
merge (after #240) = Vercel deploy → optionally re-run `aggregateMonthlyRevenue` HTTP (admin) to persist `otherIncome` into existing taxSummary docs (client fallback covers the read meanwhile); live-verify report table + CSV show อื่นๆ reconciling to รวม.

### Review
Shipped to branch `feat/phase2-revenue-categories`. Discovery: the roadmap's 3 named categories were ~⅓ buildable (pet/marketplace fee = no data); delivered the achievable reconciliation (`otherIncome`) + named the deferred. Next Phase 2: reconcile report · refund flow · per-tenant arrears/aging.

---

## ▶▶▶ ACTIVE PLAN (2026-06-03) — Roadmap Phase 2: Remove dead 15%-corporate tax path · 🚧 EXECUTING (branch `feat/phase2-remove-dead-corporate-tax`)

**Scope:** roadmap Phase 2 "Remove dead 15%-corporate path". Pivoted here from "Thai-font PDF" — the Sarabun jsPDF patch's ONLY live consumers are the corporate text-PDF exports targeted here, so this PR retires BOTH roadmap items. Goal: kill auditor-confusing corporate forms (ป.พ.6 quarterly + ภ.ป.ภ.50 annual + 15% flat calc) that contradict the live personal **ภ.ง.ด.90 progressive** model.

### Verified this session (grep + read, file:line — §7-EE checked)
- **Override = wholesale replacement** (`tax-filing.html:1145/1159/1170`): `window.calculateXIncomeTax = progressive ภ.ง.ด.90`, never calls original, `rate` param ignored → 15% bodies (`tax-filing.js:416/450/504`) DEAD at runtime.
- **§7-EE:** bareword calc callers (`generateMonthlyTaxReport:550`, `loadTaxDashboard:909`) resolve to `window.X` = override → progressive. Live path confirmed not-15%.
- **Sarabun patch vestigial:** only live jsPDF on page = `downloadCurrentReportAsPDF:1762` (html2canvas → addImage, no `.text`/`.autoTable`). Deleting corporate text exports leaves no Thai-text jsPDF consumer → patch + jsdelivr fetch removable (closes Thai-font item).
- `calculateQuarterlyIncomeTax` callers = only `generateQuarterlyReturn:616` + `getQuarterlyBreakdown:874` (both deleted) → orphan → delete.
- **KEEP (shared/live):** `calculateMonthlyIncomeTax`+`calculateAnnualIncomeTax` (seed + override — live via §7-EE; dashboard KPI `:909`) · `getFullYearExpenseBreakdown` (dashboard chart `:1006`) · `formatCurrency`/`_getOwnerForPDF`/`showError`/`showSuccess` (monthly Excel + overridden) · all monthly funcs + `downloadCurrentReportAsPDF` + `exportMonthlyReportExcel` + `estimateThaiPersonalTax`.

### DELETE (Option 1 — forms-only, minimal-blast-radius)
- **tax-export.js:** `exportQuarterlyReturnPDF` · `exportAnnualReportPDF` · `exportAnnualReportExcel` · orphaned `exportMonthlyReportPDF` (§7-K) · `_addPDFLetterhead` (only dead callers).
- **tax-filing.js:** `calculateQuarterlyIncomeTax` · `generateQuarterlyReturn` · `displayQuarterlyReturn` · `generateAnnualReport` · `displayAnnualReport` · `getQuarterlyBreakdown` + **export-manifest entries `:1850/:1853/:1854`** (⚠️ object literal refs deleted names → remove same edit or ReferenceError).
- **tax-filing.html:** quarterly-page · annual-page · sidebar quarterly+annual · dashboard shortcuts · dispatch handlers (5 branches) · quarterly override + Sarabun font patch + jsdelivr fetch (`:1170-1247` contiguous).
- **KEEP** monthly/annual income-tax overrides (`:1145-1169`) — live.

### Gate (pre-deploy)
`node --check` both JS · re-grep **0 dangling callers** of every deleted name · re-grep **no other `.text(`/`.autoTable(`/`new jsPDF`** in tax-filing.html before removing patch · `test:shared` + functions + `verify:memory` green · **§7-II CSP regen** (tax-filing.html inline `<script>` changed → `npm run csp:hash && node tools/update-vercel-csp.js` same commit; pre-commit §G confirms).

### Guardrails
§7-II CSP regen · §7-K verify 0 callers · §7-EE keep monthly/annual calc seeds · minimal-blast-radius · owner live-verify (auth-gated tax page, §7-I): monthly report + dashboard KPI still render via override; quarterly/annual pages + sidebar gone; monthly PDF export still works.

### Review (2026-06-03 — SHIPPED to branch · PR #240 · ⏳ awaiting merge=deploy)
- **PR [#240](https://github.com/soulgroundliving/the-green-haven/pull/240)** (`444634d`, −1201/+35) — removes the dead 15%-corporate path AND retires the now-vestigial Sarabun jsPDF patch → **closes the "Thai-font PDF" roadmap item too** (both in one PR).
- **Removed:** tax-export.js (3 jsPDF exports + orphaned `exportMonthlyReportPDF` + `_addPDFLetterhead`) · tax-filing.js (`calculateQuarterlyIncomeTax` + generate/display Quarterly+Annual + `getQuarterlyBreakdown` + manifest entries) · tax-filing.html (quarterly/annual pages, sidebar, shortcuts, dispatch, quarterly override + Sarabun patch + jsdelivr fetch, orphaned `fillYearSelect('annual-year')`).
- **Kept (live):** monthly report (html2canvas PDF — Thai via CSS `font-family:Sarabun` web font + Excel), dashboard KPI, monthly/annual calc seeds + progressive overrides (§7-EE), `getFullYearExpenseBreakdown`.
- **Gates:** node --check ✓ · 0 dangling callers (grep) ✓ · test:shared 319/319 ✓ · verify:memory green ✓ · CSP regen §7-II ✓ · pre-commit all green.
- **Discovery:** the roadmap's "Thai renders as boxes" premise was already false — a Sarabun jsPDF patch existed + worked (jsdelivr 200 + CSP `connect-src https:` ok); its ONLY consumers were the corporate forms removed here. Monthly PDF was always html2canvas (Thai-safe).
- **Architecture doc:** `lifecycle_tax_filing.md` updated (3 pages, monthly-only exports, no jsPDF patch; verifiers fixed — old line-166 OR-grep was a §7-J trivially-passing trap masking 3 dead terms via surviving `AuditLogger.log`).
- **⏳ Open:** merge = Vercel deploy (live tax page → user-confirm) → owner live-verify (auth-gated, §7-I — agent can't drive): dashboard + monthly report render via override; sidebar = Dashboard/รายงานเดือน/หัก ณ ที่จ่าย/เช็คลิสต์ only; monthly PDF Thai intact.
- **Phase 2 remaining:** refund flow · per-tenant arrears/aging · revenue categories · reconcile report · ~~Thai-font PDF~~ (resolved here).

---

## ▶▶▶ ACTIVE PLAN (2026-06-02) — Roadmap Phase 1.4: ToS + Privacy consent + DSR wiring · ✅ ALL SLICES SHIPPED + DEPLOYED (A #236 · B #237 · C1 #238 · C2 #239) — see Review below

**Scope:** the PDPA + investor-facing gap from `core-readiness-roadmap.md` §1.4. **3 slices, gate-first (3 PRs, each behind `validate.yml`)** — user-chosen 2026-06-02. **ToS = scaffold + placeholder** (I build the page structure + standard headings + clearly-marked placeholders; the owner/lawyer fills the legal text — I do NOT fabricate legal wording).

### Verified state (3 Explore agents, grep-checked this session — incl. stale-roadmap corrections)
- **Consent infra exists + reusable:** `recordChecklistConsent.js` (v1 onCall SE1, `_authSoT` tenant-gated) writes `consents/{tenantId}_{purpose}` `{tenantId,authUid,room,building,purpose,noticeVersion,consentedAt,userAgent}`; `VALID_PURPOSES = Set(['checklist_v1'])` (`:25`), registered `index.js:218`. Rule `consents/` (`firestore.rules:721-732`) = admin-read OR tenant authUid/tenantId match · write:false → **a new purpose needs NO rule change.** ⚠️ **No `consents` describe block in `firestore.rules.test.js`** → must ADD rules tests.
- **`privacy.html` = a REAL PDPA policy** (5 sections, effective 1 พ.ค. 2568) but **linked from NOWHERE** (login/index/booking/tenant_app = 0 refs, grep-confirmed). ⚠️ `dashboard.html` has an admin editor `policy-admin-privacy` → **verify whether privacy.html renders STATIC HTML or loads admin-edited text before editing the data-inventory** (else the fix belongs in the editable source).
- **No legal ToS exists** — tenant_app `cleaning-terms-page` (`:3198`) is a cleaning-service manual, not ToS.
- **`exportMyData` (DSR §30) = confirmed §7-K orphan** (0 callers). v1 onCall SE1, `_authSoT` tenant-scoped, returns a full JSON (person/tenant/lease/liffUser/checklists/consents/complaints/maintenance/bills; storage paths listed, not inlined). `index.js:221`.
- ⚠️ **ROADMAP STALE — national ID:** the ID *number* is NOT collected anywhere. What IS collected (undisclosed in privacy.html): **ID-card PHOTOS** (`idCardFront`/`idCardBack`, required), `houseReg`, `employmentLetter` → Storage `bookings/{id}/kyc/` (`submitBookingKyc.js`), + `prospectLineId`. The data-inventory fix discloses THOSE.
- **Consent-gate auth nuance:** booking prospects are anonymous (no room claim) until `createBookingLock` → they CANNOT call `recordChecklistConsent` (`_authSoT` needs tenant claims). So booking consent must be recorded **in `createBookingLock`** (prospect context); tenant first-run consent uses `recordChecklistConsent` (new purpose, tenant has claims).

### Slice A — link privacy + ToS scaffold + data-inventory fix (PR A, content-only, lowest risk)
- [ ] **`terms.html`** (new, NOT in the CSP-tracked 8) — ToS scaffold mirroring `privacy.html` structure (muji-minimal): standard headings (acceptance · service desc · tenant obligations · payment · liability · termination · governing law · contact) with **`[รอข้อความจริง — …]` placeholders**. *Why scaffold:* legal text is the owner's/lawyer's; I wire the plumbing, not the wording.
- [ ] **`privacy.html` data-inventory fix** — add the collected-but-undisclosed items (ID-card photos front/back, house registration, employment letter, LINE User ID) to the "ข้อมูลที่เราเก็บ" section (`:203-235`). *Why:* PDPA data-inventory must match what's actually collected (`submitBookingKyc.js`). **First verify static vs admin-editable** (the `policy-admin-privacy` editor).
- [ ] **Link privacy.html + terms.html** from `login.html` / `index.html` / `booking.html` (footer) + tenant_app `page-privacy`/settings. *Why:* PDPA §19 needs the notice reachable; investor-facing. **CSP: `<a href>` is markup, no inline-block change → no hash drift** (§7-II) — confirm with the pre-commit §G check.
- [ ] Live-verify links resolve on Vercel (3 entry pages + tenant_app).

### Slice B — DSR `exportMyData` wiring (PR B, closes the §7-K orphan) · ✅ BUILT
- [x] **`shared/tenant-data-export.js`** → `window.exportMyDataPrompt()`: `httpsCallable('exportMyData')({})` → Blob (NOT `data:` — §7-Y) → `<a download>` `nature-haven-my-data-{date}.json`. §7-N error→`window.toast`. **Self-wires** the menu item by id (click + Enter/Space a11y) — does NOT touch the inline delegation hub (5420), so no CSP drift.
- [x] **`tenant_app.html` settings** (`.menu-list` `:4067`) — a "ดาวน์โหลดข้อมูลของฉัน (JSON · PDPA §30)" menu-item (`id="btn-export-my-data"`, role=button/tabindex) beside the Privacy Policy item. **No `data-action`** (self-wired, not hub) → avoids editing the inline hub.
- [x] **`<script src>`** `./shared/tenant-data-export.js` (defer, after tenant-cleaning). §7-K orphan closed (grep: caller now at `tenant-data-export.js:26`). **CSP: markup + external src only → no drift** (pre-commit §G to confirm).
- [ ] **Deferred / owner:** §30 wording self-service mention belongs in `system/policies.privacy` (admin-edited in-app copy, dashboard Policies tab) — not the static embedded FAQ (it's overwritten by the SSoT). Standalone privacy.html §30 left as-is.
- [ ] Live-verify (owner, §7-A — agent can't drive LIFF): tenant opens Settings → ดาวน์โหลด → JSON file of own data only. (LIFF webview `<a download>` — confirm it triggers; fallback if blocked.)

### Slice C — consent acceptance gate (PR C)
- [x] **Booking gate (prospect, blocking)** [C2 #239] — `booking.html` Step 2 modal: a required "ยอมรับ [นโยบายความเป็นส่วนตัว] + [ข้อตกลงการใช้งาน]" checkbox (links to privacy/terms) gating the lock button. Record consent **in `createBookingLock`** (the CF where prospect identity exists — NOT recordChecklistConsent, which needs tenant claims): persist `consentAcceptedAt`/`consentVersion` on the `bookings/{id}` doc. *Why here:* prospect is anonymous pre-lock; the booking doc is the consent record-of-proof. ⚠️ **CSP: the Step-2 submit handler is inline script in booking.html → editing it drifts the hash → `npm run csp:hash && node tools/update-vercel-csp.js` in the same commit (§7-II).**
- [x] **Tenant first-run gate (info)** [C1 #238] — a one-time consent acknowledgment in `tenant_app.html` (hook the existing `GhTour`/first-run, localStorage-gated) → `recordChecklistConsent({purpose:'account_v1', noticeVersion})` (add `'account_v1'` to `VALID_PURPOSES`). §7-A claims-gated. *Why:* demonstrable ongoing-use consent for existing tenants (PDPA §19).
- [x] **`recordChecklistConsent.js`** [C1 #238] — added `'account_v1'` to `VALID_PURPOSES` (+ unit test). **`firestore.rules.test.js`** — ADDED a `consents` describe block (admin read-all · tenant authUid/tenantId-claim read own · cross-tenant denied · client write/update/delete denied) — 271/0 total (README 249→256).
- [ ] Live-verify (owner): booking submit writes `consentAcceptedAt`; tenant first-run writes `consents/{tenantId}_account_v1`.

### Decisions to confirm (at approval)
1. **Tenant first-run consent purpose name** — `account_v1` **[proposed]** vs `tos_privacy_v1` / `terms_v1`.
2. **Booking consent storage** — on the `bookings/{id}` doc via `createBookingLock` **[recommended — prospect has no tenant claim]** vs a separate `consents/` row (needs an anon-callable variant).
3. **ToS reachability** — standalone `terms.html` **[recommended, mirrors privacy.html]** vs a `page-terms` section inside tenant_app.

### Guardrails
§7-I (no auto-`.click()`) · §7-A/§7-U (tenant gates via `_onLiffClaimsReady` + claim guard; live-verify on real LINE) · §7-K (wire exportMyData = close the orphan) · §7-T (consent writer+reader) · §7-II (**Slice C booking.html inline-handler → CSP regen**; Slice A/B markup+external only → no drift) · §7-Z N/A · gate-first A→B→C, each behind `validate.yml` · ToS legal text is owner-supplied (scaffold only).

### Review (2026-06-02 — ALL SLICES SHIPPED + DEPLOYED)
- **A** (PR [#236](https://github.com/soulgroundliving/the-green-haven/pull/236) `7ba1905`): `privacy.html` KYC-photo data-inventory + `terms.html` scaffold (placeholders — owner fills legal) + `login.html` `.page-legal-footer` → privacy/terms. Content-only, no CSP drift.
- **B** (PR [#237](https://github.com/soulgroundliving/the-green-haven/pull/237) `a8556fb`): `shared/tenant-data-export.js` `window.exportMyDataPrompt()` (httpsCallable → Blob → `<a download>`) + Settings menu item — closes the §7-K `exportMyData` orphan. Self-wired, no CSP drift.
- **C1** (PR [#238](https://github.com/soulgroundliving/the-green-haven/pull/238) `13eca99`): tenant first-run `account_v1` consent — `recordChecklistConsent` VALID_PURPOSES + `shared/tenant-consent.js` (`window.maybePromptAccountConsent`, GhModal + localStorage + fire-and-forget; **self-wired via `window._onLiffClaimsReady` → no CSP drift**, `<script src>` only) + `consents` rules describe block. CF deployed; prod probe → UNAUTHENTICATED.
- **C2** (PR [#239](https://github.com/soulgroundliving/the-green-haven/pull/239) `dd74681`): booking-prospect gate — `booking.html` Step 2 required `#modalConsent` checkbox (privacy+terms links) gating the lock + `createBookingLock` enforces `consentAccepted===true` for prospects (admin exempt) + persists `consentAcceptedAt`/`consentVersion` on `bookings/{id}`; +4 CF tests; CSP regen (booking inline `<script>`/`<style>` changed). Money-flow CF deployed; prod probe → UNAUTHENTICATED.
- **Decisions taken (as approved):** purpose `account_v1` · booking consent on the `bookings/{id}` doc (prospect has no tenant claim) · ToS = standalone `terms.html`.
- **Gates:** functions 1886/0 · rules 271/0 (README 249→256) · shared 319/0 · verify:memory 0 fail · CSP in sync (pre-commit §G). Both CF prod deploys success (deploy-functions.yml).
- **Sequencing-safe deploy:** C1 then C2 (disjoint files; C1 had no CSP change → no cross-drift). Each merged on green CI; Vercel ships the client before the CF lands so no broken window.
- **Open (owner live-verify, §7-A/§7-I — agent can't drive LIFF / the booking money flow):** ① tenant first-run → GhModal → ยอมรับ → `consents/{tenantId}_account_v1` row written. ② booking Step 2 → checkbox required → lock → `bookings/{id}.consentAcceptedAt` set. ③ fill `terms.html` legal text + mirror KYC disclosure into `system/policies.privacy` (dashboard Policies tab) for the in-app copy.
- **Architecture docs:** lifecycle_pdpa_checklist (account_v1 + booking consent + exportMyData self-serve restore) + lifecycle_booking_flow (consent fields) + handoff next_session_handoff_2026_06_02_phase_1_4_pdpa.
- **Next (roadmap):** Phase 2 — accountant FAQ (refund / arrears-aging / revenue-categories / reconcile / Thai-font-PDF).

---

## ▶▶ ACTIVE PLAN (2026-06-02) — Roadmap Phase 1.2 (gapless INVOICE number `INV-`) + 1.3 (void bill with trail) · ✅ SHIPPED + DEPLOYED (PR #235 `d5c15c6`) — see Review below

**Scope:** the next two tax blockers from `core-readiness-roadmap.md` (recommended order step 3). They are **coupled** ("shared bill-issuance refactor"): both need a *persisted invoice document-of-record*, which **does not exist today** on the primary path. Phase 1.2 mints a gapless sequential `INV-{building}-{BE}-{NNNNN}` at issuance + persists the record; Phase 1.3 voids that record (state, not delete) with an audit row. Forward-only. Receipt (`RCP-`) is already done (1.2a) — this is the *invoice* (ใบแจ้งหนี้) side.

### Verified architecture (3 Explore agents + 4 direct reads, grep-checked this session — reconciled against memory)
- **`generateBillsOnMeterUpdate` writes a bill in its body BUT is FROZEN — never fires in prod** (Eventarc does not support SE3-Jakarta Firestore; confirmed by the CF's own sibling comment `notifyTenantOnMeterUpload.js:12-15` + `generate_bills_cf_frozen.md` + §7-NN). So in production the **primary path persists NO bill record.**
- **Primary issuance flow (the 95% path):** admin approves meter import → `approvePendingImportWithFirebase` (`dashboard-meter-import.js:707`) writes `meter_data` (Firestore) + calls **`notifyTenantOnMeterUpload`** (callable, SE1, admin-gated, **per-room** `docId`, already idempotent via `meter_data.notifiedAt`) → that CF computes the bill on-the-fly from `meter_data`+`rooms_config` and sends a LINE Flex **"ใบแจ้งหนี้"**. **Persists nothing but `notifiedAt`.**
- **Current invoice "numbers" — all 3 ad-hoc, none gapless/persisted:** `_billFlex.js:167` `INV-{initial}{room}-{YYMM}` (LINE Flex, computed every send, collisions) · `dashboard-bill.js:440` + `:1224` `TGH-{yr}{mo}-{room}-{MMSS}` (minute+second of click, print only, persisted as `billId` ONLY at mark-paid) · `invoice-receipt-manager.js:21/65` (**§7-K orphan — 0 callers**).
- **`batchSendInvoices` (`dashboard-bill.js:1233`) is cosmetic** — loops unpaid rooms calling `logBillGenerated` (localStorage audit) only; **sends no LINE, persists no bill.** Not a real issuance moment.
- **Only persisted financial docs today:** Firestore `verifiedSlips/{txId}` + `manualReceipts/{key}` (both carry `RCP-` from 1.2a) + RTDB `bills/{b}/{r}/{billId}` (written ONLY at mark-paid = payment time, `dashboard-bill-payment-status.js:193` full-replace). **No hard-delete of bills exists** (grep: 0 `.remove()` on `bills/`); overwrite-in-place only.
- **Reusable 1.2a infra:** `_receiptCounter.js` `assignReceiptNo(tx,db,{building,be})` → `counters/receipt_{building}_{BE}` `{seq,...}` atomic `runTransaction`, format `RCP-{building}-{BE}-{NNNNN}` (5-pad). **`'receipt'`/`'RCP-'`/`'receipt_'` are hardcoded** → write a sibling `_invoiceCounter.js` (agent rec: don't generalize the money-flow counter). `assignReceiptNumber.js` = admin callable + deterministic idempotent `manualReceipts/{b}_{r}_{billId}` (re-call = same number). Rules pattern `counters|manualReceipts|actionAudit`: `read: if isAdmin(); write: if false;` (`firestore.rules:759/772/782`).
- **Audit infra (Phase 1.1, shipped):** `_actionAudit.js:53` `VALID_ACTIONS = {TENANT_UPDATED, PAYMENT_VERIFIED, BILL_PAID_MANUAL, METER_IMPORT_APPROVED}` — **no `BILL_ISSUED`/`BILL_VOIDED` yet.** `appendActionAudit(writer, fs, payload)` writes in-tx (verifySlip pattern); `recordAdminAction` callable server-stamps actor/role/ip/at. `BILL_DELETED` exists only in legacy localStorage `audit.js:271` (0 callers, §7-K).

### Design — introduce a persisted invoice document-of-record (`invoices/`, Firestore)
- **Home:** Firestore `invoices/{building}_{room}_{YYYYMM}` (deterministic key → re-notify is idempotent, never burns a 2nd number). Body: `{ invoiceNo, building, room, period (YYYYMM), be, status: 'issued'|'paid'|'void', amount, charges (snapshot from meter_data at issuance), issuedAt, issuedBy, reissueOf?, voidedAt?, voidedBy?, voidReason? }`. *Why Firestore not RTDB:* matches counters/receipts/audit; admin-queryable for reconciliation; same `write:false` rule family.
- **Counter:** sibling `_invoiceCounter.js` → `counters/invoice_{building}_{BE}` atomic increment → `INV-{building}-{BE}-{NNNNN}`. *Why per-building + sibling:* mirrors 1.2a exactly; avoids re-touching the receipt counter that verifySlip depends on (minimal blast radius).
- **Gapless invariant:** number minted in the SAME `runTransaction` as the `invoices/` doc create + the `BILL_ISSUED` audit row → a re-notify / failed write never gaps the sequence (deterministic key = get-or-return).

### PR A — Phase 1.2: invoice counter + persisted issuance record (branch `feat/phase1-2-invoice-number`) · ✅ BUILT + PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235) `0f1e3a5` — gates green, ⏳ awaiting merge=deploy (user-confirmed)
- [x] **`functions/_invoiceCounter.js`** — sibling of `_receiptCounter.js`: `assignInvoiceNo(tx, db, {building, be})` + `formatInvoiceNo()`; `counters/invoice_{building}_{BE}`, `docType:'invoice'`, `INV-{building}-{BE}-{NNNNN}`. +9 unit tests.
- [x] **Mint + persist at the real issuance moment** — `notifyTenantOnMeterUpload.js` `issueInvoiceNo()`: `runTransaction` get-or-mint (dedup read → `assignInvoiceNo` → `invoices/{building}_{room}_{period}` set `status:'issued'`+charges snapshot → `BILL_ISSUED` audit). Minted AFTER the no-approved-tenant guard, non-fatal. `be = bill.year` (already 4-digit BE — §7-E-safe). auditActor server-stamped from `request.auth`.
- [x] **`_actionAudit.js`** — `BILL_ISSUED` added to `VALID_ACTIONS`.
- [x] **Display** — `_billFlex.js buildBillFlex`: uses `opts.invoiceNo`, falls back to legacy ref for callers that don't pass one (§7-T).
- [x] **Rules** — `firestore.rules` `match /invoices/{id}` admin-read / `write:false` + counters comment covers `invoice_`. +6 rules tests.
- [x] **Index** — `firestore.indexes.json` `invoices` (`building` ASC, `period` DESC).
- [x] **Tests** — gapless/consecutive/re-notify-idempotent/no-mint-without-tenant/non-fatal. Gates: **functions 1871/0 · rules 264/0 · verify:memory 482/0** (+ README counts 243→249, 91→92).
- [ ] **Merge=Deploy** (⚠️ merge auto-fires deploy-functions.yml CF + deploy-rules.yml — money-adjacent → user-confirmed; §branch-before-deploy + `firebase use` prod check) + **live-verify** (real meter import → tenant LINE shows `INV-rooms-2569-00001`; re-import same room → same number; `invoices/` doc persisted; §7-J/§7-I — owner drives LIFF).

### PR B — Phase 1.3: void invoice with trail (same branch `feat/phase1-2-invoice-number` → PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235), deploy 1.2+1.3 together per user) · ✅ BUILT — gates green
- [x] **`_actionAudit.js`** — `BILL_VOIDED` added to `VALID_ACTIONS`.
- [x] **`functions/voidInvoice.js`** — admin callable (v1, SE1, §7-NN): `runTransaction` flips `invoices/{key}.status='void'` + `voidedAt/voidedBy/voidReason` + `appendActionAudit('BILL_VOIDED')` (server-stamped actor/role/ip, before/after snapshot), all atomic. **Never deletes / overwrites.** Idempotent (already-void early-return). `index.js` registered. +10 unit tests.
- [x] **Void invariant in issueInvoiceNo** — a re-notify of a VOIDED period does NOT silently reuse its number (returns null → Flex falls back to legacy ref). +1 test. *Re-issue (deliberate new INV-) deferred — see below.*
- [x] **Admin UI** — `shared/dashboard-invoice-void.js` `window.voidInvoicePrompt()`: reads the persisted `invoices/{key}` for the room/period the admin is billing (`window.invoiceData`, key normalized identically to the server — §7-E/§7-T safe), **previews + requires a reason (ghPrompt) → explicit user action** (§7-I, no auto-`.click()`), calls `voidInvoice`. Button `data-action="voidInvoice"` in the บิล doc panel + delegation-hub wire (`dashboard-main.js`) + `<script src>` (no inline → no CSP drift, §7-II).
- [x] **Gates:** functions **1882/0** (+11) · test:shared 319/0 · node --check all clean.
- [ ] **Live-verify (owner, post-deploy):** admin voids a real issued invoice → `invoices/{key}.status='void'` + `BILL_VOIDED` row in the dashboard audit panel + original preserved; re-notify of a voided period does not resurrect the number (§7-I/§7-J).

### Deferred (named, not dropped) — Phase 1.3 follow-up
- [ ] **Deliberate re-issue** — a corrected invoice for a voided period (new `INV-` number, `reissueOf` → voided, distinct doc) as an explicit admin action. Deferred because auto-re-issue-on-renotify interacts subtly with the deterministic-key dedup; the void invariant (no silent reuse) is the safe v1 floor. The void event is preserved in `actionAudit` regardless.
- [ ] **In-app invoiceNo display** in tenant_app bill view + dashboard grid (the LINE Flex already shows it).

### Decisions to confirm (at approval)
1. **Issuance anchor — KEY DECISION.** Mint the invoice number automatically inside `notifyTenantOnMeterUpload` (every tenant who *receives* an invoice gets a gapless number — tax-correct "issued = sent", server-side, idempotent) **[RECOMMENDED]** — vs. an explicit admin "ออกเลขใบแจ้งหนี้" button (manual control, but the primary flow is auto-notify so most invoices would stay unnumbered unless the admin also clicks). The recommendation re-touches the notify CF (gated by tests + staged deploy).
2. **Counter scope** — per-building `counters/invoice_{building}_{BE}`, resets each BE year (matches 1.2a `RCP-`) **[RECOMMENDED]** vs one global series.
3. **Migration** — forward-only (numbers start now; past synthesized bills stay unnumbered) **[RECOMMENDED, matches 1.2a]** vs backfill historical `meter_data`/`verifiedSlips` by date order.

### Guardrails
§7-NN callable not trigger (SE3) · §7-I no auto-`.click()` on void · §7-J index READY by state (seed 1 doc) · §7-T grep writer+reader of `invoices.invoiceNo` before wiring readers · §7-Z N/A (no new claims) · money-adjacent CF deploy user-confirmed + `firebase use` prod check (1.2a lesson) · §7 tx-mock gotcha when re-touching `notifyTenantOnMeterUpload` tests · gate-first: PR A then PR B, each behind `validate.yml`.

### Deferred (named, not dropped)
- **In-app invoiceNo display** in tenant_app bill view + dashboard grid (readers of the synthesized bill) — follow-up after the LINE Flex shows it (§7-T: wire readers once the writer is stable).
- **Manual-path invoice persistence** (`saveBillToFirebase`/`batchSendInvoices`) — the primary path covers 95%; fold the manual path in as fast-follow if needed.
- **Retire the 3 ad-hoc schemes** (`dashboard-bill.js:440/:1224` TGH-, orphan `invoice-receipt-manager.js`) once the persisted `invoiceNo` is the single source.

### Review (2026-06-02 — SHIPPED + DEPLOYED)
- **Shipped + deployed to prod:** PR [#235](https://github.com/soulgroundliving/the-green-haven/pull/235) (`d5c15c6`, squash of `0f1e3a5` 1.2 + `6fbd524` 1.3). Prod deploy all green (Deploy CF 3m38s · Deploy Rules 1m23s · Firebase Rules · E2E). User chose: build 1.3 first, deploy 1.2+1.3 together, staging-green before merge.
- **1.2:** `_invoiceCounter` → `INV-{b}-{BE}-{NNNNN}` minted in `notifyTenantOnMeterUpload.issueInvoiceNo` + persisted `invoices/{b}_{r}_{period}` doc-of-record + `BILL_ISSUED` audit + Flex shows the number. **1.3:** `voidInvoice` CF (status:void + `BILL_VOIDED`, never deletes, idempotent) + void invariant + admin void UI (`dashboard-invoice-void.js`).
- **Decisions taken:** issuance anchor = auto-mint in notify CF · per-building counter · forward-only (all RECOMMENDED, user-approved).
- **Gates:** functions 1882/0 · rules 264/0 · test:shared 319/0 · verify:memory 505/0 · README counts. Prod probe: `voidInvoice`→UNAUTHENTICATED, notify→PERMISSION_DENIED.
- **Deferred (named):** deliberate re-issue (new INV- + `reissueOf`) · in-app invoiceNo display · manual-path persistence · retire the 3 ad-hoc schemes.
- **Open (owner live-verify, §7-I/§7-J):** real meter import → `INV-…00001`; re-import → same; admin void → `BILL_VOIDED` row + status:void; voided period not resurrected on re-notify.
- **Architecture doc:** `memory/lifecycle_invoice_numbering.md` (grep-backed) + handoff `memory/next_session_handoff_2026_06_02_phase_1_2_1_3_invoice.md`.

---

## ▶ ACTIVE PLAN (2026-06-02 PM) — Roadmap 1.2a: Gapless RECEIPT number (`RCP-`) · ✅ PR 1.2a-1 (slip #233) + 1.2a-2 (cash #234) SHIPPED + DEPLOYED · ⏳ PR 1.2a-2b (saveBillToFirebase Path-2 + jsPDF) deferred

**Scope (user-chosen 2026-06-02):** Receipt-first. Gapless `RCP-{building}-{BE}-{NNNNN}` (per-building, resets each BE year) assigned atomically at payment confirmation, persisted, displayed. Forward-only migration. **Invoice numbers = separate 1.2b (deferred)** — the primary bill path (meter import) writes no persisted record, so invoice numbering needs its own design.

**✅ PR 1.2a-1 SHIPPED + DEPLOYED 2026-06-02** ([#233](https://github.com/soulgroundliving/the-green-haven/pull/233) `c306ec6`): counter helper + verifySlip `batch→runTransaction` (dedup + gapless number + audit atomic, no-burn-on-dup) + `counters` rule + Flex display. Gates: functions 1848/0 · rules 254/0 (CI emulator) · verify:memory 482/0 · staging + **prod CF + rules deploy success**. Open: owner live-verify (real slip → `RCP-rooms-2569-00001`, consecutive, no dup number). → [[lifecycle_verifyslip]] §5.

### Verified architecture (3 Explore agents + `billing_monthly_flow.md`, grep-checked)
- `generateBillsOnMeterUpdate` **DEAD** (Eventarc SE3 gap, frozen tombstone) — CANNOT anchor a number there.
- `meter_data` = SoT; **bills are derived views**; Path 1 (meter import, primary) writes **NO** bill record. Only persisted payment records: Path 2 manual `saveBillToFirebase`→RTDB (`dashboard-bill.js:1121`) + **payment → `verifiedSlips/{transactionId}`** (verifySlip CF, just refactored PR 1b).
- Tax aggregation (`aggregateMonthlyRevenue`) ignores doc numbers (sums by amount/month) → renumber is tax-safe. ✅
- Receipt-issuance moments: **(1) verifySlip** (slip, all buildings, server CF) · **(2) manual mark-paid** (cash, client `markBillPaid`/`saveBillToFirebase`).

### Design
- **Counter:** Firestore `counters/receipt_{building}_{BE}` `{ seq, updatedAt }`, atomic `runTransaction` increment. Format `RCP-{building}-{BE}-{NNNNN}` (5-digit pad).
- **Gapless invariant:** the number is assigned in the **SAME transaction** as the payment-record write, so a duplicate/failed payment never burns a number (no gap).

### PR 1.2a-1 — counter infra + verifySlip slip-receipt (primary path)
- [ ] **Counter helper** `functions/_receiptCounter.js` — `assignReceiptNo(tx, db, {building, be})`: `tx.get(counterRef)` → `seq+1` → `tx.set` → return `RCP-…`. *Why:* gapless requires a serialized atomic increment inside the caller's tx.
- [ ] **verifySlip** — convert `saveVerifiedSlip` **batch → `runTransaction`**: `tx.get(slipRef)` dedup (exists → duplicate, **counter untouched → no gap**) + `assignReceiptNo` + `tx.set(slipRef, {…, receiptNo})` + `appendActionAudit(tx,…)` + counter set, all atomic. *Why:* dedup + number + audit must commit together; a dup must not consume a number. ⚠️ **re-touches the PR 1b money-flow CF** — staged + user-confirmed deploy.
- [ ] **Persist** `receiptNo` on `verifiedSlips/{transactionId}` + mirror into RTDB bill via `markBillPaidInRTDB` (`bills/{b}/{r}/{billId}/receiptNo`). *Why:* one immutable source; readers display, never recompute.
- [ ] **Rule** `firestore.rules` — `counters/*` read:admin, write:false (CF/Admin-SDK only). + `npm run test:rules`.
- [ ] **Display** — `functions/_billFlex.js buildReceiptFlex` (:240): use the passed persisted `receiptNo` instead of the computed `RCP-${initial}${room}-${YYMM}`. *Why:* kill the ephemeral collision-prone scheme; show the gapless number on the LINE receipt.
- [ ] **Tests** — counter gapless increment; two concurrent verifies → consecutive numbers, no dup/gap; duplicate slip burns no number; `receiptNo` on slip + Flex. Mind the §7 tx-mock gotcha (the new tx needs `get`/`set` + `counters`/`actionAudit` branches). Keep functions 1835 green.
- [ ] **Deploy** (money-flow, user-confirmed; §branch-before-deploy + `firebase use` prod) + **live-verify** (real slip → `RCP-` on receipt + persisted; duplicate → no new number).

### PR 1.2a-2 — manual cash mark-paid receipt number (closes the gap) · ✅ SHIPPED + DEPLOYED ([#234](https://github.com/soulgroundliving/the-green-haven/pull/234) `71b2fdc`)
- [x] **Callable** `assignReceiptNumber` (admin-gated, SE1) — mints from `_receiptCounter` in a tx + deterministic `manualReceipts/{b}_{r}_{billId}` record (gapless **+ idempotent**: retry = same number, no double-mint). 7 unit tests. Registered in index.js.
- [x] **Wire** `markBillPaid` (`dashboard-tenant-modal.js`) → call it, persist `receiptNo` on the RTDB bill + payments record (non-blocking). `saveBillToFirebase`/`markRoomPaid` (now `dashboard-bill-payment-status.js:107`) → **deferred 1.2a-2b** (handles slip + cash; needs `!slipVerified` gate to avoid double-numbering a slip-verified bill).
- [x] **Display** — `tenant-render.js` `rcpt-bill-no` → `bill.receiptNo` (benefits slip + cash). PDF `invoice-pdf-generator.js` → **deferred 1.2a-2b**.
- [x] **Rules** `manualReceipts/{id}` read:admin write:false + 4 tests. Gates: functions 1855/0 · rules 258/0 · prod CF+rules+Vercel deploy ✓.
- [ ] **Owner live-verify:** cash mark-paid → tenant receipt shows next `RCP-` in the shared series; re-mark same bill → SAME number (idempotent).

### PR 1.2a-2b — deferred follow-up (named)
- [ ] `saveBillToFirebase` Path-2 "ออกใบเสร็จ" (`dashboard-bill-payment-status.js:107`) → assignReceiptNumber gated on `!window.slipVerified` (slip already numbered via verifySlip) + don't overwrite an existing `receiptNo`.
- [ ] jsPDF receipt export display of `receiptNo`.

### Decisions to confirm (at approval)
1. **Format** `RCP-{building}-{BE}-{NNNNN}` — per-building counter (matches roadmap `counters/{docType}_{building}_{BE}`, avoids cross-building contention)? Or one global per-BE series?
2. **Year reset** — `NNNNN` restarts each BE year (standard Thai เลขที่ practice)? Or never resets?
3. **Migration** — forward-only (gapless starts now; historical paid receipts keep their old display number) **[recommended]** vs backfill existing `verifiedSlips` by `verifiedAt` order (one-shot, deterministic).

### Guardrails
§7-NN callable not trigger (SE3) · §7-I no auto-`.click()` · §7-J rule READY by state · money-flow deploy user-confirmed · gate-first: PR 1.2a-1 then 1.2a-2, each behind `validate.yml` · §7 tx-mock gotcha when re-touching verifySlip tests.

### Review (append after execution)
_(shipped / deferred / follow-ups)_

---

## ▶▶ ACTIVE PLAN (2026-06-02) — Phase 1.1: Server-side immutable audit trail · ✅ PR 1a BUILT (write-path) — gates green, awaiting deploy

**Roadmap:** `core-readiness-roadmap.md` Phase 1.1 (⭐ highest leverage — closes Accounting blocker #3 + the Legal "audit-viewer theater" gap in one move). **Approach chosen by user:** *Hybrid ค่อยเป็นค่อยไป* — callable logger for client-side admin mutations, in-tx logging where the action is already a CF; **bill issue/void deferred** to land atomically with Phase 1.2/1.3.

> **§7-M discovery (2026-06-02):** `audit-log-viewer.html` loads **zero Firebase** and uses the legacy localStorage/SecurityUtils session (NOT Firebase Auth) — so reading the admin-gated `actionAudit` there is a Firebase-Auth retrofit, NOT the line-502 swap originally planned. **User decision: read-UI → Dashboard audit panel (PR 1a.2)** — dashboard.html already has Firebase Auth + firestore + admin claim. PR 1a ships the **write-path only** (the irreversible-value half); the standalone viewer is left as-is.

**Why now:** the accountant's #1 ask. Today the "audit log" is `shared/audit.js` → browser **localStorage** (`audit_logs`, mutable, has `clearLogs()`, max 1000) + `access-control.js:411` → localStorage `access_logs`; `audit-log-viewer.html:502` reads **localStorage `access_logs`** (per-browser, clearable — evidence theater). The only real server trail (`auth_events`→BigQuery via `archiveAuthEvents.js`) logs **failed logins + PDPA erasures only** — never bill/meter/tenant/payment admin actions. Precedents to mirror exist in-repo: `_occupancyLog.js` (immutable append helper), `_pointsLedger.js` (just shipped), `dataDeletionLog`.

### Evidence (grep-verified this session — file:line)
- Current logger localStorage-only: `shared/audit.js:14` (`audit_logs`), `shared/access-control.js:396-424` (`logAccessAttempt`→`access_logs`).
- Viewer reads localStorage: `audit-log-viewer.html:502` `localStorage.getItem('access_logs')`. ← swap target.
- Server precedents: `functions/_occupancyLog.js:114` `appendLog(writer, firestore, payload)`; `functions/archiveAuthEvents.js` (auth_events→BigQuery, IAM write-only); `functions/requestDataDeletion.js` (`dataDeletionLog`).
- Callable house pattern: `firebase-functions/v1`, `.region('asia-southeast1').https.onCall((data, context)=>…)`; admin gate `if (!context.auth?.token?.admin) throw HttpsError('permission-denied')` (`adminApprovedLink.js:49`).
- Rules model: `pointsLedger`/`dataDeletionLog`/`consents` blocks → `allow read: if isAdmin(); allow write: if false;` (`firestore.rules` ~:754/:739/:727).
- `actionAudit` + `recordAdminAction` confirmed **absent** (clean slate).
- Wire points: `verifySlip.js:356`/`:403` `recordPaymentAndAwardPoints` tx (in-tx, tamper-proof) · `dashboard-tenant-modal.js:530-701` tenant edit (client, already calls `AuditLogger.log`) · `dashboard-meter-import.js` approve→`meter-unified.js:99` setDoc (client) · `dashboard-tenant-modal.js:477` bill-mark-paid manual (client RTDB).

### Ship as 2 PRs (gate-first, one vertical slice each)

**PR 1a — write-path foundation** (branch `feat/phase1-1-action-audit`) · ✅ BUILT, gates green:
- [x] `functions/_actionAudit.js` — append helper mirroring `_pointsLedger.js`: `appendActionAudit(writer, firestore, payload)`, `VALID_ACTIONS` enum, validation. autoId for client events (admin actions aren't idempotent — two edits = two events); **optional deterministic `idempotencyKey`** for the in-tx CF case (PR 1b verifySlip). 13 unit tests.
- [x] `functions/recordAdminAction.js` — onCall (v1, SE1), admin-gated. **Stamps `actor`/`actorEmail`/`actorRole`/`at`/`ip` server-side** from verified context (never client-trusted — proven by a forgery test). Caps before/after snapshots. 9 unit tests.
- [x] `functions/index.js` — registered `exports.recordAdminAction` (after the gamification CFs).
- [x] `firestore.rules` — `match /actionAudit/{entryId} { read: if isAdmin(); write: if false; }` (after pointsLedger). 7 rules tests (admin read/query OK; tenant/unauth/client-write/update/delete denied).
- [x] `firestore.indexes.json` — composite `actionAudit` (`actor` ASC, `at` DESC).
- [x] **Wire 1 client action as proof:** tenant edit (`dashboard-tenant-modal.js:695`, beside `AuditLogger.log`) → `recordAdminAction` with `TENANT_UPDATED`. Non-blocking, **field-NAMES only (no PII values)**, fired AFTER the save (§7-I).
- [x] **Tests + gates:** functions unit **1831/0** (+22), rules **249/0** (+7).
- [ ] **Read-UI swap → MOVED to PR 1a.2** (Dashboard audit panel) per §7-M discovery above. Standalone `audit-log-viewer.html` left as-is.
- [x] **Commit → push → PR (#229) → squash-merge `0d23ea8` → DEPLOYED prod** (user-confirmed). CF deploy ✓ (`recordAdminAction(asia-southeast1)` created); rules+index deploy failed once on a transient `Failed to make request` to the indexes API → fresh `workflow_dispatch` re-run `✔ Deploy complete!` (rule + index live). §7-NN held (callable, no trigger).
- [ ] **Live-verify (OPEN):** admin edits a tenant in the dashboard → REST-read `actionAudit` shows one row with server-stamped `actor`/`ip`/`at`. Needs a real admin edit (no auto-click, §7-I). Self-confirms on first real edit; or user triggers one + re-probe.

**PR 1a.2 — Dashboard audit panel** (read UI) · ✅ BUILT (branch `feat/phase1-1-audit-panel`):
- [x] `shared/dashboard-audit-panel.js` (new, 148 lines) — `window.initAuditPage()`; subscribes `actionAudit` `orderBy('at','desc') limit 200` via `window.firebase.firestoreFunctions`; idempotent; **§7-N error callback** renders an error state (no silent stuck spinner); client-side search (no composite-index dependency for v1); Firestore `Timestamp.toDate()` for `at`; escapes all fields.
- [x] `dashboard.html` — nav button (`data-page="audit"`, SYSTEM group) + `#page-audit` container (`.page`/`.active` system, not §7-SS u-init-hide) + search bar + `<script src>` tag. **CSP: no drift** (HTML + external src only — no inline-script content changed; `csp:hash` diff empty).
- [x] `shared/dashboard-main.js` — `_showPageImpl`: `if(page==='audit')initAuditPage();`.
- [ ] Ship: commit → push → PR → merge (Vercel static deploy) → **live-verify on prod** (admin login → open panel → empty state renders no-error; then a tenant edit → row appears = closes PR 1a live-verify too).

**PR 1b — expand coverage** ✅ SHIPPED + DEPLOYED 2026-06-02 (client [#231](https://github.com/soulgroundliving/the-green-haven/pull/231) `28b80a7` · CF [#232](https://github.com/soulgroundliving/the-green-haven/pull/232) `bfb992e`):
- [x] In-tx (tamper-proof): `verifySlip.js` → `PAYMENT_VERIFIED`. **Anchored in `saveVerifiedSlip` (NOT `recordPaymentAndAwardPoints` :403 — that returns early for non-`nest`, would miss every rooms payment).** Bare `.create()` → `db.batch()` + `batch.create()` + `appendActionAudit()` + `batch.commit()` (atomic, idempotencyKey=transactionId). actor/role/ip server-stamped from onCall context (forgery test). Test mock: added `db.batch()` (commit throws `verifiedSlipsCreateThrow` → 3 dup tests preserved) + 4 audit-row tests. functions 1831→1835.
- [x] Via callable (client): meter-import approve (`dashboard-meter-import.js` `approvePendingImportWithFirebase`, both approve paths' convergence, gated `totalSaved>0` → `METER_IMPORT_APPROVED`) · bill-mark-paid manual (`dashboard-tenant-modal.js` `markBillPaid` → `BILL_PAID_MANUAL`). Both non-blocking, fired AFTER action (§7-I).
- [x] Tests + gates green (functions 1835/0 · test:shared 319/319 · pre-commit hooks · staging deploy · prod CF deploy 3m36s success). **Lifecycle docs updated: [[lifecycle_audit_trail]] + [[lifecycle_verifyslip]]; verify:memory 482/0.**
- [ ] **Live-verify (owner, §7-J/§7-I):** real admin tenant-edit / meter-approve / bill-paid / slip-verify (admin + tenant LIFF) → `actionAudit` shows the rows; duplicate slip writes no 2nd `PAYMENT_VERIFIED`. Agent can't drive LIFF / won't auto-click approve.

### Deferred (named, not dropped)
- **bill issue / void atomic logging** → Phase 1.2 (gapless doc number) + 1.3 (void-with-trail) — shared bill-issuance refactor; that's where financial mutations move into CFs (option B).
- **Unify existing dedicated server logs** (occupancyLog / dataDeletionLog / deletePetMedia / hideMarketplaceChat) into `actionAudit` — fast-follow; they already log, lower priority.
- maintenance create/update, batch rent adjustment (`dashboard-property.js`), tax export → fast-follow.
- **tenant self-view** of own `actionAudit` rows → later (add a claim-traced read clause then, not now — admin-read-only for v1).

### Cross-cutting guardrails (this PR)
- §7-NN callable not trigger (SE3). · §7-I observe-only, never auto-`.click()` an approve. · §7-J index READY by state. · §7-T grep writer+reader done (above). · Dashboard admin actions use email/admin auth — NOT `_onLiffClaimsReady` (that's LIFF-tenant only). · §7 Phase-0 test-mock gotcha when touching an existing CF's tx.

### Review (Phase 1.1 — shipped 2026-06-02 session 2)
- **Shipped + deployed + verified:** PR 1a write-path ([#229](https://github.com/soulgroundliving/the-green-haven/pull/229) `0d23ea8`) + PR 1a.2 dashboard read panel ([#230](https://github.com/soulgroundliving/the-green-haven/pull/230) `25052e2`). Read path **live-verified** via Chrome MCP (admin → panel query OK, empty-state, no console error). Static deploy verified (content-hashed module served 200). Gates: functions 1831/0 · rules 249/0 · shared 319/0 · verify:memory GREEN. Lifecycle doc: `~/.claude/.../memory/lifecycle_audit_trail.md`.
- **PR 1b ✅ SHIPPED + DEPLOYED 2026-06-02 (#231 client + #232 CF):** verifySlip `PAYMENT_VERIFIED` in-batch (anchored in `saveVerifiedSlip`, all-buildings — improved over the spec's nest-only `:403`) · meter-approve `METER_IMPORT_APPROVED` · bill-paid `BILL_PAID_MANUAL`. functions 1835/0. Owner live-verify open.
- **Deferred to roadmap 1.2/1.3:** bill issue/void atomic logging (the bill-issuance refactor — financial mutations move INTO CFs).
- **Follow-ups:** full end-to-end live-verify (real admin tenant-edit → row in panel) closes PR 1a's write-path verify; Phase 0 `pointsLedger` live-write verify still open.
- **Gotchas logged in handoff:** deploy-rules transient index-API failure (re-run fresh) · content-hash 404 masks static verify · Chrome MCP privacy-filter on rendered rows.

---

**Created:** 2026-05-31 · **Audit score:** 3.04 / 4.0 (B) — adversarial re-audit, 9 parallel agents
**Supersedes:** the earlier 2026-05-31 plan (score 3.12, all 36 tasks completed — commits `87bb4a3` / `7e5ef7b` / `2cb408e`; preserved in git history).

> This run was more adversarial and surfaced **net-new** latent issues (the prior pass fixed wellness/admin-ops XSS; this pass found 4 *different* sinks; prior PERF-Q1 capped insights queries but missed the `dashboard-extra` meter watch).

---

## ▶ ACTIVE PLAN (2026-06-02 PM): P2 plan-first — verifySlip→onCall (#1) · defer tenant-liff-auth (#2)

**Status:** ⏳ AWAITING APPROVAL. The two remaining P2 plan-first items (todo lines ~107 + ~109). User decision taken (choice menu): verifySlip auth model = **Admin + owning tenant** (onCall + `_authSoT`).

### ⚠️ Key discovery — scope is bigger than the audit one-liner
Deployed verifySlip returns **401** to POST-without-auth → `requireAdmin` (added 2026-04-24, commit `1176e46` "security hardening") is live. The admin caller (`dashboard-bill-slip-verify.js:128`) sends `Authorization: Bearer <idToken>` and works. But **both tenant callers** (`tenant-slip-verify.js:95` rent · `tenant-cleaning.js:243` ฿500 cleaning) send **no** auth header → **tenant self-slip-verify has 401'd for ~6 weeks**. `verifyTenantSlip` IS fully wired (`tenant_app.html:3587` button → hub `:5361` → module). Option A fixes this as a side effect by gating on admin-OR-owning-tenant via `_authSoT.assertTenantAccess` (same helper 7 other tenant CFs use).

---

### Phase 1 — verifySlip `onRequest` → `onCall` (Option A)

**Why:** (1) transport-layer auth consistency (audit goal) — align with the 7 `_authSoT` onCall CFs, drop manual `Authorization: Bearer` parse + manual CORS; (2) fixes the 6-week-broken tenant self-verify (gamification early_bird/on_time tiers are computed from the tenant's OWN slip date → self-verify was the intended design); (3) defense is **unchanged** — SlipOK cryptographic verify + amount hard-reject (|diff|>1) + atomic `.create()` dedup still gate every call. onCall only changes WHO may call (admin + that room's tenant) and HOW the token is transported.

**Server — `functions/verifySlip.js`**
- [ ] **Trigger swap:** `.https.onRequest(async (req,res)=>…)` → `.https.onCall(async (data, context)=>…)`. *Why:* callable auto-verifies the ID token into `context.auth` + auto-CORS.
- [ ] **Delete** CORS-header block + `OPTIONS`/`GET`/method branches. *Why:* onCall owns transport; keepLiffWarm still warms via GET→4xx (see keepLiffWarm step).
- [ ] **Auth gate:** remove `requireAdmin(req,res)`; move validation up so building+room are known, then `await assertTenantAccess({ building, roomId:String(room), context, firestore: db, HttpsError: functions.https.HttpsError })`. *Why:* admin = Path 0; owning tenant = Path 1 (claim) / 1b (tenantId) / 2a (linkedAuthUid) → survives §7-Z claim-strip + §7-HH stale-UID.
- [ ] **Input:** `req.body` → `data` for `{file, expectedAmount, building, room, userId}`.
- [ ] **Error mapping — THROW vs RETURN (deliberate, minimizes client churn):**
  - **THROW** `functions.https.HttpsError`: `unauthenticated`/`permission-denied` (from `_authSoT`), `invalid-argument` (missing fields · bad base64 · payload >5MB), `resource-exhausted` (rate-limit, keep `retryAfter:60` detail), `internal` (unexpected catch).
  - **RETURN** `{success:false, …}` (NOT throw) for business outcomes shown inline: `scb_delay` (retryable), `amount_mismatch` (+slipAmount/expectedAmount), `isDuplicate`, generic SlipOK fail. *Why:* keeps client branching on `result.success`/`result.code` like today; "slip didn't pass" is not an exception.
  - **RETURN** `{success:true, data:slipData, amountValid:true, amountDiff}` on success.
- [ ] **Req metadata:** `req.ip`/`req.get('user-agent')` → `context.rawRequest?.ip` / `context.rawRequest?.get?.('user-agent')` in `logVerificationAttempt` calls (preserve audit trail). *Why:* v1 onCall exposes raw req under `context.rawRequest`.
- [ ] **Unchanged:** rate-limit (fail-closed), SlipOK call, amount hard-reject, atomic dedup, markBillPaidInRTDB, sendReceiptNotification, recordPaymentAndAwardPoints, region `asia-southeast1`, secrets `[SLIPOK_API_KEY, LINE_CHANNEL_ACCESS_TOKEN]`. *Why:* behavior-preserving — only the transport+auth shell changes.

**Client — 3 callers: `fetch` → `httpsCallable`** (`window.firebase.functions.httpsCallable('verifySlip')(data)` → `{data: result}`)
- [ ] **`shared/dashboard-bill-slip-verify.js`** (admin): drop `getIdToken()`+`fetch(...Authorization...)`; use httpsCallable; read `res.data`; map thrown HttpsError → existing error UI (`err.message`/`err.details`); keep `skipSlipVerify` fallback. *Why:* SDK auto-attaches admin token.
- [ ] **`shared/tenant-slip-verify.js`** (rent): swap `fetch`→httpsCallable; read `res.data`; keep `scb_delay` countdown + success→`goToPaymentStep(3)`. *Why:* tenant signed-in via LIFF custom token → auto-attached → fixes 401. **Verify** whether the `window.firebase.functions.httpsCallable` wrapper forwards a `{timeout}` option; if yes pass `{timeout:12000}` (§7-R), if not rely on SDK default (httpsCallable has a built-in timeout unlike raw fetch — AbortController becomes unnecessary).
- [ ] **`shared/tenant-cleaning.js`** (฿500): same swap; `{file, expectedAmount:500, building, room}` (CF ignores the `context:'cleaning'` field — drop or keep). *Why:* same 401 fix.
- [ ] **CSP:** none expected — callable POSTs to `…cloudfunctions.net` (https:) already allowed by `connect-src 'self' https: wss:`. *(verify on deploy, don't assume.)*

**keepLiffWarm**
- [ ] **`functions/keepLiffWarm.js`** — `verifySlip` `callable:false` → `callable:true`. *Why:* onCall returns 4xx (not 200) to the warm GET; the `callable:true` branch already treats that as expected-warm → no warn-log noise.

**Tests**
- [ ] **Rewrite `functions/__tests__/verifySlip.test.js`** — stub `https.onCall` (capture handler); call `handler(data, context)` for: admin (`context.auth.token.admin=true`), owning tenant (`context.auth.token={room,building}` Path 1), no-auth (expect `unauthenticated`). Assert invalid-argument / resource-exhausted / amount_mismatch RETURN / duplicate RETURN / success shapes. *Why:* current test stubs `onRequest`+`requireAdmin`+`x-no-auth` — all obsolete.
- [ ] **Check `verifySlipReceipt.test.js`** (stubs `onRequest:(fn)=>fn`) + `verifySlipLogic.test.js` — update trigger stub to `onCall` where they load the module; pure-logic tests may be untouched. *Why:* suite is now a PR gate (validate.yml).
- [ ] **Gate:** `npm test` (functions) green before deploy.

**Deploy (⚠️ user-confirmed, coordinated — money-adjacent core flow)**
- [ ] **Sequencing risk:** onCall server + httpsCallable client are NOT compatible with the old shape — deploying one side alone breaks slip verify until the other lands. Plan: merge client PR + `firebase deploy --only functions:verifySlip` back-to-back, low-traffic time. Volume is low (≤50/room/day) — a short window is acceptable.
- [ ] **§branch-before-deploy:** `pwd && git branch --show-current && git log -3 functions/verifySlip.js` first (wrong-branch deploy silently rolls back prod).
- [ ] **Deploy-shape:** onRequest→onCall is https→https (NOT the §7-NN background→callable block) → expected in-place. Fallback if Firebase refuses: `firebase functions:delete verifySlip --region asia-southeast1 --force` then redeploy (brief outage). Secrets already bound → no Secret Manager setup (§7-WW N/A).
- [ ] **Live-verify (§7-J):** admin ตรวจสลิป on Vercel (agent via Chrome MCP) + **user** confirms tenant LIFF rent-slip + cleaning-slip self-verify now succeed (were 401).

**Rollback:** `git revert` client commit → redeploy Vercel **AND** `git revert` CF commit → `firebase deploy --only functions:verifySlip`. Must revert BOTH (matched pair).

---

### Phase 2 — defer parser-blocking JS (todo line ~107)

**2a. async Sentry CDN (4 pages — low risk, clear win)**
- [ ] Add `async` to `<script src="…sentry-cdn.com…">` on `booking.html:47`, `dashboard.html:18`, `tax-filing.html:19`, `tenant_app.html:47` (audit said 3; it's 4). *Why:* Sentry is an independent reporter, nothing calls it at parse-time → safe to unblock the parser. **CSP:** `async` doesn't change anything (external `src`, not an inline hash) → no regen.

**2b. defer `tenant-liff-auth.js` (47KB, `tenant_app.html:5199` — HIGHER risk, §7-PP/§7-A/§7-HH)**
- [ ] **AUDIT FIRST (gate):** module defines the auth spine (`_taBuilding`/`_taRoom`/`_callLiffSignIn`/`_onLiffClaimsReady`). Grep every `<script>` (inline + src) AFTER line 5199 and every deferred script BEFORE it for **parse-time** calls to its exports. *Why §7-PP:* deferred scripts run at DOMContentLoaded in DOM order; an inline script calling these at parse-time runs first → ReferenceError. Most usage is in the delegation hub / event handlers / `_onLiffClaimsReady` callbacks (later) — must be PROVEN, not assumed.
- [ ] If clean → add `defer`, keep tenant-liff-auth positioned before any deferred dependents. If parse-time deps found → **STOP, report, don't force** (breadth-trap: a perf tweak must not risk the auth spine).
- [ ] **Live-verify (mandatory, §7-A/§7-U/§7-HH):** full LIFF auth on real LINE — sign-in → claims arrive → bills/meter/checklist load. Agent can't drive LIFF → **user** verifies. Treat any "stuck at ตั้งค่าสิทธิ์" as a defer-order regression.

**Why 2a/2b split:** 2a is independent + safe → ship freely. 2b touches the most incident-prone file in the repo → gated on an audit + user LIFF verification. Independent of each other and of Phase 1.

---

### Out of scope (named, not silently dropped)
- CSS hashing; identifier-rename minify (build.js Phase B); the audit's already-closed items.
- Removing client-side rate limiters (`_tenantRateLimit`, `checkDashboardRateLimit`) — keep as cheap pre-flight; server rate-limit is the real gate.
- Re-architecting the tenant payment UX — only the auth/transport changes here.

### Review (2026-06-02 PM) — SHIPPED + DEPLOYED
- **Phase 1 (verifySlip onCall)** ✅ PR #224 (squash `ec6330b`) merged + **deployed to PROD** (`firebase deploy --only functions:verifySlip --project the-green-haven` → Successful update; onRequest→onCall in-place, no delete-first needed). Prod probe confirms onCall + handler runs (`{data:{}}` → "File is required"). Restores the ~6-week-broken tenant self-verify.
- **Phase 2a (Sentry defer)** ✅ in #224, live on prod (`sentry-cdn…defer` + `sentry-init.<hash>.js defer` served; 0 CSP drift).
- **Phase 2b (defer tenant-liff-auth)** ❌ AUDITED → SKIPPED — auth spine with a documented synchronous dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). Not forced (breadth-trap).
- **Process note:** first deploy accidentally hit `the-green-haven-staging` (stale `firebase use` alias) — caught from the `Project Console:` URL, re-deployed to prod with pinned `--project`. Lesson added to `feedback_branch_before_firebase_deploy.md` (check `firebase use` before deploy).
- **Follow-up (user):** functional smoke — admin ตรวจสลิป (dashboard) + tenant LIFF rent-slip + ฿500 cleaning-slip now succeed (were 401). Tests: functions 1791 · test:shared 319 · verify:memory green.

---

## ▶ ACTIVE PLAN (2026-06-02): Content-hash caching for `shared/*.js` (P2 item, line ~61)

**Status:** ✅ SHIPPED + PROD-VERIFIED (2026-06-02, PR #223 `d393f35`). Unit 18/18 + full `build.js` temp smoke + **Vercel prod build SUCCESS** + **live curl on prod**: hashed JS 200 w/ `public, max-age=31536000, immutable`; dashboard HTML `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200. Only optional remnant: owner in-app *visual* render (doesn't affect caching — all scripts load 200).

### Goal & Why
Non-SW pages (dashboard, tax-filing, login, booking, index, audit-log-viewer, privacy) currently re-fetch **every** `shared/*.js` on every navigation — `vercel.json` sets `no-cache, no-store, must-revalidate` on `/shared/(.*)\.js`. Dashboard alone pulls **71** local scripts per load. **Why it matters:** biggest LCP/TTI win available; a returning admin re-downloads ~70 files that never changed. **Why it's currently no-cache:** to guarantee freshness after deploy without `?v=` (decision 2026-04-28, [[feedback_vercel_verification]]). Content-hashed filenames make immutable caching *strictly safer* than no-cache (new bytes → new URL → staleness is impossible) **and** faster.

### Research facts that de-risk this (verified 2026-06-02, grep-backed)
- **100% of local JS loads are static `<script src>`** — only dynamic `createElement('script')` is the CDN xlsx (`dashboard-meter-import.js:10`, unpkg). → a build-time `src=` rewrite covers every load; nothing resolves a `shared/` path at runtime.
- **0 SRI** on local scripts (minify already changes bytes) → rename needs no integrity update.
- **CSP** `script-src`/`script-src-elem` use `'self'` for external files (sha256 only for inline) → renaming files = **no CSP change** ([[csp_pipeline]] untouched).
- Ref shapes to rewrite: `./shared/X.js` ×137 · bare `shared/X.js` ×6 · `./accounting/X.js` ×2. (`index.html` 0 local JS.)
- esbuild minify is **deterministic** → unchanged source ⇒ identical hash ⇒ same URL across deploys ⇒ browser keeps the cache (the entire point).
- **Scope = the exact set `build.js` already minifies:** `shared/**/*.js` + `accounting/**/*.js` (102 + 2). CSS (`brand.css`/`components.css`/`tailwind.css`) **out of scope** this round — only 3 files, and `brand.css` is hardcoded in the SW `PRECACHE_URLS`; keep its current header.

### Decision needed — which approach? (recommend A)
- **[A] Build-time content-hash + immutable (RECOMMENDED — the todo's intent).** `build.js` (Vercel-only) renames each minified `shared/X.js`→`shared/X.<hash8>.js`, rewrites all refs from a manifest, then a **build-time verify gate fails the deploy (red) if any ref is dangling** — so a missed reference is a failed build, never a prod 404. Source files keep plain names (local dev untouched). Full win, contained risk. ~1 deploy to revert (HTML is no-cache → always points at current hashes).
- **[C] Fallback — just relax the header.** Change `/shared/(.*)\.js` to `public, max-age=300, stale-while-revalidate=86400`. 1-line, near-zero risk, **partial** win (within-session only) and **reintroduces a small staleness window** the no-cache was chosen to avoid. Offer if A feels too heavy.
- (Rejected: `?v=hash` query strings — Vercel header `source` matches pathname not query, so can't cleanly set immutable; and reverses the explicit "no `?v=`" decision for a worse-caching mechanism.)

### Implementation steps — Approach A (✅ all done 2026-06-02)
- [x] **build.js — hashing pass.** After the JS-minify loop, for each emitted `shared|accounting/*.js`: sha256 of the **minified** bytes → 8-char hash → rename to `<base>.<hash>.js`; record `{ 'shared/X.js': 'shared/X.<hash>.js' }` manifest. **Why:** hash the bytes the browser actually caches; deterministic across unchanged deploys.
- [x] **build.js — ref rewrite.** One pass over all `*.html` (+ SW if it ever refs a hashed asset — it doesn't, JS-only) replacing every `(\./|/)?(shared|accounting)/<name>\.js` with the manifest value, preserving the original prefix (`./` / bare / `/`) + `defer`. **Why:** all 3 prefix shapes exist; must not change load semantics (§7-PP defer-order untouched — order in HTML is preserved, only the filename token changes).
- [x] **build.js — verify gate (the safety net).** After rewrite: assert every remaining `(shared|accounting)/...\.js` ref in HTML maps to an on-disk emitted file, AND no referenced plain name survives. Mismatch → `console.error` + `process.exit(1)`. **Why:** converts "missed ref = silent prod 404" into "failed Vercel build" (§7-J / breadth-trap containment).
- [x] **build.js — ordering.** Run hashing+manifest BEFORE the HTML-minify/rewrite stage so the manifest exists when HTML is processed. **Why:** rewrite needs the final names.
- [x] **vercel.json — headers.** `/shared/(.*)\.js` and add `/accounting/(.*)\.js` → `public, max-age=31536000, immutable`. Leave HTML (`/`, page list) + `service-worker.js` + `manifest.json` + `*.css` on **no-cache** (unchanged). **Why:** hashed JS is safe to pin forever; HTML must stay fresh so it always emits current hashes. (`(.*)\.js` already matches `X.<hash>.js` — greedy.)
- [x] **Pure-function extraction + unit tests (gate).** (`tools/asset-hash.js` + `shared/__tests__/asset-hash.test.js`, 18 tests) Extract `computeAssetManifest(files, readBytes)` + `rewriteHtmlRefs(html, manifest)` + `verifyNoDanglingRefs(htmls, emittedSet)` into a testable module (e.g. `tools/asset-hash.js`); `shared/__tests__/asset-hash.test.js`: hash determinism, all-3-prefix rewrite, defer preserved, dangling-ref → throws, unchanged-file → stable hash. **Why:** matches the project's "extract pure fn + test" gate pattern (#220/#221); lets me prove logic without running the in-place build against the real repo.
- [x] **SW sanity.** (confirmed: no `shared/*.js` in PRECACHE_URLS; cache-first ext-regex matches hashed names; CACHE_VERSION purge unchanged — SW needs no edit) Confirm `service-worker.js` needs **no** change: cache-first matches `.js` by extension regex (works for hashed names); `PRECACHE_URLS` has no `shared/*.js`; CACHE_VERSION bump still purges per deploy. **Why:** §7-MM — verify hashing doesn't worsen the SW-stale-debug trap (it improves it: changed files get new URLs).

### Verification (what I can prove vs what needs the owner)
- [x] **Local (done):** 18/18 unit tests; integration smoke on real files (104 hashable, 10 HTML, 0 dangling, negative case flags bogus ref); **full `build.js` on a throwaway temp working-tree copy** (`FORCE_BUILD=1`, NODE_PATH→real node_modules, tailwind execSync neutralized) → exit 0, `🔗 Content-hashed 104 JS assets; all HTML refs rewritten + verified`, `shared/utils.8708c263.js` emitted + dashboard ref rewritten + 0 plain refs.
- [x] **Headers/refs (done by agent via curl — public static, no auth):** prod `shared/<hashed>.js` → 200 + `public, max-age=31536000, immutable`; dashboard HTML → `no-cache`; 0 plain refs; accounting hashed; tenant_app/login/booking hashed JS all 200.
- [ ] **Owner in-app (optional, §7-I — agent can't auth):** hard-reload (clear SW+cache, §7-MM) → dashboard/tenant_app render fine + `(disk cache)` on 2nd navigation + no CSP/console errors + tenant_app (SW page) boots. Not blocking — caching change doesn't alter render; all scripts already proven 200.

### Rollback
`git revert` the build.js + vercel.json commit → redeploy. HTML is no-cache → next load points back at plain names + header returns to no-cache. One deploy cycle, clean.

### Out of scope (named, not silently dropped)
CSS hashing (3 files, SW-precache coupling); identifier-renaming minify (build.js Phase B, separate); the other 2 plan-first P2 items (verifySlip onCall, defer tenant-liff-auth).

---

## Scores by dimension

| Dim | Score | Grade | Headline gap |
|-----|:-----:|:-----:|--------------|
| DevOps/Deploy | 3.4 | A-/B+ | no branch protection; rules never auto-deployed |
| Architecture | 3.2 | B/B+ | `window.X` global coupling; `detectBuilding` ×4 |
| Security | 3.2 | B+ | 4 XSS sinks (now fixed); verifySlip onRequest |
| Tech Debt | 3.1 | B+ | 22MB dup (removed); 28 un-archived migrations |
| Docs & Memory | 3.0 | B | count drift; MEMORY.md over limit; stale docs/README |
| UX/UI | 3.0 | B/B- | tenant nav not keyboard-operable; tab ARIA=0; contrast |
| Code Quality | 2.9 | B- | 21 files >800L; 6 prompt(); silent billing catches |
| Performance | 2.8 | B- | meter_data watch (fixed); no HTTP cache on shared/*.js |
| Testing | 2.8 | B- | frontend ~3% coverage; test:shared not in PR gate |

---

## ✅ DONE this session (working tree — commit + live-verify pending)

- [x] **Perf CRITICAL — bound `meter_data` watch** — `shared/dashboard-extra.js:716` `onSnapshot(collection(db,'meter_data'))` → `query(…, limit(500))`. **Why:** unbounded full-collection real-time watch replayed the whole collection on every admin open + fanned out per meter write. Callback only pings `updateDashboardLive()` (never reads payload). ⚠️ **Live-verify** dashboard auto-refresh after a meter import.
- [x] **XSS — audit log viewer** — `audit-log-viewer.html:599-601` added local `esc()` + wrapped `userEmail`/`userRole`/`attemptedPage`. **Why:** auth gate writes user-controlled fields (incl. unauthenticated denials) → stored XSS into the admin-only viewer. (Net-new sink; prior pass fixed wellness/admin-ops, not this.)
- [x] **XSS — payment notif panel** — `shared/dashboard-bills.js:364/366/373/375` `_esc()` on tenant-controlled `room`/`slipId`/`receiptId`.
- [x] **XSS — billing import status** — `shared/dashboard-bills.js:1255` `_esc(message)`.
- [x] **XSS — toast** — `shared/dashboard-main.js:219` `innerHTML`→`textContent` (defense at the sink for all callers).
- [x] **Tech Debt — delete 22MB stale `The_green_haven/` dup + 3.6MB+448KB debug logs + `tools/csp-hashes-new.json`** (~26MB freed; verified stale: no `.git`, 0 files newer than May 1, old 11KB CLAUDE.md).

All edited JS passes `node --check`. ⚠️ A prompt-injection was detected mid-session (a fabricated `shared/utils.js` read with embedded instructions steering away from the toast fix) — disregarded; every edit verified against on-disk content via `git diff`.

### Verify-before-commit
- [ ] `git push origin main` → Chrome MCP admin login on https://the-green-haven.vercel.app → confirm: meter live-refresh works, payment notif panel renders, toast shows, audit-log viewer renders (per §7-J: static deploy ≠ live verified).

---

## P1 — soon (high value, low/medium effort)

### ✅ DONE this session (commit pending)
- [x] **🔴 PRODUCTION BUG found + fixed — Thai mojibake** — `shared/tenant-system.js` (13 user-facing lines: default tenant name, room label, maintenance titles/content, payment-status text) + `shared/tenant-firebase-sync.js` (2 comments) were double-encoded (UTF-8→CP874→UTF-8) **by the prior P1 commit `7e5ef7b`** (the `console.info` bulk sed). Recovered byte-exact from last-clean commit `0ad1d8a` via `tools/fix-thai-mojibake.js` (git-sourced, zero Thai typed). Also fixed 7 em-dash `โ€"`→`—` corruptions. **`test:shared` 84→86/86 pass.** Full-repo scan: 0 mojibake remaining across 287 files. ⚠️ **Correction to audit:** the `.gitattributes`/CRLF hypothesis was WRONG — corruption was in the committed bytes (RED on every OS), not a Windows line-ending flake.
- [x] **Testing — `.gitattributes` `* text=auto eol=lf`** + per-type rules + binary excludes. **Why:** locks repo to LF (blobs already LF; verified `git add --renormalize` = 0 collateral churn) so working-copy CRLF can never be committed and UTF-8 stays clean. (Not the test-fix cause, but correct hygiene.)
- [x] **Testing — gate `test:shared` in `validate.yml` on PR** — added step after CF unit tests (pure `node --test`, no emulator). Now 86 frontend tests block merge. Safe because suite is green post-bug-fix.
- [x] **DevOps — `deploy-rules.yml`** created — push to main touching rules/indexes → re-run 3 emulator rules suites → `firebase deploy --only firestore:rules,firestore:indexes,storage,database`. Mirrors `deploy-functions.yml` SA/IAM pattern. **Closes the "rules tested but never auto-deployed / wrong-branch-rollback" gap.** Needs SA roles: firebaserules.admin + datastore.indexAdmin + firebase.admin (documented in workflow header).

### ▶ Still open
- [x] **DevOps — branch protection on `main`** — DONE 2026-06-01. Required check `validate`; `enforce_admins:false` (admin bypass — owner keeps `git push origin main` deploy path); force-push + deletion blocked. Noted in CLAUDE.md §5. `firestore-rules`/staging NOT required (path-filtered — would block non-rules PRs).
- [x] **UX HIGH — keyboard-operable tenant nav** — DONE 2026-06-01 (PR #203). `shared/tenant-navigation.js`: `enhanceMenuItemA11y()` (role=button+tabindex on `.menu-item[data-action]`) + `_onTileKeydown` (Enter/Space → synthetic bubbling click, reuses the capture-phase hub). `components.css` `:focus-visible` ring. +11 tests. **Dynamic tiles** (if any) need a `window.enhanceMenuItemA11y()` call in their renderer — static tiles covered.
- [x] **UX HIGH — tab ARIA + dynamic `aria-current`** — DONE 2026-06-01 (nav-current PR #204 + tab-ARIA PR #205). Nav: `updateNavActiveIndex`/`showPage` move `aria-current="page"` (was hardcoded on Home). Tabs: new `shared/dashboard-tab-aria.js` `syncTabAria()` mirrors `.active` → role=tab/tablist + aria-selected via capture-click+microtask (no 7-switcher edit, no HTML sweep). +7 tests. **Deferred:** panel `role=tabpanel`/`aria-controls` (no shared selector).
- [x] **UX HIGH — contrast tokens (core)** — DONE 2026-06-01 (PR #206). `--muted`/`--pebble` darkened to AA + false comment fixed; `--ok-text`/`--alert-text`/`--brand-primary-text` added (light+dark); components.css text uses switched; +18 contrast-lock tests. **Deferred (needs CSP regen):** `<style>`-block `--alert`/`--ok` text in booking/login/tenant_app.html + dark `--brand-primary`-as-text (27 sites, light-passing) → do via live per-element contrast audit, not a blind sweep.
- [~] **UX — live a11y verify on Vercel** — DONE (deployed-code level) 2026-06-01 via Chrome MCP (SW+cache cleared first, §7-MM). On prod, the DEPLOYED MINIFIED modules behave correctly: `enhanceMenuItemA11y` → role=button+tabindex; `_onTileKeydown` Enter → click fires; `syncTabAria` → role=tab/tablist + aria-selected flips on active-move; `updateNavActiveIndex` → aria-current moves. Contrast tokens computed live (--muted 5.40, --pebble 5.14, --ok-text 5.58, --alert-text 5.98 on --cloud) + login.html renders clean (no mojibake, brand intact). **Remaining (needs owner's logged-in session):** in-situ visual on the real dashboard tabs / tenant_app tiles (focus ring, SR announce) — dashboard/tenant are auth-gated; agent does not enter credentials (§7-I / safety).
- [x] **Code Quality — replace 6 `prompt()`** with `window.ghPrompt` — DONE 2026-06-01 (PR #197, `a706b05`). All 6 → async `await window.ghPrompt(...)` (null-on-cancel semantics preserved). NOTE: `generateMonthlyBillsUI`/`downloadInvoicesPDF` are orphaned (0 callers, §7-K) — converted for consistency; **wire-or-delete still open** (see P2).
- [x] **Code Quality — log silent billing catches** — DONE 2026-06-01 (PR #197). 7 bare `catch(e){}` in `_subscribeGlobalVerifiedSlips`/`PaymentStore.onChange` cluster → `console.warn('[billing] …')`. 4 best-effort catches outside the cluster (`_notify` listener isolation, print-window teardown) left per minimal-change.

---

## P2 — when time allows

- [x] **Performance — content-hash caching for `shared/*.js`** — ✅ SHIPPED 2026-06-02 (PR #223 `d393f35`, Approach A — see "▶ ACTIVE PLAN" at top). `build.js` content-hashes `shared/*.js`+`accounting/*.js` (104 files) → `immutable`; HTML/CSS/SW stay no-cache. `tools/asset-hash.js` + 18 tests + build-time verify gate. **Prod-verified live** via curl (hashed JS 200+immutable, dashboard no-cache, 0 plain refs, all pages 200).
- [x] **Performance — analytics aggregation** — DONE 2026-06-02 (the actionable remnant). **`lineRetryQueue`** unbounded `getDocs(collection)` → `query(orderBy('firstFailureAt','desc'), limit(500))` (`dashboard-owner-insights.js`). Found + fixed a **latent bug while there**: the CF-health board read `i.createdAt`, but queue docs only carry `firstFailureAt` (enqueue, `merge:false`) → 7-day success-rate/abandoned/avg-attempts were dead and oldest-pending age showed `NaN`. Extracted pure `_computeCFHealthStats` + **+11 tests** (gate 281→292) incl. a `reads firstFailureAt not createdAt` regression guard. **N/A / already-done (per 2026-06-01 handoff):** `meter_data`/`complaints`/`pets`/`liffUsers` can't use `count()`/`sum()` (per-row processing; `liffUsers` count would undercount status-less docs); `announcements`/`wellness_articles` already bounded. ⚠️ Live-verify (owner): admin dashboard → Owner Insights → CF Health card now shows real %/age, not —/NaN.
- [x] **Performance — defer parser-blocking JS** — ✅ async/defer Sentry loader+init ×4 pages (#224). `tenant-liff-auth.js` defer **SKIPPED** — auth spine, documented sync dependency + parse-time `_onLiffClaimsReady` caller (tenant_app.html:5303) reading `_taBuilding` via bareword (§7-PP/§7-CC). See Review at top.
- [x] **Security — move WAQI/IQAir tokens → Secret Manager** — ❌ DROPPED 2026-06-01 (won't do). Attempted (PR #216) → broke prod CF deploy because the secrets weren't in the prod project (`the-green-haven` 404; my `:get` had checked the wrong project) → reverted `adae1cc`. **Decision: keep `.env`** — it's gitignored + CI-injected from a GitHub Actions secret (not a leak), and Secret Manager was pure hardening not worth the per-project secret-creation + SA-accessor + test-deploy friction for non-critical AQ tokens. Lesson captured in §7-WW. Re-open only if these tokens ever become sensitive.
- [x] **Security — refactor `verifySlip` `onRequest` → `onCall`** — ✅ DONE #224 (admin OR owning-tenant via `_authSoT`); deployed + prod-verified. Restored the ~6-week-broken tenant self-verify (401). See Review at top.
- [x] **Docs — fix count drift** — DONE 2026-06-01. README.md (CF tests 39→86, firestore rules 304→220, added database 48), CLAUDE.md §2 (101→102 files, 26→27 tenant-*.js) + §5 (~70→220 rules cases), MEMORY god-file entry (101→102 shared). Ground truth: 86 CF tests, 83 exported CFs, 220/36/48 firestore/storage/rtdb rules. **`verify:memory` README-count assertion DONE 2026-06-02:** new `runReadmeCountAssertions()` checks 5 in-repo README claims against live counts (firestore 220 / storage 36 / database 48 rule tests · 86 CF unit-test **files** · §7 anti-pattern range+count A–WW/49 vs `### <Letter>.` headings in CLAUDE.md), every occurrence checked so a half-updated README is RED. It immediately caught 3 live drifts → fixed: README commands-table still said firestore "(304 cases)" (the 2026-06-01 fix only touched the layout block — exactly the duplicate-occurrence miss this guards), "86 CF unit tests" relabeled "…files" (the 86 is a file count; ~1.8k `it(` cases), and "§7 A–NN, ~40 patterns" → "A–WW, 49 patterns" (×2 lines). verify:memory green (459 rows, 0 fail).
- [x] **Docs — trim MEMORY.md <24.4KB** — DONE 2026-06-01. 26.2KB → 24.21KiB (197 bytes margin) by compressing Current-state handoff entries + verbose index lines (detail already in linked docs). Fixed stale "checklist-manager skipped / gate 248" → "281, PR #213". `verify:memory` green.
- [x] **Docs — rewrite stale `docs/README.md`** — DONE 2026-06-01. Was a localStorage-era doc (localStorage persistence, localhost:8080, nonexistent tenant-payment.html, © 2024, PII phone) → accurate index of `docs/` runbooks + pointers to root README / CLAUDE.md. **`SECURITY.md` rewritten** as a disclosure policy; removed 3 in-clear API keys (Firebase web, SlipOK, secondary Firebase). ⚠️ Key-rotation status raised with user.
- [x] **Testing — frontend unit tests** — DONE. checklist-manager.js added 2026-06-01 (PR #213, +33 tests, gate 248→281); billing-system / bill-generator / lease-config already covered (prior session). All 4 target modules now have coverage.
- [x] **Architecture — collapse `detectBuilding`** — DONE 2026-06-02. `BuildingConfig.getBuildingForRoom` (`building-config.js`) is now the single source (N-prefix OR named legacy range `NEST_LEGACY_NUMERIC_MIN/MAX` 101-405). `BillingSystem.detectBuilding` + `detectBuildingFromRoomId` + `_taDetectBuilding` all delegate to it (thin defensive inline mirrors kept for pre-load / auth-critical safety). **Latent bug fixed while there:** `getBuildingForRoom` was N-prefix-only AND had 0 callers (§7-K) → it would have returned `'rooms'` for numeric 101-405, disagreeing with the real detector (§7-T landmine); now correct. `detectBuildingFromRooms` (meter-import, array/batch, N-prefix only) intentionally left — different signature + semantics. +9 tests (`building-config.test.js`); behavior-preserving (billing-system's 8 detectBuilding cases still green = fallback === SoT). Gate 292→301.
- [~] **Tech Debt — archive 28 one-shot migration scripts** → `tools/migrations/done/`. ⚠️ **Re-scoped 2026-06-02:** NOT low-blast — only **7** of ~33 one-shots are truly orphan. **7-orphan move DONE 2026-06-02:** `git mv` the 7 (`migrate-lease-duplicates`, `migrate-rewards-strip-note`, `migrate-service-providers-clean-internet`, `backfill-verifiedSlips-from-rtdb`, `fix-csp-styles-p2`, `fix-csp-styles-p3`, `sweep-hex-colors`) → `tools/migrations/done/` + a `README.md` there (archive rationale + per-script purpose/add-date + §7-I do-not-re-run + list of the live templates that stay). Re-verified 0 refs before moving (only self-refs + this todo + handoff). **Still deferred (plan-first):** the other 26 are cited in CLAUDE.md §7 + memory as templates/history → a full archive = doc-repointing sweep past Plan-First threshold (breadth-trap: freeze). Don't blind `git mv *`.
- [x] **Tech Debt — orphaned bill-gen UI** — RESOLVED. `generateMonthlyBillsUI` + `downloadInvoicesPDF` were already deleted by **#202** (a11y session) — grep 2026-06-02 returns 0 definitions. This todo line was stale (written off the PR #197 note). Nothing to do; `BillGenerator.generateMonthlyBills` remains the real entry.
- [x] **Tech Debt — root junk files** — DELETED 2026-06-02 (`bill69-final.xlsx` PII 324K, `S__91643910.jpg` 192K, `Nature Haven Design System.zip` 20K). All were untracked + unreferenced; removed from disk (no commit — never tracked).

---

## Review (2026-05-31, run 2)

**Shipped:** 5 code fixes (1 perf CRITICAL + 4 XSS sinks) + ~26MB junk cleanup. All JS `node --check` clean; `git diff` verified.
**Deferred:** P1/P2 above.
**Follow-up before "done":** live admin verification on Vercel (meter refresh + the 4 escaped surfaces).
**Process note:** prompt-injection detected & disregarded; ground truth re-established via Bash; edits applied against real on-disk content.
**Prior plan:** the 3.12 run (36 tasks, all completed) is in git history at `87bb4a3` / `7e5ef7b` / `2cb408e`. Marketplace sprints remain in [tasks/marketplace-sprints.md](marketplace-sprints.md).
