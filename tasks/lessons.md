# Lessons — DECOMMISSIONED 2026-05-13

This file is no longer the active intake for project lessons. The append-only log
was rarely opened (neither by user nor agent) and lessons drifted away from where
they were needed.

## New routing (per CLAUDE.md §1 Self-Improvement Loop)

| Type of correction | Where it goes now |
|---|---|
| **Recurring anti-pattern in this project** (cost 2+ sessions, will likely re-occur) | **`CLAUDE.md` §7** as a new letter (J, K, L...). Auto-loaded every session. |
| **One-off project incident** (specific commit fix, niche edge case) | Don't promote — commit message + lifecycle doc update is enough. |
| **Cross-project preference** ("user wants X always") | `~/.claude/projects/.../memory/feedback_<topic>.md` — indexed in MEMORY.md "🤝 Working style". |

## Where the old content went

- **36 lessons (May 2026 → Apr 2026)** preserved as-is in [`tasks/lessons.md.archive`](lessons.md.archive) for git-history searches.
- **6 recurring patterns** promoted to `CLAUDE.md` §7-J through §7-O (2026-05-13):
  - **J.** Static deploy ≠ live-data verified
  - **K.** Defined ≠ wired (grep for callers)
  - **L.** Code-only cleanup ≠ data migrated
  - **M.** "Loadable in browser" ≠ "in production flow"
  - **N.** `onSnapshot` must have error callback
  - **O.** Pre-built feature search — Thai keywords + orphaned APIs
- **Patterns already covered** by §7 A-I (auth-gated reads, Firebase modular SDK, modal display, BillStore, year formats, demand state, self-conflict, memory grep, no auto-click) — no action needed.

## Need to look up an old lesson?

```bash
# Search the archive
grep -in "your-search-term" tasks/lessons.md.archive

# Or git log the original file
git log --all --oneline -- tasks/lessons.md
git show <commit>:tasks/lessons.md | less
```

If you find a recurring pattern in the archive that should be in §7 but isn't, promote it.
