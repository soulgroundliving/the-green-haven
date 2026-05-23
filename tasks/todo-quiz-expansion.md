# Quiz Expansion — Plan-First (2026-05-23 late evening)

User request after Path 1d ship: "ให้ contract-quiz-style ไปอยู่ในแต่ละบทความ wellness + สร้างหน้าใหม่ใน community events รวม quiz ทั้งหมด"

Above 5-file + multi-session threshold → Plan-First doc required before code.

## Goal

- **3a:** Each wellness article can carry its own quiz (1-3 questions). After reading the article, tenant takes the quiz; correct answers grant bonus points.
- **3b:** New page/tab in community events listing every quiz available to the tenant (contract quiz + per-article wellness quizzes), with status (done this month / pending).

## Scope across sessions

### Session A (THIS one)

Phase A1 — Foundation
- [ ] Data schema: extend `WELLNESS_ARTICLES` hardcoded fallback + Firestore `wellness_articles` schema to support optional `quiz: [{q, options, correctIdx}]`
- [ ] Add quiz to 2 hardcoded articles (`sleep-bedroom`, `morning-ritual`) as dogfood examples
- [ ] tenant_app: render quiz block at end of article body, before the existing claim button
- [ ] Wire quiz pass → bonus pts (separate from existing wellness claim marker — own idempotency marker: `wellnessQuizPassed/{articleId}_{YYYY-MM}`)

Phase A2 — Quiz hub in community events
- [ ] Add new section/tab in community events page: "🎯 Quiz" listing all available quizzes
- [ ] Each card: title, source (contract / wellness article name), status (✅ done this month / 🟡 ready / ⏰ cooldown), pts available, click-through to start

### Session B (next handoff)

- Dashboard admin editor for adding/editing quiz questions per wellness article (the Firestore-side path; hardcoded fallback already covered in Session A)
- Firestore rules for `wellnessQuizPassed/*` subcollection (mirror `wellnessClaimed/*` pattern)
- Backend CF for idempotent quiz claim with rate-limit (mirror `claimDailyLoginPoints`)
- Polish + admin analytics for quiz engagement

## Design decisions (already-made vs ask-user)

| # | Decision | My choice | Reason |
|---|----------|-----------|--------|
| A | Quiz placement | After article body, before claim button | Natural reading flow; user sees content first |
| B | Pass criteria | 2/3 correct (or 100% for 1-question quizzes) | Matches contract quiz default |
| D | Data model | Embed in article doc (`article.quiz: [...]`) | Simplest; same doc = atomic edit; aligns with existing structure |
| E | Quiz hub location | New section *inside* community-events page (NOT new sub-page) | Less navigation friction; keeps community page as gamification hub |
| **C** | **Claim interaction** | **ASK USER** | Has UX/gamification implications |
| **F** | **Quiz availability gate** | **ASK USER** | Re-takeable? Cooldown? Per-month like wellness claim? |

## Out-of-scope this PR

- Multi-language quizzes (Thai-only for now)
- Difficulty levels
- Question pools / random selection (each article has 1-3 fixed questions)
- Quiz analytics dashboard for admin
- Leaderboard for quiz-pass count

## Why

Both 3a and 3b align with existing gamification pattern. Reuses the contract-quiz infrastructure (modal layout, scoring) — minimal new UI primitives. Increases tenant engagement with wellness content via active recall (educational research: quizzing improves retention 2x vs passive reading).

## Review

### Shipped this session (Session A)

| Commit | Phase | Scope |
|---|---|---|
| `6145ccf` | A1 | Wellness article quiz: schema + 2 dogfood articles + modal reuse + monthly marker + bonus pts |
| `7e54219` | A2 | Quiz Center section in community page: cards for Contract + each wellness article quiz |

### Verification status

- ✅ verify:memory 34/340/0
- ✅ Pre-commit hooks all green (security, memory, anti-pattern, auth-callback, file-size, CSP hash drift §G)
- ⏳ Live LIFF verify on user mobile (pending)

### Deferred to Session B

- Admin UI editor in dashboard.html for editing per-article quiz questions (today's hardcoded dogfood serves until then)
- Firestore rules for `quiz_wellness_*` localStorage marker (NO Firestore rule needed yet — markers are client-only; CF in Session B will write `wellnessQuizPassed/{articleId}_{YYYY-MM}` subcollection with proper idempotency, plus admin analytics)
- Backend CF for idempotent quiz claim (mirror `claimDailyLoginPoints` shape) — closes the "client-side localStorage = trustable?" gap
- Per-article admin analytics dashboard

### Open follow-up surfaces

- `lifecycle_wellness_claim.md` memory doc: add quiz extension note (Phase B work; not blocking now)
- Decision on whether to gate wellness quiz behind "read 10 sec" timer like contract quiz (currently no gate; user opens article → quiz card visible immediately)
