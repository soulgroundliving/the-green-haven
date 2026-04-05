const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (only if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.database();

// ===== PROPERTIES TO REMOVE FROM ROOM DATA =====
const PROPERTIES_TO_REMOVE = [
  "contractEndDate",
  "contractStartDate",
  "electMeterStart",
  "waterMeterStart",
  "lineId",
  "notes",
  "tenantEmail",  // Use 'email' instead
  "tenantPhone"   // Use 'phone' instead
];

// ===== PROPERTIES TO KEEP =====
const PROPERTIES_TO_KEEP = [
  "building",
  "roomId",
  "id",
  "tenantId",
  "tenantName",
  "tenantName", // Keep this
  "firstName",  // Keep as requested
  "lastName",   // Keep as requested
  "email",
  "phone",
  "status",
  "moveInDate",
  "moveOutDate",
  "rentAmount",
  "deposit",
  "address",
  "idCardNumber",
  "contractDocument",
  "createdAt",
  "updatedAt"
];

// ===== HTTP FUNCTION TO CLEANUP ROOM DATA =====
exports.cleanupRoomData = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    // Check authorization
    if (req.query.token !== process.env.CLEANUP_TOKEN && req.method !== "OPTIONS") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const snapshot = await db.ref("data/rooms").once("value");
    const rooms = snapshot.val() || {};

    let roomsProcessed = 0;
    let propertiesRemoved = 0;
    const updates = {};

    // Process each room
    for (const [roomId, roomData] of Object.entries(rooms)) {
      if (!roomData) continue;

      const cleanedRoom = {};

      // Keep only desired properties
      PROPERTIES_TO_KEEP.forEach(prop => {
        if (roomData.hasOwnProperty(prop)) {
          cleanedRoom[prop] = roomData[prop];
        }
      });

      // Count removed properties
      Object.keys(roomData).forEach(prop => {
        if (PROPERTIES_TO_REMOVE.includes(prop)) {
          propertiesRemoved++;
        }
      });

      // Update the room with cleaned data
      updates[`data/rooms/${roomId}`] = cleanedRoom;
      roomsProcessed++;
    }

    // Batch update all rooms
    await db.ref().update(updates);

    res.json({
      success: true,
      message: "Room data cleanup completed",
      roomsProcessed: roomsProcessed,
      propertiesRemoved: propertiesRemoved,
      removedProperties: PROPERTIES_TO_REMOVE,
      keptProperties: PROPERTIES_TO_KEEP,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error cleaning up room data:", error);
    res.status(500).json({
      error: "Cleanup failed",
      message: error.message
    });
  }
});

// ===== ANALYZE FUNCTION - Preview what will be removed =====
exports.analyzeRoomData = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const snapshot = await db.ref("data/rooms").once("value");
    const rooms = snapshot.val() || {};

    let totalRooms = 0;
    let bytesWillBeSaved = 0;
    const sampleRoom = {};
    const analysis = {
      totalRooms: 0,
      estimatedBytesSaved: 0,
      propertiesPerRoom: {},
      firstRoomExample: null
    };

    for (const [roomId, roomData] of Object.entries(rooms)) {
      if (!roomData) continue;
      totalRooms++;

      let roomSize = 0;
      const removedProps = [];

      Object.entries(roomData).forEach(([prop, value]) => {
        const propSize = JSON.stringify({ [prop]: value }).length;

        if (PROPERTIES_TO_REMOVE.includes(prop)) {
          roomSize += propSize;
          removedProps.push(`${prop}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
        }
      });

      bytesWillBeSaved += roomSize;

      // Capture first room as example
      if (!sampleRoom.example && removedProps.length > 0) {
        sampleRoom.example = {
          roomId: roomId,
          removedProperties: removedProps,
          estimatedBytes: roomSize
        };
      }
    }

    analysis.totalRooms = totalRooms;
    analysis.estimatedBytesSaved = bytesWillBeSaved;
    analysis.estimatedBytesSavedPerRoom = Math.round(bytesWillBeSaved / totalRooms);
    analysis.firstRoomExample = sampleRoom.example;

    res.json({
      success: true,
      analysis: analysis,
      willRemove: PROPERTIES_TO_REMOVE,
      willKeep: PROPERTIES_TO_KEEP,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error analyzing room data:", error);
    res.status(500).json({
      error: "Analysis failed",
      message: error.message
    });
  }
});
