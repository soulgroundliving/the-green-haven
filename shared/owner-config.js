// Owner/Landlord Information Manager
// Centralized storage for property owner details

const DEFAULT_OWNER_CONFIG = {
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
  taxId: '',
  bankAccount: '',
  bankName: ''
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
}
