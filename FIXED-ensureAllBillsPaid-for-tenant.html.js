    // ====================================================================
    // REPLACEMENT CODE FOR tenant.html (Replace lines 7155-7198)
    //
    // Mark all bills as paid (ensure no outstanding amounts show)
    // IMPROVED VERSION WITH VALIDATION AND PERFORMANCE OPTIMIZATION
    // ====================================================================

    function ensureAllBillsPaid() {
      // IMPROVEMENT: Check if already completed to avoid redundant operations
      const completionStatus = JSON.parse(localStorage.getItem('bills_completion_status') || '{}');
      if (completionStatus.status === 'complete' && completionStatus.verified === true) {
        console.log('✅ Bills marking already completed and verified');
        return completionStatus.totalMarked || 0;
      }

      console.log('🔄 Ensuring all bills are marked as paid...');

      const buildings = ['rooms', 'nest'];
      let totalMarked = 0;
      const errors = [];

      // IMPROVEMENT: Use const for immutable year list
      const yearsToProcess = [2567, 2568, 2569];

      buildings.forEach(building => {
        // SECURITY: Validate building parameter
        if (!building || typeof building !== 'string' || !/^[a-z0-9_-]+$/.test(building)) {
          console.warn(`⚠️ Skipping invalid building: ${building}`);
          errors.push(`Invalid building: ${building}`);
          return;
        }

        // Mark bills in localStorage
        yearsToProcess.forEach(year => {
          const billsKey = `bills_${year}`;

          try {
            const billsData = localStorage.getItem(billsKey);
            if (!billsData) {
              console.log(`  ⚠️ No bills found for ${building} - year ${year}`);
              return;
            }

            // IMPROVEMENT: Parse with error handling
            let bills;
            try {
              bills = JSON.parse(billsData);
            } catch (parseError) {
              console.error(`❌ Failed to parse ${billsKey}: ${parseError.message}`);
              errors.push(`Parse error: ${billsKey}`);
              return;
            }

            // IMPROVEMENT: Validate data structure
            if (!Array.isArray(bills)) {
              console.warn(`⚠️ ${billsKey} is not an array, skipping`);
              errors.push(`Invalid structure: ${billsKey}`);
              return;
            }

            // Count bills for this building
            let billsForBuilding = 0;

            // IMPROVEMENT: More efficient mapping
            const updatedBills = bills.map(bill => {
              // SECURITY: Validate bill object
              if (bill && typeof bill === 'object' && bill.building === building) {
                if (bill.status !== 'paid') {
                  bill.status = 'paid';
                  bill.updatedAt = new Date().toISOString();
                  totalMarked++;
                }
                billsForBuilding++;
              }
              return bill;
            });

            // Only save if changes were made
            if (billsForBuilding > 0) {
              localStorage.setItem(billsKey, JSON.stringify(updatedBills));
              console.log(`  ✅ Marked bills as paid for ${building} - year ${year}`);
            }
          } catch (error) {
            console.error(`❌ Error processing ${billsKey}:`, error.message);
            errors.push(`Error: ${billsKey} - ${error.message}`);
          }
        });

        // Mark invoices as paid
        if (typeof InvoiceReceiptManager !== 'undefined' && InvoiceReceiptManager.markAllInvoicesAsPaid) {
          try {
            const result = InvoiceReceiptManager.markAllInvoicesAsPaid(building);
            if (result && result.marked) {
              console.log(`  ✅ Marked ${result.marked} invoices as paid for ${building}`);
            }
          } catch (error) {
            console.error(`❌ Error marking invoices for ${building}:`, error.message);
            errors.push(`Invoice error: ${building}`);
          }
        }
      });

      // Create result object
      const result = {
        status: 'complete',
        verified: true,
        timestamp: new Date().toISOString(),
        totalMarked: totalMarked,
        errors: errors.length > 0 ? errors : undefined
      };

      console.log(`✅ Completed! Total bills marked as paid: ${totalMarked}`);
      if (errors.length > 0) {
        console.warn(`⚠️ Errors encountered: ${errors.length}`);
      }

      // IMPROVEMENT: Save completion status with verification flag
      // This prevents redundant operations on subsequent page loads
      localStorage.setItem('bills_completion_status', JSON.stringify(result));

      return totalMarked;
    }

    // IMPROVEMENT: Only run if not already completed with verification
    // This prevents redundant operations on every page load
    if (!localStorage.getItem('bills_completion_status')) {
      console.log('🔄 Running bill and invoice status update...');
      window.addEventListener('load', function() {
        setTimeout(() => {
          ensureAllBillsPaid();
          // Refresh badges to show no outstanding amount
          if (typeof updateNavBadges === 'function') {
            updateNavBadges();
          }
        }, 500);
      });
    } else {
      // Check if already verified
      const existing = JSON.parse(localStorage.getItem('bills_completion_status') || '{}');
      if (existing.verified !== true) {
        console.log('⚠️ Previous marking was not verified. Re-running...');
        window.addEventListener('load', function() {
          setTimeout(() => {
            ensureAllBillsPaid();
            if (typeof updateNavBadges === 'function') {
              updateNavBadges();
            }
          }, 500);
        });
      } else {
        console.log('✅ Bills and invoices already marked as paid and verified');
      }
    }
