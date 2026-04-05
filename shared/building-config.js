// ===== UNIFIED BUILDING CONFIGURATION =====
// Centralized config for all room groups
// Use this for meter tracking, billing, and tenant management

const BUILDINGS = {
  nest: {
    id: "nest",
    label: "Nest Building",
    rooms: [
      "N101", "N102", "N103", "N104", "N105",
      "N201", "N202", "N203", "N204", "N205",
      "N301", "N302", "N303", "N304", "N305",
      "N401", "N402", "N403", "N404", "N405"
    ],
    count: 20,
    rates: { water: 18, electric: 7 }
  },
  groupA: {
    id: "groupA",
    label: "Group A (Old)",
    rooms: [
      "13", "14", "15", "15ก", "16", "17", "18", "19", "20", "21",
      "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33",
      "Amazon"
    ],
    count: 23,
    rates: { water: 18, electric: 7 }
  }
};

// ===== HELPER FUNCTIONS =====

/**
 * Get all rooms from all buildings
 * @returns {Array} Array of all room IDs
 */
function getAllRooms() {
  return Object.values(BUILDINGS).flatMap(b => b.rooms);
}

/**
 * Get rooms for a specific building
 * @param {String} buildingId - Building ID (nest, groupA)
 * @returns {Array} Array of room IDs
 */
function getRoomsByBuilding(buildingId) {
  return BUILDINGS[buildingId]?.rooms || [];
}

/**
 * Find which building a room belongs to
 * @param {String} roomId - Room ID (e.g., "N101" or "13")
 * @returns {Object} Building object or null
 */
function getRoomBuilding(roomId) {
  for (const [key, building] of Object.entries(BUILDINGS)) {
    if (building.rooms.includes(roomId)) {
      return { id: key, ...building };
    }
  }
  return null;
}

/**
 * Get rates for a specific room
 * @param {String} roomId - Room ID
 * @returns {Object} Rates object {water, electric}
 */
function getRatesForRoom(roomId) {
  const building = getRoomBuilding(roomId);
  return building?.rates || { water: 18, electric: 7 };
}

/**
 * Get total room count
 * @returns {Number} Total number of rooms
 */
function getTotalRoomCount() {
  return Object.values(BUILDINGS).reduce((sum, b) => sum + b.count, 0);
}

/**
 * Validate if room ID exists
 * @param {String} roomId - Room ID to validate
 * @returns {Boolean} True if room exists
 */
function isValidRoom(roomId) {
  return getAllRooms().includes(roomId);
}

/**
 * Group rooms by building
 * @returns {Object} Rooms grouped by building
 */
function getGroupedRooms() {
  const grouped = {};
  Object.entries(BUILDINGS).forEach(([key, building]) => {
    grouped[key] = {
      label: building.label,
      rooms: building.rooms,
      count: building.count
    };
  });
  return grouped;
}
