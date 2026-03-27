#!/usr/bin/env node
/**
 * Upload real bills to Firebase Realtime Database
 * Usage: node upload-bills-to-firebase.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Firebase config - Load API key from environment variable
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAHbEbYZtiHLmxNzBXkNv3P_latd5HnfXM", // Use env var if available
  databaseURL: "https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app"
};

if (!process.env.FIREBASE_API_KEY) {
  console.warn('⚠️ WARNING: FIREBASE_API_KEY not set in environment. Using fallback key.');
  console.warn('⚠️ For production, set: export FIREBASE_API_KEY="your-key"');
}

// Load bills
const billsData = JSON.parse(fs.readFileSync('real-bills-generated.json', 'utf8'));
const bills = billsData.bills;

console.log(`📊 Loaded ${bills.length} bills from real-bills-generated.json`);

// Group bills by building and roomId
const billsByBuildingRoom = {};
bills.forEach(bill => {
  const building = bill.building;
  const roomId = bill.roomId;
  
  if (!billsByBuildingRoom[building]) {
    billsByBuildingRoom[building] = {};
  }
  if (!billsByBuildingRoom[building][roomId]) {
    billsByBuildingRoom[building][roomId] = [];
  }
  billsByBuildingRoom[building][roomId].push(bill);
});

console.log(`📦 Organized into buildings/rooms:`);
Object.entries(billsByBuildingRoom).forEach(([building, rooms]) => {
  const roomCount = Object.keys(rooms).length;
  const billCount = Object.values(rooms).reduce((sum, r) => sum + r.length, 0);
  console.log(`   ${building}: ${roomCount} rooms, ${billCount} bills`);
});

// Upload function
function uploadBillsToFirebase() {
  let uploadedCount = 0;
  let errorCount = 0;

  Object.entries(billsByBuildingRoom).forEach(([building, rooms]) => {
    Object.entries(rooms).forEach(([roomId, roomBills]) => {
      // Prepare data structure: bills/{building}/{roomId}
      const billsData = {};
      roomBills.forEach(bill => {
        billsData[bill.billId] = bill;
      });

      const path = `/bills/${building}/${roomId}.json`;
      const url = new URL(firebaseConfig.databaseURL + path);
      url.searchParams.append('auth', firebaseConfig.apiKey);

      const data = JSON.stringify(billsData);
      
      const options = {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(url, options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            uploadedCount++;
            console.log(`✅ Uploaded bills for ${building}/${roomId} (${roomBills.length} bills)`);
          } else {
            errorCount++;
            console.error(`❌ Failed to upload ${building}/${roomId}: ${res.statusCode}`);
            console.error(`   Response: ${responseData.substring(0, 200)}`);
          }
        });
      });

      req.on('error', (err) => {
        errorCount++;
        console.error(`❌ Error uploading ${building}/${roomId}: ${err.message}`);
      });

      req.write(data);
      req.end();
    });
  });

  // Summary after a delay
  setTimeout(() => {
    console.log(`\n📊 Upload Summary:`);
    console.log(`   ✅ Successful: ${uploadedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📈 Total: ${bills.length} bills`);
  }, 5000);
}

console.log(`\n🚀 Starting upload to Firebase...`);
uploadBillsToFirebase();
