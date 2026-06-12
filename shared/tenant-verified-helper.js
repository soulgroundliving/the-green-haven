/*
 * Tenant-facing Verified-Helper tier badge — Trust System / Meaning Layer #7 v1.
 *
 * Surfaces the server-computed verified-helper credential (the admin-only
 * `trustScores/{tenantId}` shipped #7 PR1 `39e24a4`) to the ACTIVE TENANT on the
 * quest-page as a positive TIER BADGE — never the raw 0–100 score or factor
 * breakdown. It is a PEER-CONFIRMED credential: a tenant who has completed help
 * jobs (requester-confirmed `helpRequests.status=='done'`, helper side) earns a
 * positive tier. Distinct from #6 Kindness (which sums the points those same
 * completions write) — this reads the JOB HISTORY, not the spendable balance
 * (Trust ≠ points, §6).
 *
 * The tier ENUM is computed server-side (_verifiedHelper.js verifiedHelperTier)
 * and MIRRORED onto the tenant-readable roster doc
 * tenants/{b}/list/{r}.verifiedHelperTier by the daily trust sweep
 * (computeTrustScoresScheduled, 05:40 — the SAME combined mirror write as
 * reputationTier + kindnessTier) — write-locked by firestore.rules so a tenant
 * can't fake it (§6 tamper-proof). This client only MAPS the enum → label/emoji;
 * it computes nothing.
 *
 * Design (mirrors shared/tenant-kindness.js / tenant-reputation.js exactly):
 *   - PDPA consent gate (§19): the badge renders only after an explicit tenant
 *     opt-in. localStorage fast-path (vh_consent_v1) + a server ledger row at
 *     consents/{tenantId}_verified_helper_v1 (cross-device, written by the
 *     existing recordChecklistConsent CF with purpose 'verified_helper_v1').
 *   - Reads are getDoc, NOT onSnapshot — one roster read (own-read via
 *     linkedAuthUid==auth.uid; carries tenantId + verifiedHelperTier) + at most
 *     one consent read. No new subscription, no index.
 *   - SELF-WIRES via window._onLiffClaimsReady (§7-A) so tenant_app.html stays
 *     markup + <script src> only → no inline-script CSP hash drift (§7-II). The
 *     claim guard (§7-U) waits for building/room (the canonical globals, NOT the
 *     phantom _liffClaims §7-BB) before the FIRST read so the anonymous-auth
 *     pre-claims fire is a no-op (not a stuck render).
 *   - All styling is static CSS in shared/components.css (.vh-card*) — never an
 *     injected <style>/createElement('style') (§7-RR), never an empty innerHTML
 *     slot (§7-X: every render path writes non-empty content).
 *
 * Pure tierDisplay() is exported on window.TenantVerifiedHelper for unit tests
 * (shared/__tests__/tenant-verified-helper.test.js).
 *
 * Run tests: node --test shared/__tests__/tenant-verified-helper.test.js
 */
(function () {
  'use strict';

  var LS_CONSENT = 'vh_consent_v1';  // accepted (persistent, cross-session)
  var NOTICE_VERSION = 'v1';
  var MOUNT_ID = 'tenant-verified-helper-card';
  var PRIVACY_URL = '/privacy.html';

  // ── PURE presentation map (tested) ─────────────────────────────────────────
  // The CF (_verifiedHelper.js verifiedHelperTier) emits one of:
  //   'trusted' | 'seasoned' | 'helper' | 'newcomer'
  // 'newcomer' is the gentle growth state (provisional / below the first rung /
  // any unknown-or-absent value — the mirror is empty until the first sweep). The
  // credential is POSITIVE-ONLY: there is no "ต่ำ/low" face. NO thresholds live
  // here — the server owns them (70/40/10); the client only styles the enum.
  var NEWCOMER = { key: 'newcomer', emoji: '🌱', label: 'ผู้ช่วยหน้าใหม่', sub: 'เริ่มช่วยเหลือเพื่อนบ้านเพื่อสะสมความไว้วางใจ' };
  var TIERS = {
    trusted:  { key: 'trusted',  emoji: '🛡️', label: 'ผู้ช่วยที่ไว้ใจได้',   sub: 'เพื่อนบ้านไว้วางใจให้คุณช่วยเหลือเสมอ' },
    seasoned: { key: 'seasoned', emoji: '🤝', label: 'ผู้ช่วยมากประสบการณ์', sub: 'ช่วยเหลือเพื่อนบ้านมาแล้วหลายครั้ง' },
    helper:   { key: 'helper',   emoji: '🌟', label: 'ผู้ช่วยชุมชน',         sub: 'ขอบคุณที่ลงมือช่วยเหลือเพื่อนบ้าน' },
  };

  /**
   * Map a server tier enum → display descriptor for the badge.
   * @param {string} [tierEnum] one of the CF enums (or undefined when the
   *   mirror field hasn't been written yet)
   * @returns {{key:string, emoji:string, label:string, sub:string}}
   */
  function tierDisplay(tierEnum) {
    switch (String(tierEnum || '')) {
      case 'trusted':  return TIERS.trusted;
      case 'seasoned': return TIERS.seasoned;
      case 'helper':   return TIERS.helper;
      case 'newcomer':
      default:         return NEWCOMER; // unknown / absent / provisional → gentle growth state
    }
  }

  // ── browser-only state + helpers (skipped in the node test realm) ───────────
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) module.exports = { tierDisplay: tierDisplay };
    return;
  }

  var _done = false;       // §7-U: set ONLY after a claims-ready render (not on the anon fire)
  var _tenantId = '';
  var _tier;               // last-read verifiedHelperTier (string | undefined)

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
      var snap = await fs.getDoc(fs.doc(db, 'consents', tenantId + '_verified_helper_v1'));
      return !!(snap && snap.exists());
    } catch (_) { return false; }
  }

  // tenants/{b}/list/{r} — own-read via linkedAuthUid==auth.uid. Carries tenantId
  // + the server-mirrored verifiedHelperTier. getDoc, NOT onSnapshot.
  async function _loadRosterDoc(building, room) {
    var fs = _fs(); var db = _db();
    if (!fs || !db) return null;
    try {
      var snap = await fs.getDoc(fs.doc(db, 'tenants', building, 'list', String(room)));
      return (snap && snap.exists()) ? (snap.data() || {}) : null;
    } catch (e) {
      // permission_denied is expected pre-LIFF-link (linkedAuthUid not set yet) — quiet.
      if (!/permission/i.test((e && e.message) || '')) {
        console.warn('[verified-helper] roster read failed:', (e && e.message) || e);
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
      '<div class="vh-card vh-card--' + d.key + '">' +
        '<div class="vh-card__emoji" aria-hidden="true">' + d.emoji + '</div>' +
        '<div class="vh-card__body">' +
          '<p class="vh-card__eyebrow">ระดับผู้ช่วย</p>' +
          '<p class="vh-card__label"></p>' +
          '<p class="vh-card__sub"></p>' +
        '</div>' +
      '</div>';
    // Labels are static (from TIERS), but use textContent anyway (§ modal-security habit).
    mount.querySelector('.vh-card__label').textContent = d.label;
    mount.querySelector('.vh-card__sub').textContent = d.sub;
  }

  function _renderMuted(mount) {
    mount.innerHTML =
      '<div class="vh-card vh-card--muted">' +
        '<div class="vh-card__emoji" aria-hidden="true">🤝</div>' +
        '<div class="vh-card__body">' +
          '<p class="vh-card__label">ดูระดับผู้ช่วยไม่ได้ในขณะนี้</p>' +
          '<p class="vh-card__sub">ลองเปิดหน้านี้อีกครั้งภายหลัง</p>' +
        '</div>' +
      '</div>';
  }

  function _renderConsent(mount) {
    mount.innerHTML =
      '<div class="vh-card vh-card--consent">' +
        '<div class="vh-consent__head">' +
          '<span aria-hidden="true">🛡️</span><span>ระดับผู้ช่วยของคุณ</span>' +
        '</div>' +
        '<p class="vh-consent__text">เราสรุป <b>ระดับผู้ช่วยที่ได้รับการยืนยัน</b> ของคุณจากประวัติการช่วยเหลือเพื่อนบ้านที่<b>ผู้ขอยืนยันว่าสำเร็จแล้ว</b> — แสดงเป็น<b>ระดับ</b> (ไม่ใช่ตัวเลข) เพื่อให้คุณเห็นความน่าเชื่อถือในฐานะผู้ช่วยที่สะสมไว้ ระบบคำนวณให้อัตโนมัติและคุณแก้ไขเองไม่ได้</p>' +
        '<button type="button" class="vh-consent__accept">ยินยอมให้แสดงระดับผู้ช่วย</button>' +
        '<div class="vh-consent__foot">' +
          '<button type="button" class="vh-consent__later">ไม่ใช่ตอนนี้</button>' +
          '<button type="button" class="vh-consent__privacy">นโยบายความเป็นส่วนตัว</button>' +
        '</div>' +
      '</div>';

    mount.querySelector('.vh-consent__accept').addEventListener('click', function () { _accept(mount); });
    mount.querySelector('.vh-consent__later').addEventListener('click', function () {
      mount.innerHTML = ''; // dismiss for this view; re-prompts next session (no LS write)
    });
    mount.querySelector('.vh-consent__privacy').addEventListener('click', function () { _lineSafeOpen(PRIVACY_URL); });
  }

  async function _accept(mount) {
    var btn = mount.querySelector('.vh-consent__accept');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    _rememberConsent();          // optimistic local gate (badge persists next open even if CF lags)
    _renderTier(mount, _tier);   // reveal immediately (§ optimistic; CF write is fire-and-forget proof)
    // Fire-and-forget server ledger write (PDPA proof). consents/{tenantId}_verified_helper_v1.
    try {
      var fns = window.firebase && window.firebase.functions;
      var call = fns && typeof fns.httpsCallable === 'function' && fns.httpsCallable('recordChecklistConsent');
      if (call) {
        call({
          purpose: 'verified_helper_v1',
          noticeVersion: NOTICE_VERSION,
          userAgent: (navigator.userAgent || '').slice(0, 256),
        }).catch(function (e) {
          console.warn('[verified-helper] verified_helper_v1 ledger write failed (non-fatal):', e && (e.message || e));
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
    _tier = roster.verifiedHelperTier;                    // may be undefined → newcomer state

    var consented = _consentedLocally() || await _serverConsentExists(_tenantId);
    if (consented) { _rememberConsent(); _renderTier(mount, _tier); }
    else { _renderConsent(mount); }
  }

  // Exposed for tests + console debug/reset. The render helpers are exposed for
  // the static-harness visual check (feedback_static_harness_for_authgated_ui)
  // + console debug — same convention as tenant-kindness.js.
  window.TenantVerifiedHelper = {
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
