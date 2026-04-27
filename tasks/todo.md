# Active task plan

Per `CLAUDE.md § 3`: any non-trivial task starts here as a checkable plan. Get approval before implementing.

---

## Coordinate MEMORY.md ↔ CLAUDE.md (2026-04-28)

**Why:** Both files auto-load at session start. Currently they overlap in ~3 areas (Muji aesthetic, deploy rule, verification), have 1 contradiction risk (lesson vs feedback delineation), and lack bidirectional pointers. Without clear boundary rules, future me will duplicate content into both, and the next "where do I write this lesson?" will be a coin flip. The user explicitly asked for "ประสานกันสมบูรณ์กับสถาปัตย์ความจริง" — so each kind of content needs exactly one home.

### Recommendation: keep separate by scope (don't merge)

| | CLAUDE.md | MEMORY.md |
|---|-----------|-----------|
| **Location** | `<repo>/CLAUDE.md` | `~/.claude/projects/.../memory/MEMORY.md` |
| **Git** | committed | NOT committed (user-scoped) |
| **Loaded by** | Claude Code (project) | auto-memory (user) |
| **Owns** | workflow protocol · tech stack table · build/deploy commands · pointers to `tasks/*` | critical rules · system lifecycles · working-style feedback · session journals · archive |
| **References (no duplicate)** | MEMORY.md sections | CLAUDE.md as protocol entry point |

### Boundary rules (single home for each content type)

| Content | Home |
|---------|------|
| Tech stack — what's installed | CLAUDE.md § 2 |
| Workflow protocol (Plan-First, Lessons Loop, etc.) | CLAUDE.md § 1 |
| Build/deploy/test commands | CLAUDE.md § 5 (NEW) |
| Critical bug-prone rules | MEMORY.md § ⛔ |
| System lifecycles | MEMORY.md § 🏛️ |
| Cross-project working-style | MEMORY.md § 🤝 (`feedback_*.md`) |
| **Project-specific lessons/incidents** | `tasks/lessons.md` (repo) |
| Active task plan | `tasks/todo.md` (repo) |
| Reference / narrow durable | MEMORY.md § 🧭 |

### Plan

**A. Edit CLAUDE.md**
- [ ] **A1** Add explicit bidirectional pointer near top: "MEMORY.md = architecture + history; this file = workflow + stack. Read both at session start."
- [ ] **A2** Tighten Muji section — defer details to `memory/brand_living_os.md` rather than restating typography/whitespace rules in two places.
- [ ] **A3** Add new § 5 "Build / Deploy / Test commands" — `npm run tailwind:build`, `npm run build`, `npm run test:rules`, `git push origin main`. (Currently scattered or implicit.)
- [ ] **A4** Strengthen "lesson vs feedback" delineation in § 1 Self-Improvement Loop:
   - `tasks/lessons.md` = project incidents ("I shipped wrong UI text → all LIFF locked out")
   - `memory/feedback_*.md` = cross-project preferences ("user wants minimal changes, no surrounding cleanup")
   - Decision rule: if it could apply to a different project, → `feedback_*.md`; if it's about THIS project's bugs/architecture, → `tasks/lessons.md`.
- [ ] **A5** Cross-references section (renumbered to § 6): bullet pointers into MEMORY.md sections (CRITICAL RULES, Lifecycles, Working style) by NAME, not just "the index file".

**B. Edit MEMORY.md**
- [ ] **B1** Add new top-of-file section "📜 Project workflow (in repo)" pointing to:
   - `CLAUDE.md` — the protocol
   - `tasks/todo.md` — active plan
   - `tasks/lessons.md` — project incidents
   This goes ABOVE Critical Rules so a fresh session sees the meta-structure first.
- [ ] **B2** Add a single bullet in § "🤝 Working style" clarifying: "Project-specific lessons live in `tasks/lessons.md` (in repo); cross-project working-style lives here as `feedback_*.md`."

**C. Verify alignment**
- [ ] **C1** Re-read both files end-to-end after edits, confirm zero contradictions on overlap topics.
- [ ] **C2** Verify CLAUDE.md size still reasonable (target: under 6KB; current 5.6KB).
- [ ] **C3** Verify MEMORY.md size still under 24KB (current 9.4KB; have lots of headroom).
- [ ] **C4** Update `tasks/lessons.md` if any wrong claim surfaced during the audit.

### Verification

- Read both files end-to-end, confirm a fresh session reading them in either order ends up with the same mental model: "lifecycles + history live in MEMORY.md; protocol + stack live in CLAUDE.md; project incidents live in tasks/lessons.md."
- Spot-check 3 hypothetical session starts:
   1. "Add a new dashboard feature" → CLAUDE.md § 2 stack + MEMORY.md lifecycle docs
   2. "Bills not showing" → MEMORY.md CRITICAL RULES → bills_not_showing_diagnostic.md
   3. "I just got corrected, where do I log this?" → CLAUDE.md § 1 lesson rule → decision tree → either tasks/lessons.md OR memory/feedback_*.md

### Estimated impact

- ~30 min of edits, all docs-only
- No code/config changes
- No commit needed (these are doc files; user will request commit separately if they want)

---

## Review (2026-04-28)

✅ **Shipped:**
- CLAUDE.md A1-A5 all done. New "How this file relates to MEMORY.md" intro section. Tightened Muji to defer to `brand_living_os.md`. Added § 5 Build/Deploy/Test commands table. Strengthened Lesson vs Feedback decision rule. Renumbered Cross-references to § 6 with named MEMORY.md sections.
- MEMORY.md B1-B2 done. New top-of-file "📜 Project workflow" section pointing to CLAUDE.md + tasks/. Added boundary clarifier in 🤝 Working style.

🔍 **Cross-overlap audit (the 4 topics flagged in the plan):**
| Topic | Before | After |
|-------|--------|-------|
| Anonymous auth never disable | MEMORY only (correct) | unchanged ✅ |
| No localhost | both | both, but each instance is concise & reinforcing ✅ |
| Muji aesthetic | both (drift risk) | CLAUDE.md defers to MEMORY.md/brand_living_os.md ✅ |
| Verification | both (different layers) | unchanged — CLAUDE.md = what to verify, MEMORY.md feedback = how user wants it done ✅ |
| Lesson vs feedback | implicit | explicit in BOTH files (reinforcing, not duplicating) ✅ |

📐 **Sizes:**
- CLAUDE.md = 9,108 bytes (plan target was <6KB, missed). The added content (build cmds + cross-refs + intro) is justified per the plan; 9KB is fine for a session-loaded file. Will revisit if it grows past 12KB.
- MEMORY.md = 10,444 bytes (target was <24KB, well under).

🎯 **The "where does this go?" test passes:**
1. New tech-stack fact → CLAUDE.md § 2
2. User asks "how do I run tests?" → CLAUDE.md § 5
3. New project bug pattern → tasks/lessons.md
4. User says "I want minimal changes always" → memory/feedback_*.md
5. "How does LIFF onboard?" → MEMORY.md → lifecycle_liff_onboarding.md
6. "What rule must I never break?" → MEMORY.md ⛔ CRITICAL

🚧 **Deferred / not done:**
- No commit (docs-only; user has not requested commit). CLAUDE.md is in repo so a commit would version-control it; tasks/todo.md and tasks/lessons.md too.

🔁 **Follow-ups:**
- If CLAUDE.md grows past 12KB on future sessions, factor commands into a separate `tasks/commands.md` and link.
- The next session will read both files and validate the boundary in practice (no duplicated content drift).

📚 **Lesson captured:** None new at the time of writing. Updated 2026-04-28 evening: a follow-up deep audit (user requested "ลองหาความจริงอีกเพิ่มเติม") found **10 additional issues** I missed: 8 factual errors in 3 of the 6 new lifecycle docs (storage paths, auth TTL/collection, LINE key/CF names/backoff), plus 2 stale claims in older docs. New lesson added to `tasks/lessons.md` heading the file: "Wrote 6 lifecycle docs from memory; deep audit caught 8 factual errors". Pattern: writing architecture docs without grep'ing the code first → looks-plausible content survives in memory until the next session relies on it.

---

## Coordinate MEMORY.md ↔ CLAUDE.md — Tier 1+2 fixes (2026-04-28 evening)

**Why:** Self-recheck after the original task. User asked to "ตรวจสอบว่า memory align กับสถาปัตย์จริงไหม". Found 17 issues; fixed in two tiers with re-check loops.

**Tier 1 (factual errors I introduced today):**
- [x] T1.1 Storage doc — paths, rules, code locations all rewritten verbatim from `storage.rules` + actual upload sites
- [x] T1.2 Auth doc — TTL fixed (2h→24h), collection fixed (`audit_events`→`auth_events`), fields aligned with actual write
- [x] T1.3 LINE doc — idempotency key format corrected (colon→hyphen+userId), CF names corrected (notify→remind for reminders), retry-queue field shape corrected, backoff schedule corrected
- [x] T1.4 archive_session_2026_04_19_sot_phase.md — added `⚠️ STALE 2026-04-28` warning at the wrong "anonymous auth disabled" claim
- [x] T1.5 next_session_handoff_2026_04_28.md — refreshed (commit `99d6788`, today's structural changes section)

**Tier 2 (CLAUDE.md drift + missing capture):**
- [x] T2.1 CLAUDE.md — `shared/*.js` "12+" → "~29 files" (with grep advisory); test count "76+" → "~70 as of 2026-04-28"
- [x] T2.2 New `session_2026_04_28_memory_restructure_lifecycle_docs.md` capturing today's full work (incident + memory restructure + 6 lifecycle docs + CLAUDE.md + the second audit pass)

**Re-check Tier 1+2** — caught **3 additional errors** in line_notification.md (backoff numbers, retry-queue schema fields, dead-letter→abandoned). Fixed.

**Tier 3 (older docs + orphans):**
- [x] T3.1 tenant_app_architecture.md — page count of 24 was actually correct (`class="page"` selector); the agent's "5 pages" finding used wrong selector. Fixed line drift on `GAMIFICATION_LIVE` (7243 → 7317).
- [x] T3.2 firestore_schema_canonical.md — "5 collections, all active" rephrased to "5 canonical SSoT collections (auxiliary collections exist; see firestore.rules)". Removed two specific line-number references in favor of grep advisories.
- [x] T3.3 9 tools/*.js scripts — single-line summary added to MEMORY.md Reference section (each tool has a self-documenting header; no separate doc needed).

**Tier 4 (lesson + review):**
- [x] T4.1 New lesson at top of `tasks/lessons.md`: "Wrote 6 lifecycle docs from memory; deep audit caught 8 factual errors" with the rule "grep first, quote verbatim, re-grep your own doc, structure ≠ correctness".
- [x] T4.2 This Review section.

**Re-check Tier 3+4** — pending after writing this section.

🎯 **The "where does this go?" test still passes** after all edits — see boundary table at top of this file.

🔁 **Pattern:** the Anonymous-auth incident, Tailwind misread, and these 8 lifecycle errors are all the same root pattern: confident claims from memory without empirical check. The "grep first" lesson at the top of `tasks/lessons.md` is the durable rule.

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
