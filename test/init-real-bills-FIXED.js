/**
 * Initialize Real Bills into localStorage
 * Called on page load to populate tenant app with real bill data
 *
 * IMPROVED VERSION WITH:
 * - Better data validation
 * - Storage size checking
 * - Error handling
 * - Performance optimizations
 */

async function initializeRealBills() {
  try {
    // IMPROVEMENT: Use boolean flag instead of string comparison
    const billsFixed = localStorage.getItem('real_bills_fixed') === 'true';

    if (billsFixed) {
      const bills2569 = localStorage.getItem('bills_2569');
      try {
        const count = bills2569 ? JSON.parse(bills2569).length : 0;
        if (count > 10) {
          console.log(`✅ Real bills already initialized and fixed (${count} bills)`);
          return;
        }
      } catch (e) {
        console.warn('⚠️ Could not verify existing bills count');
      }
    }

    // Check if bills are already loaded (more reliable than flag check)
    const bills2569 = localStorage.getItem('bills_2569');
    if (bills2569) {
      try {
        const count = JSON.parse(bills2569).length;
        if (count > 10) {
          console.log(`✅ Real bills already initialized (${count} bills) - but fixing swaps...`);
          // Continue to fix any swaps, don't return yet
        }
      } catch (e) {
        console.warn('⚠️ Could not verify bills count, proceeding with initialization');
      }
    }

    console.log('📥 Loading real bills from real-bills-generated.json...');

    // Fetch real bills data
    let response;
    try {
      response = await fetch('./real-bills-generated.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (fetchError) {
      throw new Error(`Failed to fetch bills data: ${fetchError.message}`);
    }

    // IMPROVEMENT: Parse JSON with error handling
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error(`Invalid JSON in bills file: ${parseError.message}`);
    }

    // IMPROVEMENT: Validate data structure
    if (!data || typeof data !== 'object') {
      throw new Error('Bills data is not a valid object');
    }

    if (!data.bills || !Array.isArray(data.bills)) {
      throw new Error('Bills data does not contain a bills array');
    }

    if (data.bills.length === 0) {
      throw new Error('No bills found in data');
    }

    console.log(`📊 Found ${data.bills.length} total bills`);

    // Group bills by full year (convert Thai year 67→2567, 68→2568, etc.)
    const billsByFullYear = {};
    let processedCount = 0;
    let fixedCount = 0;

    data.bills.forEach((bill, index) => {
      // IMPROVEMENT: Validate bill object structure
      if (!bill || typeof bill !== 'object') {
        console.warn(`⚠️ Skipping invalid bill at index ${index}`);
        return;
      }

      // IMPROVEMENT: Validate required fields
      if (!bill.year) {
        console.warn(`⚠️ Skipping bill at index ${index}: missing year`);
        return;
      }

      // Detect and fix swapped meter readings
      // Pattern: if electric.previous === water.current, they're swapped
      if (bill.meterReadings?.electric && bill.meterReadings?.water) {
        const mr = bill.meterReadings;

        // IMPROVEMENT: Add type validation
        if (
          typeof mr.electric.previous === 'number' &&
          typeof mr.water.current === 'number' &&
          mr.electric.previous === mr.water.current
        ) {
          console.log(`🔄 Fixing swapped meters for ${bill.billId}`);

          // Swap them back
          const tempElectric = { ...mr.electric };
          const tempWater = { ...mr.water };

          bill.meterReadings.electric = {
            previous: tempWater.previous,
            current: tempWater.current,
            usage: tempWater.usage
          };
          bill.meterReadings.water = {
            previous: tempElectric.previous,
            current: tempElectric.current,
            usage: tempElectric.usage
          };

          // Update charges and usage in the charges section too
          if (bill.charges?.electric && bill.charges?.water) {
            const tempCharges = { ...bill.charges.electric };
            bill.charges.electric = { ...bill.charges.water };
            bill.charges.water = tempCharges;
          }

          fixedCount++;
        }
      }

      // Convert Thai Buddhist year to full year (67→2567, 68→2568, 69→2569)
      const fullYear = bill.year < 100 ? bill.year + 2500 : bill.year;
      const key = `bills_${fullYear}`;

      // IMPROVEMENT: Validate year is reasonable
      if (fullYear < 2500 || fullYear > 2600) {
        console.warn(`⚠️ Skipping bill at index ${index}: invalid year ${fullYear}`);
        return;
      }

      if (!billsByFullYear[key]) {
        billsByFullYear[key] = [];
      }
      billsByFullYear[key].push(bill);
      processedCount++;
    });

    if (processedCount === 0) {
      throw new Error('No valid bills were processed');
    }

    console.log(`📊 Processed ${processedCount} bills (fixed ${fixedCount} swap issues)`);

    // IMPROVEMENT: Check localStorage size before storing
    let totalSize = 0;
    const maxSize = 5 * 1024 * 1024; // 5MB safety threshold

    // Store in localStorage with size checking
    for (const [key, bills] of Object.entries(billsByFullYear)) {
      try {
        const billsJson = JSON.stringify(bills);
        const estimatedSize = billsJson.length * 2; // UTF-16 encoding estimate

        totalSize += estimatedSize;

        // IMPROVEMENT: Check if we're approaching storage limit
        if (totalSize > maxSize) {
          console.warn(`⚠️ Warning: Bills data is approaching storage limit (${totalSize / 1024 / 1024} MB)`);
        }

        localStorage.setItem(key, billsJson);
        console.log(`✅ Stored ${bills.length} bills in ${key} (${estimatedSize / 1024} KB)`);
      } catch (storageError) {
        if (storageError.name === 'QuotaExceededError') {
          throw new Error(`localStorage quota exceeded while storing ${key}`);
        }
        throw storageError;
      }
    }

    // Mark as initialized and fixed using proper boolean
    localStorage.setItem('real_bills_initialized', 'true');
    localStorage.setItem('real_bills_fixed', 'true');

    // IMPROVEMENT: Store metadata about initialization
    localStorage.setItem('real_bills_metadata', JSON.stringify({
      timestamp: new Date().toISOString(),
      totalProcessed: processedCount,
      totalFixed: fixedCount,
      version: '1.0'
    }));

    console.log(`✅ Real bills initialization complete:`);
    console.log(`   - Bills stored: ${processedCount}`);
    console.log(`   - Swaps fixed: ${fixedCount}`);
    console.log(`   - Total size: ${(totalSize / 1024).toFixed(2)} KB`);

  } catch (error) {
    console.error('❌ Error initializing real bills:', error.message);

    // IMPROVEMENT: Add error tracking
    try {
      localStorage.setItem('real_bills_error', JSON.stringify({
        timestamp: new Date().toISOString(),
        error: error.message
      }));
    } catch (e) {
      // Storage failed, just log
      console.error('Could not store error information');
    }
  }
}

// Auto-initialize on page load
// IMPROVEMENT: Better page load detection
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRealBills);
} else {
  // Document is already loaded, initialize immediately
  initializeRealBills();
}

// IMPROVEMENT: Also initialize on page visibility change in case of service worker updates
if ('visibilityState' in document) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Optional: Re-check bills on tab focus
      // Uncomment if you want to verify bills on tab focus
      // const metadata = JSON.parse(localStorage.getItem('real_bills_metadata') || '{}');
      // if (!metadata.timestamp) {
      //   initializeRealBills();
      // }
    }
  });
}
