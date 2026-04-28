// Firebase Cloud Functions - Main Entry Point
// Each function initializes Firebase Admin separately

// Admin custom-claims management (Phase 4A)
exports.setAdminClaim = require('./setAdminClaim').setAdminClaim;

// Bulk-delete legacy anonymous user records (run after disabling Anonymous
// sign-in at Firebase Console — otherwise tenants regenerate them).
exports.cleanupAnonymousUsers = require('./cleanupAnonymousUsers').cleanupAnonymousUsers;

// One-shot migration: rewrite legacy bills whose `building` field is the
// display name back to canonical 'rooms'/'nest'. Dry-run by default; pass
// ?apply=1 to commit. Admin-only.
exports.fixLegacyBillBuilding = require('./fixLegacyBillBuilding').fixLegacyBillBuilding;

// LIFF ID token → Firebase custom token (replaces anonymous-auth dependency)
// Replaced legacy linkAuthUid (removed 2026-04-28: had cross-tenant hijack —
// caller could pass any approved lineUserId and get that room's claims).
exports.liffSignIn = require('./liffSignIn').liffSignIn;

// Phone match check for LIFF auto-approve — admin SDK, never exposes raw phone (Phase 4C-2)
exports.checkTenantPhone = require('./checkTenantPhone').checkTenantPhone;

// App-level rate-limit gate before client SDK signInWithPhoneNumber (3/hr per UID + per phone)
exports.requestPhoneOtp = require('./requestPhoneOtp').requestPhoneOtp;

// Server-side write of OTP-verified phone — bypasses client auth-state pitfalls
// (token-refresh 403s after linkWithCredential, broken anon-UID lineage, etc.)
exports.setVerifiedPhone = require('./setVerifiedPhone').setVerifiedPhone;

// Server-side email save: updates Firebase Auth email + Firestore tenant doc so
// client can call sendEmailVerification() without needing a password credential.
exports.setTenantEmail = require('./setTenantEmail').setTenantEmail;

// One-off (idempotent) consolidation: merge tenant + lease data from 4 split paths
// into single SSoT at tenants/{building}/list/{roomId}. Admin-only. Dry-run by default.
exports.migrateTenantsToSSoT = require('./migrateTenantsToSSoT').migrateTenantsToSSoT;

// Phase 6 cleanup: drop top-level dupes in tenants/{b}/list/{r}, delete legacy
// tenants/{b}/list/TENANT_* docs, drop .tenant/.lease/.operations from
// buildings/{alias}/rooms/{r}. Admin-only. Dry-run by default.
exports.cleanupTenantsSSoT = require('./cleanupTenantsSSoT').cleanupTenantsSSoT;

// Complaint & Gamification
exports.onComplaintCreated = require('./complaintAndGamification').onComplaintCreated;
exports.sendComplaintConfirmation = require('./complaintAndGamification').sendComplaintConfirmation;
exports.cleanupResolvedComplaints = require('./complaintAndGamification').cleanupResolvedComplaints;
exports.awardRentPaymentPoints = require('./complaintAndGamification').awardRentPaymentPoints;
exports.awardComplaintFreeMonth = require('./complaintAndGamification').awardComplaintFreeMonth;
// Admin-only manual trigger / dry-run wrapper for the same logic.
exports.awardComplaintFreeMonthManual = require('./complaintAndGamification').awardComplaintFreeMonthManual;
exports.checkAndAwardBadges = require('./complaintAndGamification').checkAndAwardBadges;
exports.calculateTenantRank = require('./complaintAndGamification').calculateTenantRank;
exports.getLeaderboard = require('./complaintAndGamification').getLeaderboard;

// Rewards (Phase A.2 — Firestore-managed reward catalog)
exports.seedRewards = require('./seedRewards').seedRewards;
exports.redeemReward = require('./redeemReward').redeemReward;

// Daily login check-in (1 pt/day + streak bonus every 7 days)
exports.claimDailyLoginPoints = require('./claimDailyLoginPoints').claimDailyLoginPoints;

// App config seed (Sprint B + C — populate system/* + buildings/{X}.info defaults)
exports.seedAppConfig = require('./seedAppConfig').seedAppConfig;

// Auto-bill generation (Phase 1 automation — fires on meter_data Firestore write)
exports.generateBillsOnMeterUpdate = require('./generateBillsOnMeterUpdate').generateBillsOnMeterUpdate;

// LINE Flex notification to tenant when new bill appears in RTDB
exports.notifyBillOnCreate = require('./notifyBillOnCreate').notifyBillOnCreate;

// IQAir AirVisual proxy with 1-hour Firestore cache (key stays server-side,
// frontend never sees it). Hybrid: IQAir for AQI + main pollutant code,
// Open-Meteo for μg/m³ concentration (Community tier doesn't provide it).
exports.getAirQuality = require('./getAirQuality').getAirQuality;

// WAQI station-level alternative (free, registers Thai PCD government sensors).
// Tracks the official iqair.com Sai Mai page closer than IQAir's city aggregate.
// Same payload shape as getAirQuality so frontend can swap callable name only.
exports.getAirQualityWAQI = require('./getAirQualityWAQI').getAirQualityWAQI;

// Tax revenue aggregation (Phase 2 — scheduled monthly + on-demand HTTP)
exports.aggregateMonthlyRevenueScheduled = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenueScheduled;
exports.aggregateMonthlyRevenue = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenue;

// Slip log archive to BigQuery — daily 02:00 BKK; HTTP endpoint for manual trigger
exports.archiveSlipLogsScheduled = require('./archiveSlipLogs').archiveSlipLogsScheduled;
exports.archiveSlipLogs = require('./archiveSlipLogs').archiveSlipLogs;

// Late-payment LINE reminders — daily 09:00 BKK; HTTP endpoint for manual trigger
exports.remindLatePaymentsScheduled = require('./remindLatePayments').remindLatePaymentsScheduled;
exports.remindLatePayments = require('./remindLatePayments').remindLatePayments;

// Lease-expiry LINE alerts (tiered 60/30/14/0 days) — daily 08:00 BKK; HTTP for manual
exports.remindLeaseExpiryScheduled = require('./remindLeaseExpiry').remindLeaseExpiryScheduled;
exports.remindLeaseExpiry = require('./remindLeaseExpiry').remindLeaseExpiry;

// Firestore disaster-recovery backup — daily 03:00 BKK, 30-day rolling retention
exports.backupFirestoreScheduled = require('./backupFirestore').backupFirestoreScheduled;
exports.backupFirestore = require('./backupFirestore').backupFirestore;

// Scheduled cleanup of three collections that would otherwise grow forever:
//   rateLimits (daily 04:00), maintenance RTDB (daily 04:10), liffUsers
//   rejected (Sunday 04:20). Single HTTP endpoint runs all three for testing.
exports.cleanupRateLimitsScheduled = require('./cleanupOldDocs').cleanupRateLimitsScheduled;
exports.cleanupMaintenanceRTDBScheduled = require('./cleanupOldDocs').cleanupMaintenanceRTDBScheduled;
exports.cleanupLiffUsersRejectedScheduled = require('./cleanupOldDocs').cleanupLiffUsersRejectedScheduled;
exports.cleanupOldDocs = require('./cleanupOldDocs').cleanupOldDocs;

// Drains lineRetryQueue every 15 min — surfaces transient LINE push
// failures (5xx, network blips, rate limits) into Firestore so they don't
// silently disappear like before.
exports.processLineRetryQueue = require('./lineRetryQueue').processLineRetryQueue;

// Import existing functions if available
try {
  const verifySlip = require('./verifySlip');
  if (verifySlip.verifySlip) {
    exports.verifySlip = verifySlip.verifySlip;
  }
} catch (e) {
  console.log('verifySlip not found, skipping...');
}

try {
  const notifyLiff = require('./notifyLiffRequest');
  if (notifyLiff.notifyLiffRequest) {
    exports.notifyLiffRequest = notifyLiff.notifyLiffRequest;
  }
} catch (e) {
  console.log('notifyLiffRequest not found, skipping...');
}

try {
  const notifyLiffStatus = require('./notifyLiffStatusChange');
  if (notifyLiffStatus.notifyLiffStatusChange) {
    exports.notifyLiffStatusChange = notifyLiffStatus.notifyLiffStatusChange;
  }
} catch (e) {
  console.log('notifyLiffStatusChange not found, skipping...');
}
