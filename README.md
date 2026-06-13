# The Green Haven

Professional apartment management system with tenant payment portal and PWA support.

**Live:** https://the-green-haven.vercel.app

> **Two-name convention:** "Nature Haven" is the tenant-facing project name (LINE LIFF / PWA / day-to-day product). "The Green Haven" is the company/legal/infrastructure name (repo, billing entity, tax filings). Both refer to the same product — do not consolidate.

## What's in this repo

A Thai apartment management platform serving two user types:

- **Tenants** — LINE LIFF webview (`tenant_app.html`): bills, meter readings, lease docs, checklists, marketplace, community feed, daily-login gamification.
- **Admins** — Web dashboard (`dashboard.html`): tenant management, bill generation, payment verification (SlipOK), maintenance tickets, analytics, tax filing.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Markup | Vanilla HTML (no framework) |
| Styling | Tailwind CSS v3 (pre-built) + custom CSS variables |
| Logic | Vanilla JS modules (UMD-style `window.X = ...` exports) |
| Backend | Firebase v11 — Auth, Firestore (SE3 Jakarta), Realtime DB, Cloud Functions (SE1 Singapore), Storage |
| Hosting | Vercel (auto-deploy from main); `/api/*` serverless functions |
| Auth | Firebase Auth + custom claims; LINE LIFF SDK for tenant identity |
| Build | esbuild (whitespace minify + console-noise stripping) |
| Tests | Node `node:test` + Firebase Local Emulator (`@firebase/rules-unit-testing`) |

**Frameworks NOT used:** React, Vue, Svelte, Next.js, TypeScript. New code stays in vanilla HTML + Tailwind classes + a `shared/<feature>.js` module. See [CLAUDE.md](CLAUDE.md) §2.

## Quick start

### Prerequisites

- Node.js 22+
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Auth, Firestore, RTDB, Storage, Cloud Functions enabled
- Vercel CLI (`npm install -g vercel`) — optional, only for local dev

### Setup

```bash
git clone https://github.com/soulgroundliving/the-green-haven.git
cd the-green-haven
npm install              # also installs git hooks (postinstall)
npm install --prefix functions
```

### Environment variables

Copy `.env.example` and fill in your values (see file for required keys). Production env vars live in Vercel project settings, not this repo.

### Local dev

```bash
vercel dev               # localhost preview (Firebase Auth REJECTS plain localhost — see CLAUDE.md §1)
```

For UI verification, push to a branch and check the Vercel preview — Firebase Auth requires an HTTPS origin.

## Common commands

| Command | Purpose |
|---------|---------|
| `git push origin main` | Vercel auto-deploys to production |
| `npm run build` | esbuild minify + strip console noise from `shared/**/*.js` + `accounting/**/*.js` (Vercel runs this automatically) |
| `npm run tailwind:build` | Recompile `shared/tailwind.input.css` → `shared/tailwind.css` |
| `npm run test:rules` | Firestore security rules (330 cases) |
| `npm run test:storage` | Storage security rules (47 cases) |
| `npm run test:unit` | Cloud Function unit tests (with coverage) |
| `npm run verify:memory` | Verify architecture docs against current code (pre-commit hook calls this) |
| `npm run audit:size` | Report file-size headroom vs budgets |
| `firebase deploy --only firestore:rules,storage,database` | Manual rules deploy |

Cloud Functions deploy automatically via [`deploy-functions.yml`](.github/workflows/deploy-functions.yml) on push to main when `functions/**` changes (requires `FIREBASE_SERVICE_ACCOUNT_THE_GREEN_HAVEN` repo secret).

## Repository layout

```
.
├── CLAUDE.md                 # Workflow protocol — read this first if contributing
├── tenant_app.html           # Tenant LIFF webview (single-page)
├── dashboard.html            # Admin dashboard (single-page)
├── login.html / booking.html / tax-filing.html / payment.html
├── shared/                   # JS modules + brand CSS (vanilla, window.X exports)
│   ├── tailwind.css          # Pre-built (do not edit; edit tailwind.input.css)
│   ├── brand.css             # Design tokens (use these, not hardcoded hex)
│   └── *.js                  # Feature modules
├── functions/                # Cloud Functions (Node 22, region SE1)
│   └── __tests__/            # 132 CF unit-test files
├── api/                      # Vercel serverless functions
├── firestore.rules + firestore.rules.test.js  # 330 rule tests
├── storage.rules + storage.rules.test.js      # 47 rule tests
├── database.rules.json + database.rules.test.js  # 54 rule tests
├── tools/                    # Build / migration / verification scripts
└── .github/workflows/        # CI: rules, deploy, validate, npm-audit
```

## Architecture invariants

- **Region split:** Cloud Functions + Storage run in `asia-southeast1` (Singapore); Firestore is in `asia-southeast3` (Jakarta, region-locked). Firestore **triggers do not work** from SE3 — see [CLAUDE.md §7-NN](CLAUDE.md). New CFs reacting to Firestore writes MUST be HTTPS callable invoked from client after the write.
- **Auth claims:** Tenant LIFF sessions get `room` + `building` custom claims via `liffSignIn` CF. Claims must be persisted via `setCustomUserClaims` (not just `createCustomToken`) — see [CLAUDE.md §7-Z](CLAUDE.md). Storage rules have a Firestore-SoT fallback for stale-claim windows.
- **Two-name rule:** "Nature Haven" (project) ≠ "The Green Haven" (company). Keep them distinct in UI vs tax/legal contexts.
- **No localhost verification:** Firebase Auth rejects `http://localhost` — always test on the Vercel deploy.

## Contributing

This codebase is operated with [Claude Code](https://claude.com/claude-code). Workflow conventions live in [CLAUDE.md](CLAUDE.md):

- Bug fixes / single-feature changes → direct PR
- Multi-file architectural changes → plan-first protocol (write `tasks/todo.md`, get approval)
- Recurring anti-patterns → logged in CLAUDE.md §7 (currently A–MMM, 65 patterns)
- Memory drift → caught by pre-commit `npm run verify:memory`

Pre-commit hook enforces: credential scan, memory verifier, CF unit tests (if `functions/` staged), anti-pattern audit, file-size limits, CSP hash drift.

## Documentation

- [CLAUDE.md](CLAUDE.md) — workflow protocol, tech stack details, anti-pattern catalog (§7 A–MMM)
- `tasks/todo.md` — active plan (when above plan-first threshold)
- `.github/workflows/*.yml` — CI documentation lives in each workflow header
- Lifecycle docs live in the maintainer's `~/.claude/projects/...` memory (not committed)

## License

Private. Contact repo owner for any reuse.
