/**
 * Initialize Real Bills into localStorage
 * Called on page load to populate tenant app with real bill data
 */

async function initializeRealBills() {
  try {
    // Check if already initialized
    const check = localStorage.getItem('real_bills_initialized');
    if (check === 'true') {
      console.log('✅ Real bills already initialized');
      return;
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

    // Mark as initialized
    localStorage.setItem('real_bills_initialized', 'true');
    console.log(`✅ Real bills initialization complete: ${totalStored} bills stored`);

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
