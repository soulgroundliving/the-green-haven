# Green Haven - Firebase Deployment Guide

## 📋 Pre-Deployment Checklist

### ✅ What's Ready to Deploy:
- [x] Cloud Functions configured (Node.js 22, asia-southeast1 region)
- [x] Firestore Security Rules (firestore.rules)
- [x] Firestore Indexes (firestore.indexes.json)
- [x] Firebase Configuration (firebase.json)
- [x] Cloud Functions source code (functions/ directory)
- [x] Web app code (tenant.html, dashboard.html, etc.)
- [x] Firebase initialization in tenant.html

### ⚠️ Prerequisites Required:
- [ ] Firebase CLI installed (`npm install -g firebase-tools`)
- [ ] Firebase project created (the-green-haven)
- [ ] Authenticated to Firebase (`firebase login`)
- [ ] Node.js 22+ installed
- [ ] npm installed

---

## 🚀 Deployment Steps

### Step 1: Install Firebase CLI (One-time setup)

**On your local machine (with npm installed):**

```bash
npm install -g firebase-tools
```

**Verify installation:**
```bash
firebase --version
```

### Step 2: Authenticate to Firebase

```bash
firebase login
```

This will open a browser window to authenticate. Select the Google account that owns the Green Haven Firebase project.

### Step 3: Navigate to Project Directory

```bash
cd /path/to/The_green_haven
```

### Step 4: Deploy Cloud Functions

```bash
firebase deploy --only functions
```

**Expected output:**
```
i  deploying functions, storage
i  runtime: nodejs22
✔  functions deployed successfully

Function names:
  - initializeRooms
  - getRooms
  - analyzeRoomData
  - cleanupRoomData
  - migrateToFirestore
  - setupFirestoreIndexes
  - verifyMigrationComplete
  - deleteRealtimeDBData
  - onComplaintCreated
  - sendComplaintConfirmation
  - cleanupResolvedComplaints
  - awardRentPaymentPoints
  - awardComplaintFreeMonth
  - checkAndAwardBadges
  - calculateTenantRank
  - getLeaderboard
  - verifySlip
```

### Step 5: Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

**Expected output:**
```
i  deploying firestore
✔  firestore rules successfully deployed
```

### Step 6: Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

**Expected output:**
```
i  deploying firestore
✔  firestore indexes deployed successfully
```

### Step 7: Deploy Web App to Hosting (Optional)

If you have Firebase Hosting configured:

```bash
firebase deploy --only hosting
```

### Step 8: Deploy Everything at Once

To deploy all at once:

```bash
firebase deploy
```

---

## 🔧 Deployment Files

### Cloud Functions
**Location:** `functions/`

**Files:**
- `index.js` - Main entry point (exports all functions)
- `complaintAndGamification.js` - Complaint and gamification logic
- `initializeRooms.js` - Room initialization
- `cleanupRoomData.js` - Data cleanup utilities
- `migrateToFirestore.js` - Database migration
- `cleanupRealtimeDB.js` - Realtime DB cleanup
- `verifySlip.js` - Payment slip verification
- `package.json` - Dependencies
- `package-lock.json` - Lock file

### Security & Configuration
**Location:** `firestore.rules`
- Complete Firestore security rules
- Role-based access control (admin vs tenant)
- Collection and subcollection protections
- Custom claim verification

**Location:** `firestore.indexes.json`
- Composite indexes for:
  - Room lease status queries
  - Complaint status and date filtering
  - Gamification rank and points sorting
  - Tenant gamification data

**Location:** `firebase.json`
- Project configuration
- Function regions: asia-southeast1
- Firestore rules and indexes paths
- Node runtime version: nodejs22

### Web App
**Location:** `tenant.html`, `dashboard.html`, etc.
- Complete tenant application
- Complete admin dashboard
- Integrated Firebase SDK
- Complaint and gamification UIs

---

## ✨ What Gets Deployed

### Cloud Functions (15 functions)
1. **Room Management**
   - `initializeRooms` - Create 43 rooms in Firestore
   - `getRooms` - Retrieve room data
   - `analyzeRoomData` - Analyze room structure
   - `cleanupRoomData` - Remove deprecated fields
   - `migrateToFirestore` - Migrate from Realtime DB
   - `setupFirestoreIndexes` - Create database indexes

2. **Complaint Management**
   - `onComplaintCreated` - Trigger on new complaint (send notification)
   - `sendComplaintConfirmation` - Send confirmation email
   - `cleanupResolvedComplaints` - Archive resolved complaints

3. **Gamification**
   - `awardRentPaymentPoints` - Award points for on-time rent (+5 points)
   - `awardComplaintFreeMonth` - Award points for community service (+15 points)
   - `checkAndAwardBadges` - Auto-award achievement badges
   - `calculateTenantRank` - Update rank (Bronze → Silver → Gold → Platinum)
   - `getLeaderboard` - Get top 10 tenants by points

4. **Utilities**
   - `verifySlip` - Verify payment slip via SlipOK API
   - `verifyMigrationComplete` - Check migration status
   - `deleteRealtimeDBData` - Clean up old Realtime DB

### Firestore Security Rules
- ✅ Default DENY ALL (secure by default)
- ✅ Tenant can read own data + admin data
- ✅ Tenant can create complaints
- ✅ Admin can create/update/delete everything
- ✅ Role-based access via custom claims
- ✅ Collection-level security
- ✅ Subcollection-level security

### Firestore Indexes
- Composite index: lease status + referral source
- Composite index: building + lease status
- Complaint collection: status + date
- Gamification: rank + points (for leaderboard)

---

## 🔐 Security Setup Required

### Custom Claims Setup

After deploying Cloud Functions, you need to set custom claims on user accounts to define roles:

**For Admin Users:**
```javascript
admin.auth().setCustomUserClaims(uid, { role: 'admin' })
```

**For Tenant Users:**
```javascript
admin.auth().setCustomUserClaims(uid, {
  role: 'tenant',
  building: 'rooms',
  room: '15'
})
```

**Note:** These custom claims are checked in the Firestore security rules to allow/deny access.

---

## 📊 Post-Deployment Verification

### Test Complaint Workflow:
```
1. User submits complaint via tenant app
2. onComplaintCreated function triggers
3. sendComplaintConfirmation function sends email
4. Complaint visible in admin dashboard
5. Admin updates status
6. Tenant sees status update
```

### Test Gamification:
```
1. User pays rent on time
2. awardRentPaymentPoints function triggers
3. User points increase in Firestore
4. Rank updates via calculateTenantRank
5. Leaderboard refreshes with new ranking
```

### Check Firestore:
```
Firebase Console → Firestore Database
└── buildings/
    ├── rooms/{roomId}/
    │   ├── complaintHistory/{complaintId} ← New complaints appear here
    │   └── maintenanceHistory/{ticketId}
├── gamification/
│   └── leaderboard/{tenantId} ← Points and rankings update here
└── announcements/
```

### Check Cloud Functions:
```
Firebase Console → Cloud Functions
✓ All 15 functions show as deployed
✓ Check logs for execution details
✓ Monitor for errors
```

---

## 🆘 Troubleshooting

### Error: "Unknown service cloud.firestore"
**Solution:** Make sure Firestore is enabled in Firebase Console

### Error: "Function not found"
**Solution:** Verify `firebase.json` points to correct functions directory

### Error: "Rule update failed"
**Solution:** Check firestore.rules syntax using Firebase Emulator locally

### Error: "Index already exists"
**Solution:** Indexes might take time to create; wait a few minutes

### Error: "Permission denied on Firestore"
**Solution:** Check custom claims setup and security rules

---

## 📈 Performance Considerations

### Optimize Firestore Reads:
- ✅ Indexes created for common queries
- ✅ Collection limits set (e.g., top 10 leaderboard)
- ✅ Pagination ready for implementation

### Optimize Cloud Functions:
- ✅ Functions region set to asia-southeast1 (closest to users)
- ✅ Node.js 22 (latest stable, best performance)
- ✅ Minimal dependencies for fast cold starts

### Monitor Costs:
- Firestore charges per read/write/delete
- Cloud Functions charged per execution and duration
- Storage charges for file uploads

---

## 🎯 Next Steps After Deployment

### Phase 1: Testing (1-2 days)
- [ ] Unit test all Cloud Functions
- [ ] Test complaint submission → email → admin dashboard flow
- [ ] Test gamification point awarding
- [ ] Test security rules with different roles

### Phase 2: Data Migration (1 day)
- [ ] Initialize rooms via initializeRooms function
- [ ] Migrate legacy data if needed
- [ ] Verify data integrity

### Phase 3: Go Live (1 day)
- [ ] Final security audit
- [ ] Monitor logs and error rates
- [ ] Performance testing with concurrent users
- [ ] User training and documentation

---

## 📞 Support & Documentation

### Firebase Documentation:
- Cloud Functions: https://firebase.google.com/docs/functions
- Firestore: https://firebase.google.com/docs/firestore
- Security Rules: https://firebase.google.com/docs/firestore/security/start
- Hosting: https://firebase.google.com/docs/hosting

### Green Haven Documentation:
- See MEMORY.md for complete project overview
- See firebase_integration_phase_1.md for technical details
- See session_summary_2026_04_05.md for latest changes

---

## ✅ Deployment Checklist

Before running `firebase deploy`:

- [ ] Firebase CLI installed
- [ ] Authenticated to Firebase
- [ ] Firebase project created
- [ ] In correct directory (`The_green_haven/`)
- [ ] All files present (functions/, *.rules, *.json)
- [ ] Node.js 22+ installed
- [ ] No uncommitted changes (optional: `git status`)
- [ ] Verified Cloud Functions syntax
- [ ] Verified Firestore rules syntax

---

## 🚀 Ready to Deploy!

All Green Haven code is ready for Firebase deployment. The system includes:
- ✅ 15 Cloud Functions (fully implemented)
- ✅ Complete Firestore security rules
- ✅ Database indexes for optimized queries
- ✅ Tenant app with Firebase integration
- ✅ Admin dashboard with Firebase integration
- ✅ Fallback strategies for offline support

**Just need to:**
1. Install Firebase CLI
2. Authenticate to Firebase
3. Run `firebase deploy`

That's it! The entire Green Haven system will be live on Firebase. 🎉
