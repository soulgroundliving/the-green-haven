/**
 * Opening Balance Manager
 * Manages opening meter readings for first month import
 * Stores in Firebase Firestore: opening_balances collection
 */

/**
 * Firestore collection structure:
 * opening_balances/
 *   {building}_{year}_{roomId}/
 *     ├── building: "rooms" | "nest"
 *     ├── roomId: "13"
 *     ├── year: 69
 *     ├── eOld: 1234 (opening electric reading)
 *     ├── wOld: 567 (opening water reading)
 *     ├── createdAt: timestamp
 *     └── updatedAt: timestamp
 */

/**
 * Save opening balance for a room
 * @param {string} building - Building name ('rooms', 'nest')
 * @param {string} roomId - Room ID
 * @param {number} year - Buddhist year (69)
 * @param {number} eOld - Opening electric reading
 * @param {number} wOld - Opening water reading
 * @returns {Promise} Resolves when saved
 */
async function saveOpeningBalance(building, roomId, year, eOld, wOld) {
  if (!window.firebase || !window.firebase.firestore) {
    throw new Error('Firebase not initialized');
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const docId = `${building}_${year}_${roomId}`;

  try {
    const docRef = fs.doc(fs.collection(db, 'opening_balances'), docId);
    await fs.setDoc(docRef, {
      building: building,
      roomId: roomId,
      year: year,
      eOld: parseFloat(eOld) || 0,
      wOld: parseFloat(wOld) || 0,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    }, { merge: true });

    console.log(`✅ Saved opening balance for ${building}/${roomId} (${year})`);
    return true;
  } catch (error) {
    console.error('❌ Failed to save opening balance:', error);
    throw error;
  }
}

/**
 * Get opening balance for a specific room
 * @param {string} building - Building name
 * @param {string} roomId - Room ID
 * @param {number} year - Buddhist year
 * @returns {Promise<Object>} Opening balance data {eOld, wOld} or null if not found
 */
async function getOpeningBalance(building, roomId, year) {
  if (!window.firebase || !window.firebase.firestore) {
    console.warn('⚠️ Firebase not initialized, returning null');
    return null;
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const docId = `${building}_${year}_${roomId}`;

  try {
    const docRef = fs.doc(fs.collection(db, 'opening_balances'), docId);
    const docSnapshot = await fs.getDoc(docRef);
    if (docSnapshot.exists()) {
      const data = docSnapshot.data();
      console.log(`✅ Found opening balance for ${building}/${roomId}: eOld=${data.eOld}, wOld=${data.wOld}`);
      return {
        eNew: data.eOld, // Use eOld as the "previous" reading for month 1
        wNew: data.wOld
      };
    } else {
      console.log(`⚠️ No opening balance found for ${building}/${roomId}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Failed to get opening balance:', error);
    return null;
  }
}

/**
 * Get all opening balances for a building/year
 * @param {string} building - Building name
 * @param {number} year - Buddhist year
 * @returns {Promise<Object>} Map of {roomId: {eOld, wOld}}
 */
async function getAllOpeningBalances(building, year) {
  if (!window.firebase || !window.firebase.firestore) {
    console.warn('⚠️ Firebase not initialized, returning empty');
    return {};
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;

  try {
    const q = fs.query(
      fs.collection(db, 'opening_balances'),
      fs.where('building', '==', building),
      fs.where('year', '==', year)
    );

    const snapshot = await fs.getDocs(q);

    const balances = {};
    snapshot.forEach(docSnapshot => {
      const data = docSnapshot.data();
      balances[data.roomId] = {
        eOld: data.eOld,
        wOld: data.wOld,
        createdAt: data.createdAt
      };
    });

    console.log(`✅ Found ${Object.keys(balances).length} opening balances for ${building}/${year}`);
    return balances;
  } catch (error) {
    console.error('❌ Failed to get opening balances:', error);
    return {};
  }
}

/**
 * Check if opening balances are set for all rooms in a building
 * @param {string} building - Building name
 * @param {number} year - Buddhist year
 * @param {Array} roomIds - List of room IDs to check
 * @returns {Promise<Object>} {hasAll: boolean, missing: Array}
 */
async function checkOpeningBalancesComplete(building, year, roomIds) {
  const balances = await getAllOpeningBalances(building, year);
  const missing = roomIds.filter(id => !balances[id]);

  return {
    hasAll: missing.length === 0,
    missing: missing,
    count: Object.keys(balances).length,
    total: roomIds.length
  };
}

/**
 * Delete opening balance for a room
 * @param {string} building - Building name
 * @param {string} roomId - Room ID
 * @param {number} year - Buddhist year
 * @returns {Promise} Resolves when deleted
 */
async function deleteOpeningBalance(building, roomId, year) {
  if (!window.firebase || !window.firebase.firestore) {
    throw new Error('Firebase not initialized');
  }

  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const docId = `${building}_${year}_${roomId}`;

  try {
    const docRef = fs.doc(fs.collection(db, 'opening_balances'), docId);
    await fs.deleteDoc(docRef);
    console.log(`✅ Deleted opening balance for ${building}/${roomId}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to delete opening balance:', error);
    throw error;
  }
}

/**
 * Update validation logic for first month import
 * Modified version of compareValues that uses opening balance for month 1
 */
async function compareValuesWithOpeningBalance(imported, previous, fieldType, isFirstImport, building, roomId, year, month) {
  // For month 1 (January), try to fetch opening balance from Firestore
  if (month === 1 && !previous) {
    console.log(`🔍 Month 1 detected - checking Firebase for opening balance: ${building}/${roomId}`);
    const openingBalance = await getOpeningBalance(building, roomId, year);

    if (openingBalance) {
      console.log(`✅ Found opening balance - using for validation`);
      // Use opening balance as the "previous" reading for month 1
      previous = openingBalance.eNew || (fieldType === 'electric' ? openingBalance.eOld : openingBalance.wOld);
    }
  }

  // Fall back to original compareValues logic
  if (previous === undefined || previous === null) {
    const result = {
      status: isFirstImport ? 'ok' : 'missing',
      delta: null,
      message: isFirstImport
        ? '✓ เดือนแรกของการนำเข้า (ไม่มีเดือนที่แล้ว)'
        : 'ไม่พบข้อมูลเดือนที่แล้ว',
      imported: imported,
      previous: previous
    };
    return result;
  }

  // Rest of validation logic stays the same
  if (imported === undefined || imported === null || imported < 0) {
    return {
      status: 'error',
      delta: null,
      message: 'ค่ามิเตอร์ไม่ถูกต้อง',
      imported: imported,
      previous: previous
    };
  }

  if (imported < previous) {
    return {
      status: 'error',
      delta: previous - imported,
      message: `เลขมิเตอร์ลดลง (${previous} → ${imported})`,
      imported: imported,
      previous: previous
    };
  }

  const delta = Math.abs(imported - previous);
  const tolerance = fieldType === 'electric' ? 10 : 5;

  if (delta === 0) {
    return {
      status: 'ok',
      delta: 0,
      message: 'ตรงกันอย่างแน่นอน',
      imported: imported,
      previous: previous
    };
  } else if (delta <= tolerance) {
    return {
      status: 'warning',
      delta: delta,
      message: `ต่างกัน ${delta} หน่วย (อาจเป็นเพราะการปรับเทียบมิเตอร์)`,
      imported: imported,
      previous: previous
    };
  } else {
    return {
      status: 'error',
      delta: delta,
      message: `ต่างกัน ${delta} หน่วย (เกินค่าที่ยอมรับได้ ${tolerance})`,
      imported: imported,
      previous: previous
    };
  }
}
