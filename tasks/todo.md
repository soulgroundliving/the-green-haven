# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

## Review — Security campaign (2026-04-28 → 2026-04-29)

**Why:** User asked "if a hacker were hired to attack us, what could they do?" → 5 audit rounds + supply-chain hardening + operational hardening.

**Shipped (22 commits, `474514d` → `867e22a`):**

- ✅ Round 1 surface — RTDB `rooms_config`/`tenants`/`meter_readings` rules, XSS escape in service providers, `javascript:` URI block, stale `config/firestore.rules` removed
- ✅ Round 2 privilege chains — `linkAuthUid` deleted (cross-tenant hijack), `redeemReward` + `claimDailyLoginPoints` ownership checks, `awardRentPaymentPoints` deleted, `verifySlip` race + amount-mismatch fixed, `setAdminClaim` INIT_TOKEN lockdown, `leaseRequests` anonymous bypass closed
- ✅ Round 3 insider/spy — `aggregateMonthlyRevenue` admin-gated, `seedRewards` + `seedAppConfig` deleted, `migrateToFirestore` orphan removed, Storage rules `pets` write + `leases` read scoped to claims, `verifySlip` per-room cap 1000→50
- ✅ Round 4 supply chain — `npm audit fix` patched CRITICAL `protobufjs` RCE, `Permissions-Policy` header, SRI sha256 hashes on 7 third-party CDN scripts
- ✅ Round 5 ops follow-ups — `xlsx` phantom dep removed, LIFF Auth `displayName` populated, `archiveAuthEvents` BigQuery archive CF, `initializeRooms` orphan removed, **CSP Report-Only deployed + verified clean live (0 violations across 241 console messages)**, `style-src-attr 'unsafe-inline'` for the 1681 inline `style="..."` attributes

**Operational P1-P2 done by user (in their browser):**
- ✅ 2FA on GitHub/Firebase/Vercel/Google/LINE
- ✅ GCP API key HTTP referrer restrictions
- ✅ GitHub branch protection on `main` (PR review + status checks + linear history + no force push + signed-commits checkbox unticked due to GPG issue)
- ✅ Secret rotation (SLIPOK, IQAir, WAQI tokens)
- ✅ INIT_TOKEN scrubbed from `.env`
- ✅ GCP IAM least-privilege (removed Editor; specific roles only)
- ✅ Firebase Auth user list audited
- ✅ Firebase budget cap + SlipOK quota monitoring
- ✅ Cloud Functions error rate alert (>10/5min)
- ✅ Failed login log-based alert (`INIT_TOKEN rejected` string match)
- ✅ Notification channel
- ✅ npm audit clean (root: 0 vulns; functions: 13 transitive in @google-cloud/* — non-urgent)

**Pending operational** (when user has time, not urgent):
- ⏳ BigQuery `audit_archive` IAM downgrade Admin → Data Editor (after first scheduled run of `archiveAuthEvents` lands data)
- ⏳ Firebase App Check setup (admin paths only — `dashboard.html` + `login.html`; **NOT** `tenant_app.html` because LIFF browser blocks reCAPTCHA)
- ⏳ CSP enforce-mode flip after 1-2 weeks of monitoring (rename header `Content-Security-Policy-Report-Only` → `Content-Security-Policy`)
- ⏳ GPG signed-commits fix (PowerShell key in modern keyboxd format unreadable by Git Bash 2.4.9 gpg; either install Gpg4win full or re-create key with Git's gpg)

**Accepted residuals** (evaluated and deliberately NOT fixed — see `tasks/lessons.md` for reasoning):
- `complaints` / `liffUsers` Firestore-create has no per-tenant rate limit — admin queue monitoring is the safeguard
- 14 CFs use `Access-Control-Allow-Origin: *` — Bearer token check is the real defense; CORS allowlist gives marginal layer-3 with high churn cost

**Reports:**
- [docs/SECURITY_AUDIT_2026_04_28.md](../docs/SECURITY_AUDIT_2026_04_28.md) — full audit (Rounds 1-4; Round-5 not yet appended)
- Memory handoff: `next_session_handoff_2026_04_29_security_complete.md`

---

## Format reference (for next task)

```
## <Task title> (YYYY-MM-DD)

**Why:** <reason / motivation>

**Plan:**
- [ ] Sub-task 1
- [ ] Sub-task 2

**Verification:**
- [ ] How to prove it works
```
