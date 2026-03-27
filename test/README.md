# Test & Debug Files

This directory contains test and initialization scripts used for development and debugging purposes.

## Files

### Data Initialization
- **init-real-bills.js** - Load real bill data from JSON files
- **init-test-data.js** - Initialize mock test data for demo/testing
- **init-payment-records.js** - Create payment records for bills

### Firebase Population
- **populate-room-15-firebase.js** - Populate Firebase with room 15 demo data
- **check-room-15.js** - Verify room 15 data in Firebase

### Utilities
- **mark-bills-paid.js** - Mark old bills as paid (for fresh testing)

## Usage

These scripts are automatically loaded in `tenant.html` and run during initialization:

```html
<script src="./test/init-real-bills.js"></script>
<script src="./test/init-test-data.js"></script>
<script src="./test/init-payment-records.js"></script>
```

### Disabling Test Scripts

To disable test initialization in production:
1. Comment out the script tags in `tenant.html`
2. Or wrap the initialization code in a development check:
```javascript
if (typeof isDevelopment !== 'undefined' && isDevelopment) {
  // run test initialization
}
```

### When to Use

- **Development**: All test files enabled for full functionality testing
- **Staging**: Keep enabled to test with sample data
- **Production**: Disable or remove test files, use real data only

## Notes

- Test files use localStorage and Firebase to persist test data
- Safe to delete after confirming real data sync is working
- Do not commit personal or sensitive test data to these files
