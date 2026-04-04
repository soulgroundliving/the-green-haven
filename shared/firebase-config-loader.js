/**
 * Firebase Config Loader
 * Loads Firebase configuration from /api/config endpoint
 * This keeps the API key secure while serving it to client-side apps
 */

let cachedConfig = null;

async function loadFirebaseConfig() {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    // Fetch config from API endpoint
    const response = await fetch('/api/config', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status} ${response.statusText}`);
    }

    cachedConfig = await response.json();

    // Validate that we got an apiKey
    if (!cachedConfig.apiKey) {
      console.warn('⚠️ WARNING: Firebase API key not configured. Set FIREBASE_API_KEY environment variable in Vercel.');
      console.warn('ℹ️ Go to: Vercel Dashboard > Project Settings > Environment Variables > Add FIREBASE_API_KEY');
    }

    return cachedConfig;
  } catch (error) {
    console.error('❌ Error loading Firebase config:', error);
    throw error;
  }
}

// Make it available globally
if (typeof window !== 'undefined') {
  window.loadFirebaseConfig = loadFirebaseConfig;
}
