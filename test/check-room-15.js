/**
 * Check Room 15 Status in Firebase
 * Verifies if room 15 data exists in Firebase and prompts to create if missing
 */

async function checkAndPopulateRoom15() {
  console.log('\n🔍 Checking Room 15 status in Firebase...\n');

  if (!window.firebase || !window.firebaseRef || !window.firebaseGet) {
    console.warn('⚠️ Firebase not fully initialized yet');
    return false;
  }

  try {
    const db = window.firebaseDatabase;
    const room15Ref = window.firebaseRef(db, 'data/rooms/15');
    const snapshot = await window.firebaseGet(room15Ref);

    if (snapshot.exists()) {
      const data = snapshot.val();
      console.log('✅ Room 15 data EXISTS in Firebase');
      console.log('   Tenant: ' + (data.tenantName || 'N/A'));
      console.log('   Status: ' + (data.status || 'N/A'));
      console.log('   Rent: ฿' + (data.rentAmount || 0).toLocaleString('th-TH'));
      return true;
    } else {
      console.warn('⚠️ Room 15 data NOT FOUND in Firebase');
      console.log('   Path checked: /data/rooms/15');
      console.log('   Available paths:');
      console.log('   - /data/rooms/15 ← MISSING');
      console.log('   - /meta_data/15 ← MISSING');
      console.log('\n📌 To populate room 15 data, run:');
      console.log('   populateRoom15Data()');
      return false;
    }
  } catch (error) {
    console.error('❌ Error checking room 15:', error.message);
    return false;
  }
}

// Check on page load (wait for Firebase init)
console.log('📌 Room 15 Status Check Script Loaded');

// Schedule check after Firebase is ready
if (typeof window.firebaseInitPromise !== 'undefined') {
  window.firebaseInitPromise.then(() => {
    setTimeout(() => checkAndPopulateRoom15(), 500);
  });
}
