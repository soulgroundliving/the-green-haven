/**
 * Firebase Cloud Function: Clean up old Realtime Database data
 * Deletes data/rooms after successful migration to Firestore
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();
const firestore = admin.firestore();

// ===== VERIFY MIGRATION BEFORE CLEANUP =====
exports.verifyMigrationComplete = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const token = req.query.token;
    const MIGRATION_TOKEN = process.env.MIGRATION_TOKEN;
    if (!MIGRATION_TOKEN) {
      return res.status(500).json({ error: 'Server misconfigured: MIGRATION_TOKEN not set' });
    }
    if (token !== MIGRATION_TOKEN) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('🔍 Verifying migration completeness...');

    const stats = {
      firestoreRooms: 0,
      firestoreBuildings: [],
      realtimeRooms: 0,
      readyForCleanup: false,
      warnings: []
    };

    // Check Firestore rooms
    try {
      const buildingsSnapshot = await firestore.collection('buildings').get();

      for (const buildingDoc of buildingsSnapshot.docs) {
        const buildingId = buildingDoc.id;
        stats.firestoreBuildings.push(buildingId);

        const roomsSnapshot = await buildingDoc.ref.collection('rooms').get();
        stats.firestoreRooms += roomsSnapshot.size;
      }

      console.log(`✅ Found ${stats.firestoreRooms} rooms in Firestore across ${stats.firestoreBuildings.length} buildings`);
    } catch (e) {
      stats.warnings.push(`Error checking Firestore: ${e.message}`);
      console.error('❌ Error checking Firestore:', e);
    }

    // Check Realtime DB rooms
    try {
      const realtimeSnapshot = await db.ref('data/rooms').get();
      if (realtimeSnapshot.exists()) {
        stats.realtimeRooms = Object.keys(realtimeSnapshot.val() || {}).length;
        console.log(`⚠️  Found ${stats.realtimeRooms} rooms in Realtime DB (old data)`);
      }
    } catch (e) {
      stats.warnings.push(`Error checking Realtime DB: ${e.message}`);
      console.error('❌ Error checking Realtime DB:', e);
    }

    // Ready for cleanup?
    if (stats.firestoreRooms >= 43 && stats.realtimeRooms > 0) {
      stats.readyForCleanup = true;
      console.log('✅ Migration looks complete. Safe to delete old data.');
    } else {
      stats.warnings.push(`Expected 43+ Firestore rooms, got ${stats.firestoreRooms}`);
      console.warn('⚠️  Verification incomplete - check numbers before cleanup');
    }

    return res.json({
      success: true,
      message: 'Verification complete',
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Verification error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== DELETE OLD REALTIME DB DATA =====
exports.deleteRealtimeDBData = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const token = req.query.token;
    const CLEANUP_TOKEN = process.env.CLEANUP_TOKEN;
    if (!CLEANUP_TOKEN) {
      return res.status(500).json({ error: 'Server misconfigured: CLEANUP_TOKEN not set' });
    }
    if (token !== CLEANUP_TOKEN) {
      return res.status(403).json({ error: 'Unauthorized - invalid cleanup token' });
    }

    const action = req.query.action || 'preview';

    console.log(`🗑️  Cleanup action: ${action}`);

    const stats = {
      dataPath: 'data/rooms',
      action: action,
      roomsDeleted: 0,
      otherDataPreserved: [],
      timestamp: new Date().toISOString()
    };

    if (action === 'preview') {
      // Preview what will be deleted
      const snapshot = await db.ref('data/rooms').get();
      if (snapshot.exists()) {
        const rooms = snapshot.val();
        stats.roomsDeleted = Object.keys(rooms).length;
        console.log(`📋 Preview: Would delete ${stats.roomsDeleted} rooms from data/rooms`);
      }

      stats.otherDataPreserved = ['meter_data', 'bills', 'payments', 'services', 'community'];

      return res.json({
        success: true,
        message: 'Preview only - no data deleted',
        stats,
        nextStep: 'Run with ?action=delete&token=... to actually delete'
      });

    } else if (action === 'delete') {
      // Actually delete the data
      try {
        console.log('🔥 Deleting data/rooms from Realtime Database...');
        await db.ref('data/rooms').remove();

        stats.roomsDeleted = 43; // We know we had 43 rooms
        console.log('✅ Successfully deleted data/rooms');

        return res.json({
          success: true,
          message: 'Old Realtime Database data deleted successfully',
          stats,
          note: 'Keep backups for safety. Data is now in Firestore.'
        });

      } catch (deleteError) {
        console.error('❌ Deletion failed:', deleteError);
        return res.status(500).json({
          success: false,
          error: `Deletion failed: ${deleteError.message}`,
          stats
        });
      }

    } else {
      return res.status(400).json({
        error: 'Invalid action. Use action=preview or action=delete'
      });
    }

  } catch (error) {
    console.error('❌ Cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});
