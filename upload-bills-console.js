/**
 * Upload Real Bills to Firebase Console Script
 *
 * Usage:
 * 1. Open dashboard.html in browser
 * 2. Open browser DevTools (F12)
 * 3. Paste this entire script into the console
 * 4. Press Enter
 * 5. It will fetch real-bills-generated.json and upload all 594 bills to Firebase
 *
 * Requirements: Must be logged in with admin account
 */

(async function uploadBillsToFirebase() {
  console.log('Starting real bills upload...');

  if (!window.firebaseDatabase) {
    console.error('ERROR: Firebase database not initialized');
    return;
  }

  try {
    // Fetch the real bills data
    console.log('Fetching real bills data...');
    const response = await fetch('./real-bills-generated.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const billsData = await response.json();
    const bills = billsData.bills;
    console.log(`Loaded ${bills.length} bills from real-bills-generated.json`);

    // Group bills by building and roomId
    const billsByBuildingRoom = {};
    bills.forEach(bill => {
      const building = bill.building;
      const roomId = bill.roomId;
      if (!billsByBuildingRoom[building]) billsByBuildingRoom[building] = {};
      if (!billsByBuildingRoom[building][roomId]) billsByBuildingRoom[building][roomId] = [];
      billsByBuildingRoom[building][roomId].push(bill);
    });

    console.log('Uploading bills to Firebase...');
    let uploadedCount = 0;
    let errorCount = 0;
    const startTime = Date.now();

    // Import Firebase functions
    const { ref: firebaseRef, set: firebaseSet } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js');
    const db = window.firebaseDatabase;

    // Upload each building/room's bills
    for (const building in billsByBuildingRoom) {
      for (const roomId in billsByBuildingRoom[building]) {
        const roomBills = billsByBuildingRoom[building][roomId];
        const billsPayload = {};

        roomBills.forEach(bill => {
          billsPayload[bill.billId] = bill;
        });

        try {
          const billsRef = firebaseRef(db, `bills/${building}/${roomId}`);
          await firebaseSet(billsRef, billsPayload);
          uploadedCount++;
          console.log(`OK ${building}/${roomId} (${roomBills.length} bills)`);
        } catch (error) {
          errorCount++;
          console.error(`ERROR uploading ${building}/${roomId}:`, error.message);
        }
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log('\n=== Upload Complete ===');
    console.log(`Success: ${uploadedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total bills: ${bills.length}`);
    console.log(`Time: ${(elapsedMs / 1000).toFixed(1)}s`);

  } catch (error) {
    console.error('Upload failed:', error);
  }
})();
