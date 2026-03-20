# ⚠️ Firestore Rules Setup Required

## Problem
Your Firestore database is blocking read/write access with "Missing or insufficient permissions" errors. The Firestore Rules need to be updated to allow authenticated users to access the data.

## Solution: Update Firestore Security Rules

The Firestore Rules have been created in `/config/firestore.rules` but need to be deployed to Firebase.

### Option 1: Deploy via Firebase Console (Recommended - No CLI needed)

1. **Go to Firebase Console**
   - Navigate to: https://console.firebase.google.com/project/the-green-haven/firestore/rules

2. **Copy the rules from the editor**
   - Delete any existing rules
   - Copy and paste the rules below into the editor:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read and write all collections
    match /{document=**} {
      allow read, write: if request.auth != null;
    }

    // Specific rules for meter_data collection
    match /meter_data/{document=**} {
      allow read, write: if request.auth != null;
    }

    // Specific rules for opening_balances collection
    match /opening_balances/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

3. **Publish the rules**
   - Click "Publish" button in the top-right corner
   - Wait for confirmation message

### What These Rules Do

- `allow read, write: if request.auth != null;`
  - Allows any authenticated user to read and write data
  - Blocks unauthenticated/public access
  - Perfect for your admin dashboard system

---

## After Updating Rules

Once you publish the Firestore rules:

1. **Refresh the dashboard**: https://the-green-haven.vercel.app/dashboard
2. Check browser console for: ✅ "Firebase using existing auth"
3. Firestore data should start loading automatically
4. All meter data queries should now work

---

## Testing

After updating rules, these should work:
- ✅ Dashboard shows Firebase meter data
- ✅ Opening Balance page displays December data
- ✅ Meter import saves to Firestore
- ✅ Console shows no "Missing or insufficient permissions" errors

---

## Quick Ref: Firebase Console URLs

- **Firestore Data**: https://console.firebase.google.com/project/the-green-haven/firestore/data
- **Firestore Rules**: https://console.firebase.google.com/project/the-green-haven/firestore/rules
- **Authentication**: https://console.firebase.google.com/project/the-green-haven/authentication/users

---

## Troubleshooting

### Still Getting "Missing or insufficient permissions"?
- Make sure rules are **Published** (not just saved)
- Wait 10-15 seconds for rules to propagate
- Refresh the page (Ctrl+F5)
- Check console for exact error message

### Can't access Firebase Console?
- Make sure you're logged in with the correct Google account
- Check that your account has owner/editor permissions on the Firebase project

---

## Code Changes Made

- `dashboard.html` (line 165-181): Now uses existing authenticated user instead of trying anonymous sign-in
- `config/firestore.rules`: New file with proper Firestore security rules
- `config/firebase.json`: Updated to include Firestore rules path
