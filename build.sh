#!/bin/bash

# Build script for The Green Haven
# This script substitutes environment variables into HTML files

echo "Building The Green Haven..."

# Get API key from environment variable
FIREBASE_API_KEY="${REACT_APP_FIREBASE_API_KEY}"

# If API key is not set, exit with error
if [ -z "$FIREBASE_API_KEY" ]; then
  echo "Error: REACT_APP_FIREBASE_API_KEY environment variable is not set"
  exit 1
fi

# Substitute placeholders in HTML files
echo "Injecting Firebase API key..."

# Update all HTML files that contain Firebase config
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./admin/dashboard.html
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./accounting/accounting.html
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./accounting/tax-filing.html
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./tenant/tenant-payment.html
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./tenant/meter.html
sed -i "s/__FIREBASE_API_KEY__/$FIREBASE_API_KEY/g" ./login.html

echo "Build complete!"
echo "✅ Environment variables have been injected into all files"
