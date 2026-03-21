/**
 * Firebase Meter Data Helper
 * Replaces hardcoded METER_DATA with cloud-based storage
 * Structure: /meter_data/{building}/{year_month}/{roomId}/{eNew, eOld, wNew, wOld}
 */

class FirebaseMeterHelper {
  /**
   * Get meter readings for a specific building and month
   * @param {string} building - 'rooms' or 'nest'
   * @param {string} yearMonth - Format: '67_1' (year_month)
   * @returns {Promise<Object>} - {roomId: {eNew, eOld, wNew, wOld}, ...}
   */
  static async getMeterDataForMonth(building, yearMonth) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not loaded, returning null');
        return null;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, `meter_data/${building}/${yearMonth}`),
        'data'
      );

      const docSnap = await window.firebase.firestoreFunctions.getDoc(docRef);

      if (docSnap.exists()) {
        return docSnap.data();
      }

      return null;
    } catch (error) {
      console.warn(`⚠️ Firebase meter fetch failed for ${building}/${yearMonth}:`, error);
      return null;
    }
  }

  /**
   * Get meter reading for a specific room
   * @param {string} building
   * @param {string} yearMonth
   * @param {string} roomId
   * @returns {Promise<Object>} - {eNew, eOld, wNew, wOld} or null
   */
  static async getMeterReading(building, yearMonth, roomId) {
    try {
      const monthData = await this.getMeterDataForMonth(building, yearMonth);
      return monthData ? monthData[roomId] || null : null;
    } catch (error) {
      console.warn(`⚠️ Failed to get meter reading for ${building}/${yearMonth}/${roomId}`, error);
      return null;
    }
  }

  /**
   * Save meter reading to Firebase
   * @param {string} building
   * @param {string} yearMonth
   * @param {string} roomId
   * @param {Object} data - {eNew, eOld, wNew, wOld}
   */
  static async saveMeterReading(building, yearMonth, roomId, data) {
    try {
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('⚠️ Firebase not available for saving');
        return false;
      }

      const db = window.firebase.firestore();
      const monthCollection = window.firebase.firestoreFunctions.collection(
        window.firebase.firestoreFunctions.collection(db, `meter_data/${building}`),
        yearMonth
      );

      const docRef = window.firebase.firestoreFunctions.doc(monthCollection, 'data');

      // Merge new room data with existing
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        [roomId]: {
          eNew: data.eNew,
          eOld: data.eOld,
          wNew: data.wNew,
          wOld: data.wOld,
          updatedAt: new Date().toISOString()
        }
      }, { merge: true });

      console.log(`✅ Meter reading saved for ${building}/${yearMonth}/${roomId}`);
      return true;
    } catch (error) {
      console.warn(`⚠️ Failed to save meter reading:`, error);
      return false;
    }
  }

  /**
   * Upload meter data cache to localStorage for offline access
   * @param {string} building
   * @param {string} yearMonth
   * @param {Object} data
   */
  static cacheMeterData(building, yearMonth, data) {
    try {
      const cacheKey = `meter_cache_${building}_${yearMonth}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        data: data,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('⚠️ Failed to cache meter data:', error);
    }
  }

  /**
   * Get cached meter data
   * @param {string} building
   * @param {string} yearMonth
   * @returns {Object|null}
   */
  static getCachedMeterData(building, yearMonth) {
    try {
      const cacheKey = `meter_cache_${building}_${yearMonth}`;
      const cached = localStorage.getItem(cacheKey);

      if (!cached) return null;

      const { data, timestamp } = JSON.parse(cached);
      const cacheAge = Date.now() - timestamp;
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Cache expires after 1 day
      if (cacheAge > oneDayMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return data;
    } catch (error) {
      console.warn('⚠️ Failed to get cached meter data:', error);
      return null;
    }
  }

  /**
   * Get meter data with cache fallback
   * Priority: Firebase → Cache → null
   */
  static async getMeterDataWithFallback(building, yearMonth) {
    // Try Firebase first
    let data = await this.getMeterDataForMonth(building, yearMonth);

    if (data) {
      // Cache it
      this.cacheMeterData(building, yearMonth, data);
      return data;
    }

    // Fallback to cache
    data = this.getCachedMeterData(building, yearMonth);
    if (data) {
      console.log(`⏳ Using cached meter data for ${building}/${yearMonth}`);
      return data;
    }

    // No data available
    console.warn(`❌ No meter data available for ${building}/${yearMonth}`);
    return null;
  }
}

// Global access
window.FirebaseMeterHelper = FirebaseMeterHelper;
