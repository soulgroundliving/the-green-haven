/**
 * raisePetAlert — a tenant raises an URGENT, building-wide Lost Pet Alert
 * ("วันนี้น้องหาย") so every approved neighbour gets a 🆘 LINE push and watches
 * for the pet (Meaning Layer #13).
 *
 * Creates petAlerts/{auto-id} with status:'active' + a server-computed `expiresAt`
 * (default 48h, the search-window TTL — D4), then fans the push out to EVERY
 * approved LINE-linked tenant in the SAME building, EXCLUDING the owner's own room
 * (no self-push — D2). The ownerUid/ownerTenantId are server-set from
 * context.auth (never the client — anti-spoof). NO points (a lost pet is not a
 * farm surface — like the #3/#10 boards).
 *
 * The alert card snapshots ONLY the safe pet fields (name / type emoji / photo) —
 * health/vaccine NEVER leak (PDPA; _petAlertEngine.buildPetSnapshot whitelist). It
 * reads the pet REGISTRY tenants/{b}/list/{r}/pets/{petId}, NOT petProfiles (#10).
 *
 * §7-I (production mass-action): the building-wide push is gated by a HARD
 * server-side rate limit — 2 alerts/day per uid — so a confirm-modal slip can
 * never spam the building; the client ALSO previews the push behind a confirm
 * modal before calling. Idempotency key per recipient (petalert-{alertId}-{uid})
 * → a retry can't double-push.
 *
 * Auth: caller must be the registered tenant of {building, roomId}
 * (assertTenantAccess, §7-Z/HH/P). §7-NN callable. Region asia-southeast1. Reuses
 * the existing LINE_CHANNEL_ACCESS_TOKEN secret (§7-WW).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertTenantAccess } = require('./_authSoT');
const { checkRateLimit } = require('./_rateLimit');
const { pushAndRetry } = require('./_notifyHelper');
const { canRaiseAlert, buildAlertDoc, computeExpiresAtMs } = require('./_petAlertEngine');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// LIFF deep-link target — taps on the 🆘 push land on the pet-alert sub-page.
// Mirrors _billFlex.js (?page=) + notifyMarketplaceChat.js (LIFF_ID).
const LIFF_ID = '2009790149-Db7T76sd';
const PET_ALERT_DEEP_LINK = `https://liff.line.me/${LIFF_ID}?page=pet-alert`;

// HARD anti-spam ceiling: 2 alerts/day per uid (§7-I — a building-wide push is a
// mass action). Beyond this the call rejects with resource-exhausted.
const MAX_ALERTS_PER_DAY = 2;
const RATE_WINDOW_SEC = 86400;

/** Build the urgent 🆘 LINE Flex bubble for a lost-pet alert. */
function _buildFlex(alert, roomLabel) {
  const petLine = `${alert.petTypeEmoji || '🐾'} น้อง${alert.petName || ''}`.trim();
  const bodyContents = [
    { type: 'text', text: petLine, weight: 'bold', size: 'md', wrap: true, color: '#B91C1C' },
    { type: 'text', text: `หาย — ${roomLabel}`, size: 'sm', color: '#444444', wrap: true, margin: 'sm' },
  ];
  if (alert.lastSeen) {
    bodyContents.push({ type: 'text', text: `เห็นล่าสุด: ${alert.lastSeen}`, size: 'sm', color: '#666666', wrap: true, margin: 'sm' });
  }
  if (alert.contactNote) {
    bodyContents.push({ type: 'text', text: alert.contactNote, size: 'xs', color: '#888888', wrap: true, margin: 'sm' });
  }
  bodyContents.push({ type: 'text', text: 'เห็นน้องช่วยแจ้งเจ้าของด้วยนะครับ 🙏', size: 'xs', color: '#AAAAAA', wrap: true, margin: 'md' });

  return {
    type: 'flex',
    altText: `🆘 ${petLine} หายในอาคาร — ช่วยกันมองหาน้องนะครับ`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#DC2626', paddingAll: '12px',
        contents: [{ type: 'text', text: '🆘 มีน้องหายในอาคาร', color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      hero: alert.petPhotoURL ? {
        type: 'image', url: alert.petPhotoURL, size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
      } : undefined,
      body: { type: 'box', layout: 'vertical', spacing: 'none', paddingAll: '14px', contents: bodyContents },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '12px',
        contents: [{
          type: 'button', style: 'primary', color: '#DC2626', height: 'sm',
          action: { type: 'uri', label: 'ดูรายละเอียด', uri: PET_ALERT_DEEP_LINK },
        }],
      },
    },
  };
}

exports.raisePetAlert = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    if (!context.auth || !context.auth.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }

    const { building, roomId, petId, lastSeen, contactNote } = data || {};
    if (!building || !roomId) {
      throw new functions.https.HttpsError('invalid-argument', 'building and roomId are required');
    }
    if (!petId) {
      throw new functions.https.HttpsError('invalid-argument', 'petId is required');
    }
    const canonicalBuilding = String(building).toLowerCase();
    if (!['rooms', 'nest'].includes(canonicalBuilding)) {
      throw new functions.https.HttpsError('invalid-argument', `unknown building: ${building}`);
    }
    const room = String(roomId);

    // Auth: caller must be the tenant of this room (claim match, else SoT crosscheck).
    const { tenantData } = await assertTenantAccess({
      building: canonicalBuilding,
      roomId: room,
      context, firestore,
      HttpsError: functions.https.HttpsError,
    });

    // HARD anti-spam: max 2 alerts/day per uid (§7-I mass-action ceiling).
    await checkRateLimit(context.auth.uid, 'raisePetAlert', MAX_ALERTS_PER_DAY, RATE_WINDOW_SEC);

    // Read the pet from the REGISTRY (not petProfiles). Must exist + be approved.
    let petSnap;
    try {
      petSnap = await firestore
        .collection('tenants').doc(canonicalBuilding)
        .collection('list').doc(room)
        .collection('pets').doc(String(petId))
        .get();
    } catch (e) {
      console.error('[raisePetAlert] pet read failed for', `${canonicalBuilding}/${room}/${petId}`, '—', e.message);
      throw new functions.https.HttpsError('internal', 'ไม่สามารถอ่านข้อมูลสัตว์เลี้ยงได้');
    }
    const pet = petSnap.exists ? (petSnap.data() || {}) : null;

    // Anti-dup: refuse if an ACTIVE alert already exists for this pet (building-scoped
    // single-field query → no composite index, §7-J/N).
    let existingActive = null;
    try {
      const dupSnap = await firestore.collection('petAlerts')
        .where('building', '==', canonicalBuilding)
        .where('petId', '==', String(petId))
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (!dupSnap.empty) existingActive = dupSnap.docs[0].data() || { status: 'active' };
    } catch (e) {
      // A missing composite index here would throw — but (building,petId,status) is
      // equality-only, served by single-field zigzag merge, so this is defensive.
      console.warn('[raisePetAlert] active-alert dup check failed (treating as none):', e.message);
    }

    const decision = canRaiseAlert(pet, existingActive);
    if (!decision.ok) {
      const MSG = {
        'not-found': 'ไม่พบสัตว์เลี้ยงในห้องนี้',
        'not-approved': 'สัตว์เลี้ยงต้องได้รับการอนุมัติก่อนจึงจะแจ้งหายได้',
        'already-active': 'มีประกาศตามหาน้องตัวนี้อยู่แล้ว',
      };
      throw new functions.https.HttpsError('failed-precondition', MSG[decision.reason] || 'ไม่สามารถแจ้งหายได้');
    }

    const ownerTenantId = String(
      (tenantData && tenantData.tenantId) || `${canonicalBuilding}_${room}`
    );
    const nowMs = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(computeExpiresAtMs(nowMs));

    const docBody = buildAlertDoc({
      petId: String(petId), pet, building: canonicalBuilding, room,
      ownerTenantId, ownerUid: context.auth.uid, lastSeen, contactNote,
    });
    const ref = await firestore.collection('petAlerts').add({
      ...docBody,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
    });

    // ── Fan out the 🆘 push: every approved tenant in the building, EXCLUDING the
    // owner's own room (no self-push, D2). Building-wide = the room clause is
    // DROPPED from the lookup (vs _notifyHelper.lookupApprovedRoomUsers). The push
    // is best-effort — a LINE hiccup must never fail the alert (the in-app card is
    // already live for everyone). pushAndRetry enqueues failures for the retry queue.
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    let pushed = 0;
    if (!token) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — alert created, skipping push');
    } else {
      try {
        const snap = await firestore.collection('liffUsers')
          .where('building', '==', canonicalBuilding)
          .where('status', '==', 'approved')
          .get();
        const recipients = snap.docs.filter(d => String((d.data() || {}).room) !== room);
        if (recipients.length) {
          const roomLabel = `ห้อง ${room}`;
          const message = _buildFlex(docBody, roomLabel);
          const res = await pushAndRetry({
            docs: recipients,
            message,
            token,
            source: 'raisePetAlert',
            context: { building: canonicalBuilding, roomId: room, alertId: ref.id },
            idempotencyKeyFn: (userId) => `petalert-${ref.id}-${userId}`,
          });
          pushed = res.pushed;
        }
      } catch (e) {
        console.warn('[raisePetAlert] fan-out failed (non-fatal — alert is live):', e.message);
      }
    }

    return { success: true, alertId: ref.id, pushed, expiresAt: expiresAt.toMillis() };
  });

// Exported for unit tests.
exports._buildFlex = _buildFlex;
exports.MAX_ALERTS_PER_DAY = MAX_ALERTS_PER_DAY;
exports.PET_ALERT_DEEP_LINK = PET_ALERT_DEEP_LINK;
