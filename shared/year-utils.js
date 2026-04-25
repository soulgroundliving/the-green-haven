/**
 * year-utils.js — SSoT for Thai year (BE/พ.ศ.) ↔ Common Era (CE/ค.ศ.) conversion.
 *
 * Why a helper:
 *   Excel uploads from owner use Thai year — sometimes 2-digit ("บิลปี 69" = BE 2569
 *   = CE 2026), sometimes 4-digit (2569). RTDB bills + Firestore meterReadings end
 *   up with a mix of those plus 4-digit CE (2026) from code that already normalized.
 *   Before this helper, 4 different threshold patterns were spread across 9+ sites,
 *   none of which handled all three input forms safely.
 *
 * Disambiguation rules:
 *   - 2-digit (1–99)        → BE (e.g. 69 → 2026 CE)
 *   - 4-digit, n >= 2400    → BE (BE 2400 = CE 1857; no one bills for 1857)
 *   - 4-digit, 100 <= n < 2400 → CE (already normalized)
 *
 * Valid until BE 2599 / CE 2056 (~30 years out).
 */
(function () {
  const YearUtils = {
    /** any → 4-digit CE (number), or null on bad input. */
    toCE(raw) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (n >= 2400) return n - 543;     // 4-digit BE
      if (n >= 100)  return n;            // 4-digit CE
      return 2500 + n - 543;              // 2-digit BE (e.g. 69 → 2026)
    },
    /** any → 4-digit BE (number), or null on bad input. */
    toBE(raw) {
      const ce = YearUtils.toCE(raw);
      return ce == null ? null : ce + 543;
    }
  };

  if (typeof window !== 'undefined') window.YearUtils = YearUtils;
  if (typeof module !== 'undefined' && module.exports) module.exports = YearUtils;
})();
