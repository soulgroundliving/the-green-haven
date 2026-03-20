================================================================================
METER DATA EXTRACTION AND FIREBASE IMPORT
The Green Haven - Apartment Management System
================================================================================

PROJECT STATUS: COMPLETE AND READY FOR UPLOAD
Extraction Date: 2026-03-19
Total Records: 621 (Years 67, 68, 69)

================================================================================
FILES CREATED
================================================================================

1. meter_data_export.json (187 KB)
   - Extracted meter data for all rooms and months
   - Ready for Firebase Firestore import
   - 621 complete records with zero errors

2. extract_and_upload_meter_data.py (7.5 KB)
   - Python 3 script for extracting meter data from Excel files
   - Reads: บิลปี67.xlsx, บิลปี68.xlsx, บิลปี69.xlsx
   - Run: python extract_and_upload_meter_data.py

3. upload_to_firebase.js (8.8 KB)
   - Node.js script for uploading JSON to Firebase Firestore
   - Requires: Firebase Admin SDK credentials
   - Run: node upload_to_firebase.js

4. Documentation
   - METER_DATA_IMPORT.md: Complete technical guide
   - QUICK_START.md: Quick reference (3 steps)
   - EXTRACTION_COMPLETE.md: Full project report
   - README_METER_IMPORT.txt: This file

================================================================================
QUICK START (3 STEPS)
================================================================================

Step 1: Extract Data
  python extract_and_upload_meter_data.py
  Output: meter_data_export.json

Step 2: Setup Firebase Credentials
  export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json

Step 3: Upload to Firebase
  npm install firebase-admin dotenv
  node upload_to_firebase.js --dry-run
  node upload_to_firebase.js

================================================================================
DATA SUMMARY
================================================================================

Total Records: 621

Distribution:
  - Year 67 (2024): 276 records (23 rooms x 12 months)
  - Year 68 (2025): 276 records (23 rooms x 12 months)
  - Year 69 (2025-2026): 69 records (23 rooms x 3 months)

Rooms: 15ก, 13-33, ร้านใหญ่ (23 per month)

Firebase Collection: meter_data
Document ID Pattern: {building}_{year}_{month}_{roomId}
Example: rooms_67_1_13

================================================================================
DATA FIELDS (per document)
================================================================================

building:  "rooms" or "nest" (auto-detected from room ID)
year:      Buddhist year (67, 68, 69)
month:     Month number (1-12)
roomId:    Room identifier (e.g., "13", "15ก")
wOld:      Previous water meter reading
wNew:      Current water meter reading
eOld:      Previous electric meter reading
eNew:      Current electric meter reading
createdAt: ISO timestamp
updatedAt: ISO timestamp

================================================================================
FIREBASE UPLOAD INSTRUCTIONS
================================================================================

Get Credentials:
  1. Firebase Console > Project Settings
  2. Service Accounts tab
  3. Generate New Private Key
  4. Save as serviceAccountKey.json

Setup:
  export FIREBASE_SERVICE_ACCOUNT_PATH=/full/path/to/serviceAccountKey.json

Install:
  npm install firebase-admin dotenv

Test:
  node upload_to_firebase.js --dry-run

Upload:
  node upload_to_firebase.js

Verify:
  Firebase Console > Firestore Database > Collections > meter_data
  Should show 621 documents

================================================================================
TROUBLESHOOTING
================================================================================

Python: "No module named openpyxl"
  Fix: pip install openpyxl

Python: "File not found"
  Fix: cd /c/Users/usEr/Downloads/The_green_haven

Node.js: "Cannot find module 'firebase-admin'"
  Fix: npm install firebase-admin dotenv

Node.js: "Firebase not initialized"
  Fix: Check FIREBASE_SERVICE_ACCOUNT_PATH environment variable

Firebase upload error:
  Check: Internet connection, credentials validity, project ID

================================================================================
DOCUMENTATION
================================================================================

METER_DATA_IMPORT.md - Complete technical guide
QUICK_START.md - 3-step quick reference
EXTRACTION_COMPLETE.md - Full project report

================================================================================
NEXT ACTIONS
================================================================================

1. Get Firebase service account credentials
2. Run: node upload_to_firebase.js --dry-run
3. Verify output shows 621 records
4. Run: node upload_to_firebase.js
5. Confirm in Firebase Console

================================================================================
Version: 1.0
Status: READY FOR PRODUCTION
================================================================================
