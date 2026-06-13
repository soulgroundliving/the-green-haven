// Firebase Cloud Functions — Main Entry Point
// 86 CFs organized by domain. Physical files are flat in functions/ so test
// require('../X') paths stay stable. See functions/STRUCTURE.md for the map.

// ═══════════════════════════════════════════════════════════════════════════
// AUTH — LIFF sign-in, custom claims, identity linking
// ═══════════════════════════════════════════════════════════════════════════

// Admin custom-claims management (Phase 4A)
exports.setAdminClaim = require('./setAdminClaim').setAdminClaim;

// Grant / revoke per-building manager claims (Tier 3c — SaaS prep)
exports.grantBuildingManager = require('./grantBuildingManager').grantBuildingManager;

// LIFF ID token → Firebase custom token (replaces anonymous-auth dependency)
// Replaced legacy linkAuthUid (removed 2026-04-28: had cross-tenant hijack —
// caller could pass any approved lineUserId and get that room's claims).
exports.liffSignIn = require('./liffSignIn').liffSignIn;

// Admin-only soft-unlink of an approved LINE link. Atomic batch clears
// linkedAuthUid from tenant + people docs so tenant_app stops treating the
// LINE user as still-linked. Keeps liffUsers doc for audit trail.
exports.unlinkLiffUser = require('./unlinkLiffUser').unlinkLiffUser;

// Community-member (post-unlink) in-app path to request a fresh room link.
// HTTPS endpoint, LIFF idToken as sole credential (mirror liffSignIn).
exports.requestRoomRelink = require('./requestRoomRelink').requestRoomRelink;

// Admin-only direct LINE link for F2 scenario: tenant lost LINE access entirely.
// Pre-creates liffUsers/{newLineUserId} status='approved' with RTDB audit log.
// See lifecycle_tenant_transitions.md §F2.
exports.adminApprovedLink = require('./adminApprovedLink').adminApprovedLink;

// Phone match check for LIFF auto-approve — admin SDK, never exposes raw phone (Phase 4C-2)
exports.checkTenantPhone = require('./checkTenantPhone').checkTenantPhone;

// App-level rate-limit gate before client SDK signInWithPhoneNumber (3/hr per UID + per phone)
exports.requestPhoneOtp = require('./requestPhoneOtp').requestPhoneOtp;

// Server-side write of OTP-verified phone — bypasses client auth-state pitfalls
exports.setVerifiedPhone = require('./setVerifiedPhone').setVerifiedPhone;

// Server-side email save: updates Firebase Auth email + Firestore tenant doc
exports.setTenantEmail = require('./setTenantEmail').setTenantEmail;

// ═══════════════════════════════════════════════════════════════════════════
// BOOKING — LIFF prospect → deposit-paid booking → admin convert to tenant
// Separate auth namespace from liffSignIn (uid prefix "book:" vs "line:") so
// a tenant can sign into both tenant_app.html and booking.html on the same
// device without clobbering each other's claims.
// ═══════════════════════════════════════════════════════════════════════════

// Mints custom token with role:'prospect' claim — gates createBookingLock.
exports.liffBookingSignIn = require('./liffBookingSignIn').liffBookingSignIn;
// Atomic Firestore transaction that prevents two prospects from locking the
// same room simultaneously. Generates server-side PromptPay deposit QR.
exports.createBookingLock = require('./createBookingLock').createBookingLock;
// Aggregates occupied rooms + active bookings without leaking tenant PII.
exports.getRoomAvailability = require('./getRoomAvailability').getRoomAvailability;
// Scheduled every 5 min: flips abandoned status='locked' bookings to 'expired'.
exports.expireBookingLocks = require('./expireBookingLocks').expireBookingLocks;
// SlipOK-backed deposit verification. Atomic dedup via verifiedSlips/{txid}.create().
exports.verifyBookingSlip = require('./verifyBookingSlip').verifyBookingSlip;
// Admin-only conversion of paid booking → real tenant doc + liffUsers approval.
exports.convertBookingToTenant = require('./convertBookingToTenant').convertBookingToTenant;
// Server-verified KYC submission — confirms idCardFront + idCardBack exist in Storage.
exports.submitBookingKyc = require('./submitBookingKyc').submitBookingKyc;

// ═══════════════════════════════════════════════════════════════════════════
// TENANT LIFECYCLE — move-out, transfer, transitions, pet management
// ═══════════════════════════════════════════════════════════════════════════

// Admin-only archive of a tenant on move-out — preserves identity + history.
exports.archiveTenantOnMoveOut = require('./archiveTenantOnMoveOut').archiveTenantOnMoveOut;
// Admin-only single-pet delete (Firestore doc + Storage files).
exports.deletePetMedia = require('./deletePetMedia').deletePetMedia;
// Transition active tenant to community-member (player) — archives contract, creates people/{tenantId} doc.
exports.transitionToPlayer = require('./transitionToPlayer').transitionToPlayer;
// Undo a mistaken transitionToPlayer — restores tenant from archive, revokes player claim.
exports.revertTransitionToPlayer = require('./revertTransitionToPlayer').revertTransitionToPlayer;

// ═══════════════════════════════════════════════════════════════════════════
// LEASE — renewals, transfers, expiry reminders, doc access
// ═══════════════════════════════════════════════════════════════════════════

// Admin-only lease renewal/extension. Two modes: 'renewal' (novation) or 'extension' (variation).
exports.renewLease = require('./renewLease').renewLease;

// Admin-only tenant transfer between rooms. Two modes: 'variation' (DEFAULT) or 'novation'.
// Re-mints Auth claims (setCustomUserClaims + revokeRefreshTokens) per §7-FF.
exports.transferTenant = require('./transferTenant').transferTenant;

// Late-payment LINE reminders — daily 09:00 BKK; HTTP endpoint for manual trigger
exports.remindLatePaymentsScheduled = require('./remindLatePayments').remindLatePaymentsScheduled;
exports.remindLatePayments = require('./remindLatePayments').remindLatePayments;

// Lease-expiry LINE alerts (tiered 60/30/14/0 days) — daily 08:00 BKK; HTTP for manual
exports.remindLeaseExpiryScheduled = require('./remindLeaseExpiry').remindLeaseExpiryScheduled;
exports.remindLeaseExpiry = require('./remindLeaseExpiry').remindLeaseExpiry;

// Issue a 1-hour signed URL for a tenant's lease contract PDF (PDPA-friendly).
exports.getLeaseDocUrl = require('./getLeaseDocUrl').getLeaseDocUrl;

// ═══════════════════════════════════════════════════════════════════════════
// BILLING — meter upload, bill generation, payment verification, late reminders
// ═══════════════════════════════════════════════════════════════════════════

// Auto-bill generation (Phase 1 automation — fires on meter_data Firestore write).
// NOTE: FROZEN Gen1 Firestore trigger — do NOT edit or redeploy. See memory/generate_bills_cf_frozen.md.
exports.generateBillsOnMeterUpdate = require('./generateBillsOnMeterUpdate').generateBillsOnMeterUpdate;

// Secure SlipOK payment verification with atomic duplicate detection, RTDB bill mark,
// gamification award (Nest only), receipt notification, and rate limiting.
// verifySlip.js (~450 ln) + _verifySlipValidate.js + _verifySlipWrite.js (extracted helpers).
try {
  const verifySlip = require('./verifySlip');
  if (verifySlip.verifySlip) {
    exports.verifySlip = verifySlip.verifySlip;
  }
} catch (e) {
  // optional module
}

// LINE Flex notification to tenant when new bill appears in RTDB (secondary path).
exports.notifyBillOnCreate = require('./notifyBillOnCreate').notifyBillOnCreate;

// LINE Flex notification on meter upload — primary path. HTTPS callable (not trigger)
// so it avoids the SE3 Eventarc restriction (§7-NN).
exports.notifyTenantOnMeterUpload = require('./notifyTenantOnMeterUpload').notifyTenantOnMeterUpload;

// Admin-only: LINE push to tenant when maintenance ticket status changes.
exports.notifyMaintenanceTenant = require('./notifyMaintenanceTenant').notifyMaintenanceTenant;

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE — classifieds + privacy-first 1:1 chat
// ═══════════════════════════════════════════════════════════════════════════

// Clears every chat + messages sub-collection when a post is deleted or COMPLETED.
// Fires only on deleteMarketItem; close=pause (chats preserved) per Sprint 7.
exports.cleanupMarketplaceChat = require('./cleanupMarketplaceChat').cleanupMarketplaceChat;

// LINE OA push on new message. Anti-spam throttle + retry-queue handoff.
exports.notifyMarketplaceChat = require('./notifyMarketplaceChat').notifyMarketplaceChat;

// Sender-only "recall" within 24h window — LINE-parity UX.
exports.unsendMarketplaceMessage = require('./unsendMarketplaceMessage').unsendMarketplaceMessage;

// One-sided "delete" — writes hiddenBy.{callerUid}; counterparty untouched.
exports.hideMarketplaceChat = require('./hideMarketplaceChat').hideMarketplaceChat;

// Sprint 6 Trophies: bumps per-owner counters + evaluates 3 event-based badges.
// HTTPS callable (not Firestore trigger) per §7-NN. Client invokes after COMPLETED write.
exports.marketplaceStatsAggregator = require('./marketplaceStatsAggregator').marketplaceStatsAggregator;

// ═══════════════════════════════════════════════════════════════════════════
// GAMIFICATION — points, rewards, badges, leaderboard
// ═══════════════════════════════════════════════════════════════════════════

// Complaint-free month award + cleanup (scheduled + manual).
exports.cleanupResolvedComplaints       = require('./complaintAndGamification').cleanupResolvedComplaints;
exports.awardComplaintFreeMonth         = require('./complaintAndGamification').awardComplaintFreeMonth;
exports.awardComplaintFreeMonthManual   = require('./complaintAndGamification').awardComplaintFreeMonthManual;
exports.checkAndAwardBadges             = require('./complaintAndGamification').checkAndAwardBadges;
exports.calculateTenantRank             = require('./complaintAndGamification').calculateTenantRank;
exports.getLeaderboard                  = require('./complaintAndGamification').getLeaderboard;

// Firestore-managed reward catalog — atomic transaction, rate-limited 5/24h.
exports.redeemReward = require('./redeemReward').redeemReward;

// Daily login check-in (1 pt/day + streak bonus every 7 days).
exports.claimDailyLoginPoints = require('./claimDailyLoginPoints').claimDailyLoginPoints;

// Server-graded quiz claims — closes Session A client-side localStorage gap.
exports.claimWellnessQuizPoints  = require('./claimWellnessQuizPoints').claimWellnessQuizPoints;
exports.claimContractQuizPoints  = require('./claimContractQuizPoints').claimContractQuizPoints;

// Community Quests (Meaning Layer #1) — daily tap-to-claim checklist. claimQuest
// routes on the quest's verifyMode (self / auto re-verify / admin-pending);
// reviewQuestClaim is the admin approve/reject of pending admin-mode claims.
// pointsLedger source:'quest' feeds the future #6 Kindness score. §7-NN callables.
exports.claimQuest       = require('./claimQuest').claimQuest;
exports.reviewQuestClaim = require('./reviewQuestClaim').reviewQuestClaim;

// Helper-request lifecycle (Meaning Layer #2) — neighbor posts a help request,
// another tenant accepts, the requester confirms-done + rates, the helper earns
// peer-confirmed kindness points (pointsLedger source:'help_completed', feeds the
// future #6 Kindness + #7 Verified Helper). ONE callable per transition. §7-NN
// callables (Eventarc can't watch SE3 Firestore); accept/complete reuse the
// existing LINE_CHANNEL_ACCESS_TOKEN secret for the requester/helper push (§7-WW).
exports.postHelpRequest     = require('./postHelpRequest').postHelpRequest;
exports.acceptHelpRequest   = require('./acceptHelpRequest').acceptHelpRequest;
exports.completeHelpRequest = require('./completeHelpRequest').completeHelpRequest;
exports.cancelHelpRequest   = require('./cancelHelpRequest').cancelHelpRequest;

// Community requests board (Meaning Layer #3) — the micro-economy sibling of the
// Helper board: a tenant asks to borrow/be-given an ITEM, a neighbour offers it,
// the requester confirms received. open→offered→fulfilled (+cancelled), ONE
// callable per transition. Awards NO points (deliberately outside #6 Kindness —
// no farm surface). §7-NN callables; offer/fulfill reuse the existing
// LINE_CHANNEL_ACCESS_TOKEN secret for the requester/offerer push (§7-WW).
exports.postCommunityRequest    = require('./postCommunityRequest').postCommunityRequest;
exports.offerCommunityRequest   = require('./offerCommunityRequest').offerCommunityRequest;
exports.fulfillCommunityRequest = require('./fulfillCommunityRequest').fulfillCommunityRequest;
exports.cancelCommunityRequest  = require('./cancelCommunityRequest').cancelCommunityRequest;

// Food sharing feed (Meaning Layer #4) — a tenant shares leftover food, a neighbour
// claims it, the SHARER earns peer-confirmed kindness points on claim
// (pointsLedger source:'food_share', feeds #6 Kindness; capped per day, anti-farm).
// Ephemeral: every share has an expiresAt; cleanupFoodSharesScheduled sweeps the
// expired ones (§7-NN scheduled, not a trigger). claimFood reuses the existing
// LINE_CHANNEL_ACCESS_TOKEN secret for the sharer push (§7-WW).
exports.shareFood                  = require('./shareFood').shareFood;
exports.claimFood                  = require('./claimFood').claimFood;
exports.cancelFood                 = require('./cancelFood').cancelFood;
exports.cleanupFoodSharesScheduled = require('./cleanupFoodSharesScheduled').cleanupFoodSharesScheduled;
exports.cleanupFoodSharesManual    = require('./cleanupFoodSharesScheduled').cleanupFoodSharesManual;

// Pet Social Graph (Meaning Layer #10) — the Pet-pillar shared primitive. A tenant
// opts a pet into a building-visible directory (petProfiles/{petId}, CF-written
// safe fields only — health/vaccine never leak), neighbours browse and send pet↔pet
// friend requests (petLinks/{linkId}, open→accepted/declined). Awards NO points
// (social-only, like #3). ONE callable per transition (§7-NN); request/respond reuse
// the existing LINE_CHANNEL_ACCESS_TOKEN secret for the friend-request push (§7-WW).
exports.upsertPetProfile = require('./upsertPetProfile').upsertPetProfile;
exports.requestPetLink   = require('./requestPetLink').requestPetLink;
exports.respondPetLink   = require('./respondPetLink').respondPetLink;
exports.removePetLink    = require('./removePetLink').removePetLink;

// Immutable admin-action audit trail (Core Readiness Phase 1.1). Client-side admin
// mutations call this after the write; in-tx CF actions log via _actionAudit directly.
exports.recordAdminAction = require('./recordAdminAction').recordAdminAction;

// Gapless RECEIPT number for MANUAL (cash) payments (Roadmap 1.2a, PR 1.2a-2).
// The client calls this after marking a bill paid by hand; slips mint their number
// inside the verifySlip tx. Shares the _receiptCounter gapless sequence.
exports.assignReceiptNumber = require('./assignReceiptNumber').assignReceiptNumber;

// Void an issued invoice WITHOUT deleting it (Roadmap 1.3). Flips invoices/{key} to
// status:'void' + voidedAt/By/Reason and writes a BILL_VOIDED row to actionAudit in
// the same tx. Admin-gated. Issuance numbers live on invoices/ (Roadmap 1.2).
exports.voidInvoice = require('./voidInvoice').voidInvoice;

// Refund a PAID bill WITHOUT deleting it (Roadmap Phase 2). Flips the RTDB
// bills/{b}/{r}/{billId} to status:'refunded' + refundedAt/By/Reason and writes a
// BILL_REFUNDED row to actionAudit. Audit-FIRST then RTDB flip (a reduced revenue
// must never be untraceable); idempotent via a deterministic audit key. Admin-gated.
exports.refundBill = require('./refundBill').refundBill;

// Admin-only server-side MANUAL payment record (cash / bank-statement override) → writes
// verifiedSlips/{docId} with a dedup guard + audit. Replaces 2 client-side setDoc paths so
// verifiedSlips can become CF-only-write. See tasks/todo-verifiedslips-cf-only.md.
exports.recordManualPayment = require('./recordManualPayment').recordManualPayment;
// Admin-only server-side reset of a room+month's verifiedSlips (deletes manual+SlipOK docs)
// with a PAYMENT_RESET audit row. Replaces the client-side _deleteVerifiedSlipsForRoomMonth.
exports.clearRoomPaymentSlips = require('./clearRoomPaymentSlips').clearRoomPaymentSlips;

// (verifyRefundSlip removed 2026-06-05: SlipOK verifies INCOMING payments to the
// registered account; a deposit refund is an OUTGOING transfer from any bank, so
// it can't be SlipOK-verified. The refund slip is still uploaded + kept as evidence.
// The deployed CF is deleted via `firebase functions:delete verifyRefundSlip`.)

// ═══════════════════════════════════════════════════════════════════════════
// TRUST SYSTEM — Reputation score (Roadmap Phase 3.2a v1, admin-only)
// ═══════════════════════════════════════════════════════════════════════════

// Server-computed, tamper-proof reputation (0–100) per active tenant from payment
// punctuality + lease tenure + complaint-free record → write-locked trustScores/.
// Daily sweep (05:40 BKK) + admin on-demand recompute. §7-NN: callable, not a
// Firestore trigger (project Firestore is SE3). Trust ≠ spendable points (§6).
exports.computeTrustScoresScheduled = require('./computeTrustScoresScheduled').computeTrustScoresScheduled;
exports.recomputeTrustScores        = require('./recomputeTrustScores').recomputeTrustScores;

// ═══════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS — unified notice/event/banner (C4 — replaces broadcastMessages)
// ═══════════════════════════════════════════════════════════════════════════

// Writes to announcements/{auto} with type discriminator + unified audience.
exports.publishAnnouncement = require('./publishAnnouncement').publishAnnouncement;
exports.updateAnnouncement  = require('./updateAnnouncement').updateAnnouncement;
exports.deleteAnnouncement  = require('./deleteAnnouncement').deleteAnnouncement;

// ═══════════════════════════════════════════════════════════════════════════
// PDPA — checklist lifecycle, consent ledger, data subject rights
// ═══════════════════════════════════════════════════════════════════════════

// Move-In/Out Checklist (Tier 3I): template → instance → fill → co-sign → PNG → delete
exports.createChecklistInstance = require('./createChecklistInstance').createChecklistInstance;
exports.submitChecklist          = require('./submitChecklist').submitChecklist;
exports.adminSignChecklist       = require('./adminSignChecklist').adminSignChecklist;
exports.deleteChecklistInstance  = require('./deleteChecklistInstance').deleteChecklistInstance;

// PDPA retention sweep: signed >2yr OR orphan >5yr. Schedule: daily 03:05 BKK.
exports.cleanupChecklistsScheduled = require('./cleanupChecklistsScheduled').cleanupChecklistsScheduled;
exports.cleanupChecklistsManual    = require('./cleanupChecklistsScheduled').cleanupChecklistsManual;

// Issue 1-hour signed URL for checklist item photo / tenant / admin signature.
exports.getChecklistMediaUrl = require('./getChecklistMediaUrl').getChecklistMediaUrl;

// PDPA §19: record tenant consent for checklist data processing.
exports.recordChecklistConsent = require('./recordChecklistConsent').recordChecklistConsent;

// PDPA §30 (DSR): tenant downloads JSON of all their data.
exports.exportMyData = require('./exportMyData').exportMyData;

// PDPA §32 (DSR): tenant requests erasure. Active tenants refused; only players proceed.
// Retains bills/leases/BigQuery audit per §32(2)(b)/(c)/(e) carve-outs.
exports.requestDataDeletion = require('./requestDataDeletion').requestDataDeletion;

// Prunes people/{tenantId} docs older than 1 year (grace-period expiry for former tenants).
exports.cleanupPlayersOver1YearScheduled = require('./cleanupPlayersOver1Year').cleanupPlayersOver1YearScheduled;

// ═══════════════════════════════════════════════════════════════════════════
// FACILITY BOOKINGS — parking, laundry, rooftop (Tier 3G)
// ═══════════════════════════════════════════════════════════════════════════

exports.createFacilityBooking = require('./createFacilityBooking').createFacilityBooking;
exports.cancelFacilityBooking = require('./cancelFacilityBooking').cancelFacilityBooking;

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS + ARCHIVING — tax aggregation, BigQuery exports
// ═══════════════════════════════════════════════════════════════════════════

// Tax revenue aggregation (Phase 2 — scheduled monthly + on-demand HTTP)
exports.aggregateMonthlyRevenueScheduled = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenueScheduled;
exports.aggregateMonthlyRevenue          = require('./aggregateMonthlyRevenue').aggregateMonthlyRevenue;

// Slip log archive to BigQuery — daily 02:00 BKK; HTTP endpoint for manual trigger
exports.archiveSlipLogsScheduled = require('./archiveSlipLogs').archiveSlipLogsScheduled;
exports.archiveSlipLogs          = require('./archiveSlipLogs').archiveSlipLogs;

// auth_events archive to BigQuery — daily 02:30 BKK; tamper-resistant audit copy
exports.archiveAuthEventsScheduled = require('./archiveAuthEvents').archiveAuthEventsScheduled;
exports.archiveAuthEvents          = require('./archiveAuthEvents').archiveAuthEvents;

// ═══════════════════════════════════════════════════════════════════════════
// INFRASTRUCTURE + UTILITY — scheduled cleanup, keep-warm, external APIs
// ═══════════════════════════════════════════════════════════════════════════

// Keep liffSignIn + liffBookingSignIn warm — scheduled ping every 5 min
exports.keepLiffWarm = require('./keepLiffWarm').keepLiffWarm;

// Bulk-delete legacy anonymous user records (run after disabling Anonymous sign-in).
exports.cleanupAnonymousUsers = require('./cleanupAnonymousUsers').cleanupAnonymousUsers;

// Firestore disaster-recovery backup — daily 03:00 BKK, 30-day rolling retention
exports.backupFirestoreScheduled = require('./backupFirestore').backupFirestoreScheduled;
exports.backupFirestore          = require('./backupFirestore').backupFirestore;

// Scheduled cleanup of collections that would otherwise grow forever:
//   rateLimits (daily 04:00), maintenance RTDB (daily 04:10), liffUsers rejected (Sunday 04:20),
//   maintenance archive (daily 03:50 — preserves closed tickets before the 04:10 delete).
exports.cleanupRateLimitsScheduled         = require('./cleanupOldDocs').cleanupRateLimitsScheduled;
exports.cleanupMaintenanceRTDBScheduled    = require('./cleanupOldDocs').cleanupMaintenanceRTDBScheduled;
exports.cleanupLiffUsersRejectedScheduled  = require('./cleanupOldDocs').cleanupLiffUsersRejectedScheduled;
exports.archiveMaintenanceScheduled        = require('./cleanupOldDocs').archiveMaintenanceScheduled;
exports.cleanupOldDocs                     = require('./cleanupOldDocs').cleanupOldDocs;

// IQAir AirVisual proxy with 1-hour Firestore cache. Hybrid: IQAir for AQI + Open-Meteo for μg/m³.
exports.getAirQuality = require('./getAirQuality').getAirQuality;

// WAQI station-level alternative (free, Thai PCD government sensors). Same payload as getAirQuality.
exports.getAirQualityWAQI = require('./getAirQualityWAQI').getAirQualityWAQI;

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS — LINE retry queue, LIFF approval status
// ═══════════════════════════════════════════════════════════════════════════

// Drains lineRetryQueue every 15 min — surfaces transient LINE push failures.
exports.processLineRetryQueue = require('./lineRetryQueue').processLineRetryQueue;

try {
  const notifyLiff = require('./notifyLiffRequest');
  if (notifyLiff.notifyLiffRequest) {
    exports.notifyLiffRequest = notifyLiff.notifyLiffRequest;
  }
} catch (e) {
  // optional module
}

try {
  const notifyLiffStatus = require('./notifyLiffStatusChange');
  if (notifyLiffStatus.notifyLiffStatusChange) {
    exports.notifyLiffStatusChange = notifyLiffStatus.notifyLiffStatusChange;
  }
} catch (e) {
  // optional module
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN TOOLS — one-shot migrations, data repair
// ═══════════════════════════════════════════════════════════════════════════

// One-shot migration: rewrite legacy bills whose `building` field is a display
// name back to canonical 'rooms'/'nest'. Dry-run by default; pass ?apply=1.
exports.fixLegacyBillBuilding = require('./fixLegacyBillBuilding').fixLegacyBillBuilding;

// One-off (idempotent) consolidation: merge tenant + lease data from 4 split paths
// into single SSoT at tenants/{building}/list/{roomId}. Admin-only. Dry-run by default.
exports.migrateTenantsToSSoT = require('./migrateTenantsToSSoT').migrateTenantsToSSoT;

// Phase 6 cleanup: drop top-level dupes in tenants/{b}/list/{r}, delete legacy docs.
// Admin-only. Dry-run by default.
exports.cleanupTenantsSSoT = require('./cleanupTenantsSSoT').cleanupTenantsSSoT;
