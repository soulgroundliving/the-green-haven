/**
 * Initialize Real Bills into localStorage
 * Called on page load to populate tenant app with real bill data
 */

async function initializeRealBills() {
  try {
    // Check if bills have already been fixed (swaps corrected)
    const billsFixed = localStorage.getItem('real_bills_fixed');
    if (billsFixed === 'true') {
      const bills2569 = localStorage.getItem('bills_2569');
      const count = bills2569 ? JSON.parse(bills2569).length : 0;
      if (count > 10) {
        console.log(`✅ Real bills already initialized and fixed (${count} bills)`);
        return;
      }
    }

    // Check if bills are already loaded (more reliable than flag check)
    const bills2569 = localStorage.getItem('bills_2569');
    if (bills2569) {
      const count = JSON.parse(bills2569).length;
      if (count > 10) {
        console.log(`✅ Real bills already initialized (${count} bills) - but fixing swaps...`);
        // Continue to fix any swaps, don't return yet
      }
    }

    console.log('📥 Loading real bills from real-bills-generated.json...');

    // Fetch real bills data
    const response = await fetch('./real-bills-generated.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (!data.bills || data.bills.length === 0) {
      throw new Error('No bills found in data');
    }

    console.log(`📊 Found ${data.bills.length} total bills`);

    // Group bills by full year (convert Thai year 67→2567, 68→2568, etc.)
    const billsByFullYear = {};

    data.bills.forEach(bill => {
      // Detect and fix swapped meter readings
      // Pattern: if electric.previous === water.current, they're swapped
      if (bill.meterReadings?.electric && bill.meterReadings?.water) {
        const mr = bill.meterReadings;
        if (mr.electric.previous === mr.water.current) {
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
        }
      }

      // Convert Thai Buddhist year to full year (67→2567, 68→2568, 69→2569)
      const fullYear = bill.year < 100 ? bill.year + 2500 : bill.year;
      const key = `bills_${fullYear}`;

      if (!billsByFullYear[key]) {
        billsByFullYear[key] = [];
      }
      billsByFullYear[key].push(bill);
    });

    // Store in localStorage
    let totalStored = 0;
    for (const [key, bills] of Object.entries(billsByFullYear)) {
      localStorage.setItem(key, JSON.stringify(bills));
      console.log(`✅ Stored ${bills.length} bills in ${key}`);
      totalStored += bills.length;
    }

    // Mark as initialized and fixed
    localStorage.setItem('real_bills_initialized', 'true');
    localStorage.setItem('real_bills_fixed', 'true');
    console.log(`✅ Real bills initialization complete: ${totalStored} bills stored with swaps fixed`);

  } catch (error) {
    console.error('❌ Error initializing real bills:', error);
  }
}

// Auto-initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRealBills);
} else {
  initializeRealBills();
}
