/**
 * Initialize Payment Records for All Bills
 * Creates payment records for bills year 67-69 (all marked as paid)
 */

function initializePaymentRecords() {
  console.log('📥 Initializing payment records for all bills...');

  const buildings = ['rooms', 'nest'];
  const paymentRecords = {};

  // Process each building
  buildings.forEach(building => {
    console.log(`\n🏢 Processing ${building}...`);

    // Process each year (67, 68, 69)
    [2567, 2568, 2569].forEach(year => {
      const billsKey = `bills_${year}`;
      const billsData = localStorage.getItem(billsKey);

      if (!billsData) {
        console.log(`  ⚠️  No bills found for year ${year}`);
        return;
      }

      const bills = JSON.parse(billsData);

      // Filter bills for this building
      const buildingBills = bills.filter(b => b.building === building);
      console.log(`  📊 Found ${buildingBills.length} bills for ${building} in year ${year}`);

      // Create payment records for each bill
      buildingBills.forEach(bill => {
        const paymentKey = `payment_${building}_${bill.roomId}`;

        if (!paymentRecords[paymentKey]) {
          paymentRecords[paymentKey] = [];
        }

        // Create payment record - mark all as paid
        // Payment date = 5th of the month (or earlier as paid)
        const billMonth = bill.month;
        const billYear = bill.year; // Use short format (67, 68, 69)

        // Generate payment date - assume paid on 3rd of the month (before deadline)
        const fullYear = billYear + 2500; // Convert short year to full year (69 -> 2569)
        const paymentDate = new Date(
          fullYear - 543, // Convert Buddhist year to CE year (2569 -> 2026)
          billMonth - 1,
          3
        ).toISOString();

        const payment = {
          billId: bill.billId,
          roomId: bill.roomId,
          building: building,
          month: bill.month,
          year: bill.year,
          amount: bill.totalCharge || bill.total || 0,
          paymentDate: paymentDate,
          method: 'transfer',
          reference: `PAY-${bill.billId}`,
          status: 'paid',
          createdAt: paymentDate
        };

        paymentRecords[paymentKey].push(payment);
      });
    });
  });

  // Save all payment records to localStorage
  let totalPayments = 0;
  Object.entries(paymentRecords).forEach(([key, payments]) => {
    localStorage.setItem(key, JSON.stringify(payments));
    console.log(`✅ Saved ${payments.length} payment records for ${key}`);
    totalPayments += payments.length;
  });

  console.log(`\n✅ Payment initialization complete!`);
  console.log(`📊 Total payment records created: ${totalPayments}`);

  localStorage.setItem('payment_records_initialized', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalRecords: totalPayments,
    status: 'complete'
  }));

  return {
    success: true,
    totalRecords: totalPayments,
    message: 'All payment records initialized successfully'
  };
}

// Auto-initialize if not already done
if (!localStorage.getItem('payment_records_initialized')) {
  console.log('🔄 Running payment records initialization...');
  initializePaymentRecords();
} else {
  console.log('✅ Payment records already initialized');
}

// ===== UPDATE STATUS BADGE TO SHOW PAID =====
function updateStatusBadgeIfPaid() {
  try {
    // Get room from URL or data
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room') || (typeof currentRoom !== 'undefined' ? currentRoom : null);
    const building = room ? (room.includes('N') ? 'nest' : 'rooms') : 'rooms';

    if (!room) return;

    // Check if payment records exist for this room
    const paymentKey = `payment_${building}_${room}`;
    const paymentData = localStorage.getItem(paymentKey);

    if (paymentData) {
      const payments = JSON.parse(paymentData);
      if (payments.length > 0) {
        // Find latest payment
        const latestPayment = payments.sort((a, b) =>
          new Date(b.paymentDate) - new Date(a.paymentDate)
        )[0];

        if (latestPayment && latestPayment.status === 'paid') {
          // Update badge
          const badge = document.querySelector('.badge-status');
          if (badge) {
            const paidDate = new Date(latestPayment.paymentDate);
            const paidDateStr = `${paidDate.getDate()}/${paidDate.getMonth() + 1}/${paidDate.getFullYear()}`;
            badge.textContent = `✅ ชำระแล้ว ${paidDateStr}`;
            badge.className = 'badge-status status-ok';

            const container = document.querySelector('.bill-status-badge-container');
            if (container) {
              container.className = 'bill-status-badge-container status-ok';
            }

            console.log('✅ Updated bill status badge to PAID');
          }
        }
      }
    }
  } catch (error) {
    console.log('⚠️ Could not update status badge:', error.message);
  }
}

// Update badge on page load
document.addEventListener('DOMContentLoaded', updateStatusBadgeIfPaid);
// Also try to update immediately in case page is already loaded
setTimeout(updateStatusBadgeIfPaid, 500);
