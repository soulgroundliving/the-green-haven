# functions/ — Cloud Function Domain Map

85 CFs are physically flat in `functions/` (one file per CF or small cohesive group).
Subfolders were not used because every unit test in `__tests__/` imports via `require('../X')` —
moving files would require updating every test path with no functional benefit.

Domain organization lives in `index.js` via `═══` section banners.  
Helpers extracted from large handlers use a `_` prefix (e.g. `_verifySlipValidate.js`).

---

## AUTH — `liffSignIn.js`, `liffBookingSignIn.js` and auth helpers (10 exports)

| Export | File | Notes |
|--------|------|-------|
| `setAdminClaim` | `setAdminClaim.js` | Admin custom-claims management |
| `grantBuildingManager` | `grantBuildingManager.js` | Per-building manager claims (SaaS prep) |
| `liffSignIn` | `liffSignIn.js` | LINE ID token → Firebase custom token |
| `unlinkLiffUser` | `unlinkLiffUser.js` | Admin soft-unlink; §7-FF claim revocation |
| `requestRoomRelink` | `requestRoomRelink.js` | Community-member re-link request |
| `adminApprovedLink` | `adminApprovedLink.js` | F2 direct link for tenant who lost LINE access |
| `checkTenantPhone` | `checkTenantPhone.js` | Phone match check — never exposes raw phone |
| `requestPhoneOtp` | `requestPhoneOtp.js` | Rate-limit gate before client OTP (3/hr) |
| `setVerifiedPhone` | `setVerifiedPhone.js` | Server-side write of OTP-verified phone |
| `setTenantEmail` | `setTenantEmail.js` | Updates Firebase Auth email + Firestore |

## BOOKING — prospect → deposit → tenant convert (7 exports)

| Export | File | Notes |
|--------|------|-------|
| `liffBookingSignIn` | `liffBookingSignIn.js` | Mints `role:'prospect'` token (uid prefix `book:`) |
| `createBookingLock` | `createBookingLock.js` | Atomic room lock + PromptPay QR |
| `getRoomAvailability` | `getRoomAvailability.js` | Occupied + locked rooms without PII |
| `expireBookingLocks` | `expireBookingLocks.js` | Scheduled/5min: abandons stale locks |
| `verifyBookingSlip` | `verifyBookingSlip.js` | SlipOK deposit verify, atomic dedup |
| `convertBookingToTenant` | `convertBookingToTenant.js` | Admin: paid booking → tenant + liffUsers |
| `submitBookingKyc` | `submitBookingKyc.js` | Server KYC validation (ID card Storage check) |

## TENANT LIFECYCLE — move-out, player transition, pets (4 exports)

| Export | File | Notes |
|--------|------|-------|
| `archiveTenantOnMoveOut` | `archiveTenantOnMoveOut.js` | Clears tenant doc + lease + claims (§7-DD) |
| `deletePetMedia` | `deletePetMedia.js` | Admin single-pet delete (Firestore + Storage) |
| `transitionToPlayer` | `transitionToPlayer.js` | Active → community member; creates `people/` doc |
| `revertTransitionToPlayer` | `revertTransitionToPlayer.js` | Undo mistaken transition |

## LEASE — renewals, transfers, reminders, doc access (7 exports)

| Export | File | Notes |
|--------|------|-------|
| `renewLease` | `renewLease.js` | Renewal or extension (variation/novation modes) |
| `transferTenant` | `transferTenant.js` | Room transfer; re-mints claims §7-FF |
| `remindLatePaymentsScheduled` | `remindLatePayments.js` | Daily 09:00 BKK LINE reminders |
| `remindLatePayments` | `remindLatePayments.js` | HTTP for manual trigger |
| `remindLeaseExpiryScheduled` | `remindLeaseExpiry.js` | Daily 08:00 BKK; tiered 60/30/14/0d alerts |
| `remindLeaseExpiry` | `remindLeaseExpiry.js` | HTTP for manual trigger |
| `getLeaseDocUrl` | `getLeaseDocUrl.js` | 1-hour signed URL for lease PDF (PDPA) |

## BILLING — meter, bills, payment verification (5 exports)

| Export | File | Notes |
|--------|------|-------|
| `generateBillsOnMeterUpdate` | `generateBillsOnMeterUpdate.js` | ⛔ FROZEN Gen1 Firestore trigger — do not edit or redeploy (see `memory/generate_bills_cf_frozen.md`) |
| `verifySlip` | `verifySlip.js` | SlipOK verify + dedup + gamification + receipt. Helpers: `_verifySlipValidate.js` + `_verifySlipWrite.js` |
| `notifyBillOnCreate` | `notifyBillOnCreate.js` | LINE Flex on new RTDB bill (secondary path) |
| `notifyTenantOnMeterUpload` | `notifyTenantOnMeterUpload.js` | LINE on meter upload; HTTPS callable (§7-NN) |
| `notifyMaintenanceTenant` | `notifyMaintenanceTenant.js` | LINE push on maintenance ticket status change |

## MARKETPLACE — classifieds + 1:1 chat (5 exports)

| Export | File | Notes |
|--------|------|-------|
| `cleanupMarketplaceChat` | `cleanupMarketplaceChat.js` | Clears chat+messages on deleteMarketItem |
| `notifyMarketplaceChat` | `notifyMarketplaceChat.js` | LINE push on new message; anti-spam throttle |
| `unsendMarketplaceMessage` | `unsendMarketplaceMessage.js` | Sender-only recall within 24h |
| `hideMarketplaceChat` | `hideMarketplaceChat.js` | One-sided hide; counterparty untouched |
| `marketplaceStatsAggregator` | `marketplaceStatsAggregator.js` | Trophy counters + 3 event-based badges (callable §7-NN) |

## GAMIFICATION — points, rewards, badges (10 exports)

| Export | File | Notes |
|--------|------|-------|
| `cleanupResolvedComplaints` | `complaintAndGamification.js` | |
| `awardComplaintFreeMonth` | `complaintAndGamification.js` | Scheduled monthly |
| `awardComplaintFreeMonthManual` | `complaintAndGamification.js` | HTTP for manual trigger |
| `checkAndAwardBadges` | `complaintAndGamification.js` | |
| `calculateTenantRank` | `complaintAndGamification.js` | |
| `getLeaderboard` | `complaintAndGamification.js` | Filters `points > 0` |
| `redeemReward` | `redeemReward.js` | Atomic Tx; rate-limited 5/24h |
| `claimDailyLoginPoints` | `claimDailyLoginPoints.js` | 1pt/day + streak bonus |
| `claimWellnessQuizPoints` | `claimWellnessQuizPoints.js` | Server-graded quiz |
| `claimContractQuizPoints` | `claimContractQuizPoints.js` | Server-graded quiz |

## ANNOUNCEMENTS — unified notice/event/banner C4 (3 exports)

| Export | File | Notes |
|--------|------|-------|
| `publishAnnouncement` | `publishAnnouncement.js` | Writes `announcements/{auto}` |
| `updateAnnouncement` | `updateAnnouncement.js` | |
| `deleteAnnouncement` | `deleteAnnouncement.js` | |

## PDPA — checklist lifecycle, consent, data subject rights (11 exports)

| Export | File | Notes |
|--------|------|-------|
| `createChecklistInstance` | `createChecklistInstance.js` | Template → instance |
| `submitChecklist` | `submitChecklist.js` | Tenant fill submission |
| `adminSignChecklist` | `adminSignChecklist.js` | Admin co-sign |
| `deleteChecklistInstance` | `deleteChecklistInstance.js` | Deletes instance + Storage |
| `cleanupChecklistsScheduled` | `cleanupChecklistsScheduled.js` | Daily 03:05 BKK retention sweep |
| `cleanupChecklistsManual` | `cleanupChecklistsScheduled.js` | HTTP for manual trigger |
| `getChecklistMediaUrl` | `getChecklistMediaUrl.js` | 1-hour signed URL for photos/signatures |
| `recordChecklistConsent` | `recordChecklistConsent.js` | PDPA §19 consent ledger |
| `exportMyData` | `exportMyData.js` | PDPA §30 DSR: JSON export |
| `requestDataDeletion` | `requestDataDeletion.js` | PDPA §32 DSR: erasure request |
| `cleanupPlayersOver1YearScheduled` | `cleanupPlayersOver1Year.js` | Prunes `people/` docs >1yr |

## FACILITY BOOKINGS — parking, laundry, rooftop (2 exports)

| Export | File | Notes |
|--------|------|-------|
| `createFacilityBooking` | `createFacilityBooking.js` | Atomic conflict-check Tx |
| `cancelFacilityBooking` | `cancelFacilityBooking.js` | |

## ANALYTICS + ARCHIVING — tax, BigQuery (6 exports)

| Export | File | Notes |
|--------|------|-------|
| `aggregateMonthlyRevenueScheduled` | `aggregateMonthlyRevenue.js` | Monthly tax aggregation |
| `aggregateMonthlyRevenue` | `aggregateMonthlyRevenue.js` | HTTP for manual trigger |
| `archiveSlipLogsScheduled` | `archiveSlipLogs.js` | Daily 02:00 BKK → BigQuery |
| `archiveSlipLogs` | `archiveSlipLogs.js` | HTTP for manual trigger |
| `archiveAuthEventsScheduled` | `archiveAuthEvents.js` | Daily 02:30 BKK → BigQuery |
| `archiveAuthEvents` | `archiveAuthEvents.js` | HTTP for manual trigger |

## INFRASTRUCTURE + UTILITY — cleanup, keep-warm, APIs (10 exports)

| Export | File | Notes |
|--------|------|-------|
| `keepLiffWarm` | `keepLiffWarm.js` | Scheduled ping every 5 min |
| `cleanupAnonymousUsers` | `cleanupAnonymousUsers.js` | Bulk-delete legacy anon user records |
| `backupFirestoreScheduled` | `backupFirestore.js` | Daily 03:00 BKK, 30-day retention |
| `backupFirestore` | `backupFirestore.js` | HTTP for manual trigger |
| `cleanupRateLimitsScheduled` | `cleanupOldDocs.js` | Daily 04:00 BKK |
| `cleanupMaintenanceRTDBScheduled` | `cleanupOldDocs.js` | Daily 04:10 BKK |
| `cleanupLiffUsersRejectedScheduled` | `cleanupOldDocs.js` | Sunday 04:20 BKK |
| `cleanupOldDocs` | `cleanupOldDocs.js` | HTTP for manual trigger |
| `getAirQuality` | `getAirQuality.js` | IQAir proxy + 1h Firestore cache |
| `getAirQualityWAQI` | `getAirQualityWAQI.js` | WAQI Thai PCD sensor alternative |

## NOTIFICATIONS — LINE retry, LIFF approval (3 exports)

| Export | File | Notes |
|--------|------|-------|
| `processLineRetryQueue` | `lineRetryQueue.js` | Drains retry queue every 15 min |
| `notifyLiffRequest` | `notifyLiffRequest.js` | Optional — graceful skip if absent |
| `notifyLiffStatusChange` | `notifyLiffStatusChange.js` | Optional — graceful skip if absent |

## ADMIN TOOLS — one-shot migrations (3 exports)

| Export | File | Notes |
|--------|------|-------|
| `fixLegacyBillBuilding` | `fixLegacyBillBuilding.js` | Rewrite legacy `building` display names → canonical |
| `migrateTenantsToSSoT` | `migrateTenantsToSSoT.js` | Phase 6 SSoT consolidation (idempotent, dry-run default) |
| `cleanupTenantsSSoT` | `cleanupTenantsSSoT.js` | Phase 6 cleanup: drop top-level dupes |

---

## Helper modules (not exported as CFs)

| File | Purpose |
|------|---------|
| `_verifySlipValidate.js` | `validateRequest` + `isSafeTransactionId` extracted from `verifySlip.js` |
| `_verifySlipWrite.js` | `logVerificationAttempt`, `saveVerifiedSlip`, `markBillPaidInRTDB`, `recordPaymentAndAwardPoints` |
| `buildingRegistry.js` | `getValidBuildings()` — shared by validation helpers |
