/**
 * Firebase Cloud Function: Migrate data from Realtime Database to Firestore
 * Moves rooms and tenant data to Firestore for better querying and analytics
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();
const firestore = admin.firestore();

// ===== MIGRATION FUNCTION: Realtime DB → Firestore =====
exports.migrateToFirestore = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const token = req.query.token;
    const MIGRATION_TOKEN = process.env.MIGRATION_TOKEN || 'the-green-haven-migrate-secure-2026-march-key';

    // Verify token
    if (token !== MIGRATION_TOKEN) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('🔄 Starting migration: Realtime DB → Firestore...');

    const migrationStats = {
      buildingsMigrated: 0,
      roomsMigrated: 0,
      tenantsMigrated: 0,
      errors: []
    };

    // ===== STEP 1: Migrate rooms from data/rooms to Firestore =====
    console.log('📦 Migrating rooms...');
    const roomsSnapshot = await db.ref('data/rooms').get();

    if (roomsSnapshot.exists()) {
      const rooms = roomsSnapshot.val();

      for (const [roomId, roomData] of Object.entries(rooms)) {
        try {
          const building = roomData.building || 'unknown';

          // Prepare room document
          const roomDoc = {
            id: roomData.id || roomId,
            building: building,
            tenantId: roomData.tenantId || null,
            lease: {
              status: roomData.status || 'empty',
              rentAmount: roomData.rentAmount || 0,
              deposit: roomData.deposit || 0,
              contractDocument: roomData.contractDocument || null,
              moveInDate: roomData.moveInDate || null,
              moveOutDate: roomData.moveOutDate || null
            },
            operations: {
              emergencyContact: {
                name: roomData.tenantName || null,
                phone: roomData.phone || null
              },
              plateNumber: null,
              billingCycle: 1,
              lastMaintenanceDate: null,
              referralSource: null,
              acquiredDate: new Date().toISOString()
            },
            metadata: {
              createdAt: roomData.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          };

          // Save to Firestore: buildings/{building}/rooms/{roomId}
          await firestore
            .collection('buildings')
            .doc(building)
            .collection('rooms')
            .doc(roomId)
            .set(roomDoc, { merge: true });

          migrationStats.roomsMigrated++;
          console.log(`✅ Migrated room: ${building}/${roomId}`);
        } catch (error) {
          migrationStats.errors.push(`Room ${roomId}: ${error.message}`);
          console.error(`❌ Error migrating room ${roomId}:`, error);
        }
      }
    }

    // ===== STEP 2: Migrate tenant profiles =====
    console.log('👤 Migrating tenant profiles...');
    // For now, create empty structures - actual tenant data will be populated later
    const tenantIds = new Set();
    const roomsSnapshot2 = await db.ref('data/rooms').get();

    if (roomsSnapshot2.exists()) {
      const rooms = roomsSnapshot2.val();
      for (const room of Object.values(rooms)) {
        if (room.tenantId) {
          tenantIds.add(room.tenantId);
        }
      }
    }

    for (const tenantId of tenantIds) {
      try {
        const tenantDoc = {
          identity: {
            firstName: null,
            lastName: null,
            tenantName: null,
            phone: null,
            email: null
          },
          petFriendly: {
            hasPet: false,
            pets: []
          },
          logistics: {
            preferredDelivery: null,
            notes: null
          },
          gamification: {
            points: 0,
            rank: null,
            interests: [],
            badges: []
          },
          metadata: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        };

        await firestore.collection('tenants').doc(tenantId).set(tenantDoc, { merge: true });
        migrationStats.tenantsMigrated++;
        console.log(`✅ Created tenant profile: ${tenantId}`);
      } catch (error) {
        migrationStats.errors.push(`Tenant ${tenantId}: ${error.message}`);
        console.error(`❌ Error creating tenant ${tenantId}:`, error);
      }
    }

    // ===== STEP 3: Verify meter_data exists in Firestore =====
    console.log('📊 Verifying meter_data...');
    const meterSnapshot = await firestore.collection('meter_data').limit(1).get();
    if (meterSnapshot.empty) {
      console.log('⚠️  meter_data not found in Firestore - consider migrating separately');
    } else {
      console.log('✅ meter_data already in Firestore');
    }

    const timestamp = new Date().toISOString();

    return res.json({
      success: true,
      message: 'Migration completed',
      stats: migrationStats,
      timestamp
    });

  } catch (error) {
    console.error('❌ Migration error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== STEP 2: Create Firestore Indexes =====
exports.setupFirestoreIndexes = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const token = req.query.token;
    const MIGRATION_TOKEN = process.env.MIGRATION_TOKEN || 'the-green-haven-migrate-secure-2026-march-key';

    if (token !== MIGRATION_TOKEN) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('📑 Firestore indexes information:');
    console.log(`
    Create these indexes in Firestore Console for better performance:

    1. buildings/{buildingId}/rooms collection:
       - Field: lease.status (Ascending)
       - Field: operations.referralSource (Ascending)
       - Field: operations.lastMaintenanceDate (Descending)

    2. buildings/{buildingId}/rooms/operations.complaintHistory:
       - Collection Group Index

    3. tenants collection:
       - Field: identity.email (Ascending)
       - Field: gamification.rank (Ascending)

    OR deploy firestore.indexes.json to auto-create:
    firebase deploy --only firestore:indexes
    `);

    return res.json({
      success: true,
      message: 'Index setup instructions provided',
      note: 'Create indexes in Firebase Console or use firestore.indexes.json'
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
