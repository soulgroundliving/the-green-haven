/**
 * Mark All Old Bills & Invoices as Paid (Years 67-69)
 * Closes historical bills since no payment records exist
 * Starting fresh from today onwards
 */

function markAllBillsPaid() {
  console.log('📝 Starting to mark all bills and invoices as paid...\n');

  const buildings = ['rooms', 'nest'];
  let totalBillsMarked = 0;
  let totalInvoicesMarked = 0;

  buildings.forEach(building => {
    console.log(`🏢 Processing ${building}...`);

    // Mark bills in localStorage
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
          totalBillsMarked++;
          return bill;
        }
        return bill;
      });

      // Save back to localStorage
      localStorage.setItem(billsKey, JSON.stringify(updatedBills));
      console.log(`  ✅ Marked ${buildingBills.length} bills as paid for year ${year}`);
    });

    // Mark invoices as paid (if InvoiceReceiptManager is available)
    if (typeof InvoiceReceiptManager !== 'undefined') {
      const result = InvoiceReceiptManager.markAllInvoicesAsPaid(building);
      totalInvoicesMarked += result.marked;
    }
  });

  console.log(`\n✅ Completed!`);
  console.log(`📊 Total bills marked as paid: ${totalBillsMarked}`);
  console.log(`📊 Total invoices marked as paid: ${totalInvoicesMarked}`);

  // Save completion status
  localStorage.setItem('bills_marked_paid', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalBillsMarked: totalBillsMarked,
    totalInvoicesMarked: totalInvoicesMarked,
    status: 'complete'
  }));

  return {
    success: true,
    totalBillsMarked: totalBillsMarked,
    totalInvoicesMarked: totalInvoicesMarked,
    message: 'All old bills and invoices marked as paid successfully'
  };
}

// Auto-run if not already done
if (!localStorage.getItem('bills_marked_paid')) {
  console.log('🔄 Running bill and invoice status update...');
  markAllBillsPaid();
} else {
  console.log('✅ Bills and invoices already marked as paid');
  // Force re-run to ensure all invoices are marked as paid
  console.log('🔄 Re-running to ensure invoices are marked as paid...');
  localStorage.removeItem('bills_marked_paid');
  markAllBillsPaid();
}
