/**
 * Invoice PDF Generator
 * Generates professional PDF invoices (ใบวางบิล) and receipts (ใบเสร็จรับเงิน)
 *
 * Requires: jsPDF library (loaded externally)
 */

class InvoicePDFGenerator {
  /**
   * Generate Invoice PDF (ใบวางบิล)
   */
  static generateInvoicePDF(invoiceData) {
    try {
      if (typeof jsPDF === 'undefined') {
        console.warn('⚠️ jsPDF not loaded');
        return null;
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 20;

      // Header
      doc.setFontSize(20);
      doc.setTextColor(45, 134, 83);
      doc.text('🌿 The Green Haven', pageWidth / 2, yPosition, { align: 'center' });

      yPosition += 10;
      doc.setFontSize(11);
      doc.setTextColor(100);
      const building = invoiceData.building === 'nest' ? 'Nest Building' : 'ห้องแถว';
      doc.text(`อพาร์ทเมนต์ ${building}`, pageWidth / 2, yPosition, { align: 'center' });

      // Invoice Title
      yPosition += 15;
      doc.setFontSize(16);
      doc.setTextColor(25, 118, 210);
      doc.text('ใบวางบิล / INVOICE', pageWidth / 2, yPosition, { align: 'center' });

      yPosition += 10;
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(`เลขที่: ${invoiceData.id}`, pageWidth / 2, yPosition, { align: 'center' });

      // Room & Invoice Details
      yPosition += 15;
      doc.setFillColor(240, 247, 255);
      doc.rect(15, yPosition - 5, pageWidth - 30, 30, 'F');

      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text('ห้องเลขที่:', 20, yPosition);
      doc.setFontSize(12);
      doc.setTextColor(45, 134, 83);
      doc.setFont(undefined, 'bold');
      doc.text(invoiceData.roomId, 50, yPosition);

      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text('ประจำเดือน:', 20, yPosition + 8);
      doc.setFontSize(11);
      doc.setTextColor(45, 134, 83);
      doc.setFont(undefined, 'bold');
      doc.text(invoiceData.month, 50, yPosition + 8);

      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.setFont(undefined, 'normal');
      const today = new Date().toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      doc.text(`วันที่ออกบิล: ${today}`, pageWidth - 60, yPosition + 8);

      // Breakdown Table
      yPosition += 40;
      doc.setFontSize(11);
      doc.setTextColor(25, 118, 210);
      doc.setFont(undefined, 'bold');
      doc.text('รายละเอียดค่าใช้จ่าย', 15, yPosition);

      yPosition += 8;

      const tableData = [
        ['รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'รวม'],
        [
          'ค่าเช่า (ประจำเดือน)',
          '1',
          'เดือน',
          invoiceData.breakdown.rent.toLocaleString('th-TH'),
          invoiceData.breakdown.rent.toLocaleString('th-TH')
        ],
        [
          'ค่าไฟฟ้า',
          (invoiceData.breakdown.electric / (invoiceData.electricRate || 8)).toFixed(1),
          'หน่วย',
          (invoiceData.electricRate || 8).toLocaleString('th-TH'),
          invoiceData.breakdown.electric.toLocaleString('th-TH')
        ],
        [
          'ค่าน้ำ',
          (invoiceData.breakdown.water / (invoiceData.waterRate || 20)).toFixed(1),
          'หน่วย',
          (invoiceData.waterRate || 20).toLocaleString('th-TH'),
          invoiceData.breakdown.water.toLocaleString('th-TH')
        ],
        [
          'ค่ากลาง (ขยะ-ไฟส่วนกลาง)',
          '1',
          'เดือน',
          invoiceData.breakdown.trash.toLocaleString('th-TH'),
          invoiceData.breakdown.trash.toLocaleString('th-TH')
        ]
      ];

      doc.autoTable({
        startY: yPosition,
        head: tableData[0],
        body: tableData.slice(1),
        theme: 'grid',
        headStyles: { fillColor: [25, 118, 210], textColor: 255, fontSize: 10, fontStyle: 'bold' },
        bodyStyles: { fontSize: 9, textColor: 80 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: { 4: { halign: 'right' } }
      });

      yPosition = doc.lastAutoTable.finalY + 10;

      // Total
      doc.setDrawColor(25, 118, 210);
      doc.setLineWidth(2);
      doc.line(15, yPosition, pageWidth - 15, yPosition);

      yPosition += 8;
      doc.setFontSize(14);
      doc.setTextColor(25, 118, 210);
      doc.setFont(undefined, 'bold');
      doc.text('รวมทั้งสิ้น', 15, yPosition);
      doc.text(`฿${invoiceData.amount.toLocaleString('th-TH')}`, pageWidth - 20, yPosition, { align: 'right' });

      // QR Code & Payment Info
      yPosition += 20;
      doc.setFillColor(227, 242, 253);
      doc.rect(15, yPosition - 5, pageWidth - 30, 40, 'F');

      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.setFont(undefined, 'bold');
      doc.text('📱 สแกน QR Code เพื่อชำระเงิน (Prompt Pay)', pageWidth / 2, yPosition, { align: 'center' });

      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.setFont(undefined, 'normal');
      doc.text('ชื่อ: The Green Haven', pageWidth / 2, yPosition + 10, { align: 'center' });
      doc.text('เบอร์PromptPay: 089-1234567', pageWidth / 2, yPosition + 16, { align: 'center' });
      doc.text('หรือโอนผ่าน e-Banking ของธนาคารท่านของ', pageWidth / 2, yPosition + 22, { align: 'center' });
      doc.text('โปรดชำระภายใน 5 วันนับจากวันที่ออกบิล', pageWidth / 2, yPosition + 28, { align: 'center' });

      // Footer
      yPosition = pageHeight - 20;
      doc.setFontSize(8);
      doc.setTextColor(180);
      doc.text('The Green Haven Management System', pageWidth / 2, yPosition, { align: 'center' });
      doc.text(`ระบบจัดการอพาร์ทเมนต์ | Generated: ${new Date().toLocaleString('th-TH')}`, pageWidth / 2, yPosition + 6, {
        align: 'center'
      });

      return doc;
    } catch (error) {
      console.error('❌ Error generating invoice PDF:', error);
      return null;
    }
  }

  /**
   * Generate Receipt PDF (ใบเสร็จรับเงิน)
   */
  static generateReceiptPDF(receiptData) {
    try {
      if (typeof jsPDF === 'undefined') {
        console.warn('⚠️ jsPDF not loaded');
        return null;
      }

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      let yPosition = 20;

      // Header
      doc.setFontSize(20);
      doc.setTextColor(45, 134, 83);
      doc.text('🌿 The Green Haven', pageWidth / 2, yPosition, { align: 'center' });

      yPosition += 10;
      doc.setFontSize(11);
      doc.setTextColor(100);
      doc.text('อพาร์ทเมนต์', pageWidth / 2, yPosition, { align: 'center' });

      // Receipt Title
      yPosition += 15;
      doc.setFontSize(16);
      doc.setTextColor(45, 134, 83);
      doc.text('✅ ใบเสร็จรับเงิน / RECEIPT', pageWidth / 2, yPosition, { align: 'center' });

      yPosition += 10;
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text(`เลขที่: ${receiptData.id}`, pageWidth / 2, yPosition, { align: 'center' });

      // Receipt Details
      yPosition += 15;
      doc.setFillColor(232, 245, 233);
      doc.rect(15, yPosition - 5, pageWidth - 30, 35, 'F');

      doc.setFontSize(10);
      doc.setTextColor(80);
      doc.text(`ห้องเลขที่: ${receiptData.roomId}`, 20, yPosition);
      doc.text(`จำนวนเงิน: ฿${receiptData.amount.toLocaleString('th-TH')}`, 20, yPosition + 8);
      doc.text(`วิธีชำระ: ${receiptData.paymentMethod === 'slip' ? '📸 สลิปการโอนเงิน' : 'อื่น ๆ'}`, 20, yPosition + 16);

      if (receiptData.slipOkVerified) {
        doc.setTextColor(45, 134, 83);
        doc.setFont(undefined, 'bold');
        doc.text('✅ ตรวจสอบโดย SlipOK', 20, yPosition + 24);
      }

      // Verification Info
      yPosition += 45;
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`วันที่ชำระ: ${new Date(receiptData.createdAt).toLocaleDateString('th-TH')}`, 20, yPosition);
      doc.text(`เวลา: ${new Date(receiptData.createdAt).toLocaleTimeString('th-TH')}`, 20, yPosition + 8);
      doc.text(`ยืนยันโดย: ${receiptData.verifiedBy || 'System'}`, 20, yPosition + 16);

      // Confirmation Box
      yPosition += 30;
      doc.setFillColor(76, 175, 80);
      doc.rect(15, yPosition - 5, pageWidth - 30, 25, 'F');

      doc.setFontSize(12);
      doc.setTextColor(255);
      doc.setFont(undefined, 'bold');
      doc.text('✅ ยืนยันการชำระเงินเรียบร้อย', pageWidth / 2, yPosition + 8, { align: 'center' });
      doc.setFontSize(10);
      doc.text('ขอบคุณที่ชำระเงินค่าเช่าตรงเวลา', pageWidth / 2, yPosition + 15, { align: 'center' });

      return doc;
    } catch (error) {
      console.error('❌ Error generating receipt PDF:', error);
      return null;
    }
  }

  /**
   * Download PDF file
   */
  static downloadPDF(doc, filename) {
    if (doc) {
      doc.save(filename);
      console.log(`✅ PDF downloaded: ${filename}`);
    }
  }
}

console.log('✅ InvoicePDFGenerator loaded');
