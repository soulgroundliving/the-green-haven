# Smoke Test — one-page how-to

Catches regressions in the 5 critical user flows: **login / bill / slip / checklist / deposit**. Two playbooks (admin + tenant LIFF), one shared verifier.

## TL;DR

```bash
firebase login                          # one-time, OAuth for verifier
$env:SMOKE_ADMIN_EMAIL    = "..."       # PowerShell — never commit
$env:SMOKE_ADMIN_PASSWORD = "..."
npm run smoke                           # pre-flight + print playbook paths
```

Then:
- Open `tasks/smoke-test-admin-playbook.md` → execute via Chrome MCP (Claude drives) → tick ☐ rows.
- Open `tasks/smoke-test-liff-playbook.md` → user runs in real LINE on phone → tick ☐ rows.

Verifier subcommands (call between Chrome MCP steps to confirm server-side):
```bash
npm run smoke:verify -- login    --email $env:SMOKE_ADMIN_EMAIL
npm run smoke:verify -- bill     --building rooms --room 15
npm run smoke:verify -- checklist-instance --id <id>
npm run smoke:verify -- deposit  --building rooms --room 15
```

Each verifier prints one JSON line. Exit 0 = pass for that row.

## File map

| File | Purpose |
|------|---------|
| `tools/smoke-test/runner.js` | `npm run smoke` entry. Pre-flights env + auth, prints playbook sequence. |
| `tools/smoke-test/verify.js` | `npm run smoke:verify` entry. Read-only REST asserter. |
| `tools/smoke-test/README.md` | This file. |
| `tasks/smoke-test-admin-playbook.md` | Chrome MCP-driven admin smoke (5 flows). |
| `tasks/smoke-test-liff-playbook.md` | User-driven tenant LIFF smoke (5 mirror flows). |

## Safety

- **Read-only by default.** `verify.js` only issues GET requests; `runner.js` is print-only.
- **No secrets stored in repo.** Admin credentials live in env vars only. `.gitignore` does not need a new line — there's no smoke `.env` file by design.
- **No production data writes from Node.** Any write that happens (slip upload in LIFF playbook Flow 3, checklist submit in Flow 4) is a user-initiated action inside LINE, not a smoke automation.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `npm run smoke` says "✗ firebase-tools OAuth token" | `firebase login` never ran on this machine | run `firebase login` once |
| Verifier `login` check fails with HTTP 403 | firebase-tools OAuth token lacks Identity Toolkit scope | re-run `firebase login --reauth` |
| Verifier `bill` check fails HTTP 401 | RTDB OAuth scope missing | re-run `firebase login --reauth`; if still failing, use `gcloud auth application-default print-access-token` and set `GCLOUD_ACCESS_TOKEN` env var |
| Verifier `deposit` returns "doc not found" but admin UI shows the deposit | the deposit doc id format may have drifted; doc id should be `${building}_${roomId}` per `shared/dashboard-requests-admin.js:1595` | grep the writer file to confirm doc-id shape; update verifier if shape changed (§7-T pattern) |
| Chrome MCP extension not connected | extension paused / browser closed | ask user to reopen the browser + the Chrome MCP extension |

## When to add new flows

If a 6th critical flow emerges (e.g. booking, marketplace), do NOT just add it to this smoke — first ask:

1. **Does it break for users in production?** If yes, candidate.
2. **Is it covered by another playbook?** (`liff-verify-checklist.md`, etc.) — if yes, reference + skip.
3. **Is the marginal coverage worth +1 min to the smoke runtime?** Smoke must stay <10 min to be repeatable.

Adding flow = update both playbooks (admin + LIFF), verifier subcommand, `runner.js` pre-flight, README, and `memory/lifecycle_smoke_test.md`. Keep the 5-flow-or-less discipline unless there's a strong case.
