/**
 * Expense Manager
 * Manages additional expenses beyond utility charges (maintenance, repairs, etc.)
 * Essential for accounting and tax filing
 */

const DEFAULT_EXPENSE_TYPES = {
  maintenance: { name: 'ค่าซ่อมแซม/บำรุงรักษา', category: 'maintenance' },
  repair: { name: 'ค่าซ่อมแซมฉุกเฉิน', category: 'repair' },
  cleaning: { name: 'ค่าทำความสะอาด', category: 'cleaning' },
  insurance: { name: 'ค่าประกันสินไทย', category: 'insurance' },
  property_tax: { name: 'ค่าภาษีโรงแรม/อพยพ', category: 'property_tax' },
  staff_salary: { name: 'ค่าจ้างพนักงาน', category: 'staff_salary' },
  utilities_prepaid: { name: 'ค่าสาธารณูปโภค (ที่บริษัทจ่าย)', category: 'utilities' },
  office_supplies: { name: 'ค่าสำนักงาน/วัสดุ', category: 'office' },
  transportation: { name: 'ค่าการขนส่ง', category: 'transportation' },
  professional_fee: { name: 'ค่าธรรมเนียมวิชาชีพ (บัญชี/ทนายความ)', category: 'professional' },
  other: { name: 'ค่าใช้จ่ายอื่นๆ', category: 'other' }
};

class ExpenseManager {
  // ===== GET EXPENSE DATA =====
  static getAllExpenses(year = null) {
    const allExpenses = [];
    for (let y = 67; y <= 69; y++) {
      if (year && y !== year) continue;
      const expensesKey = `expenses_${y}`;
      const data = localStorage.getItem(expensesKey);
      if (data) {
        try {
          const expenses = JSON.parse(data);
          allExpenses.push(...expenses);
        } catch (e) {
          console.warn(`⚠️ Error parsing expenses for year ${y}:`, e);
        }
      }
    }
    return allExpenses;
  }

  static getExpensesByMonth(year, month) {
    const expensesKey = `expenses_${year}`;
    const data = localStorage.getItem(expensesKey);
    if (!data) return [];

    try {
      const expenses = JSON.parse(data);
      return expenses.filter(e => e.month === month);
    } catch (e) {
      console.warn(`⚠️ Error parsing expenses for ${year}-${month}:`, e);
      return [];
    }
  }

  static getExpensesByType(type, year = null) {
    const all = this.getAllExpenses(year);
    return all.filter(e => e.type === type);
  }

  // ===== CREATE EXPENSE =====
  static addExpense(year, month, expense) {
    if (!expense.type || !expense.date || !expense.amount) {
      console.warn('⚠️ Expense requires: type, date, amount');
      return false;
    }

    const expensesKey = `expenses_${year}`;
    const current = this.getExpensesByMonth(year, month);

    const newExpense = {
      id: `EXP-${year}-${String(month).padStart(2, '0')}-${Date.now()}`,
      type: expense.type,
      description: expense.description || '',
      amount: parseFloat(expense.amount),
      date: expense.date,
      month: month,
      year: year,
      category: expense.category || DEFAULT_EXPENSE_TYPES[expense.type]?.category || 'other',
      document: expense.document || null,  // Receipt/bill reference
      notes: expense.notes || '',
      createdAt: new Date().toISOString()
    };

    current.push(newExpense);
    localStorage.setItem(expensesKey, JSON.stringify(current));
    console.log('✅ Expense added:', newExpense.id);
    return newExpense;
  }

  // ===== UPDATE EXPENSE =====
  static updateExpense(year, month, expenseId, updates) {
    const expensesKey = `expenses_${year}`;
    const current = this.getExpensesByMonth(year, month);
    const index = current.findIndex(e => e.id === expenseId);

    if (index === -1) {
      console.warn(`⚠️ Expense not found: ${expenseId}`);
      return null;
    }

    current[index] = { ...current[index], ...updates, id: expenseId };
    localStorage.setItem(expensesKey, JSON.stringify(current));
    console.log('✅ Expense updated:', expenseId);
    return current[index];
  }

  // ===== DELETE EXPENSE =====
  static deleteExpense(year, month, expenseId) {
    const expensesKey = `expenses_${year}`;
    const current = this.getExpensesByMonth(year, month);
    const filtered = current.filter(e => e.id !== expenseId);

    localStorage.setItem(expensesKey, JSON.stringify(filtered));
    console.log('✅ Expense deleted:', expenseId);
    return true;
  }

  // ===== SUMMARY & REPORTING =====
  static getTotalExpensesByType(year, month = null) {
    const expenses = month
      ? this.getExpensesByMonth(year, month)
      : this.getAllExpenses(year);

    const summary = {};
    expenses.forEach(e => {
      if (!summary[e.type]) {
        summary[e.type] = {
          type: e.type,
          name: DEFAULT_EXPENSE_TYPES[e.type]?.name || e.type,
          category: e.category,
          count: 0,
          total: 0
        };
      }
      summary[e.type].count++;
      summary[e.type].total += e.amount;
    });

    return Object.values(summary);
  }

  static getTotalExpensesByCategory(year, month = null) {
    const expenses = month
      ? this.getExpensesByMonth(year, month)
      : this.getAllExpenses(year);

    const summary = {};
    expenses.forEach(e => {
      const category = e.category || 'other';
      if (!summary[category]) {
        summary[category] = { category, total: 0, count: 0 };
      }
      summary[category].total += e.amount;
      summary[category].count++;
    });

    return Object.values(summary);
  }

  static getTotalExpenses(year, month = null) {
    const expenses = month
      ? this.getExpensesByMonth(year, month)
      : this.getAllExpenses(year);

    return expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  }

  // ===== ACCOUNTING REPORT =====
  static getMonthlyAccountingSummary(year, month) {
    const expenses = this.getExpensesByMonth(year, month);
    const byCategory = {};

    expenses.forEach(e => {
      const category = e.category || 'other';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(e);
    });

    return {
      year,
      month,
      totalExpenses: this.getTotalExpenses(year, month),
      byCategory,
      expenseCount: expenses.length,
      expenses
    };
  }

  static getYearlyAccountingSummary(year) {
    const summary = {
      year,
      monthlyTotals: {},
      categoryTotals: {},
      totalExpenses: 0,
      byMonth: {}
    };

    for (let m = 1; m <= 12; m++) {
      const expenses = this.getExpensesByMonth(year, m);
      if (expenses.length === 0) continue;

      const monthTotal = this.getTotalExpenses(year, m);
      summary.monthlyTotals[m] = monthTotal;
      summary.totalExpenses += monthTotal;

      // Category breakdown
      expenses.forEach(e => {
        const cat = e.category || 'other';
        if (!summary.categoryTotals[cat]) {
          summary.categoryTotals[cat] = 0;
        }
        summary.categoryTotals[cat] += e.amount;
      });

      summary.byMonth[m] = {
        total: monthTotal,
        count: expenses.length,
        expenses
      };
    }

    return summary;
  }

  // ===== HELPERS =====
  static getExpenseTypeOptions() {
    return Object.entries(DEFAULT_EXPENSE_TYPES).map(([key, val]) => ({
      value: key,
      label: val.name,
      category: val.category
    }));
  }

  static getExpenseTypeName(type) {
    return DEFAULT_EXPENSE_TYPES[type]?.name || type;
  }

  static formatExpenseAmount(amount) {
    return parseFloat(amount).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // ===== EXPORT FOR ACCOUNTING =====
  static exportExpenseReport(year, month = null) {
    const data = month
      ? this.getMonthlyAccountingSummary(year, month)
      : this.getYearlyAccountingSummary(year);

    return {
      title: month ? `รายงานค่าใช้จ่าย ${month}/${year}` : `รายงานค่าใช้จ่ายปี ${year}`,
      generatedAt: new Date().toISOString(),
      data,
      format: 'json'
    };
  }
}
