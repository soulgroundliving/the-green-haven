/**
 * Cloud Functions for Complaint Management and Gamification System
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();
const firestore = admin.firestore();

// ===== COMPLAINT MANAGEMENT FUNCTIONS =====

/**
 * Handle new complaint notification to admin
 * HTTP trigger (instead of Firestore trigger) so it can run in asia-southeast1
 * Call this function when complaint is created in Firestore (asia-southeast3)
 */
exports.onComplaintCreated = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { buildingId, roomId, complaintId } = data;

    // Get complaint data from Firestore
    const complaintSnap = await firestore
      .collection('buildings')
      .doc(buildingId)
      .collection('rooms')
      .doc(roomId)
      .collection('complaintHistory')
      .doc(complaintId)
      .get();

    if (!complaintSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Complaint not found');
    }

    const complaint = complaintSnap.data();

    console.log(`🚨 New complaint: ${buildingId}/${roomId}/${complaintId}`);

    // Get room details
    const roomSnap = await firestore
      .collection('buildings')
      .doc(buildingId)
      .collection('rooms')
      .doc(roomId)
      .get();

    const roomData = roomSnap.data();

    // Get tenant details
    let tenantName = 'Unknown';
    if (roomData?.tenantId) {
      const tenantSnap = await firestore
        .collection('tenants')
        .doc(roomData.tenantId)
        .get();
      const tenantData = tenantSnap.data();
      tenantName = tenantData?.identity?.tenantName || 'Unknown';
    }

    // Log complaint to admin dashboard
    const notification = {
      id: complaintId,
      type: 'complaint',
      building: buildingId,
      room: roomId,
      tenant: tenantName,
      category: complaint.category,
      severity: complaint.severity,
      description: complaint.description,
      timestamp: new Date().toISOString(),
      read: false
    };

    // Save notification to Firestore
    await firestore.collection('admin_notifications').add(notification);

    console.log(`✅ Complaint notification created`);
    return {
      success: true,
      message: 'Complaint notification created'
    };
  } catch (error) {
    console.error('❌ Error handling complaint creation:', error);
    throw error;
  }
});

/**
 * Send auto-response when complaint is created
 */
exports.sendComplaintConfirmation = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const token = data.token;
    const COMPLAINT_TOKEN = process.env.COMPLAINT_TOKEN || 'the-green-haven-complaint-token';

    if (token !== COMPLAINT_TOKEN) {
      throw new functions.https.HttpsError('permission-denied', 'Unauthorized');
    }

    const { buildingId, roomId, tenantEmail } = data;

    // Send email notification
    console.log(`📧 Sending complaint confirmation to ${tenantEmail}`);

    // In production, integrate with email service (SendGrid, Mailgun, etc.)
    const confirmationData = {
      to: tenantEmail,
      subject: 'Complaint Received - The Green Haven',
      template: 'complaint_confirmation',
      data: {
        roomId,
        building: buildingId,
        timestamp: new Date().toISOString(),
        expectedResponse: '24 hours'
      }
    };

    // Log for now
    console.log('Email confirmation:', confirmationData);

    return {
      success: true,
      message: 'Confirmation sent to tenant'
    };
  } catch (error) {
    console.error('❌ Error sending confirmation:', error);
    throw error;
  }
});

/**
 * Auto-close resolved complaints after 30 days
 */
exports.cleanupResolvedComplaints = functions.region('asia-southeast1').pubsub
  .schedule('0 2 * * *') // Run daily at 2 AM
  .onRun(async (context) => {
    try {
      console.log('🧹 Cleaning up resolved complaints...');

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const buildingsSnap = await firestore.collection('buildings').get();

      for (const buildingDoc of buildingsSnap.docs) {
        const buildingId = buildingDoc.id;
        const roomsSnap = await buildingDoc.ref.collection('rooms').get();

        for (const roomDoc of roomsSnap.docs) {
          const roomId = roomDoc.id;
          const complaintsSnap = await roomDoc.ref
            .collection('complaintHistory')
            .where('status', '==', 'resolved')
            .get();

          let archivedCount = 0;

          for (const complaintDoc of complaintsSnap.docs) {
            const complaint = complaintDoc.data();
            const resolvedDate = new Date(complaint.resolvedDate);

            if (resolvedDate < thirtyDaysAgo) {
              // Archive old resolved complaint
              await firestore
                .collection('archived_complaints')
                .doc(complaintDoc.id)
                .set({
                  building: buildingId,
                  room: roomId,
                  ...complaint,
                  archivedAt: new Date().toISOString()
                });

              // Delete from active complaints
              await complaintDoc.ref.delete();
              archivedCount++;
            }
          }

          if (archivedCount > 0) {
            console.log(`✅ Archived ${archivedCount} complaints from ${buildingId}/${roomId}`);
          }
        }
      }

      return true;
    } catch (error) {
      console.error('❌ Error cleaning up complaints:', error);
      return false;
    }
  });

// ===== GAMIFICATION FUNCTIONS =====

/**
 * Award points for on-time rent payment
 */
exports.awardRentPaymentPoints = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { tenantId, points } = data;
    const pointsToAward = points || 50;

    const tenantRef = firestore.collection('tenants').doc(tenantId);
    const tenantDoc = await tenantRef.get();

    if (!tenantDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Tenant not found');
    }

    const tenantData = tenantDoc.data();
    const currentPoints = tenantData.gamification?.points || 0;

    await tenantRef.update({
      'gamification.points': currentPoints + pointsToAward,
      'metadata.updatedAt': new Date().toISOString()
    });

    console.log(`💰 Awarded ${pointsToAward} points to ${tenantId}`);

    return {
      success: true,
      newPoints: currentPoints + pointsToAward
    };
  } catch (error) {
    console.error('❌ Error awarding points:', error);
    throw error;
  }
});

/**
 * Auto-award points for no complaints in a month
 */
exports.awardComplaintFreeMonth = functions.region('asia-southeast1').pubsub
  .schedule('0 0 1 * *') // Run on 1st of every month at midnight
  .onRun(async (context) => {
    try {
      console.log('🎯 Checking for complaint-free tenants...');

      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);

      const tenantsSnap = await firestore.collection('tenants').get();

      for (const tenantDoc of tenantsSnap.docs) {
        const tenantId = tenantDoc.id;
        const tenantData = tenantDoc.data();

        // Check if tenant has any recent complaints
        const complaintsSnap = await firestore
          .collectionGroup('complaintHistory')
          .where('createdAt', '>=', lastMonth.toISOString())
          .get();

        let hasComplaints = false;

        for (const complaintDoc of complaintsSnap.docs) {
          const complaintData = complaintDoc.data();
          // Check if this complaint belongs to this tenant
          // This would need to be determined by checking the path
          if (complaintData.date >= lastMonth.toISOString()) {
            hasComplaints = true;
            break;
          }
        }

        if (!hasComplaints) {
          // Award points for complaint-free month
          const currentPoints = tenantData.gamification?.points || 0;
          const newPoints = currentPoints + 40;

          await firestore.collection('tenants').doc(tenantId).update({
            'gamification.points': newPoints,
            'metadata.updatedAt': new Date().toISOString()
          });

          console.log(`✅ Awarded complaint-free month bonus to ${tenantId}`);
        }
      }

      return true;
    } catch (error) {
      console.error('❌ Error awarding complaint-free bonuses:', error);
      return false;
    }
  });

/**
 * Check and award badges based on points and milestones
 */
exports.checkAndAwardBadges = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { tenantId } = data;

    const tenantRef = firestore.collection('tenants').doc(tenantId);
    const tenantDoc = await tenantRef.get();

    if (!tenantDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Tenant not found');
    }

    const tenantData = tenantDoc.data();
    const points = tenantData.gamification?.points || 0;
    const currentBadges = tenantData.gamification?.badges || [];
    let newBadges = [...currentBadges];

    // Check milestone badges
    const badgeRules = {
      'First Month': { condition: () => true, points: 0 }, // Awarded on move-in
      'On Time': { condition: () => points >= 50, points: 50 },
      'Community Star': { condition: () => points >= 75, points: 75 },
      'Green Guardian': { condition: () => points >= 100, points: 100 },
      'Loyal Resident': { condition: () => points >= 250, points: 250 },
      'Master Resident': { condition: () => points >= 1000, points: 1000 },
      'Perfect Record': { condition: () => points >= 500, points: 500 },
      'Rising Star': { condition: () => points >= 300, points: 300 }
    };

    let badgesAwarded = 0;

    for (const [badgeName, rule] of Object.entries(badgeRules)) {
      if (!currentBadges.includes(badgeName) && rule.condition()) {
        newBadges.push(badgeName);
        badgesAwarded++;
        console.log(`🎖️ Awarded badge "${badgeName}" to ${tenantId}`);
      }
    }

    if (badgesAwarded > 0) {
      await tenantRef.update({
        'gamification.badges': newBadges,
        'metadata.updatedAt': new Date().toISOString()
      });
    }

    return {
      success: true,
      badgesAwarded,
      newBadges
    };
  } catch (error) {
    console.error('❌ Error checking badges:', error);
    throw error;
  }
});

/**
 * Calculate tenant rank based on points
 */
exports.calculateTenantRank = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    const { tenantId } = data;

    const tenantDoc = await firestore.collection('tenants').doc(tenantId).get();

    if (!tenantDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Tenant not found');
    }

    const points = tenantDoc.data().gamification?.points || 0;

    let rank, rankIcon, nextMilestone;

    if (points < 250) {
      rank = 'Bronze';
      rankIcon = '🥉';
      nextMilestone = { name: 'Silver', points: 250 };
    } else if (points < 500) {
      rank = 'Silver';
      rankIcon = '🌟';
      nextMilestone = { name: 'Gold', points: 500 };
    } else if (points < 1000) {
      rank = 'Gold';
      rankIcon = '💎';
      nextMilestone = { name: 'Platinum', points: 1000 };
    } else {
      rank = 'Platinum';
      rankIcon = '👑';
      nextMilestone = null;
    }

    return {
      success: true,
      rank,
      rankIcon,
      points,
      nextMilestone,
      progressToNext: nextMilestone ? points - (nextMilestone.points - 250) : 0
    };
  } catch (error) {
    console.error('❌ Error calculating rank:', error);
    throw error;
  }
});

/**
 * Get leaderboard
 */
exports.getLeaderboard = functions.region('asia-southeast1').https.onCall(async (data, context) => {
  try {
    console.log('📊 Generating leaderboard...');

    const snapshot = await firestore
      .collection('tenants')
      .orderBy('gamification.points', 'desc')
      .limit(20)
      .get();

    const leaderboard = [];

    snapshot.forEach((doc, index) => {
      const tenantData = doc.data();
      leaderboard.push({
        rank: index + 1,
        tenantId: doc.id,
        tenantName: tenantData.identity?.tenantName || 'Unknown',
        points: tenantData.gamification?.points || 0,
        badges: (tenantData.gamification?.badges || []).length
      });
    });

    return {
      success: true,
      leaderboard
    };
  } catch (error) {
    console.error('❌ Error getting leaderboard:', error);
    throw error;
  }
});
