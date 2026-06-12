# #10 Pet Social — owner real-LINE verification playbook

The publish → friend-request → accept → opt-out cycle can only be driven from a
real LINE app (LIFF-gated, §7-J). This playbook walks it step-by-step. After
**each** step, run the read-only asserter to confirm Firestore actually holds
what it should — it checks the invariants you can't see by eye:

- **INV1 privacy** — the public `petProfiles` mirror carries ONLY safe fields
  (name/type/breed/gender/age/photo) + bio. A leaked `healthLog`/vaccine/status
  is a PDPA breach.
- **INV2 consent** — every published pet has a `consents/{tid}_pet_profile_v1`
  doc. A published pet with **NO** consent doc is the §7-LLL race (the bug
  `afc00c0` fixed). If you ever see `🔴 NO CONSENT DOC`, the publish raced the
  consent write — report it.
- **INV3 links** — link id/status/room/building are self-consistent.

```bash
npm run preview:pet-social                       # scan all buildings
npm run preview:pet-social -- --building nest     # one building
npm run preview:pet-social -- --tenant <tenantId> # one tenant
```
> Read-only: every call is a GET, it NEVER writes. If it says the token is
> EXPIRED, run any firebase command first (e.g. `firebase projects:list`) to
> refresh, then re-run.

## Prerequisites
- **Two pets in two DIFFERENT rooms of the SAME building** (a friend request
  requires both pets public, same building, different rooms — pets in one room
  share an owner). Today's baseline already has **Latte (nest / N101)** published;
  you need a 2nd published pet in another `nest` room (e.g. N102) to be the
  other party. Use two LINE accounts (or admin-register a 2nd pet) as needed.
- Test on `https://the-green-haven.vercel.app` opened inside **LINE** (not Safari).

## Baseline (run first)
```bash
npm run preview:pet-social
```
Expect (today): `petProfiles: 1` — Latte 🐶 ห้อง N101 [nest], INV1 ✅, INV2 ✅,
`0 links`, `✅ ALL INVARIANTS HOLD`. Note this so you can see each step's delta.

---

## Step 1 — Publish pet B (opt-in + consent + bio)
**LINE (account B):** Pet park → ไดเรกทอรีสัตว์เลี้ยง → your approved pet →
type a bio → **เปิดให้เพื่อนบ้านเห็น** → the inline consent appears in place of
the button → accept. The bio must stay in the box (not vanish) and the page must
not bounce.
**Verify:** `npm run preview:pet-social -- --building nest`
**Expect:** `petProfiles: 2`; pet B now listed with **INV1 ✅** and **INV2 ✅
consent**. 🔴 on INV2 = §7-LLL race (report it). 🔴 on INV1 = a private field
leaked into the mirror (PDPA — report it).

## Step 2 — Cross-building isolation
**Verify:** `npm run preview:pet-social -- --building rooms`
**Expect:** neither nest pet appears (`petProfiles: 0` for `rooms`, or only
genuine `rooms` pets). Confirms building-scoped visibility — a `nest` pet is
never shown to `rooms` tenants.

## Step 3 — Friend request B → A
**LINE (account B):** in เพื่อนบ้านสี่ขา, find Latte (N101) → **ขอเป็นเพื่อน**
(if B has >1 published pet, pick the acting pet in the select first).
**Verify:** `npm run preview:pet-social -- --building nest`
**Expect:** `petLinks: 1 {"pending":1}`; the edge `B (ห้อง N102) → Latte (ห้อง
N101) [pending] ✅`, INV3 ✅ (linkId matches, rooms differ).

## Step 4 — LINE notify
**Expect:** account **A** (Latte's owner) receives a LINE push about the new
friend request. (No asserter check — this is the push side.)

## Step 5 — Accept
**LINE (account A):** คำขอเป็นเพื่อน → **ตอบรับ**. Both pets should now show
"เพื่อนแล้ว".
**Verify:** `npm run preview:pet-social -- --building nest`
**Expect:** the same edge now `[accepted] ✅`, `{"accepted":1}`. Account B's
owner should receive a LINE push that A accepted.

## Step 6 — Opt-out (เลิกแสดง) on Latte
**LINE (account A):** Latte's card → **เลิกแสดง** → the styled confirm
(`GhModal`, not the native browser dialog) → confirm.
**Verify:** `npm run preview:pet-social`
**Expect:** Latte's profile is **GONE** (`petProfiles` drops by 1) **AND** the
accepted edge is **GONE** (`cleanupLinksForPet` removed it — `petLinks: 0`).
Pet B's profile stays. This is the §7-DD cleanup: opting out wipes the profile
+ all its edges, not just the profile.

## Step 7 — Re-publish (bio preserved)
**LINE (account A):** re-publish Latte → the previous bio ("ลาเต้สั่งได้") should
be preserved server-side.
**Verify:** `npm run preview:pet-social -- --building nest`
**Expect:** Latte back, INV1/INV2 ✅, bio intact.

---

## If all 7 pass → report back
Tell me "cycle passed" and I'll fold the §7-LLL consent-race lesson (await the
consent write before any CF that gates on it) into CLAUDE.md §7 as a permanent
anti-pattern — the last follow-up for #10.

## If a step fails
Report the **asserter output** for that step (it pinpoints which invariant
broke) + what the LINE UI showed. The tool's 🔴 lines tell us exactly which
collection is wrong, so one run usually isolates the cause (§7-F: one
observation cuts the hypothesis tree).
