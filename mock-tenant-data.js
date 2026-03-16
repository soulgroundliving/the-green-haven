/**
 * Mock Tenant Data Generator
 * สร้างข้อมูลผู้เช่า 20 ห้อง สำหรับทดสอบระบบมิเตอร์
 */

const mockTenantData = {
  // STUDIO ROOMS (N101-N105, N201-N205, N301-N305) - ฿5,600/เดือน
  'N101': {
    name: 'ครอบครัว อภิชาติ',
    room: 'N101',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234001',
    meterWater: '1501',
    meterElectric: '5801',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 1'
  },
  'N102': {
    name: 'สมชาย เจริงทรัพย์',
    room: 'N102',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234002',
    meterWater: '1502',
    meterElectric: '5802',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 1'
  },
  'N103': {
    name: 'นางสาว ธมล ศรีสวัสดิ์',
    room: 'N103',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234003',
    meterWater: '1503',
    meterElectric: '5803',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 1'
  },
  'N104': {
    name: 'มิก ประทีป รณสิทธิ์',
    room: 'N104',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234004',
    meterWater: '1504',
    meterElectric: '5804',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 1'
  },
  'N105': {
    name: 'อดิศร สายสิงห์',
    room: 'N105',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234005',
    meterWater: '1505',
    meterElectric: '5805',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 1'
  },
  'N201': {
    name: 'บัญชา สวรรค์สิงห์',
    room: 'N201',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234006',
    meterWater: '1506',
    meterElectric: '5806',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 2'
  },
  'N202': {
    name: 'พิมพ์ พรรณวิมล',
    room: 'N202',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234007',
    meterWater: '1507',
    meterElectric: '5807',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 2'
  },
  'N203': {
    name: 'วิทยา ศรีประเสริฐ',
    room: 'N203',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234008',
    meterWater: '1508',
    meterElectric: '5808',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 2'
  },
  'N204': {
    name: 'สิริวัณณ์ กล่ำ',
    room: 'N204',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234009',
    meterWater: '1509',
    meterElectric: '5809',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 2'
  },
  'N205': {
    name: 'กิจพล ยิ่งศักดิ์',
    room: 'N205',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234010',
    meterWater: '1510',
    meterElectric: '5810',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 2'
  },
  'N301': {
    name: 'นายปกษ พิทยเกียรติ',
    room: 'N301',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234011',
    meterWater: '1511',
    meterElectric: '5811',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 3'
  },
  'N302': {
    name: 'ชัยพร นิยมชัย',
    room: 'N302',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234012',
    meterWater: '1512',
    meterElectric: '5812',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 3'
  },
  'N303': {
    name: 'วัฒนา วิจิตร',
    room: 'N303',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234013',
    meterWater: '1513',
    meterElectric: '5813',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 3'
  },
  'N304': {
    name: 'สมศักดิ์ สันติสุข',
    room: 'N304',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234014',
    meterWater: '1514',
    meterElectric: '5814',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 3'
  },
  'N305': {
    name: 'รัตน์ฤทัย จันทร์',
    room: 'N305',
    type: 'Studio',
    rentAmount: 5600,
    phone: '0851234015',
    meterWater: '1515',
    meterElectric: '5815',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 3'
  },

  // PET FRIENDLY ROOMS (N401-N405) - ฿5,900/เดือน
  'N401': {
    name: 'สวนีย์ มหาสารวัตร',
    room: 'N401',
    type: 'Pet Friendly',
    rentAmount: 5900,
    phone: '0851234016',
    meterWater: '1516',
    meterElectric: '5816',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 4'
  },
  'N402': {
    name: 'อังคณา เพ็ญศรี',
    room: 'N402',
    type: 'Pet Friendly',
    rentAmount: 5900,
    phone: '0851234017',
    meterWater: '1517',
    meterElectric: '5817',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 4'
  },
  'N403': {
    name: 'ศักดิ์สิทธิ์ โพธิสร',
    room: 'N403',
    type: 'Pet Friendly',
    rentAmount: 5900,
    phone: '0851234018',
    meterWater: '1518',
    meterElectric: '5818',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 4'
  },
  'N404': {
    name: 'ชลธร ตั้งใจพล',
    room: 'N404',
    type: 'Pet Friendly',
    rentAmount: 5900,
    phone: '0851234019',
    meterWater: '1519',
    meterElectric: '5819',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 4'
  },
  'N405': {
    name: 'ศัตรูพันธ์ บุญชู',
    room: 'N405',
    type: 'Pet Friendly',
    rentAmount: 5900,
    phone: '0851234020',
    meterWater: '1520',
    meterElectric: '5820',
    waterRate: 20,
    electricRate: 8,
    address: 'Nest Building, Floor 4'
  }
};

/**
 * บันทึก Mock Data ลง localStorage
 */
function initMockTenantData() {
  localStorage.setItem('tenant_data', JSON.stringify(mockTenantData));
  console.log('✅ Mock Tenant Data บันทึกสำเร็จ:', Object.keys(mockTenantData).length, 'ห้อง');
  console.log('📋 ห้อง:', Object.keys(mockTenantData).join(', '));
  return mockTenantData;
}

// ใช้งาน: ตัดและวางในคอนโซล Browser หรือเรียกใช้ใน HTML
// initMockTenantData();
