# Lessons — The Green Haven

Append after every correction or bug fix. Keep entries terse:
- **Mistake:** what I did wrong
- **Why:** root cause
- **Rule:** what to do instead (so this never repeats)

Read this file at the start of every session per `CLAUDE.md § 1`.

---

## 2026-04-28 (evening) — Two wrong claims in 24h, both in non-verifier-covered memory files

**Mistake #1 (session journal → almost deferred real work):** `session_2026_04_27_evening_insights_ops_incident.md` claimed `meter_data/{docId}` was a "single doc holding all rooms in `data` map keyed by roomId" and that per-room scoping needed a "storage refactor". Today's handoff inherited the claim. When the user asked me to assess the meter_data rule (tentative — "ลองดู"), my first instinct was to confirm "needs schema refactor, defer". Real schema (per `firestore_schema_canonical.md`): `meter_data/{building_yy_m_roomId}` — already per-room flat docs. Fix took 2 lines.

**Mistake #2 (re-occurred while writing the lesson about #1):** While updating the handoff to mark the May 1 dry-run as done, I wrote "look for `wellnessClaimed/{roomId}_2026-04` docs" as the post-cron marker check. **The real path is `tenants/nest/list/{roomId}/complaintFreeMonthAwarded/{YYYY-MM}`** — I conflated wellness-articles with complaint-free-month-award (two unrelated features) and paraphrased the path from short-term memory. Caught only because the user asked me to re-audit. Both `firestore_schema_canonical.md:69` and `lifecycle_complaints_award.md` had the correct path; I just didn't open either.

**Why:** Both errors lived in memory files NOT covered by `verify:memory` (which only scans `lifecycle_*.md` Verification blocks). Handoffs and session journals get edited freely without a gate. The verify-via-grep doctrine *as I had written it* targeted lifecycle docs explicitly, leaving handoffs/journals as a coverage hole. So I confidently wrote "fixed" while creating fresh drift in the same session.

The deeper failure mode: when editing memory, I treat code identifiers (paths, CF names, doc IDs, fields) as English text I can paraphrase. They aren't — they're verbatim contracts with code, and a single wrong path can mean "you'll never find the doc" (mistake #2) or "we'll defer real work indefinitely" (mistake #1).

**Rule (generalized + applied to doctrine):** When editing **any** memory file — handoff, session journal, feedback doc, reference doc — every backtick-quoted code identifier must be **grep-verified BEFORE typing it**, not after. Don't paraphrase paths from memory. Don't trust "I remember it as ..." Open the source file or the canonical schema doc, copy the literal value. Promoted into [feedback_verify_via_grep_doctrine.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\feedback_verify_via_grep_doctrine.md) under new "Files outside verifier coverage" section — extends the original rule from "lifecycle docs only" to "all memory files with code identifiers".

---

## 2026-04-28 — 19 doc errors across 6 audit rounds → "Verify-via-grep doctrine" promoted to memory rule

**Mistake:** Across the day's structural session, my lifecycle docs accumulated **19 factual errors** that took 6 audit rounds to surface. Each round caught what the previous one missed. After Round 3, more errors still might exist — I can't prove the docs are clean, only that my audits caught these.

The 3 sub-patterns inside the meta-pattern:

1. **Selector bias.** `grep 'class="page"'` returned 24 pages. The actual count was 25, because `class="page active"` doesn't match a literal grep. I trusted my own grep without considering CSS class concatenation. Lesson: a grep is one slice; consider the regex shape before declaring "verified".

2. **Structure-as-correctness.** Tables + Failure Modes sections + "verified 2026-04-28" stamps → felt rigorous → trusted. The structure is just a *container*. Inside the container were paraphrased facts I'd never grepped. Lesson: structure is presentation, not proof.

3. **Re-check bias.** My re-checks gravitated toward the things I had just edited. Untouched parts of the docs stayed untouched even when stale. Lesson: re-checks must include random spot-checks of *un-edited* content too, or the audit converges on the suspects you already named instead of the ones you didn't.

**Why:** Confidence and effort were correlated with structure (tables, sections), not with empirical grounding. Each round I felt "now it's right" — six times in a row that felt the same way and was wrong each time.

**Rule:** Promoted to memory as `feedback_verify_via_grep_doctrine.md`. Summary: every load-bearing claim in a lifecycle/architecture doc must EITHER embed the grep command that proves it OR defer to source with a grep advisory. Add a `## Verification` section to each major doc with {claim, grep command, expected} triples so a future session can re-verify in seconds. After writing, re-grep at least 3 random claims; any 0-hit grep means a fabricated claim.

This doctrine is now the SSoT pattern for any new memory doc.

---

## 2026-04-28 — Wrote 6 lifecycle docs from memory; deep audit caught 8 factual errors

**Mistake:** Earlier in the same session I wrote 6 lifecycle docs (LIFF, auth, stores, tenant SSoT, storage, LINE notification). They looked thorough — each ended with a Failure Modes table. User asked me to verify before commit. Two Explore agent passes + my own rechecks caught **8 factual errors** I had typed confidently from memory:

- Storage: `lease-docs/{roomId}` (real: `leases/{building}/{roomId}/{leaseId}/{fileName}`)
- Storage: `pets/{room}/{petId}/photo.jpg` (real: `pets/{building}/{room}/{petId}/{kind}_{ts}.{ext}`)
- Storage rules: fabricated `auth.token.room == room` scoping (real: `isSignedIn() + fitsSizeLimit() + isImageOrPdf()`)
- Auth: session TTL "2 hours" (real: 24h)
- Auth: collection `audit_events` w/ 7 fields (real: `auth_events` w/ 4 fields `maskedEmail/ua/errorCode/ts`)
- LINE: idempotency key `bill:{building}:{roomId}:{billId}` (real: `bill-${building}-${roomId}-${billId}-${userId}` — hyphens, includes userId)
- LINE: CF names `notifyLatePayment` / `notifyLeaseExpiry` (real: `remindLatePayments` / `remindLeaseExpiry` with `Scheduled` cron pairs)
- LINE: backoff "1m → 5m → 15m → 1h → 4h" (real: `5m → 10m → 20m → 40m → abandoned`)

The first audit (Explore agent #1) only caught Storage path mismatches. The second deep audit (paranoid claim-by-claim) caught the rest. The recheck round AFTER fixing also caught a leftover example with the old colon format.

**Why:** "Failure Modes table" looks thorough, but the table itself isn't proof of correctness — it's just structure. I wrote the *content* (paths, regex, field names, schedules) from memory, then dressed it up in a structured table. The structure tricked me into thinking I'd verified things.

**Rule:** When writing or editing **any architecture documentation** that names a path, function, regex, schedule, field, or rule contract:

1. **Grep or Read the actual code FIRST**, before opening the doc to type.
2. **Quote verbatim** from the code (path strings, field names, line numbers via grep, schedule cron) — don't paraphrase.
3. After writing, **re-grep your own claims** in the doc against the source. If a claim doesn't show a match, it's wrong or fabricated.
4. **Failure Modes tables don't prove correctness** — they prove the failure-mapping is plausible. The technical details still need empirical backing.
5. The "looks plausible from memory" check is the same trap as the Tailwind misread (lesson below) and the Anonymous-auth UI text (incident below). It's a recurring class. Always grep.

---

## 2026-04-28 — Wrote CLAUDE.md stack section without checking package.json

**Mistake:** When asked to update CLAUDE.md with the workflow protocol, I wrote "the existing codebase is vanilla HTML + JS" implying Tailwind was NOT used. User pushed back ("treat this command as the current architecture, fix what doesn't match"). On `cat package.json` I found `tailwindcss: ^3.4.19` in devDeps + a `tailwind:build` script, plus `<link rel="stylesheet" href="/shared/tailwind.css">` in tenant_app.html. Tailwind IS the styling layer.

**Why:** I leaned on a fast-glance impression of the HTML files instead of reading `package.json` first. The "no React" half of my disambiguation was right; the "no Tailwind by extension" half was a guess that bled into the doc as fact.

**Rule:** Before stating *what's in the stack* — even casually, even in docs — read `package.json` (deps + devDeps + scripts) and at least one HTML `<head>` for `<link>`/`<script>` tags. "Vanilla HTML + JS" is a 2-second claim that takes 30 seconds of facts to back. Apply the same standard as to bug fixes: empirical check before writing.

---

## 2026-04-28 — Misled user into disabling Anonymous auth → all LIFF tenants locked out

**Mistake:** I wrote UI text in the `cleanupAnonymousUsers` Insights card that said "ปิด Anonymous auth ใน Firebase Console" as a pre-step, and the CF JSDoc said "Anonymous sign-in must already be disabled". User followed it. Every LIFF tenant got `Missing or insufficient permissions` on the next session. Fixed in commit `99d6788`.

**Why:** I treated `cleanupAnonymousUsers` as a standalone feature without tracing the LIFF UID lifecycle. LIFF-linked tenants are **anonymous UIDs WITH custom claims** — not non-anonymous users with provider data, as my JSDoc wrongly claimed. Disabling Anonymous auth removes the seat that `linkAuthUid` attaches `{room, building}` claims to.

**Rule:** Before writing user-facing instructions for any feature that touches Firebase Auth providers (anonymous, email, phone, OAuth), trace the full UID lifecycle of every consumer first. Reference `~/.../memory/lifecycle_liff_onboarding.md`. Do not infer architecture from one CF in isolation.

---

## 2026-04-28 — Shipped a gate that blocked the URL another change in the same session was generating

**Mistake:** I added a hard access gate in `tenant_app.html` requiring an admin claim for `?room=&building=` URLs, then later in the same session changed `login.html` to redirect tenants to `/tenant_app?room=15&building=rooms`. The gate blocked the path the redirect was creating.

**Why:** I evaluated each change against the file it was edited in, not against the cross-cutting flow. Two correct-in-isolation changes can produce a broken-as-a-pair flow.

**Rule:** Before saying "done" on any session that touched 2+ files in the same user flow, re-read all session diffs against each other. Trace the user's path end-to-end on the new code, not just the changed file. (Codified as `feedback_self_conflict_check_my_own_changes.md` in user memory.)

---

## 2026-04-28 — Restated 5+ wrong fixes for the same bill bug without ever asking for live state

**Mistake:** Bills-not-showing symptom recurred across 5+ turns. Each turn I proposed a different fix without confirming the actual failure mode. Wasted hours patching downstream symptoms while the root cause (GCP API key restrictions blocking Token Service API) sat unobserved.

**Why:** I rewarded hypothesis over observation. When a symptom recurs, the next fix has lower expected value than asking for one piece of state.

**Rule:** When a symptom recurs across turns or sessions, change tactics: stop proposing fixes, ask for ONE concrete observation (currentUser email, claims, RTDB doc screenshot, network 4xx). One real observation kills the entire hypothesis tree. (Codified as `feedback_stop_guessing_demand_state.md` in user memory; bills playbook in `bills_not_showing_diagnostic.md`.)
