/**
 * PromptPay payload builder — server-side mirror of tenant_app.html:9533.
 *
 * Generated server-side inside createBookingLock so the deposit QR is bound
 * to the booking doc at lock time. Mirrors the existing client implementation
 * exactly (same EMVCo tags, same CRC16-CCITT polynomial) so receipts produced
 * by either path are interchangeable.
 *
 * Spec reference: EMVCo MPM v1.0 + ThaiBP / BoT PromptPay extensions.
 */

function crc16(str) {
  let crc = 0xFFFF;
  for (const c of str) {
    crc ^= c.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * @param {string} phone — Thai mobile, accepts dashed/spaced/0-prefixed
 * @param {number} amount — THB
 * @returns {string} EMV-encoded PromptPay payload (encode as QR text)
 */
function buildPromptPayPayload(phone, amount) {
  if (typeof phone !== 'string' || !phone) {
    throw new Error('phone is required');
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('amount must be a positive number');
  }
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 9) {
    throw new Error('phone too short — expected Thai mobile');
  }
  const mobile = clean.startsWith('0') ? '0066' + clean.slice(1) : clean;
  const f = (id, v) => id + v.length.toString().padStart(2, '0') + v;
  const acc = f('00', '0066') + f('01', mobile);
  const merchant = f('00', 'A000000677010111') + f('01', acc);
  const payload = f('00', '01')
    + f('01', '12')
    + f('29', merchant)
    + '5303764'
    + f('54', amount.toFixed(2))
    + '5802TH'
    + '6304';
  return payload + crc16(payload);
}

module.exports = { buildPromptPayPayload, crc16 };
