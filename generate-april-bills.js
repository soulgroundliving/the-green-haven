#!/usr/bin/env node
/**
 * Generate April Bills Immediately
 * Usage: node generate-april-bills.js
 *
 * This script:
 * 1. Reads meter data from Firebase for April (month 4, year 2569)
 * 2. Generates bills for all rooms with meter data
 * 3. Saves bills to Firebase at bills/{building}/{room}/{billId}
 * 4. Makes April bills immediately visible to tenants
 */

const https = require('https');
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccountPath = process.env.FIREBASE_KEY_PATH || './service-account-key.json';
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://the-green-haven-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();

async function generateAprilBills() {
  try {
    console.log('\n🚀 ===== APRIL BILL GENERATOR =====\n');

    const building = 'rooms'; // Old building
    const month = 4; // April
    const year = 2569; // Buddhist year
    const yy = year % 100; // 69
    const yearMonth = `${yy}_${String(month).padStart(2, '0')}`; // "69_04"

    console.log(`📊 Building: ${building}`);
    console.log(`📅 Month: April (${yearMonth})`);
    console.log(`📍 Looking for meter data at: meter_data/${building}/${yearMonth}/*\n`);

    // Get all meter data for April
    const meterSnap = await db.ref(`meter_data/${building}/${yearMonth}`).once('value');
    const meterDataMap = meterSnap.val();

    if (!meterDataMap) {
      console.error(`❌ No meter data found for ${building}/${yearMonth}`);
      console.log('\n   Make sure meter data is uploaded first!');
      process.exit(1);
    }

    const roomIds = Object.keys(meterDataMap);
    console.log(`✅ Found meter data for ${roomIds.length} rooms\n`);
    console.log(`   Rooms: ${roomIds.slice(0, 5).join(', ')}${roomIds.length > 5 ? '...' : ''}\n`);

    let generatedCount = 0;
    const billIds = [];

    // Generate bill for each room
    for (const [roomId, meterData] of Object.entries(meterDataMap)) {
      try {
        // Get room configuration
        const roomConfigSnap = await db.ref(`rooms_config/${building}/${roomId}`).once('value');
        const roomConfig = roomConfigSnap.val() || {};

        // Calculate bill
        const rent = roomConfig.rent || 1200;
        const eRate = roomConfig.elecRate || 8;
        const wRate = 20;
        const trash = roomConfig.trashFee || 20;

        const eUnits = Math.max(0, (meterData.eNew || 0) - (meterData.eOld || 0));
        const wUnits = Math.max(0, (meterData.wNew || 0) - (meterData.wOld || 0));
        const eCost = eUnits * eRate;
        const wCost = wUnits * wRate;
        const total = rent + eCost + wCost + trash;

        // Create bill ID
        const now = new Date();
        const billId = `TGH-${year}${String(month).padStart(2, '0')}-${roomId}-${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        // Build bill object
        const billObject = {
          billId,
          room: roomId,
          building: 'เดอะ กรีน เฮฟเว่น',
          month,
          year,
          status: 'pending',
          billDate: new Date().toISOString().split('T')[0],
          totalCharge: total,
          charges: {
            rent,
            rentLabel: 'ค่าเช่าห้อง',
            electric: {
              cost: eCost || 0,
              old: meterData.eOld || 0,
              new: meterData.eNew || 0,
              units: eUnits || 0,
              rate: eRate || 8
            },
            water: {
              cost: wCost || 0,
              old: meterData.wOld || 0,
              new: meterData.wNew || 0,
              units: wUnits || 0,
              rate: wRate || 20
            },
            trash: trash || 0,
            common: 0
          },
          meterReadings: {
            electric: { old: meterData.eOld || 0, new: meterData.eNew || 0, units: eUnits || 0 },
            water: { old: meterData.wOld || 0, new: meterData.wNew || 0, units: wUnits || 0 }
          },
          note: '',
          createdAt: now.toISOString()
        };

        // Save to Firebase
        await db.ref(`bills/${building}/${roomId}/${billId}`).set(billObject);

        generatedCount++;
        billIds.push(billId);
        console.log(`✅ ${roomId.padEnd(5)} | ฿${total.toString().padStart(6)} | ${billId}`);
      } catch (e) {
        console.error(`❌ ${roomId}: ${e.message}`);
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ SUCCESS! Generated ${generatedCount} April bills`);
    console.log(`📍 Saved to: bills/${building}/{roomId}/${billId}`);
    console.log(`${'='.repeat(60)}\n`);

    console.log('📱 Tenant app will show April bills after refresh!\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateAprilBills();
