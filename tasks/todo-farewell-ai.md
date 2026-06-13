# ▶▶▶ PLAN (2026-06-13) — Meaning Layer **#16-v2 Farewell Archive + AI Summary** (🎁 การ์ดอำลา AI) · ⏳ AWAITING OWNER APPROVAL

> **Roadmap:** [meaning-layer-roadmap.md](meaning-layer-roadmap.md) #16 — v1 (derive-only farewell card) SHIPPED ([#336](https://github.com/soulgroundliving/the-green-haven/pull/336)); **v2 adds the AI prose summary + the move-out gift hook**. Build order slot **#3** ([remaining-plans](meaning-layer-remaining-plans.md) §5) — the blueprint's signature "emotional lock-in" gift. **The only pending ตัว that introduces net-new infrastructure (an LLM + a new secret)** → biggest single decision in the whole Meaning Layer.

---

## ⚠️ Concurrent-session safety (carries over)
2 sessions live (deposit + auth/§MMM). **OFF-LIMITS:** deposit files · auth files (esp. **`functions/recordChecklistConsent.js`** — the consent-purpose add below touches it) · `CLAUDE.md`/`README.md`/`tasks/lessons_antipatterns.md`.
**#16-v2 collision = LOW** on new files. Shared touch points: `functions/index.js` (new export) · `functions/recordChecklistConsent.js` (`farewell_v1` purpose — auth-session-owned, **coordinate or defer**) · `functions/archiveTenantOnMoveOut.js` (the gift hook — if auto-trigger chosen) · `functions/exportMyData.js` + `requestDataDeletion.js` (DSR) · `shared/tenant-farewell.js` (render the prose — **this is a Tenant-pillar file, NOT a #10 pet file**, so no pet-session collision) · `functions/package.json` (new dep). Build in a worktree off `origin/main`; land after the 2 sessions merge.

---

## What already exists (REUSE — do NOT rebuild) — grep-verified 2026-06-13
- **v1 derive surface** — [shared/tenant-farewell.js](../shared/tenant-farewell.js): pure `deriveFarewell({lease, gamification}, nowMs)` → `{tenure, points, badgeCount, badgeEmojis, streak, trades, phase, daysLeft, title, message}`; renders into `#tlf-card` on the 🪴 Life Timeline page; `phase` flips to `'ending'`/`'ended'` on `lease.endDate ≤ 45d` / `status:'ended'`. `window.renderFarewell` + `_onLiffClaimsReady` self-wire (§7-A). **v2 renders the AI prose into this SAME card** (a new `.tlf-ai` block above the stat grid).
- **Move-out archive hook** — [functions/archiveTenantOnMoveOut.js](../functions/archiveTenantOnMoveOut.js): `region('asia-southeast1').https.onCall` (:125); archives the live tenant doc → `tenants/{building}/archive/{contractId}` (`:183`, a SUBcollection; clone of live doc + `archivedAt/Reason/By`), preserving `gamification`/badges/payment history/wellness. **A `farewellSummary` field written onto the live tenant doc rides into the archive automatically** (archive = clone of live doc) — no separate archive write needed.
- **Secret-CF pattern (§7-WW)** — `functions.runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })` + `region('asia-southeast1')` on `notifyMaintenanceTenant`/`verifySlip`. Mirror for `ANTHROPIC_API_KEY`.
- **PDPA consent + DSR** — `recordChecklistConsent.js` `VALID_PURPOSES` (add `farewell_v1`) · `exportMyData.js` (add `farewellSummary`) · `requestDataDeletion.js` (erase it). Same pattern as `pet_profile_v1`/`account_v1`.
- **§7-I admin preview-before-send** — every existing money/mass action previews then waits for a click; the AI gift mirrors it (generate → preview → admin/tenant confirms → save).

## §7-O/AA greenfield + net-new-AI check — ✅ confirmed 2026-06-13
- `grep -rln "anthropic\|claude\|openai\|gpt\|gemini\|generativeai" functions/ shared/ *.html` → **0 app-level hits** (only `firebase-functions`'s unused bundled Vertex/Gemini provider in `node_modules`). **#16-v2's AI is 100% net-new infra.**
- `grep -rn "composeFarewell\|farewellSummary\|farewell_v1" functions/ shared/` → expect 0 (nothing half-built).

---

## 🔑 OWNER DECISIONS NEEDED (lock at approval — #16-v2 has the heaviest ones)

### D-AI1 · AI provider + model
| | Recommended (default) | Alt |
|--|----------------------|-----|
| **Provider** | **Anthropic Claude** via `@anthropic-ai/sdk` (project is JS, official SDK exists → SDK not raw `fetch`; CLAUDE.md "default to latest/most capable Claude models"). New dep in `functions/package.json` + `ANTHROPIC_API_KEY` secret. | Firebase **Vertex AI / Gemini** (provider already bundled in `firebase-functions` node_modules; no new vendor key, but Google AI + cross-border still applies). |
| **Model** | **`claude-opus-4-8`** (project default; best prose for a one-shot keepsake) OR **`claude-haiku-4-5`** (cost/latency). **Cost is trivial either way** (see D-AI2) → recommend **opus-4-8** for quality on a once-per-tenant gift; owner picks. | — |

### D-AI2 · Cost (for context — negligible)
A summary is ~**500 input + ~300 output tokens**. Per-call: **opus-4-8 ≈ $0.01 (~฿0.35)** · **haiku-4-5 ≈ $0.002 (~฿0.07)**. Move-outs are a handful/month → **pennies/month at most**. Cost is NOT a real constraint here; pick on quality.

### D-AI3 · 🛡️ PDPA — cross-border transfer (the real risk, flag to owner)
Sending identifiable Thai tenant data to Anthropic (US) = a **cross-border personal-data transfer** (PDPA §28) + third-party disclosure (§19). **Mitigation baked into the design (recommended):** the prompt sent to Claude carries **ONLY earned-stat numbers + generic descriptors — NO name / room / phone / identifiers** ("a resident of 2 years, 5 badges, 30 neighbour-helps…"); the tenant's **name is templated in locally** after the prose returns. So **no PII crosses the border** → the §28 concern is largely sidestepped. PLUS: `farewell_v1` consent (or a transparency note + opt-out for the gift flow) + DSR export/erase. Owner confirms the anonymized-prompt approach is acceptable.

### D-AI4 · Trigger
| | Recommended | Alt |
|--|-------------|-----|
| **Who fires it** | **Admin "🎁 ส่งการ์ดอำลา" button** at move-out (the GIFT framing; §7-I: CF generates a DRAFT → admin previews in a modal → admin clicks save → stored + optional LINE "การ์ดอำลาจาก Nature Haven 🌿"). | (a) **Tenant self** "สร้างสรุปเรื่องราวของฉัน" button on the 🪴 card (a keepsake they make themselves, anytime — needs `farewell_v1` consent) · (b) **Auto** inside `archiveTenantOnMoveOut` (cheapest UX but an irreversible inline AI spend → violates §7-I spirit; not recommended). |

### D-AI5 · misc
- **Tone/length:** Thai, warm, muji, **2–3 sentences**, specific to their journey, no clichés, **final answer only** (one-shot). · **Regenerate:** allow the admin/tenant to re-run if the first draft is off (cheap). · **PR shape:** one PR (CF + dep + tenant render + PDPA + tests), worktree off main, land after the 2 sessions merge.

## Why Plan-First (CLAUDE.md §1 — all three, most strongly of any ตัว)
NEW CF + **new external dependency + new secret + cross-border PDPA** + `archive`/`recordChecklistConsent`/`exportMyData`/`requestDataDeletion` touches + tenant render + tests; **not single-revert** (secret + dep + CF deploy + consent purpose); **2+ approaches** (D-AI1 provider, D-AI4 trigger, D-AI3 consent-vs-transparency).

---

## Data model — additive on `tenants/{b}/list/{r}` (rides into archive automatically)
```
farewellSummary: {
  text,            // the AI prose (Thai, name templated in locally — NOT sent to the API)
  model,           // 'claude-opus-4-8' | 'claude-haiku-4-5' (provenance)
  generatedAt,     // serverTimestamp
  generatedBy,     // admin uid (gift) or 'self' (tenant flow)
  status,          // 'draft' | 'published'  (§7-I: draft until the previewer confirms)
}
```
- **No new collection / index.** v1's `#tlf-card` reader gains a `farewellSummary.text` branch (renders when `status==='published'`).

## State machine
```
(admin/tenant: สร้างการ์ดอำลา) → composeFarewellSummary CF
   → builds an ANONYMIZED prompt (stats only, NO PII — D-AI3)
   → Claude messages.create (non-streaming, max_tokens ~400)
   → returns DRAFT prose  → previewer reviews (§7-I)
   → [confirm] → farewellSummary{status:'published'} on the tenant doc → 🪴 card shows it (+ optional LINE push)
   → [regenerate] → re-run  ·  [discard] → nothing saved
```

---

## Tasks (TDD)

### Phase 1 — server: the AI CF + secret + dep
- [ ] **`functions/package.json`** — add `@anthropic-ai/sdk` (latest). `npm install` in `functions/` (+ worktree `deploy:worktree:prep` per CLAUDE.md §5 — worktrees don't inherit `.env`/node_modules).
- [ ] **`functions/_farewellPrompt.js`** (NEW, pure, unit-tested) — `buildFarewellPromptInput(tenantData)` → `{tenureText, badgeCount, points, trades, helpsGiven, questCount, …}` **anonymized** (assert NO `name`/`room`/`phone`/`tenantId`/uid in the output — the §7-J/PDPA guard test); `renderWithName(prose, name)` templates the name in locally. Pure → deterministic test without an API call.
- [ ] **`functions/composeFarewellSummary.js`** (NEW) — `region('asia-southeast1').https.onCall`, `runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60 })`. Auth: `token.admin===true` (gift) OR `assertTenantAccess` (self, D-AI4). Reads the tenant doc → `buildFarewellPromptInput` (anonymized) → `new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY}).messages.create({ model, max_tokens: 400, system: WARM_THAI_SYSTEM, messages:[{role:'user', content: statsText}] })` (**non-streaming** — short + latency-tolerant; omit `thinking` or set adaptive + a "final answer only" instruction per the 4.8 reasoning-leak note). Returns `{draft: renderWithName(text, name), model}` — does **NOT** auto-write (§7-I: previewer confirms). A second `publishFarewellSummary` call (or a `{publish:true}` arg) writes `farewellSummary{status:'published'}`.
- [ ] **`functions/index.js`** — `exports.composeFarewellSummary` (+ publish) (column-0, §7-CCC). ⚠️ rebase point vs deposit.
- [ ] **System prompt** (constant in the CF): *"You write a short, warm Thai farewell message for a departing resident of Nature Haven, a muji-minimal apartment community. 2–3 sentences. Warm, specific to their journey, no clichés, no emoji spam. Respond ONLY with the message — no preamble."*

### Phase 2 — PDPA wiring (⚠️ coordinate — touches auth-session files)
- [ ] **`functions/recordChecklistConsent.js`** — add `farewell_v1` to `VALID_PURPOSES` (auth-session-owned → **confirm not mid-edit before touching**; if contended, defer + note the gap). Self-flow gates on it; gift-flow uses a transparency note + opt-out (D-AI3).
- [ ] **`functions/exportMyData.js`** — include `farewellSummary` (§30). **`functions/requestDataDeletion.js`** — erase it (§32).

### Phase 3 — frontend: render the prose + the trigger
- [ ] **`shared/tenant-farewell.js`** — add a `.tlf-ai` block in `_render()` showing `farewellSummary.text` when `status==='published'` (above the stat grid). (Self-flow D-AI4a: a "สร้างสรุปเรื่องราวของฉัน" button → `composeFarewellSummary` → preview modal (`GhModal`) → confirm → `publish`.) DOM-API render (no innerHTML of model text — escape, §feedback_modal_security).
- [ ] **Admin gift (D-AI4 default):** a "🎁 ส่งการ์ดอำลา" button on the move-out/archive admin surface → `composeFarewellSummary` → preview modal of the draft → admin clicks "ส่ง" → `publish` + optional LINE push. (Admin file TBD — pick the move-out admin surface; keep it ONE new button, minimal blast radius.)
- [ ] **`shared/components.css`** — `.tlf-ai` static block (§7-RR/III token-driven). `npm run csp:hash` no-drift (markup + external script/CSS → no inline).

### Phase 4 — gate + verify + docs
- [ ] Gates: `test:shared` (+`_farewellPrompt` anonymization test — the load-bearing PDPA guard) · CF suite (+CF tests; **mock the Anthropic client** — don't call the real API in CI) · §7-TT mojibake clean · `csp:hash` no-drift · `verify:memory` green.
- [ ] **§7-WW secret deploy:** `firebase functions:secrets:set ANTHROPIC_API_KEY` in the **right project** (`--project the-green-haven`), confirm the SA can read it, **test-deploy ONLY `composeFarewellSummary` first** (one bad secret binding blocks ALL CF deploys). Never display the key (MEMORY ⛔ never-display-secret-files).
- [ ] **Live-verify (owner):** trigger the gift on a real (or test) move-out → preview shows warm Thai prose → confirm → tenant's 🪴 card shows it / LINE push arrives → DSR export includes it, erasure removes it. **Confirm the prompt logged to Cloud Logs carries NO PII** (the §28 guarantee).
- [ ] **Docs same session:** update [lifecycle_farewell.md](C:\Users\usEr\.claude\projects\C--Users-usEr-Downloads-The-green-haven\memory\lifecycle_farewell.md) (v2 section) + flip [[meaning-layer-roadmap]] #16 `🟡 → ✅` + a new reference doc for the Anthropic-API integration (secret, model, cost, the anonymized-prompt PDPA contract).

---

## Anti-pattern guardrails
- **§7-NN** onCall not trigger. **§7-I** generate→preview→confirm; never auto-write an irreversible AI gift. **§7-WW** secret in the right project + test-deploy ONE CF. **§7-Z** (no claim mint here). **§7-DD** archive rides the field automatically (no separate cleanup) but DSR erase + export must include it. **§7-CCC** un-indented export. **PDPA §28/§19** anonymized prompt (no PII over the border) + consent/transparency + DSR. **Mock the API in tests** (no real spend / no flakiness in CI). **feedback_modal_security** escape model text in the DOM.

## Reuse verification (grep before coding — §7-H)
```bash
grep -n "region('asia-southeast1')\|runWith\|secrets:" functions/notifyMaintenanceTenant.js   # secret-CF shape
grep -n "archive').doc(contractId)\|archivedAt" functions/archiveTenantOnMoveOut.js            # archive clones live doc
grep -n "deriveFarewell\|#tlf-card\|renderFarewell" shared/tenant-farewell.js                  # v1 surface to extend
grep -n "VALID_PURPOSES\|pet_profile_v1" functions/recordChecklistConsent.js                   # consent purpose add
grep -rln "anthropic\|claude" functions/ shared/                                               # confirm still net-new
```

---

## Review (fill on ship)
- _Pending owner approval (D-AI1–5, esp. provider + the cross-border-PDPA anonymized-prompt approach) + build (held until deposit/auth sessions merge)._
