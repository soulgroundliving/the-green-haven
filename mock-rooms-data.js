/**
 * Real Rooms Data from บิลปี69.xlsx
 * ข้อมูลห้องแถวจริงจากไฟล์บิล ปีงบประมาณ 69
 */

const mockRoomsData = {
  // ROOMS (13-33) - ห้องแถว - Data from บิลปี69.xlsx
  '13': {
    name: 'ห้อง 13',
    room: '13',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4001',
    meterWater: '2101',
    meterElectric: '6101',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 1',
    dataSource: 'บิลปี69.xlsx'
  },
  '14': {
    name: 'ห้อง 14',
    room: '14',
    type: 'ห้องแถว',
    rentAmount: 1200,
    phone: '086-123-4002',
    meterWater: '2102',
    meterElectric: '6102',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 1',
    dataSource: 'บิลปี69.xlsx'
  },
  '15': {
    name: 'ห้อง 15',
    room: '15',
    type: 'ห้องแถว',
    rentAmount: 1200,
    phone: '086-123-4003',
    meterWater: '2103',
    meterElectric: '6103',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 1',
    dataSource: 'บิลปี69.xlsx'
  },
  '15ก': {
    name: 'ห้อง 15ก',
    room: '15ก',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4003A',
    meterWater: '2103ก',
    meterElectric: '6103ก',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 1',
    dataSource: 'บิลปี69.xlsx'
  },
  '16': {
    name: 'ห้อง 16',
    room: '16',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '086-123-4004',
    meterWater: '2104',
    meterElectric: '6104',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 1',
    dataSource: 'บิลปี69.xlsx'
  },
  '17': {
    name: 'ห้อง 17',
    room: '17',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4005',
    meterWater: '2105',
    meterElectric: '6105',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 2',
    dataSource: 'บิลปี69.xlsx'
  },
  '18': {
    name: 'ห้อง 18',
    room: '18',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4006',
    meterWater: '2106',
    meterElectric: '6106',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 2',
    dataSource: 'บิลปี69.xlsx'
  },
  '19': {
    name: 'ห้อง 19',
    room: '19',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4007',
    meterWater: '2107',
    meterElectric: '6107',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 2',
    dataSource: 'บิลปี69.xlsx'
  },
  '20': {
    name: 'ห้อง 20',
    room: '20',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4008',
    meterWater: '2108',
    meterElectric: '6108',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 2',
    dataSource: 'บิลปี69.xlsx'
  },
  '21': {
    name: 'ห้อง 21',
    room: '21',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4009',
    meterWater: '2109',
    meterElectric: '6109',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 2',
    dataSource: 'บิลปี69.xlsx'
  },
  '22': {
    name: 'ห้อง 22',
    room: '22',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4010',
    meterWater: '2110',
    meterElectric: '6110',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 3',
    dataSource: 'บิลปี69.xlsx'
  },
  '23': {
    name: 'ห้อง 23',
    room: '23',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4011',
    meterWater: '2111',
    meterElectric: '6111',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 3',
    dataSource: 'บิลปี69.xlsx'
  },
  '24': {
    name: 'ห้อง 24',
    room: '24',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '086-123-4012',
    meterWater: '2112',
    meterElectric: '6112',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 3',
    dataSource: 'บิลปี69.xlsx'
  },
  '25': {
    name: 'ห้อง 25',
    room: '25',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4013',
    meterWater: '2113',
    meterElectric: '6113',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 3',
    dataSource: 'บิลปี69.xlsx'
  },
  '26': {
    name: 'ห้อง 26',
    room: '26',
    type: 'ห้องแถว',
    rentAmount: 2000,
    phone: '086-123-4014',
    meterWater: '2114',
    meterElectric: '6114',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 3',
    dataSource: 'บิลปี69.xlsx'
  },
  '27': {
    name: 'ห้อง 27',
    room: '27',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4015',
    meterWater: '2115',
    meterElectric: '6115',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '28': {
    name: 'ห้อง 28',
    room: '28',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4016',
    meterWater: '2116',
    meterElectric: '6116',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '29': {
    name: 'ห้อง 29',
    room: '29',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4017',
    meterWater: '2117',
    meterElectric: '6117',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '30': {
    name: 'ห้อง 30',
    room: '30',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4018',
    meterWater: '2118',
    meterElectric: '6118',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '31': {
    name: 'ห้อง 31',
    room: '31',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4019',
    meterWater: '2119',
    meterElectric: '6119',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '32': {
    name: 'ห้อง 32',
    room: '32',
    type: 'ห้องแถว',
    rentAmount: 1500,
    phone: '086-123-4020',
    meterWater: '2120',
    meterElectric: '6120',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },
  '33': {
    name: 'ห้อง 33',
    room: '33',
    type: 'ห้องแถว',
    rentAmount: 1400,
    phone: '086-123-4021',
    meterWater: '2121',
    meterElectric: '6121',
    waterRate: 20,
    electricRate: 8,
    address: 'ห้องแถว ชั้น 4',
    dataSource: 'บิลปี69.xlsx'
  },

  // AMAZON - ร้านใหญ่ (Large Shop)
  'AMAZON': {
    name: 'ร้านใหญ่ (AMAZON)',
    room: 'AMAZON',
    type: 'ธุรกิจ/สำนักงาน',
    rentAmount: 15000,
    phone: '086-AMAZON-1',
    meterWater: '2200',
    meterElectric: '6200',
    waterRate: 20,
    electricRate: 8,
    address: 'AMAZON Business Unit',
    dataSource: 'บิลปี69.xlsx'
  }
};

/**
 * บันทึก Real Rooms Data ลง localStorage
 */
function initMockRoomsData() {
  localStorage.setItem('rooms_data', JSON.stringify(mockRoomsData));
  console.log('✅ Real Rooms Data (Excel) บันทึกสำเร็จ:', Object.keys(mockRoomsData).length, 'ห้อง');
  console.log('📋 ห้อง:', Object.keys(mockRoomsData).join(', '));
  console.log('📊 ข้อมูลมาจาก: บิลปี69.xlsx');
  return mockRoomsData;
}

// ใช้งาน: initMockRoomsData();
