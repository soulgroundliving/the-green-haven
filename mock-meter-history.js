/**
 * Mock Meter History Data
 * ข้อมูลมิเตอร์ประวัติเดือน (2026) สำหรับการทดสอบ
 */

// ข้อมูลมิเตอร์เดือนที่แล้ว (Nest Building)
const METER_DATA_NEST = {
  '2026_01': {
    // Nest Rooms January 2026 (End of month readings)
    'N101': { wOld: 85, eOld: 185, wNew: 100, eNew: 200 },
    'N102': { wOld: 95, eOld: 195, wNew: 110, eNew: 210 },
    'N103': { wOld: 90, eOld: 190, wNew: 105, eNew: 205 },
    'N104': { wOld: 93, eOld: 193, wNew: 108, eNew: 208 },
    'N105': { wOld: 87, eOld: 187, wNew: 102, eNew: 202 },
    'N201': { wOld: 96, eOld: 196, wNew: 111, eNew: 211 },
    'N202': { wOld: 94, eOld: 194, wNew: 109, eNew: 209 },
    'N203': { wOld: 88, eOld: 188, wNew: 103, eNew: 203 },
    'N204': { wOld: 92, eOld: 192, wNew: 107, eNew: 207 },
    'N205': { wOld: 91, eOld: 191, wNew: 106, eNew: 206 },
    'N301': { wOld: 89, eOld: 189, wNew: 104, eNew: 204 },
    'N302': { wOld: 97, eOld: 197, wNew: 112, eNew: 212 },
    'N303': { wOld: 86, eOld: 186, wNew: 101, eNew: 201 },
    'N304': { wOld: 98, eOld: 198, wNew: 113, eNew: 213 },
    'N305': { wOld: 99, eOld: 199, wNew: 114, eNew: 214 },
    'N401': { wOld: 84, eOld: 184, wNew: 99, eNew: 199 },
    'N402': { wOld: 100, eOld: 200, wNew: 115, eNew: 215 },
    'N403': { wOld: 101, eOld: 201, wNew: 116, eNew: 216 },
    'N404': { wOld: 102, eOld: 202, wNew: 117, eNew: 217 },
    'N405': { wOld: 103, eOld: 203, wNew: 118, eNew: 218 }
  },
  '2026_02': {
    // Nest Rooms (N101-N405)
    'N101': { wOld: 100, eOld: 200, wNew: 115, eNew: 225 },
    'N102': { wOld: 110, eOld: 210, wNew: 125, eNew: 235 },
    'N103': { wOld: 105, eOld: 205, wNew: 120, eNew: 230 },
    'N104': { wOld: 108, eOld: 208, wNew: 123, eNew: 233 },
    'N105': { wOld: 102, eOld: 202, wNew: 117, eNew: 227 },
    'N201': { wOld: 111, eOld: 211, wNew: 126, eNew: 236 },
    'N202': { wOld: 109, eOld: 209, wNew: 124, eNew: 234 },
    'N203': { wOld: 103, eOld: 203, wNew: 118, eNew: 228 },
    'N204': { wOld: 107, eOld: 207, wNew: 122, eNew: 232 },
    'N205': { wOld: 106, eOld: 206, wNew: 121, eNew: 231 },
    'N301': { wOld: 104, eOld: 204, wNew: 119, eNew: 229 },
    'N302': { wOld: 112, eOld: 212, wNew: 127, eNew: 237 },
    'N303': { wOld: 101, eOld: 201, wNew: 116, eNew: 226 },
    'N304': { wOld: 113, eOld: 213, wNew: 128, eNew: 238 },
    'N305': { wOld: 114, eOld: 214, wNew: 129, eNew: 239 },
    'N401': { wOld: 99, eOld: 199, wNew: 114, eNew: 224 },
    'N402': { wOld: 115, eOld: 215, wNew: 130, eNew: 240 },
    'N403': { wOld: 116, eOld: 216, wNew: 131, eNew: 241 },
    'N404': { wOld: 117, eOld: 217, wNew: 132, eNew: 242 },
    'N405': { wOld: 118, eOld: 218, wNew: 133, eNew: 243 }
  }
};

// ข้อมูลมิเตอร์เดือนที่แล้ว (Rooms Building)
const METER_DATA_ROOMS = {
  '2026_01': {
    // Rooms January 2026 (End of month readings)
    '13': { wOld: 485, eOld: 985, wNew: 500, eNew: 1000 },
    '14': { wOld: 495, eOld: 995, wNew: 510, eNew: 1010 },
    '15': { wOld: 490, eOld: 990, wNew: 505, eNew: 1005 },
    '15ก': { wOld: 497, eOld: 997, wNew: 512, eNew: 1012 },
    '16': { wOld: 493, eOld: 993, wNew: 508, eNew: 1008 },
    '17': { wOld: 500, eOld: 1000, wNew: 515, eNew: 1015 },
    '18': { wOld: 487, eOld: 987, wNew: 502, eNew: 1002 },
    '19': { wOld: 503, eOld: 1003, wNew: 518, eNew: 1018 },
    '20': { wOld: 486, eOld: 986, wNew: 501, eNew: 1001 },
    '21': { wOld: 499, eOld: 999, wNew: 514, eNew: 1014 },
    '22': { wOld: 492, eOld: 992, wNew: 507, eNew: 1007 },
    '23': { wOld: 498, eOld: 998, wNew: 513, eNew: 1013 },
    '24': { wOld: 494, eOld: 994, wNew: 509, eNew: 1009 },
    '25': { wOld: 491, eOld: 991, wNew: 506, eNew: 1006 },
    '26': { wOld: 501, eOld: 1001, wNew: 516, eNew: 1016 },
    '27': { wOld: 488, eOld: 988, wNew: 503, eNew: 1003 },
    '28': { wOld: 502, eOld: 1002, wNew: 517, eNew: 1017 },
    '29': { wOld: 489, eOld: 989, wNew: 504, eNew: 1004 },
    '30': { wOld: 496, eOld: 996, wNew: 511, eNew: 1011 },
    '31': { wOld: 504, eOld: 1004, wNew: 519, eNew: 1019 },
    '32': { wOld: 505, eOld: 1005, wNew: 520, eNew: 1020 },
    '33': { wOld: 506, eOld: 1006, wNew: 521, eNew: 1021 },
    'AMAZON': { wOld: 985, eOld: 1985, wNew: 1000, eNew: 2000 }
  },
  '2026_02': {
    // Rooms (13-33, 15ก, AMAZON)
    '13': { wOld: 500, eOld: 1000, wNew: 520, eNew: 1050 },
    '14': { wOld: 510, eOld: 1010, wNew: 530, eNew: 1060 },
    '15': { wOld: 505, eOld: 1005, wNew: 525, eNew: 1055 },
    '15ก': { wOld: 512, eOld: 1012, wNew: 532, eNew: 1062 },
    '16': { wOld: 508, eOld: 1008, wNew: 528, eNew: 1058 },
    '17': { wOld: 515, eOld: 1015, wNew: 535, eNew: 1065 },
    '18': { wOld: 502, eOld: 1002, wNew: 522, eNew: 1052 },
    '19': { wOld: 518, eOld: 1018, wNew: 538, eNew: 1068 },
    '20': { wOld: 501, eOld: 1001, wNew: 521, eNew: 1051 },
    '21': { wOld: 514, eOld: 1014, wNew: 534, eNew: 1064 },
    '22': { wOld: 507, eOld: 1007, wNew: 527, eNew: 1057 },
    '23': { wOld: 513, eOld: 1013, wNew: 533, eNew: 1063 },
    '24': { wOld: 509, eOld: 1009, wNew: 529, eNew: 1059 },
    '25': { wOld: 506, eOld: 1006, wNew: 526, eNew: 1056 },
    '26': { wOld: 516, eOld: 1016, wNew: 536, eNew: 1066 },
    '27': { wOld: 503, eOld: 1003, wNew: 523, eNew: 1053 },
    '28': { wOld: 517, eOld: 1017, wNew: 537, eNew: 1067 },
    '29': { wOld: 504, eOld: 1004, wNew: 524, eNew: 1054 },
    '30': { wOld: 511, eOld: 1011, wNew: 531, eNew: 1061 },
    '31': { wOld: 519, eOld: 1019, wNew: 539, eNew: 1069 },
    '32': { wOld: 520, eOld: 1020, wNew: 540, eNew: 1070 },
    '33': { wOld: 521, eOld: 1021, wNew: 541, eNew: 1071 },
    'AMAZON': { wOld: 1000, eOld: 2000, wNew: 1050, eNew: 2100 }
  }
};

/**
 * บันทึก Historical Data ลง localStorage
 */
function initMeterHistory() {
  // Nest history
  const nestHistory = JSON.parse(localStorage.getItem('METER_DATA') || '{}');
  Object.assign(nestHistory, METER_DATA_NEST);
  localStorage.setItem('METER_DATA', JSON.stringify(nestHistory));

  // Rooms history
  const roomsHistory = JSON.parse(localStorage.getItem('METER_DATA_ROOMS') || '{}');
  Object.assign(roomsHistory, METER_DATA_ROOMS);
  localStorage.setItem('METER_DATA_ROOMS', JSON.stringify(roomsHistory));

  console.log('✅ Meter History Data บันทึกสำเร็จ');
  console.log('📋 ข้อมูล: 2026 เดือนที่ 1-2 (January-February 2026)');
}

// ใช้งาน: initMeterHistory();
