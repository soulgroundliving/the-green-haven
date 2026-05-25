#!/usr/bin/env node
/**
 * verify-memory.js — mechanically verify memory lifecycle docs against code.
 *
 * Each lifecycle_*.md file in the user's memory dir is required to have a
 * `## Verification` section containing a ```bash code block. The block lists
 * grep/ls/test commands that prove the load-bearing claims in that doc.
 *
 * This script extracts those commands, runs each, and reports:
 *   ✅ pass = command returned non-empty stdout (grep found at least 1 match)
 *   ❌ fail = command returned empty stdout or non-zero exit (claim unverifiable in current code)
 *
 * Exit code: 0 if all green, 1 if any red.
 *
 * Usage:
 *   node tools/verify-memory.js              # verify all lifecycle docs
 *   node tools/verify-memory.js <doc-path>   # verify a single doc
 *
 * The doctrine that underpins this script:
 *   ~/.claude/projects/.../memory/feedback_verify_via_grep_doctrine.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Resolve paths.
const REPO_ROOT = path.resolve(__dirname, '..');
const MEMORY_DIR = process.env.MEMORY_DIR
  || 'C:/Users/usEr/.claude/projects/C--Users-usEr-Downloads-The-green-haven/memory';

// Resolve which `bash` to use. On Windows, the bare name `bash` is dangerous —
// when this script is launched from cmd.exe, `bash` resolves to the WSL launcher
// (`C:\Windows\System32\bash.exe`), and WSL's filesystem mapping makes the
// Windows-style cwd we hand to execSync produce empty matches across the board
// (every grep returns "no match"). From Git Bash the same bare name resolves to
// `/usr/bin/bash` so it works — which is why the failure only shows up when
// users run `npm run verify:memory` from cmd.exe / PowerShell.
//
// Pin to the Git-for-Windows bash explicitly when present; otherwise fall back
// to the PATH lookup (which is correct on macOS / Linux).
function resolveBash() {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return 'bash';
}
const BASH_PATH = resolveBash();

function listLifecycleDocs() {
  // Graceful exit if memory dir doesn't exist (user-scoped infra; may be absent on fresh clones).
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log(`(no memory dir at ${MEMORY_DIR} — skipping verification)`);
    return [];
  }
  const all = fs.readdirSync(MEMORY_DIR);
  return all
    .filter(f => f.startsWith('lifecycle_') && f.endsWith('.md'))
    .map(f => path.join(MEMORY_DIR, f));
}

function findVerificationSection(content) {
  // Find `## Verification` heading. Take from there until the next `## ` heading
  // or end-of-file. Earlier version used Perl-only `\Z` which silently never matches in JS.
  const idx = content.search(/^## Verification\b/m);
  if (idx < 0) return null;
  const after = content.slice(idx);
  const nextHeadingMatch = after.slice(1).search(/\n## /);
  return nextHeadingMatch >= 0 ? after.slice(0, 1 + nextHeadingMatch) : after;
}

function extractBashFromVerificationSection(content) {
  const section = findVerificationSection(content);
  if (!section) return null;
  const fenceMatch = section.match(/```bash\n([\s\S]*?)```/);
  if (!fenceMatch) return null;
  return fenceMatch[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Coverage mode: scan the doc's PROSE (everything except the Verification block)
// for code-tick `quoted` identifiers, then check whether each appears anywhere in
// the Verification block. An identifier that's referenced in prose but not
// covered by a verifier line is "uncovered" — a sign that the prose is making an
// architectural claim with no grep-based proof. This addresses the limitation
// that the basic verifier only checks claims you remembered to add to the table.
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  // English prose
  'true', 'false', 'null', 'undefined', 'this', 'and', 'or', 'not', 'the', 'a',
  'an', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'do',
  'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'must', 'see', 'note', 'todo', 'fixme', 'new', 'old', 'yes', 'no', 'ok',
  // Generic JS keywords + common short identifiers (high false-positive rate)
  'function', 'return', 'class', 'const', 'await', 'async', 'import', 'export',
  'default', 'static', 'public', 'private', 'protected', 'extends', 'super',
  'throw', 'catch', 'finally', 'while', 'break', 'continue', 'switch',
  'case', 'typeof', 'instanceof', 'string', 'number', 'object', 'array',
  'boolean', 'symbol', 'value', 'param', 'params', 'config', 'data',
  // Bash / grep helpers (appear in nearly every Verification block)
  'grep', 'echo', 'head', 'tail',
]);

function looksLikeCodeIdentifier(s) {
  if (s.length < 3) return false;
  if (STOP_WORDS.has(s.toLowerCase())) return false;
  // Pure prose like "Living OS" — has spaces but no code-y characters
  if (s.includes(' ') && !/[\/._\-{}\[\]()=]/.test(s)) return false;
  // Markdown formatting leftovers
  if (/^[\s*_~`]+$/.test(s)) return false;
  // Code-y heuristic: path slash, property dot, underscore, dash-id, camelCase,
  // function call shape, ALL_CAPS, template-literal `${`, brace pattern
  return /[\/_]/.test(s) ||
         /\$\{/.test(s) ||
         /[a-z][A-Z]/.test(s) ||
         /^[A-Z][A-Z0-9_]+$/.test(s) ||
         /\(/.test(s) ||
         /^[a-z][a-zA-Z0-9_]*\.[a-zA-Z]/.test(s);
}

function extractBacktickIdentifiers(text) {
  const out = new Set();
  const re = /`([^`\n]+)`/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].trim();
    if (looksLikeCodeIdentifier(candidate)) out.add(candidate);
  }
  return out;
}

// Coverage stopwords — terms that look code-y but are not project-owned API surfaces.
// Mentioning them in prose doesn't require a per-doc verifier — they're either:
//   - Standard web platform: URLSearchParams, navigator.*, window.*, Date.now(), document.*
//   - Firebase Auth public API: signInWithEmailAndPassword, currentUser, displayName, getIdToken
//   - Error strings (not surfaces): permission_denied
//   - HTML literals quoted in prose for illustration
//   - Already verified in another lifecycle doc via union check
const COVERAGE_IGNORE = new Set([
  // Standard web/Firebase platform
  'permission_denied', 'permission-denied',
  'application/pdf', 'application/x-pdf', 'image/*',
  'Content-Type: application/pdf',
  'firebaseInitialized', 'authReady',
  'Asia/Bangkok',
  '*/15 * * * *',
  'Date.now()', 'Date.now',
  'navigator.userAgent', 'navigator.onLine', 'window.location', 'URLSearchParams',
  'serverTimestamp()', 'serverTimestamp',
  '/api/config',
  // Firebase Auth public API
  'signInWithEmailAndPassword', 'currentUser', 'displayName', 'getIdToken(true)',
  'getIdToken', 'userType', 'userAgent',
  // Project-internal common identifiers used as illustration not as architecture claim
  'isAdmin()', 'isAccountant()',
  'showPage', 'showPage(...)', 'getAll', 'getAll()', 'onChange', 'onChange(fn)',
  // Doctrinal mentions of doctrine/file names
  'feedback_verify_via_grep_doctrine.md',
  // Generic illustrative paths / legacy mentions (no current code surface)
  'gs://the-green-haven.firebasestorage.app',
  'slips/...',
  'buildings/{id}.promptpay',
  'get()',
  // Future / aspirational identifiers (not implemented yet)
  'liffSignIn',
  // Firebase Auth error codes — strings, not project surfaces
  'auth/admin-restricted-operation',
  // Template-literal placeholders that survived stripping
  '${userId}', '${building}', '${room}', '${roomId}', '${billId}',
  // JS time-arithmetic expressions (illustrative, not API surfaces)
  'Date.now() + 24*60*60*1000', 'Date.now()+543',
  // Removed legacy function names mentioned in failure-mode prose
  'loadPS()',
  // File refs to other memory docs (cross-references, not code claims)
  'point_economy_rules.md', 'gamification_ssot.md', 'gamification_live_flag.md',
  'air_quality_waqi.md', 'tenant_app_architecture.md', 'firestore_schema_canonical.md',
  'firestore_schema_gotchas.md', 'building_internet_status.md',
  'tenant_config_manager_keys.md', 'region_split_southeast1_3.md',
  'generate_bills_cf_frozen.md', 'billing_monthly_flow.md',
  'feedback_modal_security.md', 'feedback_firestore_onsnapshot_initial_replay.md',
  // Firebase / browser API mentions (not project surfaces)
  '.sort()', 'getDoc', 'getDocs', 'addDoc', 'setDoc', 'deleteDoc', 'onSnapshot',
  'runWith({ secrets })', 'backgroundColor', 'data:image/jpeg;base64,...',
  'getElementById', 'createElement', 'addEventListener',
  // Inline Thai UI strings (illustrative, not architecture)
  'ลบ user records anon ทั้งหมด? (ผู้ที่ link LINE แล้วไม่กระทบ — ลบเฉพาะ guest ที่ไม่เคย link)',
  // Math formulas / illustrative expressions
  'sent / (sent + abandoned) * 100',
  // String literal values used as parameter examples
  "'vaccineBook'", 'vaccineBook',
  // Reward path patterns mentioned in passing (covered by `rewards` token in verifier blob)
  'rewards/{auto}', 'rewards/{id}.cost',
  // GAMIFICATION_LIVE variants — covered as full word elsewhere; the boolean comparisons are illustrative
  'GAMIFICATION_LIVE === false', 'GAMIFICATION_LIVE=false', 'GAMIFICATION_LIVE=true',
]);

const HTML_LITERAL_RE = /^<[a-zA-Z][^>]*>.*<\/[a-zA-Z]+>$/; // <div>...</div>

function unionVerificationBlocks(allDocs) {
  // Collect every Verification section text from every lifecycle doc, so a
  // claim mentioned in doc A is "covered" if doc B has a verifier for it.
  // Docs are co-canonical — they form a single architecture; cross-references
  // are expected and shouldn't trip the coverage check.
  let blob = '';
  for (const d of allDocs) {
    const content = fs.readFileSync(d, 'utf8');
    const sec = findVerificationSection(content);
    if (sec) blob += '\n' + sec;
  }
  return blob;
}

function coverageReport(docPath, unionBlob) {
  const content = fs.readFileSync(docPath, 'utf8');
  const verifSection = findVerificationSection(content);
  if (!verifSection) return { coverage: 'NO_VERIFICATION_SECTION', uncovered: [] };

  const prose = content.replace(verifSection, '');
  const proseIds = extractBacktickIdentifiers(prose);

  const uncovered = [];
  // Lowercase the search corpus once for case-insensitive substring checks.
  // Code in JS is case-sensitive but humans write `complaints` in prose meaning
  // `getComplaints` in code; coverage should follow human intent.
  const lcVerifSection = verifSection.toLowerCase();
  const lcUnionBlob = unionBlob.toLowerCase();

  for (const id of proseIds) {
    if (COVERAGE_IGNORE.has(id)) continue;
    if (HTML_LITERAL_RE.test(id)) continue;
    // Tokenize: split on path / property / brace / angle / quote separators AND
    // camelCase boundaries. So:
    //   `remindLatePayments`  → ['remind', 'Late', 'Payments']
    //   `tenants/{building}`  → ['tenants', 'building']
    //   `TENANT_LEASE_<roomId>` → ['TENANT_LEASE_', 'roomId']
    // Build candidate strings to search for in the verifier blob:
    //   1. Full identifier as-is (e.g. `isPaid(b,r,y,m)`)
    //   2. Identifier with trailing `(...)` stripped (e.g. `isPaid`)
    //   3. Identifier with template `${...}` removed (e.g. `bill-{building}-...` → `bill----`)
    //   4. Tokens from camelCase + path/brace split, length > 4
    //
    // Token threshold > 4 chars: a 4-char token like `some` or `late` finds
    // false-positive substring matches in any large verifier blob (`something`,
    // `LatePayments`, etc.). 5+ chars is the sweet spot.
    // Skip "file.js:NN" line references — they're pointers, not API surfaces.
    if (/^[\w/.-]+\.(js|html|md|rules|json):\d+$/.test(id)) continue;
    // Strip parens, template literals, AND leading async/await/static/return prefix.
    const stripped = id.replace(/\([^)]*\)$/, '').trim();
    const noTemplates = id.replace(/\$\{[^}]+\}/g, '');
    const noLeadingKw = stripped.replace(/^(async|await|static|const|let|var|return|throw|new|public|private)\s+/i, '');
    const tokens = id
      .split(/[\/.{}<>$\[\]()=\s,'"`*?!:;]+|(?<=[a-z])(?=[A-Z])/)
      .filter(t => t.length > 4 && !STOP_WORDS.has(t.toLowerCase()));
    const candidates = [id, stripped, noTemplates, noLeadingKw, ...tokens]
      .filter(s => s && s.length >= 3) // never search for empty/very-short
      .map(c => c.toLowerCase());
    const hit = candidates.some(c => lcVerifSection.includes(c) || lcUnionBlob.includes(c));
    if (!hit) uncovered.push(id);
  }
  return {
    coverage: uncovered.length === 0 ? 'COVERED' : 'GAPS',
    proseIdsCount: proseIds.size,
    uncovered,
  };
}

function parseCommands(bash) {
  // One logical "command unit" = consecutive non-comment lines.
  // We treat each non-comment line as its own command (most are one-liners).
  // Comment lines (start with `#`) are documentation, not commands.
  const out = [];
  let lastComment = null;
  for (const raw of bash.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      lastComment = line.replace(/^#+\s*/, '');
      continue;
    }
    out.push({ comment: lastComment, command: line });
    lastComment = null;
  }
  return out;
}

function runCommand(cmd) {
  // Use bash explicitly so the same syntax works on Windows (Git Bash).
  // execSync throws on non-zero exit (which `grep` does on no matches);
  // capture both stdout and exit code via try/catch.
  try {
    const out = execSync(cmd, {
      cwd: REPO_ROOT,
      shell: BASH_PATH,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });
    return { ok: out.trim().length > 0, stdout: out.trim() };
  } catch (e) {
    // grep with no match exits 1 with empty stdout — not an error per se,
    // but it does mean the claim is no longer in the code. Treat as fail.
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return {
      ok: stdout.length > 0,
      stdout,
      stderr: (e.stderr ? e.stderr.toString().trim() : '').slice(0, 200),
      exitCode: e.status,
    };
  }
}

function verifyDoc(docPath) {
  const name = path.basename(docPath);
  const content = fs.readFileSync(docPath, 'utf8');
  const bash = extractBashFromVerificationSection(content);
  if (bash === null) {
    return {
      name,
      status: 'NO_VERIFICATION_BLOCK',
      message: 'Doc has no `## Verification` section with a ```bash block.',
      results: [],
    };
  }

  const commands = parseCommands(bash);
  if (commands.length === 0) {
    return {
      name,
      status: 'EMPTY_VERIFICATION_BLOCK',
      message: 'Verification section exists but contains no commands.',
      results: [],
    };
  }

  const results = commands.map(c => ({ ...c, ...runCommand(c.command) }));
  const allOk = results.every(r => r.ok);
  return {
    name,
    status: allOk ? 'GREEN' : 'RED',
    results,
  };
}

function formatReport(report) {
  const lines = [];
  lines.push(`\n=== ${report.name}: ${report.status} ===`);
  if (report.message) lines.push(`  ${report.message}`);
  for (const r of report.results) {
    const label = r.ok ? '✅' : '❌';
    const claim = r.comment || '(no comment)';
    lines.push(`  ${label} ${claim}`);
    lines.push(`     cmd: ${r.command}`);
    if (!r.ok) {
      if (r.stderr) lines.push(`     stderr: ${r.stderr}`);
      lines.push(`     ${r.stdout ? 'stdout: ' + r.stdout.split('\n')[0].slice(0, 120) : '(empty stdout — claim not in code)'}`);
    }
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-lifecycle scan: catch wrong template paths in handoff/journal/feedback.
//
// Why: lifecycle docs are mechanically verified, but handoffs/journals/feedback
// docs aren't. Two wrong template paths slipped through in 24h (2026-04-28),
// both the same shape: paraphrased a path from short-term memory into a
// non-verifier-covered file. The handoff said `wellnessClaimed/{roomId}_2026-04`
// when the real path was `tenants/nest/list/{roomId}/complaintFreeMonthAwarded/{YYYY-MM}`.
//
// What this catches: any backticked string that contains BOTH `/` AND `{...}`
// (i.e. a path template) AND whose literal-segment shape doesn't appear in the
// union of lifecycle doc content. Targeted check — paths-with-placeholders are
// always architecture claims, never illustrative prose, so a non-match is a
// strong signal of fabrication.
//
// What this does NOT catch: prose statements ("X is a single doc with all rooms"),
// non-templated code identifiers (collection names alone, function names),
// commit hashes, or any claim that doesn't take the path template shape. Those
// remain a discipline gate per the verify-via-grep doctrine.
// ─────────────────────────────────────────────────────────────────────────────

function listNonLifecycleMemoryDocs() {
  if (!fs.existsSync(MEMORY_DIR)) return [];
  const all = fs.readdirSync(MEMORY_DIR);
  return all
    .filter(f => f.endsWith('.md'))
    .filter(f => !f.startsWith('lifecycle_'))
    .filter(f => !f.startsWith('archive_'))   // archives are intentionally frozen
    .filter(f => !f.startsWith('session_'))   // session journals are point-in-time history,
                                               // not current architecture; paths in them may
                                               // reference state that's since been refactored.
                                               // Discipline gate is `next_session_handoff_*.md`
                                               // — those describe shipped state and DO get scanned.
    .filter(f => f !== 'MEMORY.md')           // index file, not a content doc
    .map(f => path.join(MEMORY_DIR, f));
}

function unionLifecycleContent(lifecycleDocs) {
  // Canonical "what paths exist" blob: lifecycle docs + canonical SSoT/architecture
  // docs (which use other prefixes but ARE indexed in MEMORY.md's "🏛️ System
  // Lifecycles" + "🧭 Reference" sections) + the actual rule files.
  //
  // Rule files are the SSoT for path shape (Firestore rules use `{}`, RTDB rules
  // use `$`); architecture docs document them. A path is valid if it appears in
  // any of these sources. NOT included: session journals, handoffs, archives —
  // those are point-in-time history.
  //
  // Why expand beyond lifecycle_*: rules nest matches (parent + child match blocks
  // written separately), so a contiguous-substring check on `firestore.rules`
  // alone misses real subcollection paths. Architecture docs flatten them in prose.
  let blob = '';
  for (const d of lifecycleDocs) {
    blob += '\n' + fs.readFileSync(d, 'utf8');
  }
  // Canonical non-lifecycle architecture docs — must stay in sync with MEMORY.md
  // "🏛️ System Lifecycles" + "🧭 Reference" sections. Adding here means the
  // path-shape check considers these as valid sources of architecture truth.
  const canonicalNonLifecycle = [
    'gamification_ssot.md',
    'auth_liff_sot.md',
    'firestore_schema_canonical.md',
    'tenant_app_architecture.md',
    'dashboard_architecture.md',
    'billing_monthly_flow.md',
    'bills_not_showing_diagnostic.md',
    'tenant_config_manager_keys.md',
    'owner_config.md',
    'payment_html_legacy.md',
    'firebase_client_sdk_v11_modular.md',
  ];
  for (const docName of canonicalNonLifecycle) {
    const p = path.join(MEMORY_DIR, docName);
    if (fs.existsSync(p)) blob += '\n' + fs.readFileSync(p, 'utf8');
  }
  for (const ruleFile of ['firestore.rules', 'config/database.rules.json', 'storage.rules']) {
    const p = path.join(REPO_ROOT, ruleFile);
    if (fs.existsSync(p)) blob += '\n' + fs.readFileSync(p, 'utf8');
  }
  return blob;
}

function stripTemplatePlaceholders(s) {
  // Collapse template placeholders in three notation styles:
  //   `tenants/{building}/list/{roomId}`       → `tenants//list/`     (Firestore rules)
  //   `payments/$building/$room`               → `payments//`         (RTDB rules)
  //   `meter_data/${building}_${ym}_${roomId}` → `meter_data/__`      (JS template literal)
  // The empty positions preserve segment count — a 3-segment path can't match
  // a 4-segment shape by accident.
  //
  // Order matters: `${...}` must be stripped BEFORE `{...}` (otherwise `{...}`
  // strips the inner part, leaving a stray `$`).
  return s
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*/g, '')
    .toLowerCase();
}

function templatePathReport(docPath, lifecycleBlobStripped) {
  const content = fs.readFileSync(docPath, 'utf8');
  const ids = extractBacktickIdentifiers(content);
  const fabricated = [];

  // Filter for backticked strings that look like path templates: contain `/`
  // (path separator) AND `{...}` (template placeholder). Examples that match:
  //   `tenants/{building}/list/{roomId}/complaintFreeMonthAwarded/{YYYY-MM}` ✓
  //   `bills/{building}/{room}/{billId}` ✓
  // Examples that don't:
  //   `BuildingConfig.getNestRoomIds()` (no `/`) ✗
  //   `b258af7` (no `/`, no `{`) ✗
  //   `https://example.com` (no `{...}`) ✗

  for (const id of ids) {
    if (!id.includes('/') || !id.includes('{')) continue;
    if (COVERAGE_IGNORE.has(id)) continue;
    // Skip Firestore rule-match patterns — they're rule syntax, not paths.
    if (/^match\s+\//.test(id)) continue;
    // Skip regex literals — `/^[a-zA-Z0-9]{1,10}$/` matches the {N} quantifier
    // syntax but is a pattern, not a Firestore path. Detect by leading `/^` or
    // trailing `$/` (regex anchors that never appear in paths).
    if (/^\/\^/.test(id) || /\$\/$/.test(id)) continue;
    // Skip URLs — `https://`, `promptpay://`, `gs://` etc. include `/` but the
    // template placeholders are query/fragment params, not collection segments.
    if (/^[a-z]+:\/\//.test(id)) continue;
    // Skip grep/shell command snippets — they often quote regex/path templates
    // verbatim as arguments, but the snippet itself is a verifier line, not a claim.
    if (/^(grep|ls|test|find|node|npm|firebase|jq|curl|cat)\s+/.test(id)) continue;
    // Skip JSX/HTML markup — `<Foo bar={baz}><Child /></Foo>` matches both `/`
    // (closing tag) and `{...}` (JSX expression) but is rendering code, not a path.
    if (/^<[a-zA-Z]/.test(id) && /<\/?[a-zA-Z]/.test(id)) continue;
    // Skip function calls — `getDoc(liffUsers/{lineUserId})` is a JS expression,
    // not a path claim. The path lives inside the call; flag it via the inner
    // string if at all. Detect: starts with identifier+`(` and ends with `)`.
    if (/^[a-zA-Z_]\w*\(/.test(id) && /\)$/.test(id)) continue;

    // Strip trailing field accessors before comparing paths:
    //   `tenants/{b}/list/{r}.lease.moveInDate` → `tenants/{b}/list/{r}`
    //   `bills/{b}/{r}/{billId}.{paidAt,dueDate}` → `bills/{b}/{r}/{billId}`
    //   `rooms_config/{b}/{r}.rentPrice` → `rooms_config/{b}/{r}`
    // Field references after the last placeholder are documentation sugar, not
    // collection segments — they shouldn't change the path-match outcome.
    const pathOnly = id
      .replace(/\}\.\{[^}]+\}$/, '}')
      .replace(/\}\.[a-zA-Z][a-zA-Z0-9._]*$/, '}');
    let literalShape = stripTemplatePlaceholders(pathOnly);
    // Trailing `...` is shorthand for "more segments here" — common in prose
    // when referencing a known path family. Strip it; check the prefix only.
    literalShape = literalShape.replace(/\.\.\.$/, '');
    // Skip if shape collapses to nothing meaningful (e.g. `{a}/{b}` → `/`).
    if (literalShape.replace(/\//g, '').trim().length < 4) continue;

    // The shape must appear as a contiguous substring in the (also stripped)
    // lifecycle blob. Stripping both sides means `tenants/{b}/list/{r}` and
    // `tenants/{rooms|nest}/list/{roomId}` collapse to the same shape and match.
    if (!lifecycleBlobStripped.includes(literalShape)) {
      fabricated.push({ id, literalShape });
    }
  }

  return fabricated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Computed assertions: verify numerical claims in lifecycle docs against live
// code counts. Unlike grep-based verifiers ("does this identifier exist?"),
// these check "doc claims N" === "actual code has N" — catching count drift
// without requiring the lifecycle doc to contain a self-referential bash cmd.
//
// Root cause: cleanupChecklistsScheduled.js added 2026-05-14 without updating
// lifecycle_scheduled_jobs.md — count stayed at 10 for months until the
// 2026-05-26 audit. The pre-commit hook (§2c) blocks NEW drift at commit time;
// computed assertions catch EXISTING drift on every `npm run verify:memory`.
// ─────────────────────────────────────────────────────────────────────────────

function runComputedAssertions() {
  const results = [];

  // 1. lifecycle_scheduled_jobs.md — "**N scheduled jobs total**"
  //    Counts pubsub.schedule() calls in functions/*.js, excluding:
  //      - keepLiffWarm (every 5 minutes)
  //      - lineRetryQueue (*/15 * * * *)
  //    These two interval CFs are documented separately and not in the total.
  const scheduledJobsDoc = path.join(MEMORY_DIR, 'lifecycle_scheduled_jobs.md');
  if (fs.existsSync(scheduledJobsDoc)) {
    try {
      const content = fs.readFileSync(scheduledJobsDoc, 'utf8');
      const m = content.match(/\*\*(\d+) scheduled jobs total\*\*/);
      if (m) {
        const docCount = parseInt(m[1], 10);
        const functionsDir = path.join(REPO_ROOT, 'functions');
        let actual = 0;
        if (fs.existsSync(functionsDir)) {
          for (const f of fs.readdirSync(functionsDir)) {
            if (!f.endsWith('.js')) continue;
            const src = fs.readFileSync(path.join(functionsDir, f), 'utf8');
            for (const line of src.split('\n')) {
              if (line.includes('pubsub.schedule(') &&
                  !line.includes('every 5 minutes') &&
                  !line.includes('*/15')) {
                actual++;
              }
            }
          }
        }
        const ok = actual === docCount;
        results.push({
          comment: `lifecycle_scheduled_jobs: doc says ${docCount} total, code has ${actual} (excl. keepLiffWarm+lineRetryQueue)`,
          command: '[computed: count pubsub.schedule() in functions/*.js excl. every-5min/every-15min]',
          ok,
          stdout: ok
            ? `${actual} scheduled CF job(s) — count matches lifecycle doc`
            : `MISMATCH: doc=${docCount} actual=${actual} — update **${actual} scheduled jobs total** in lifecycle_scheduled_jobs.md`,
        });
      }
    } catch (e) {
      // Non-fatal: fresh clone may not have the user-scoped memory dir.
    }
  }

  // 2. feature_state_canonical.md — "**N CFs use BuildingRegistry helpers**"
  //    Counts functions/*.js files that CALL getAllBuildings(/getValidBuildings(,
  //    excluding functions/buildingRegistry.js itself (which DEFINES them).
  //    Drift signal: doc says 9 (2026-05-13 batch) but reality is 20 as of
  //    2026-05-26 — every new CF written for facility bookings / PDPA / lease
  //    transitions etc. used the registry from day 1.
  const featureStateDoc = path.join(MEMORY_DIR, 'feature_state_canonical.md');
  if (fs.existsSync(featureStateDoc)) {
    try {
      const content = fs.readFileSync(featureStateDoc, 'utf8');
      const m = content.match(/\*\*(\d+) CFs use BuildingRegistry helpers\*\*/);
      if (m) {
        const docCount = parseInt(m[1], 10);
        const functionsDir = path.join(REPO_ROOT, 'functions');
        let actual = 0;
        if (fs.existsSync(functionsDir)) {
          for (const f of fs.readdirSync(functionsDir)) {
            if (!f.endsWith('.js')) continue;
            if (f === 'buildingRegistry.js') continue; // helper, not consumer
            const src = fs.readFileSync(path.join(functionsDir, f), 'utf8');
            if (src.includes('getAllBuildings(') || src.includes('getValidBuildings(')) {
              actual++;
            }
          }
        }
        const ok = actual === docCount;
        results.push({
          comment: `feature_state_canonical: doc says ${docCount} CFs use registry, code has ${actual} (excl. buildingRegistry.js)`,
          command: '[computed: count functions/*.js calling getAllBuildings(/getValidBuildings( excl. the helper itself]',
          ok,
          stdout: ok
            ? `${actual} CF(s) use BuildingRegistry helpers — count matches feature_state_canonical`
            : `MISMATCH: doc=${docCount} actual=${actual} — update **${actual} CFs use BuildingRegistry helpers** in feature_state_canonical.md`,
        });
      }
    } catch (e) {
      // Non-fatal: fresh clone may not have the user-scoped memory dir.
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dead-link sweep: scan every `.md` file in MEMORY_DIR for markdown links
// `[text](target.md)` (with optional `#anchor`) and verify that target.md
// exists in MEMORY_DIR. Catches broken cross-doc references when a memory
// file is renamed or never created.
//
// Root cause: 2026-05-26 Round 4 audit found 4 dead links in lifecycle docs
// pointing at `feedback_firebase_auth_anon_race.md` / `gcp_api_key_securetoken_blocked.md`
// / `lifecycle_lease_doc_pdpa.md` etc. that were referenced as if they existed.
// Manual `grep -rho` sweep caught them all — promoting to verifier so it runs
// on every `npm run verify:memory` + pre-commit.
//
// Scope: external URLs (`https://`, `http://`, `mailto:`), absolute paths (`/`),
// and parent-dir refs (`../`) are skipped — only sibling memory-file refs are checked.
// ─────────────────────────────────────────────────────────────────────────────

function runDeadLinkAssertions() {
  const results = [];
  if (!fs.existsSync(MEMORY_DIR)) return results;

  // Scope: only LIVE docs. Skip frozen point-in-time files that may legitimately
  // reference siblings that have since been deleted/renamed:
  //   archive_*.md            — explicitly archived
  //   session_*.md            — chronological session snapshots
  //   next_session_handoff_*.md — point-in-time handoffs
  const isLiveDoc = (f) =>
    f.endsWith('.md') &&
    !f.startsWith('archive_') &&
    !f.startsWith('session_') &&
    !f.startsWith('next_session_handoff_');

  const mdFiles = fs.readdirSync(MEMORY_DIR).filter(isLiveDoc);
  // Match `](FILENAME.md)` or `](FILENAME.md#anchor)` — captures the .md target only.
  const linkRegex = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
  const deadLinks = [];

  for (const file of mdFiles) {
    const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const target = match[1];
      // Skip non-sibling refs: external URLs, absolute paths, relative paths with separators.
      // Bare-filename targets only (e.g. `feedback_decision_protocol.md`).
      if (target.includes('/') || target.includes('\\') || target.startsWith('.')) continue;
      if (!fs.existsSync(path.join(MEMORY_DIR, target))) {
        deadLinks.push({ file, target });
      }
    }
  }

  const ok = deadLinks.length === 0;
  results.push({
    comment: `dead-link sweep across ${mdFiles.length} live memory doc(s): ${deadLinks.length} broken .md link(s)`,
    command: '[computed: scan live memory/*.md (excl. archive/session/handoff) for [text](X.md) sibling refs]',
    ok,
    stdout: ok
      ? `All inter-memory .md links resolve (${mdFiles.length} live doc(s) scanned)`
      : `Broken links:\n  ${deadLinks.map(d => `${d.file} → ${d.target}`).join('\n  ')}`,
  });

  return results;
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));
  const coverageMode = flags.has('--coverage');
  const strict = flags.has('--strict');
  const allMemoryMode = flags.has('--all-memory'); // also scan handoff/journal/feedback for wrong template paths

  const docs = positional.length > 0 ? positional : listLifecycleDocs();
  if (docs.length === 0) {
    console.log('(no lifecycle docs to verify)');
    process.exit(0);
  }

  // For coverage mode: pre-compute the union of every lifecycle doc's Verification block.
  const unionBlob = coverageMode ? unionVerificationBlocks(docs) : '';
  // For all-memory mode: pre-compute the stripped-placeholder shape blob
  // of every lifecycle doc, so the same `tenants/{a}/list/{b}` path written
  // with different placeholder names still matches.
  const lifecycleBlobStripped = allMemoryMode
    ? stripTemplatePlaceholders(unionLifecycleContent(docs))
    : '';

  let allGreen = true;
  let totalRows = 0;
  let totalRed = 0;
  let totalUncovered = 0;
  for (const d of docs) {
    const report = verifyDoc(d);
    console.log(formatReport(report));
    if (report.status !== 'GREEN' && report.status !== 'NO_VERIFICATION_BLOCK') {
      allGreen = false;
      if (report.results) totalRed += report.results.filter(r => !r.ok).length;
    }
    totalRows += (report.results || []).length;

    if (coverageMode) {
      const cov = coverageReport(d, unionBlob);
      const label = cov.coverage === 'COVERED' ? '✅' : '⚠️';
      console.log(`  ${label} Coverage: ${cov.uncovered.length}/${cov.proseIdsCount || 0} uncovered prose claim(s) (cross-doc check)`);
      if (cov.uncovered.length > 0) {
        for (const id of cov.uncovered) {
          console.log(`     · \`${id}\` — in prose but no verifier across any lifecycle doc`);
        }
        totalUncovered += cov.uncovered.length;
      }
    }
  }

  // Computed assertions: verify numerical claims against live code counts.
  const computedResults = runComputedAssertions();
  if (computedResults.length > 0) {
    console.log('\n=== Computed assertions ===');
    for (const r of computedResults) {
      const label = r.ok ? '✅' : '❌';
      console.log(`  ${label} ${r.comment}`);
      if (!r.ok) {
        console.log(`     ${r.stdout}`);
        allGreen = false;
      }
    }
    totalRows += computedResults.length;
    totalRed += computedResults.filter(r => !r.ok).length;
  }

  // Dead-link sweep: scan every memory/*.md for broken inter-memory references.
  const deadLinkResults = runDeadLinkAssertions();
  if (deadLinkResults.length > 0) {
    console.log('\n=== Dead-link sweep ===');
    for (const r of deadLinkResults) {
      const label = r.ok ? '✅' : '❌';
      console.log(`  ${label} ${r.comment}`);
      if (!r.ok) {
        console.log(`     ${r.stdout}`);
        allGreen = false;
      } else {
        console.log(`     ${r.stdout}`);
      }
    }
    totalRows += deadLinkResults.length;
    totalRed += deadLinkResults.filter(r => !r.ok).length;
  }

  // All-memory mode: scan handoff/journal/feedback for fabricated template paths.
  let totalFabricated = 0;
  if (allMemoryMode) {
    const nonLifecycleDocs = listNonLifecycleMemoryDocs();
    console.log(`\n=== Scanning ${nonLifecycleDocs.length} non-lifecycle memory doc(s) for fabricated template paths ===`);
    for (const d of nonLifecycleDocs) {
      const fabricated = templatePathReport(d, lifecycleBlobStripped);
      if (fabricated.length === 0) continue;
      console.log(`\n  ⚠️  ${path.basename(d)}: ${fabricated.length} suspect template path(s)`);
      for (const f of fabricated) {
        console.log(`     · \`${f.id}\` — literal shape \`${f.literalShape}\` not found in any lifecycle doc`);
      }
      totalFabricated += fabricated.length;
    }
    if (totalFabricated === 0) {
      console.log('  ✅ all template paths in non-lifecycle docs match a lifecycle doc');
    }
  }

  console.log(`\n=== SUMMARY: ${docs.length} doc(s), ${totalRows} verifier row(s), ${totalRed} fail(s)${coverageMode ? `, ${totalUncovered} uncovered prose claim(s)` : ''}${allMemoryMode ? `, ${totalFabricated} suspect template path(s)` : ''} ===`);
  if (!allGreen) console.log('❌ SOME RED');
  if (coverageMode && totalUncovered > 0) console.log(`⚠️  COVERAGE GAPS — ${totalUncovered} prose claim(s) not in Verification`);
  if (allMemoryMode && totalFabricated > 0) console.log(`⚠️  FABRICATED PATHS — ${totalFabricated} template path(s) in handoff/journal/feedback don't match any lifecycle doc`);
  if (allGreen && (!coverageMode || totalUncovered === 0) && (!allMemoryMode || totalFabricated === 0)) console.log('✅ ALL GREEN');

  // Exit logic:
  //  - default: exit 1 if any RED row
  //  - --coverage --strict: also exit 1 if any uncovered claim
  //  - --all-memory --strict: also exit 1 if any fabricated path
  //  - non-strict warnings don't block commits (lets us iterate without churn)
  let exitCode = 0;
  if (!allGreen) exitCode = 1;
  if (coverageMode && strict && totalUncovered > 0) exitCode = 1;
  if (allMemoryMode && strict && totalFabricated > 0) exitCode = 1;
  process.exit(exitCode);
}

main();
