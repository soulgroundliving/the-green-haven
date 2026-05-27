'use strict';

/**
 * verifySlip — request validation helpers.
 * Extracted from verifySlip.js to keep the main handler readable.
 */

/**
 * Validate request parameters.
 * @param {object} params
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
async function validateRequest(params) {
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

  if (!params.building) {
    return { valid: false, error: 'building is required' };
  }
  const { getValidBuildings } = require('./buildingRegistry');
  const validBuildings = await getValidBuildings();
  if (!validBuildings.has(params.building)) {
    return { valid: false, error: `Valid building is required (got '${params.building}')` };
  }

  return { valid: true };
}

/**
 * Validate transactionId is safe to use as a Firestore doc ID.
 * Firestore disallows '/', leading '.', and reserved prefixes; we additionally
 * cap length and restrict charset to defend against malformed SlipOK responses.
 * @param {unknown} txid
 * @returns {boolean}
 */
function isSafeTransactionId(txid) {
  return typeof txid === 'string' && /^[A-Za-z0-9_-]{4,200}$/.test(txid);
}

module.exports = { validateRequest, isSafeTransactionId };
