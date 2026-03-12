/**
 * The Green Haven - Accounting System
 * Phase 5: Financial Management
 * Manages expenses, reports, and financial data for accounting department
 */

// ===== GLOBAL STATE =====

let accountingCharts = {
  revenue: null,
  expense: null,
  comparison: null
};

let currentExpenses = [];
let currentMonth = new Date();

// ===== INITIALIZATION =====

function initializeAccounting() {
  loadDashboard();
  loadExpenses();
  renderFinancialCharts();
  console.log('✅ Accounting system initialized');
}

// ===== DASHBOARD FUNCTIONS =====

/**
 * Load and calculate dashboard KPIs
 */
function loadDashboard() {
  const month = currentMonth.getFullYear() + '-' + String(currentMonth.getMonth() + 1).padStart(2, '0');
  const year = currentMonth.getFullYear();
  const monthNum = currentMonth.getMonth() + 1;

  const revenue = calculateMonthlyRevenue(monthNum, year);
  const expenses = calculateTotalExpenses(monthNum, year);
  const netIncome = revenue - expenses;
  const collectionRate = calculateCollectionRate(monthNum, year);

  // Update KPI displays
  document.getElementById('total-revenue').textContent = '฿' + revenue.toLocaleString('th-TH');
  document.getElementById('total-expenses').textContent = '฿' + expenses.toLocaleString('th-TH');
  document.getElementById('net-income').textContent = '฿' + netIncome.toLocaleString('th-TH');
  document.getElementById('collection-rate').textContent = collectionRate + '%';

  // Update net income color based on positive/negative
  const netIncomeEl = document.getElementById('net-income');
  if (netIncome < 0) {
    netIncomeEl.parentElement.classList.remove('purple');
    netIncomeEl.classList.remove('purple');
    netIncomeEl.parentElement.classList.add('red');
    netIncomeEl.classList.add('red');
  }

  console.log(`💰 Dashboard loaded: Revenue=${revenue}, Expenses=${expenses}, Net=${netIncome}`);
}

/**
 * Calculate monthly revenue from paid invoices
 */
function calculateMonthlyRevenue(month, year) {
  try {
    // Get bills from Firebase or localStorage
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
    console.error('Error calculating revenue:', error);
    return 0;
  }
}

/**
 * Calculate total expenses for the month
 */
function calculateTotalExpenses(month, year) {
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
    console.error('Error calculating expenses:', error);
    return 0;
  }
}

/**
 * Calculate collection rate (paid bills / total bills)
 */
function calculateCollectionRate(month, year) {
  try {
    const bills = JSON.parse(localStorage.getItem('bills') || '[]');

    const monthBills = bills.filter(b => b.year === year && b.month === month);
    if (monthBills.length === 0) return 0;

    const paid = monthBills.filter(b => b.paid === true).length;
    return Math.round((paid / monthBills.length) * 100);
  } catch (error) {
    console.error('Error calculating collection rate:', error);
    return 0;
  }
}

/**
 * Get revenue data for last 12 months
 */
function getRevenueData() {
  const months = [];
  const data = [];

  for (let i = 11; i >= 0; i--) {
    const date = new Date(currentMonth);
    date.setMonth(date.getMonth() - i);

    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    months.push(getMonthLabel(month, year));
    data.push(calculateMonthlyRevenue(month, year));
  }

  return { months, data };
}

/**
 * Get expense breakdown data
 */
function getExpenseBreakdown() {
  const month = currentMonth.getMonth() + 1;
  const year = currentMonth.getFullYear();
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
      breakdown[expense.type] += amount;
    }
  });

  return breakdown;
}

/**
 * Render financial charts
 */
function renderFinancialCharts() {
  renderRevenueChart();
  renderExpenseChart();
  renderComparisonChart();
}

/**
 * Render 12-month revenue trend
 */
function renderRevenueChart() {
  const { months, data } = getRevenueData();

  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;

  if (accountingCharts.revenue) accountingCharts.revenue.destroy();

  accountingCharts.revenue = new Chart(ctx, {
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
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '฿' + (value / 1000).toFixed(0) + 'k';
            }
          }
        }
      }
    }
  });
}

/**
 * Render expense breakdown pie chart
 */
function renderExpenseChart() {
  const breakdown = getExpenseBreakdown();

  const ctx = document.getElementById('expenseChart');
  if (!ctx) return;

  if (accountingCharts.expense) accountingCharts.expense.destroy();

  const labels = ['ค่าจ้างช่าง', 'ค่าจ้างแม่บ้าน', 'ค่าน้ำไฟ', 'ส่วนกลาง'];
  const colors = ['#1976d2', '#7b1fa2', '#ff8f00', '#c62828'];

  accountingCharts.expense = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: [breakdown.contractor, breakdown.housekeeping, breakdown.utilities, breakdown.common],
        backgroundColor: colors,
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { family: "'Sarabun', sans-serif", size: 13 }
          }
        }
      }
    }
  });
}

/**
 * Render revenue vs expenses comparison
 */
function renderComparisonChart() {
  const months = [];
  const revenue = [];
  const expenses = [];

  for (let i = 5; i >= 0; i--) {
    const date = new Date(currentMonth);
    date.setMonth(date.getMonth() - i);

    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    months.push(getMonthLabel(month, year));
    revenue.push(calculateMonthlyRevenue(month, year));
    expenses.push(calculateTotalExpenses(month, year));
  }

  const ctx = document.getElementById('comparisonChart');
  if (!ctx) return;

  if (accountingCharts.comparison) accountingCharts.comparison.destroy();

  accountingCharts.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        {
          label: 'รายได้',
          data: revenue,
          backgroundColor: '#2d8653',
          borderRadius: 6
        },
        {
          label: 'ค่าใช้จ่าย',
          data: expenses,
          backgroundColor: '#ff8f00',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            font: { family: "'Sarabun', sans-serif", size: 13 }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '฿' + (value / 1000).toFixed(0) + 'k';
            }
          }
        }
      }
    }
  });
}

// ===== EXPENSE FUNCTIONS =====

/**
 * Update expense form based on selected type
 */
function updateExpenseForm() {
  const type = document.getElementById('expenseType').value;
  // Could add conditional fields here if needed
  console.log('Expense type selected:', type);
}

/**
 * Add new expense entry
 */
function addExpense() {
  try {
    const type = document.getElementById('expenseType').value;
    const date = document.getElementById('expenseDate').value;
    const name = document.getElementById('expenseName').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const description = document.getElementById('expenseDescription').value;

    // Validation
    if (!type || !date || !name || !amount) {
      showExpenseError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    if (amount <= 0) {
      showExpenseError('จำนวนเงินต้องมากกว่า 0');
      return;
    }

    if (name.length < 2 || name.length > 100) {
      showExpenseError('ชื่อต้องมี 2-100 ตัวอักษร');
      return;
    }

    // Sanitize inputs
    const sanitizedName = window.SecurityUtils.sanitizeInput(name);
    const sanitizedDesc = window.SecurityUtils.sanitizeInput(description);

    // Create expense object
    const expense = {
      id: Date.now(),
      date: date,
      type: type,
      name: sanitizedName,
      amount: amount,
      description: sanitizedDesc,
      receipt: null,
      createdAt: new Date().toISOString(),
      createdBy: window.SecurityUtils.getSecureSession()?.email || 'unknown'
    };

    // Save to localStorage
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    expenses.push(expense);
    localStorage.setItem('accounting_expenses', JSON.stringify(expenses));

    // Log to audit
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'EXPENSE_ADDED',
        `เพิ่มค่า${type} ${sanitizedName}: ฿${amount.toLocaleString()}`,
        { type, name: sanitizedName, amount }
      );
    }

    // Clear form
    document.getElementById('expenseType').value = 'contractor';
    document.getElementById('expenseName').value = '';
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDescription').value = '';
    document.getElementById('expenseReceipt').value = '';

    showExpenseSuccess('บันทึกค่าใช้จ่ายสำเร็จ');

    // Refresh displays
    loadExpenses();
    loadDashboard();
    renderFinancialCharts();
  } catch (error) {
    console.error('Error adding expense:', error);
    showExpenseError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Load and display expenses table
 */
function loadExpenses() {
  try {
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    const month = currentMonth.getMonth() + 1;
    const year = currentMonth.getFullYear();

    const monthExpenses = expenses.filter(exp => {
      const expDate = new Date(exp.date);
      return expDate.getFullYear() === year && (expDate.getMonth() + 1) === month;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    currentExpenses = monthExpenses;

    // Update summary
    updateExpenseSummary(monthExpenses);

    // Update table
    const tbody = document.getElementById('expenseTableBody');
    tbody.innerHTML = '';

    monthExpenses.forEach(exp => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${formatDate(exp.date)}</td>
        <td><span class="badge badge-pending">${getExpenseTypeName(exp.type)}</span></td>
        <td>${exp.name}</td>
        <td style="font-weight: 700; color: #2d8653;">฿${exp.amount.toLocaleString('th-TH')}</td>
        <td>${exp.receipt ? '✅' : '-'}</td>
        <td>
          <button onclick="editExpense(${exp.id})" style="padding: 4px 8px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 4px;">แก้ไข</button>
          <button onclick="deleteExpense(${exp.id})" style="padding: 4px 8px; background: #c62828; color: white; border: none; border-radius: 4px; cursor: pointer;">ลบ</button>
        </td>
      `;
      tbody.appendChild(row);
    });

    console.log(`✅ Loaded ${monthExpenses.length} expenses for month ${month}/${year}`);
  } catch (error) {
    console.error('Error loading expenses:', error);
    showExpenseError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
  }
}

/**
 * Update expense summary display
 */
function updateExpenseSummary(expenses) {
  const summary = {
    contractor: 0,
    housekeeping: 0,
    utilities: 0,
    common: 0
  };

  expenses.forEach(exp => {
    summary[exp.type] = (summary[exp.type] || 0) + exp.amount;
  });

  document.getElementById('sum-contractor').textContent = '฿' + summary.contractor.toLocaleString('th-TH');
  document.getElementById('sum-housekeeping').textContent = '฿' + summary.housekeeping.toLocaleString('th-TH');
  document.getElementById('sum-utilities').textContent = '฿' + summary.utilities.toLocaleString('th-TH');
  document.getElementById('sum-common').textContent = '฿' + summary.common.toLocaleString('th-TH');

  const total = summary.contractor + summary.housekeeping + summary.utilities + summary.common;
  document.getElementById('sum-total').textContent = '฿' + total.toLocaleString('th-TH');
}

/**
 * Delete expense entry
 */
function deleteExpense(id) {
  if (!confirm('ต้องการลบค่าใช้จ่ายนี้ใช่หรือไม่?')) {
    return;
  }

  try {
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');
    const idx = expenses.findIndex(e => e.id === id);

    if (idx === -1) {
      showExpenseError('ไม่พบค่าใช้จ่ายนี้');
      return;
    }

    const deleted = expenses[idx];
    expenses.splice(idx, 1);
    localStorage.setItem('accounting_expenses', JSON.stringify(expenses));

    // Log to audit
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'EXPENSE_DELETED',
        `ลบค่า${deleted.type} ${deleted.name}: ฿${deleted.amount.toLocaleString()}`,
        { type: deleted.type, name: deleted.name, amount: deleted.amount }
      );
    }

    showExpenseSuccess('ลบค่าใช้จ่ายสำเร็จ');
    loadExpenses();
    loadDashboard();
    renderFinancialCharts();
  } catch (error) {
    console.error('Error deleting expense:', error);
    showExpenseError('เกิดข้อผิดพลาด');
  }
}

/**
 * Edit expense (placeholder - shows form values)
 */
function editExpense(id) {
  const expense = currentExpenses.find(e => e.id === id);
  if (!expense) return;

  document.getElementById('expenseDate').value = expense.date;
  document.getElementById('expenseType').value = expense.type;
  document.getElementById('expenseName').value = expense.name;
  document.getElementById('expenseAmount').value = expense.amount;
  document.getElementById('expenseDescription').value = expense.description;

  // Scroll to form
  document.getElementById('expenseType').scrollIntoView({ behavior: 'smooth' });
  showExpenseSuccess(`แก้ไขบันทึก - เมื่อเสร็จแล้วกดบันทึกค่าใช้จ่าย`);
}

// ===== REPORT FUNCTIONS =====

/**
 * Generate tax withholding certificate (ใบหัก ณ ที่จ่าย)
 */
function generateTaxWithholding() {
  try {
    const monthStr = document.getElementById('taxMonth').value;
    if (!monthStr) {
      alert('กรุณาเลือกเดือน');
      return;
    }

    const [year, month] = monthStr.split('-').map(Number);
    const expenses = JSON.parse(localStorage.getItem('accounting_expenses') || '[]');

    // Get contractor expenses
    const contractorExpenses = expenses.filter(exp => {
      const expDate = new Date(exp.date);
      return exp.type === 'contractor' &&
             expDate.getFullYear() === year &&
             (expDate.getMonth() + 1) === month;
    });

    if (contractorExpenses.length === 0) {
      alert('ไม่มีค่าจ้างช่างในเดือนนี้');
      return;
    }

    // Generate PDF content
    const taxRate = parseFloat(localStorage.getItem('tax_rate') || '10');
    let htmlContent = generateTaxWithholdingHTML(contractorExpenses, year, month, taxRate);

    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Log report generation
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_GENERATED',
        `สร้างเอกสารใบหัก ณ ที่จ่ายสำหรับ ${getMonthLabel(month, year)}`,
        { type: 'TAX_WITHHOLDING', month, year, count: contractorExpenses.length }
      );
    }

    showSuccess('สร้างเอกสารสำเร็จ กรุณากด Print');
  } catch (error) {
    console.error('Error generating tax withholding:', error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Generate monthly summary report
 */
function generateSummaryReport() {
  try {
    const monthStr = document.getElementById('summaryMonth').value;
    if (!monthStr) {
      alert('กรุณาเลือกเดือน');
      return;
    }

    const [year, month] = monthStr.split('-').map(Number);

    const revenue = calculateMonthlyRevenue(month, year);
    const expenses = calculateTotalExpenses(month, year);
    const netIncome = revenue - expenses;

    let htmlContent = generateSummaryHTML(month, year, revenue, expenses, netIncome);

    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Log report generation
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_GENERATED',
        `สร้างรายงานสรุปรายเดือน ${getMonthLabel(month, year)} | รายได้: ฿${revenue.toLocaleString()} | ค่าใช้จ่าย: ฿${expenses.toLocaleString()}`,
        { type: 'MONTHLY_SUMMARY', month, year, revenue, expenses, netIncome }
      );
    }

    showSuccess('สร้างเอกสารสำเร็จ กรุณากด Print');
  } catch (error) {
    console.error('Error generating summary:', error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Generate room detail report
 */
function generateRoomDetail() {
  try {
    const room = document.getElementById('detailRoom').value;
    const monthStr = document.getElementById('detailMonth').value;

    if (!room || !monthStr) {
      alert('กรุณากรอกห้องและเลือกเดือน');
      return;
    }

    const [year, month] = monthStr.split('-').map(Number);
    const bills = JSON.parse(localStorage.getItem('bills') || '[]');

    const roomBills = bills.filter(b =>
      b.room === room && b.year === year && b.month === month
    );

    if (roomBills.length === 0) {
      alert('ไม่พบข้อมูลสำหรับห้องนี้');
      return;
    }

    const bill = roomBills[0];
    let htmlContent = generateRoomDetailHTML(room, month, year, bill);

    const printWindow = window.open('', '_blank');
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    // Log report generation
    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_GENERATED',
        `สร้างรายละเอียดห้อง ${room} สำหรับ ${getMonthLabel(month, year)}`,
        { type: 'ROOM_DETAIL', room, month, year }
      );
    }

    showSuccess('สร้างเอกสารสำเร็จ กรุณากด Print');
  } catch (error) {
    console.error('Error generating room detail:', error);
    alert('เกิดข้อผิดพลาด: ' + error.message);
  }
}

// ===== SETTINGS FUNCTIONS =====

/**
 * Save tax rate setting
 */
function saveTaxRate() {
  try {
    const rate = parseFloat(document.getElementById('taxRate').value);

    if (isNaN(rate) || rate < 0 || rate > 100) {
      alert('อัตราภาษีต้องเป็นตัวเลขระหว่าง 0-100');
      return;
    }

    localStorage.setItem('tax_rate', rate.toString());

    if (window.AuditLogger) {
      window.AuditLogger.log(
        'SETTINGS_CHANGED',
        `เปลี่ยนแปลงอัตราภาษีหัก ณ ที่จ่ายเป็น ${rate}%`,
        { setting: 'TAX_RATE', value: rate }
      );
    }

    showSuccess('บันทึกตั้งค่าสำเร็จ');
  } catch (error) {
    console.error('Error saving tax rate:', error);
    showError('เกิดข้อผิดพลาด');
  }
}

// ===== HTML GENERATION FUNCTIONS =====

/**
 * Generate tax withholding certificate HTML
 */
function generateTaxWithholdingHTML(expenses, year, month, taxRate) {
  const monthLabel = getMonthLabel(month, year);
  const buddhYear = year + 543;

  let rows = '';
  let totalAmount = 0;

  expenses.forEach((exp, idx) => {
    const withheld = Math.round(exp.amount * taxRate / 100);
    const net = exp.amount - withheld;
    totalAmount += exp.amount;

    rows += `
      <tr>
        <td style="border: 1px solid #333; padding: 8px; text-align: center;">${idx + 1}</td>
        <td style="border: 1px solid #333; padding: 8px;">${exp.name}</td>
        <td style="border: 1px solid #333; padding: 8px; text-align: right;">฿${exp.amount.toLocaleString('th-TH')}</td>
        <td style="border: 1px solid #333; padding: 8px; text-align: right;">฿${withheld.toLocaleString('th-TH')}</td>
        <td style="border: 1px solid #333; padding: 8px; text-align: right;">฿${net.toLocaleString('th-TH')}</td>
      </tr>
    `;
  });

  const totalWithheld = Math.round(totalAmount * taxRate / 100);
  const totalNet = totalAmount - totalWithheld;

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบหัก ณ ที่จ่าย</title>
      <style>
        body { font-family: 'Sarabun', sans-serif; padding: 20px; }
        .doc-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .doc-header h2 { margin: 0; font-size: 18px; }
        .doc-header p { margin: 5px 0; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
        .form-item { }
        .form-item label { font-weight: bold; display: block; }
        .form-item input { width: 100%; border-bottom: 1px solid #333; border-top: none; border-left: none; border-right: none; padding: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border: 1px solid #333; text-align: left; }
        th { background: #e8f5e9; font-weight: bold; }
        .total-row { font-weight: bold; background: #f5f5f5; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <h2>ใบหัก ณ ที่จ่าย</h2>
        <p>เดือน${getThaiMonth(month)} พ.ศ. ${buddhYear}</p>
      </div>

      <div class="form-grid">
        <div class="form-item">
          <label>ชื่อสถานประกอบการ:</label>
          <input type="text" value="The Green Haven" readonly>
        </div>
        <div class="form-item">
          <label>เลขประจำตัวผู้เสียภาษีอากร:</label>
          <input type="text" value="">
        </div>
        <div class="form-item">
          <label>ที่อยู่:</label>
          <input type="text" value="">
        </div>
        <div class="form-item">
          <label>เดือน/ปี:</label>
          <input type="text" value="${monthLabel}">
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 5%;">ลำดับ</th>
            <th style="width: 35%;">ชื่อผู้รับ</th>
            <th style="width: 20%; text-align: right;">จำนวนเงิน</th>
            <th style="width: 20%; text-align: right;">หัก ${taxRate}%</th>
            <th style="width: 20%; text-align: right;">สุทธิ</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row">
            <td colspan="2" style="text-align: right;">รวมทั้งสิ้น</td>
            <td style="text-align: right;">฿${totalAmount.toLocaleString('th-TH')}</td>
            <td style="text-align: right;">฿${totalWithheld.toLocaleString('th-TH')}</td>
            <td style="text-align: right;">฿${totalNet.toLocaleString('th-TH')}</td>
          </tr>
        </tbody>
      </table>

      <div class="form-grid">
        <div class="form-item">
          <label>ลงชื่อผู้จ่าย:</label>
          <div style="height: 50px; border-bottom: 1px solid #333; margin-top: 30px;"></div>
          <div style="text-align: center; font-size: 12px;">วันที่ _____ เดือน _____ พ.ศ. _____</div>
        </div>
        <div class="form-item">
          <label>ลงชื่อผู้รับ:</label>
          <div style="height: 50px; border-bottom: 1px solid #333; margin-top: 30px;"></div>
          <div style="text-align: center; font-size: 12px;">วันที่ _____ เดือน _____ พ.ศ. _____</div>
        </div>
      </div>

      <div class="footer">
        <p>เอกสารนี้สร้างโดยระบบบัญชี The Green Haven</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate monthly summary HTML
 */
function generateSummaryHTML(month, year, revenue, expenses, netIncome) {
  const buddhYear = year + 543;
  const monthLabel = getMonthLabel(month, year);

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>รายงานสรุปรายเดือน</title>
      <style>
        body { font-family: 'Sarabun', sans-serif; padding: 20px; }
        .doc-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .doc-header h2 { margin: 0; font-size: 18px; }
        .doc-header p { margin: 5px 0; }
        .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin: 20px 0; }
        .summary-item { border: 2px solid #333; padding: 15px; text-align: center; }
        .summary-label { font-size: 12px; color: #666; }
        .summary-value { font-size: 24px; font-weight: bold; margin-top: 10px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border: 1px solid #333; text-align: left; }
        th { background: #e8f5e9; font-weight: bold; }
        .total-row { font-weight: bold; background: #f5f5f5; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <h2>รายงานสรุปรายเดือน</h2>
        <p>${monthLabel} พ.ศ. ${buddhYear}</p>
        <p>The Green Haven</p>
      </div>

      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">รวมรายได้</div>
          <div class="summary-value" style="color: #2d8653;">฿${revenue.toLocaleString('th-TH')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">รวมค่าใช้จ่าย</div>
          <div class="summary-value" style="color: #ff8f00;">฿${expenses.toLocaleString('th-TH')}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">กำไรสุทธิ</div>
          <div class="summary-value" style="color: ${netIncome >= 0 ? '#2d8653' : '#c62828'};">฿${netIncome.toLocaleString('th-TH')}</div>
        </div>
      </div>

      <table>
        <tr>
          <td><strong>รายได้รวม</strong></td>
          <td style="text-align: right;">฿${revenue.toLocaleString('th-TH')}</td>
        </tr>
        <tr>
          <td><strong>ค่าใช้จ่ายรวม</strong></td>
          <td style="text-align: right;">฿${expenses.toLocaleString('th-TH')}</td>
        </tr>
        <tr class="total-row">
          <td><strong>กำไรสุทธิ</strong></td>
          <td style="text-align: right;">฿${netIncome.toLocaleString('th-TH')}</td>
        </tr>
      </table>

      <div style="margin-top: 30px; text-align: right;">
        <div>ลงชื่อผู้รับรอง</div>
        <div style="height: 60px; border-bottom: 1px solid #333; margin-top: 30px; width: 200px;"></div>
        <div style="font-size: 12px; margin-top: 5px;">วันที่ _____ เดือน _____ พ.ศ. _____</div>
      </div>

      <div class="footer">
        <p>เอกสารนี้สร้างโดยระบบบัญชี The Green Haven</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate room detail HTML
 */
function generateRoomDetailHTML(room, month, year, bill) {
  const buddhYear = year + 543;
  const monthLabel = getMonthLabel(month, year);

  const rent = parseFloat(bill.rent) || 0;
  const electricity = parseFloat(bill.electricity) || 0;
  const water = parseFloat(bill.water) || 0;
  const total = rent + electricity + water;

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>รายละเอียดค่าใช้จ่ายห้อง</title>
      <style>
        body { font-family: 'Sarabun', sans-serif; padding: 20px; }
        .doc-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .doc-header h2 { margin: 0; font-size: 18px; }
        .doc-header p { margin: 5px 0; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 15px 0; }
        .form-item label { font-weight: bold; display: block; }
        .form-item input { width: 100%; border-bottom: 1px solid #333; padding: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border: 1px solid #333; text-align: left; }
        th { background: #e8f5e9; font-weight: bold; }
        .total-row { font-weight: bold; background: #f5f5f5; }
        .footer { margin-top: 30px; text-align: center; font-size: 12px; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="doc-header">
        <h2>รายละเอียดค่าใช้จ่ายห้อง</h2>
        <p>ห้องเลขที่ ${room} | ${monthLabel} พ.ศ. ${buddhYear}</p>
      </div>

      <div class="form-grid">
        <div class="form-item">
          <label>ห้องเลขที่:</label>
          <input type="text" value="${room}" readonly>
        </div>
        <div class="form-item">
          <label>เดือน/ปี:</label>
          <input type="text" value="${monthLabel}">
        </div>
      </div>

      <table>
        <tr>
          <th>รายการ</th>
          <th style="text-align: right;">จำนวนเงิน</th>
        </tr>
        <tr>
          <td>ค่าเช่า</td>
          <td style="text-align: right;">฿${rent.toLocaleString('th-TH')}</td>
        </tr>
        <tr>
          <td>ค่าไฟฟ้า</td>
          <td style="text-align: right;">฿${electricity.toLocaleString('th-TH')}</td>
        </tr>
        <tr>
          <td>ค่าน้ำ</td>
          <td style="text-align: right;">฿${water.toLocaleString('th-TH')}</td>
        </tr>
        <tr class="total-row">
          <td>รวมทั้งสิ้น</td>
          <td style="text-align: right;">฿${total.toLocaleString('th-TH')}</td>
        </tr>
      </table>

      <div style="margin-top: 30px; text-align: right;">
        <div>ลงชื่อผู้รับรอง</div>
        <div style="height: 60px; border-bottom: 1px solid #333; margin-top: 30px; width: 200px;"></div>
        <div style="font-size: 12px; margin-top: 5px;">วันที่ _____ เดือน _____ พ.ศ. _____</div>
      </div>

      <div class="footer">
        <p>เอกสารนี้สร้างโดยระบบบัญชี The Green Haven</p>
      </div>
    </body>
    </html>
  `;
}

// ===== UTILITY FUNCTIONS =====

/**
 * Get expense type name in Thai
 */
function getExpenseTypeName(type) {
  const names = {
    contractor: '🔧 ค่าจ้างช่าง',
    housekeeping: '👩‍💼 ค่าจ้างแม่บ้าน',
    utilities: '💡 ค่าน้ำไฟ',
    common: '🏢 ส่วนกลาง'
  };
  return names[type] || type;
}

/**
 * Format date to Thai format
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear() + 543;
  return `${day}/${month}/${year}`;
}

/**
 * Get month label
 */
function getMonthLabel(month, year) {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const buddhYear = year + 543;
  return `${months[month - 1]} ${buddhYear}`;
}

/**
 * Get Thai month name
 */
function getThaiMonth(month) {
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return months[month - 1];
}

/**
 * Show error message
 */
function showExpenseError(message) {
  const el = document.getElementById('expenseError');
  el.textContent = '❌ ' + message;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

/**
 * Show success message
 */
function showExpenseSuccess(message) {
  const el = document.getElementById('expenseSuccess');
  el.textContent = '✅ ' + message;
  el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
}

/**
 * Show general error
 */
function showError(message) {
  alert('❌ ' + message);
}

/**
 * Show general success
 */
function showSuccess(message) {
  alert('✅ ' + message);
}

// ===== PAYMENT VERIFICATION FUNCTIONS =====

let currentPaymentFilter = 'all';
let currentVerifyingSlip = null;

/**
 * Load and display payment slips
 */
function loadPaymentSlips() {
  const slips = JSON.parse(localStorage.getItem('tenant_slips') || '[]');
  const filtered = filterByStatus(slips, currentPaymentFilter);

  const container = document.getElementById('paymentSlipsList');

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);">
      ${currentPaymentFilter === 'all' ? '📋 ยังไม่มีสลิปการชำระ' : '✨ ไม่มีสลิปที่ตรงกับการค้นหา'}
    </div>`;
    return;
  }

  const html = filtered.map((slip, idx) => {
    const statusColor = slip.status === 'pending' ? '#ff9800' : slip.status === 'verified' ? '#4caf50' : '#c62828';
    const statusText = slip.status === 'pending' ? '⏳ รอตรวจสอบ' : slip.status === 'verified' ? '✅ ยืนยันแล้ว' : '❌ ปฏิเสธ';

    return `
      <div class="card" style="cursor:pointer;border-left:4px solid ${statusColor};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <div>
            <div style="font-weight:700;font-size:1.1rem;">ห้อง ${slip.roomId}</div>
            <div style="color:var(--text-muted);font-size:.85rem;margin-top:.3rem;">${slip.uploadedDate}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:700;font-size:1.3rem;color:var(--green);">฿${slip.amount.toLocaleString()}</div>
            <div style="color:${statusColor};font-weight:700;font-size:.9rem;margin-top:.3rem;">${statusText}</div>
          </div>
        </div>
        <button onclick="openSlipVerification('${slip.invoiceId}')" style="width:100%;padding:10px;background:var(--blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;">
          🔍 ตรวจสอบ
        </button>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

/**
 * Filter slips by status
 */
function filterByStatus(slips, status) {
  if (status === 'all') return slips;
  return slips.filter(s => s.status === status);
}

/**
 * Filter payment slips by status
 */
function filterPaymentSlips(status) {
  currentPaymentFilter = status;
  document.querySelectorAll('.filter-tab').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  loadPaymentSlips();
}

/**
 * Open slip verification modal
 */
function openSlipVerification(invoiceId) {
  const slips = JSON.parse(localStorage.getItem('tenant_slips') || '[]');
  const slip = slips.find(s => s.invoiceId === invoiceId);

  if (!slip) {
    alert('❌ ไม่พบสลิปนี้');
    return;
  }

  currentVerifyingSlip = slip;

  // Set modal data
  document.getElementById('verifySlipImage').src = slip.slipImage;
  document.getElementById('verifyRoomId').textContent = slip.roomId;
  document.getElementById('verifyAmount').textContent = `฿${slip.amount.toLocaleString()}`;
  document.getElementById('verifyUploadDate').textContent = slip.uploadedDate;
  document.getElementById('verificationNotes').value = slip.notes || '';

  // Set status
  const statusMap = {
    'pending': '⏳ รอตรวจสอบ',
    'verified': '✅ ยืนยันแล้ว',
    'rejected': '❌ ปฏิเสธ'
  };
  document.getElementById('verifyStatus').textContent = statusMap[slip.status];

  // Show/hide action buttons based on status
  const actions = document.getElementById('verificationActions');
  if (slip.status === 'verified' || slip.status === 'rejected') {
    actions.style.display = 'none';
  } else {
    actions.style.display = 'flex';
  }

  document.getElementById('slipVerificationModal').style.display = 'block';
}

/**
 * Close verification modal
 */
function closeSlipModal() {
  document.getElementById('slipVerificationModal').style.display = 'none';
  currentVerifyingSlip = null;
}

/**
 * Approve payment slip
 */
function approvePaymentSlip() {
  if (!currentVerifyingSlip) return;

  const slips = JSON.parse(localStorage.getItem('tenant_slips') || '[]');
  const slipIdx = slips.findIndex(s => s.invoiceId === currentVerifyingSlip.invoiceId);

  if (slipIdx === -1) return;

  // Update slip status
  slips[slipIdx].status = 'verified';
  slips[slipIdx].approvedAt = new Date().toISOString();
  slips[slipIdx].notes = document.getElementById('verificationNotes').value;

  // Generate receipt number
  slips[slipIdx].receiptNumber = `RCP-${slips[slipIdx].roomId}-${new Date().toLocaleDateString('th-TH', {year: '2-digit', month: '2-digit', day: '2-digit'}).replace(/\//g, '')}`;

  // Save
  localStorage.setItem('tenant_slips', JSON.stringify(slips));
  if (window.saveToFirebase) {
    const slipsObj = {};
    slips.forEach(s => {
      slipsObj[s.invoiceId] = s;
    });
    window.saveToFirebase('data/payment_slips', slipsObj);
  }

  // Log audit
  if (window.AuditLogger) {
    window.AuditLogger.log('PAYMENT_APPROVED', `Approved payment for room ${slips[slipIdx].roomId}`, {
      roomId: slips[slipIdx].roomId,
      amount: slips[slipIdx].amount,
      receiptNumber: slips[slipIdx].receiptNumber
    });
  }

  // Show success
  showSuccess('ยืนยันการชำระแล้ว');
  setTimeout(() => {
    closeSlipModal();
    loadPaymentSlips();
    updatePaymentBadge();
  }, 1500);
}

/**
 * Reject payment slip
 */
function rejectPaymentSlip() {
  if (!currentVerifyingSlip) return;

  const slips = JSON.parse(localStorage.getItem('tenant_slips') || '[]');
  const slipIdx = slips.findIndex(s => s.invoiceId === currentVerifyingSlip.invoiceId);

  if (slipIdx === -1) return;

  // Update slip status
  slips[slipIdx].status = 'rejected';
  slips[slipIdx].rejectedAt = new Date().toISOString();
  slips[slipIdx].rejectionReason = document.getElementById('verificationNotes').value || 'ไม่ชัดเจน';

  // Save
  localStorage.setItem('tenant_slips', JSON.stringify(slips));
  if (window.saveToFirebase) {
    const slipsObj = {};
    slips.forEach(s => {
      slipsObj[s.invoiceId] = s;
    });
    window.saveToFirebase('data/payment_slips', slipsObj);
  }

  // Log audit
  if (window.AuditLogger) {
    window.AuditLogger.log('PAYMENT_REJECTED', `Rejected payment for room ${slips[slipIdx].roomId}`, {
      roomId: slips[slipIdx].roomId,
      amount: slips[slipIdx].amount,
      reason: slips[slipIdx].rejectionReason
    });
  }

  // Show success
  showSuccess('ปฏิเสธการชำระแล้ว');
  setTimeout(() => {
    closeSlipModal();
    loadPaymentSlips();
    updatePaymentBadge();
  }, 1500);
}

/**
 * Update payment badge count
 */
function updatePaymentBadge() {
  const slips = JSON.parse(localStorage.getItem('tenant_slips') || '[]');
  const pending = slips.filter(s => s.status === 'pending').length;

  const badge = document.getElementById('paymentBadge');
  if (pending > 0) {
    badge.textContent = pending;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ===== INITIALIZATION =====

console.log('✅ Accounting.js loaded');
window.AccountingSystem = {
  loadDashboard,
  loadExpenses,
  addExpense,
  deleteExpense,
  generateTaxWithholding,
  generateSummaryReport,
  generateRoomDetail,
  saveTaxRate,
  renderFinancialCharts,
  loadPaymentSlips,
  filterPaymentSlips,
  openSlipVerification,
  closeSlipModal,
  approvePaymentSlip,
  rejectPaymentSlip,
  updatePaymentBadge
};
