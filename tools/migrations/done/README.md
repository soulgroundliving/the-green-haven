# Executed one-shot migrations — archive

These are **already-executed, one-shot** scripts kept for git-history traceability.
They are **orphan** (0 references anywhere in the repo, CLAUDE.md §7, or memory docs)
and are **not wired** to any `npm` script. Nothing imports them.

> ⚠️ **Do NOT re-run against production.** Each touched live Firestore/RTDB or
> swept source files and has already done its job. Re-running a finished migration
> is exactly the kind of bulk production-data action §7-I forbids. Some paths in
> these files (`path.join(__dirname, '../shared')` in the CSP scripts) no longer
> resolve from this nested location — that is intentional friction, not a bug to fix.
> If you need the *technique* as a template, copy it into a fresh, dated script.

Archived 2026-06-02 (moved from `tools/` — P2 tech-debt cleanup; orphan subset of
the one-shots, the other ~26 stay in `tools/` because they're cited as templates).

| Script | Added | Purpose (one-shot) |
|--------|:-----:|--------------------|
| `migrate-lease-duplicates.js` | 2026-05-17 | Delete duplicate `leases/{b}/list/*` docs the render-time dedupe already hides (3 lease-id minting patterns coexisted). |
| `migrate-rewards-strip-note.js` | 2026-05-17 | Strip the dead free-text `note` field from `rewards/*` after the 2026-05-17 quota-only redesign. |
| `migrate-service-providers-clean-internet.js` | 2026-05-17 | Remove dead `type: 'internet'` / `'maintenance'` items from `system/serviceProviders.items`. |
| `backfill-verifiedSlips-from-rtdb.js` | 2026-05-04 | Recover historical paid-marks: mirror RTDB `bills/*` `status='paid'` → Firestore `verifiedSlips` (idempotent; console-paste script). |
| `fix-csp-styles-p2.js` | 2026-04-27 | Phase-2 sweep: inline `.style.*` → CSS classes for CSP compliance. |
| `fix-csp-styles-p3.js` | 2026-04-27 | Phase-3 sweep: remaining inline `.style.*` → CSS classes. |
| `sweep-hex-colors.js` | 2026-05-27 | Replace hardcoded hex in `shared/dashboard-*.js` with `DashColors.*` constants. |

**Still-live templates that deliberately stay in `tools/`** (wired or cited as
canonical examples): `migrate-tenant-doc-to-slim.js`, `backfill-occupancy-log.js`,
`backfill-liff-claims.js`, `backfill-unlinked-claims.js`, `fix-orphan-leases.js`,
`fix-thai-mojibake.js`, plus all CSP / verify-memory / audit / install tooling.
