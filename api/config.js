// Vercel API Route to serve Firebase config with environment variables.
// Keeps the API key out of public source; serves it only to live requests.
//
// Staging support: when the Vercel deployment is a preview (not production)
// AND the FIREBASE_STAGING_* env vars are set, return the staging project's
// config instead. This lets feature branches land at a vercel preview URL
// that's wired to a separate Firebase project (the-green-haven-staging),
// so risky changes (rule diffs, schema migrations, new CF behavior) don't
// touch real tenant data.
//
// Vercel exposes VERCEL_ENV = 'production' | 'preview' | 'development'.
// If production-only or staging vars missing → fall back to prod config.

function buildProdConfig() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: 'the-green-haven.firebaseapp.com',
    databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'the-green-haven',
    storageBucket: 'the-green-haven.firebasestorage.app',
    messagingSenderId: '523697750767',
    appId: '1:523697750767:web:89b253f92d8d5cfe8a111a',
    measurementId: 'G-93J1CBN1BZ',
    _env: 'production'
  };
}

function buildStagingConfig() {
  const projectId = process.env.FIREBASE_STAGING_PROJECT_ID;
  return {
    apiKey: process.env.FIREBASE_STAGING_API_KEY,
    authDomain: process.env.FIREBASE_STAGING_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    databaseURL: process.env.FIREBASE_STAGING_DATABASE_URL || '',
    projectId,
    storageBucket: process.env.FIREBASE_STAGING_STORAGE_BUCKET || `${projectId}.firebasestorage.app`,
    messagingSenderId: process.env.FIREBASE_STAGING_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_STAGING_APP_ID || '',
    _env: 'staging'
  };
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isPreview = process.env.VERCEL_ENV === 'preview';
  const hasStagingVars = !!(
    process.env.FIREBASE_STAGING_API_KEY &&
    process.env.FIREBASE_STAGING_PROJECT_ID
  );

  const cfg = (isPreview && hasStagingVars) ? buildStagingConfig() : buildProdConfig();

  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(cfg);
}
