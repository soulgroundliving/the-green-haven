// Firebase Cloud Functions - Main Entry Point
// Each function initializes Firebase Admin separately

// Admin custom-claims management (Phase 4A)
exports.setAdminClaim = require('./setAdminClaim').setAdminClaim;

// Grant / revoke per-building manager claims (Tier 3c — SaaS prep)
exports.grantBuildingManager = require('./grantBuildingManager').grantBuildingManager;

// Facility bookings — parking / laundry / rooftop (Tier 3G)
exports.createFacilityBooking = require('./createFacilityBooking').createFacilityBooking;
exports.cancelFacilityBooking = require('./cancelFacilityBooking').cancelFacilityBooking;

// Move-In/Out Checklist (Tier 3I)
exports.createChecklistInstance = require('./createChecklistInstance').createChecklistInstance;
exports.submitChecklist          = require('./submitChecklist').submitChecklist;
exports.adminSignChecklist       = require('./adminSignChecklist').adminSignChecklist;
exports.deleteChecklistInstance  = require('./deleteChecklistInstance').deleteChecklistInstance;

// Unified writer for tenant-facing announcements (notice/event/banner) —
// writes to announcements/{auto} with type discriminator + unified audience.
// Replaces broadcastMessage CF + direct communityEvents + direct announcements
// writes. Tenant_app reads NEW + LEGACY merged during Session 1; Session 2 =
// migration; Session 3 = legacy decom. See memory/lifecycle_announcements_unified.md.
exports.publishAnnouncement  = require('./publishAnnouncement').publishAnnouncement;
exports.updateAnnouncement  = require('./updateAnnouncement').updateAnnouncement;
exports.deleteAnnouncement  = require('./deleteAnnouncement').deleteAnnouncement;

// Admin-only: LINE push to tenant when maintenance ticket status changes.
exports.notifyMaintenanceTenant = require('./notifyMaintenanceTenant').notifyMaintenanceTenant;

// Bulk-delete legacy anonymous user records (run after disabling Anonymous
// sign-in at Firebase Console — otherwise tenants regenerate them).
exports.cleanupAnonymousUsers = require('./cleanupAnonymousUsers').cleanupAnonymousUsers;

// One-shot migration: rewrite legacy bills whose `building` field is the
// display name back to canonical 'rooms'/'nest'. Dry-run by default; pass
// ?apply=1 to commit. Admin-only.
exports.fixLegacyBillBuilding = require('./fixLegacyBillBuilding').fixLegacyBillBuilding;

// Keep liffSignIn + liffBookingSignIn warm — scheduled ping every 5 min
// (belt-and-suspenders alongside minInstances:1 on both CFs)
exports.keepLiffWarm = require('./keepLiffWarm').keepLiffWarm;

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
// Allowed transitions: liffUsers.status ∈ {unlinked, rejected} → pending.
// Fires notifyLiffRequest so admin gets the same LINE push as a new request.
exports.requestRoomRelink = require('./requestRoomRelink').requestRoomRelink;

// Admin-only direct LINE link for F2 scenario: tenant lost LINE access entirely
// (new phone / new LINE account). Admin verifies identity out-of-band, then
// pre-creates liffUsers/{newLineUserId} status='approved' so the next liffSignIn
// from the new account proceeds without LIFF-flow verification.
// Mandatory: evidenceNote ≥10 chars + RTDB audit log every call.
// See lifecycle_tenant_transitions.md §F2.
exports.adminApprovedLink = require('./adminApprovedLink').adminApprovedLink;

// ═══════════════════════════════════════════════════════════════════════════
// BOOKING FLOW (LIFF prospect → deposit-paid booking → admin convert to tenant)
// Separate auth namespace from liffSignIn (uid prefix "book:" vs "line:") so
// a tenant can sign into both tenant_app.html and booking.html on the same
// device without clobbering each other's claims.
// ═══════════════════════════════════════════════════════════════════════════
// Mints custom token with role:'prospect' claim — gates createBookingLock.
exports.liffBookingSignIn = require('./liffBookingSignIn').liffBookingSignIn;
// Atomic Firestore transaction that prevents two prospects from locking the
// same room simultaneously. Generates server-side PromptPay deposit QR.
exports.createBookingLock = require('./createBookingLock').createBookingLock;
// Aggregates occupied rooms + active bookings without leaking tenant PII —
// prospects can't read tenants/* directly (rules block cross-room reads).
exports.getRoomAvailability = require('./getRoomAvailability').getRoomAvailability;
// Scheduled every 5 min: flips abandoned status='locked' bookings to
// status='expired' so other prospects can grab the room.
exports.expireBookingLocks = require('./expireBookingLocks').expireBookingLocks;
// SlipOK-backed deposit verification — sibling of verifySlip. Writes to
// bookings/* (not bills/), drops Nest gamification + RTDB bill mark. Atomic
// dedup via verifiedSlips/{txid}.create() shared with rent flow.
exports.verifyBookingSlip = require('./verifyBookingSlip').verifyBookingSlip;
// Admin-only conversion of paid booking → real tenant doc + liffUsers approval.
// One Firestore transaction so create-tenant + approve-liff + mark-converted
// can't end up in a partial state. Reuses tenantId across rooms for returning
// LINE users (linkedAuthUid match in tenants/{rooms,nest}/list/*).
exports.convertBookingToTenant = require('./convertBookingToTenant').convertBookingToTenant;
// Server-verified KYC submission — prospects upload to Storage directly (rules
// gate writes), then call this CF to flip booking status='paid' → 'kyc_pending'
// after server lists Storage to confirm idCardFront + idCardBack actually exist
// (don't trust client-provided file list).
exports.submitBookingKyc = require('./submitBookingKyc').submitBookingKyc;

// Admin-only archive of a tenant on move-out — preserves identity + history at
// tenants/{building}/archive/{contractId}. Phase 1 of person-centric identity
// (returning tenants get old data back via convertBookingToTenant lookup).
exports.archiveTenantOnMoveOut = require('./archiveTenantOnMoveOut').archiveTenantOnMoveOut;

// Admin-only single-pet delete (Firestore doc + Storage files).
// Replaces the prior client `_deletePetFromFirestore` direct-write path which
// only deleted the Firestore doc and left `pets/{b}/{r}/{petId}/*` orphan in
// Storage. Server-side helps symmetry with archiveTenantOnMoveOut + future
// PDPA audit logging.
exports.deletePetMedia = require('./deletePetMedia').deletePetMedia;

// Admin-only lease renewal/extension (lifecycle_tenant_transitions.md § C).
// Two modes: 'renewal' (novation — new lease doc) or 'extension' (variation —
// stretch endDate + arrayUnion extensions[]). Single Firestore batch per
// §7-DD discipline.
exports.renewLease = require('./renewLease').renewLease;

// Admin-only tenant transfer between rooms (lifecycle_tenant_transitions.md § B).
// Two modes: 'variation' (DEFAULT — same lease, amendments[] arrayUnion) or
// 'novation' (old lease ended, new lease created). Re-mints Auth claims per
// §7-FF (setCustomUserClaims + revokeRefreshTokens) so token.room reflects
// the new room within ~1 LIFF refresh cycle. Single Firestore batch per §7-DD.
exports.transferTenant = require('./transferTenant').transferTenant;

// Transition active tenant to community-member (player) — archives contract, creates
// people/{tenantId} doc, sets role:'player' claim. Person stays in LINE with community access.
exports.transitionToPlayer = require('./transitionToPlayer').transitionToPlayer;

// Undo a mistaken transitionToPlayer — restores tenant from archive, copies subcollections
// back, revokes player Auth claim, clears liffUsers.role. Archive doc kept as audit trail.
exports.revertTransitionToPlayer = require('./revertTransitionToPlayer').revertTransitionToPlayer;

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
// onComplaintCreated + sendComplaintConfirmation removed 2026-05-14: both
// onCall CFs had zero client callers (complaints write directly to RTDB);
// sendComplaintConfirmation also referenced a never-set COMPLAINT_TOKEN env
// var and a never-implemented email service stub. Deleted from deployed
// region via `firebase functions:delete`.
exports.cleanupResolvedComplaints = require('./complaintAndGamification').cleanupResolvedComplaints;
exports.awardComplaintFreeMonth = require('./complaintAndGamification').awardComplaintFreeMonth;
// Admin-only manual trigger / dry-run wrapper for the same logic.
exports.awardComplaintFreeMonthManual = require('./complaintAndGamification').awardComplaintFreeMonthManual;
exports.checkAndAwardBadges = require('./complaintAndGamification').checkAndAwardBadges;
exports.calculateTenantRank = require('./complaintAndGamification').calculateTenantRank;
exports.getLeaderboard = require('./complaintAndGamification').getLeaderboard;

// Rewards (Phase A.2 — Firestore-managed reward catalog)
// seedRewards removed 2026-04-28: one-shot setup that completed at launch;
// admin has CRUD UI (dashboard-extra.js saveReward/deleteReward). Was an
// unauthenticated HTTP endpoint that could reset the live reward catalog.
exports.redeemReward = require('./redeemReward').redeemReward;

// Daily login check-in (1 pt/day + streak bonus every 7 days)
exports.claimDailyLoginPoints = require('./claimDailyLoginPoints').claimDailyLoginPoints;

// Quiz claims — server-trusted (closes Session A client-side localStorage gap).
// Server reads canonical quiz from Firestore + grades + writes idempotent marker.
exports.claimWellnessQuizPoints = require('./claimWellnessQuizPoints').claimWellnessQuizPoints;
exports.claimContractQuizPoints = require('./claimContractQuizPoints').claimContractQuizPoints;

// seedAppConfig removed 2026-04-28: one-shot setup completed; admin manages
// system/* + buildings/{X}.info via dashboard CRUD or Firestore Console.
// Was an unauthenticated HTTP endpoint that could merge-overwrite customized
// config back to defaults.

// Auto-bill generation (Phase 1 automation — fires on meter_data Firestore write)
exports.generateBillsOnMeterUpdate = require('./generateBillsOnMeterUpdate').generateBillsOnMeterUpdate;

// Marketplace chat self-destruct (Sprint 1 — Privacy-First Chat). Fires on
// marketplace/{postId} write; clears every chat + messages sub-collection when
// the post is deleted or its status transitions to COMPLETED.
exports.cleanupMarketplaceChat = require('./cleanupMarketplaceChat').cleanupMarketplaceChat;

// Marketplace chat notification broker (Sprint 2 — LINE OA push on new message).
// Fires on marketplace_chats/{chatId}/messages/{messageId} create; pushes flex
// bubble to the non-sender participant via LINE Messaging API with anti-spam
// throttle + retry-queue handoff on transient failure.
exports.notifyMarketplaceChat = require('./notifyMarketplaceChat').notifyMarketplaceChat;

// Marketplace chat sender-only "recall" (Sprint 3 — LINE-parity UX). Replaces
// the message text with an empty string + unsent:true tombstone, within a
// 24h window after send. CF-only because the existing message-update rule
// allows only isRead toggles — text edits would otherwise be a self-edit
// integrity hole.
exports.unsendMarketplaceMessage = require('./unsendMarketplaceMessage').unsendMarketplaceMessage;

// Marketplace chat one-sided "delete" (Sprint 3 — LINE-parity UX). Writes
// hiddenBy.{callerUid} on the chat doc; the client list-query filters out
// hidden rows. Counterparty's view is untouched. notifyMarketplaceChat clears
// the recipient's hiddenBy on new messages so the thread reappears on
// fresh activity.
exports.hideMarketplaceChat = require('./hideMarketplaceChat').hideMarketplaceChat;

// Sprint 6 — Trophies & Badges. Bumps per-owner marketplace counters after
// a post completes (free / sky-hook / pet helpers), then evaluates the 3
// event-based badges (The Giver / Sky Walker / Pet Whisperer) and writes
// any newly-earned to gamification.badges. HTTPS callable (not Firestore
// trigger) per §7-NN — Eventarc doesn't watch SE3-hosted Firestore.
// Client invokes after setDoc({status:'COMPLETED'}) lands.
exports.marketplaceStatsAggregator = require('./marketplaceStatsAggregator').marketplaceStatsAggregator;

// LINE Flex notification to tenant when new bill appears in RTDB
// (secondary path — manual admin bill creation)
exports.notifyBillOnCreate = require('./notifyBillOnCreate').notifyBillOnCreate;

// LINE Flex notification on meter upload — primary path. Fires direct from
// meter_data Firestore writes so tenants are notified even if the legacy
// bills/ chain (generateBillsOnMeterUpdate → notifyBillOnCreate) is broken
// or eventually retired. Coordinates with notifyBillOnCreate via
// meter_data.notifiedAt to avoid double pushes.
exports.notifyTenantOnMeterUpload = require('./notifyTenantOnMeterUpload').notifyTenantOnMeterUpload;

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

// auth_events archive to BigQuery — daily 02:30 BKK; tamper-resistant audit
// log copy (restricted-write IAM on dataset means even admin SDK can't
// rewrite history once archived).
exports.archiveAuthEventsScheduled = require('./archiveAuthEvents').archiveAuthEventsScheduled;
exports.archiveAuthEvents = require('./archiveAuthEvents').archiveAuthEvents;

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

// PDPA retention sweep for checklist instances + storage assets.
// Schedule: daily 03:05 BKK. See functions/cleanupChecklistsScheduled.js
// for retention policy (signed >2yr OR orphan >5yr).
exports.cleanupChecklistsScheduled = require('./cleanupChecklistsScheduled').cleanupChecklistsScheduled;
exports.cleanupChecklistsManual = require('./cleanupChecklistsScheduled').cleanupChecklistsManual;

// Issue a 1-hour signed URL for a checklist asset (item photo, tenant/admin
// signature). Replaces the permanent getDownloadURL token — PDPA-friendly.
exports.getChecklistMediaUrl = require('./getChecklistMediaUrl').getChecklistMediaUrl;

// Issue a 1-hour signed URL for a tenant's lease contract PDF.
// Same PDPA pattern as getChecklistMediaUrl — no permanent download token exposed.
exports.getLeaseDocUrl = require('./getLeaseDocUrl').getLeaseDocUrl;

// PDPA Section 19 ledger: record tenant consent for checklist data processing.
// Written to consents/{tenantId}_{purpose}.
exports.recordChecklistConsent = require('./recordChecklistConsent').recordChecklistConsent;

// PDPA Section 30 (Data Subject Right): tenant downloads JSON of all their data.
exports.exportMyData = require('./exportMyData').exportMyData;

// PDPA Section 32 (Data Subject Right): tenant requests erasure of their data.
// Active tenants are refused (must terminate lease first); only players can run
// the cascade. Retains bills/leases/BigQuery audit per §32(2)(b)/(c)/(e) carve-outs.
exports.requestDataDeletion = require('./requestDataDeletion').requestDataDeletion;

// Prunes people/{tenantId} docs (and all subcollections) where transitionedAt
// is older than 1 year — enforces the grace-period expiry for former tenants.
exports.cleanupPlayersOver1YearScheduled = require('./cleanupPlayersOver1Year').cleanupPlayersOver1YearScheduled;

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
  console.info('verifySlip not found, skipping...');
}

try {
  const notifyLiff = require('./notifyLiffRequest');
  if (notifyLiff.notifyLiffRequest) {
    exports.notifyLiffRequest = notifyLiff.notifyLiffRequest;
  }
} catch (e) {
  console.info('notifyLiffRequest not found, skipping...');
}

try {
  const notifyLiffStatus = require('./notifyLiffStatusChange');
  if (notifyLiffStatus.notifyLiffStatusChange) {
    exports.notifyLiffStatusChange = notifyLiffStatus.notifyLiffStatusChange;
  }
} catch (e) {
  console.info('notifyLiffStatusChange not found, skipping...');
}
