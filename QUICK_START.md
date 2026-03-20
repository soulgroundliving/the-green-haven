# Quick Start: Meter Data Import

## Step 1: Extract Data (Python)

```bash
python extract_and_upload_meter_data.py
```

This creates `meter_data_export.json` with 621 meter records.

## Step 2: Prepare Firebase Credentials

Set up one of these:

### Option A: Service Account Key File
```bash
export FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/serviceAccountKey.json
```

### Option B: Environment Variable
```bash
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
```

## Step 3: Upload to Firebase

```bash
# Install dependencies (first time only)
npm install firebase-admin dotenv

# Dry run (preview)
node upload_to_firebase.js --dry-run

# Actual upload
node upload_to_firebase.js
```

## Data Summary

- **Total Records**: 621
- **Years**: 67, 68, 69 (Buddhist calendar)
- **Months**: 1-12
- **Rooms**: 23 per month
- **Firestore Collection**: `meter_data`
- **Document ID Pattern**: `{building}_{year}_{month}_{roomId}`

Example:
```
rooms_67_1_13
rooms_67_1_14
rooms_67_1_15
...
nest_68_2_N101
```

## Files Generated

| File | Purpose |
|------|---------|
| `meter_data_export.json` | Extracted data (621 records) |
| Console output | Progress and validation logs |

## Verification

Check the JSON file before uploading:

```bash
# View first record
python -c "import json; d=json.load(open('meter_data_export.json')); print(json.dumps(d['data'][0], indent=2))"

# Count records by year
python -c "import json; d=json.load(open('meter_data_export.json')); 
by_year = {}; 
[by_year.update({r['year']: by_year.get(r['year'], 0)+1}) for r in d['data']]; 
print(by_year)"
```

## Troubleshooting

### Python: Module not found
```bash
pip install openpyxl
```

### Node.js: Firebase not initialized
Check credentials are set correctly - see METER_DATA_IMPORT.md for details

### Verification issue
Ensure you're in the project root directory
