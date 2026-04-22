// Firebase Cloud Functions - Main Entry Point
// Each function initializes Firebase Admin separately

// Export all functions
exports.initializeRooms = require('./initializeRooms').initializeRooms;
exports.getRooms = require('./initializeRooms').getRooms;
exports.analyzeRoomData = require('./cleanupRoomData').analyzeRoomData;
exports.cleanupRoomData = require('./cleanupRoomData').cleanupRoomData;
exports.migrateToFirestore = require('./migrateToFirestore').migrateToFirestore;
exports.setupFirestoreIndexes = require('./migrateToFirestore').setupFirestoreIndexes;
exports.verifyMigrationComplete = require('./cleanupRealtimeDB').verifyMigrationComplete;
exports.deleteRealtimeDBData = require('./cleanupRealtimeDB').deleteRealtimeDBData;

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
  const cleanupRateLimits = require('./cleanupRateLimits');
  if (cleanupRateLimits.cleanupRateLimits) {
    exports.cleanupRateLimits = cleanupRateLimits.cleanupRateLimits;
  }
} catch (e) {
  console.log('cleanupRateLimits not found, skipping...');
}
