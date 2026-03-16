// Firebase Configuration
// Load from environment variables or use defaults
// NEVER hardcode sensitive keys in the source code

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || window.__ENV__?.FIREBASE_API_KEY || '',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || window.__ENV__?.FIREBASE_AUTH_DOMAIN || 'the-green-haven-d9b20.firebaseapp.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || window.__ENV__?.FIREBASE_PROJECT_ID || 'the-green-haven-d9b20',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || window.__ENV__?.FIREBASE_STORAGE_BUCKET || 'the-green-haven-d9b20.appspot.com',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || window.__ENV__?.FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || window.__ENV__?.FIREBASE_APP_ID || '1:123456789:web:abcdef123456'
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { firebaseConfig };
}
