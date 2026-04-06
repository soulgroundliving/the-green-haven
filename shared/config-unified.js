/**
 * Unified Configuration Management System
 * Consolidates: config-secure.js, shared-config.js
 * ระบบจัดการการตั้งค่าแบบรวมศูนย์
 *
 * Part 1: Secure Configuration (API keys, PromptPay, Security settings)
 * Part 2: Shared Configuration (Constants, Buildings, Room data, Cache functions)
 */

// ============================================================================
// PART 1: SECURE CONFIGURATION
// ============================================================================
/**
 * Secure Configuration Management
 * Store sensitive config like API keys, PromptPay numbers, etc.
 *
 * Usage:
 * - Set environment variables in Vercel dashboard or .env.local (not committed)
 * - Or update this file directly for local development (don't commit changes)
 */

const SecureConfig = {
  // Firebase API Key - Read from environment or use fallback
  firebase: {
    apiKey: typeof process !== 'undefined' && process.env.FIREBASE_API_KEY
      ? process.env.FIREBASE_API_KEY
      : (typeof window !== 'undefined' && window.FIREBASE_API_KEY)
        ? window.FIREBASE_API_KEY
        : '', // Will be loaded from environment or needs manual configuration
    projectId: 'the-green-haven-management',
    appId: '1:647919307076:web:5c7f9f9f9f9f9f9f9f9f9f'
  },

  // PromptPay Configuration
  promptpay: {
    // Default PromptPay number - should be overridden in localStorage or environment
    // DO NOT hardcode real numbers here
    defaultNumber: typeof process !== 'undefined' && process.env.PROMPTPAY_NUMBER
      ? process.env.PROMPTPAY_NUMBER
      : '', // Admin must set this in dashboard settings
    storageKey: 'promptpay'
  },

  // Security Settings
  security: {
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumbers: true,
    passwordRequireSpecial: false,
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    maxLoginAttempts: 5,
    loginLockoutDuration: 15 * 60 * 1000 // 15 minutes
  },

  // Feature Flags
  features: {
    enableAuditLogging: true,
    enableEmailVerification: true,
    enableRateLimiting: false, // Set to true when implemented
    enablePasswordReset: true
  }
};

// Initialize Firebase API Key from environment if available
if (typeof process !== 'undefined' && process.env.FIREBASE_API_KEY) {
  SecureConfig.firebase.apiKey = process.env.FIREBASE_API_KEY;
  console.log('✅ Firebase API Key loaded from environment');
} else if (typeof window !== 'undefined' && window.FIREBASE_API_KEY) {
  SecureConfig.firebase.apiKey = window.FIREBASE_API_KEY;
  console.log('✅ Firebase API Key loaded from window variable');
}

// Initialize PromptPay from localStorage or environment
if (typeof window !== 'undefined') {
  const storedPromptPay = localStorage.getItem(SecureConfig.promptpay.storageKey);
  if (storedPromptPay) {
    SecureConfig.promptpay.defaultNumber = storedPromptPay;
  }
}

// ============================================================================
// PART 2: SHARED CONFIGURATION & CONSTANTS
// ============================================================================
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

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

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

// ============================================================================
// BUILDING CONFIGURATION HELPER
// ============================================================================

function getActiveRoomsWithMetadataOptimized(building) {
  // Use RoomConfigManager for active rooms
  const config = RoomConfigManager.getRoomsConfig(building);
  return config.rooms.filter(r => !r.deleted);
}

// ============================================================================
// LEGACY ROOM DATA (Fallback only - will be phased out)
// ============================================================================

const ROOMS_OLD = [
  {id:'15ก',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'13',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'14',rent:1500,type:'room',elecRate:8,trashFee:20},
  {id:'15',rent:1200,type:'room',elecRate:8,trashFee:20},
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
  {id:'N101', floor:1, type:'daily', rent:5800, deposit:3000},
  {id:'N102', floor:1, type:'daily', rent:5800, deposit:3000},
  {id:'N103', floor:1, type:'daily', rent:5800, deposit:3000},
  {id:'N104', floor:1, type:'daily', rent:5800, deposit:3000},
  {id:'N105', floor:1, type:'daily', rent:5800, deposit:3000},
  {id:'N201', floor:2, type:'daily', rent:5800, deposit:3000},
  {id:'N202', floor:2, type:'daily', rent:5800, deposit:3000},
  {id:'N203', floor:2, type:'daily', rent:5800, deposit:3000},
  {id:'N204', floor:2, type:'daily', rent:5800, deposit:3000},
  {id:'N205', floor:2, type:'daily', rent:5800, deposit:3000},
  {id:'N301', floor:3, type:'studio', rent:6200, deposit:2500},
  {id:'N302', floor:3, type:'studio', rent:6200, deposit:2500},
  {id:'N303', floor:3, type:'pet', rent:6200, deposit:2500},
  {id:'N304', floor:3, type:'studio', rent:6200, deposit:2500},
  {id:'N305', floor:3, type:'pet', rent:6200, deposit:2500},
  {id:'N401', floor:4, type:'studio', rent:6200, deposit:2500},
  {id:'N402', floor:4, type:'studio', rent:6200, deposit:2500},
  {id:'N403', floor:4, type:'pet', rent:6200, deposit:2500},
  {id:'N404', floor:4, type:'studio', rent:6200, deposit:2500},
  {id:'N405', floor:4, type:'pet', rent:6200, deposit:2500}
];

// ============================================================================
// BACKWARD COMPATIBILITY & GLOBAL EXPORTS
// ============================================================================

// Make SecureConfig and CONFIG globally available
window.SecureConfig = SecureConfig;
window.CONFIG = CONFIG;
window.ROOMS_OLD = ROOMS_OLD;
window.ROOMS_NEW = ROOMS_NEW;
window.NEST_ROOMS = NEST_ROOMS;

// CommonJS export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SecureConfig,
    CONFIG,
    loadTenantsWithCache,
    invalidateTenantCache,
    loadPSWithCache,
    invalidatePSCache,
    getActiveRoomsWithMetadataOptimized,
    ROOMS_OLD,
    ROOMS_NEW,
    NEST_ROOMS
  };
}

console.log('✅ Config System loaded (v3.0 - Consolidated from 2 modules)');
