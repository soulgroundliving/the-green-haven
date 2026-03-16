/**
 * Mock Rooms Data Generator
 * สร้างข้อมูลห้องแถว (13-33) + AMAZON สำหรับทดสอบระบบมิเตอร์
 * ข้อมูลดึงมาจาก บิลปี69.xlsx
 */

const mockRoomsData = {
  // ROOMS (13-33) - ห้องแถว
  '13': {
    name: 'สมนึก ใจอาร์ต',
    room: '13',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234001',
    meterWater: '2101',
    meterElectric: '6101',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 1'
  },
  '14': {
    name: 'นิติพร โภคาพลัน',
    room: '14',
    type: 'ห้องแถว',
    rentAmount: 1200,
    phone: '0861234002',
    meterWater: '2102',
    meterElectric: '6102',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 1'
  },
  '15': {
    name: 'วิวัฒนา บำรุงศรี',
    room: '15',
    type: 'ห้องแถว',
    rentAmount: 1200,
    phone: '0861234003',
    meterWater: '2103',
    meterElectric: '6103',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 1'
  },
  '15ก': {
    name: 'สมจิตต์ อภิรมย์',
    room: '15ก',
    type: 'ห้องแถว',
    rentAmount: 1200,
    phone: '0861234003ก',
    meterWater: '2103ก',
    meterElectric: '6103ก',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 1'
  },
  '16': {
    name: 'เสกสรร กิจการ',
    room: '16',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '0861234004',
    meterWater: '2104',
    meterElectric: '6104',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 1'
  },
  '17': {
    name: 'พัฒน์ศิลป์ ภาคจันทร์',
    room: '17',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234005',
    meterWater: '2105',
    meterElectric: '6105',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 2'
  },
  '18': {
    name: 'วิชญ์ธร สามารถ',
    room: '18',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234006',
    meterWater: '2106',
    meterElectric: '6106',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 2'
  },
  '19': {
    name: 'ชาตรี สุเวศย์',
    room: '19',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234007',
    meterWater: '2107',
    meterElectric: '6107',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 2'
  },
  '20': {
    name: 'สุพัฒน์ ประจำคณ',
    room: '20',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234008',
    meterWater: '2108',
    meterElectric: '6108',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 2'
  },
  '21': {
    name: 'อภิชาติ สินธุพันธ์',
    room: '21',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234009',
    meterWater: '2109',
    meterElectric: '6109',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 2'
  },
  '22': {
    name: 'อรุณ ศรีเมืองสิทธิ์',
    room: '22',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234010',
    meterWater: '2110',
    meterElectric: '6110',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 3'
  },
  '23': {
    name: 'กิจศิลป์ พรหมทอง',
    room: '23',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234011',
    meterWater: '2111',
    meterElectric: '6111',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 3'
  },
  '24': {
    name: 'วัฒนพงค์ สิทธิศักดิ์',
    room: '24',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '0861234012',
    meterWater: '2112',
    meterElectric: '6112',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 3'
  },
  '25': {
    name: 'ศิวม์ อย่างยิ่ง',
    room: '25',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234013',
    meterWater: '2113',
    meterElectric: '6113',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 3'
  },
  '26': {
    name: 'สมพงษ์ ชูวิทย์',
    room: '26',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '0861234014',
    meterWater: '2114',
    meterElectric: '6114',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 3'
  },
  '27': {
    name: 'เดชา เหมหัส',
    room: '27',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234015',
    meterWater: '2115',
    meterElectric: '6115',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '28': {
    name: 'อภิรมย์ สมประสงค์',
    room: '28',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234016',
    meterWater: '2116',
    meterElectric: '6116',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '29': {
    name: 'สำเร็จ อุดมการ',
    room: '29',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234017',
    meterWater: '2117',
    meterElectric: '6117',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '30': {
    name: 'นิคม ประมาณ',
    room: '30',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234018',
    meterWater: '2118',
    meterElectric: '6118',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '31': {
    name: 'วิโรจน์ ธนะเสวี',
    room: '31',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234019',
    meterWater: '2119',
    meterElectric: '6119',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '32': {
    name: 'ชลธร บรรพจน์',
    room: '32',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '0861234020',
    meterWater: '2120',
    meterElectric: '6120',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },
  '33': {
    name: 'ประทัศน์ วงศ์พิลาสม์',
    room: '33',
    type: 'ห้องแถว',
    rentAmount: 1400,
    phone: '0861234021',
    meterWater: '2121',
    meterElectric: '6121',
    waterRate: 8,
    electricRate: 20,
    address: 'ห้องแถว ชั้น 4'
  },

  // AMAZON - ห้องธุรกิจ
  'AMAZON': {
    name: 'AMAZON Thailand Co.,Ltd',
    room: 'AMAZON',
    type: 'ธุรกิจ/สำนักงาน',
    rentAmount: 15000,
    phone: '0862-AMAZON-1',
    meterWater: '2200',
    meterElectric: '6200',
    waterRate: 8,
    electricRate: 20,
    address: 'AMAZON Business Unit'
  }
};

/**
 * บันทึก Mock Data ลง localStorage
 */
function initMockRoomsData() {
  localStorage.setItem('rooms_data', JSON.stringify(mockRoomsData));
  console.log('✅ Mock Rooms Data บันทึกสำเร็จ:', Object.keys(mockRoomsData).length, 'ห้อง');
  console.log('📋 ห้อง:', Object.keys(mockRoomsData).join(', '));
  return mockRoomsData;
}

// ใช้งาน: initMockRoomsData();
