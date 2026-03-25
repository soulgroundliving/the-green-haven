/**
 * Mark All Old Bills as Paid (Years 67-69)
 * Closes historical bills since no payment records exist
 * Starting fresh from today onwards
 */

function markAllBillsPaid() {
  console.log('📝 Starting to mark all bills as paid...\n');

  const buildings = ['rooms', 'nest'];
  let totalMarked = 0;

  buildings.forEach(building => {
    console.log(`🏢 Processing ${building}...`);

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

      // Mark all as paid
      const updatedBills = bills.map(bill => {
        if (bill.building === building) {
          bill.status = 'paid';
          totalMarked++;
          return bill;
        }
        return bill;
      });

      // Save back to localStorage
      localStorage.setItem(billsKey, JSON.stringify(updatedBills));
      console.log(`  ✅ Marked ${buildingBills.length} bills as paid for year ${year}`);
    });
  });

  console.log(`\n✅ Completed!`);
  console.log(`📊 Total bills marked as paid: ${totalMarked}`);

  // Save completion status
  localStorage.setItem('bills_marked_paid', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalMarked: totalMarked,
    status: 'complete'
  }));

  return {
    success: true,
    totalMarked: totalMarked,
    message: 'All old bills marked as paid successfully'
  };
}

// Auto-run if not already done
if (!localStorage.getItem('bills_marked_paid')) {
  console.log('🔄 Running bill status update...');
  markAllBillsPaid();
} else {
  console.log('✅ Bills already marked as paid');
}
