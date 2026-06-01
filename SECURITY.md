# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue or PR that describes the vulnerability.

- Open a [private security advisory](https://github.com/soulgroundliving/the-green-haven/security/advisories/new) for this repository, **or**
- Contact the repository owner directly.

Include the affected page/endpoint, reproduction steps, and impact. We aim to acknowledge promptly and will coordinate a fix and disclosure timeline with you.

## Scope

A private property-management app: a tenant LIFF webview (`tenant_app.html`) + admin dashboard (`dashboard.html`) on a Firebase backend, hosted on Vercel.

- **In scope:** the deployed Vercel app, Cloud Functions (`functions/`), and the Firestore / Storage / Realtime-DB security rules.
- **Out of scope:** the third-party platforms themselves (LINE/LIFF, SlipOK, Firebase, Vercel).

## Secret management

- **Never hardcode secrets.** Server secrets live in Cloud Functions environment config / Google Secret Manager. The client Firebase config is a browser key restricted by API-key + identity restrictions and enforced by security rules — it is not a server credential.
- **Pre-commit secret scanning** blocks commits containing API-key patterns or secret files (`.env`, `*.key`, `*.pem`, `*credentials*`, `serviceAccountKey*.json`). Installed via `npm run install:hooks` (also runs on `npm install`).
- **`.gitignore`** excludes env and credential files.
- **Service-account key rotation:** annually — next rotation **2027-05** (see CLAUDE.md §5).

## Security controls in effect

- **Content-Security-Policy** is enforced on every tracked HTML page; hashes are regenerated on each inline-script/style change and the pre-commit hook blocks hash drift.
- **Branch protection** on `main`: the `validate` CI check is required; force-push and branch deletion are blocked.
- **Security-rules test suites** gate rule changes in CI — `npm run test:rules` (Firestore), `test:storage`, `test:rtdb:rules`.
- **Auth:** Firebase Auth + custom claims; tenant LIFF sessions persist claims via `setCustomUserClaims` (CLAUDE.md §7-Z), with a Firestore source-of-truth fallback in Storage rules for stale-claim windows.

## History

This file previously contained an April 2026 incident report that listed exposed credential **values inline**. Those literal values have been removed from this document. The remediation described at the time — scrubbing the credentials from git history with `git-filter-repo` and adding the pre-commit secret-scanning hook — remains in effect.

Any credential that has ever appeared in source or git history must be treated as compromised and rotated, regardless of later history rewrites.
