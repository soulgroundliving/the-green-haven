/**
 * composeFarewellSummary — admin-only callable: generate (and, on confirm,
 * publish) a warm AI-written Thai farewell keepsake for a departing tenant.
 * Meaning Layer #16-v2 (v1 = the derive-only farewell card, #336).
 *
 * §7-I (generate → preview → confirm, NEVER auto-write):
 *   - default call  → returns { draft, model } and writes NOTHING. The admin
 *     previews the draft in a modal.
 *   - { publish: true } (with the previewed `text`) → writes
 *     farewellSummary{ status:'published' } onto the live tenant doc.
 *   A `farewellSummary` field on the live tenant doc rides into the archive
 *     automatically (archiveTenantOnMoveOut clones the live doc — §7-DD), so
 *     no separate archive write is needed.
 *
 * 🛡️ PDPA §28 cross-border (the load-bearing guard): the payload sent to Claude
 *   (US) is the ANONYMIZED stats object from _farewellPrompt.buildFarewellPromptInput
 *   — earned numbers + generic descriptors ONLY, no name / room / building /
 *   phone / tenantId / uid. The tenant's real name is templated back in LOCALLY
 *   via renderWithName() AFTER the prose returns. (Asserted in
 *   __tests__/_farewellPrompt.test.js.)
 *
 * §7-NN: HTTPS onCall (NOT a Firestore trigger — Eventarc can't watch SE3
 *   Firestore). §7-WW: ANTHROPIC_API_KEY via the `secrets` binding (the owner
 *   provisions it + test-deploys this ONE CF first). The Anthropic client is
 *   mocked in CI (__tests__/composeFarewellSummary.test.js) — the real API is
 *   never called there.
 *
 * Region: asia-southeast1  ·  Auth: caller MUST have admin claim
 * Input:  { building, roomId, publish?, text? }
 * Output: generate → { draft, model }  ·  publish → { published:true, model }
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { buildFarewellPromptInput, statsToUserContent, renderWithName } = require('./_farewellPrompt');

if (!admin.apps.length) admin.initializeApp();
const firestore = admin.firestore();

// Owner-locked default: cheap + fast for a short one-shot keepsake. Cost is
// pennies/month (few move-outs). claude-opus-4-8 is a one-line swap for higher
// prose quality if ever wanted (cost still trivial).
const FAREWELL_MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 400;

// Warm Thai system prompt. §7-TT: authored via the editor (UTF-8), never sed.
// "respond ONLY with the message" → no preamble (one-shot; no extended thinking).
const WARM_THAI_SYSTEM = [
  'คุณเขียนข้อความอำลาสั้น ๆ ที่อบอุ่นให้ผู้เช่าที่กำลังจะย้ายออกจาก Nature Haven',
  'ซึ่งเป็นคอมมูนิตี้อพาร์ตเมนต์สไตล์มินิมอลแบบมูจิ',
  'เขียนเป็นภาษาไทย น้ำเสียงอบอุ่นจริงใจ ความยาว 2-3 ประโยค',
  'อ้างอิงถึงช่วงเวลาและสิ่งที่เขาสะสมไว้อย่างเฉพาะเจาะจง หลีกเลี่ยงคำคลีเช และอย่าใส่อิโมจิจำนวนมาก',
  'ใช้ตัวยึดชื่อ {{NAME}} ตรงที่ควรเอ่ยชื่อผู้เช่า (ระบบจะแทนที่ด้วยชื่อจริงภายหลัง)',
  'ตอบกลับเฉพาะข้อความอำลาเท่านั้น ไม่ต้องมีคำนำหรือคำอธิบายใด ๆ',
].join(' ');

function _assertAdmin(context) {
  if (!context.auth || !context.auth.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign-in required');
  }
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied',
      'Admin claim required to compose a farewell summary');
  }
}

function _assertRoom(building, roomId) {
  if (!['rooms', 'nest'].includes(String(building))) {
    throw new functions.https.HttpsError('invalid-argument',
      `building must be 'rooms' or 'nest' (got '${building}')`);
  }
  if (typeof roomId !== 'string' || !/^[A-Za-z0-9ก-๛]{1,20}$/.test(roomId)) {
    throw new functions.https.HttpsError('invalid-argument',
      `roomId must be 1-20 alphanumeric/Thai chars (got '${roomId}')`);
  }
}

function _tenantRef(building, roomId) {
  return firestore.collection('tenants').doc(building).collection('list').doc(roomId);
}

/**
 * Lazy Anthropic client factory — kept on `exports` so the unit test can stub
 * it without an SDK install or a real API key (the SDK is a CF-only dep).
 */
exports._makeAnthropic = function (apiKey) {
  // eslint-disable-next-line global-require
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey });
};

/** Extract the plain-text body from an Anthropic messages.create response. */
function _extractText(message) {
  const blocks = (message && Array.isArray(message.content)) ? message.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim();
}

exports.composeFarewellSummary = functions
  .region('asia-southeast1')
  .runWith({ secrets: ['ANTHROPIC_API_KEY'], timeoutSeconds: 60 })
  .https.onCall(async (data, context) => {
    _assertAdmin(context);

    const { building, roomId, publish, text } = data || {};
    _assertRoom(building, roomId);

    const ref = _tenantRef(building, roomId);

    // ── Publish path (§7-I confirm step) — write the previewed text ──────────
    if (publish === true) {
      const finalText = String(text == null ? '' : text).trim();
      if (!finalText) {
        throw new functions.https.HttpsError('invalid-argument',
          'publish requires a non-empty `text` (the previewed draft)');
      }
      const snap = await ref.get();
      if (!snap.exists || !String((snap.data() || {}).tenantId || '').trim()) {
        throw new functions.https.HttpsError('failed-precondition',
          `Room ${building}/${roomId} is vacant — nothing to attach a farewell to`);
      }
      await ref.set({
        farewellSummary: {
          text: finalText,
          model: FAREWELL_MODEL,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
          generatedBy: context.auth.uid,
          status: 'published',
        },
      }, { merge: true });
      return { published: true, model: FAREWELL_MODEL };
    }

    // ── Generate path (§7-I draft step) — returns a DRAFT, writes NOTHING ────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Secret not provisioned yet (§7-WW) — fail clearly, don't 500 opaquely.
      throw new functions.https.HttpsError('failed-precondition',
        'ANTHROPIC_API_KEY is not configured — set it before composing summaries');
    }

    const snap = await ref.get();
    if (!snap.exists) {
      throw new functions.https.HttpsError('not-found',
        `tenants/${building}/list/${roomId} does not exist`);
    }
    const tenantData = snap.data() || {};
    const tenantName = String(tenantData.name || tenantData.firstName || '').trim();

    // Anonymized stats ONLY — this is the entire payload that leaves the border.
    const promptInput = buildFarewellPromptInput(tenantData, Date.now());
    const userContent = statsToUserContent(promptInput);

    let prose = '';
    try {
      const client = exports._makeAnthropic(apiKey);
      const message = await client.messages.create({
        model: FAREWELL_MODEL,
        max_tokens: MAX_TOKENS,
        system: WARM_THAI_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      });
      prose = _extractText(message);
    } catch (e) {
      console.error('composeFarewellSummary: Anthropic call failed:', e && e.message);
      throw new functions.https.HttpsError('internal',
        'Failed to generate the farewell summary — please try again');
    }

    if (!prose) {
      throw new functions.https.HttpsError('internal',
        'The model returned an empty summary — please regenerate');
    }

    // Name templated in LOCALLY (never sent to the model).
    return { draft: renderWithName(prose, tenantName), model: FAREWELL_MODEL };
  });
