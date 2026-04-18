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

// App config seed (Sprint B + C — populate system/* + buildings/{X}.info defaults)
exports.seedAppConfig = require('./seedAppConfig').seedAppConfig;

// Auto-bill generation (Phase 1 automation — fires on meter_data Firestore write)
exports.generateBillsOnMeterUpdate = require('./generateBillsOnMeterUpdate').generateBillsOnMeterUpdate;

// Tax revenue aggregation (Phase 2 — scheduled monthly + on-demand HTTP)
exports.aggregateMonthlyRevenueScheduled = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenueScheduled;
exports.aggregateMonthlyRevenue = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenue;

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
