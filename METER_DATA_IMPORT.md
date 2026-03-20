# Meter Data Import Guide

This guide explains how to extract meter data from Excel billing files and import them into Firebase Firestore.

## Overview

The process consists of two main steps:

1. **Extract**: Python script reads Excel files (บิลปี67, 68, 69) and extracts meter readings into JSON
2. **Upload**: Node.js script uploads the JSON data to Firebase Firestore

## Files Involved

### Input Excel Files
- `บิลปี67.xlsx` - Year 67 (2024)
- `บิลปี68.xlsx` - Year 68 (2025)
- `บิลปี69.xlsx` - Year 69 (2025-2026)

Each file contains:
- **Sheet 1 (EX)**: Reference data (skipped during import)
- **Sheets 2-13**: Monthly data (Months 1-12)

### Output Files
- `meter_data_export.json` - Extracted data in Firebase-ready format
- `meter_data_export.json.bak` - Backup of previous export (if needed)

### Scripts
- `extract_and_upload_meter_data.py` - Python extraction script
- `upload_to_firebase.js` - Node.js Firebase upload script

## Step 1: Extract Meter Data

### Prerequisites
- Python 3.7+
- `openpyxl` library

```bash
# Install openpyxl if not already installed
pip install openpyxl
```

### Running the Extraction

```bash
cd /path/to/The_green_haven
python extract_and_upload_meter_data.py
```

### Output

The script will:
1. Read all three Excel files
2. Extract meter readings from sheets 2-13 (months 1-12)
3. Generate `meter_data_export.json` with 621 records

Expected output:
```
Processing: บิลปี67.xlsx (Year 67)
  Total sheets: 13
    Month 1: 23 rooms
    Month 2: 23 rooms
    ...
  OK: บิลปี67.xlsx

Processing: บิลปี68.xlsx (Year 68)
  ...

Processing: บิลปี69.xlsx (Year 69)
  ...

============================================================
EXTRACTION REPORT
============================================================

Total documents extracted: 621

Records by Year and Month:
  Year 67, Month 1: 23 rooms
  ...
```

### Data Format

Each extracted record has this structure:

```json
{
  "building": "rooms",
  "year": 67,
  "month": 1,
  "roomId": "13",
  "wOld": 1577.0,
  "wNew": 2628.0,
  "eOld": 1575.0,
  "eNew": 1577.0,
  "createdAt": "2026-03-19T14:21:58.280897",
  "updatedAt": "2026-03-19T14:21:58.280953"
}
```

**Fields:**
- `building`: Either "rooms" or "nest" (determined by room ID prefix)
- `year`: Buddhist year as 2-digit number (67, 68, 69)
- `month`: Month number 1-12
- `roomId`: Room identifier (e.g., "13", "15ก")
- `wOld`: Previous water meter reading
- `wNew`: Current water meter reading
- `eOld`: Previous electric meter reading
- `eNew`: Current electric meter reading
- `createdAt`: ISO timestamp when record was created
- `updatedAt`: ISO timestamp when record was last updated

## Step 2: Upload to Firebase

### Prerequisites

You need Firebase Admin SDK credentials. Set up one of:

**Option A: Service Account Key File**
```bash
export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json
```

**Option B: Service Account JSON in Environment Variable**
```bash
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"the-green-haven-d9b20",...}'
```

**Option C: Default Credentials (Google Cloud Environment)**
If running in Google Cloud, default credentials will be used automatically.

### Installation

```bash
# Install Firebase Admin SDK
npm install firebase-admin dotenv
```

### Running the Upload

```bash
# Dry run (preview without uploading)
node upload_to_firebase.js --dry-run

# Actual upload
node upload_to_firebase.js

# Custom batch size
node upload_to_firebase.js --batch-size=100
```

### Output

Example dry run output:
```
╔═══════════════════════════════════════════════════════╗
║     Firebase Meter Data Upload                         ║
║     Project: the-green-haven                           ║
╚═══════════════════════════════════════════════════════╝

Initializing Firebase...
✓ Firebase initialized with service account key

Loading meter data...
✓ Loaded 621 records from meter_data_export.json

Uploading 621 documents to Firestore...
Batch size: 50
Collection: meter_data

--- DRY RUN MODE ---

[DRY] Document: rooms_67_1_15ก
      {
        "building": "rooms",
        "year": 67,
        "month": 1,
        "roomId": "15ก",
        ...
      }

============================================================
UPLOAD REPORT
============================================================

Mode: DRY RUN (no data was uploaded)

Total records processed: 621
...
```

### Firestore Collection Structure

Documents are stored in the `meter_data` collection with document IDs following this pattern:

```
{building}_{year}_{month}_{roomId}

Examples:
- rooms_67_1_13
- rooms_67_1_14
- nest_67_1_N101
```

## Excel File Structure

### Column Mapping

| Column | Header | Data |
|--------|--------|------|
| A | Room ID | 13, 14, 15, ..., 33, 15ก |
| B | Water Current | Current water meter reading |
| C | Water Previous | Previous water meter reading |
| D-K | (various calculations) | - |
| L | Electric Current | References column C (formula) |
| M | Electric Previous | Previous electric meter reading |
| N-U | (various calculations) | - |

### Room IDs

The Excel files contain 23 rooms per month:
- Numeric rooms: 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33
- Special room: 15ก

All numeric rooms are classified as "rooms" building.
Rooms starting with 'N' would be classified as "nest" building (not present in current data).

## Troubleshooting

### Issue: "File not found" error

**Solution**: Ensure you're running the script from the project root directory where the Excel files are located.

```bash
cd /path/to/The_green_haven
python extract_and_upload_meter_data.py
```

### Issue: Firebase initialization failed

**Solution**: Check your credentials setup:

```bash
# Check if service account key exists
ls -l serviceAccountKey.json

# Check environment variables
echo $FIREBASE_SERVICE_ACCOUNT_PATH
echo $FIREBASE_SERVICE_ACCOUNT_JSON
```

### Issue: Some months have 0 rooms

**Explanation**: Year 69 only has 3 months of complete data (months 1-3). Months 4-12 are empty sheets in the source file. This is expected behavior.

### Issue: Batch upload timing out

**Solution**: Reduce the batch size:

```bash
node upload_to_firebase.js --batch-size=25
```

## Data Validation

The extraction script skips rows that:
- Have empty room IDs
- Have missing water meter readings
- Have invalid numeric values

The upload script validates that each document has:
- All required fields (building, year, month, roomId, wOld, wNew, eOld, eNew)
- Valid values (no null/undefined)

## Backup and Recovery

Before running the upload, the JSON data is saved to `meter_data_export.json`. This file serves as:

1. **Verification**: You can review the data before upload
2. **Backup**: If something goes wrong, you can re-upload from this file
3. **Audit Trail**: Timestamp shows when extraction occurred

To recover from a failed upload:

```bash
# The JSON file is still intact, just re-run the upload
node upload_to_firebase.js
```

## Manual Verification

To verify extracted data before uploading:

```bash
# View first 5 records
python -c "
import json
with open('meter_data_export.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    for rec in data['data'][:5]:
        print(rec)
"
```

## Performance Notes

- Extraction: ~2-5 seconds for all 3 files (621 records)
- Upload with batch size 50: ~5-10 seconds (depends on network)
- Firestore write quota: 50,000 writes/day (681 writes per full import)

## Support

For issues with:
- **Excel parsing**: Check that files are in proper Excel format and not corrupted
- **Firebase credentials**: Verify you have a valid service account key
- **Data validation**: Review error messages in the console output
