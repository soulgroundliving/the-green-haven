/**
 * _farewellPrompt.js — PURE helpers for the Farewell AI summary (Meaning Layer #16-v2).
 *
 * This module is the load-bearing PDPA guard (D-AI3 / PDPA §28 cross-border):
 * `buildFarewellPromptInput()` reduces a tenant doc to ANONYMIZED earned-stat
 * numbers + generic descriptors ONLY — never the name / room / building / phone
 * / tenantId / uid. That object is the ENTIRE payload sent to Claude (US). The
 * tenant's real name is templated back in LOCALLY by `renderWithName()` AFTER
 * the prose returns, so no PII ever crosses the border.
 *
 * Pure + dependency-free → unit-testable without any API call or Firebase. The
 * CF (composeFarewellSummary.js) imports both functions; the prompt-input
 * anonymization is asserted in __tests__/_farewellPrompt.test.js.
 *
 * §7-TT: Thai strings here are authored via the editor (UTF-8), never shell sed.
 */
'use strict';

// Placeholder the model is instructed to use for the resident's name. We swap
// the real name in locally (renderWithName) so the name is NEVER in the prompt.
const NAME_PLACEHOLDER = '{{NAME}}';

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Tenure as a coarse, anonymized descriptor (no dates — a date is a quasi-
 * identifier). Returns whole-month + year buckets only.
 * @returns {{ years:number, months:number, text:string }}
 */
function tenureFromDates(moveInMs, nowMs) {
  const a = Number(moveInMs);
  const b = Number(nowMs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0 || b < a) {
    return { years: 0, months: 0, text: 'ไม่ทราบระยะเวลา' };
  }
  const da = new Date(a);
  const db = new Date(b);
  let months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  if (db.getDate() < da.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  let text;
  if (years && rem) text = `${years} ปี ${rem} เดือน`;
  else if (years) text = `${years} ปี`;
  else if (rem) text = `${rem} เดือน`;
  else text = 'น้อยกว่า 1 เดือน';
  return { years, months, text };
}

function _toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * buildFarewellPromptInput(tenantData, nowMs) — reduce a tenant doc to an
 * ANONYMIZED, PII-free stats object. This object is the COMPLETE payload sent
 * to the model. Reads ONLY the tenant doc's own `lease` + `gamification`
 * (same source as v1 deriveFarewell) — no extra collections, no identifiers.
 *
 * @returns {{
 *   tenureText:string, tenureYears:number, tenureMonths:number,
 *   points:number, badgeCount:number, dailyStreak:number, tradesCompleted:number
 * }}
 */
function buildFarewellPromptInput(tenantData, nowMs) {
  const d = tenantData || {};
  const lease = d.lease || {};
  const g = d.gamification || {};
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const moveInMs = _toMs(lease.moveInDate) || _toMs(lease.startDate);
  const tenure = tenureFromDates(moveInMs, now);
  const badges = Array.isArray(g.badges) ? g.badges : [];

  return {
    tenureText: tenure.text,
    tenureYears: tenure.years,
    tenureMonths: tenure.months,
    points: _num(g.points),
    badgeCount: badges.length,
    dailyStreak: _num(g.dailyStreak),
    tradesCompleted: _num(g.marketplaceStats && g.marketplaceStats.tradesCompleted),
  };
}

/**
 * statsToUserContent(input) — render the anonymized stats object into the Thai
 * user-message string handed to Claude. Uses NAME_PLACEHOLDER, never a real
 * name. Pure string assembly (no model call).
 */
function statsToUserContent(input) {
  const i = input || {};
  const lines = [
    'ข้อมูลสรุป (ตัวเลขที่ผู้เช่าสะสมไว้ — ไม่มีชื่อ/ห้อง/เบอร์):',
    `- ระยะเวลาที่อยู่อาศัย: ${i.tenureText || 'ไม่ทราบ'}`,
    `- คะแนนสะสม: ${_num(i.points)}`,
    `- เหรียญตราที่ได้รับ: ${_num(i.badgeCount)}`,
  ];
  if (_num(i.dailyStreak) > 1) lines.push(`- เข้าใช้งานต่อเนื่องสูงสุด: ${_num(i.dailyStreak)} วัน`);
  if (_num(i.tradesCompleted) > 0) lines.push(`- แลกเปลี่ยน/แบ่งปันกับเพื่อนบ้าน: ${_num(i.tradesCompleted)} ครั้ง`);
  lines.push('');
  lines.push(`เขียนข้อความอำลาโดยใช้ "${NAME_PLACEHOLDER}" แทนชื่อผู้เช่า (ระบบจะแทนที่ชื่อจริงให้ภายหลัง).`);
  return lines.join('\n');
}

/**
 * renderWithName(prose, name) — templates the resident's real name back in
 * LOCALLY (after the model returns). Replaces every NAME_PLACEHOLDER; if the
 * model omitted the placeholder, returns the prose unchanged. Falls back to a
 * neutral Thai term when no name is available.
 */
function renderWithName(prose, name) {
  const text = String(prose == null ? '' : prose);
  const safe = String(name == null ? '' : name).trim() || 'คุณ';
  return text.split(NAME_PLACEHOLDER).join(safe);
}

module.exports = {
  NAME_PLACEHOLDER,
  tenureFromDates,
  buildFarewellPromptInput,
  statsToUserContent,
  renderWithName,
};
