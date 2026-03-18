// Flexible Room & Rate Management System
// Centralized configuration for rooms and utility rates

const DEFAULT_ROOMS_CONFIG = {
  'rooms': {
    name: 'ห้องแถว (Rooms Building)',
    building: 'rooms',
    rooms: [
      { id: '13', name: 'ห้อง 13', waterRate: 20, electricRate: 8, deleted: false },
      { id: '14', name: 'ห้อง 14', waterRate: 20, electricRate: 8, deleted: false },
      { id: '15', name: 'ห้อง 15', waterRate: 20, electricRate: 8, deleted: false },
      { id: '15ก', name: 'ห้อง 15ก', waterRate: 20, electricRate: 8, deleted: false },
      { id: '16', name: 'ห้อง 16', waterRate: 20, electricRate: 8, deleted: false },
      { id: '17', name: 'ห้อง 17', waterRate: 20, electricRate: 8, deleted: false },
      { id: '18', name: 'ห้อง 18', waterRate: 20, electricRate: 8, deleted: false },
      { id: '19', name: 'ห้อง 19', waterRate: 20, electricRate: 8, deleted: false },
      { id: '20', name: 'ห้อง 20', waterRate: 20, electricRate: 8, deleted: false },
      { id: '21', name: 'ห้อง 21', waterRate: 20, electricRate: 8, deleted: false },
      { id: '22', name: 'ห้อง 22', waterRate: 20, electricRate: 8, deleted: false },
      { id: '23', name: 'ห้อง 23', waterRate: 20, electricRate: 8, deleted: false },
      { id: '24', name: 'ห้อง 24', waterRate: 20, electricRate: 8, deleted: false },
      { id: '25', name: 'ห้อง 25', waterRate: 20, electricRate: 8, deleted: false },
      { id: '26', name: 'ห้อง 26', waterRate: 20, electricRate: 8, deleted: false },
      { id: '27', name: 'ห้อง 27', waterRate: 20, electricRate: 8, deleted: false },
      { id: '28', name: 'ห้อง 28', waterRate: 20, electricRate: 8, deleted: false },
      { id: '29', name: 'ห้อง 29', waterRate: 20, electricRate: 8, deleted: false },
      { id: '30', name: 'ห้อง 30', waterRate: 20, electricRate: 8, deleted: false },
      { id: '31', name: 'ห้อง 31', waterRate: 20, electricRate: 8, deleted: false },
      { id: '32', name: 'ห้อง 32', waterRate: 20, electricRate: 8, deleted: false },
      { id: '33', name: 'ห้อง 33', waterRate: 20, electricRate: 8, deleted: false },
      { id: '35', name: 'ห้อง 35', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'AMAZON', name: 'ร้าน Amazon', waterRate: 20, electricRate: 6, deleted: false }
    ]
  },
  'nest': {
    name: 'Nest Building',
    building: 'nest',
    rooms: [
      { id: 'N101', name: 'Nest N101', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N102', name: 'Nest N102', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N103', name: 'Nest N103', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N104', name: 'Nest N104', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N105', name: 'Nest N105', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N201', name: 'Nest N201', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N202', name: 'Nest N202', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N203', name: 'Nest N203', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N204', name: 'Nest N204', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N205', name: 'Nest N205', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N301', name: 'Nest N301', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N302', name: 'Nest N302', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N303', name: 'Nest N303', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N304', name: 'Nest N304', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N305', name: 'Nest N305', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N401', name: 'Nest N401', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N402', name: 'Nest N402', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N403', name: 'Nest N403', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N404', name: 'Nest N404', waterRate: 20, electricRate: 8, deleted: false },
      { id: 'N405', name: 'Nest N405', waterRate: 20, electricRate: 8, deleted: false }
    ]
  }
};

// Room data structure:
// {
//   id: string (unique room identifier),
//   name: string (display name),
//   waterRate: number (baht/unit),
//   electricRate: number (baht/unit),
//   deleted: boolean (soft delete flag - when true, room is hidden but meter data is preserved)
// }

class RoomConfigManager {
  static getRoomsConfig(building) {
    const stored = localStorage.getItem(`rooms_config_${building}`);
    return stored ? JSON.parse(stored) : DEFAULT_ROOMS_CONFIG[building];
  }

  static saveRoomsConfig(building, config) {
    localStorage.setItem(`rooms_config_${building}`, JSON.stringify(config));
  }

  static getRoom(building, roomId) {
    const config = this.getRoomsConfig(building);
    return config.rooms.find(r => r.id === roomId);
  }

  static getRoomRate(building, roomId, rateType) {
    // rateType: 'water' or 'electric'
    const room = this.getRoom(building, roomId);
    const key = rateType === 'water' ? 'waterRate' : 'electricRate';
    return room ? room[key] : 20;
  }

  static addRoom(building, roomData) {
    // roomData: {id, name, waterRate, electricRate, deleted: false}
    const config = this.getRoomsConfig(building);
    if (!config.rooms.find(r => r.id === roomData.id)) {
      config.rooms.push(roomData);
      this.saveRoomsConfig(building, config);
      return true;
    }
    return false;
  }

  static removeRoom(building, roomId) {
    const config = this.getRoomsConfig(building);
    config.rooms = config.rooms.filter(r => r.id !== roomId);
    this.saveRoomsConfig(building, config);
  }

  static updateRoomRate(building, roomId, rateType, rate) {
    // rateType: 'water' or 'electric'
    const config = this.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room[rateType === 'water' ? 'waterRate' : 'electricRate'] = rate;
      this.saveRoomsConfig(building, config);
      return true;
    }
    return false;
  }

  static getAllRooms(building) {
    // Returns only active rooms (not soft-deleted)
    const config = this.getRoomsConfig(building);
    return config.rooms
      .filter(r => !r.deleted)
      .map(r => r.id);
  }

  static restoreRoom(building, roomId) {
    // Restore a soft-deleted room
    const config = this.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room.deleted = false;
      this.saveRoomsConfig(building, config);
      return true;
    }
    return false;
  }
}
