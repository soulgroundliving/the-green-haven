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

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecureConfig;
}
