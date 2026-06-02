/**
 * The Green Haven - Tax Filing Export Module
 * Handles Excel exports for tax reports.
 * (Monthly PDF export is html2canvas-based, in tax-filing.html `downloadCurrentReportAsPDF`.)
 */

// Load owner info (company name) for the Excel report header.
// OwnerConfigManager is loaded by tax-filing.html before this script.
function _getOwnerForPDF() {
  return (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};
}

// ===== EXCEL EXPORT FUNCTIONS =====

/**
 * Export monthly report to Excel
 */
function exportMonthlyReportExcel() {
  try {
    const month = parseInt(document.getElementById('monthly-month').value) || 3;
    const buddhYear = parseInt(document.getElementById('monthly-year').value) || 2567;
    const year = buddhYear - 543;

    const monthlyReports = JSON.parse(localStorage.getItem('monthly_tax_reports') || '{}');
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const report = monthlyReports[key];

    if (!report) {
      showError('ไม่มีรายงานที่บันทึกไว้ โปรดสร้างรายงานก่อน');
      return;
    }

    const ExcelJS = window.ExcelJS;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('รายงานเดือน');

    // Header
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `รายงานภาษีรายเดือน - ${report.period}`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center' };

    worksheet.mergeCells('A2:E2');
    const infoCell = worksheet.getCell('A2');
    infoCell.value = `${_getOwnerForPDF().companyLegalNameTH || 'The Green Haven'} | วันที่: ${new Date().toLocaleDateString('th-TH')}`;
    infoCell.font = { size: 10 };
    infoCell.alignment = { horizontal: 'center' };

    // Revenue Section
    let row = 4;
    worksheet.getCell(`A${row}`).value = 'รายได้';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 11 };
    row++;

    const revenueHeaders = ['ห้อง', 'ค่าเช่า', 'ไฟฟ้า', 'น้ำ', 'รวม'];
    revenueHeaders.forEach((header, index) => {
      const cell = worksheet.getCell(row, index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2d8653' } };
    });
    row++;

    Object.entries(report.revenue.byRoom).forEach(([room, data]) => {
      worksheet.getCell(row, 1).value = room;
      worksheet.getCell(row, 2).value = data.rent;
      worksheet.getCell(row, 3).value = data.electricity;
      worksheet.getCell(row, 4).value = data.water;
      worksheet.getCell(row, 5).value = data.total;

      // Format as currency
      for (let i = 2; i <= 5; i++) {
        worksheet.getCell(row, i).numFmt = '฿#,##0.00';
      }
      row++;
    });

    // Total row
    worksheet.getCell(row, 1).value = 'รวมรายได้';
    worksheet.getCell(row, 1).font = { bold: true };
    worksheet.getCell(row, 5).value = report.revenue.total;
    worksheet.getCell(row, 5).numFmt = '฿#,##0.00';
    worksheet.getCell(row, 5).font = { bold: true };
    row += 2;

    // Expenses Section
    worksheet.getCell(`A${row}`).value = 'ค่าใช้จ่าย';
    worksheet.getCell(`A${row}`).font = { bold: true, size: 11 };
    row++;

    const expenseHeaders = ['หมวดหมู่', 'จำนวน'];
    expenseHeaders.forEach((header, index) => {
      const cell = worksheet.getCell(row, index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976d2' } };
    });
    row++;

    const categoryNames = {
      contractor: 'ค่าจ้างช่าง',
      housekeeping: 'ค่าทำความสะอาด',
      utilities: 'สาธารณูปโภค',
      common: 'ค่าบำรุงส่วนกลาง'
    };

    Object.entries(report.expenses.breakdown).forEach(([category, amount]) => {
      if (amount > 0) {
        worksheet.getCell(row, 1).value = categoryNames[category] || category;
        worksheet.getCell(row, 2).value = amount;
        worksheet.getCell(row, 2).numFmt = '฿#,##0.00';
        row++;
      }
    });

    // Total expenses row
    worksheet.getCell(row, 1).value = 'รวมค่าใช้จ่าย';
    worksheet.getCell(row, 1).font = { bold: true };
    worksheet.getCell(row, 2).value = report.expenses.total;
    worksheet.getCell(row, 2).numFmt = '฿#,##0.00';
    worksheet.getCell(row, 2).font = { bold: true };
    row += 2;

    // Summary
    const netIncome = report.revenue.total - report.expenses.total;
    worksheet.getCell(row, 1).value = 'กำไรสุทธิ';
    worksheet.getCell(row, 2).value = netIncome;
    worksheet.getCell(row, 2).numFmt = '฿#,##0.00';
    row++;

    worksheet.getCell(row, 1).value = 'หัก ณ ที่จ่าย';
    worksheet.getCell(row, 2).value = report.withholding.total;
    worksheet.getCell(row, 2).numFmt = '฿#,##0.00';
    row++;

    worksheet.getCell(row, 1).value = 'ประมาณภาษี';
    worksheet.getCell(row, 2).value = report.tax.incomeTax;
    worksheet.getCell(row, 2).numFmt = '฿#,##0.00';
    row++;

    // Adjust column widths
    worksheet.columns = [
      { width: 20 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 15 }
    ];

    // Save
    const filename = `monthly_report_${year}_${month}.xlsx`;
    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();

      if (window.AuditLogger) {
        window.AuditLogger.log(
          'REPORT_EXPORTED',
          `ส่งออกรายงานรายเดือน ${report.period} เป็น Excel`,
          { type: 'MONTHLY_EXCEL', month, year }
        );
      }

      showSuccess('ส่งออก Excel สำเร็จ');
    });
  } catch (error) {
    console.error('❌ Error exporting monthly report to Excel:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

// ===== HELPER FUNCTIONS =====

/**
 * Format number as currency string
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

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
