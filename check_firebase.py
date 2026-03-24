import firebase_admin
from firebase_admin import db, credentials
import json

# Load credentials
cred = credentials.Certificate('./config/firebase.json')
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://the-green-haven-default-rtdb.firebaseio.com'
})

# Get meter readings for room 13, year 69
ref = db.reference('meterReadings')
all_data = ref.get()

if all_data:
    print("=== Firebase Meter Data - Room 13, Year 69 ===\n")
    
    results = []
    for key, value in all_data.items():
        if value.get('roomId') == '13' and value.get('year') == 69:
            results.append((value.get('month', 0), value))
    
    results.sort()
    for month, value in results:
        month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        print(f"{month_names[month]} 2569:")
        print(f"  Water: OLD={value.get('wOld')} → NEW={value.get('wNew')} (Usage = {value.get('wNew', 0) - value.get('wOld', 0)})")
        print(f"  Electric: OLD={value.get('eOld')} → NEW={value.get('eNew')} (Usage = {value.get('eNew', 0) - value.get('eOld', 0)})")
        print()
else:
    print("No data found in Firebase")
