// Vercel API Route to serve Firebase config with environment variables
// This allows us to keep the API key secure while serving it to the client

export default function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Serve Firebase config with API key from environment variable
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: 'the-green-haven.firebaseapp.com',
    databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'the-green-haven',
    storageBucket: 'the-green-haven.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abcdef123456'
  };

  // Cache for 1 hour
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.setHeader('Content-Type', 'application/json');

  return res.status(200).json(firebaseConfig);
}
