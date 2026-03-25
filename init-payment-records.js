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
