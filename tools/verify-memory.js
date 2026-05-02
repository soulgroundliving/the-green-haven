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
    .filter(f => f !== 'MEMORY.md')           // index file, not a content doc
    .map(f => path.join(MEMORY_DIR, f));
}

function unionLifecycleContent(lifecycleDocs) {
  // Canonical "what paths exist" blob: lifecycle docs + the actual rule files.
  // Rule files are the SSoT for path shape (Firestore rules use `{}`, RTDB
  // rules use `$`); lifecycle docs document them. A path is valid if it appears
  // in either source.
  let blob = '';
  for (const d of lifecycleDocs) {
    blob += '\n' + fs.readFileSync(d, 'utf8');
  }
  for (const ruleFile of ['firestore.rules', 'config/database.rules.json', 'storage.rules']) {
    const p = path.join(REPO_ROOT, ruleFile);
    if (fs.existsSync(p)) blob += '\n' + fs.readFileSync(p, 'utf8');
  }
  return blob;
}

function stripTemplatePlaceholders(s) {
  // Collapse both Firestore-rule `{building}` and RTDB-rule `$building` styles
  // to empty so the same path written in either notation matches:
  //   `tenants/{building}/list/{roomId}` → `tenants//list/`
  //   `payments/$building/$room`         → `payments//`
  // The empty positions preserve segment count — a 3-segment path can't match
  // a 4-segment shape by accident.
  return s
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

    let literalShape = stripTemplatePlaceholders(id);
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
    if (report.status !== 'GREEN') {
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
