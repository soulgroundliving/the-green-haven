/**
 * Shared Configuration & Constants
 * Centralized location for all constants to eliminate redundancy
 */

// ===== THAI MONTHS (Single Source of Truth) =====
const CONFIG = {
  months: {
    short: ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
    full: ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  },

  buildings: {
    ROOMS: 'rooms',
    NEST: 'nest'
  },

  // Helper to get building type from legacy name
  getBuildingConfig(type) {
    return type === 'old' || type === 'rooms' ? 'rooms' : 'nest';
  },

  // Get month name by index
  getMonthName(month, style = 'full') {
    return this.months[style][month] || `เดือน ${month}`;
  },

  // Get all months array by style
  getMonths(style = 'full') {
    return this.months[style];
  }
};

// ===== DATA CACHE (Prevent repeated localStorage reads) =====
let _tenantCache = null;
let _tenantCacheTime = 0;
const CACHE_DURATION = 30000; // 30 seconds

function loadTenantsWithCache() {
  const now = Date.now();

  // Return cached data if fresh
  if (_tenantCache && (now - _tenantCacheTime) < CACHE_DURATION) {
    return _tenantCache;
  }

  // Load from localStorage
  const data = JSON.parse(localStorage.getItem('tenant_data') || '{}');
  _tenantCache = data;
  _tenantCacheTime = now;
  return data;
}

function invalidateTenantCache() {
  _tenantCache = null;
  _tenantCacheTime = 0;
}

let _psCache = null;
let _psCacheTime = 0;

function loadPSWithCache() {
  const now = Date.now();

  if (_psCache && (now - _psCacheTime) < CACHE_DURATION) {
    return _psCache;
  }

  const ps = {};
  for (let y = 67; y <= 69; y++) {
    const data = JSON.parse(localStorage.getItem(`ps_${y}`) || '{}');
    for (const [key, value] of Object.entries(data)) {
      ps[`${y}_${key}`] = value;
    }
  }
  _psCache = ps;
  _psCacheTime = now;
  return ps;
}

function invalidatePSCache() {
  _psCache = null;
  _psCacheTime = 0;
}

// ===== BUILDING CONFIGURATION HELPER =====
function getActiveRoomsWithMetadataOptimized(building) {
  // Use RoomConfigManager for active rooms
  const config = RoomConfigManager.getRoomsConfig(building);
  return config.rooms.filter(r => !r.deleted);
}

// ===== LEGACY ROOM DATA (Fallback only - will be phased out) =====
const ROOMS_OLD = [
  {id:'15ก',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'13',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'14',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'15',rent:2736,type:'room',elecRate:8,trashFee:20},
  {id:'16',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'17',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'18',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'19',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'20',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'21',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'22',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'23',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'24',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'25',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'26',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'27',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'28',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'29',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'30',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'31',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'32',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'33',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'Amazon ☕',rent:2000,type:'room',elecRate:6,trashFee:20}
];

const ROOMS_NEW = [
  {id:'101',rent:5600,type:'daily',floor:1,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'102',rent:5600,type:'daily',floor:1,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'103',rent:5600,type:'daily',floor:1,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'104',rent:5600,type:'daily',floor:1,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'201',rent:5600,type:'daily',floor:2,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'202',rent:5600,type:'daily',floor:2,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'203',rent:5600,type:'daily',floor:2,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'},
  {id:'204',rent:5600,type:'daily',floor:2,elecRate:8,trashFee:40,dailyRate:400,note:'รายวัน/รายเดือน'}
];

const NEST_ROOMS = [
  {id:'N101', floor:1, type:'daily', rent:5600, deposit:3000},
  {id:'N102', floor:1, type:'daily', rent:5600, deposit:3000},
  {id:'N103', floor:1, type:'daily', rent:5600, deposit:3000},
  {id:'N104', floor:1, type:'daily', rent:5600, deposit:3000},
  {id:'N105', floor:1, type:'daily', rent:5600, deposit:3000},
  {id:'N201', floor:2, type:'daily', rent:5600, deposit:3000},
  {id:'N202', floor:2, type:'daily', rent:5600, deposit:3000},
  {id:'N203', floor:2, type:'daily', rent:5600, deposit:3000},
  {id:'N204', floor:2, type:'daily', rent:5600, deposit:3000},
  {id:'N205', floor:2, type:'daily', rent:5600, deposit:3000},
  {id:'N301', floor:3, type:'studio', rent:5900, deposit:2500},
  {id:'N302', floor:3, type:'studio', rent:5900, deposit:2500},
  {id:'N303', floor:3, type:'pet', rent:5900, deposit:2500},
  {id:'N304', floor:3, type:'studio', rent:5900, deposit:2500},
  {id:'N305', floor:3, type:'pet', rent:5900, deposit:2500},
  {id:'N401', floor:4, type:'studio', rent:5900, deposit:2500},
  {id:'N402', floor:4, type:'studio', rent:5900, deposit:2500},
  {id:'N403', floor:4, type:'pet', rent:5900, deposit:2500},
  {id:'N404', floor:4, type:'studio', rent:5900, deposit:2500},
  {id:'N405', floor:4, type:'pet', rent:5900, deposit:2500}
];
