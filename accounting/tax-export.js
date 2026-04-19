/**
 * The Green Haven - Tax Filing Export Module
 * Handles PDF and Excel exports for tax reports
 */

// Load owner info (logo + company name) for PDF letterhead.
// OwnerConfigManager is loaded by tax-filing.html before this script.
function _getOwnerForPDF() {
  return (typeof OwnerConfigManager !== 'undefined') ? OwnerConfigManager.getOwnerInfo() : {};
}

// Inject company logo + name into a jsPDF doc header; returns next y-position
function _addPDFLetterhead(doc, owner) {
  let nextY = 36;
  if (owner.logoDataUrl) {
    try {
      const fmt = owner.logoDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(owner.logoDataUrl, fmt, 15, 8, 20, 20);
    } catch(e) { /* ignore bad logo */ }
  }
  const companyName = owner.companyLegalNameTH || owner.companyLegalNameEN || 'The Green Haven';
  doc.text(`บริษัท: ${companyName}`, owner.logoDataUrl ? 40 : 15, nextY);
  return nextY;
}

// ===== PDF EXPORT FUNCTIONS =====

/**
 * Export monthly tax report to PDF
 */
function exportMonthlyReportPDF() {
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

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Set Thai font
    doc.setFont('Arial', 'normal');

    // Header
    doc.setFontSize(16);
    doc.text('รายงานภาษีรายเดือน', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`เดือน ${report.period}`, 105, 28, { align: 'center' });

    doc.setFontSize(10);
    _addPDFLetterhead(doc, _getOwnerForPDF());
    doc.text(`วันที่สร้าง: ${new Date().toLocaleDateString('th-TH')}`, 15, 41);

    // Revenue Section
    let yPosition = 50;
    doc.setFontSize(11);
    doc.text('รายได้', 15, yPosition);
    yPosition += 7;

    const revenueHeaders = ['ห้อง', 'ค่าเช่า', 'ไฟฟ้า', 'น้ำ', 'รวม'];
    const revenueData = [];

    Object.entries(report.revenue.byRoom).forEach(([room, data]) => {
      revenueData.push([
        room,
        formatCurrency(data.rent),
        formatCurrency(data.electricity),
        formatCurrency(data.water),
        formatCurrency(data.total)
      ]);
    });

    doc.autoTable({
      head: [revenueHeaders],
      body: revenueData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      styles: {
        fontSize: 9,
        cellPadding: 2
      }
    });

    yPosition = doc.lastAutoTable.finalY + 7;

    // Total Revenue
    doc.text(`รวมรายได้: ${formatCurrency(report.revenue.total)}`, 15, yPosition);
    yPosition += 10;

    // Expenses Section
    doc.setFontSize(11);
    doc.text('ค่าใช้จ่าย', 15, yPosition);
    yPosition += 7;

    const expenseHeaders = ['หมวดหมู่', 'จำนวน'];
    const expenseData = [];

    const categoryNames = {
      contractor: 'ค่าจ้างช่าง',
      housekeeping: 'ค่าทำความสะอาด',
      utilities: 'สาธารณูปโภค',
      common: 'ค่าบำรุงส่วนกลาง'
    };

    Object.entries(report.expenses.breakdown).forEach(([category, amount]) => {
      if (amount > 0) {
        expenseData.push([
          categoryNames[category] || category,
          formatCurrency(amount)
        ]);
      }
    });

    doc.autoTable({
      head: [expenseHeaders],
      body: expenseData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      styles: {
        fontSize: 9,
        cellPadding: 2
      }
    });

    yPosition = doc.lastAutoTable.finalY + 7;

    // Total Expenses
    doc.text(`รวมค่าใช้จ่าย: ${formatCurrency(report.expenses.total)}`, 15, yPosition);
    yPosition += 10;

    // Summary
    doc.setFontSize(10);
    const netIncome = report.revenue.total - report.expenses.total;
    doc.text(`กำไรสุทธิ: ${formatCurrency(netIncome)}`, 15, yPosition);
    yPosition += 5;
    doc.text(`หัก ณ ที่จ่าย: ${formatCurrency(report.withholding.total)}`, 15, yPosition);
    yPosition += 5;
    doc.text(`ประมาณภาษี: ${formatCurrency(report.tax.incomeTax)}`, 15, yPosition);

    // Download
    const filename = `monthly_report_${year}_${month}.pdf`;
    doc.save(filename);

    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_EXPORTED',
        `ส่งออกรายงานรายเดือน ${report.period} เป็น PDF`,
        { type: 'MONTHLY_PDF', month, year }
      );
    }

    showSuccess('ส่งออก PDF สำเร็จ');
  } catch (error) {
    console.error('❌ Error exporting monthly report to PDF:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Export quarterly return to PDF
 */
function exportQuarterlyReturnPDF() {
  try {
    const currentYear = new Date().getFullYear();

    // Find which quarter button was clicked
    let quarter = 1;
    const buttons = document.querySelectorAll('[onclick*="displayQuarterlyReturn"]');
    for (let btn of buttons) {
      if (btn.textContent.includes('Q1')) quarter = 1;
      else if (btn.textContent.includes('Q2')) quarter = 2;
      else if (btn.textContent.includes('Q3')) quarter = 3;
      else if (btn.textContent.includes('Q4')) quarter = 4;
    }

    const quarterlyReturns = JSON.parse(localStorage.getItem('quarterly_tax_returns') || '{}');
    const key = `${currentYear}-Q${quarter}`;
    const report = quarterlyReturns[key];

    if (!report) {
      showError('ไม่มีรายงานที่บันทึกไว้ โปรดสร้างรายงานก่อน');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Header
    doc.setFontSize(16);
    doc.text('แบบ ป.พ.6', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`ไตรมาส ${quarter}/${currentYear + 543}`, 105, 28, { align: 'center' });

    doc.setFontSize(10);
    _addPDFLetterhead(doc, _getOwnerForPDF());
    doc.text(`วันที่สร้าง: ${new Date().toLocaleDateString('th-TH')}`, 15, 41);
    doc.text(`กำหนดส่ง: ${report.dueDate}`, 15, 46);

    // Summary Table
    let yPosition = 55;
    doc.setFontSize(11);
    doc.text('สรุปการเงิน', 15, yPosition);
    yPosition += 7;

    const summaryData = [
      ['รายได้รวม', formatCurrency(report.summary.totalRevenue)],
      ['ค่าใช้จ่าย', formatCurrency(report.summary.totalExpenses)],
      ['รายได้สุทธิ', formatCurrency(report.summary.taxableIncome)],
      ['ภาษีอากร (15%)', formatCurrency(report.summary.incomeTax)],
      ['หัก ณ ที่จ่าย', formatCurrency(report.summary.withholdingTax)],
      ['ยอดชำระ', formatCurrency(report.summary.estimatedInstallment)]
    ];

    doc.autoTable({
      body: summaryData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 50, halign: 'right' }
      },
      styles: {
        fontSize: 10,
        cellPadding: 3
      }
    });

    yPosition = doc.lastAutoTable.finalY + 10;

    // Monthly Details
    doc.setFontSize(11);
    doc.text('รายละเอียดรายเดือน', 15, yPosition);
    yPosition += 7;

    const monthlyHeaders = ['เดือน', 'รายได้', 'ค่าใช้จ่าย', 'หัก ณ ที่จ่าย'];
    const monthlyData = report.monthlyDetails.map(m => [
      m.label,
      formatCurrency(m.revenue),
      formatCurrency(m.expenses),
      formatCurrency(m.withholding)
    ]);

    doc.autoTable({
      head: [monthlyHeaders],
      body: monthlyData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      styles: {
        fontSize: 9,
        cellPadding: 2
      }
    });

    // Download
    const filename = `quarterly_return_q${quarter}_${currentYear}.pdf`;
    doc.save(filename);

    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_EXPORTED',
        `ส่งออกแบบ ป.พ.6 ไตรมาส ${quarter} เป็น PDF`,
        { type: 'QUARTERLY_PDF', quarter, year: currentYear }
      );
    }

    showSuccess('ส่งออก PDF สำเร็จ');
  } catch (error) {
    console.error('❌ Error exporting quarterly return to PDF:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
}

/**
 * Export annual return to PDF
 */
function exportAnnualReportPDF() {
  try {
    const buddhYear = parseInt(document.getElementById('annual-year').value) || 2567;
    const year = buddhYear - 543;

    const annualReturns = JSON.parse(localStorage.getItem('annual_tax_returns') || '{}');
    const report = annualReturns[year];

    if (!report) {
      showError('ไม่มีรายงานที่บันทึกไว้ โปรดสร้างรายงานก่อน');
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Header
    doc.setFontSize(16);
    doc.text('แบบ ภ.ป.ภ. 50', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.text(`ปีภาษี ${report.buddhYear}`, 105, 28, { align: 'center' });

    doc.setFontSize(10);
    _addPDFLetterhead(doc, _getOwnerForPDF());
    doc.text(`วันที่สร้าง: ${new Date().toLocaleDateString('th-TH')}`, 15, 41);
    doc.text(`กำหนดส่ง: ${report.filingDeadline}`, 15, 46);

    // Financial Summary
    let yPosition = 55;
    doc.setFontSize(11);
    doc.text('งบการเงิน', 15, yPosition);
    yPosition += 7;

    const financialData = [
      ['รายได้รวม', formatCurrency(report.financialSummary.totalRevenue)],
      ['ค่าใช้จ่าย', formatCurrency(report.financialSummary.totalExpenses)],
      ['กำไรสุทธิ', formatCurrency(report.financialSummary.netIncome)]
    ];

    doc.autoTable({
      body: financialData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 50, halign: 'right' }
      },
      styles: {
        fontSize: 10,
        cellPadding: 3,
        fontStyle: 'bold'
      }
    });

    yPosition = doc.lastAutoTable.finalY + 10;

    // Tax Calculation
    doc.setFontSize(11);
    doc.text('การคำนวณภาษี', 15, yPosition);
    yPosition += 7;

    const taxData = [
      ['รายได้สุทธิ', formatCurrency(report.taxCalculation.taxableIncome)],
      ['อัตราภาษี', `${report.taxCalculation.taxRate}%`],
      ['ภาษีอากรที่ต้องชำระ', formatCurrency(report.taxCalculation.incomeTax)],
      ['หัก ณ ที่จ่าย', formatCurrency(report.taxCalculation.withholdingTax)],
      [report.taxCalculation.taxBalance > 0 ? 'ยอดชำระเพิ่มเติม' : 'ยอดเงินคืน',
       formatCurrency(Math.abs(report.taxCalculation.taxBalance))]
    ];

    doc.autoTable({
      body: taxData,
      startY: yPosition,
      margin: { left: 15, right: 15 },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 50, halign: 'right' }
      },
      styles: {
        fontSize: 10,
        cellPadding: 3
      }
    });

    // Expense Breakdown
    yPosition = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.text('รายละเอียดค่าใช้จ่าย', 15, yPosition);
    yPosition += 7;

    const categoryNames = {
      contractor: 'ค่าจ้างช่าง',
      housekeeping: 'ค่าทำความสะอาด',
      utilities: 'สาธารณูปโภค',
      common: 'ค่าบำรุงส่วนกลาง'
    };

    const expenseData = Object.entries(report.expenseBreakdown)
      .filter(([, amount]) => amount > 0)
      .map(([category, amount]) => [
        categoryNames[category] || category,
        formatCurrency(amount)
      ]);

    if (expenseData.length > 0) {
      doc.autoTable({
        body: expenseData,
        startY: yPosition,
        margin: { left: 15, right: 15 },
        columnStyles: {
          0: { cellWidth: 60 },
          1: { cellWidth: 50, halign: 'right' }
        },
        styles: {
          fontSize: 9,
          cellPadding: 2
        }
      });
    }

    // Download
    const filename = `annual_return_${year}.pdf`;
    doc.save(filename);

    if (window.AuditLogger) {
      window.AuditLogger.log(
        'REPORT_EXPORTED',
        `ส่งออกแบบ ภ.ป.ภ. 50 ปี ${year} เป็น PDF`,
        { type: 'ANNUAL_PDF', year }
      );
    }

    showSuccess('ส่งออก PDF สำเร็จ');
  } catch (error) {
    console.error('❌ Error exporting annual report to PDF:', error);
    showError('เกิดข้อผิดพลาด: ' + error.message);
  }
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

/**
 * Export annual return to Excel
 */
function exportAnnualReportExcel() {
  try {
    const buddhYear = parseInt(document.getElementById('annual-year').value) || 2567;
    const year = buddhYear - 543;

    const annualReturns = JSON.parse(localStorage.getItem('annual_tax_returns') || '{}');
    const report = annualReturns[year];

    if (!report) {
      showError('ไม่มีรายงานที่บันทึกไว้ โปรดสร้างรายงานก่อน');
      return;
    }

    const ExcelJS = window.ExcelJS;
    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Financial Statement
    const financialSheet = workbook.addWorksheet('งบการเงิน');
    let row = 1;

    financialSheet.mergeCells('A1:B1');
    const titleCell = financialSheet.getCell('A1');
    titleCell.value = `แบบ ภ.ป.ภ. 50 - ปีภาษี ${report.buddhYear}`;
    titleCell.font = { size: 14, bold: true };
    titleCell.alignment = { horizontal: 'center' };
    row += 2;

    // Financial Summary
    financialSheet.getCell(row, 1).value = 'รายการ';
    financialSheet.getCell(row, 2).value = 'จำนวน';
    financialSheet.getCell(row, 1).font = { bold: true };
    financialSheet.getCell(row, 2).font = { bold: true };
    row++;

    const financialData = [
      ['รายได้รวม', report.financialSummary.totalRevenue],
      ['ค่าใช้จ่าย', report.financialSummary.totalExpenses],
      ['กำไรสุทธิ', report.financialSummary.netIncome]
    ];

    financialData.forEach(([label, value]) => {
      financialSheet.getCell(row, 1).value = label;
      financialSheet.getCell(row, 2).value = value;
      financialSheet.getCell(row, 2).numFmt = '฿#,##0.00';
      row++;
    });

    row += 2;

    // Tax Calculation
    financialSheet.getCell(row, 1).value = 'การคำนวณภาษี';
    financialSheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;

    financialSheet.getCell(row, 1).value = 'รายการ';
    financialSheet.getCell(row, 2).value = 'จำนวน';
    financialSheet.getCell(row, 1).font = { bold: true };
    financialSheet.getCell(row, 2).font = { bold: true };
    row++;

    const taxData = [
      ['รายได้สุทธิ', report.taxCalculation.taxableIncome],
      ['อัตราภาษี (%)', report.taxCalculation.taxRate],
      ['ภาษีอากร', report.taxCalculation.incomeTax],
      ['หัก ณ ที่จ่าย', report.taxCalculation.withholdingTax],
      [report.taxCalculation.taxBalance > 0 ? 'ยอดชำระ' : 'ยอดคืน', Math.abs(report.taxCalculation.taxBalance)]
    ];

    taxData.forEach(([label, value]) => {
      financialSheet.getCell(row, 1).value = label;
      financialSheet.getCell(row, 2).value = value;
      if (label !== 'อัตราภาษี (%)') {
        financialSheet.getCell(row, 2).numFmt = '฿#,##0.00';
      }
      row++;
    });

    financialSheet.columns = [{ width: 30 }, { width: 20 }];

    // Sheet 2: Quarterly Breakdown
    const quarterlySheet = workbook.addWorksheet('รายละเอียดไตรมาส');
    row = 1;

    quarterlySheet.mergeCells('A1:E1');
    const qTitleCell = quarterlySheet.getCell('A1');
    qTitleCell.value = `รายละเอียดไตรมาส - ปี ${year}`;
    qTitleCell.font = { size: 12, bold: true };
    qTitleCell.alignment = { horizontal: 'center' };
    row += 2;

    const qHeaders = ['ไตรมาส', 'รายได้', 'ค่าใช้จ่าย', 'รายได้สุทธิ', 'ภาษี'];
    qHeaders.forEach((header, index) => {
      const cell = quarterlySheet.getCell(row, index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2d8653' } };
    });
    row++;

    report.quarterlyBreakdown.forEach(q => {
      quarterlySheet.getCell(row, 1).value = `Q${q.quarter}`;
      quarterlySheet.getCell(row, 2).value = q.revenue;
      quarterlySheet.getCell(row, 3).value = q.expenses;
      quarterlySheet.getCell(row, 4).value = q.taxableIncome;
      quarterlySheet.getCell(row, 5).value = q.incomeTax;

      for (let i = 2; i <= 5; i++) {
        quarterlySheet.getCell(row, i).numFmt = '฿#,##0.00';
      }
      row++;
    });

    quarterlySheet.columns = [
      { width: 12 },
      { width: 15 },
      { width: 15 },
      { width: 18 },
      { width: 15 }
    ];

    // Save
    const filename = `annual_return_${year}.xlsx`;
    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();

      if (window.AuditLogger) {
        window.AuditLogger.log(
          'REPORT_EXPORTED',
          `ส่งออกแบบ ภ.ป.ภ. 50 ปี ${year} เป็น Excel`,
          { type: 'ANNUAL_EXCEL', year }
        );
      }

      showSuccess('ส่งออก Excel สำเร็จ');
    });
  } catch (error) {
    console.error('❌ Error exporting annual report to Excel:', error);
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
