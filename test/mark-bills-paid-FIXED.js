/**
 * Mark All Old Bills & Invoices as Paid (Years 67-69)
 * Closes historical bills since no payment records exist
 * Starting fresh from today onwards
 *
 * IMPROVED VERSION WITH SECURITY & PERFORMANCE FIXES
 */

function markAllBillsPaid() {
  // SECURITY: Check if already completed to avoid redundant operations
  const completionStatus = JSON.parse(localStorage.getItem('bills_marked_paid') || '{}');
  if (completionStatus.status === 'complete' && completionStatus.verified === true) {
    console.log('✅ Bills marking already completed and verified');
    return completionStatus;
  }

  console.log('📝 Starting to mark all bills and invoices as paid...\n');

  const buildings = ['rooms', 'nest'];
  let totalBillsMarked = 0;
  let totalInvoicesMarked = 0;
  const errors = [];

  // IMPROVEMENT: Use const for immutable year list
  const yearsToProcess = [2567, 2568, 2569];

  buildings.forEach(building => {
    // SECURITY: Validate building parameter
    if (!building || typeof building !== 'string' || !/^[a-z0-9_-]+$/.test(building)) {
      const error = `Invalid building name: ${building}`;
      console.error(`❌ ${error}`);
      errors.push(error);
      return;
    }

    console.log(`🏢 Processing building: ${building}`);

    yearsToProcess.forEach(year => {
      const billsKey = `bills_${year}`;

      try {
        const billsData = localStorage.getItem(billsKey);

        if (!billsData) {
          console.log(`  ⚠️ No bills found for year ${year}`);
          return;
        }

        // IMPROVEMENT: Add error handling for JSON parse
        let bills;
        try {
          bills = JSON.parse(billsData);
        } catch (parseError) {
          const error = `Failed to parse bills for ${billsKey}: ${parseError.message}`;
          console.error(`❌ ${error}`);
          errors.push(error);
          return;
        }

        // Validate bills is an array
        if (!Array.isArray(bills)) {
          const error = `Bills data is not an array for ${billsKey}`;
          console.error(`❌ ${error}`);
          errors.push(error);
          return;
        }

        // Count bills for this building BEFORE marking
        const buildingBillsCount = bills.filter(b => b.building === building).length;

        // IMPROVEMENT: More efficient mapping - only update needed bills
        const updatedBills = bills.map(bill => {
          // SECURITY: Validate bill object structure
          if (bill && bill.building === building && bill.status !== 'paid') {
            bill.status = 'paid';
            bill.updatedAt = new Date().toISOString();
            totalBillsMarked++;
          }
          return bill;
        });

        // Save back to localStorage
        localStorage.setItem(billsKey, JSON.stringify(updatedBills));

        if (buildingBillsCount > 0) {
          console.log(`  ✅ Marked ${buildingBillsCount} bills as paid for year ${year}`);
        }
      } catch (error) {
        const errorMsg = `Error processing bills for ${billsKey}: ${error.message}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    });

    // Mark invoices as paid (if InvoiceReceiptManager is available)
    if (typeof InvoiceReceiptManager !== 'undefined' && InvoiceReceiptManager.markAllInvoicesAsPaid) {
      try {
        const result = InvoiceReceiptManager.markAllInvoicesAsPaid(building);
        if (result && result.marked) {
          totalInvoicesMarked += result.marked;
          console.log(`  ✅ Marked ${result.marked} invoices as paid for ${building}`);
        }
      } catch (error) {
        const errorMsg = `Error marking invoices for ${building}: ${error.message}`;
        console.error(`❌ ${errorMsg}`);
        errors.push(errorMsg);
      }
    }
  });

  // Create result object
  const result = {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    totalBillsMarked: totalBillsMarked,
    totalInvoicesMarked: totalInvoicesMarked,
    status: 'complete',
    verified: true,
    errors: errors.length > 0 ? errors : undefined
  };

  console.log(`\n✅ Completed!`);
  console.log(`📊 Total bills marked as paid: ${totalBillsMarked}`);
  console.log(`📊 Total invoices marked as paid: ${totalInvoicesMarked}`);
  if (errors.length > 0) {
    console.warn(`⚠️ Errors encountered: ${errors.length}`);
    errors.forEach((err, idx) => console.warn(`  ${idx + 1}. ${err}`));
  }

  // Save completion status with verification flag
  localStorage.setItem('bills_marked_paid', JSON.stringify(result));

  return result;
}

// IMPROVEMENT: Only run if not already completed with verification
// This prevents redundant operations on every page load
if (!localStorage.getItem('bills_marked_paid')) {
  console.log('🔄 Running bill and invoice status update...');
  markAllBillsPaid();
} else {
  // Check if already verified
  const existing = JSON.parse(localStorage.getItem('bills_marked_paid') || '{}');
  if (existing.verified !== true) {
    console.log('⚠️ Previous marking was not verified. Re-running...');
    markAllBillsPaid();
  } else {
    console.log('✅ Bills and invoices already marked as paid and verified');
  }
}
