/**
 * Initialize Lease Agreements
 * Creates lease agreements for all test rooms
 * This should run even when real bills are loaded
 */

function initializeLeaseAgreements() {
  console.log('🔄 Initializing lease agreements...');

  // Get existing lease data or create new
  let leaseAgreementsData = {};
  const stored = localStorage.getItem('lease_agreements_data');
  if (stored) {
    leaseAgreementsData = JSON.parse(stored);
    console.log('✅ Found existing lease agreements, skipping initialization');
    return;
  }

  // Create lease agreements for all tenants
  const roomsData = [
    { roomId: '15', tenantName: 'Somchai Room 15', rentAmount: 1200, building: 'rooms' },
    { roomId: '16', tenantName: 'Niran Room 16', rentAmount: 1200, building: 'rooms' },
    { roomId: '17', tenantName: 'Pimpa Room 17', rentAmount: 1200, building: 'rooms' },
    { roomId: '18', tenantName: 'Somphet Room 18', rentAmount: 1200, building: 'rooms' }
  ];

  for (const room of roomsData) {
    const leaseId = `${room.roomId}_lease_001`;
    leaseAgreementsData[leaseId] = {
      id: leaseId,
      building: room.building,
      roomId: room.roomId,
      tenantId: room.roomId,
      tenantName: room.tenantName,
      moveInDate: '2026-01-01',
      moveOutDate: null,
      rentAmount: room.rentAmount,
      deposit: 3000,
      status: 'active',
      contractNumber: `LEASE-${room.building}-${room.roomId}-001`,
      createdDate: new Date().toISOString()
    };
  }

  localStorage.setItem('lease_agreements_data', JSON.stringify(leaseAgreementsData));
  console.log(`✅ Created ${Object.keys(leaseAgreementsData).length} lease agreements`);

  return leaseAgreementsData;
}

// Auto-initialize on script load
if (typeof LeaseAgreementManager !== 'undefined') {
  initializeLeaseAgreements();
} else {
  // If LeaseAgreementManager isn't loaded yet, wait for it
  const checkAndInit = () => {
    if (typeof LeaseAgreementManager !== 'undefined') {
      initializeLeaseAgreements();
    } else {
      setTimeout(checkAndInit, 100);
    }
  };
  setTimeout(checkAndInit, 100);
}
