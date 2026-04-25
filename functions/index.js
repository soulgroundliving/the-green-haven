// Firebase Cloud Functions - Main Entry Point
// Each function initializes Firebase Admin separately

// Admin custom-claims management (Phase 4A)
exports.setAdminClaim = require('./setAdminClaim').setAdminClaim;

// Tenant LIFF → Firebase Auth UID room binding (Phase 4C)
exports.linkAuthUid = require('./linkAuthUid').linkAuthUid;

// Phone match check for LIFF auto-approve — admin SDK, never exposes raw phone (Phase 4C-2)
exports.checkTenantPhone = require('./checkTenantPhone').checkTenantPhone;

// Complaint & Gamification
exports.onComplaintCreated = require('./complaintAndGamification').onComplaintCreated;
exports.sendComplaintConfirmation = require('./complaintAndGamification').sendComplaintConfirmation;
exports.cleanupResolvedComplaints = require('./complaintAndGamification').cleanupResolvedComplaints;
exports.awardRentPaymentPoints = require('./complaintAndGamification').awardRentPaymentPoints;
exports.awardComplaintFreeMonth = require('./complaintAndGamification').awardComplaintFreeMonth;
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

// Legacy: cleanupRateLimits.js never existed — its job is now done by
// cleanupRateLimitsScheduled exported above from cleanupOldDocs.js.
// Keep the stale require() one more revision; the try/catch logs a
// harmless warning and the deploy still succeeds.
try {
  const cleanupRateLimits = require('./cleanupRateLimits');
  if (cleanupRateLimits.cleanupRateLimits) {
    exports.cleanupRateLimits = cleanupRateLimits.cleanupRateLimits;
  }
} catch (e) {
  console.log('cleanupRateLimits not found, skipping...');
}
