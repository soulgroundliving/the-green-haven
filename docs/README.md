# The Green Haven — `docs/`

Operational runbooks and point-in-time audit snapshots. **This folder is not the project overview.**

- **Project overview + structure** → [root README.md](../README.md)
- **Workflow protocol, tech stack, deploy commands, recurring anti-patterns (§7)** → [CLAUDE.md](../CLAUDE.md)

## Stack at a glance

Vanilla HTML + Tailwind v3 + `window.X` JS modules (`shared/*.js`); **Firebase** v11 backend (Auth · Firestore · Realtime DB · Cloud Functions · Storage); hosted on **Vercel**. There is no localStorage-as-database and no `localhost` workflow — Firebase Auth rejects `http://localhost`, so verification happens on the Vercel deploy. See [CLAUDE.md §5](../CLAUDE.md) for build / deploy / test commands.

## Contents of this folder

| File | What it is |
|------|------------|
| [STAGING_RUNBOOK.md](STAGING_RUNBOOK.md) | Staging Firebase project + Vercel env setup and promote flow |
| [RESTORE_DRILL_LOG.md](RESTORE_DRILL_LOG.md) | Firestore backup/restore drill log |
| [SECURITY_AUDIT_2026_04_28.md](SECURITY_AUDIT_2026_04_28.md) | Point-in-time security audit (snapshot — see [../SECURITY.md](../SECURITY.md) for the live policy) |
| [PHASE-4-SECURITY.md](PHASE-4-SECURITY.md) | Phase-4 security hardening notes (historical) |
| [HANDOFF_2026_04_27.md](HANDOFF_2026_04_27.md) | Session handoff snapshot (historical) |

Point-in-time documents are kept for traceability. For current architecture, rely on the lifecycle docs referenced from CLAUDE.md / MEMORY — not these snapshots.
