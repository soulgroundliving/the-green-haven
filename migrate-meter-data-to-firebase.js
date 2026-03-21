/**
 * METER_DATA Migration Script
 *
 * USAGE (ใช้ใน browser console ของ dashboard.html):
 *
 * 1. เปิด dashboard.html
 * 2. Ctrl+Shift+J เปิด Console
 * 3. Paste code นี้ แล้ว Enter
 *
 * Script นี้จะ:
 * - อ่าน METER_DATA จากไฟล์
 * - อัพโหลดไป Firebase
 * - Log ความ progress
 */

async function migrateMeterDataToFirebase() {
  console.log('🚀 Starting METER_DATA migration to Firebase...');

  if (!window.METER_DATA) {
    console.error('❌ METER_DATA not found in window');
    return;
  }

  if (!window.firebase || !window.firebase.firestore) {
    console.error('❌ Firebase not initialized');
    return;
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;

  let uploadCount = 0;
  let errorCount = 0;

  // Iterate through buildings
  for (const building of Object.keys(window.METER_DATA)) {
    console.log(`\n📦 Processing building: ${building}`);
    const buildingData = window.METER_DATA[building];

    // Iterate through months
    for (const yearMonth of Object.keys(buildingData)) {
      const monthData = buildingData[yearMonth];

      try {
        // Create document reference
        const monthCollection = fs.collection(
          fs.collection(db, `meter_data/${building}`),
          yearMonth
        );

        const docRef = fs.doc(monthCollection, 'data');

        // Upload data
        await fs.setDoc(docRef, monthData, { merge: false });

        uploadCount++;
        console.log(`  ✅ ${building}/${yearMonth} (${Object.keys(monthData).length} rooms)`);
      } catch (error) {
        errorCount++;
        console.error(`  ❌ ${building}/${yearMonth}:`, error.message);
      }

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n✨ Migration Complete!`);
  console.log(`  ✅ Uploaded: ${uploadCount} months`);
  console.log(`  ❌ Errors: ${errorCount}`);
  console.log(`\n📝 Next steps:`);
  console.log(`  1. Verify data in Firebase Console`);
  console.log(`  2. Update dashboard.html to use FirebaseMeterHelper`);
  console.log(`  3. Delete shared/meter_data.js`);
}

// Run migration
migrateMeterDataToFirebase().catch(error => {
  console.error('❌ Migration failed:', error);
});
