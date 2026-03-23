/**
 * Initialize Test Data
 * Loads mock meter data, tenants, and leases into localStorage for testing
 * Run this ONCE to set up test environment
 */

function initializeTestData() {
  console.log('🔄 Initializing test data...');

  // 1. Load meter data (required for bills calculation)
  const meterDataFormatted = {};

  // Format: "rooms_15_2026_01" = { eOld, eNew, wOld, wNew, month, year, yearMonth }
  if (typeof METER_DATA_ROOMS !== 'undefined') {
    for (const [monthKey, roomData] of Object.entries(METER_DATA_ROOMS)) {
      const [year, month] = monthKey.split('_');
      for (const [roomId, readings] of Object.entries(roomData)) {
        const key = `rooms_${roomId}_${year}_${month}`;
        meterDataFormatted[key] = {
          ...readings,
          month: parseInt(month),
          year: parseInt(year),
          yearMonth: `${year}_${month}`,
          createdAt: new Date(`${year}-${month}-01`).toISOString(),
          updatedAt: new Date(`${year}-${month}-28`).toISOString()
        };
      }
    }
  }

  if (typeof METER_DATA_NEST !== 'undefined') {
    for (const [monthKey, roomData] of Object.entries(METER_DATA_NEST)) {
      const [year, month] = monthKey.split('_');
      for (const [roomId, readings] of Object.entries(roomData)) {
        const key = `nest_${roomId}_${year}_${month}`;
        meterDataFormatted[key] = {
          ...readings,
          month: parseInt(month),
          year: parseInt(year),
          yearMonth: `${year}_${month}`,
          createdAt: new Date(`${year}-${month}-01`).toISOString(),
          updatedAt: new Date(`${year}-${month}-28`).toISOString()
        };
      }
    }
  }

  localStorage.setItem('meter_data', JSON.stringify(meterDataFormatted));
  console.log(`✅ Loaded ${Object.keys(meterDataFormatted).length} meter records`);

  // 2. Load tenant master data
  const tenantMasterData = { rooms: {}, nest: {} };

  if (typeof mockTenantData !== 'undefined') {
    for (const [roomId, tenantInfo] of Object.entries(mockTenantData)) {
      const building = (roomId >= 101 && roomId <= 405) ? 'nest' : 'rooms';
      tenantMasterData[building][roomId] = {
        id: roomId,
        name: tenantInfo.name,
        phone: tenantInfo.phone,
        email: `${tenantInfo.name.replace(/\s+/g, '_').toLowerCase()}@test.com`,
        address: tenantInfo.address || '',
        building: building,
        createdDate: new Date().toISOString()
      };
    }
  }

  localStorage.setItem('tenant_master_data', JSON.stringify(tenantMasterData));
  console.log(`✅ Loaded ${Object.keys(tenantMasterData.rooms).length + Object.keys(tenantMasterData.nest).length} tenants`);

  // 3. Create lease agreements
  const leaseAgreementsData = {};

  if (typeof mockTenantData !== 'undefined') {
    for (const [roomId, tenantInfo] of Object.entries(mockTenantData)) {
      const building = (roomId >= 101 && roomId <= 405) ? 'nest' : 'rooms';
      const leaseId = `${roomId}_lease_001`;

      leaseAgreementsData[leaseId] = {
        id: leaseId,
        building: building,
        roomId: roomId,
        tenantId: roomId,
        tenantName: tenantInfo.name,
        moveInDate: '2026-01-01',
        moveOutDate: null,
        rentAmount: tenantInfo.rentAmount || 5900,
        deposit: 3000,
        status: 'active',
        createdDate: new Date().toISOString()
      };
    }
  }

  localStorage.setItem('lease_agreements_data', JSON.stringify(leaseAgreementsData));
  console.log(`✅ Loaded ${Object.keys(leaseAgreementsData).length} lease agreements`);

  // 4. Initialize sample announcements
  const announcements = [
    {
      id: 'ANN_001',
      title: 'แจ้งปิดน้ำ',
      date: '2026-06-15',
      time: '10:00 - 14:00',
      icon: '💧',
      content: 'มีการดำเนินการซ่อมท่อน้ำในอาคารจึงต้องปิดน้ำ',
      priority: 'high',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ANN_002',
      title: 'ทำความสะอาดใหญ่',
      date: '2026-06-20',
      time: 'all day',
      icon: '🧹',
      content: 'การทำความสะอาดสถานที่ทั่วไปในอาคาร',
      priority: 'normal',
      createdAt: new Date().toISOString()
    },
    {
      id: 'ANN_003',
      title: 'ซ่อมลิฟต์',
      date: '2026-06-22',
      time: '08:00 - 12:00',
      icon: '🔧',
      content: 'การตรวจสอบและบำรุงรักษาระบบลิฟต์',
      priority: 'normal',
      createdAt: new Date().toISOString()
    }
  ];

  localStorage.setItem('announcements', JSON.stringify(announcements));
  console.log(`✅ Loaded ${announcements.length} announcements`);

  console.log('✅ Test data initialization complete!');
  console.log('\nTo test tenant app:');
  console.log('1. Login as tenant15@test.com');
  console.log('2. Go to /tenant.html?room=15');
  console.log('3. All pages should now show data');
}

// Auto-initialize if mockData exists
if (typeof METER_DATA_ROOMS !== 'undefined' && typeof mockTenantData !== 'undefined') {
  console.log('✅ init-test-data.js loaded - run initializeTestData() to populate localStorage');
}
