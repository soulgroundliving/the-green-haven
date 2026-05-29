# Contributing to The Green Haven

> Read [README.md](README.md) for project overview and setup. This file covers workflow, conventions, and things that bite contributors.

## Development workflow

### Branch strategy

```bash
git checkout -b feat/my-feature   # feature branch from main
# ... make changes ...
git push origin feat/my-feature
# open PR → squash-merge to main → Vercel auto-deploys
```

Main branch is always deployable. No long-lived feature branches.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): short description
fix(scope): short description
refactor(scope): short description
chore(scope): short description
```

**Types:** `feat` `fix` `refactor` `docs` `test` `chore` `perf` `ci`

### Verification before PR

Every PR must pass:

```bash
npm run test:rules          # Firestore + Storage rules (~340 cases)
npm run test:unit           # CF unit tests (~1849 cases)
npm run verify:memory       # Architecture docs vs code
npm run audit:size          # File-size budgets
npm run tailwind:build      # Only if HTML or tailwind.input.css changed
npm run csp:hash && node tools/update-vercel-csp.js  # Only if inline <style>/<script> changed
```

The pre-commit hook runs all of these automatically. Do not bypass with `--no-verify`.

**UI changes:** verify on the Vercel preview URL — Firebase Auth rejects `localhost`. There is no local preview that exercises the full auth flow.

---

## Code conventions

### No frameworks

This project uses **vanilla HTML + Tailwind CSS + vanilla JS**. No React, Vue, TypeScript, or build-time JSX. New features go in:

- `shared/<feature>.js` — exposed as `window.FeatureName = ...`
- Tailwind utility classes + `shared/brand.css` tokens for styles

### JS module pattern

```js
// shared/my-feature.js
(function() {
    'use strict';

    function doThing(arg) { ... }

    window.MyFeature = { doThing };
})();
```

- Top-level `let`/`const` are block-scoped to the script tag — use `window.X` for cross-script access (§7-CC)
- No ES modules (`import`/`export`) in shared JS files — they load via `<script>` tags in HTML

### CSS

Use `shared/brand.css` tokens, not hardcoded hex values:

```css
/* ✅ */  color: var(--ink);  background: var(--brand-primary);
/* ❌ */  color: #1a1a1a;    background: #2d8653;
```

Run `npm run tailwind:build` after adding/changing Tailwind classes in any HTML file.

### File size limits

| Threshold | Action |
|-----------|--------|
| > soft limit | `[INFO]` — investigate if unexpected |
| > warn limit | `[WARN]` — extraction recommended |
| > hard limit | `[BLOCK]` — pre-commit blocks the commit |

Check headroom: `npm run audit:size`. The limits are in `tools/file-size-limits.json`.

---

## Cloud Functions

### Adding a new CF

1. Create `functions/<name>.js` using Gen2 (`firebase-functions/v2/https`) for new callables:

```js
const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

exports.myFunction = onCall({ region: 'asia-southeast1' }, async (request) => {
    // request.auth.uid — verified Firebase UID
    // request.data    — client payload
});
```

2. Export from `functions/index.js`
3. Write unit tests in `functions/__tests__/<name>.test.js`
4. Deploy: `firebase deploy --only functions:<name>`

**Region:** always `asia-southeast1` (Singapore) — Firestore is in `asia-southeast3` (Jakarta) and cannot host Firestore triggers (§7-NN).

**Gen1 vs Gen2:** Existing Gen1 CFs (`require('firebase-functions/v1')`) are maintained as-is. New CFs use Gen2. Do not convert existing Gen1 CFs without a migration plan.

### Deploying CFs

CI auto-deploys on push to main when `functions/**` changes. For manual deploys:

```bash
# Single function
firebase deploy --only functions:myFunction

# Rules only (no CF code)
firebase deploy --only firestore:rules,storage,database
```

**From a worktree:** run `npm run deploy:worktree:prep` first to copy `functions/.env` and install deps in the worktree.

### Environment variables

CF secrets live in `functions/.env` (gitignored). Never hardcode tokens or API keys. The `.env` file is uploaded to Firebase at deploy time.

---

## Firestore rules

Rules live in `firestore.rules`. Always run `npm run test:rules` before deploying rules changes.

**Before tightening rules:** grep all client read paths for the collection you're touching. A rule change that passes tests can still break the live app if a client read path was missed. See §7-P in `CLAUDE.md`.

---

## LIFF / tenant auth

The tenant app uses Firebase custom tokens via the `liffSignIn` Cloud Function. Key patterns:

- Auth-gated Firestore/RTDB reads MUST use `_onLiffClaimsReady(fn)` — never `addEventListener('authReady', ...)` directly (§7-A)
- Every `onSnapshot` call needs an error callback (§7-N)
- Claims from `createCustomToken` are ephemeral — always also call `setCustomUserClaims` (§7-Z)

See [CLAUDE.md](CLAUDE.md) §7 for the full anti-pattern list.

---

## Testing

### Rules tests

```bash
npm run test:rules          # Firestore rules
npm run test:storage        # Storage rules
npm run test:rtdb:rules     # RTDB rules (requires emulator)
```

### CF unit tests

```bash
npm run test:unit           # All CF tests with coverage
npm test -- --test-name-pattern "verifySlip"   # Single suite
```

Tests live in `functions/__tests__/`. Each CF should have a matching test file.

### What to test

- Happy path + main failure modes
- Auth gates (unauthenticated, wrong role)
- Idempotency (calling twice produces the same result)
- Edge cases specific to Thai locale (Buddhist Era years, baht amounts)

---

## PR checklist

Before requesting review:

- [ ] Tests pass (`npm run test:rules && npm run test:unit`)
- [ ] Memory docs updated if architecture changed (`npm run verify:memory` exits 0)
- [ ] CSP hashes regenerated if inline `<style>`/`<script>` changed
- [ ] Tailwind rebuilt if classes changed
- [ ] Verified on Vercel preview (not localhost) for UI changes
- [ ] No hardcoded hex colours, secrets, or `console.log` in production code
- [ ] Commit messages follow Conventional Commits format

---

## Getting help

- Architecture and lifecycle docs: `~/.claude/projects/.../memory/` (session-local) or ask in the PR
- Anti-patterns and incidents: [CLAUDE.md](CLAUDE.md) §7 (A–NN)
- Firebase region split: Firestore = SE3 Jakarta, CFs + Storage = SE1 Singapore
