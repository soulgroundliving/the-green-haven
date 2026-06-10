/*
 * Tenant-facing Kindness tier badge — Trust System / Meaning Layer #6 v1.x.
 *
 * Surfaces the server-computed kindness score (the admin-only `trustScores/{tenantId}`
 * shipped #329/#330/#331) to the ACTIVE TENANT on the quest-page as a positive TIER
 * BADGE — never the raw 0–100 number or factor breakdown (decision 2026-06-11:
 * tier-only, positive-framed; kindness has no "low"/red rung, only growth).
 *
 * The tier ENUM is computed server-side (_kindness.js kindnessTier) and MIRRORED
 * onto the tenant-readable roster doc tenants/{b}/list/{r}.kindnessTier by the daily
 * trust sweep (computeTrustScoresScheduled, 05:40 — the SAME combined mirror write
 * as reputationTier) — write-locked by firestore.rules so a tenant can't fake it
 * (§6 tamper-proof). This client only MAPS the enum → label/emoji; it computes nothing.
 *
 * Design (mirrors shared/tenant-reputation.js #289 exactly):
 *   - PDPA consent gate (§19): the badge renders only after an explicit tenant
 *     opt-in. localStorage fast-path (kind_consent_v1) + a server ledger row at
 *     consents/{tenantId}_kindness_v1 (cross-device, written by the existing
 *     recordChecklistConsent CF with purpose 'kindness_v1') for proof.
 *   - Reads are getDoc, NOT onSnapshot — one roster read (own-read via
 *     linkedAuthUid==auth.uid; carries tenantId + kindnessTier) + at most one
 *     consent read. No new subscription, no index.
 *   - SELF-WIRES via window._onLiffClaimsReady (§7-A) so tenant_app.html stays
 *     markup + <script src> only → no inline-script CSP hash drift (§7-II). The
 *     claim guard (§7-U) waits for building/room before the FIRST read so the
 *     anonymous-auth pre-claims fire is a no-op (not a stuck render).
 *   - All styling is static CSS in shared/components.css (.kind-card*) — never an
 *     injected <style>/createElement('style') (§7-RR), never an empty innerHTML
 *     slot (§7-X: every render path writes non-empty content).
 *
 * Pure tierDisplay() is exported on window.TenantKindness for unit tests
 * (shared/__tests__/tenant-kindness.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-kindness.test.js
 */
(function () {
  'use strict';

  var LS_CONSENT = 'kind_consent_v1';  // accepted (persistent, cross-session)
  var NOTICE_VERSION = 'v1';
  var MOUNT_ID = 'tenant-kindness-card';
  var PRIVACY_URL = '/privacy.html';

  // ── PURE presentation map (tested) ─────────────────────────────────────────
  // The CF (_kindness.js kindnessTier) emits one of:
  //   'radiant' | 'warm' | 'kind' | 'seed'
  // 'seed' is the gentle growth state (provisional / below the first rung / any
  // unknown-or-absent value — the mirror is empty until the first sweep). Kindness
  // is POSITIVE-ONLY: there is no "ต่ำ/low" face. NO thresholds live here — the
  // server owns them; the client only styles the enum.
  var SEED = { key: 'seed', emoji: '🌱', label: 'กำลังสร้างน้ำใจ', sub: 'เริ่มแบ่งปันเพื่อสะสมน้ำใจ' };
  var TIERS = {
    radiant: { key: 'radiant', emoji: '💚', label: 'น้ำใจล้น', sub: 'คุณคือผู้ให้ของชุมชน' },
    warm:    { key: 'warm',    emoji: '🌿', label: 'ใจดี',     sub: 'น้ำใจของคุณช่วยให้ชุมชนอบอุ่น' },
    kind:    { key: 'kind',    emoji: '🤲', label: 'มีน้ำใจ',  sub: 'ขอบคุณที่แบ่งปันให้เพื่อนบ้าน' },
  };

  /**
   * Map a server tier enum → display descriptor for the badge.
   * @param {string} [tierEnum] one of the CF enums (or undefined when the
   *   mirror field hasn't been written yet)
   * @returns {{key:string, emoji:string, label:string, sub:string}}
   */
  function tierDisplay(tierEnum) {
    switch (String(tierEnum || '')) {
      case 'radiant': return TIERS.radiant;
      case 'warm':    return TIERS.warm;
      case 'kind':    return TIERS.kind;
      case 'seed':
      default:        return SEED; // unknown / absent / seed → gentle growth state
    }
  }

  // ── browser-only state + helpers (skipped in the node test realm) ───────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { tierDisplay: tierDisplay };
    return;
  }

  var _done = false;       // §7-U: set ONLY after a claims-ready render (not on the anon fire)
  var _tenantId = '';
  var _tier;               // last-read kindnessTier (string | undefined)

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
      var snap = await fs.getDoc(fs.doc(db, 'consents', tenantId + '_kindness_v1'));
      return !!(snap && snap.exists());
    } catch (_) { return false; }
  }

  // tenants/{b}/list/{r} — own-read via linkedAuthUid==auth.uid. Carries tenantId
  // + the server-mirrored kindnessTier. getDoc, NOT onSnapshot.
  async function _loadRosterDoc(building, room) {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return null;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'tenants', building, 'list', String(room)));
      return (snap && snap.exists()) ? (snap.data() || {}) : null;
    } catch (e) {
      // permission_denied is expected pre-LIFF-link (linkedAuthUid not set yet) — quiet.
      if (!/permission/i.test((e && e.message) || '')) {
        console.warn('[kindness] roster read failed:', (e && e.message) || e);
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
      '<div class="kind-card kind-card--' + d.key + '">' +
        '<div class="kind-card__emoji" aria-hidden="true">' + d.emoji + '</div>' +
        '<div class="kind-card__body">' +
          '<p class="kind-card__eyebrow">ระดับน้ำใจ</p>' +
          '<p class="kind-card__label"></p>' +
          '<p class="kind-card__sub"></p>' +
        '</div>' +
      '</div>';
    // Labels are static (from TIERS), but use textContent anyway (§ modal-security habit).
    mount.querySelector('.kind-card__label').textContent = d.label;
    mount.querySelector('.kind-card__sub').textContent = d.sub;
  }

  function _renderMuted(mount) {
    mount.innerHTML =
      '<div class="kind-card kind-card--muted">' +
        '<div class="kind-card__emoji" aria-hidden="true">💚</div>' +
        '<div class="kind-card__body">' +
          '<p class="kind-card__label">ดูน้ำใจไม่ได้ในขณะนี้</p>' +
          '<p class="kind-card__sub">ลองเปิดหน้านี้อีกครั้งภายหลัง</p>' +
        '</div>' +
      '</div>';
  }

  function _renderConsent(mount) {
    mount.innerHTML =
      '<div class="kind-card kind-card--consent">' +
        '<div class="kind-consent__head">' +
          '<span aria-hidden="true">💚</span><span>ระดับน้ำใจของคุณ</span>' +
        '</div>' +
        '<p class="kind-consent__text">เราสรุป <b>ระดับน้ำใจ</b> ของคุณจากการแบ่งปันในชุมชน — ทำภารกิจ แบ่งปันอาหาร และช่วยเหลือเพื่อนบ้าน — แสดงเป็น<b>ระดับ</b> (ไม่ใช่ตัวเลข) เพื่อให้คุณเห็นน้ำใจที่สะสมไว้ ระบบคำนวณให้อัตโนมัติและคุณแก้ไขเองไม่ได้</p>' +
        '<button type="button" class="kind-consent__accept">ยินยอมให้แสดงน้ำใจ</button>' +
        '<div class="kind-consent__foot">' +
          '<button type="button" class="kind-consent__later">ไม่ใช่ตอนนี้</button>' +
          '<button type="button" class="kind-consent__privacy">นโยบายความเป็นส่วนตัว</button>' +
        '</div>' +
      '</div>';

    mount.querySelector('.kind-consent__accept').addEventListener('click', function () { _accept(mount); });
    mount.querySelector('.kind-consent__later').addEventListener('click', function () {
      mount.innerHTML = ''; // dismiss for this view; re-prompts next session (no LS write)
    });
    mount.querySelector('.kind-consent__privacy').addEventListener('click', function () { _lineSafeOpen(PRIVACY_URL); });
  }

  async function _accept(mount) {
    var btn = mount.querySelector('.kind-consent__accept');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    _rememberConsent();          // optimistic local gate (badge persists next open even if CF lags)
    _renderTier(mount, _tier);   // reveal immediately (§ optimistic; CF write is fire-and-forget proof)
    // Fire-and-forget server ledger write (PDPA proof). consents/{tenantId}_kindness_v1.
    try {
      var fns = window.firebase && window.firebase.functions;
      var call = fns && typeof fns.httpsCallable === 'function' && fns.httpsCallable('recordChecklistConsent');
      if (call) {
        call({
          purpose: 'kindness_v1',
          noticeVersion: NOTICE_VERSION,
          userAgent: (navigator.userAgent || '').slice(0, 256),
        }).catch(function (e) {
          console.warn('[kindness] kindness_v1 ledger write failed (non-fatal):', e && (e.message || e));
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
    _tier = roster.kindnessTier;                          // may be undefined → seed state

    var consented = _consentedLocally() || await _serverConsentExists(_tenantId);
    if (consented) { _rememberConsent(); _renderTier(mount, _tier); }
    else { _renderConsent(mount); }
  }

  // Exposed for tests + console debug/reset. The render helpers are exposed for
  // the static-harness visual check (feedback_static_harness_for_authgated_ui)
  // + console debug — same convention as tenant-reputation.js.
  window.TenantKindness = {
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
