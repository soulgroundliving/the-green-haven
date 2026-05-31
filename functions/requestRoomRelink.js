/**
 * requestRoomRelink — community-member (post-unlink) request to re-link a room.
 *
 * Background: after admin clicks "🔌 ยกเลิกการเชื่อม" on the dashboard LIFF tab,
 * the tenant's liffUsers/{lineUserId} doc flips status='unlinked', their Auth
 * claims are cleared, and the world map is locked down to a single visible pin
 * (see tenant_app.html: body.gh-unlinked-mode CSS gate + _applyUnlinkedMode).
 *
 * This CF is the in-app path for the tenant to ask admin for a fresh link,
 * without external (LINE OA / phone) contact. It is the sibling of liffSignIn's
 * "first-time user" 404 → showLiffLinkForm flow, but for users whose doc
 * already exists in a terminal state.
 *
 * Why a CF (not client setDoc):
 *   firestore.rules — liffUsers/{userId}: create OK by any signed-in caller,
 *   but update is admin-only. A returning unlinked user has the doc already,
 *   so any client setDoc(merge) is rejected as an update. Admin SDK bypasses
 *   the rule and writes server-side.
 *
 * Cousin pattern: liffSignIn — POSTs LIFF idToken as sole credential, verifies
 *   it via LINE /oauth2/v2.1/verify, no Firebase Auth required. The user's
 *   claims may be empty/anonymous at the time of call (post-unlink).
 *
 * Allowed transitions on liffUsers/{lineUserId}:
 *   status='unlinked'  →  status='pending'   (admin previously unlinked)
 *   status='rejected'  →  status='pending'   (player tries again with different room)
 *
 * Rejected transitions (CF returns 409):
 *   status='approved'  — already linked; no need to re-request. If the user wants
 *                        to move to a different room admin can do it directly via
 *                        the dashboard tenant modal.
 *   status='pending'   — request already in queue; admin should approve/reject first.
 *
 * Side effect: best-effort POST to notifyLiffRequest so admin gets a LINE push.
 *
 * Region: asia-southeast1
 * Auth:   none — LIFF idToken is the sole credential
 * Body:   { idToken, building, room }
 * Resp 200: { ok: true, status: 'pending' }
 * Resp 4xx: { error, status? }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getValidBuildings } = require('./buildingRegistry');

if (!admin.apps.length) admin.initializeApp();

const LINE_CHANNEL_ID = '2009790149';
const NOTIFY_URL = 'https://asia-southeast1-the-green-haven.cloudfunctions.net/notifyLiffRequest';

const TERMINAL_OK = new Set(['unlinked', 'rejected']);

exports.requestRoomRelink = functions
  .region('asia-southeast1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', 'https://the-green-haven.vercel.app');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      return res.status(204).send('');
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Validate body ────────────────────────────────────────────────────────
    const { idToken, building, room } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'Body must include idToken (string)' });
    }
    if (!building || typeof building !== 'string') {
      return res.status(400).json({ error: 'Body must include building (string)' });
    }
    if (!room || typeof room !== 'string') {
      return res.status(400).json({ error: 'Body must include room (string)' });
    }
    const roomTrimmed = room.trim();
    // Same regex as transitionToPlayer / liffSignIn — alphanumeric + Thai, 1-30 chars.
    if (!/^[A-Za-z0-9ก-๛_-]{1,30}$/.test(roomTrimmed)) {
      return res.status(400).json({ error: 'Invalid room format' });
    }

    // ── Verify LIFF ID token with LINE ───────────────────────────────────────
    let lineUserId, lineDisplayName, linePictureUrl;
    try {
      const params = new URLSearchParams({ id_token: idToken, client_id: LINE_CHANNEL_ID });
      const lineRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const lineData = await lineRes.json();
      if (!lineRes.ok) {
        console.warn('requestRoomRelink: LINE verify rejected:', lineData);
        return res.status(401).json({ error: lineData.error_description || 'LIFF token verification failed' });
      }
      lineUserId = lineData.sub;
      lineDisplayName = String(lineData.name || '').slice(0, 60);
      linePictureUrl = String(lineData.picture || '').slice(0, 500);
      if (!lineUserId) {
        return res.status(401).json({ error: 'LINE verify response missing sub' });
      }
    } catch (e) {
      console.error('requestRoomRelink: LINE verify call failed:', e.message);
      return res.status(500).json({ error: 'Could not reach LINE verify endpoint' });
    }

    // ── Validate building (dynamic registry, 5-min cache shared with other CFs) ──
    const firestore = admin.firestore();
    const validBuildings = await getValidBuildings(firestore);
    if (!validBuildings.has(building)) {
      return res.status(400).json({
        error: `Unknown building: ${building}`,
      });
    }

    // ── Read existing liffUsers doc — must be in a terminal state ────────────
    const ref = firestore.collection('liffUsers').doc(lineUserId);
    let snap;
    try {
      snap = await ref.get();
    } catch (e) {
      console.error('requestRoomRelink: liffUsers read failed:', e.message);
      return res.status(500).json({ error: 'Firestore read failed' });
    }
    if (!snap.exists) {
      // No prior doc — the user is genuinely a first-timer. They should use the
      // standard signup path (client setDoc via submitLiffLinkRequest), not this
      // re-link CF. Returning 404 nudges the client to fall through.
      return res.status(404).json({ error: 'No prior link record — submit a fresh request' });
    }
    const data = snap.data() || {};
    const currentStatus = String(data.status || 'pending');
    if (!TERMINAL_OK.has(currentStatus)) {
      return res.status(409).json({
        error: `Cannot re-link from status='${currentStatus}'. Pending requests must be approved or rejected by admin first.`,
        status: currentStatus,
      });
    }

    // ── Write the pending re-link request ────────────────────────────────────
    // FieldValue.delete() removes the terminal-state audit stamps so the admin
    // dashboard renders this row exactly like a fresh request (no leftover
    // unlinked banner, no stale rejection reason).
    const FV = admin.firestore.FieldValue;
    const nowIso = new Date().toISOString();
    const payload = {
      lineUserId,
      // Refresh LINE profile fields — display name/picture may have changed
      // since the original signup. Fall back to existing values if LINE
      // /verify didn't return them (some tokens omit picture).
      lineDisplayName: lineDisplayName || String(data.lineDisplayName || ''),
      linePictureUrl:  linePictureUrl  || String(data.linePictureUrl  || ''),
      room: roomTrimmed,
      building,
      status: 'pending',
      requestedAt: nowIso,
      // Audit: who/when previously, kept inside relinkHistory.
      // arrayUnion is idempotent for identical entries but each call has a
      // fresh timestamp, so each request stamps a new history entry.
      relinkHistory: FV.arrayUnion({
        previousStatus: currentStatus,
        previousRoom: String(data.room || ''),
        previousBuilding: String(data.building || ''),
        requestedAt: nowIso,
      }),
      // Clear terminal-state audit fields so the admin row reads as fresh-pending.
      role: FV.delete(),
      tenantId: FV.delete(),
      approvedAt: FV.delete(),
      approvedBy: FV.delete(),
      rejectedAt: FV.delete(),
      rejectedBy: FV.delete(),
      rejectionReason: FV.delete(),
      unlinkedAt: FV.delete(),
      unlinkedBy: FV.delete(),
    };
    try {
      await ref.set(payload, { merge: true });
    } catch (e) {
      console.error('requestRoomRelink: liffUsers write failed:', e.message);
      return res.status(500).json({ error: 'Firestore write failed' });
    }

    // ── Best-effort admin LINE push (non-blocking) ───────────────────────────
    fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId }),
    }).then(r => {
      if (!r.ok) console.warn('requestRoomRelink: notifyLiffRequest non-2xx:', r.status);
    }).catch(e => console.warn('requestRoomRelink: notifyLiffRequest failed (non-fatal):', e.message));

    return res.status(200).json({ ok: true, status: 'pending' });
  });
