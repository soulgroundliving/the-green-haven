/**
 * The Green Haven - Tax Filing Module
 * Phase 5: Tax Filing System
 * Manages tax calculations, document generation, and filing for Thai Revenue Department (สรรพากร)
 */

// ===== GLOBAL STATE =====

let taxCharts = {
  revenue: null,
  expense: null
};

let currentTaxYear = new Date().getFullYear();

// ===== EXPENSE CACHE (Firestore → sync-compatible flat array) =====
// Populated by _loadExpenseCacheForYear() before any sync expense fn runs.
// Schema normalised to match the old accounting_expenses shape so all
// downstream calc functions stay synchronous.
let _expenseCache = [];
let _expenseCacheYear = null; // CE year currently in cache

const _EXP_CAT_TO_TYPE = {
  repair:  'contractor',
  wages:   'contractor',
  utility: 'utilities',
  supply:  'common',
  other:   'common',
};

async function _loadExpenseCacheForYear(ceYear) {
  if (!window.firebase?.firestore || !window.firebase?.firestoreFunctions) return;
  const db = window.firebase.firestore();
  const fs = window.firebase.firestoreFunctions;
  const buildings = ['rooms', 'nest'];
  const fetched = [];
  await Promise.all(buildings.flatMap(building =>
    Array.from({ length: 12 }, (_, i) => i + 1).map(async month => {
      const key = `${ceYear}-${String(month).padStart(2, '0')}`;
      try {
        const snap = await fs.getDocs(fs.collection(db, 'expenses', building, key));
        snap.forEach(d => {
          const raw = d.data();
          fetched.push({
            date:        raw.date || `${ceYear}-${String(month).padStart(2, '0')}-01`,
            type:        _EXP_CAT_TO_TYPE[raw.category] || 'common',
            amount:      raw.amount || 0,
            description: raw.desc || raw.description || '',
            contractor:  'ไม่ระบุ',
            building,
          });
        });
      } catch (_) { /* single-month fetch failure is non-fatal */ }
    })
  ));
  _expenseCache = fetched;
  _expenseCacheYear = ceYear;
  // Refresh dashboard KPI cards now that real expense data is available
  if (window._taxSummary && typeof renderTaxDashboardLive === 'function') {
    renderTaxDashboardLive(window._taxSummary);
  }
}

async function _ensureExpenseCache(ceYear) {
  if (_expenseCacheYear !== ceYear) await _loadExpenseCacheForYear(ceYear);
}

// ===== INITIALIZATION =====

function initializeTaxFiling() {
  console.log('🏛️ Tax Filing Module initialized');
  // Load initial dashboard data
  loadTaxDashboard();
}

// ===== REVENUE CALCULATION FUNCTIONS =====

/**
 * Calculate total revenue for a specific month
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total revenue (Baht)
 */
function calculateMonthlyRevenue(month, year) {
  const d = window._taxSummary?.months?.[month];
  return d ? Number(d.totalRevenue) || 0 : 0;
}

/**
 * Calculate total revenue for a quarter
 * @param {number} quarter - Quarter (1-4)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total quarterly revenue (Baht)
 */
function calculateQuarterlyRevenue(quarter, year) {
  try {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    let total = 0;

    for (let month = startMonth; month <= endMonth; month++) {
      total += calculateMonthlyRevenue(month, year);
    }

    return total;
  } catch (error) {
    console.error('❌ Error calculating quarterly revenue:', error);
    return 0;
  }
}

/**
 * Calculate total revenue for entire year
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total annual revenue (Baht)
 */
function calculateAnnualRevenue(year) {
  try {
    let total = 0;
    for (let month = 1; month <= 12; month++) {
      total += calculateMonthlyRevenue(month, year);
    }
    return total;
  } catch (error) {
    console.error('❌ Error calculating annual revenue:', error);
    return 0;
  }
}

/**
 * Get monthly revenue breakdown by room
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Breakdown by room
 */
function getRevenueByRoom(month, year) {
  try {
    const byRoom = {};
    const bills = window._billsCache || {};
    for (const building of Object.keys(bills)) {
      const roomMap = bills[building] || {};
      for (const room of Object.keys(roomMap)) {
        const billsObj = roomMap[room] || {};
        for (const billId of Object.keys(billsObj)) {
          const b = billsObj[billId];
          if (!b) continue;
          const ceYear = window.YearUtils ? window.YearUtils.toCE(b.year)
            : (Number(b.year) < 2500 ? 1957 + Number(b.year) : Number(b.year) - 543);
          if (ceYear !== year || Number(b.month) !== Number(month)) continue;
          const total = Number(b.totalCharge || b.totalAmount) || 0;
          if (total <= 0 && !b.charges) continue;
          const key = `${building}/${room}`;
          if (!byRoom[key]) byRoom[key] = { room, building, rent: 0, electricity: 0, water: 0, trash: 0, total: 0 };
          const c = b.charges || {};
          byRoom[key].rent        += Number(c.rent) || 0;
          byRoom[key].electricity += Number(c.electric?.cost) || 0;
          byRoom[key].water       += Number(c.water?.cost) || 0;
          byRoom[key].trash       += Number(c.trash) || 0;
          byRoom[key].total       += total;
        }
      }
    }
    return byRoom;
  } catch (error) {
    console.error('❌ Error getting revenue by room:', error);
    return {};
  }
}

// ===== EXPENSE CALCULATION FUNCTIONS =====

/**
 * Calculate total expenses for a specific month
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total expenses (Baht)
 */
function calculateMonthlyExpenses(month, year) {
  try {
    let total = 0;
    _expenseCache.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year && (expDate.getMonth() + 1) === month) {
        total += parseFloat(expense.amount) || 0;
      }
    });
    return total;
  } catch (error) {
    console.error('❌ Error calculating monthly expenses:', error);
    return 0;
  }
}

/**
 * Calculate deductible expenses (all expenses in Thai accounting)
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total deductible expenses (Baht)
 */
function calculateDeductibleExpenses(month, year) {
  // In Thai accounting, all operating expenses are deductible:
  // - Contractor labor (ค่าจ้างช่าง)
  // - Housekeeping (ค่าทำความสะอาด)
  // - Utilities (สาธารณูปโภค)
  // - Common area maintenance (ค่าบำรุงส่วนกลาง)
  return calculateMonthlyExpenses(month, year);
}

/**
 * Calculate total expenses for a quarter
 * @param {number} quarter - Quarter (1-4)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total quarterly expenses (Baht)
 */
function calculateQuarterlyExpenses(quarter, year) {
  try {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    let total = 0;

    for (let month = startMonth; month <= endMonth; month++) {
      total += calculateMonthlyExpenses(month, year);
    }

    return total;
  } catch (error) {
    console.error('❌ Error calculating quarterly expenses:', error);
    return 0;
  }
}

/**
 * Calculate total expenses for entire year
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total annual expenses (Baht)
 */
function calculateAnnualExpenses(year) {
  try {
    let total = 0;
    for (let month = 1; month <= 12; month++) {
      total += calculateMonthlyExpenses(month, year);
    }
    return total;
  } catch (error) {
    console.error('❌ Error calculating annual expenses:', error);
    return 0;
  }
}

/**
 * Get expense breakdown by category for a month
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Breakdown by category
 */
function getExpenseBreakdown(month, year) {
  try {
    const breakdown = { contractor: 0, housekeeping: 0, utilities: 0, common: 0 };
    _expenseCache.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year && (expDate.getMonth() + 1) === month) {
        const amount = parseFloat(expense.amount) || 0;
        const category = expense.type || 'contractor';
        if (Object.prototype.hasOwnProperty.call(breakdown, category)) {
          breakdown[category] += amount;
        }
      }
    });
    return breakdown;
  } catch (error) {
    console.error('❌ Error getting expense breakdown:', error);
    return { contractor: 0, housekeeping: 0, utilities: 0, common: 0 };
  }
}

// ===== WITHHOLDING TAX CALCULATION =====

/**
 * Calculate withholding tax for contractor payments
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total withholding tax (Baht)
 */
function calculateWithholdingTax(month, year) {
  try {
    const taxRate = parseFloat(localStorage.getItem('tax_rate') || '10') / 100;
    let withholding = 0;
    _expenseCache.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year &&
          (expDate.getMonth() + 1) === month &&
          expense.type === 'contractor') {
        withholding += (parseFloat(expense.amount) || 0) * taxRate;
      }
    });
    return withholding;
  } catch (error) {
    console.error('❌ Error calculating withholding tax:', error);
    return 0;
  }
}

/**
 * Calculate annual withholding tax
 * @param {number} year - Year (Gregorian)
 * @returns {number} Total annual withholding tax (Baht)
 */
function calculateAnnualWithholdingTax(year) {
  try {
    let total = 0;
    for (let month = 1; month <= 12; month++) {
      total += calculateWithholdingTax(month, year);
    }
    return total;
  } catch (error) {
    console.error('❌ Error calculating annual withholding tax:', error);
    return 0;
  }
}

/**
 * Get withholding details by contractor
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {Array} Array of withholding records
 */
function getWithholdingDetails(month, year) {
  try {
    const taxRate = parseFloat(localStorage.getItem('tax_rate') || '10') / 100;
    const withholdings = [];
    _expenseCache.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year &&
          (expDate.getMonth() + 1) === month &&
          expense.type === 'contractor') {
        const amount = parseFloat(expense.amount) || 0;
        const withheldAmount = amount * taxRate;
        withholdings.push({
          date:           expense.date,
          description:    expense.description || 'ค่าจ้างช่าง',
          paymentAmount:  amount,
          withheldAmount: withheldAmount,
          netAmount:      amount - withheldAmount,
          contractor:     expense.contractor || 'ไม่ระบุ',
        });
      }
    });
    return withholdings;
  } catch (error) {
    console.error('❌ Error getting withholding details:', error);
    return [];
  }
}

/**
 * Reconcile withholding tax (compare payments vs certificates)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Reconciliation summary
 */
function reconcileWithholding(year) {
  try {
    let totalPayments = 0;
    let totalCertificates = 0;
    let discrepancies = [];

    for (let month = 1; month <= 12; month++) {
      const monthWithholding = calculateWithholdingTax(month, year);
      totalPayments += monthWithholding;

      // Check if certificates were issued (stored in localStorage)
      const certificates = JSON.parse(localStorage.getItem(`tax_certificates_${year}_${month}`) || '[]');
      const certAmount = certificates.reduce((sum, cert) => sum + (parseFloat(cert.amount) || 0), 0);
      totalCertificates += certAmount;

      if (Math.abs(monthWithholding - certAmount) > 0.01) {
        discrepancies.push({
          month: month,
          expected: monthWithholding,
          actual: certAmount,
          difference: monthWithholding - certAmount
        });
      }
    }

    return {
      year: year,
      totalPayments: totalPayments,
      totalCertificates: totalCertificates,
      difference: totalPayments - totalCertificates,
      status: Math.abs(totalPayments - totalCertificates) < 0.01 ? 'VERIFIED' : 'DISCREPANCY',
      discrepancies: discrepancies
    };
  } catch (error) {
    console.error('❌ Error reconciling withholding:', error);
    return {
      year: year,
      totalPayments: 0,
      totalCertificates: 0,
      difference: 0,
      status: 'ERROR',
      discrepancies: []
    };
  }
}

// ===== INCOME TAX CALCULATION =====

// Income-tax calculation runs at runtime from tax-filing.html's personal-progressive
// override: window.calculateMonthlyIncomeTax / window.calculateAnnualIncomeTax compute
// ภ.ง.ด.90 (Thai personal income tax, 30% standard deduction) on the live VAT-exempt
// residential-rental model. The former corporate 15% / VAT versions that used to live
// here were removed — they were dead (shadowed by the override) and contradicted the
// live model, which only created auditor/developer confusion.

// ===== REPORT GENERATION FUNCTIONS =====

/**
 * Generate monthly tax report
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Complete monthly report data
 */
function generateMonthlyTaxReport(month, year) {
  try {
    const monthLabel = getMonthLabel(month, year);
    const revenueByRoom = getRevenueByRoom(month, year);
    const expenseBreakdown = getExpenseBreakdown(month, year);
    const withholdings = getWithholdingDetails(month, year);
    const taxInfo = calculateMonthlyIncomeTax(month, year);

    const report = {
      reportType: 'MONTHLY_TAX_REPORT',
      period: monthLabel,
      month: month,
      year: year,
      generatedDate: new Date().toISOString(),

      // Revenue section
      revenue: {
        byRoom: revenueByRoom,
        total: Object.values(revenueByRoom).reduce((sum, room) => sum + room.total, 0)
      },

      // Expense section
      expenses: {
        breakdown: expenseBreakdown,
        total: Object.values(expenseBreakdown).reduce((sum, val) => sum + val, 0)
      },

      // Tax calculation
      tax: taxInfo,

      // Withholding
      withholding: {
        details: withholdings,
        total: withholdings.reduce((sum, w) => sum + w.withheldAmount, 0)
      },

      // Status
      status: 'DRAFT'
    };

    // Save to localStorage
    const monthlyReports = JSON.parse(localStorage.getItem('monthly_tax_reports') || '{}');
    const key = `${year}-${String(month).padStart(2, '0')}`;
    monthlyReports[key] = report;
    localStorage.setItem('monthly_tax_reports', JSON.stringify(monthlyReports));

    // Log activity
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'TAX_REPORT_GENERATED',
        `สร้างรายงานภาษีรายเดือน ${monthLabel}`,
        { reportType: 'MONTHLY', month, year }
      );
    }

    console.log(`✅ Monthly tax report generated for ${monthLabel}`);
    return report;
  } catch (error) {
    console.error('❌ Error generating monthly report:', error);
    return null;
  }
}





// ===== HELPER FUNCTIONS =====

/**
 * Get month label in Thai format
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @returns {string} Thai month label (e.g., "ม.ค. 2568")
 */
function getMonthLabel(month, year) {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const buddhYear = year + 543;
  return `${months[month - 1]} ${buddhYear}`;
}

/**
 * Get full Thai month name
 * @param {number} month - Month number (1-12)
 * @returns {string} Full Thai month name
 */
function getThaiMonth(month) {
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return months[month - 1];
}

/**
 * Format number as Thai Baht currency
 * @param {number} amount - Amount in Baht
 * @returns {string} Formatted currency string
 */
function formatAsCurrency(amount) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

/**
 * Get full year expense breakdown
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Annual expense breakdown by category
 */
function getFullYearExpenseBreakdown(year) {
  try {
    const breakdown = {
      contractor: 0,
      housekeeping: 0,
      utilities: 0,
      common: 0
    };

    for (let month = 1; month <= 12; month++) {
      const monthBreakdown = getExpenseBreakdown(month, year);
      Object.keys(breakdown).forEach(category => {
        breakdown[category] += monthBreakdown[category];
      });
    }

    return breakdown;
  } catch (error) {
    console.error('❌ Error getting full year breakdown:', error);
    return { contractor: 0, housekeeping: 0, utilities: 0, common: 0 };
  }
}



// ===== DASHBOARD LOADING =====

/**
 * Load and display tax dashboard data
 */
async function loadTaxDashboard() {
  try {
    const currentYear = new Date().getFullYear();
    await _loadExpenseCacheForYear(currentYear);

    // Calculate KPI values
    const annualRevenue = calculateAnnualRevenue(currentYear);
    const annualExpenses = calculateAnnualExpenses(currentYear);
    const netIncome = annualRevenue - annualExpenses;
    const estimatedTax = calculateAnnualIncomeTax(currentYear).incomeTax;

    // Update KPI cards (using actual element IDs from HTML)
    const revenueCard = document.getElementById('annual-revenue');
    const expensesCard = document.getElementById('annual-expenses');
    const incomeCard = document.getElementById('net-income');
    const taxCard = document.getElementById('estimated-tax');

    if (revenueCard) revenueCard.textContent = formatAsCurrency(annualRevenue);
    if (expensesCard) expensesCard.textContent = formatAsCurrency(annualExpenses);
    if (incomeCard) incomeCard.textContent = formatAsCurrency(netIncome);
    if (taxCard) taxCard.textContent = formatAsCurrency(estimatedTax);

    // Render charts
    renderTaxDashboardCharts(currentYear);

    // Initialize checklist
    initializeTaxFilingChecklist();

    console.log('✅ Tax dashboard loaded');
  } catch (error) {
    console.error('❌ Error loading tax dashboard:', error);
  }
}

/**
 * Render dashboard charts
 */
function renderTaxDashboardCharts(year) {
  try {
    // Revenue trend chart
    renderRevenueChart(year);

    // Expense breakdown chart
    renderExpenseChart(year);
  } catch (error) {
    console.error('❌ Error rendering charts:', error);
  }
}

/**
 * Render 12-month revenue trend chart
 */
function renderRevenueChart(year) {
  try {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;

    const months = [];
    const data = [];

    for (let month = 1; month <= 12; month++) {
      months.push(getMonthLabel(month, year).split(' ')[0]);
      data.push(calculateMonthlyRevenue(month, year));
    }

    if (taxCharts.revenue) taxCharts.revenue.destroy();

    taxCharts.revenue = new Chart(ctx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'รายได้รวม',
          data: data,
          borderColor: '#2d8653',
          backgroundColor: 'rgba(45, 134, 83, 0.05)',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointBackgroundColor: '#2d8653'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  } catch (error) {
    console.error('❌ Error rendering revenue chart:', error);
  }
}

/**
 * Render expense breakdown pie chart
 */
function renderExpenseChart(year) {
  try {
    const ctx = document.getElementById('expenseChart');
    if (!ctx) return;

    const breakdown = getFullYearExpenseBreakdown(year);
    const labels = ['ค่าจ้างช่าง', 'ค่าทำความสะอาด', 'สาธารณูปโภค', 'ค่าบำรุงส่วนกลาง'];
    const data = [breakdown.contractor, breakdown.housekeeping, breakdown.utilities, breakdown.common];
    const colors = ['#e74c3c', '#3498db', '#f39c12', '#95a5a6'];

    if (taxCharts.expense) taxCharts.expense.destroy();

    taxCharts.expense = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  } catch (error) {
    console.error('❌ Error rendering expense chart:', error);
  }
}

// ===== PAGE NAVIGATION =====

/**
 * Switch between tax filing pages
 */
function showTaxPage(pageName, btn) {
  try {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
      page.classList.remove('active');
    });

    // Remove active class from all sidebar items
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
    });

    // Show selected page - try both ID formats
    let pageElement = document.getElementById(pageName + '-page');
    if (!pageElement) {
      pageElement = document.getElementById(pageName);
    }

    if (pageElement) {
      pageElement.classList.add('active');
    } else {
      console.warn(`⚠️ Page element not found: ${pageName}-page or ${pageName}`);
    }

    // Add active class to clicked button
    if (btn) {
      btn.classList.add('active');
    }

    // Close sidebar on mobile
    if (window.innerWidth <= 768) {
      const sidebar = document.getElementById('sidebar');
      const hamburger = document.getElementById('hamburger');
      if (sidebar) sidebar.classList.remove('active');
      if (hamburger) hamburger.classList.remove('active');
    }

    console.log(`📄 Switched to tax page: ${pageName}`);
  } catch (error) {
    console.error('❌ Error switching page:', error);
  }
}

/**
 * Handle logout
 */
function handleLogout() {
  if (confirm('คุณแน่ใจหรือว่าต้องการออกจากระบบ?')) {
    window.location.href = '../../login.html';
  }
}

// ===== PAGE INTERACTION FUNCTIONS =====

/**
 * Convert Buddhist year to Gregorian year
 * @param {number} buddhYear - Buddhist year (e.g., 2567)
 * @returns {number} Gregorian year (e.g., 2024)
 */
function convertBuddhistToGregorian(buddhYear) {
  return buddhYear - 543;
}

/**
 * Convert Gregorian year to Buddhist year
 * @param {number} year - Gregorian year (e.g., 2024)
 * @returns {number} Buddhist year (e.g., 2567)
 */
function convertGregorianToBuddhist(year) {
  return year + 543;
}

/**
 * Update monthly report display
 */
function updateMonthlyReport() {
  try {
    const contentDiv = document.getElementById('monthly-report-content');
    if (!contentDiv) return;

    // Show loading indicator
    contentDiv.innerHTML = '<div style="padding: 20px; text-align: center;"><p>⏳ กำลังสร้างรายงาน...</p></div>';

    const month = parseInt(document.getElementById('monthly-month').value) || 3;
    const buddhYear = parseInt(document.getElementById('monthly-year').value) || 2567;
    const year = convertBuddhistToGregorian(buddhYear);

    // Use setTimeout to prevent blocking
    setTimeout(() => {
      try {
        // Generate the report
        const report = generateMonthlyTaxReport(month, year);
        if (!report) {
          contentDiv.innerHTML = '<div style="padding: 20px; color: var(--red);">❌ ไม่สามารถสร้างรายงานได้</div>';
          showError('ไม่สามารถสร้างรายงานได้');
          return;
        }

        // Display the report
        displayMonthlyReport(report);
        console.log(`✅ Monthly report updated for ${getMonthLabel(month, year)}`);
      } catch (error) {
        console.error('❌ Error during report generation:', error);
        contentDiv.innerHTML = '<div style="padding: 20px; color: var(--red);">❌ เกิดข้อผิดพลาด: ' + error.message + '</div>';
        showError('เกิดข้อผิดพลาด: ' + error.message);
      }
    }, 100);
  } catch (error) {
    console.error('❌ Error updating monthly report:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Display monthly report in HTML
 */
function displayMonthlyReport(report) {
  try {
    const contentDiv = document.getElementById('monthly-report-content');
    if (!contentDiv) return;

    let html = `
      <div style="padding: 15px; background: #f9f9f9; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="color: var(--text); margin-bottom: 15px;">📊 รายงานรายได้ - ${report.period}</h3>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: var(--green); color: white;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">ห้อง</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">ค่าเช่า</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">ไฟฟ้า</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">น้ำ</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">รวม</th>
            </tr>
          </thead>
          <tbody>
    `;

    Object.entries(report.revenue.byRoom).forEach(([room, data]) => {
      html += `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">${room}</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(data.rent)}</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(data.electricity)}</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(data.water)}</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd; font-weight: bold; color: var(--green);">${formatAsCurrency(data.total)}</td>
        </tr>
      `;
    });

    html += `
        <tr style="background: var(--green-pale); font-weight: bold;">
          <td colspan="4" style="padding: 10px; border: 1px solid #ddd; text-align: right;">รวมรายได้ทั้งหมด:</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: var(--green);">${formatAsCurrency(report.revenue.total)}</td>
        </tr>
      </tbody>
        </table>

        <h3 style="color: var(--text); margin: 20px 0 15px;">📉 ค่าใช้จ่าย</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: var(--blue); color: white;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">หมวดหมู่</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">จำนวน</th>
            </tr>
          </thead>
          <tbody>
    `;

    const categoryNames = {
      contractor: 'ค่าจ้างช่าง',
      housekeeping: 'ค่าทำความสะอาด',
      utilities: 'สาธารณูปโภค',
      common: 'ค่าบำรุงส่วนกลาง'
    };

    Object.entries(report.expenses.breakdown).forEach(([category, amount]) => {
      if (amount > 0) {
        html += `
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${categoryNames[category] || category}</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(amount)}</td>
          </tr>
        `;
      }
    });

    html += `
        <tr style="background: var(--blue-pale); font-weight: bold;">
          <td style="padding: 10px; border: 1px solid #ddd;">รวมค่าใช้จ่ายทั้งหมด:</td>
          <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: var(--blue);">${formatAsCurrency(report.expenses.total)}</td>
        </tr>
      </tbody>
        </table>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px;">
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid var(--green);">
            <div style="font-size: 0.9rem; color: var(--text-muted);">กำไรสุทธิ</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--green); margin-top: 5px;">
              ${formatAsCurrency(report.revenue.total - report.expenses.total)}
            </div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid var(--blue);">
            <div style="font-size: 0.9rem; color: var(--text-muted);">หัก ณ ที่จ่าย</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--blue); margin-top: 5px;">
              ${formatAsCurrency(report.withholding.total)}
            </div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid var(--purple);">
            <div style="font-size: 0.9rem; color: var(--text-muted);">ประมาณภาษี</div>
            <div style="font-size: 1.5rem; font-weight: bold; color: var(--purple); margin-top: 5px;">
              ${formatAsCurrency(report.tax.incomeTax)}
            </div>
          </div>
        </div>
      </div>
    `;

    contentDiv.innerHTML = html;
  } catch (error) {
    console.error('❌ Error displaying monthly report:', error);
  }
}

/**
 * Generate and display monthly report
 */
function generateMonthlyReport() {
  try {
    updateMonthlyReport();
    // Delay success message to allow async rendering
    setTimeout(() => {
      showSuccess('สร้างรายงานเดือนเรียบร้อย');
    }, 500);
  } catch (error) {
    console.error('❌ Error generating monthly report:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}





/**
 * Reconcile and display withholding tax
 */
function displayWithholdingReconciliation() {
  try {
    const buddhYear = parseInt(document.getElementById('withholding-year').value) || 2567;
    const year = convertBuddhistToGregorian(buddhYear);

    const reconciliation = reconcileWithholding(year);

    const contentDiv = document.getElementById('withholding-report-content');
    if (!contentDiv) return;

    let html = `
      <div style="padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <h3 style="color: var(--text); margin-bottom: 15px;">🔍 สรุปการหัก ณ ที่จ่าย - ปี ${reconciliation.year + 543}</h3>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid var(--green);">
            <div style="font-size: 0.9rem; color: var(--text-muted);">รวมการหัก ณ ที่จ่าย</div>
            <div style="font-size: 1.3rem; font-weight: bold; color: var(--green); margin-top: 5px;">
              ${formatAsCurrency(reconciliation.totalPayments)}
            </div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid var(--blue);">
            <div style="font-size: 0.9rem; color: var(--text-muted);">ใบหักที่ออก</div>
            <div style="font-size: 1.3rem; font-weight: bold; color: var(--blue); margin-top: 5px;">
              ${formatAsCurrency(reconciliation.totalCertificates)}
            </div>
          </div>
          <div style="background: white; padding: 15px; border-radius: 8px; border-left: 4px solid ${reconciliation.status === 'VERIFIED' ? 'var(--green)' : 'var(--red)'};">
            <div style="font-size: 0.9rem; color: var(--text-muted);">สถานะ</div>
            <div style="font-size: 1.3rem; font-weight: bold; color: ${reconciliation.status === 'VERIFIED' ? 'var(--green)' : 'var(--red)'}; margin-top: 5px;">
              ${reconciliation.status === 'VERIFIED' ? '✅ ตรวจสอบแล้ว' : '⚠️ มีความแตกต่าง'}
            </div>
          </div>
        </div>

        ${reconciliation.discrepancies.length > 0 ? `
          <h4 style="color: var(--red); margin: 20px 0 10px;">⚠️ ความแตกต่าง</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <tr style="background: var(--red); color: white;">
              <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">เดือน</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">คาดการณ์</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">ที่ออกจริง</th>
              <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">ความแตกต่าง</th>
            </tr>
            ${reconciliation.discrepancies.map(disc => `
              <tr>
                <td style="padding: 10px; border: 1px solid #ddd;">${getMonthLabel(disc.month, year)}</td>
                <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(disc.expected)}</td>
                <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(disc.actual)}</td>
                <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: var(--red); font-weight: bold;">${formatAsCurrency(disc.difference)}</td>
              </tr>
            `).join('')}
          </table>
        ` : '<div style="padding: 10px; background: var(--green-pale); border-radius: 4px; color: var(--green); font-weight: bold;">✅ ไม่มีความแตกต่าง - ตรวจสอบเสร็จสิ้น</div>'}
      </div>
    `;

    contentDiv.innerHTML = html;
  } catch (error) {
    console.error('❌ Error reconciling withholding:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Initialize and display tax filing checklist
 */
function initializeTaxFilingChecklist() {
  try {
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;

    const checklist = [
      {
        id: 'monthly-jan',
        title: 'รายงานรายเดือน มกราคม',
        description: 'Monthly tax report for January',
        dueDate: `${currentYear}-02-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-feb',
        title: 'รายงานรายเดือน กุมภาพันธ์',
        description: 'Monthly tax report for February',
        dueDate: `${currentYear}-03-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-apr',
        title: 'รายงานรายเดือน เมษายน',
        description: 'Monthly tax report for April',
        dueDate: `${currentYear}-05-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-may',
        title: 'รายงานรายเดือน พฤษภาคม',
        description: 'Monthly tax report for May',
        dueDate: `${currentYear}-06-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-jul',
        title: 'รายงานรายเดือน กรกฎาคม',
        description: 'Monthly tax report for July',
        dueDate: `${currentYear}-08-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-aug',
        title: 'รายงานรายเดือน สิงหาคม',
        description: 'Monthly tax report for August',
        dueDate: `${currentYear}-09-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-oct',
        title: 'รายงานรายเดือน ตุลาคม',
        description: 'Monthly tax report for October',
        dueDate: `${currentYear}-11-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'monthly-nov',
        title: 'รายงานรายเดือน พฤศจิกายน',
        description: 'Monthly tax report for November',
        dueDate: `${currentYear}-12-15`,
        type: 'MONTHLY',
        status: 'PENDING'
      },
      {
        id: 'annual-return',
        title: 'แบบ ภ.ง.ด.90',
        description: `Annual income tax return for year ${currentYear}`,
        dueDate: `${nextYear}-03-20`,
        type: 'ANNUAL',
        status: 'PENDING'
      },
      {
        id: 'withholding-cert',
        title: 'ใบหักประจำปี',
        description: `Annual withholding certificate (ใบหัก ณ ที่จ่าย) for year ${currentYear}`,
        dueDate: `${nextYear}-02-15`,
        type: 'WITHHOLDING',
        status: 'PENDING'
      }
    ];

    // Save to localStorage
    localStorage.setItem(`tax_filing_checklist_${currentYear}`, JSON.stringify(checklist));

    // Display the checklist
    displayTaxFilingChecklist(checklist, currentYear);
  } catch (error) {
    console.error('❌ Error initializing checklist:', error);
  }
}

/**
 * Display tax filing checklist
 */
function displayTaxFilingChecklist(checklist, year) {
  try {
    const contentDiv = document.getElementById('checklist-content');
    if (!contentDiv) return;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    let html = `
      <div style="padding: 15px;">
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px;">
          <div style="background: var(--blue); color: white; padding: 10px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 5px;">📋</div>
            <div style="font-size: 1.2rem; font-weight: bold;">${checklist.length}</div>
            <div style="font-size: 0.85rem;">รวมเอกสาร</div>
          </div>
          <div style="background: var(--green); color: white; padding: 10px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 5px;">✅</div>
            <div style="font-size: 1.2rem; font-weight: bold;">${checklist.filter(c => c.status === 'COMPLETED').length}</div>
            <div style="font-size: 0.85rem;">สำเร็จแล้ว</div>
          </div>
          <div style="background: var(--orange); color: white; padding: 10px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 5px;">⏰</div>
            <div style="font-size: 1.2rem; font-weight: bold;">${checklist.filter(c => c.status === 'PENDING' && c.dueDate < todayStr).length}</div>
            <div style="font-size: 0.85rem;">เกินกำหนด</div>
          </div>
          <div style="background: var(--purple); color: white; padding: 10px; border-radius: 8px; text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 5px;">📅</div>
            <div style="font-size: 1.2rem; font-weight: bold;">${checklist.filter(c => c.status === 'PENDING' && c.dueDate >= todayStr).length}</div>
            <div style="font-size: 0.85rem;">รอดำเนิน</div>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: var(--green); color: white;">
              <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">เอกสาร</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">ประเภท</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">กำหนดส่ง</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">สถานะ</th>
              <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">ดำเนิน</th>
            </tr>
          </thead>
          <tbody>
    `;

    checklist.forEach(item => {
      const dueDate = new Date(item.dueDate);
      const isOverdue = dueDate < today && item.status === 'PENDING';
      const isDueSoon = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24)) <= 7 && item.status === 'PENDING';

      let statusBg = 'var(--blue)';
      let statusText = 'รอดำเนิน';
      let statusEmoji = '📋';

      if (item.status === 'COMPLETED') {
        statusBg = 'var(--green)';
        statusText = '✅ สำเร็จ';
        statusEmoji = '✅';
      } else if (isOverdue) {
        statusBg = 'var(--red)';
        statusText = '⚠️ เกินกำหนด';
        statusEmoji = '❌';
      } else if (isDueSoon) {
        statusBg = 'var(--orange)';
        statusText = '⏰ ใกล้กำหนด';
        statusEmoji = '⏰';
      }

      const typeEmoji = {
        'MONTHLY': '📅',
        'QUARTERLY': '📊',
        'ANNUAL': '📄',
        'WITHHOLDING': '🏷️'
      }[item.type] || '📋';

      html += `
        <tr>
          <td style="padding: 12px; border: 1px solid #ddd;">
            <div style="font-weight: bold; color: var(--text);">${item.title}</div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">${item.description}</div>
          </td>
          <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">
            <div>${typeEmoji} ${item.type}</div>
          </td>
          <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">
            <div style="font-weight: bold;">${item.dueDate}</div>
          </td>
          <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">
            <div style="background: ${statusBg}; color: white; padding: 5px 10px; border-radius: 4px; font-weight: bold; display: inline-block;">
              ${statusText}
            </div>
          </td>
          <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">
            <button class="btn btn-sm" style="padding: 5px 10px; font-size: 0.85rem;" data-action="update-checklist-status" data-item-id="${item.id}">
              ✓ ทำเสร็จ
            </button>
          </td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;

    contentDiv.innerHTML = html;
    console.log('✅ Tax filing checklist displayed');
  } catch (error) {
    console.error('❌ Error displaying checklist:', error);
  }
}

/**
 * Update checklist item status
 */
function updateChecklistStatus(itemId, status) {
  try {
    const currentYear = new Date().getFullYear();
    const checklistKey = `tax_filing_checklist_${currentYear}`;
    const checklist = JSON.parse(localStorage.getItem(checklistKey) || '[]');

    const item = checklist.find(c => c.id === itemId);
    if (item) {
      item.status = status;
      localStorage.setItem(checklistKey, JSON.stringify(checklist));

      // Log activity
      if (window.AuditLogger) {
        window.AuditLogger.log(
          'CHECKLIST_UPDATED',
          `อัปเดตสถานะเอกสาร: ${item.title}`,
          { itemId, status, year: currentYear }
        );
      }

      // Refresh display
      initializeTaxFilingChecklist();
      showSuccess('อัปเดตสถานะเรียบร้อย');
    }
  } catch (error) {
    console.error('❌ Error updating checklist status:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

// Export functions are defined in tax-export.js and will override these placeholders
// They will be loaded after this file and take precedence

// ===== UTILITY FUNCTIONS =====

/**
 * Show error message
 */
function showError(message) {
  alert('❌ ' + message);
}

/**
 * Show success message
 */
function showSuccess(message) {
  alert('✅ ' + message);
}

/**
 * Export functions for module usage
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateMonthlyRevenue,
    calculateQuarterlyRevenue,
    calculateAnnualRevenue,
    calculateMonthlyExpenses,
    calculateDeductibleExpenses,
    calculateQuarterlyExpenses,
    calculateAnnualExpenses,
    calculateWithholdingTax,
    calculateAnnualWithholdingTax,
    generateMonthlyTaxReport,
    reconcileWithholding
  };
}
