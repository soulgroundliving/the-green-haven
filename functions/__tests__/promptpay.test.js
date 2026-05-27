/**
 * Unit tests for promptpay.js — pure PromptPay EMVCo payload builder.
 *
 * No Firebase dependencies; no Module._load stubs required.
 *
 * Run: node --test functions/__tests__/promptpay.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildPromptPayPayload, crc16 } = require('../promptpay');

// ── crc16 ─────────────────────────────────────────────────────────────────────

describe('crc16', () => {
  it('returns a 4-character uppercase hex string', () => {
    const result = crc16('hello');
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 4);
    assert.match(result, /^[0-9A-F]{4}$/);
  });

  it('empty string → returns a 4-char hex string', () => {
    const result = crc16('');
    assert.equal(typeof result, 'string');
    assert.equal(result.length, 4);
    assert.match(result, /^[0-9A-F]{4}$/);
  });

  it('is deterministic — same input produces same output', () => {
    const input = '00020101021229370016A000000677010111011300668123456785303764540710.005802TH6304';
    assert.equal(crc16(input), crc16(input));
  });

  it('different inputs produce different outputs', () => {
    assert.notEqual(crc16('A'), crc16('B'));
  });
});

// ── buildPromptPayPayload — input validation ──────────────────────────────────

describe('buildPromptPayPayload — input validation', () => {
  it('phone = undefined → throws "phone is required"', () => {
    assert.throws(
      () => buildPromptPayPayload(undefined, 1000),
      (e) => { assert.match(e.message, /phone is required/); return true; },
    );
  });

  it('phone = "" (empty string) → throws "phone is required"', () => {
    assert.throws(
      () => buildPromptPayPayload('', 1000),
      (e) => { assert.match(e.message, /phone is required/); return true; },
    );
  });

  it('phone = 123 (number) → throws "phone is required"', () => {
    assert.throws(
      () => buildPromptPayPayload(123, 1000),
      (e) => { assert.match(e.message, /phone is required/); return true; },
    );
  });

  it('amount = "1000" (string) → throws "amount must be a positive number"', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345678', '1000'),
      (e) => { assert.match(e.message, /amount must be a positive number/); return true; },
    );
  });

  it('amount = 0 → throws "amount must be a positive number"', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345678', 0),
      (e) => { assert.match(e.message, /amount must be a positive number/); return true; },
    );
  });

  it('amount = -100 → throws "amount must be a positive number"', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345678', -100),
      (e) => { assert.match(e.message, /amount must be a positive number/); return true; },
    );
  });

  it('amount = Infinity → throws "amount must be a positive number"', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345678', Infinity),
      (e) => { assert.match(e.message, /amount must be a positive number/); return true; },
    );
  });

  it('amount = NaN → throws "amount must be a positive number"', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345678', NaN),
      (e) => { assert.match(e.message, /amount must be a positive number/); return true; },
    );
  });

  it('phone with only 7 digits after strip (e.g. "081-234") → throws "phone too short"', () => {
    assert.throws(
      () => buildPromptPayPayload('081-234', 1000),
      (e) => { assert.match(e.message, /phone too short/); return true; },
    );
  });

  it('phone with exactly 7 digits "0812345" → throws "phone too short" (< 9)', () => {
    assert.throws(
      () => buildPromptPayPayload('0812345', 1000),
      (e) => { assert.match(e.message, /phone too short/); return true; },
    );
  });

  it('phone with exactly 9 digits "081234567" → does NOT throw', () => {
    assert.doesNotThrow(() => buildPromptPayPayload('081234567', 1000));
  });
});

// ── buildPromptPayPayload — format ────────────────────────────────────────────

describe('buildPromptPayPayload — format', () => {
  it('valid call returns a string ending in a 4-char uppercase hex CRC suffix', () => {
    const result = buildPromptPayPayload('0812345678', 1000);
    assert.equal(typeof result, 'string');
    assert.match(result.slice(-4), /^[0-9A-F]{4}$/);
  });

  it('payload includes "5802TH" (country code)', () => {
    const result = buildPromptPayPayload('0812345678', 1000);
    assert.ok(result.includes('5802TH'), `Expected "5802TH" in payload: ${result}`);
  });

  it('payload includes "5303764" (currency THB)', () => {
    const result = buildPromptPayPayload('0812345678', 1000);
    assert.ok(result.includes('5303764'), `Expected "5303764" in payload: ${result}`);
  });

  it('phone with dashes "081-234-5678" produces same result as "0812345678"', () => {
    const withDashes = buildPromptPayPayload('081-234-5678', 500);
    const plain = buildPromptPayPayload('0812345678', 500);
    assert.equal(withDashes, plain);
  });

  it('phone starting with "0" is converted to "0066" prefix in the mobile field', () => {
    const result = buildPromptPayPayload('0812345678', 1000);
    // Mobile becomes '006681234 5678'; the payload encodes this inside merchant field
    assert.ok(result.includes('006681234'), `Expected "0066812345678" segment in payload: ${result}`);
  });

  it('phone not starting with "0" (e.g. "66812345678") is used as-is — payload contains the raw digits without extra 0066', () => {
    const result = buildPromptPayPayload('66812345678', 1000);
    // mobile = '66812345678' (no 0066 prefix added), distinct from '0812345678' → '0066812345678'
    assert.ok(result.includes('66812345678'), `Expected "66812345678" in payload: ${result}`);
    // Should NOT contain 006666812345678 (double-prefixed)
    assert.ok(!result.includes('006666812345678'), `Payload must not double-prepend 0066: ${result}`);
  });

  it('amount 1000 → payload includes "1000.00"', () => {
    const result = buildPromptPayPayload('0812345678', 1000);
    assert.ok(result.includes('1000.00'), `Expected "1000.00" in payload: ${result}`);
  });

  it('amount 1500.50 → payload includes "1500.50"', () => {
    const result = buildPromptPayPayload('0812345678', 1500.50);
    assert.ok(result.includes('1500.50'), `Expected "1500.50" in payload: ${result}`);
  });

  it('returned string passes its own CRC check — last 4 chars equal crc16 of everything before', () => {
    const payload = buildPromptPayPayload('0812345678', 1000);
    const body = payload.slice(0, -4);
    const checksum = payload.slice(-4);
    assert.equal(checksum, crc16(body));
  });
});
