// Flexible Room & Rate Management System
// Centralized configuration for rooms and utility rates

const DEFAULT_ROOMS_CONFIG = {
  'rooms': {
    name: 'ห้องแถว (Rooms Building)',
    building: 'rooms',
    rooms: [
      { id: '15ก', name: 'ห้อง 15ก', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '13', name: 'ห้อง 13', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '14', name: 'ห้อง 14', rentPrice: 1200, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '15', name: 'ห้อง 15', rentPrice: 1200, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '16', name: 'ห้อง 16', rentPrice: 2000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '17', name: 'ห้อง 17', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '18', name: 'ห้อง 18', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '19', name: 'ห้อง 19', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '20', name: 'ห้อง 20', rentPrice: 1200, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '21', name: 'ห้อง 21', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '22', name: 'ห้อง 22', rentPrice: 1200, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '23', name: 'ห้อง 23', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '24', name: 'ห้อง 24', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '25', name: 'ห้อง 25', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '26', name: 'ห้อง 26', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '27', name: 'ห้อง 27', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '28', name: 'ห้อง 28', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '29', name: 'ห้อง 29', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '30', name: 'ห้อง 30', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '31', name: 'ห้อง 31', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '32', name: 'ห้อง 32', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: '33', name: 'ห้อง 33', rentPrice: 1500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'ร้านใหญ่', name: 'ร้านใหญ่', rentPrice: 15000, waterRate: 20, electricRate: 6, trashRate: 20, deleted: false }
    ]
  },
  'nest': {
    name: 'Nest Building',
    building: 'nest',
    rooms: [
      { id: 'N101', name: 'Nest N101', floor: 1, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N102', name: 'Nest N102', floor: 1, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N103', name: 'Nest N103', floor: 1, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N104', name: 'Nest N104', floor: 1, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N105', name: 'Nest N105', floor: 1, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N201', name: 'Nest N201', floor: 2, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N202', name: 'Nest N202', floor: 2, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N203', name: 'Nest N203', floor: 2, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N204', name: 'Nest N204', floor: 2, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N205', name: 'Nest N205', floor: 2, type: 'studio', rentPrice: 5800, deposit: 3000, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N301', name: 'Nest N301', floor: 3, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N302', name: 'Nest N302', floor: 3, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N303', name: 'Nest N303', floor: 3, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N304', name: 'Nest N304', floor: 3, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N305', name: 'Nest N305', floor: 3, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N401', name: 'Nest N401', floor: 4, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N402', name: 'Nest N402', floor: 4, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N403', name: 'Nest N403', floor: 4, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N404', name: 'Nest N404', floor: 4, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false },
      { id: 'N405', name: 'Nest N405', floor: 4, type: 'pet-allowed', rentPrice: 6200, deposit: 2500, waterRate: 20, electricRate: 8, trashRate: 20, deleted: false }
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
    // Validate building parameter
    if (!building) {
      console.warn('⚠️ RoomConfigManager: Invalid building parameter');
      return DEFAULT_ROOMS_CONFIG['rooms']; // Default fallback
    }

    const stored = localStorage.getItem(`rooms_config_${building}`);
    const config = stored ? JSON.parse(stored) : DEFAULT_ROOMS_CONFIG[building];

    // Migration: rename legacy 'Amazon ☕' id → 'ร้านใหญ่' (one-time, auto-save)
    if (building === 'rooms' && config?.rooms) {
      const legacy = config.rooms.find(r => r.id === 'Amazon ☕');
      if (legacy) {
        legacy.id = 'ร้านใหญ่';
        if (!legacy.name || legacy.name === 'ร้าน Amazon') legacy.name = 'ร้านใหญ่';
        localStorage.setItem(`rooms_config_${building}`, JSON.stringify(config));
        console.log('✅ Migrated shop room id: Amazon ☕ → ร้านใหญ่');
      }
    }

    // Ensure config has rooms array
    if (!config || !config.rooms) {
      console.warn(`⚠️ RoomConfigManager: No config found for building "${building}"`);
      return DEFAULT_ROOMS_CONFIG[building] || DEFAULT_ROOMS_CONFIG['rooms'];
    }

    // Sanity check: if stored rooms are fewer than default, add missing rooms
    const def = DEFAULT_ROOMS_CONFIG[building];
    if (def && config.rooms.length < def.rooms.length) {
      const storedIds = new Set(config.rooms.map(r => r.id));
      def.rooms.forEach(r => {
        if (!storedIds.has(r.id)) config.rooms.push({ ...r });
      });
      localStorage.setItem(`rooms_config_${building}`, JSON.stringify(config));
      console.log(`✅ RoomConfigManager: restored ${def.rooms.length - storedIds.size} missing rooms for building "${building}"`);
    }

    return config;
  }

  static saveRoomsConfig(building, config) {
    localStorage.setItem(`rooms_config_${building}`, JSON.stringify(config));
    // Mirror to RTDB so generateBillsOnMeterUpdate CF can read per-room rates
    // (CF reads rooms_config/{building}/{roomId} when a meter_data doc is written)
    this.syncToFirebase(building, config);
  }

  static syncToFirebase(building, config) {
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseSet) return;
    if (!config?.rooms) return;
    try {
      const updates = {};
      config.rooms.forEach(r => {
        if (!r.id) return;
        updates[r.id] = {
          id: String(r.id),
          name: r.name || '',
          rentPrice: Number(r.rentPrice) || 0,
          electricRate: Number(r.electricRate) || 8,
          waterRate: Number(r.waterRate) || 20,
          trashRate: Number(r.trashRate) || 20,
          deleted: !!r.deleted,
          updatedAt: new Date().toISOString()
        };
      });
      // Write each room individually (parallel) so partial failure doesn't lose others
      Object.entries(updates).forEach(([roomId, data]) => {
        const ref = window.firebaseRef(window.firebaseDatabase, `rooms_config/${building}/${roomId}`);
        window.firebaseSet(ref, data).catch(e => console.warn(`rooms_config sync ${building}/${roomId}:`, e.message));
      });
    } catch (e) { console.warn('RoomConfigManager.syncToFirebase failed:', e.message); }
  }

  /**
   * One-time bulk sync — call from admin dashboard to populate RTDB rooms_config.
   * Idempotent (setDoc overwrite). Admin runs once after first deploy; later saves
   * auto-sync via saveRoomsConfig above.
   */
  static async bulkSyncAllToFirebase() {
    const buildings = ['rooms', 'nest'];
    for (const b of buildings) {
      const cfg = this.getRoomsConfig(b);
      this.syncToFirebase(b, cfg);
    }
    console.log('✅ RoomConfigManager: bulk synced rooms_config to RTDB');
  }

  /**
   * Phase 5 (2026-04-19): Subscribe to RTDB rooms_config so edits made on any
   * admin device propagate to all others. Backfills localStorage cache live.
   * Call once on dashboard load (idempotent). DEFAULT_ROOMS_CONFIG above remains
   * a SEED only — used when both RTDB and localStorage are empty.
   */
  static subscribeFromFirebase() {
    if (this._subscribed) return;
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) {
      setTimeout(() => this.subscribeFromFirebase(), 1500);
      return;
    }
    this._subscribed = true;
    ['rooms', 'nest'].forEach(building => {
      try {
        const ref = window.firebaseRef(window.firebaseDatabase, `rooms_config/${building}`);
        window.firebaseOnValue(ref, snap => {
          const remote = snap.val();
          if (!remote || Object.keys(remote).length === 0) return;
          const rooms = Object.values(remote)
            .filter(r => r && r.id)
            .map(r => ({
              id: String(r.id),
              name: r.name || r.id,
              rentPrice: Number(r.rentPrice) || 0,
              electricRate: Number(r.electricRate) || 8,
              waterRate: Number(r.waterRate) || 20,
              trashRate: Number(r.trashRate) || (building === 'nest' ? 40 : 20),
              deleted: !!r.deleted
            }));
          // Preserve any extra fields (floor/type/deposit) from local copy
          const local = JSON.parse(localStorage.getItem(`rooms_config_${building}`) || '{}');
          if (local?.rooms) {
            const localById = new Map(local.rooms.map(r => [r.id, r]));
            rooms.forEach(r => {
              const lr = localById.get(r.id);
              if (lr) Object.assign(r, { floor: lr.floor, type: lr.type, deposit: r.deposit || lr.deposit });
            });
          }
          const config = {
            name: building === 'nest' ? 'Nest Building' : 'ห้องแถว (Rooms Building)',
            building, rooms
          };
          localStorage.setItem(`rooms_config_${building}`, JSON.stringify(config));
          console.log(`☁️ RoomConfigManager synced ${building}: ${rooms.length} rooms`);
          // Phase 5 race fix: notify listeners so pages re-render after F5 + cloud arrival
          (this._listeners || []).forEach(fn => { try { fn(building, config); } catch(e){} });
          // Generic event so any page can listen
          try {
            document.dispatchEvent(new CustomEvent('roomconfig-updated', {
              detail: { building, count: rooms.length }
            }));
          } catch(e) {}
        }, err => console.warn(`rooms_config/${building} listen:`, err?.message));
      } catch(e) { console.warn(`subscribe rooms_config/${building}:`, e); }
    });
  }

  static getRoom(building, roomId) {
    const config = this.getRoomsConfig(building);
    return config.rooms.find(r => r.id === roomId) || null;
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

  static getRentPrice(building, roomId) {
    const room = this.getRoom(building, roomId);
    return room ? room.rentPrice : 1500; // Fallback to 1500
  }

  static updateRentPrice(building, roomId, price) {
    const config = this.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room.rentPrice = price;
      this.saveRoomsConfig(building, config);
      console.log(`✅ Room ${roomId} rent price updated to ${price}`);
      return true;
    }
    console.warn(`⚠️ Room ${roomId} not found`);
    return false;
  }

  static updateRoomField(building, roomId, fieldName, value) {
    // Generic update for any room field
    const config = this.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room[fieldName] = value;
      this.saveRoomsConfig(building, config);
      console.log(`✅ Room ${roomId} ${fieldName} updated to ${value}`);
      return true;
    }
    return false;
  }

  static getTrashRate(building, roomId) {
    const room = this.getRoom(building, roomId);
    return room ? room.trashRate : 20; // Fallback to 20
  }

  static updateTrashRate(building, roomId, rate) {
    const config = this.getRoomsConfig(building);
    const room = config.rooms.find(r => r.id === roomId);
    if (room) {
      room.trashRate = rate;
      this.saveRoomsConfig(building, config);
      console.log(`✅ Room ${roomId} trash rate updated to ${rate}`);
      return true;
    }
    console.warn(`⚠️ Room ${roomId} not found`);
    return false;
  }
}

// Static field initializer (cross-engine safe)
RoomConfigManager._subscribed = false;
RoomConfigManager._listeners = [];
RoomConfigManager.onChange = function(fn) {
  this._listeners.push(fn);
  return () => { this._listeners = this._listeners.filter(f => f !== fn); };
};

// Phase 5: auto-subscribe RTDB rooms_config for live multi-device sync
if (typeof window !== 'undefined') {
  setTimeout(() => RoomConfigManager.subscribeFromFirebase(), 1000);
}
