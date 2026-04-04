/**
 * Firebase Cloud Function: Secure SlipOK Payment Verification
 *
 * This function securely verifies payment slips using the SlipOK API
 * API keys are stored in environment variables (not in client code)
 *
 * Deploy with: firebase deploy --only functions:verifySlip
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Initialize Firebase Admin SDK (if not already done)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ==================== CONFIGURATION ====================
// Store these in Firebase environment variables (NOT in code)
// Get config via: firebase functions:config:get
const config = functions.config();
const SLIPOK_API_KEY = config.slipok?.api_key;
const SLIPOK_API_URL = config.slipok?.api_url;

// Validate configuration on startup
if (!SLIPOK_API_KEY || !SLIPOK_API_URL) {
  console.error('❌ CRITICAL: SlipOK API credentials not configured!');
  console.error('Set them with:');
  console.error('  firebase functions:config:set slipok.api_key="YOUR_KEY"');
  console.error('  firebase functions:config:set slipok.api_url="YOUR_URL"');
}

// Rate limiting configuration
const RATE_LIMIT_CONFIG = {
  maxRequestsPerMinute: 10,  // More generous on backend
  maxRequestsPerHour: 100,
  maxRequestsPerDay: 1000
};

// ==================== RATE LIMITING ====================
/**
 * Check if request should be rate limited
 * @param {string} userId - User ID or room ID
 * @param {string} timeWindow - 'minute', 'hour', or 'day'
 * @returns {Promise<boolean>} - true if allowed, false if rate limited
 */
async function checkRateLimit(userId, timeWindow = 'minute') {
  try {
    const now = Date.now();
    const timeMs = {
      'minute': 60 * 1000,
      'hour': 60 * 60 * 1000,
      'day': 24 * 60 * 60 * 1000
    }[timeWindow];

    const rateLimitRef = db.collection('rateLimits').doc(`${userId}_${timeWindow}`);
    const doc = await rateLimitRef.get();

    if (!doc.exists) {
      // First request
      await rateLimitRef.set({
        count: 1,
        windowStart: now,
        updatedAt: new Date()
      });
      return true;
    }

    const data = doc.data();
    const windowElapsed = now - data.windowStart;

    if (windowElapsed > timeMs) {
      // Window expired, reset
      await rateLimitRef.update({
        count: 1,
        windowStart: now,
        updatedAt: new Date()
      });
      return true;
    }

    // Still in window
    const maxRequests = {
      'minute': RATE_LIMIT_CONFIG.maxRequestsPerMinute,
      'hour': RATE_LIMIT_CONFIG.maxRequestsPerHour,
      'day': RATE_LIMIT_CONFIG.maxRequestsPerDay
    }[timeWindow];

    if (data.count >= maxRequests) {
      console.warn(`⚠️ Rate limit exceeded for ${userId} (${timeWindow}): ${data.count}/${maxRequests}`);
      return false;
    }

    // Increment count
    await rateLimitRef.update({
      count: data.count + 1,
      updatedAt: new Date()
    });

    return true;
  } catch (error) {
    console.error('❌ Rate limit check failed:', error);
    // On error, allow request (fail open)
    return true;
  }
}

// ==================== VALIDATION ====================
/**
 * Validate request parameters
 * @param {object} params - Request parameters
 * @returns {object} - { valid: boolean, error?: string }
 */
function validateRequest(params) {
  if (!params.file) {
    return { valid: false, error: 'File is required' };
  }

  if (typeof params.file !== 'string') {
    return { valid: false, error: 'File must be base64 string' };
  }

  if (!params.expectedAmount || params.expectedAmount <= 0) {
    return { valid: false, error: 'Expected amount must be positive' };
  }

  if (!params.room && !params.userId) {
    return { valid: false, error: 'Room ID or User ID is required' };
  }

  if (!params.building || !['rooms', 'nest'].includes(params.building)) {
    return { valid: false, error: 'Valid building is required (rooms or nest)' };
  }

  return { valid: true };
}

// ==================== DUPLICATE DETECTION ====================
/**
 * Check if slip has already been verified (prevent duplicate payments)
 * @param {string} transactionId - SlipOK transaction ID
 * @returns {Promise<boolean>} - true if duplicate found
 */
async function isDuplicateSlip(transactionId) {
  try {
    const snapshot = await db.collection('verifiedSlips')
      .where('transactionId', '==', transactionId)
      .where('timestamp', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)) // Last 24 hours
      .limit(1)
      .get();

    return !snapshot.empty;
  } catch (error) {
    console.error('❌ Duplicate check failed:', error);
    return false; // On error, allow (fail open)
  }
}

// ==================== SLIPOK API CALL ====================
/**
 * Call SlipOK API to verify payment slip
 * @param {Buffer} fileBuffer - Image file buffer
 * @returns {Promise<object>} - SlipOK response data
 */
async function callSlipOKAPI(fileBuffer) {
  try {
    const form = new FormData();
    form.append('file', fileBuffer, { filename: 'slip.jpg' });

    const response = await fetch(SLIPOK_API_URL, {
      method: 'POST',
      headers: {
        'x-authorization': SLIPOK_API_KEY
      },
      body: form,
      timeout: 30000 // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`SlipOK API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || 'SlipOK verification failed');
    }

    return data.data;
  } catch (error) {
    console.error('❌ SlipOK API call failed:', error);
    throw new Error(`SlipOK verification error: ${error.message}`);
  }
}

// ==================== LOGGING ====================
/**
 * Log verification attempt for audit trail
 * @param {object} params - Verification parameters
 * @param {object} result - Verification result
 * @param {string} status - 'success', 'failed', 'rate_limited', 'duplicate'
 */
async function logVerificationAttempt(params, result, status) {
  try {
    await db.collection('slipVerificationLog').add({
      status,
      building: params.building,
      room: params.room,
      userId: params.userId,
      expectedAmount: params.expectedAmount,
      verifiedAmount: result?.amount,
      transactionId: result?.transactionId,
      slipSender: result?.sender?.displayName || result?.sender?.name,
      slipDate: result?.date,
      error: result?.error,
      timestamp: new Date(),
      ipAddress: params.ipAddress,
      userAgent: params.userAgent
    });

    console.log(`✅ Logged verification (${status}): ${params.room || params.userId}`);
  } catch (error) {
    console.error('⚠️ Failed to log verification:', error);
    // Don't throw - logging failure shouldn't break the main function
  }
}

// ==================== SAVE VERIFIED SLIP ====================
/**
 * Save verified slip data to Firestore
 * @param {object} slipData - Verified slip data
 * @param {object} params - Original request parameters
 */
async function saveVerifiedSlip(slipData, params) {
  try {
    await db.collection('verifiedSlips').add({
      transactionId: slipData.transactionId,
      building: params.building,
      room: params.room,
      userId: params.userId,
      amount: slipData.amount,
      expectedAmount: params.expectedAmount,
      sender: slipData.sender?.displayName || slipData.sender?.name,
      receiver: slipData.receiver?.displayName || slipData.receiver?.name,
      date: slipData.date,
      bankCode: slipData.sendingBankCode,
      timestamp: new Date(),
      verifiedAt: new Date(),
      verified: true
    });

    console.log(`📋 Saved verified slip: ${slipData.transactionId}`);
  } catch (error) {
    console.error('⚠️ Failed to save verified slip:', error);
    // Don't throw - storage failure shouldn't break verification
  }
}

// ==================== MAIN CLOUD FUNCTION ====================
/**
 * HTTP Cloud Function: Verify payment slip with SlipOK
 *
 * Request body:
 * {
 *   file: "base64-encoded image",
 *   expectedAmount: 2828,
 *   building: "rooms" or "nest",
 *   room: "15",
 *   userId: "tenant_15" // if no room provided
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     amount: 2828,
 *     sender: { displayName: "Bank Name", ... },
 *     receiver: { ... },
 *     transactionId: "...",
 *     date: "...",
 *     sendingBankCode: "..."
 *   }
 * }
 */
exports.verifySlip = functions.https.onRequest(async (req, res) => {
  try {
    // CORS headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ===== VALIDATION =====
    const validation = validateRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { file, expectedAmount, building, room, userId } = req.body;
    const identifier = room || userId;

    console.log(`🔍 Verification request: ${identifier} (${building}), ฿${expectedAmount}`);

    // ===== RATE LIMITING =====
    const rateLimited = !(
      await checkRateLimit(identifier, 'minute') &&
      await checkRateLimit(identifier, 'hour') &&
      await checkRateLimit(identifier, 'day')
    );

    if (rateLimited) {
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        { error: 'Rate limited' },
        'rate_limited'
      );
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: 60
      });
    }

    // ===== CONVERT BASE64 TO BUFFER =====
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(file, 'base64');
    } catch (error) {
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }

    // ===== CALL SLIPOK API =====
    let slipData;
    try {
      slipData = await callSlipOKAPI(fileBuffer);
    } catch (error) {
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        { error: error.message },
        'failed'
      );
      return res.status(400).json({ error: error.message });
    }

    // ===== VALIDATE AMOUNT =====
    const amountDiff = Math.abs(slipData.amount - expectedAmount);
    const amountValid = amountDiff <= 1; // ±1 baht tolerance

    if (!amountValid) {
      console.warn(`⚠️ Amount mismatch: expected ฿${expectedAmount}, got ฿${slipData.amount}`);
      // Still return success but mark amount as mismatched
    }

    // ===== DUPLICATE CHECK =====
    const isDuplicate = await isDuplicateSlip(slipData.transactionId);
    if (isDuplicate) {
      console.warn(`🚨 Duplicate slip detected: ${slipData.transactionId}`);
      await logVerificationAttempt(
        { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
        slipData,
        'duplicate'
      );
      return res.status(400).json({
        error: 'Duplicate slip detected. This slip has already been verified within 24 hours.',
        isDuplicate: true
      });
    }

    // ===== SAVE VERIFIED SLIP =====
    await saveVerifiedSlip(slipData, req.body);

    // ===== LOG SUCCESS =====
    await logVerificationAttempt(
      { ...req.body, ipAddress: req.ip, userAgent: req.get('user-agent') },
      slipData,
      'success'
    );

    // ===== RETURN SUCCESS =====
    console.log(`✅ Slip verified: ${identifier}, Amount: ฿${slipData.amount}, Valid: ${amountValid}`);

    return res.status(200).json({
      success: true,
      data: slipData,
      amountValid,
      amountDiff
    });

  } catch (error) {
    console.error('❌ Unexpected error in verifySlip:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ==================== CLEANUP FUNCTION ====================
/**
 * Daily cleanup: Remove old rate limit records
 * Deploy: firebase deploy --only functions:cleanupRateLimits
 */
exports.cleanupRateLimits = functions.pubsub.schedule('0 2 * * *').onRun(async (context) => {
  try {
    const now = Date.now();
    const cutoffDate = new Date(now - 24 * 60 * 60 * 1000); // 24 hours ago

    const snapshot = await db.collection('rateLimits')
      .where('updatedAt', '<', cutoffDate)
      .get();

    let deleted = 0;
    const batch = db.batch();

    snapshot.forEach(doc => {
      batch.delete(doc.ref);
      deleted++;
    });

    await batch.commit();
    console.log(`🧹 Cleaned up ${deleted} old rate limit records`);
    return null;
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    return null;
  }
});
