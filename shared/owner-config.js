// Owner/Landlord Information Manager
// Centralized storage for property owner details

const DEFAULT_OWNER_CONFIG = {
  // ===== BASIC INFO =====
  id: '',
  name: '',
  idCardNumber: '',
  phone: '',
  email: '',
  address: '',
  subDistrict: '',
  district: '',
  province: '',
  postalCode: '',

  // ===== TAX & BANKING =====
  taxId: '',
  bankName: '',
  bankAccount: '',

  // ===== ACCOUNTING INFO =====
  operationStartDate: '',  // วันเริ่มดำเนินการ (YYYY-MM-DD)
  businessType: 'residential_rental',  // ประเภทธุรกิจ
  businessCategory: ''  // หมวดหมู่ธุรกิจตามภาษี
};

class OwnerConfigManager {
  static getOwnerInfo() {
    const stored = localStorage.getItem('owner_info');
    return stored ? JSON.parse(stored) : { ...DEFAULT_OWNER_CONFIG };
  }

  static saveOwnerInfo(data) {
    // Validate required fields
    if (!data.name) {
      console.warn('⚠️ Owner name is required');
      return false;
    }
    localStorage.setItem('owner_info', JSON.stringify(data));
    console.log('✅ Owner info saved:', data.name);
    return true;
  }

  static updateOwnerInfo(updates) {
    const current = this.getOwnerInfo();
    const updated = { ...current, ...updates };
    if (this.saveOwnerInfo(updated)) {
      return updated;
    }
    return null;
  }

  static getOwnerName() {
    return this.getOwnerInfo().name || 'ไม่มีข้อมูล';
  }

  static getOwnerPhone() {
    return this.getOwnerInfo().phone || '-';
  }

  static getOwnerEmail() {
    return this.getOwnerInfo().email || '-';
  }

  static getOwnerTaxId() {
    return this.getOwnerInfo().taxId || '-';
  }

  static clearOwnerInfo() {
    localStorage.removeItem('owner_info');
    console.log('✅ Owner info cleared');
  }

  static async saveOwnerInfoWithFirebase(data) {
    // 1. Save to localStorage (always succeeds)
    const success = this.saveOwnerInfo(data);

    // 2. Try Firebase in parallel (don't block on failure)
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return success;
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, 'owner_info'),
        'main'
      );
      await window.firebase.firestoreFunctions.setDoc(docRef, {
        ...data,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      console.log('✅ Owner info synced to Firebase');
    } catch (error) {
      console.warn('⚠️ Firebase sync failed (using localStorage):', error.message);
    }

    return success;
  }

  static async loadOwnerInfoFromFirebase() {
    try {
      if (!window.firebase) {
        console.warn('⚠️ Firebase not loaded');
        return this.getOwnerInfo();
      }

      const db = window.firebase.firestore();
      const docRef = window.firebase.firestoreFunctions.doc(
        window.firebase.firestoreFunctions.collection(db, 'owner_info'),
        'main'
      );
      const docSnap = await window.firebase.firestoreFunctions.getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        // Save to localStorage as backup
        this.saveOwnerInfo(data);
        console.log('✅ Owner info loaded from Firebase');
        return data;
      }
    } catch (error) {
      console.warn('⚠️ Firebase load failed (using localStorage):', error.message);
    }

    // Fallback to localStorage
    return this.getOwnerInfo();
  }
}
