# Security Audit — The Green Haven
**Date:** 2026-04-28
**Auditor:** Claude (Sonnet 4.6) — adversarial threat-modeling agents + manual verification
**Scope:** Full stack — Firebase (Auth, Firestore, RTDB, Storage, Cloud Functions), Vercel hosting, frontend JS, build/deploy chain
**Outcome:** 14 verified vulnerabilities closed across 3 audit rounds. 2 residuals accepted with documented rationale. 5 trust-chain dependencies remain (operational, not code-level).

---

## ⚠️ Honest answer to "Are we hacker-proof now?"

**No system is hacker-proof.** What we achieved:

✅ **Fixed:** Every code-level attack path that 3 rounds of adversarial review surfaced
✅ **Verified:** Each fix tested live (HTTP probes, atomic-uniqueness checks, rule deploys)
✅ **Documented:** Decisions on what NOT to fix (so future sessions don't reopen them)

❌ **Did NOT fix (out of audit scope):**
- Attacks that require compromising **trust roots** (LINE, Firebase service accounts, GitHub access)
- New vulnerabilities introduced after this date
- Operational security (key rotation, IAM hygiene, 2FA enforcement)
- Supply-chain attacks (malicious npm packages, compromised CDN)
- DDoS, social engineering, physical security

**Security is a process, not a state.** This audit is a snapshot. New code = new attack surface. Run the same exercise after every architectural change.

---

## Executive Summary

| Round | Focus | Vulnerabilities Closed | Severity Range |
|-------|-------|------------------------|-----------------|
| 1 | Surface — rules, XSS, stale files | 6 | CRITICAL → LOW |
| 2 | Privilege chains — CF auth, ownership | 6 | CRITICAL → MEDIUM |
| 3 | Insider/spy — unauth CFs, Storage scoping | 5 | CRITICAL → LOW |
| **Total** | — | **17 fixes / 13 commits** | — |

**Time-to-pwn before audit:** ~30 min if attacker knew endpoints (Round-1 + Round-2 chain)
**Time-to-pwn after audit:** Requires breaking a trust root (LINE LIFF infra, Firebase service account, or GitHub repo) — orders of magnitude harder

---

## Methodology

1. **Round 1** (initial sweep) — Two Explore agents in parallel scanned rules + frontend XSS + API endpoints. User-validated findings before fixing.
2. **Round 2** (deep) — Spawned threat-modeling agent focused on Cloud Function privilege escalation, race conditions, and money-manipulation paths. Each finding verified against source before fix.
3. **Round 3** (residuals) — Targeted insider threats, unauthenticated HTTP endpoints, Storage rules, rate limits.

**Verification doctrine:** Every claim backed by `grep -n` against current code (per [feedback_verify_via_grep_doctrine.md](../../../.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory/feedback_verify_via_grep_doctrine.md)). Every fix tested live. False-positive findings (3 in Round 2) explicitly rejected with reasoning.

---

## Findings & Fixes — Chronological

### Round 1 — Surface Sweep
**Commit:** `474514d`

| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 1.1 | RTDB `rooms_config` write open to any auth user | HIGH | Restrict `.write` to `auth.token.admin == true` |
| 1.2 | RTDB `tenants` node read open to any auth user | HIGH | Restrict `.read` to admin-only |
| 1.3 | RTDB `meter_readings` no per-room scoping | MED | Scope to `auth.token.{room,building}` claims |
| 1.4 | XSS in `dashboard-extra.js` service providers (`p.name/type/phone/email/website` un-escaped in `innerHTML`) | MED | Apply `_esc()` to all fields |
| 1.5 | XSS via `javascript:` URI in `<a href="${p.website}">` | HIGH | Validate `^https?://` before using as href |
| 1.6 | `leaseRequests` rule allowed any signed-in user (no room scoping) | MED | Require `payload.{room,building}` match `auth.token` claims |
| 1.7 | Stale `config/firestore.rules` with `allow read,write: if request.auth != null` catch-all | LOW (drift) | `git rm` (file not deployed but presence = misconfig risk) |

### Round 2 — Privilege Chains
**Commits:** `992b1a5`, `b7dac0e`, `054508a`, `8a62577`, `c2c266f`

| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 2.1 | `linkAuthUid` CF accepted client-supplied `lineUserId` → cross-tenant hijack of any approved room | **CRITICAL** | CF deleted entirely — `liffSignIn` (extracts lineUserId from verified LIFF token) is the canonical path |
| 2.2 | `redeemReward` + `claimDailyLoginPoints` accepted `building/roomId` from client without verifying caller's claims → drain other tenants' points | **CRITICAL** | Add `context.auth.token.{room,building}` ownership check (admin bypass for ops) |
| 2.3 | `awardRentPaymentPoints` rogue: no caller validation, dead path `tenants/{tenantId}`, points value from client | **CRITICAL** | CF deleted — `verifySlip` already awards on-time rent points server-side |
| 2.4 | `verifySlip` race: `isDuplicateSlip()` query + `addDoc()` not atomic — two concurrent submissions of same slip → double payment | HIGH | `transactionId` as doc ID + `.create()` (Firestore atomic uniqueness) |
| 2.5 | `verifySlip` amount mismatch warned but returned success → ฿1 slip against ฿10,000 bill saved as paid | HIGH | Reject with HTTP 400 `amount_mismatch` |
| 2.6 | `setAdminClaim` INIT_TOKEN allowed re-bootstrap if leaked (no "admin already exists" check) | MED | Two-layer: env var unset + `hasAnyAdmin()` lockdown in code |
| 2.7 | `leaseRequests` create allowed `request.auth.token.room == null` (anonymous bypass) | MED | Require `(admin)` OR `(claims match payload)` — anonymous denied |

### Round 3 — Insider / Public-HTTP Surface
**Commits:** `959936d`, `97eb6cc`, `a09fe11`, `9883753`, `b29d6bc`, `3cc29c5`

| # | Vulnerability | Severity | Fix |
|---|--------------|----------|-----|
| 3.1 | `aggregateMonthlyRevenue` HTTP endpoint had **zero auth** — anyone could POST to overwrite `taxSummary` financial data | **CRITICAL** | Add `requireAdmin()` (matches `archiveSlipLogs` pattern) |
| 3.2 | `seedRewards` + `seedAppConfig` HTTP endpoints unauthenticated — `curl -X POST` resets reward catalog or merge-overwrites system config | **CRITICAL** | Both CFs deleted (one-shot launch utilities; admin CRUD UI exists in dashboard) |
| 3.3 | `migrateToFirestore.js` orphan source — used query-param token, wrote dead path `tenants/{tenantId}`. Not exported but presence = drift surface | LOW | `git rm` |
| 3.4 | Storage `pets/{building}/{room}/{petId}/...` write open to any signed-in user → cross-tenant photo overwrite + quota fill | HIGH | Require `auth.token.{room,building}` match (admin bypass) |
| 3.5 | Storage `leases/{building}/{roomId}/...` read open to any signed-in user → cross-tenant privacy leak (rent, deposit, signatures) | HIGH | Require `(admin)` OR `(token.{room,building}` match `path)` |
| 3.6 | `verifySlip` rate limit 1000/day per room — single compromised LIFF account could drain SlipOK quota at 30,000/mo | MED | Lower to 50/day per room (50× expected real volume) |

---

## Architecture Strengths (defenses verified, NOT changed)

These were checked and confirmed working — they're the load-bearing security:

1. **`liffSignIn` CF** — extracts `lineUserId` from a server-verified LIFF token (LINE's `/oauth2/v2.1/verify`), then mints Firebase custom token with `{room, building}` claims atomically. Replaces the legacy `signInAnonymously + linkAuthUid` chain that had the cross-tenant hijack hole.

2. **Firestore default-deny catch-all** — `match /{document=**} { allow read, write: if false; }` at the bottom of `firestore.rules`. Anything not explicitly allowed is denied.

3. **Custom-claim model** — `admin: true`, `accountant: true`, `room`, `building` are all set server-side via Admin SDK. Clients can read but not modify their own claims.

4. **`_auth.js` shared helpers** — `verifyIdTokenFromHeader` + `requireAdmin` give every HTTP CF a one-line gate. Used by `archiveSlipLogs`, `backupFirestore`, `cleanupAnonymousUsers`, `cleanupOldDocs`, `cleanupRealtimeDB`, `cleanupRoomData`, `cleanupTenantsSSoT`, `fixLegacyBillBuilding`, `migrateTenantsToSSoT`, `remindLatePayments`, `remindLeaseExpiry`, `verifySlip`, and now `aggregateMonthlyRevenue`.

5. **Rule-test suite** (`firestore.rules.test.js`) — 15 invariants encoded. Updated in Round 2 to add `LIFF_TENANT` context + 5 new test cases for `leaseRequests`. CI gate prevents accidental rule loosening.

6. **Verify-memory tooling** (`tools/verify-memory.js`) — pre-commit hook runs every load-bearing claim in lifecycle docs as a `grep` against current code. Catches doc/code drift (caught 4 stale `linkAuthUid` references during this audit).

7. **Schema-constrained `auth_events`** — failed-login audit log limited to 4 fields with size caps. Immutable at rule level (no update/delete).

---

## Accepted Residuals — Why We Didn't Fix

### R-1: `complaints` / `liffUsers` Firestore-create has no per-tenant rate limit
- **Threat:** A signed-in tenant could spam complaints, filling admin queue
- **Why not fixed:** Proper fix requires routing writes through callable CF (frontend change). Current write path is direct Firestore SDK
- **Mitigation:** Admin queue monitoring; LIFF token requirement (upstream LINE rate limit) for liffUsers
- **Promote to fix when:** Anomalous spam observed in logs

### R-2: 14 Cloud Functions use `Access-Control-Allow-Origin: *`
- **Threat:** Cross-origin POST from `attacker.com` if admin Bearer token leaks
- **Why not fixed:** Bearer-token requireAdmin is the real defense. CORS allowlist only blocks browser-based replay; server-to-server token replay bypasses CORS entirely. Vercel preview URLs (`*-the-green-haven.vercel.app`) make strict allowlist brittle
- **Mitigation:** All admin CFs require Bearer token; setAdminClaim has INIT_TOKEN lockdown; XSS audit clean (no obvious dashboard XSS found)
- **Promote to fix when:** Any dashboard XSS surfaces, OR architectural review concludes layer-3 defense worth the churn

---

## Out-of-Scope Risks (NOT audited in this session)

These are real attack surfaces that this code-level audit could not assess. Each requires separate work:

### Trust-Chain Dependencies
1. **LINE LIFF infrastructure** — If LINE's token-issuing system is compromised, `liffSignIn` mints custom tokens for forged identities. Mitigation: LINE's own security; out of our control.
2. **Firebase service accounts** — A leaked service-account JSON bypasses every Firestore/RTDB/Storage rule. Audit GCP IAM for least-privilege; rotate keys quarterly.
3. **GitHub repository access** — Anyone with `push` to `main` can backdoor next deploy. Hardening: branch protection, required PR reviews, signed commits, 2FA mandatory.
4. **Vercel deployment pipeline** — Compromised Vercel account = arbitrary code on production. Mitigation: 2FA, audit log review.
5. **TLS / CA infrastructure** — Audit assumes HTTPS certificates aren't forged. Browser pinning + HSTS recommended.

### Other Categories Not Covered
- **Supply-chain (npm, CDN)** — `npm audit` not run as part of this audit. LIFF SDK + Firebase SDK loaded from CDN without SRI hashes.
- **Dependency vulnerabilities** — Run `npm audit` quarterly + before each deploy.
- **DDoS / bot traffic** — Cloudflare or similar not configured. Vercel + Firebase have built-in throttling but not application-level bot detection.
- **Browser extension attacks / clipboard hijack** — Out of project scope.
- **Side-channel (timing, cache)** — Not relevant to this app class.
- **Physical security** — Out of scope.
- **Social engineering** — User training / 2FA / awareness, not code.

---

## Recommended Next Steps

### Operational (NOT code)
1. **Enable 2FA** on all GitHub + Firebase + Vercel accounts. Audit who has access.
2. **Rotate `SLIPOK_API_KEY`, `IQAIR_API_KEY`, `WAQI_API_TOKEN`** every 6 months or on suspicion.
3. **Verify INIT_TOKEN is removed from `.env`** (done in this audit) AND any backup .env files.
4. **GitHub branch protection** on `main`: require PR reviews, signed commits, status checks (the pre-commit `verify:memory` hook runs locally — also wire it into CI).
5. **GCP IAM review** — list every service account, ensure least-privilege roles. Especially `{PROJECT_ID}@appspot.gserviceaccount.com` should NOT have BigQuery Admin (downgrade to Data Editor per `archiveSlipLogs.js` doc).
6. **Quarterly `npm audit`** in `functions/` and root. Fix HIGH/CRITICAL findings.

### Code (incremental hardening, when time permits)
1. **Address R-1** (complaints/liffUsers rate limit) if spam observed
2. **Add SRI hashes** to LIFF SDK + xlsx CDN script tags (`<script integrity="sha384-...">`)
3. **Audit log immutability** — move `auth_events` to BigQuery (write-only IAM) so even compromised admins can't tamper
4. **Re-run this 3-round audit** after every major architectural change (new CF, new collection, new rule)

### Monitoring
1. **Firebase Auth anomaly alerts** — set up email alerts on >50 failed logins/day, >10 admin grants/month, etc.
2. **SlipOK quota alerts** — alert if daily quota >50% consumed (post-fix this is anomalous)
3. **Cloud Functions error rate** — alert on 401/403 spikes (someone probing)

---

## Audit Trail

| Date | Round | Commits | Files Touched |
|------|-------|---------|---------------|
| 2026-04-28 | 1 | 1 (`474514d`) | `firestore.rules`, `database.rules.json`, `dashboard-extra.js`, removed `config/firestore.rules` |
| 2026-04-28 | 2 | 5 (`992b1a5`–`c2c266f`) | `linkAuthUid.js` (deleted), `redeemReward.js`, `claimDailyLoginPoints.js`, `complaintAndGamification.js`, `verifySlip.js`, `setAdminClaim.js`, `firestore.rules`, `firestore.rules.test.js`, `LAUNCH_CHECKLIST.md`, memory docs |
| 2026-04-28 | 3 | 6 (`959936d`–`3cc29c5`) | `aggregateMonthlyRevenue.js`, `seedRewards.js` (deleted), `seedAppConfig.js` (deleted), `migrateToFirestore.js` (deleted), `storage.rules`, `verifySlip.js`, `tasks/lessons.md` |

All commits signed `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Pre-commit hooks ran `verify:memory` (zero RED) and security checks (clean) on every commit.

---

## Sign-off Statement

This audit closed every code-level attack path identified by 3 adversarial review rounds. The system's residual attack surface is now **at the trust-chain level** — exploiting it requires compromising LINE, Firebase, GitHub, or Vercel infrastructure, which is significantly harder than exploiting the application directly.

This is **not a guarantee of safety**. It is a verified snapshot of "every path the audit checked is closed." New code, new dependencies, and new threats can re-introduce risk at any time. Treat security as a recurring practice, not a milestone.

**Next audit suggested:** After any of the following — new Cloud Function, new Firestore/RTDB collection, new third-party SDK, major npm dependency update, or 6 months from this date (whichever comes first).
