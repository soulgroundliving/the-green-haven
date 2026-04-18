#!/bin/bash

# Build script for The Green Haven
# This script substitutes environment variables into HTML files

echo "Building The Green Haven..."

# Get API key from environment variable (optional, skip if not set)
FIREBASE_API_KEY="${REACT_APP_FIREBASE_API_KEY:-}"

# If API key is set, substitute it; otherwise skip
if [ -z "$FIREBASE_API_KEY" ]; then
  echo "⚠️  Warning: REACT_APP_FIREBASE_API_KEY not set, skipping Firebase config injection"
  echo "✅ Proceeding with build..."
else

  # Substitute placeholders in HTML files
  echo "Injecting Firebase API key..."

  # Update all HTML files that contain Firebase config
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./admin/dashboard.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./accounting/accounting.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./accounting/tax-filing.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./tenant/tenant-payment.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./tenant/meter.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./login.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./tenant_app.html
  sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./dashboard.html

  echo "✅ Environment variables have been injected into all files"
fi

echo "✅ Build complete!"
