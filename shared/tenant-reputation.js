/*
 * Tenant-facing Reputation tier badge — Trust System Phase 3.2a v1.x.
 *
 * Surfaces the server-computed reputation (the admin-only `trustScores/{tenantId}`
 * shipped #286/#287) to the ACTIVE TENANT on the quest-page as a positive TIER
 * BADGE — never the raw 0–100 number or factor breakdown (decision 2026-06-07:
 * tier-only, to avoid credit-score anxiety + "ทำไมคะแนนหนูต่ำ" support load).
 *
 * The tier ENUM is computed server-side (_reputation.js reputationTier) and
 * MIRRORED onto the tenant-readable roster doc tenants/{b}/list/{r}.reputationTier
 * by the daily trust sweep (computeTrustScoresScheduled, 05:40) — write-locked by
 * firestore.rules so a tenant can't fake it (§6 tamper-proof). This client only
 * MAPS the enum → label/emoji; it computes nothing.
 *
 * Design (mirrors shared/tenant-consent.js + shared/tenant-data-export.js):
 *   - PDPA consent gate (§19): the badge renders only after an explicit tenant
 *     opt-in. localStorage fast-path (rep_consent_v1) + a server ledger row at
 *     consents/{tenantId}_reputation_v1 (cross-device, written by the existing
 *     recordChecklistConsent CF with purpose 'reputation_v1') for proof.
 *   - Reads are getDoc, NOT onSnapshot — one roster read (own-read via
 *     linkedAuthUid==auth.uid, firestore.rules:367; carries tenantId +
 *     reputationTier) + at most one consent read. No new subscription, no index.
 *   - SELF-WIRES via window._onLiffClaimsReady (§7-A) so tenant_app.html stays
 *     markup + <script src> only → no inline-script CSP hash drift (§7-II). The
 *     claim guard (§7-U) waits for building/room before the FIRST read so the
 *     anonymous-auth pre-claims fire is a no-op (not a stuck render).
 *   - All styling is static CSS in shared/components.css (.rep-card*) — never an
 *     injected <style>/createElement('style') (§7-RR), never an empty innerHTML
 *     slot (§7-X: every render path writes non-empty content).
 *
 * Pure tierDisplay() is exported on window.TenantReputation for unit tests
 * (shared/__tests__/tenant-reputation.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-reputation.test.js
 */
(function () {
  'use strict';

  var LS_CONSENT = 'rep_consent_v1';   // accepted (persistent, cross-session)
  var NOTICE_VERSION = 'v1';
  var MOUNT_ID = 'tenant-reputation-card';
  var PRIVACY_URL = '/privacy.html';

  // ── PURE presentation map (tested) ─────────────────────────────────────────
  // The CF (_reputation.js reputationTier) emits one of:
  //   'provisional' | 'high' | 'good' | 'fair' | 'low'
  // The tenant FACE collapses 'provisional' + 'low' (and any unknown/absent
  // value — the mirror is empty until the first sweep) into ONE gentle growth
  // state: we never show a "ต่ำ/low" judgment. NO thresholds live here — the
  // server owns them; the client only styles the enum.
  var SEED = { key: 'seed', emoji: '🌱', label: 'กำลังสร้างคะแนน', sub: 'ระบบกำลังเก็บประวัติของคุณ' };
  var TIERS = {
    high: { key: 'great', emoji: '💎', label: 'ดีเยี่ยม',       sub: 'คุณคือผู้เช่าที่น่าเชื่อถือมาก' },
    good: { key: 'good',  emoji: '⭐', label: 'ดี',             sub: 'ประวัติการเช่าของคุณดูดีมาก' },
    fair: { key: 'fair',  emoji: '🌿', label: 'กำลังไปได้ดี',   sub: 'รักษาแบบนี้ไว้ คะแนนจะดีขึ้นเรื่อยๆ' },
  };

  /**
   * Map a server tier enum → display descriptor for the badge.
   * @param {string} [tierEnum] one of the CF enums (or undefined when the
   *   mirror field hasn't been written yet)
   * @returns {{key:string, emoji:string, label:string, sub:string}}
   */
  function tierDisplay(tierEnum) {
    switch (String(tierEnum || '')) {
      case 'high': return TIERS.high;
      case 'good': return TIERS.good;
      case 'fair': return TIERS.fair;
      case 'provisional':
      case 'low':
      default:     return SEED; // unknown / absent / provisional / low → gentle seed
    }
  }

  // ── browser-only state + helpers (skipped in the node test realm) ───────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { tierDisplay: tierDisplay };
    return;
  }

  var _done = false;       // §7-U: set ONLY after a claims-ready render (not on the anon fire)
  var _tenantId = '';
  var _tier;               // last-read reputationTier (string | undefined)

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
      var snap = await fs.getDoc(fs.doc(db, 'consents', tenantId + '_reputation_v1'));
      return !!(snap && snap.exists());
    } catch (_) { return false; }
  }

  // tenants/{b}/list/{r} — own-read via linkedAuthUid==auth.uid (firestore.rules:367).
  // Carries tenantId + the server-mirrored reputationTier. getDoc, NOT onSnapshot.
  async function _loadRosterDoc(building, room) {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return null;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'tenants', building, 'list', String(room)));
      return (snap && snap.exists()) ? (snap.data() || {}) : null;
    } catch (e) {
      // permission_denied is expected pre-LIFF-link (linkedAuthUid not set yet) — quiet.
      if (!/permission/i.test((e && e.message) || '')) {
        console.warn('[reputation] roster read failed:', (e && e.message) || e);
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
      '<div class="rep-card rep-card--' + d.key + '">' +
        '<div class="rep-card__emoji" aria-hidden="true">' + d.emoji + '</div>' +
        '<div class="rep-card__body">' +
          '<p class="rep-card__eyebrow">ระดับความน่าเชื่อถือ</p>' +
          '<p class="rep-card__label"></p>' +
          '<p class="rep-card__sub"></p>' +
        '</div>' +
      '</div>';
    // Labels are static (from TIERS), but use textContent anyway (§ modal-security habit).
    mount.querySelector('.rep-card__label').textContent = d.label;
    mount.querySelector('.rep-card__sub').textContent = d.sub;
  }

  function _renderMuted(mount) {
    mount.innerHTML =
      '<div class="rep-card rep-card--muted">' +
        '<div class="rep-card__emoji" aria-hidden="true">🛡️</div>' +
        '<div class="rep-card__body">' +
          '<p class="rep-card__label">ดูคะแนนไม่ได้ในขณะนี้</p>' +
          '<p class="rep-card__sub">ลองเปิดหน้านี้อีกครั้งภายหลัง</p>' +
        '</div>' +
      '</div>';
  }

  function _renderConsent(mount) {
    mount.innerHTML =
      '<div class="rep-card rep-card--consent">' +
        '<div class="rep-consent__head">' +
          '<span aria-hidden="true">🛡️</span><span>คะแนนความน่าเชื่อถือของคุณ</span>' +
        '</div>' +
        '<p class="rep-consent__text">เราสรุป <b>ระดับความน่าเชื่อถือ</b> ของคุณจากประวัติจริง — การชำระบิลตรงเวลา ระยะเวลาที่เช่า และประวัติที่ไม่มีข้อร้องเรียน — แสดงเป็น<b>ระดับ</b> (ไม่ใช่ตัวเลข) เพื่อให้คุณเห็นพัฒนาการของตัวเอง ระบบคำนวณให้อัตโนมัติและคุณแก้ไขเองไม่ได้</p>' +
        '<button type="button" class="rep-consent__accept">ยินยอมให้แสดงคะแนน</button>' +
        '<div class="rep-consent__foot">' +
          '<button type="button" class="rep-consent__later">ไม่ใช่ตอนนี้</button>' +
          '<button type="button" class="rep-consent__privacy">นโยบายความเป็นส่วนตัว</button>' +
        '</div>' +
      '</div>';

    mount.querySelector('.rep-consent__accept').addEventListener('click', function () { _accept(mount); });
    mount.querySelector('.rep-consent__later').addEventListener('click', function () {
      mount.innerHTML = ''; // dismiss for this view; re-prompts next session (no LS write)
    });
    mount.querySelector('.rep-consent__privacy').addEventListener('click', function () { _lineSafeOpen(PRIVACY_URL); });
  }

  async function _accept(mount) {
    var btn = mount.querySelector('.rep-consent__accept');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    _rememberConsent();          // optimistic local gate (badge persists next open even if CF lags)
    _renderTier(mount, _tier);   // reveal immediately (§ optimistic; CF write is fire-and-forget proof)
    // Fire-and-forget server ledger write (PDPA proof). consents/{tenantId}_reputation_v1.
    try {
      var fns = window.firebase && window.firebase.functions;
      var call = fns && typeof fns.httpsCallable === 'function' && fns.httpsCallable('recordChecklistConsent');
      if (call) {
        call({
          purpose: 'reputation_v1',
          noticeVersion: NOTICE_VERSION,
          userAgent: (navigator.userAgent || '').slice(0, 256),
        }).catch(function (e) {
          console.warn('[reputation] reputation_v1 ledger write failed (non-fatal):', e && (e.message || e));
        });
      }
    } catch (_) { /* CF not wired in this build — non-fatal */ }
  }

  // ── init (self-wired; idempotent; claim-gated §7-A/U) ───────────────────────
  async function _init() {
    if (_done) return;                                   // already rendered with valid claims
    if (!window.firebase || !window.firebase.firestore) return; // SDK not ready — next fire retries
    if (window._isPlayerMode) return;                    // players (people/) deferred — v1.x is active-tenant only
    var building = window._tenantAppBuilding;
    var room = window._tenantAppRoom;
    if (!building || !room) return;                      // §7-U: wait for claims (anon fire is a no-op)
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;                                  // markup absent — nothing to do

    _done = true;                                        // only NOW: claims ready + mount present

    var roster = await _loadRosterDoc(building, room);
    if (!roster) { _renderMuted(mount); return; }        // §7-N: read failed → muted, never a spinner
    _tenantId = roster.tenantId || '';
    _tier = roster.reputationTier;                        // may be undefined → seed state

    var consented = _consentedLocally() || await _serverConsentExists(_tenantId);
    if (consented) { _rememberConsent(); _renderTier(mount, _tier); }
    else { _renderConsent(mount); }
  }

  // Exposed for tests + console debug/reset. The render helpers are exposed for
  // the static-harness visual check (feedback_static_harness_for_authgated_ui)
  // + console debug — same convention as dashboard-reputation.js exposing its
  // render fns on window._ins.reputation.
  window.TenantReputation = {
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
