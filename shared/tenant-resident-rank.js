/*
 * Tenant-facing Resident Rank badge — Trust System / Meaning Layer #8 v1.
 *
 * Surfaces the server-computed COMPOSITE community standing (the admin-only
 * `trustScores/{tenantId}.residentRank`, shipped #8 PR1) to the ACTIVE TENANT on
 * the quest-page as a positive growth-ladder BADGE — never the raw 0–100 score.
 * Resident Rank is a DERIVED blend of the tenant's three Trust dimensions
 * (reputation 40% / kindness 30% / verifiedHelper 30%) → one of five growth rungs
 * (เมล็ดใหม่ → ต้นกล้า → ไม้ประจำถิ่น → ร่มเงาของตึก → รากแก้วชุมชน). It is the
 * blueprint "Emotional Lock-in" surface: the rung a resident builds and would
 * lose by leaving. Trust ≠ points (§6).
 *
 * The rung ENUM is computed server-side (_residentRank.js residentRankTier) and
 * MIRRORED onto the tenant-readable roster doc
 * tenants/{b}/list/{r}.residentRankTier by the daily trust sweep
 * (computeTrustScoresScheduled, 05:40 — the SAME combined mirror write as the
 * other three tiers) — write-locked by firestore.rules so a tenant can't fake it
 * (§6 tamper-proof). This client only MAPS the enum → label/emoji; it computes
 * nothing.
 *
 * Design (mirrors shared/tenant-verified-helper.js / tenant-kindness.js exactly):
 *   - PDPA consent gate (§19): the badge renders only after an explicit tenant
 *     opt-in. localStorage fast-path (rr_consent_v1) + a server ledger row at
 *     consents/{tenantId}_resident_rank_v1 (cross-device, written by the existing
 *     recordChecklistConsent CF with purpose 'resident_rank_v1').
 *   - Reads are getDoc, NOT onSnapshot — one roster read (own-read via
 *     linkedAuthUid==auth.uid; carries tenantId + residentRankTier) + at most one
 *     consent read. No new subscription, no index.
 *   - SELF-WIRES via window._onLiffClaimsReady (§7-A) so tenant_app.html stays
 *     markup + <script src> only → no inline-script CSP hash drift (§7-II). The
 *     claim guard (§7-U) waits for building/room (the canonical globals, NOT the
 *     phantom _liffClaims §7-BB) before the FIRST read so the anonymous-auth
 *     pre-claims fire is a no-op (not a stuck render).
 *   - All styling is static CSS in shared/components.css (.rr-card*) — never an
 *     injected <style>/createElement('style') (§7-RR), never an empty innerHTML
 *     slot (§7-X: every render path writes non-empty content).
 *
 * Pure tierDisplay() is exported on window.TenantResidentRank for unit tests
 * (shared/__tests__/tenant-resident-rank.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-resident-rank.test.js
 */
(function () {
  'use strict';

  var LS_CONSENT = 'rr_consent_v1';  // accepted (persistent, cross-session)
  var NOTICE_VERSION = 'v1';
  var MOUNT_ID = 'tenant-resident-rank-card';
  var PRIVACY_URL = '/privacy.html';

  // ── PURE presentation map (tested) ─────────────────────────────────────────
  // The CF (_residentRank.js residentRankTier) emits one of:
  //   'taproot' | 'canopy' | 'rooted' | 'sprout' | 'seed'
  // 'seed' is the gentle growth state (low score / any unknown-or-absent value —
  // the mirror is empty until the first sweep). The ladder is POSITIVE-ONLY: every
  // rung is a stage of growth, there is no "ต่ำ/low" face. NO thresholds live here
  // — the server owns them (75/55/35/15); the client only styles the enum.
  var SEED = { key: 'seed', emoji: '🌱', label: 'เมล็ดใหม่', sub: 'เริ่มต้นเส้นทางของคุณในชุมชนแห่งนี้' };
  var TIERS = {
    taproot: { key: 'taproot', emoji: '🌲', label: 'รากแก้วชุมชน',  sub: 'คุณคือรากฐานที่หยั่งลึกของชุมชนแห่งนี้' },
    canopy:  { key: 'canopy',  emoji: '🌳', label: 'ร่มเงาของตึก',   sub: 'การมีส่วนร่วมของคุณเป็นร่มเงาให้เพื่อนบ้าน' },
    rooted:  { key: 'rooted',  emoji: '🪴', label: 'ไม้ประจำถิ่น',    sub: 'คุณเป็นส่วนหนึ่งของชุมชนนี้อย่างมั่นคง' },
    sprout:  { key: 'sprout',  emoji: '🌿', label: 'ต้นกล้า',         sub: 'คุณกำลังเติบโตและผูกพันกับชุมชนมากขึ้น' },
  };

  /**
   * Map a server rung enum → display descriptor for the badge.
   * @param {string} [tierEnum] one of the CF enums (or undefined when the mirror
   *   field hasn't been written yet)
   * @returns {{key:string, emoji:string, label:string, sub:string}}
   */
  function tierDisplay(tierEnum) {
    switch (String(tierEnum || '')) {
      case 'taproot': return TIERS.taproot;
      case 'canopy':  return TIERS.canopy;
      case 'rooted':  return TIERS.rooted;
      case 'sprout':  return TIERS.sprout;
      case 'seed':
      default:        return SEED; // unknown / absent / provisional → gentle growth state
    }
  }

  // ── browser-only state + helpers (skipped in the node test realm) ───────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { tierDisplay: tierDisplay };
    return;
  }

  var _done = false;       // §7-U: set ONLY after a claims-ready render (not on the anon fire)
  var _tenantId = '';
  var _tier;               // last-read residentRankTier (string | undefined)

  function _fs() { var f = window.firebase; return (f && f.firestore && f.firestoreFunctions) ? f.firestoreFunctions : null; }
  function _db() { var f = window.firebase; return (f && f.firestore) ? f.firestore() : null; }

  function _consentedLocally() {
    try { return localStorage.getItem(LS_CONSENT) === '1'; } catch (_) { return false; }
  }
  function _rememberConsent() {
    try { localStorage.setItem(LS_CONSENT, '1'); } catch (_) { /* storage off — non-fatal */ }
  }

  // Reading a NON-existent consents/{id} throws permission-denied (the rule needs
  // resource.data) — so treat ANY failure as "no consent yet" (§7-N: not surfaced
  // as an error; just show the opt-in prompt).
  async function _serverConsentExists(tenantId) {
    var fs = _fs(); var db = _db();
    if (!fs || !db || !tenantId) return false;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'consents', tenantId + '_resident_rank_v1'));
      return !!(snap && snap.exists());
    } catch (_) { return false; }
  }

  // tenants/{b}/list/{r} — own-read via linkedAuthUid==auth.uid. Carries tenantId
  // + the server-mirrored residentRankTier. getDoc, NOT onSnapshot.
  async function _loadRosterDoc(building, room) {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return null;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'tenants', building, 'list', String(room)));
      return (snap && snap.exists()) ? (snap.data() || {}) : null;
    } catch (e) {
      // permission_denied is expected pre-LIFF-link (linkedAuthUid not set yet) — quiet.
      if (!/permission/i.test((e && e.message) || '')) {
        console.warn('[resident-rank] roster read failed:', (e && e.message) || e);
      }
      return null;
    }
  }

  function _lineSafeOpen(url) {
    try {
      if (window.liff && typeof liff.isInClient === 'function' && liff.isInClient()) {
        liff.openWindow({ url: url, external: true });
        return;
      }
    } catch (_) { /* fall through */ }
    try { window.open(url, '_blank', 'noopener'); } catch (_) { /* noop */ }
  }

  // ── render (every path writes non-empty content — §7-X) ─────────────────────
  function _renderTier(mount, tierEnum) {
    var d = tierDisplay(tierEnum);
    mount.innerHTML =
      '<div class="rr-card rr-card--' + d.key + '">' +
        '<div class="rr-card__emoji" aria-hidden="true">' + d.emoji + '</div>' +
        '<div class="rr-card__body">' +
          '<p class="rr-card__eyebrow">แรงก์ในชุมชน</p>' +
          '<p class="rr-card__label"></p>' +
          '<p class="rr-card__sub"></p>' +
        '</div>' +
      '</div>';
    // Labels are static (from TIERS), but use textContent anyway (§ modal-security habit).
    mount.querySelector('.rr-card__label').textContent = d.label;
    mount.querySelector('.rr-card__sub').textContent = d.sub;
  }

  function _renderMuted(mount) {
    mount.innerHTML =
      '<div class="rr-card rr-card--muted">' +
        '<div class="rr-card__emoji" aria-hidden="true">🌳</div>' +
        '<div class="rr-card__body">' +
          '<p class="rr-card__label">ดูแรงก์ในชุมชนไม่ได้ในขณะนี้</p>' +
          '<p class="rr-card__sub">ลองเปิดหน้านี้อีกครั้งภายหลัง</p>' +
        '</div>' +
      '</div>';
  }

  function _renderConsent(mount) {
    mount.innerHTML =
      '<div class="rr-card rr-card--consent">' +
        '<div class="rr-consent__head">' +
          '<span aria-hidden="true">🌳</span><span>แรงก์ในชุมชนของคุณ</span>' +
        '</div>' +
        '<p class="rr-consent__text">เราสรุป <b>ระดับการมีส่วนร่วมในชุมชน</b> ของคุณ โดยผสมจาก<b>ความน่าเชื่อถือ น้ำใจ และระดับผู้ช่วย</b>ของคุณเข้าด้วยกัน — แสดงเป็น<b>ระดับการเติบโต</b> (ไม่ใช่ตัวเลข) เพื่อให้คุณเห็นความผูกพันที่สะสมไว้กับที่นี่ ระบบคำนวณให้อัตโนมัติและคุณแก้ไขเองไม่ได้</p>' +
        '<button type="button" class="rr-consent__accept">ยินยอมให้แสดงแรงก์ในชุมชน</button>' +
        '<div class="rr-consent__foot">' +
          '<button type="button" class="rr-consent__later">ไม่ใช่ตอนนี้</button>' +
          '<button type="button" class="rr-consent__privacy">นโยบายความเป็นส่วนตัว</button>' +
        '</div>' +
      '</div>';

    mount.querySelector('.rr-consent__accept').addEventListener('click', function () { _accept(mount); });
    mount.querySelector('.rr-consent__later').addEventListener('click', function () {
      mount.innerHTML = ''; // dismiss for this view; re-prompts next session (no LS write)
    });
    mount.querySelector('.rr-consent__privacy').addEventListener('click', function () { _lineSafeOpen(PRIVACY_URL); });
  }

  async function _accept(mount) {
    var btn = mount.querySelector('.rr-consent__accept');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    _rememberConsent();          // optimistic local gate (badge persists next open even if CF lags)
    _renderTier(mount, _tier);   // reveal immediately (§ optimistic; CF write is fire-and-forget proof)
    // Fire-and-forget server ledger write (PDPA proof). consents/{tenantId}_resident_rank_v1.
    try {
      var fns = window.firebase && window.firebase.functions;
      var call = fns && typeof fns.httpsCallable === 'function' && fns.httpsCallable('recordChecklistConsent');
      if (call) {
        call({
          purpose: 'resident_rank_v1',
          noticeVersion: NOTICE_VERSION,
          userAgent: (navigator.userAgent || '').slice(0, 256),
        }).catch(function (e) {
          console.warn('[resident-rank] resident_rank_v1 ledger write failed (non-fatal):', e && (e.message || e));
        });
      }
    } catch (_) { /* CF not wired in this build — non-fatal */ }
  }

  // ── init (self-wired; idempotent; claim-gated §7-A/U) ───────────────────────
  async function _init() {
    if (_done) return;                                   // already rendered with valid claims
    if (!window.firebase || !window.firebase.firestore) return; // SDK not ready — next fire retries
    if (window._isPlayerMode) return;                    // players (people/) deferred — v1 is active-tenant only
    var building = window._tenantAppBuilding;
    var room = window._tenantAppRoom;
    if (!building || !room) return;                      // §7-U: wait for claims (anon fire is a no-op)
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;                                  // markup absent — nothing to do

    _done = true;                                        // only NOW: claims ready + mount present

    var roster = await _loadRosterDoc(building, room);
    if (!roster) { _renderMuted(mount); return; }        // §7-N: read failed → muted, never a spinner
    _tenantId = roster.tenantId || '';
    _tier = roster.residentRankTier;                      // may be undefined → seed state

    var consented = _consentedLocally() || await _serverConsentExists(_tenantId);
    if (consented) { _rememberConsent(); _renderTier(mount, _tier); }
    else { _renderConsent(mount); }
  }

  // Exposed for tests + console debug/reset. The render helpers are exposed for
  // the static-harness visual check (feedback_static_harness_for_authgated_ui)
  // + console debug — same convention as tenant-verified-helper.js.
  window.TenantResidentRank = {
    tierDisplay: tierDisplay, _init: _init,
    _renderTier: _renderTier, _renderConsent: _renderConsent, _renderMuted: _renderMuted,
  };

  // Self-wire (§7-A): the canonical hook fires on authReady + liffLinked and
  // re-fires safely (the _done + claim guards make extra fires no-ops). If the
  // hook is absent (non-LIFF build) the card simply never shows — non-fatal.
  if (typeof window._onLiffClaimsReady === 'function') {
    window._onLiffClaimsReady(function () { _init(); });
  }
})();
