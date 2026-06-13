# Multi-tenancy — design plan (Path A: orgId SaaS · Path C: clone-per-client)

> Design/analysis doc (2026-06-13). NOT an execution plan — nothing here is wired yet.
> Every number is grep-verified against the repo this session. Re-verify before acting; code drifts.
> Companion to the assessment in chat. Decision is the owner's; this de-risks it with specifics.

---

## 0. Current architecture — single-org / multi-building (the starting point)

The codebase has **no tenancy dimension above "building"**. "Tenancy" today means *building → room → occupant*, all inside ONE org.

| Surface | Evidence (grep-verified 2026-06-13) | Org-coupling |
|---|---|---|
| Firestore | **45 top-level collections** (`actionAudit announcements bookings buildings checklistInstances checklistTemplates communityDocuments communityRequests complaints consents counters dataDeletionLog deposits expenses facilityBookings facilityConfig foodShares helpRequests historicalRevenue invoices leaseNotifications leaseRequests leases liffUsers lineRetryQueue maintenanceArchive manualReceipts marketplace people petLinks petProfiles phoneOtpRateLimit pointsLedger presence questClaims quests rateLimits rewards system taxSummary tenants tradeHistory trustScores verifiedSlips`) | all project-global; **0 orgId** anywhere |
| RTDB | **~12 top nodes** (`bills meter_readings maintenance financials housekeeping payments rooms_config tenants users audit_logs system`) | project-global |
| Storage | **~10 path roots** (`pets leases bookings checklists communityDocuments marketplace deposits foodShares`) | project-global |
| Auth claims | `liffSignIn` mints `{ room, building, tenantId }` (tenant) / `{ role:'player', tenantId }` (player); admin = global `admin:true` | **no orgId claim** |
| Rules | **116 `isAdmin()`** in `firestore.rules`; an admin sees/writes EVERYTHING | global, not org-scoped |
| Owner | `owner_info/main` — singleton (branding, PromptPay, etc.) | one owner |
| Project | Firebase project `the-green-haven` hardcoded across **41 files** | 1 project = 1 org boundary |

**Partial win:** `tenants/{building}/…`, `expenses/{building}/…`, `buildings/{buildingId}`, and most Storage roots are already **building-scoped** (2-level). Under multi-org they nest ONE level deeper (`orgs/{orgId}/…`), not a from-scratch redesign. But "building" ≠ "org": two orgs can each have a building keyed `rooms`, so the org level must be **added above** building, not reused from it.

**Region note:** Firestore is `asia-southeast3` (region-locked, §region_split). Fine for a Thailand-focused product; a global SaaS would later weigh multi-region, but that's not the near-term constraint.

---

## Path A — orgId multi-org SaaS (the "unicorn living OS" ambition)

Goal: one deployment serves N independent landlord/PM orgs, each isolated, self-onboarding. This is a **re-architecture of the data + security model** — the riskiest and strongest layer of the codebase.

### A1. Tenancy model decision (do this first)

| Option | Isolation | Cost | Verdict |
|---|---|---|---|
| **Shared project + `orgId` partitioning** | logical (rules-enforced) | the work below (one codebase) | **Recommended** — standard SaaS shape; one deploy, one CF set, one Auth pool |
| Project-per-org | physical (hard) | ops linear in N; = Path C | → that's Path C, not A |

Recommendation: **shared-project + orgId**. The rest of Path A assumes this.

### A2. Data partitioning — 3 surfaces, ~67 entry points

Two sub-strategies (pick per surface):
- **(p) Path-prefix:** `orgs/{orgId}/<collection>/…` — clean isolation, natural rule boundary, but every client query + CF path gains a segment (large code churn, every read/write site).
- **(f) orgId-field + rule filter:** keep collection paths, add `orgId` field, rules enforce `resource.data.orgId == claimOrg()` + every list query must `.where('orgId','==',org)`. Less path churn, but **every unfiltered query is a cross-org leak** (easy to miss; §7-AAA-style footgun) and composite indexes multiply.

**Recommendation:** path-prefix (p) for the building-scoped families (they already nest — cheapest to deepen) + orgId-field (f) only where a path segment is impractical. Mixed, documented per collection.

- Firestore: 45 collections → orgId. The ~6 already building-scoped are cheap; the ~39 flat ones are the bulk.
- RTDB: 12 nodes → `orgs/{orgId}/bills/…` etc. Touches BillStore/MeterStore facades + every CF that writes bills/meter/maintenance.
- Storage: ~10 roots → `orgs/{orgId}/…`; mirror in `storage.rules`.
- **Data migration:** one-shot backfill writing `orgId` (or re-pathing docs) for all existing data → the single legacy org. Non-trivial for RTDB re-pathing.

### A3. Auth / claims / membership (the riskiest leg)

- Add **`orgId` claim** to `liffSignIn` mint + `setCustomUserClaims` (both, per §7-Z) for tenant + player + admin flows.
- **`admin:true` (global) → per-org role.** Introduce `orgMembers/{orgId}/{uid}` (or an `orgRoles` claim map). Rewrite all **116 `isAdmin()`** → `isAdminOf(orgId)` deriving org from the doc path/field. This is the highest-blast-radius change in the repo.
- Custom-claims size limit (1000 bytes) — fine for `{orgId, role, room, building, tenantId}`, but watch if a user belongs to many orgs (then membership goes in a doc, not the claim).
- **Rules test suite must be rewritten/extended.** Today: **326 Firestore rule cases** (+47 storage +48 RTDB). Multi-org needs a whole new axis: "org A admin cannot read org B" for every collection. Expect the suite to roughly double. This is the safety net — budget it as first-class work, not afterthought.

### A4. Org lifecycle / config / ops

- `owner_info/main` singleton → `orgs/{orgId}` doc (branding, PromptPay, LINE channel, building seed).
- **Onboarding:** create-org flow (first admin, invite teammates, seed first building). None exists today (owner = developer = sole admin).
- **Billing:** per-org subscription/metering. None exists.
- **Per-org LINE/LIFF:** each org likely needs its own LINE OA + LIFF channel IDs (currently 1 set, hardcoded) → org config, not env.
- **CSP/origins:** per-org custom domains would multiply CSP `connect-src`/origins (§7-LL/II pipeline assumes one set).

### A5. Phasing (each phase shippable + reversible until A-phase-4)

1. **Extract config** — pull the 41-file hardcoded `the-green-haven` + owner singleton + LIFF IDs behind a config module. *(Also directly enables Path C.)* Low risk, high reuse.
2. **Introduce `orgId` plumbing dormant** — add the claim + `orgs/{orgId}` doc + a single legacy org `green-haven`; everything still resolves to it. No behavior change. Backfill `orgId` onto existing data.
3. **Rules + claims cutover** — `isAdmin()`→`isAdminOf()`, path/field partitioning, the doubled rule-test suite. **This is the no-return, highest-risk phase** — a rules bug here is a cross-org data leak. Stage on the staging project; never CI-first.
4. **Onboarding + billing + per-org LINE** — the product/ops layer that makes it self-serve.

### A6. Risk + effort

- **Blast radius:** rules (116 sites) + every client read + every CF path + Storage + RTDB + the rule-test suite. Effectively the whole data layer.
- **Riskiest:** A3 (a single rules miss = cross-org leak — the worst failure class for a landlord's financial + PDPA data). The current rules-test rigor is the asset that makes this *survivable*, not safe-by-default.
- **Rough order:** months, not weeks — dominated by A2+A3+the test rewrite, not feature work.
- **Do NOT start A** unless: validated multi-org demand + runway for a security-layer rewrite + willingness to freeze feature velocity during A3.

---

## Path C — clone-per-client managed instances (near-term revenue, appendix)

Fork the whole stack per client org: separate Firebase project + Vercel project. Uses the codebase **as-is** (no orgId work). Strong physical isolation. Ops cost scales **linearly** in client count — viable for a *handful* of high-value clients, not self-serve scale.

### C1. What to parameterize per instance

| Item | Where today | Action |
|---|---|---|
| Firebase project ID | hardcoded in **41 files** | the #1 chore — extract to config/env; Phase-A1 work pays off here |
| `owner_info/main` | singleton doc | seed per client (branding, PromptPay) |
| Building seed | `buildings/{id}` registry | seed client's buildings (BuildingRegistry is already dynamic — a real win) |
| Secrets | `functions/.env` + Secret Manager (§7-WW) | per-project: SlipOK, WAQI, LINE tokens |
| LINE OA + LIFF channel IDs | hardcoded | per client (their LINE OA) |
| CSP origins | `vercel.json` + Vercel UI (§7-XX, [[feedback_vercel_ui_overrides_json]]) | per project |
| Service-account key | annual rotation (CLAUDE.md §5) | **× N projects** — the linear-ops pain |

### C2. Per-instance setup checklist (runbook skeleton)

1. New GCP/Firebase project (region SE3 Firestore + SE1 CFs/Storage, §region_split) + enable the 25 APIs + 9 SA roles (§gcp_project_setup).
2. New Vercel project → connect repo (or a per-client branch) → set env (project ID, config) → **set Headers/CSP in Vercel UI** (§7-XX: UI overrides vercel.json — set it explicitly, don't assume).
3. Deploy rules (`firestore/storage/database`) + CFs + indexes (verify by STATE, §7-J).
4. Seed `owner_info`, `buildings/{id}`, first admin claim (`tools/grant-admin-claim.js`).
5. Client's LINE OA + LIFF endpoints → their tenant_app/booking URLs.
6. Smoke: `npm run smoke` (read-only REST asserter) against the new project.

### C3. Ops reality + scale ceiling

- Every CF deploy, key rotation, rules change, dependency-audit fix (#352-style), and CSP regen happens **× N**.
- No cross-client analytics/leaderboard (each project is an island) — usually fine for landlords.
- **Breaks down at ~5-10 clients:** manual per-project ops dominates. That's the signal to invest in Path A (or a deploy-automation layer).

### C4. C → A bridge

C is not throwaway: **C1's "extract the 41-file hardcoded config" IS Path A's Phase 1.** Running 2-3 real client instances also surfaces *which* config is truly per-org (the real Path A partitioning spec) and validates demand before the A3 security rewrite. Sequencing C→A is strictly cheaper than A cold.

---

## Recommendation (sequencing)

1. **Now:** Path B (sell the *service* — manage buildings under the one org; BuildingRegistry already scales buildings) for immediate revenue with zero re-architecture.
2. **First external client(s):** Path C — clone-per-client. Start with **C1 config extraction** (reusable, low-risk). Land 2-3 clients, learn the real per-org config surface.
3. **Only if** C demand validates a self-serve product AND there's runway: **Path A**, reusing C1 as Phase 1, treating A3 (rules/claims + doubled test suite) as the gated, staging-first, no-feature-freeze investment.

**The through-line:** product depth (Meaning Layer, PDPA, trust, automation) is far ahead of multi-tenancy plumbing. The constraint to selling is not features — it's the org-isolation foundation. Don't build A on spec; let C fund and de-risk it.

> Caveat: the `proptech_unicorn_living_os_blueprint.pdf` could not be text-extracted (font-subset, no text layer) — this plan is grounded in the codebase + the general SaaS bar, not the blueprint's specific targets. If the PDF names concrete multi-org/scale goals, re-weight A vs C accordingly.
