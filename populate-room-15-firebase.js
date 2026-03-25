/**
 * Populate Room 15 Data to Firebase
 * Creates lease agreement and tenant metadata for room 15 in Realtime Database
 * Run this in browser console after Firebase is initialized
 */

async function populateRoom15Data() {
  console.log('🔄 Populating Room 15 data to Firebase Realtime Database...\n');

  if (!window.firebase || !window.firebaseRef || !window.firebaseSet) {
    console.error('❌ Firebase not initialized. Make sure Firebase scripts are loaded.');
    return false;
  }

  try {
    const db = window.firebaseDatabase;

    // Room 15 tenant data (matching the user from test data)
    const room15LeaseData = {
      id: '15',
      building: 'rooms',
      roomId: '15',
      tenantId: 'tenant15@test.com',
      tenantName: 'Tenant 15',
      tenantPhone: '089-123-4515',
      tenantEmail: 'tenant15@test.com',
      moveInDate: '2026-01-01',
      moveOutDate: null,
      rentAmount: 5900,
      deposit: 3000,
      status: 'active',
      contractStartDate: '2026-01-01',
      contractEndDate: '2027-01-01',
      contractDocument: null,
      notes: 'Active lease for room 15',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Path: /data/rooms/15
    console.log('📝 Setting lease data at /data/rooms/15...');
    const dataRef = window.firebaseRef(db, 'data/rooms/15');
    await window.firebaseSet(dataRef, room15LeaseData);
    console.log('✅ Room 15 lease data saved to Firebase');

    // Also save to /meta_data/15 for Firestore compatibility
    console.log('\n📝 Setting metadata at /meta_data/15...');
    const metaRef = window.firebaseRef(db, 'meta_data/15');
    await window.firebaseSet(metaRef, room15LeaseData);
    console.log('✅ Room 15 metadata saved to Firebase');

    // Verify the data was saved
    console.log('\n✔️ Verifying data...');
    const verifyRef = window.firebaseRef(db, 'data/rooms/15');
    const snapshot = await window.firebaseGet(verifyRef);
    if (snapshot.exists()) {
      const savedData = snapshot.val();
      console.log('✅ Verification successful! Room 15 data:');
      console.log({
        roomId: savedData.roomId,
        tenantName: savedData.tenantName,
        rentAmount: savedData.rentAmount,
        status: savedData.status
      });
      return true;
    } else {
      console.warn('⚠️ Data verification failed - data not found after save');
      return false;
    }

  } catch (error) {
    console.error('❌ Error populating room 15 data:', error);
    return false;
  }
}

// Auto-run on load
console.log('📌 Room 15 Firebase Population Script Loaded');
console.log('Run: populateRoom15Data() in console to populate\n');

// If Firebase is already ready, run immediately
if (window.firebase && window.firebaseRef && window.firebaseSet) {
  console.log('✅ Firebase detected - you can run populateRoom15Data() now');
}
