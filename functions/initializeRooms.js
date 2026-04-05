const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (only if not already initialized)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.database();

// ===== BUILDING CONFIGURATION =====
const BUILDINGS = {
  nest: {
    label: "Nest Building",
    rooms: [
      "N101", "N102", "N103", "N104", "N105",
      "N201", "N202", "N203", "N204", "N205",
      "N301", "N302", "N303", "N304", "N305",
      "N401", "N402", "N403", "N404", "N405"
    ],
    rates: { water: 18, electric: 7 }
  },
  groupA: {
    label: "Group A (Old)",
    rooms: [
      "13", "14", "15", "15ก", "16", "17", "18", "19", "20", "21",
      "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
      "Amazon"
    ],
    rates: { water: 18, electric: 7 }
  }
};

// ===== HTTP FUNCTION TO INITIALIZE ROOMS =====
exports.initializeRooms = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    // Check authorization (optional - add security check)
    if (req.query.token !== process.env.INIT_TOKEN && req.method !== "OPTIONS") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    let roomsCreated = 0;
    const updates = {};

    // Create rooms structure
    Object.entries(BUILDINGS).forEach(([buildingKey, building]) => {
      building.rooms.forEach(room => {
        const roomPath = `data/rooms/${room}`;
        updates[roomPath] = {
          id: room,
          building: buildingKey,
          buildingLabel: building.label,
          occupied: false,
          status: "empty",
          tenant: null,
          meterReading: {
            water: 0,
            electric: 0,
            lastUpdate: null
          },
          rates: building.rates,
          createdAt: admin.database.ServerValue.TIMESTAMP
        };
        roomsCreated++;
      });
    });

    // Batch update all rooms at once
    await db.ref().update(updates);

    res.json({
      success: true,
      message: `Successfully initialized ${roomsCreated} rooms`,
      roomsCreated: roomsCreated,
      buildings: Object.keys(BUILDINGS),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error initializing rooms:", error);
    res.status(500).json({
      error: "Failed to initialize rooms",
      message: error.message
    });
  }
});

// ===== SCHEDULED FUNCTION REMOVED =====
// validateRoomsStructure was removed - use Cloud Scheduler instead if needed

// ===== HELPER FUNCTION - Get all rooms =====
exports.getRooms = functions.region('asia-southeast1').https.onRequest(async (req, res) => {
  try {
    const snapshot = await db.ref("data/rooms").once("value");
    const rooms = snapshot.val() || {};

    res.json({
      success: true,
      totalRooms: Object.keys(rooms).length,
      buildings: {
        nest: rooms ? Object.values(rooms).filter(r => r.building === "nest").length : 0,
        groupA: rooms ? Object.values(rooms).filter(r => r.building === "groupA").length : 0
      },
      rooms: rooms
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
