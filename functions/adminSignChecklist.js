/**
 * adminSignChecklist — admin co-signs a submitted checklist.
 *
 * Auth:   admin only.
 * Input:  { instanceId, adminSignaturePath }
 *         adminSignaturePath: Storage path to admin signature PNG
 * Returns: { signed: true, notified: <number> }
 *
 * Side effect: pushes a LINE Flex message to every approved liffUser for the
 * room — keeps the tenant in sync without them having to re-open the LIFF
 * page (the prior version was silent; tenants kept seeing "รอผู้ดูแลเซ็นกลับ"
 * for hours after sign).
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

const TYPE_LABEL = { move_in: 'ย้ายเข้า', move_out: 'ย้ายออก' };

async function _notifyTenantAdminSigned(instance, instanceId) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN not set — skip checklist notify');
    return 0;
  }
  const { building, roomId, type } = instance;
  if (!building || !roomId) {
    console.warn(`⚠️ instance ${instanceId} missing building/roomId — skip notify`);
    return 0;
  }

  let usersSnap;
  try {
    usersSnap = await firestore.collection('liffUsers')
      .where('building', '==', String(building))
      .where('room',     '==', String(roomId))
      .where('status',   '==', 'approved')
      .get();
  } catch (e) {
    console.error(`❌ liffUsers query failed for ${building}/${roomId}:`, e.message);
    return 0;
  }
  if (usersSnap.empty) {
    console.log(`ℹ️ No approved LINE-linked tenant for ${building}/${roomId} — skip`);
    return 0;
  }

  const typeLabel = TYPE_LABEL[type] || type || 'ตรวจสภาพห้อง';
  const altText = `✅ ใบตรวจห้องเสร็จสมบูรณ์ — แอดมินเซ็นรับแล้ว (${typeLabel})`;
  const message = {
    type: 'flex',
    altText,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#27AE60',
        paddingAll: '12px',
        contents: [{
          type: 'text',
          text: '✅ แอดมินเซ็นรับใบตรวจห้องแล้ว',
          color: '#FFFFFF',
          weight: 'bold',
          size: 'md',
        }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ประเภท', color: '#888888', size: 'sm', flex: 2 },
              { type: 'text', text: typeLabel, size: 'sm', flex: 3, wrap: true },
            ],
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: 'ห้อง',   color: '#888888', size: 'sm', flex: 2 },
              { type: 'text', text: String(roomId), size: 'sm', flex: 3, weight: 'bold' },
            ],
          },
          {
            type: 'text',
            text: 'ใบตรวจเสร็จสมบูรณ์แล้ว — เปิดแอปเพื่อดูรายละเอียดและสำเนา PNG',
            color: '#555555',
            size: 'xs',
            wrap: true,
            margin: 'sm',
          },
        ],
      },
    },
  };

  const { enqueueLineRetry } = require('./_lineRetry');
  const results = await Promise.allSettled(usersSnap.docs.map(doc => {
    const lineUserId = doc.id;
    return fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: lineUserId, messages: [message] }),
    }).then(r => r.ok
      ? Promise.resolve(lineUserId)
      : r.text().then(t => Promise.reject({ lineUserId, error: new Error(`LINE ${r.status}: ${t}`) }))
    );
  }));

  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);

  for (const f of failures) {
    const userId = f?.lineUserId || 'unknown';
    const errMsg = f?.error?.message || String(f);
    await enqueueLineRetry({
      lineUserId: userId,
      message,
      context: { source: 'adminSignChecklist', building, roomId, instanceId },
      idempotencyKey: `checklist-signed-${instanceId}-${userId}`,
      error: errMsg,
    });
  }
  if (failures.length) {
    console.warn(`⚠️ LINE checklist-signed notify failures for ${building}/${roomId} inst ${instanceId}:`, failures.length);
  }
  if (sent > 0) {
    console.log(`📨 checklist-signed notify sent to ${sent} user(s) — ${building}/${roomId}/${instanceId}`);
  }
  return sent;
}

exports.adminSignChecklist = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['LINE_CHANNEL_ACCESS_TOKEN'] })
  .https.onCall(async (data, context) => {
    // ── Auth gate ──────────────────────────────────────────────────────────
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
    }
    if (context.auth.token?.admin !== true) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    // ── Input validation ───────────────────────────────────────────────────
    const { instanceId, adminSignaturePath } = data || {};

    if (!instanceId || typeof instanceId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'instanceId is required');
    }
    if (!adminSignaturePath || typeof adminSignaturePath !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'adminSignaturePath is required');
    }

    // ── Load instance ──────────────────────────────────────────────────────
    const ref  = firestore.collection('checklistInstances').doc(instanceId);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found', 'Checklist instance not found');
    }
    const instance = snap.data();

    // ── Status check ──────────────────────────────────────────────────────
    if (instance.status !== 'submitted') {
      throw new functions.https.HttpsError('failed-precondition',
        `Cannot sign — checklist status is '${instance.status}' (expected 'submitted')`);
    }

    // ── Persist ───────────────────────────────────────────────────────────
    await ref.update({
      adminSignaturePath: adminSignaturePath.slice(0, 500),
      adminSignedBy:      context.auth.uid,
      status:             'admin_signed',
      adminSignedAt:      admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ adminSignChecklist: ${instanceId} signed by admin uid=${context.auth.uid}`);

    // ── Notify tenant (fire-and-await, but never block the write) ──────────
    // Failures are enqueued for retry inside _notifyTenantAdminSigned, so we
    // surface `notified` for telemetry but never throw on push failure.
    let notified = 0;
    try { notified = await _notifyTenantAdminSigned(instance, instanceId); }
    catch (e) { console.warn(`checklist notify wrapper error: ${e?.message || e}`); }

    return { signed: true, notified };
  });
