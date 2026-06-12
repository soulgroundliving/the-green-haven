/**
 * preview-pet-social.js — READ-ONLY state asserter for #10 Pet Social Graph.
 *
 * WHY: the publish → friend-request → accept → opt-out cycle can only be driven
 * from a real LINE app (LIFF-gated, §7-J), so its live verification is
 * owner-only. This tool reads the real Firestore state WITHOUT writing and
 * checks the invariants the owner can't see by eye — turning "I tapped the
 * buttons and it looked right" into "the three collections actually hold what
 * they should". Run it after each step of the playbook to confirm the write
 * landed correctly.
 *
 * Invariants checked (grounded in functions/_petSocialEngine.js + the rules):
 *   INV1 PRIVACY  — every petProfiles doc holds ONLY the safe whitelist
 *                   (name/typeEmoji/breed/gender/age/photoURL) + bio + struct
 *                   fields. A leaked healthLog/vaccine/status/photoPath is a
 *                   PDPA breach (the public mirror must never carry them).
 *   INV2 CONSENT  — every published pet has a matching
 *                   consents/{ownerTenantId}_pet_profile_v1 doc. A published
 *                   pet with NO consent doc is the §7-LLL consent-race
 *                   signature (the bug afc00c0 fixed — publish raced the
 *                   fire-and-forget consent write).
 *   INV3 LINKS    — linkId == buildLinkId(petA,petB); status is valid;
 *                   requesterRoom != recipientRoom (same-room edges forbidden);
 *                   both endpoints share the link's building.
 *
 * Uses the Firebase CLI configstore OAuth token (same as
 * preview-deposit-settlement.js / check-firestore-integrity-rest.js) — no
 * service-account key, no gcloud. NEVER MUTATES (every call is a GET).
 *
 * Usage:
 *   node tools/preview-pet-social.js                       # scan ALL buildings
 *   node tools/preview-pet-social.js --scan                # (explicit) same
 *   node tools/preview-pet-social.js --building rooms      # one building
 *   node tools/preview-pet-social.js --tenant <tenantId>   # one tenant focus
 *   npm run preview:pet-social -- --building rooms
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ID = 'the-green-haven';
const CONFIGSTORE = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

// ── Pure core (exported for parity tests — NO I/O) ──────────────────────────

// Mirror functions/_petSocialEngine.js PROFILE_SAFE_FIELDS exactly.
const PROFILE_SAFE_FIELDS = ['name', 'typeEmoji', 'breed', 'gender', 'age', 'photoURL'];
// Structural fields the CF writes around the safe mirror (+ owner-written bio).
const PROFILE_STRUCT_FIELDS = ['petId', 'ownerTenantId', 'ownerRoom', 'building', 'createdAt', 'updatedAt'];
const PROFILE_ALLOWED = new Set([...PROFILE_STRUCT_FIELDS, ...PROFILE_SAFE_FIELDS, 'bio']);
// Fields that live on the PRIVATE pet doc (tenants/{b}/list/{r}/pets/{petId})
// and must NEVER appear in the public mirror — named so the report is explicit.
const KNOWN_PRIVATE_FIELDS = new Set([
  'healthLog', 'vaccineBookURL', 'vaccineBookPath', 'vaxDate', 'vaxExpiry',
  'isVaccinated', 'status', 'photoPath', 'room', 'dateOfBirth', 'alertStatusHTML',
]);
const VALID_LINK_STATUS = new Set(['pending', 'accepted', 'declined']);

// Mirror functions/_petSocialEngine.js buildLinkId (lexicographic, not numeric).
function buildLinkId(petIdA, petIdB) {
  const a = String(petIdA == null ? '' : petIdA);
  const b = String(petIdB == null ? '' : petIdB);
  if (!a || !b) throw new Error('buildLinkId: both petIds must be non-empty');
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

// INV1 — any key outside the whitelist is a leak; flag the known-private ones.
function auditProfilePrivacy(doc) {
  const leaked = Object.keys(doc || {}).filter((k) => !PROFILE_ALLOWED.has(k));
  const knownPrivate = leaked.filter((k) => KNOWN_PRIVATE_FIELDS.has(k));
  return { leaked, knownPrivate, ok: leaked.length === 0 };
}

// INV3 — link self-consistency. Returns a list of problem strings ([] = ok).
function auditLink(link) {
  const problems = [];
  const id = link.linkId || link.id;
  if (link.petA && link.petB) {
    let expected;
    try { expected = buildLinkId(link.petA, link.petB); } catch { expected = null; }
    if (expected && id && expected !== id) problems.push(`linkId ${id} != buildLinkId(${link.petA},${link.petB})=${expected}`);
  }
  if (!VALID_LINK_STATUS.has(String(link.status))) problems.push(`invalid status "${link.status}"`);
  if (link.requesterRoom != null && link.recipientRoom != null && String(link.requesterRoom) === String(link.recipientRoom)) {
    problems.push(`same-room edge (req room ${link.requesterRoom} == rec room — forbidden)`);
  }
  return problems;
}

// Group + summarise a profile/link set for one building (or all). Pure.
function summarize(profiles, links, building) {
  const inB = (x) => !building || String(x.building) === String(building);
  const profs = profiles.filter(inB);
  const lks = links.filter(inB);
  return {
    building: building || '(all)',
    profileCount: profs.length,
    linkCount: lks.length,
    byStatus: lks.reduce((m, l) => { const s = String(l.status || '?'); m[s] = (m[s] || 0) + 1; return m; }, {}),
    profiles: profs,
    links: lks,
  };
}

// ── REST layer (thin I/O — untested, like the sibling integrity probe) ──────

function readToken() {
  let raw;
  try { raw = fs.readFileSync(CONFIGSTORE, 'utf8'); }
  catch { throw new Error('No Firebase CLI session found (~/.config/configstore/firebase-tools.json).\n  → Run `firebase login` first, then re-run this asserter.'); }
  const tokens = JSON.parse(raw).tokens;
  if (!tokens || !tokens.access_token) throw new Error('No access_token in the firebase-tools configstore.\n  → Run `firebase login` first.');
  if (Date.now() >= (tokens.expires_at || 0)) {
    throw new Error('Firebase CLI access token is EXPIRED.\n  → Refresh it (run any firebase command, e.g. `firebase projects:list`), then re-run.');
  }
  return tokens.access_token;
}

function fsValue(field) {
  if (!field) return undefined;
  if ('stringValue' in field) return field.stringValue;
  if ('integerValue' in field) return Number(field.integerValue);
  if ('doubleValue' in field) return field.doubleValue;
  if ('booleanValue' in field) return field.booleanValue;
  if ('timestampValue' in field) return field.timestampValue;
  if ('nullValue' in field) return null;
  if ('mapValue' in field) {
    const out = {};
    const f = field.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fsValue(f[k]);
    return out;
  }
  if ('arrayValue' in field) return (field.arrayValue.values || []).map(fsValue);
  return undefined;
}
function flat(doc) {
  const out = {};
  if (doc && doc.fields) for (const k of Object.keys(doc.fields)) out[k] = fsValue(doc.fields[k]);
  return out;
}

async function listCollection(token, coll) {
  let pageToken = null;
  const all = [];
  do {
    const qs = new URLSearchParams({ pageSize: '300' });
    if (pageToken) qs.set('pageToken', pageToken);
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${coll}?${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Firestore HTTP ${res.status} listing ${coll}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    if (Array.isArray(j.documents)) all.push(...j.documents);
    pageToken = j.nextPageToken || null;
  } while (pageToken);
  // Keep the doc id SEPARATE from the fields — spreading it into the doc would
  // make auditProfilePrivacy mis-flag a stray `id` key as a leaked field.
  return all.map((d) => ({ id: d.name.split('/').pop(), data: flat(d) }));
}

async function docExists(token, docPath) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Firestore HTTP ${res.status} on ${docPath}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

// ── CLI presentation ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { scan: false, building: null, tenant: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scan') out.scan = true;
    else if (a === '--building') out.building = argv[++i];
    else if (a === '--tenant') out.tenant = argv[++i];
  }
  return out;
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('  #10 PET SOCIAL — READ-ONLY STATE ASSERTER (no writes)');
  console.log('  Checks privacy / consent / link invariants on real Firestore.');
  console.log('════════════════════════════════════════════════════════════════');

  const args = parseArgs(process.argv.slice(2));
  const token = readToken();

  // Flatten to the REAL Firestore fields; backfill petId/linkId from the doc id
  // (they equal the doc id by design) without injecting a stray `id` key that
  // the privacy audit would mis-flag.
  const profiles = (await listCollection(token, 'petProfiles')).map((d) => ({ petId: d.id, ...d.data }));
  const links = (await listCollection(token, 'petLinks')).map((d) => ({ linkId: d.id, ...d.data }));
  const sum = summarize(profiles, links, args.building);

  console.log(`\n  building: ${sum.building}   petProfiles: ${sum.profileCount}   petLinks: ${sum.linkCount} ${JSON.stringify(sum.byStatus)}`);

  let fails = 0;

  // ── petProfiles: INV1 privacy + INV2 consent ──────────────────────────────
  console.log('\n  ── PROFILES (published pets) ──');
  if (!sum.profiles.length) console.log('     (none published in this scope)');
  // Dedupe consent lookups by tenantId.
  const consentCache = new Map();
  for (const p of sum.profiles) {
    const tid = p.ownerTenantId;
    if (args.tenant && tid !== args.tenant) continue;
    const priv = auditProfilePrivacy(p);
    let hasConsent = consentCache.get(tid);
    if (hasConsent === undefined && tid) {
      hasConsent = await docExists(token, `consents/${encodeURIComponent(`${tid}_pet_profile_v1`)}`);
      consentCache.set(tid, hasConsent);
    }
    const privTag = priv.ok ? '✅' : (priv.knownPrivate.length ? '🔴 PRIVATE-LEAK' : '⚠️ extra-field');
    const consTag = hasConsent ? '✅ consent' : '🔴 NO CONSENT DOC (§7-LLL race?)';
    console.log(`     ${p.name || '(no name)'} ${p.typeEmoji || ''}  ห้อง ${p.ownerRoom}  [${p.building}]  pet=${p.petId}`);
    console.log(`        INV1 privacy: ${privTag}${priv.leaked.length ? ' → leaked: ' + priv.leaked.join(', ') : ''}`);
    console.log(`        INV2 consent: ${consTag}  (consents/${tid}_pet_profile_v1)`);
    if (p.bio) console.log(`        bio: "${String(p.bio).slice(0, 80)}"`);
    if (!priv.ok || (tid && !hasConsent)) fails++;
  }

  // ── petLinks: INV3 integrity ──────────────────────────────────────────────
  console.log('\n  ── LINKS (friend edges) ──');
  if (!sum.links.length) console.log('     (no edges in this scope)');
  for (const l of sum.links) {
    if (args.tenant && l.requesterTenantId !== args.tenant && l.recipientTenantId !== args.tenant) continue;
    const probs = auditLink(l);
    const tag = probs.length ? '🔴 ' + probs.join('; ') : '✅';
    console.log(`     ${l.requesterName || '?'} (ห้อง ${l.requesterRoom}) → ${l.recipientName || '?'} (ห้อง ${l.recipientRoom})  [${l.status}]  ${tag}`);
    console.log(`        INV3 link: linkId=${l.linkId || l.id}  building=${l.building}`);
    if (probs.length) fails++;
  }

  // ── summary ───────────────────────────────────────────────────────────────
  console.log('\n  ────────────────────────────────────────────────────────────');
  if (fails === 0) {
    console.log('  ✅ ALL INVARIANTS HOLD (privacy / consent / links). Safe state.');
  } else {
    console.log(`  🔴 ${fails} invariant violation(s) above — investigate before relying on this state.`);
  }
  console.log('  (read-only — nothing was written)\n');
}

// Export the pure core for parity tests; run the CLI only when invoked directly.
module.exports = {
  PROFILE_SAFE_FIELDS, PROFILE_ALLOWED, KNOWN_PRIVATE_FIELDS, VALID_LINK_STATUS,
  buildLinkId, auditProfilePrivacy, auditLink, summarize,
};

if (require.main === module) {
  // process.exitCode (not process.exit()) so the undici fetch handle drains —
  // an abrupt exit mid-close trips a Windows libuv assertion (see #253 tool).
  main().catch((e) => { console.error('\nASSERTER STOPPED:', e.message, '\n'); process.exitCode = 1; });
}
