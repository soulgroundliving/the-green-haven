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
  try {
    const bills = JSON.parse(localStorage.getItem('bills') || '[]');
    let total = 0;

    bills.forEach(bill => {
      if (bill.year === year && bill.month === month && bill.paid === true) {
        const rent = parseFloat(bill.rent) || 0;
        const electricity = parseFloat(bill.electricity) || 0;
        const water = parseFloat(bill.water) || 0;
        total += rent + electricity + water;
      }
    });

    return total;
  } catch (error) {
    console.error('❌ Error calculating monthly revenue:', error);
    return 0;
  }
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
    const bills = JSON.parse(localStorage.getItem('bills') || '[]');
    const breakdown = {};

    bills.forEach(bill => {
      if (bill.year === year && bill.month === month && bill.paid === true) {
        if (!breakdown[bill.room]) {
          breakdown[bill.room] = {
            rent: 0,
            electricity: 0,
            water: 0,
            total: 0
          };
        }
        const rent = parseFloat(bill.rent) || 0;
        const electricity = parseFloat(bill.electricity) || 0;
        const water = parseFloat(bill.water) || 0;

        breakdown[bill.room].rent += rent;
        breakdown[bill.room].electricity += electricity;
        breakdown[bill.room].water += water;
        breakdown[bill.room].total += rent + electricity + water;
      }
    });

    return breakdown;
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
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    let total = 0;

    expenses.forEach(expense => {
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
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    const breakdown = {
      contractor: 0,
      housekeeping: 0,
      utilities: 0,
      common: 0
    };

    expenses.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year && (expDate.getMonth() + 1) === month) {
        const amount = parseFloat(expense.amount) || 0;
        const category = expense.type || 'contractor';
        if (breakdown.hasOwnProperty(category)) {
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
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    const taxRate = parseFloat(localStorage.getItem('tax_rate') || '10') / 100;
    let withholding = 0;

    // Get contractor expenses and calculate 10% withholding
    expenses.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year &&
          (expDate.getMonth() + 1) === month &&
          expense.type === 'contractor') {
        const amount = parseFloat(expense.amount) || 0;
        withholding += amount * taxRate;
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
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    const taxRate = parseFloat(localStorage.getItem('tax_rate') || '10') / 100;
    const withholdings = [];

    expenses.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year &&
          (expDate.getMonth() + 1) === month &&
          expense.type === 'contractor') {
        const amount = parseFloat(expense.amount) || 0;
        const withheldAmount = amount * taxRate;

        withholdings.push({
          date: expense.date,
          description: expense.description || 'ค่าจ้างช่าง',
          paymentAmount: amount,
          withheldAmount: withheldAmount,
          netAmount: amount - withheldAmount,
          contractor: expense.contractor || 'ไม่ระบุ'
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

/**
 * Calculate income tax for a period
 * Thai corporate tax rate: 15% standard rate
 * @param {number} month - Month number (1-12)
 * @param {number} year - Year (Gregorian)
 * @param {number} rate - Tax rate (default 15%)
 * @returns {Object} Tax calculation details
 */
function calculateMonthlyIncomeTax(month, year, rate = 15) {
  try {
    const revenue = calculateMonthlyRevenue(month, year);
    const expenses = calculateDeductibleExpenses(month, year);
    const taxableIncome = Math.max(0, revenue - expenses);
    const incomeTax = (taxableIncome * rate) / 100;
    const withholding = calculateWithholdingTax(month, year);
    const taxBalance = incomeTax - withholding; // Positive = amount owed, Negative = excess withholding

    return {
      month: month,
      year: year,
      revenue: revenue,
      deductibleExpenses: expenses,
      taxableIncome: taxableIncome,
      taxRate: rate,
      incomeTax: incomeTax,
      withholdingTax: withholding,
      taxBalance: taxBalance,
      status: taxBalance > 0 ? 'OWED' : (taxBalance < 0 ? 'REFUND' : 'BALANCED')
    };
  } catch (error) {
    console.error('❌ Error calculating income tax:', error);
    return null;
  }
}

/**
 * Calculate estimated tax for a quarter
 * @param {number} quarter - Quarter (1-4)
 * @param {number} year - Year (Gregorian)
 * @param {number} rate - Tax rate (default 15%)
 * @returns {Object} Quarterly tax calculation
 */
function calculateQuarterlyIncomeTax(quarter, year, rate = 15) {
  try {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;

    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalWithholding = 0;

    for (let month = startMonth; month <= endMonth; month++) {
      totalRevenue += calculateMonthlyRevenue(month, year);
      totalExpenses += calculateDeductibleExpenses(month, year);
      totalWithholding += calculateWithholdingTax(month, year);
    }

    const taxableIncome = Math.max(0, totalRevenue - totalExpenses);
    const incomeTax = (taxableIncome * rate) / 100;
    const taxBalance = incomeTax - totalWithholding;

    // Calculate due date for quarterly return (ป.พ.6)
    const quarterDueDates = {
      1: { dueDate: '20 เมษายน', deadline: `${year}-04-20` },
      2: { dueDate: '20 กรกฎาคม', deadline: `${year}-07-20` },
      3: { dueDate: '20 ตุลาคม', deadline: `${year}-10-20` },
      4: { dueDate: '20 มีนาคม', deadline: `${year + 1}-03-20` }
    };

    return {
      quarter: quarter,
      year: year,
      monthsIncluded: [startMonth, endMonth],
      revenue: totalRevenue,
      deductibleExpenses: totalExpenses,
      taxableIncome: taxableIncome,
      taxRate: rate,
      incomeTax: incomeTax,
      withholdingTax: totalWithholding,
      taxBalance: taxBalance,
      estimatedInstallment: Math.max(0, taxBalance),
      dueDate: quarterDueDates[quarter].deadline,
      formType: 'ป.พ.6'
    };
  } catch (error) {
    console.error('❌ Error calculating quarterly income tax:', error);
    return null;
  }
}

/**
 * Calculate annual income tax (ภ.ป.ภ. 50 form)
 * @param {number} year - Year (Gregorian)
 * @param {number} rate - Tax rate (default 15%)
 * @returns {Object} Annual tax calculation
 */
function calculateAnnualIncomeTax(year, rate = 15) {
  try {
    const totalRevenue = calculateAnnualRevenue(year);
    const totalExpenses = calculateAnnualExpenses(year);
    const taxableIncome = Math.max(0, totalRevenue - totalExpenses);
    const incomeTax = (taxableIncome * rate) / 100;
    const totalWithholding = calculateAnnualWithholdingTax(year);
    const taxBalance = incomeTax - totalWithholding;

    // Annual filing deadline: 20 March next year
    const filingDeadline = `${year + 1}-03-20`;

    return {
      year: year,
      revenue: totalRevenue,
      deductibleExpenses: totalExpenses,
      taxableIncome: taxableIncome,
      taxRate: rate,
      incomeTax: incomeTax,
      withholdingTax: totalWithholding,
      taxBalance: taxBalance,
      refundAmount: taxBalance < 0 ? Math.abs(taxBalance) : 0,
      owedAmount: taxBalance > 0 ? taxBalance : 0,
      filingDeadline: filingDeadline,
      formType: 'ภ.ป.ภ. 50'
    };
  } catch (error) {
    console.error('❌ Error calculating annual income tax:', error);
    return null;
  }
}

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

/**
 * Generate quarterly tax return (ป.พ.6)
 * @param {number} quarter - Quarter (1-4)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Complete quarterly return data
 */
function generateQuarterlyReturn(quarter, year) {
  try {
    const quarterLabel = `ไตรมาส ${quarter}/${year + 543}`;
    const taxInfo = calculateQuarterlyIncomeTax(quarter, year);

    // Gather monthly details for the quarter
    const monthlyDetails = [];
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;

    for (let month = startMonth; month <= endMonth; month++) {
      const monthReport = generateMonthlyTaxReport(month, year);
      if (monthReport) {
        monthlyDetails.push({
          month: month,
          label: getMonthLabel(month, year),
          revenue: monthReport.revenue.total,
          expenses: monthReport.expenses.total,
          withholding: monthReport.withholding.total
        });
      }
    }

    const report = {
      reportType: 'QUARTERLY_RETURN',
      formType: 'ป.พ.6',
      period: quarterLabel,
      quarter: quarter,
      year: year,
      generatedDate: new Date().toISOString(),

      monthlyDetails: monthlyDetails,

      summary: {
        totalRevenue: taxInfo.revenue,
        totalExpenses: taxInfo.deductibleExpenses,
        taxableIncome: taxInfo.taxableIncome,
        incomeTax: taxInfo.incomeTax,
        withholdingTax: taxInfo.withholdingTax,
        estimatedInstallment: taxInfo.estimatedInstallment
      },

      dueDate: taxInfo.dueDate,
      status: 'DRAFT'
    };

    // Save to localStorage
    const quarterlyReturns = JSON.parse(localStorage.getItem('quarterly_tax_returns') || '{}');
    const key = `${year}-Q${quarter}`;
    quarterlyReturns[key] = report;
    localStorage.setItem('quarterly_tax_returns', JSON.stringify(quarterlyReturns));

    // Log activity
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'TAX_REPORT_GENERATED',
        `สร้างแบบ ป.พ.6 ${quarterLabel}`,
        { reportType: 'QUARTERLY', quarter, year }
      );
    }

    console.log(`✅ Quarterly return (ป.พ.6) generated for ${quarterLabel}`);
    return report;
  } catch (error) {
    console.error('❌ Error generating quarterly return:', error);
    return null;
  }
}

/**
 * Generate annual tax return (ภ.ป.ภ. 50)
 * @param {number} year - Year (Gregorian)
 * @returns {Object} Complete annual return data with financial statements
 */
function generateAnnualReport(year) {
  try {
    const taxInfo = calculateAnnualIncomeTax(year);
    const allExpenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');

    // Build transaction list
    const transactions = {
      revenue: [],
      expenses: []
    };

    // Add revenue transactions (from bills)
    const bills = JSON.parse(localStorage.getItem('bills') || '[]');
    bills.forEach(bill => {
      if (bill.year === year && bill.paid === true) {
        transactions.revenue.push({
          date: `${year}-${String(bill.month).padStart(2, '0')}-01`,
          room: bill.room,
          rent: parseFloat(bill.rent) || 0,
          electricity: parseFloat(bill.electricity) || 0,
          water: parseFloat(bill.water) || 0,
          total: (parseFloat(bill.rent) || 0) + (parseFloat(bill.electricity) || 0) + (parseFloat(bill.water) || 0),
          type: 'REVENUE'
        });
      }
    });

    // Add expense transactions
    allExpenses.forEach(expense => {
      const expDate = new Date(expense.date);
      if (expDate.getFullYear() === year) {
        transactions.expenses.push({
          date: expense.date,
          description: expense.description || expense.type,
          type: expense.type || 'contractor',
          amount: parseFloat(expense.amount) || 0,
          contractor: expense.contractor || 'ไม่ระบุ'
        });
      }
    });

    const report = {
      reportType: 'ANNUAL_RETURN',
      formType: 'ภ.ป.ภ. 50',
      year: year,
      buddhYear: year + 543,
      generatedDate: new Date().toISOString(),

      // Financial Summary
      financialSummary: {
        totalRevenue: taxInfo.revenue,
        totalExpenses: taxInfo.deductibleExpenses,
        netIncome: taxInfo.taxableIncome
      },

      // Expense Breakdown
      expenseBreakdown: getFullYearExpenseBreakdown(year),

      // Tax Calculation
      taxCalculation: {
        taxableIncome: taxInfo.taxableIncome,
        taxRate: taxInfo.taxRate,
        incomeTax: taxInfo.incomeTax,
        withholdingTax: taxInfo.withholdingTax,
        taxBalance: taxInfo.taxBalance,
        refundAmount: taxInfo.refundAmount,
        owedAmount: taxInfo.owedAmount
      },

      // Transaction Details
      transactions: transactions,

      // Quarterly Breakdown
      quarterlyBreakdown: getQuarterlyBreakdown(year),

      // Filing Info
      filingDeadline: taxInfo.filingDeadline,
      status: 'DRAFT'
    };

    // Save to localStorage
    const annualReturns = JSON.parse(localStorage.getItem('annual_tax_returns') || '{}');
    annualReturns[year] = report;
    localStorage.setItem('annual_tax_returns', JSON.stringify(annualReturns));

    // Log activity
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'TAX_REPORT_GENERATED',
        `สร้างแบบ ภ.ป.ภ. 50 สำหรับปี ${year + 543}`,
        { reportType: 'ANNUAL', year }
      );
    }

    console.log(`✅ Annual return (ภ.ป.ภ. 50) generated for ${year}`);
    return report;
  } catch (error) {
    console.error('❌ Error generating annual report:', error);
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

/**
 * Get quarterly breakdown for the year
 * @param {number} year - Year (Gregorian)
 * @returns {Array} Array of quarterly summaries
 */
function getQuarterlyBreakdown(year) {
  try {
    const breakdown = [];

    for (let quarter = 1; quarter <= 4; quarter++) {
      const quarterInfo = calculateQuarterlyIncomeTax(quarter, year);
      if (quarterInfo) {
        breakdown.push({
          quarter: quarter,
          revenue: quarterInfo.revenue,
          expenses: quarterInfo.deductibleExpenses,
          taxableIncome: quarterInfo.taxableIncome,
          incomeTax: quarterInfo.incomeTax,
          withholdingTax: quarterInfo.withholdingTax,
          balance: quarterInfo.taxBalance
        });
      }
    }

    return breakdown;
  } catch (error) {
    console.error('❌ Error getting quarterly breakdown:', error);
    return [];
  }
}

// ===== DASHBOARD LOADING =====

/**
 * Load and display tax dashboard data
 */
function loadTaxDashboard() {
  try {
    const currentYear = new Date().getFullYear();

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
    document.querySelectorAll('.tax-page').forEach(page => {
      page.classList.remove('active');
    });

    // Remove active class from all sidebar items
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
    });

    // Show selected page
    const pageElement = document.getElementById(pageName);
    if (pageElement) {
      pageElement.classList.add('active');
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
    const month = parseInt(document.getElementById('monthly-month').value) || 3;
    const buddhYear = parseInt(document.getElementById('monthly-year').value) || 2567;
    const year = convertBuddhistToGregorian(buddhYear);

    // Generate the report
    const report = generateMonthlyTaxReport(month, year);
    if (!report) {
      showError('ไม่สามารถสร้างรายงานได้');
      return;
    }

    // Display the report
    displayMonthlyReport(report);
    console.log(`✅ Monthly report updated for ${getMonthLabel(month, year)}`);
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
    showSuccess('สร้างรายงานเดือนเรียบร้อย');
  } catch (error) {
    console.error('❌ Error generating monthly report:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Generate and display quarterly return
 */
function displayQuarterlyReturn(quarter) {
  try {
    const currentYear = new Date().getFullYear();
    const report = generateQuarterlyReturn(quarter, currentYear);

    if (!report) {
      showError('ไม่สามารถสร้างแบบประเมิน ป.พ.6 ได้');
      return;
    }

    const contentDiv = document.getElementById('quarterly-report-content');
    if (!contentDiv) return;

    let html = `
      <div style="padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <h3 style="color: var(--text); margin-bottom: 15px;">📋 แบบประเมิน ป.พ.6 - ${report.period}</h3>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background: var(--green-light); color: white;">
            <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">รายการ</th>
            <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">จำนวน</th>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">รายได้รวม</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.summary.totalRevenue)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">ค่าใช้จ่าย</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.summary.totalExpenses)}</td>
          </tr>
          <tr style="background: var(--green-pale); font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #ddd;">รายได้สุทธิ</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.summary.taxableIncome)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">ภาษีอากร</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.summary.incomeTax)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">หัก ณ ที่จ่าย</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.summary.withholdingTax)}</td>
          </tr>
          <tr style="background: var(--blue-pale); font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #ddd;">ยอดชำระ</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">฿${report.summary.estimatedInstallment.toFixed(2)}</td>
          </tr>
        </table>

        <div style="padding: 15px; background: var(--accent-light); border-radius: 8px; border-left: 4px solid var(--accent);">
          <strong>📅 กำหนดส่ง:</strong> ${report.dueDate}<br>
          <strong>แบบฟอร์ม:</strong> ${report.formType}
        </div>
      </div>
    `;

    contentDiv.innerHTML = html;
    showSuccess(`สร้างแบบประเมิน ป.พ.6 ไตรมาส ${quarter} เรียบร้อย`);
  } catch (error) {
    console.error('❌ Error generating quarterly return:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Generate annual report and display
 */
function displayAnnualReport() {
  try {
    const buddhYear = parseInt(document.getElementById('annual-year').value) || 2567;
    const year = convertBuddhistToGregorian(buddhYear);

    const report = generateAnnualReport(year);

    if (!report) {
      showError('ไม่สามารถสร้างแบบประเมิน ภ.ป.ภ. 50 ได้');
      return;
    }

    const contentDiv = document.getElementById('annual-report-content');
    if (!contentDiv) return;

    let html = `
      <div style="padding: 15px; background: #f9f9f9; border-radius: 8px;">
        <h3 style="color: var(--text); margin-bottom: 15px;">📄 แบบประเมิน ภ.ป.ภ. 50 - ปีภาษี ${report.buddhYear}</h3>

        <h4 style="color: var(--text); margin: 20px 0 10px;">งบการเงิน</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background: var(--purple); color: white;">
            <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">รายการ</th>
            <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">จำนวน</th>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">รายได้รวม</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.financialSummary.totalRevenue)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">ค่าใช้จ่าย</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.financialSummary.totalExpenses)}</td>
          </tr>
          <tr style="background: var(--purple-pale); font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #ddd;">กำไรสุทธิ</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.financialSummary.netIncome)}</td>
          </tr>
        </table>

        <h4 style="color: var(--text); margin: 20px 0 10px;">การคำนวณภาษี</h4>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr style="background: var(--red); color: white;">
            <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">รายการ</th>
            <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">จำนวน</th>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">รายได้สุทธิ</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.taxCalculation.taxableIncome)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">อัตราภาษี</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${report.taxCalculation.taxRate}%</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">ภาษีอากรที่ต้องชำระ</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.taxCalculation.incomeTax)}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">หัก ณ ที่จ่าย</td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${formatAsCurrency(report.taxCalculation.withholdingTax)}</td>
          </tr>
          <tr style="background: var(--red-pale); font-weight: bold;">
            <td style="padding: 10px; border: 1px solid #ddd;">
              ${report.taxCalculation.taxBalance > 0 ? 'ยอดชำระเพิ่มเติม' : 'ยอดเงินคืน'}
            </td>
            <td style="padding: 10px; text-align: right; border: 1px solid #ddd; color: var(--red);">
              ${formatAsCurrency(Math.abs(report.taxCalculation.taxBalance))}
            </td>
          </tr>
        </table>

        <div style="padding: 15px; background: var(--accent-light); border-radius: 8px; border-left: 4px solid var(--accent);">
          <strong>📅 กำหนดส่ง:</strong> ${report.filingDeadline}<br>
          <strong>แบบฟอร์ม:</strong> ${report.formType}
        </div>
      </div>
    `;

    contentDiv.innerHTML = html;
    showSuccess('สร้างแบบประเมิน ภ.ป.ภ. 50 เรียบร้อย');
  } catch (error) {
    console.error('❌ Error generating annual report:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Reconcile and display withholding tax
 */
function reconcileWithholding() {
  try {
    const buddhYear = parseInt(document.getElementById('withholding-year').value) || 2567;
    const year = convertBuddhistToGregorian(buddhYear);

    const reconciliation = reconcileWithholding(year);

    const contentDiv = document.getElementById('withholding-content');
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
 * Placeholder functions for export (will be implemented in tax-export.js)
 */
function exportAnnualReportPDF() {
  showError('ระบบ PDF Export กำลังพัฒนา - โปรดรอสักครู่');
}

function exportAnnualReportExcel() {
  showError('ระบบ Excel Export กำลังพัฒนา - โปรดรอสักครู่');
}

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
    calculateMonthlyIncomeTax,
    calculateQuarterlyIncomeTax,
    calculateAnnualIncomeTax,
    generateMonthlyTaxReport,
    generateQuarterlyReturn,
    generateAnnualReport,
    reconcileWithholding
  };
}
