/**
 * cleanup-phantom-gamification — one-shot fix for the 2026-06-01 phantom-points
 * incident. The `awardComplaintFreeMonth` CF (pre occupancy-gate) ran +40 on
 * EVERY nest room, including vacant ones, after the test building was reset.
 *
 * This script removes that erroneous +40:
 *   • Vacant rooms (no daily activity)  → full reset gamification → 0
 *       points:0, dailyStreak:0, badges:[], lastDailyClaim: <deleted>
 *       (lastDailyClaimAt audit field + complaintFreeMonthAwarded markers are
 *        left intact; the deployed occupancy gate stops future empty-room awards)
 *   • Test rooms (dailyStreak > 0 OR lastDailyClaim set) → points − 40 (floor 0)
 *       streak / lastDailyClaim / badges preserved (real test progress kept)
 *
 * Read-only credential: the Firebase CLI OAuth token (same as the integrity
 * probe). REST PATCH with this token is admin-level and bypasses security rules.
 *
 * Per CLAUDE.md §7-I: DRY-RUN by default — prints a per-room preview and writes
 * nothing. Pass `--apply` only after the preview is reviewed.
 *
 *   Dry-run:  node tools/cleanup-phantom-gamification.js
 *   Apply:    node tools/cleanup-phantom-gamification.js --apply
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ID = 'the-green-haven';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const PHANTOM_AWARD = 40; // the erroneous complaint-free award per room

function readToken() {
  const obj = JSON.parse(fs.readFileSync(CONFIGSTORE, 'utf8'));
  const t = obj.tokens;
  if (!t || !t.access_token) throw new Error('no access_token in firebase-tools configstore — run `firebase projects:list` first');
  return t.access_token;
}
function fsValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('mapValue' in field) { const o = {}; const f = field.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = fsValue(f[k]); return o; }
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsValue);
  if ('nullValue' in field) return null;
  return undefined;
}
function flat(doc) { const o = {}; if (!doc.fields) return o; for (const k of Object.keys(doc.fields)) o[k] = fsValue(doc.fields[k]); return o; }
function docId(name) { return name.split('/').pop(); }

async function listAll(token, urlPath) {
  let pageToken = null; const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${urlPath}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} list ${urlPath}: ${(await res.text()).slice(0,200)}`);
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  return all;
}

// PATCH only the named gamification leaf fields. Fields listed in the mask but
// absent from the body are DELETED (used for lastDailyClaim); fields not in the
// mask (e.g. lastDailyClaimAt) are preserved.
async function patchGamification(token, roomId, { maskPaths, gamFields }) {
  const qs = maskPaths.map(p => `updateMask.fieldPaths=${encodeURIComponent(p)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/tenants/nest/list/${encodeURIComponent(roomId)}?${qs}`;
  const body = { fields: { gamification: { mapValue: { fields: gamFields } } } };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${roomId} HTTP ${res.status}: ${(await res.text()).slice(0,300)}`);
}

(async () => {
  const apply = process.argv.includes('--apply');
  const token = readToken();
  console.log(`\nMode: ${apply ? '⚠️  APPLY (will write)' : '🧪 DRY-RUN (read-only)'}`);
  console.log('Target: tenants/nest/list/*\n');

  const docs = await listAll(token, 'tenants/nest/list');
  const plans = [];
  for (const doc of docs.sort((a,b)=>docId(a.name).localeCompare(docId(b.name)))) {
    const id = docId(doc.name);
    const d = flat(doc);
    const g = d.gamification || {};
    const points = Number(g.points) || 0;
    const streak = Number(g.dailyStreak) || 0;
    const lastClaim = g.lastDailyClaim || null;
    const badges = Array.isArray(g.badges) ? g.badges.length : 0;
    const isTestRoom = streak > 0 || !!lastClaim; // N101, N404 — keep daily progress

    let plan;
    if (isTestRoom) {
      const newPoints = Math.max(0, points - PHANTOM_AWARD);
      plan = {
        id, kind: 'TEST', points, newPoints, streak, lastClaim, badges,
        change: newPoints !== points,
        maskPaths: ['gamification.points'],
        gamFields: { points: { integerValue: String(newPoints) } },
      };
    } else {
      const dirty = points !== 0 || streak !== 0 || !!lastClaim || badges !== 0;
      plan = {
        id, kind: 'EMPTY', points, newPoints: 0, streak, lastClaim, badges,
        change: dirty,
        maskPaths: ['gamification.points', 'gamification.dailyStreak', 'gamification.badges', 'gamification.lastDailyClaim'],
        gamFields: { points: { integerValue: '0' }, dailyStreak: { integerValue: '0' }, badges: { arrayValue: { values: [] } } },
      };
    }
    plans.push(plan);
  }

  console.log('room   kind   points→new   streak  lastClaim     badges  action');
  console.log('-----  -----  -----------  ------  ------------  ------  ------');
  for (const p of plans) {
    const action = !p.change ? 'skip (clean)' : (p.kind === 'TEST' ? `−${PHANTOM_AWARD} → ${p.newPoints}` : 'RESET → 0');
    console.log(
      `${p.id.padEnd(5)}  ${p.kind.padEnd(5)}  ${String(p.points).padStart(4)} → ${String(p.newPoints).padStart(4)}  ${String(p.streak).padStart(6)}  ${String(p.lastClaim||'-').padEnd(12)}  ${String(p.badges).padStart(6)}  ${action}`
    );
  }
  const toWrite = plans.filter(p => p.change);
  const tests = plans.filter(p => p.kind === 'TEST');
  console.log(`\n${docs.length} nest rooms · ${toWrite.length} need change · ${tests.length} test room(s) preserved: ${tests.map(t=>t.id).join(', ') || '(none)'}`);

  if (!apply) { console.log('\nDry-run complete. Re-run with --apply to commit.'); return; }
  if (!toWrite.length) { console.log('\nNothing to write.'); return; }

  let done = 0;
  for (const p of toWrite) {
    await patchGamification(token, p.id, { maskPaths: p.maskPaths, gamFields: p.gamFields });
    done++;
    console.log(`  ✓ ${p.id} (${p.kind}) → points ${p.newPoints}`);
  }
  console.log(`\n✅ Updated ${done} rooms.`);
})().catch(e => { console.error('CLEANUP FAILED:', e.message); process.exit(1); });
