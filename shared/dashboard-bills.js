// shared/dashboard-bills.js
// Admin bill upload + generation + Excel-import pipeline.
// Extracted from shared/dashboard-extra.js on 2026-05-21 (Phase 2 S3).
// See tasks/todo.md for the full Phase 2 plan.
//
// Loaded BEFORE shared/dashboard-extra.js in dashboard.html.
//
// Cross-script identifiers this module READS (resolved via global lookup):
//  - RoomConfigManager, TenantConfigManager, BillStore, BillGenerator
//  - window.firebase, window.firebaseAuth, window.firebaseRTDB
//  - showToast, showPage
//  - _esc (now in dashboard-tenant-lease.js after Phase 2 S2)
//  - XLSX (loaded via CDN in dashboard.html)

// ===== UPLOAD REAL BILLS PAGE (ADMIN ONLY) =====
// Phone Number Validation Function
// Handles: format, validation, error messages, auto-formatting
function validatePhoneNumber(inputElement, errorElementId) {
  const input = inputElement.value;
  const errorEl = errorElementId ? document.getElementById(errorElementId) : null;

  // Remove all non-digit characters for processing
  const cleanedInput = input.replace(/\D/g, '');

  // Initialize error message as empty
  let errorMsg = '';
  let isValid = true;

  // Validation rules:
  // 1. Must contain only numbers
  if (input !== cleanedInput && input.length > 0) {
    // Allow dashes and spaces but clean them
    if (!/^[0-9\s\-]*$/.test(input)) {
      errorMsg = '❌ เบอร์โทรต้องเป็นตัวเลขเท่านั้น (0-9, dash, space)';
      isValid = false;
    }
  }

  // 2. Must be exactly 10 digits
  if (cleanedInput.length > 0 && cleanedInput.length !== 10) {
    errorMsg = '❌ กรุณากรอกเบอร์โทร 10 หลัก';
    isValid = false;
  }

  // 3. Must start with 0
  if (cleanedInput.length > 0 && !cleanedInput.startsWith('0')) {
    errorMsg = '❌ เบอร์โทรต้องขึ้นต้นด้วย 0';
    isValid = false;
  }

  // Update input value with cleaned version (store without dashes)
  inputElement.value = cleanedInput;

  // Display formatted version for user (with dashes) - optional
  // Format: 081-234-5678
  if (cleanedInput.length === 10) {
    const formatted = cleanedInput.slice(0, 3) + '-' + cleanedInput.slice(3, 6) + '-' + cleanedInput.slice(6);
    inputElement.placeholder = formatted;
  }

  // Show/hide error message
  if (errorEl) {
    if (errorMsg) {
      errorEl.classList.remove('u-hidden');
      errorEl.classList.add('u-error-text');
      errorEl.textContent = errorMsg;
    } else {
      errorEl.classList.add('u-hidden');
      errorEl.textContent = '';
    }
  }

  // Update input styling based on validation
  if (cleanedInput.length === 10 && isValid) {
    inputElement.classList.remove('u-input-invalid'); inputElement.classList.add('u-input-valid');
  } else if (cleanedInput.length > 0 && !isValid) {
    inputElement.classList.remove('u-input-valid'); inputElement.classList.add('u-input-invalid');
  } else {
    inputElement.classList.remove('u-input-valid', 'u-input-invalid');
  }

  return isValid && cleanedInput.length === 10;
}

// Attach validation to phone input fields
function initPhoneValidation() {
  const phoneFields = [
    { id: 'modalTenantPhone', errorId: 'modalTenantPhoneError' },
    { id: 'tm-phone', errorId: 'tmPhoneError' },
    { id: 'ownerPhone', errorId: 'ownerPhoneError' },
    { id: 'newTenantPhone', errorId: 'newTenantPhoneError' }
  ];

  phoneFields.forEach(field => {
    const input = document.getElementById(field.id);
    if (input) {
      // Real-time validation on input
      input.addEventListener('input', function() {
        validatePhoneNumber(this, field.errorId);
      });

      // Validate on blur
      input.addEventListener('blur', function() {
        validatePhoneNumber(this, field.errorId);
      });
    }
  });
}

// Call this when page loads or modals open
document.addEventListener('DOMContentLoaded', function() {
  initPhoneValidation();
});

// ============== BILL GENERATION SYSTEM ==============

/**
 * Generate monthly invoices for all rooms
 */
function generateMonthlyBillsUI() {
  const building = prompt('เลือกอาคาร:\n1. rooms (ห้องแถว)\n2. nest (Nest Building)', '1');
  if (!building) return;

  const buildingName = building === '2' ? 'nest' : 'rooms';
  const month = prompt('เดือน (1-12):', new Date().getMonth() + 1);
  const year = prompt('ปี (ค.ศ.)', new Date().getFullYear() + 543);

  if (!month || !year) return;

  try {
    const buddhistYear = parseInt(year) - 543;
    const monthNum = parseInt(month);

    if (monthNum < 1 || monthNum > 12) {
      showToast('เดือนไม่ถูกต้อง', 'error');
      return;
    }

    // Generate bills
    const result = BillGenerator.generateMonthlyBills(buildingName, buddhistYear, monthNum);

    if (result.success) {
      showToast(`สร้างใบวางบิลสำเร็จ! จำนวน: ${result.count} ใบ อาคาร: ${buildingName} เดือน: ${monthNum}/${buddhistYear}`, 'success');

      // Show generated invoice list
      showGeneratedInvoices(buildingName, result.invoiceIds);

      // Update dashboard
      updateOccupancyDashboard();
    } else {
      showToast(`เกิดข้อผิดพลาด: ไม่สามารถสร้างใบวางบิล`, 'error');
    }
  } catch (error) {
    console.error('Error:', error);
    showToast('เกิดข้อผิดพลาด: ' + error.message, 'error');
  }
}

/**
 * Display list of generated invoices
 */
function showGeneratedInvoices(building, invoiceIds) {
  let invoiceList = `📋 สร้างใบวางบิล ${invoiceIds.length} ใบ\n\n`;

  invoiceIds.slice(0, 10).forEach((id, idx) => {
    invoiceList += `${idx + 1}. ${id}\n`;
  });

  if (invoiceIds.length > 10) {
    invoiceList += `\n... และอีก ${invoiceIds.length - 10} ใบ`;
  }

  console.info(invoiceList);
}

/**
 * Download all invoices as PDF
 */
function downloadInvoicesPDF() {
  const building = prompt('เลือกอาคาร:\n1. rooms\n2. nest', '1');
  if (!building) return;

  const buildingName = building === '2' ? 'nest' : 'rooms';
  const allInvoices = InvoiceReceiptManager.getAllInvoices(buildingName);

  if (allInvoices.length === 0) {
    showToast('ไม่มีใบวางบิล', 'error');
    return;
  }

  showToast(`ดาวน์โหลด ${allInvoices.length} ใบวางบิล (ระบบจะดาวน์โหลดแต่ละไฟล์)`, 'warning');

  // Perf #3: lazy-load jsPDF/html2pdf before first use
  (typeof window.ensurePDFLibs === 'function' ? window.ensurePDFLibs() : Promise.resolve())
    .then(() => {
      allInvoices.forEach((invoice, idx) => {
        setTimeout(() => {
          // Enrich invoice with tenant's chosen recipient format (state-driven render).
          // Bill switches logo + adds recipient block when tenant opted for "นิติบุคคล".
          const _enriched = { ...invoice, recipient: _resolveBillRecipient(invoice.building, invoice.roomId) };
          const pdf = InvoicePDFGenerator.generateInvoicePDF(_enriched);
          if (pdf) {
            InvoicePDFGenerator.downloadPDF(pdf, `INV-${invoice.id}.pdf`);
          }
        }, idx * 500);  // Delay to avoid browser blocking
      });
    })
    .catch(err => showToast('โหลด PDF library ล้มเหลว: ' + err.message, 'error'));
}

// Resolve a bill's recipient block from tenant's saved choice (Profile → "ตั้งค่าการออกใบเสร็จ").
// Returns { type, companyName?, taxId?, address? } — empty object if no choice or lookup fails.
function _resolveBillRecipient(building, roomId) {
  try {
    if (typeof TenantConfigManager === 'undefined' || !building || !roomId) return {};
    const tenant = TenantConfigManager.getTenant(building, roomId);
    if (!tenant) return {};
    const type = tenant.receiptType || 'personal';
    const co = tenant.companyInfo || tenant.company || {};
    if (type === 'company') {
      return { type, companyName: co.name || '', taxId: co.taxId || '', address: co.address || '' };
    }
    return { type: 'personal' };
  } catch(_) { return {}; }
}
window._resolveBillRecipient = _resolveBillRecipient;

/**
 * Listen for new invoice notifications
 */
function listenForInvoiceNotifications() {
  window.addEventListener('new_invoices_generated', function() {
    console.info('🔔 New invoices generated!');
    showNotification('📄 สร้างใบวางบิลใหม่เข้ามา', 'success');
  });

  window.addEventListener('storage', function(e) {
    if (e.key === 'invoice_notifications') {
      const notifications = JSON.parse(e.newValue || '[]');
      if (notifications.length > 0) {
        const latest = notifications[notifications.length - 1];
        showNotification(`📄 มีใบวางบิลใหม่ ${latest.count} ใบ`, 'info');
      }
    }
  });
}

/**
 * Show notification on dashboard
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `u-notif u-notif-${type === 'success' ? 'success' : 'info'}`;

  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-in';
    setTimeout(() => notification.remove(), 300);
  }, 4000);
}


// Initialize listeners on page load
listenForInvoiceNotifications();
listenForPaymentNotifications();

/**
 * Listen for payment notifications from tenant app
 */
function listenForPaymentNotifications() {
  // Listen for payment verified event
  window.addEventListener('payment_verified', function() {
    console.info('🔔 Payment verified from tenant app!');
    showNotification('✅ ได้รับเงินจากผู้เช่า', 'success');
    loadPaymentNotifications();
  });

  // Listen for receipt generated event
  window.addEventListener('receipt_generated', function() {
    console.info('🔔 Receipt generated!');
    showNotification('📄 ใบเสร็จรับเงินถูกสร้าง', 'success');
    loadPaymentNotifications();
  });

  // Listen for storage changes (for cross-tab sync)
  window.addEventListener('storage', function(e) {
    if (e.key === 'payment_notifications') {
      const notifications = JSON.parse(e.newValue || '[]');
      if (notifications.length > 0) {
        const latest = notifications[notifications.length - 1];
        if (latest.type === 'payment_verified') {
          showNotification(`✅ ห้อง ${latest.room} - โอนเงิน ฿${latest.amount.toLocaleString('th-TH')}`, 'success');
        } else if (latest.type === 'receipt_generated') {
          showNotification(`📄 ห้อง ${latest.room} - ใบเสร็จ ${latest.receiptId}`, 'success');
        }
      }
    }
  });

  // Load initial notifications
  loadPaymentNotifications();
}

/**
 * Load and display payment notifications
 */
function loadPaymentNotifications() {
  try {
    const notifications = JSON.parse(localStorage.getItem('payment_notifications') || '[]');

    if (notifications.length === 0) {
      console.info('📭 No payment notifications');
      const notifPanel = document.getElementById('paymentNotificationsList');
      if (notifPanel) {
        notifPanel.innerHTML = `<div style="text-align: center; color: ${DashColors.TEXT_LIGHTER}; padding: 2rem;">📭 ยังไม่มีการชำระเงิน</div>`;
      }
      return;
    }

    // Update notifications panel on payment verification page
    updatePaymentNotificationsPanel(notifications);

    // Display latest 5 notifications in console
    const recent = notifications.slice(-5).reverse();
    console.info('💳 Recent Payment Notifications:');
    recent.forEach((notif, idx) => {
      console.info(`${idx + 1}. [${notif.type}] ห้อง ${notif.room} - ฿${notif.amount?.toLocaleString('th-TH')} (${new Date(notif.timestamp).toLocaleString('th-TH')})`);

      // Update dashboard UI if payment verification section exists
      if (notif.type === 'payment_verified') {
        updatePaymentVerificationUI(notif);
      } else if (notif.type === 'receipt_generated') {
        updateReceiptGenerationUI(notif);
      }
    });

    // Update payment notification badge if it exists
    updatePaymentNotificationBadge(notifications.length);
  } catch (error) {
    console.warn('⚠️ Error loading payment notifications:', error);
  }
}

/**
 * Update payment notifications panel display
 */
function updatePaymentNotificationsPanel(notifications) {
  try {
    const notifPanel = document.getElementById('paymentNotificationsList');
    if (!notifPanel) return;

    // Show latest 10 notifications, newest first
    const recent = notifications.slice(-10).reverse();

    notifPanel.innerHTML = recent.map((notif, idx) => {
      const timeStr = new Date(notif.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(notif.timestamp).toLocaleDateString('th-TH');

      if (notif.type === 'payment_verified') {
        return `
          <div style="background: white; border-left: 4px solid ${DashColors.GREEN_ACTIVE}; padding: 1rem; margin-bottom: 0.5rem; border-radius: 4px; font-size: 0.9rem;">
            <div style="font-weight: 600; color: ${DashColors.GREEN_DARK};">✅ ห้อง ${notif.room} - โอนเงิน ฿${notif.amount?.toLocaleString('th-TH')}</div>
            <div style="font-size: 0.8rem; color: ${DashColors.TEXT_MUTED}; margin-top: 0.3rem;">
              ${dateStr} ${timeStr} | SlipID: ${notif.slipId?.substring(0, 10) || 'N/A'}...
            </div>
          </div>
        `;
      } else if (notif.type === 'receipt_generated') {
        return `
          <div style="background: white; border-left: 4px solid ${DashColors.BLUE_MED}; padding: 1rem; margin-bottom: 0.5rem; border-radius: 4px; font-size: 0.9rem;">
            <div style="font-weight: 600; color: ${DashColors.BLUE_DARK};">📄 ห้อง ${notif.room} - ใบเสร็จ ฿${notif.amount?.toLocaleString('th-TH')}</div>
            <div style="font-size: 0.8rem; color: ${DashColors.TEXT_MUTED}; margin-top: 0.3rem;">
              ${dateStr} ${timeStr} | ReceiptID: ${notif.receiptId?.substring(0, 10) || 'N/A'}... | Verified: ${notif.verified ? '✅' : '❌'}
            </div>
          </div>
        `;
      }
      return '';
    }).join('');
  } catch (error) {
    console.warn('⚠️ Error updating notifications panel:', error);
  }
}

/**
 * Update payment verification UI in admin dashboard
 */
function updatePaymentVerificationUI(notification) {
  try {
    // Find payment section in dashboard
    const paymentSection = document.querySelector('[data-section="payment-verification"]');
    if (!paymentSection) return;

    // Add notification item to payment list
    const notifItem = document.createElement('div');
    notifItem.className = 'payment-notification-item';

    const timeStr = new Date(notification.timestamp).toLocaleTimeString('th-TH');
    notifItem.innerHTML = `
      <div style="font-weight: 600; color: ${DashColors.GREEN_DARK};">
        ✅ ห้อง ${_esc(notification.room)} - โอนเงิน ฿${notification.amount?.toLocaleString('th-TH')}
      </div>
      <div style="font-size: 12px; color: ${DashColors.TEXT_MUTED}; margin-top: 4px;">
        เวลา: ${timeStr} | SlipID: ${_esc(notification.slipId || 'N/A')}
      </div>
    `;

    // Insert at top of payment list
    const paymentList = paymentSection.querySelector('.payment-list') || paymentSection;
    if (paymentList.firstChild) {
      paymentList.insertBefore(notifItem, paymentList.firstChild);
    } else {
      paymentList.appendChild(notifItem);
    }

    // Keep only last 10 items
    const items = paymentList.querySelectorAll('.payment-notification-item');
    if (items.length > 10) {
      items[items.length - 1].remove();
    }
  } catch (error) {
    console.warn('⚠️ Error updating payment verification UI:', error);
  }
}

/**
 * Update receipt generation UI in admin dashboard
 */
function updateReceiptGenerationUI(notification) {
  try {
    // Find receipt section in dashboard
    const receiptSection = document.querySelector('[data-section="receipt-list"]');
    if (!receiptSection) return;

    // Add receipt item
    const receiptItem = document.createElement('div');
    receiptItem.className = 'receipt-notification-item';

    const timeStr = new Date(notification.timestamp).toLocaleTimeString('th-TH');
    receiptItem.innerHTML = `
      <div style="font-weight: 600; color: ${DashColors.BLUE_DARK};">
        📄 ใบเสร็จ ห้อง ${notification.room} - ฿${notification.amount?.toLocaleString('th-TH')}
      </div>
      <div style="font-size: 12px; color: ${DashColors.TEXT_MUTED}; margin-top: 4px;">
        เวลา: ${timeStr} | ReceiptID: ${notification.receiptId || 'N/A'} | Verified: ${notification.verified ? '✅' : '❌'}
      </div>
    `;

    // Insert at top of receipt list
    const receiptList = receiptSection.querySelector('.receipt-list') || receiptSection;
    if (receiptList.firstChild) {
      receiptList.insertBefore(receiptItem, receiptList.firstChild);
    } else {
      receiptList.appendChild(receiptItem);
    }

    // Keep only last 10 items
    const items = receiptList.querySelectorAll('.receipt-notification-item');
    if (items.length > 10) {
      items[items.length - 1].remove();
    }
  } catch (error) {
    console.warn('⚠️ Error updating receipt generation UI:', error);
  }
}

/**
 * Update payment notification badge
 */
function updatePaymentNotificationBadge(count) {
  try {
    let badge = document.querySelector('[data-badge="payment-count"]');
    if (!badge) {
      // Create badge if doesn't exist
      badge = document.createElement('span');
      badge.setAttribute('data-badge', 'payment-count');
      badge.className = 'u-payment-badge';
      const paymentTab = document.querySelector('[data-nav="💳"]') || document.querySelector('button:contains("💳")');
      if (paymentTab) {
        paymentTab.appendChild(badge);
      }
    }

    if (badge && count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.add('u-iblock'); /*iblock*/;
    } else if (badge) {
      badge.classList.add('u-hidden');
    }
  } catch (error) {
    console.warn('⚠️ Error updating payment notification badge:', error);
  }
}

/**
 * Get payment notification summary
 */
/**
 * Clear payment notifications (admin function)
 */
function clearPaymentNotifications() {
  window.ghConfirm('ล้างประวัติการชำระเงินทั้งหมด?', { danger: true }).then(ok => {
    if (!ok) return;
    localStorage.setItem('payment_notifications', '[]');
    showNotification('✅ ล้างประวัติเรียบร้อย', 'success');
    loadPaymentNotifications();
  });
}


// ===== BILLING IMPORT FUNCTIONS =====
/**
 * CRITICAL SECTION: Handles file uploads for billing data
 *
 * 🔑 KEY CONCEPT: Two entry points → One processor
 * 1. Drop Zone (ondrop) → handleBillingImportDrop()
 * 2. File Input (onchange) → handleBillingImportFile()
 * 3. Both call → handleBillingImportFileProcess(file)
 *
 * ⚠️ IMPORTANT: Functions MUST be exposed to window scope (bottom of this section)
 *    Otherwise HTML onclick/ondrop attributes will not find them!
 */

function handleBillingImportDrop(event) {
  event.preventDefault();
  const files = event.dataTransfer.files;
  if (files.length > 0) {
    handleBillingImportFileProcess(files[0]);
  }
}

/**
 * ENTRY POINT #1: File input onchange handler
 * HTML attribute: onchange="window.handleBillingImportFile && window.handleBillingImportFile(event);"
 *
 * Flow: User clicks drop zone → clicks hidden input → selects file → onchange fires → this function called
 *
 * ⚠️ Safety check in HTML: "window.handleBillingImportFile &&" prevents error if not loaded yet
 */
function handleBillingImportFile(event) {
  const files = event.target.files;
  if (files.length > 0) {
    handleBillingImportFileProcess(files[0]);
  }
}

/**
 * 🚨 CRITICAL SECTION: EXPOSE TO GLOBAL SCOPE
 *
 * WHY: HTML attributes (onchange, ondrop) need these functions in window scope
 * WHEN: After function definitions above
 *
 * If this is missing or wrong:
 * ❌ Error: "handleBillingImportFile is not defined"
 * ❌ Error: "handleBillingImportDrop is not defined"
 *
 * Solution: Always assign to window object:
 */
window.handleBillingImportFile = handleBillingImportFile;
window.handleBillingImportDrop = handleBillingImportDrop;

/**
 * MAIN PROCESSOR: Handles Excel file reading and parsing
 *
 * 🔄 FLOW:
 * 1. Extract year from filename (must have "ปี" + number)
 * 2. Read Excel file using XLSX library
 * 3. Parse sheets based on year format
 * 4. Save to HISTORICAL_DATA in localStorage
 * 5. Display preview with matchResults
 *
 * ⚠️ CRITICAL DEPENDENCIES:
 * - XLSX library (loaded in HTML header)
 * - meter-unified.js (for matchMeterDataWithPrevious)
 * - Functions: showBillingImportStatus, parseImportExcelData, displayImportPreview
 *
 * 🐛 COMMON ISSUES:
 * - "matchMeterDataWithPrevious is not defined" → Check if meter-unified.js loaded
 * - File not processing → Check browser console for errors
 * - Filename not recognized → Must contain "ปี" + year number
 */
function handleBillingImportFileProcess(file) {
  // STEP 1: Filename validation - Auto-detect year from filename
  // Example: "บิลปี69.xlsx" → year = 69
  // Pattern: Look for Thai character "ปี" followed by digits
  const yearMatch = file.name.match(/ปี(\d+)/);

  if (!yearMatch) {
    showBillingImportStatus('❌ ชื่อไฟล์ต้องมี "ปี" และตัวเลขปี เช่น "บิลปี69.xlsx" หรือ "บิลปี70 (2).xlsx"', 'error');
    return; // STOP: Cannot proceed without year
  }

  const yearInput = yearMatch[1];
  showBillingImportStatus(`✅ ตรวจพบปี ${yearInput} จากชื่อไฟล์`, 'success');

  // STEP 2: Start file loading
  showBillingImportStatus('⏳ กำลังโหลดไฟล์...', 'info');

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      showBillingImportStatus('⏳ กำลังประมวลผลข้อมูล...', 'info');

      // STEP 3: Async processing to prevent UI freeze
      // setTimeout allows browser to update UI between processing
      setTimeout(() => {
        try {
          // STEP 4: Read and parse Excel file
          const data = new Uint8Array(e.target.result);
          console.info('📥 Reading Excel file...', data.length, 'bytes');

          // XLSX library reads binary data and returns workbook object
          const workbook = XLSX.read(data, { type: 'array' });
          console.info('✅ Excel loaded:', workbook.SheetNames.length, 'sheets');

          const year = yearInput;
          console.info(`📊 Parsing billing data for year: ${year}`);

          // STEP 5: Detect file format version based on year
          // Year >= 70 (Thai year 2570+) = V2 format
          // Year < 70 = V3 format
          let monthlyData = [];
          const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;
          const yearNum = parseInt(year);
          const forceV2 = yearNum >= 70;

          // Process sheets with async breaks to avoid UI freeze
          let sheetIdx = startIdx;

          const processSheet = () => {
            if (sheetIdx >= workbook.SheetNames.length) {
              // Done processing all sheets
              finalizeBillingImport(monthlyData, year, forceV2);
              return;
            }

            const sheet = workbook.Sheets[workbook.SheetNames[sheetIdx]];
            const hasD43 = sheet['D43']?.v !== undefined;

            try {
              if (forceV2) {
                const result = parseSingleSheetV2(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              } else if (hasD43) {
                const result = parseSingleSheetV2(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              } else {
                const result = parseSingleSheetV1(sheet, sheetIdx - startIdx + 1, workbook.SheetNames[sheetIdx]);
                if (result) monthlyData.push(result);
              }
            } catch (sheetErr) {
              console.warn(`⚠️ Error processing sheet ${sheetIdx}:`, sheetErr.message);
            }

            sheetIdx++;

            // Process next sheet with tiny delay to allow UI refresh
            setTimeout(processSheet, 10);
          };

          processSheet();

        } catch (err) {
          showBillingImportStatus('❌ เกิดข้อผิดพลาดในการอ่านไฟล์: ' + err.message, 'error');
          console.error('File reading error:', err);
        }
      }, 50);

    } catch (err) {
      showBillingImportStatus('❌ เกิดข้อผิดพลาด: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// Helper: Finalize billing import after all sheets processed
function finalizeBillingImport(monthlyData, year, forceV2) {
  try {
    const parserMode = forceV2 ? '(V2 only)' : '(mixed V1/V2)';
    console.info(`📌 Year ${year}: Parsed ${monthlyData.length} months ${parserMode}`);

    if (!monthlyData || monthlyData.length === 0) {
      showBillingImportStatus('❌ ไม่พบข้อมูลบิล H32 ในไฟล์', 'error');
      return;
    }

    // Display preview
    displayBillingImportPreview(monthlyData, year);
    showBillingImportStatus(`✅ โหลดข้อมูลบิล ${monthlyData.length} เดือน สำหรับปี ${year} สำเร็จ`, 'success');

    // Store for approval
    window.pendingBillingData = {
      year: year,
      monthlyData: monthlyData
    };
  } catch (err) {
    showBillingImportStatus('❌ เกิดข้อผิดพลาดในการประมวลผล: ' + err.message, 'error');
    console.error('Finalization error:', err);
  }
}

// Helper: Parse single sheet with V1 format
function parseSingleSheetV1(worksheet, monthNum, sheetName) {
  // Rooms: D24=rent, J24=elec, P24=water, S2:S23=trash
  const roomsRent = parseFloat(worksheet['D24']?.v || 0) || 0;
  const roomsElec = parseFloat(worksheet['J24']?.v || 0) || 0;
  const roomsWater = parseFloat(worksheet['P24']?.v || 0) || 0;
  let roomsTrash = 0;
  for (let row = 2; row <= 23; row++) {
    roomsTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Amazon: D26=rent, J26=elec, P26=water, S26=trash
  const amazonRent = parseFloat(worksheet['D26']?.v || 0) || 0;
  const amazonElec = parseFloat(worksheet['J26']?.v || 0) || 0;
  const amazonWater = parseFloat(worksheet['P26']?.v || 0) || 0;
  const amazonTrash = parseFloat(worksheet['S26']?.v || 0) || 0;

  const totalRent = roomsRent + amazonRent;
  const totalElec = roomsElec + amazonElec;
  const totalWater = roomsWater + amazonWater;
  const totalTrash = roomsTrash + amazonTrash;
  const total = totalRent + totalElec + totalWater + totalTrash;

  if (total > 0) {
    return {
      month: monthNum,
      sheetName: sheetName,
      rent: totalRent,
      electricity: totalElec,
      water: totalWater,
      trash: totalTrash,
      total: total,
      breakdown: {
        rooms: { rent: roomsRent, elec: roomsElec, water: roomsWater, trash: roomsTrash, total: roomsRent + roomsElec + roomsWater + roomsTrash },
        nest: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        amazon: { rent: amazonRent, elec: amazonElec, water: amazonWater, trash: amazonTrash, total: amazonRent + amazonElec + amazonWater + amazonTrash }
      }
    };
  }
  return null;
}

// Helper: Parse single sheet with V2 format (with Nest building)
// Layout (June 69+):
//   Rows 2-23:  Rooms (22 ห้อง), summary at row 24
//   Rows 26-45: Nest (20 ห้อง N101-N405), summary at row 46
//   Row 47:     empty separator
//   Row 48:     ร้านใหญ่ (Amazon)
function parseSingleSheetV2(worksheet, monthNum, sheetName) {
  // Rooms: D24=total, J24=elec, P24=water, S2:S23=trash
  const roomsRent = parseFloat(worksheet['D24']?.v || 0) || 0;
  const roomsElec = parseFloat(worksheet['J24']?.v || 0) || 0;
  const roomsWater = parseFloat(worksheet['P24']?.v || 0) || 0;
  let roomsTrash = 0;
  for (let row = 2; row <= 23; row++) {
    roomsTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Nest: D46=total, J46=elec, P46=water, S26:S45=trash (20 rooms, summary row 46)
  const nestRent = parseFloat(worksheet['D46']?.v || 0) || 0;
  const nestElec = parseFloat(worksheet['J46']?.v || 0) || 0;
  const nestWater = parseFloat(worksheet['P46']?.v || 0) || 0;
  let nestTrash = 0;
  for (let row = 26; row <= 45; row++) {
    nestTrash += parseFloat(worksheet[`S${row}`]?.v || 0) || 0;
  }

  // Amazon/ร้านใหญ่: D48=rent, J48=elec, P48=water, S48=trash (row moved from 47→48 in June 69+)
  const amazonRent = parseFloat(worksheet['D48']?.v || 0) || 0;
  const amazonElec = parseFloat(worksheet['J48']?.v || 0) || 0;
  const amazonWater = parseFloat(worksheet['P48']?.v || 0) || 0;
  const amazonTrash = parseFloat(worksheet['S48']?.v || 0) || 0;

  // Total trash: S51 (shifted down 1 row from S50 due to Amazon moving to row 48)
  const totalTrash = parseFloat(worksheet['S51']?.v || 0) || parseFloat(worksheet['S50']?.v || 0) || 0;

  const totalRent = roomsRent + nestRent + amazonRent;
  const totalElec = roomsElec + nestElec + amazonElec;
  const totalWater = roomsWater + nestWater + amazonWater;
  const total = totalRent + totalElec + totalWater + totalTrash;

  if (total > 0) {
    return {
      month: monthNum,
      sheetName: sheetName,
      rent: totalRent,
      electricity: totalElec,
      water: totalWater,
      trash: totalTrash,
      total: total,
      breakdown: {
        rooms: { rent: roomsRent, elec: roomsElec, water: roomsWater, trash: roomsTrash, total: roomsRent + roomsElec + roomsWater + roomsTrash },
        nest: { rent: nestRent, elec: nestElec, water: nestWater, trash: nestTrash, total: nestRent + nestElec + nestWater + nestTrash },
        amazon: { rent: amazonRent, elec: amazonElec, water: amazonWater, trash: amazonTrash, total: amazonRent + amazonElec + amazonWater + amazonTrash }
      }
    };
  }
  return null;
}

function parseBillingExcelData(workbook) {
  const monthlyData = [];

  // Try to extract detailed data from each sheet (skip first sheet if it's template)
  const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;

  for (let idx = startIdx; idx < workbook.SheetNames.length; idx++) {
    const sheetName = workbook.SheetNames[idx];
    const worksheet = workbook.Sheets[sheetName];

    // Read individual cells for Rooms (row 24) and Amazon (row 26)
    const d24 = parseFloat(worksheet['D24']?.v || 0) || 0;  // Room rent
    const j24 = parseFloat(worksheet['J24']?.v || 0) || 0;  // Room electricity
    const p24 = parseFloat(worksheet['P24']?.v || 0) || 0;  // Room water

    const d26 = parseFloat(worksheet['D26']?.v || 0) || 0;  // Amazon rent
    const j26 = parseFloat(worksheet['J26']?.v || 0) || 0;  // Amazon electricity
    const p26 = parseFloat(worksheet['P26']?.v || 0) || 0;  // Amazon water

    // Read trash total from S29 (รวมค่าขยะ summary cell)
    const totalTrash = parseFloat(worksheet['S29']?.v || 0) || 0;

    // Calculate totals
    const totalRent = d24 + d26;
    const totalElec = j24 + j26;
    const totalWater = p24 + p26;
    const total = totalRent + totalElec + totalWater + totalTrash;

    if (total > 0) {
      monthlyData.push({
        month: idx - startIdx + 1,
        sheetName: sheetName,
        rent: totalRent,
        electricity: totalElec,
        water: totalWater,
        trash: totalTrash,
        total: total
      });
    }
  }

  return monthlyData;
}

// V2: For June 69 onwards (with Nest building + rooms rows)
function parseBillingExcelDataV2(workbook) {
  const monthlyData = [];

  // Skip first sheet if template (EX)
  const startIdx = workbook.SheetNames[0].toLowerCase() === 'ex' ? 1 : 0;

  for (let idx = startIdx; idx < workbook.SheetNames.length; idx++) {
    const sheetName = workbook.SheetNames[idx];
    const worksheet = workbook.Sheets[sheetName];

    // V2 Cell mapping for June onwards:
    // D43 = Nest rent, J43 = Nest elec, P43 = Nest water
    // D45 = Amazon rent, J45 = Amazon elec, P45 = Amazon water
    // S48 = Trash total

    const nestRent = parseFloat(worksheet['D43']?.v || 0) || 0;    // Nest rent
    const nestElec = parseFloat(worksheet['J43']?.v || 0) || 0;    // Nest electricity
    const nestWater = parseFloat(worksheet['P43']?.v || 0) || 0;   // Nest water

    const amazonRent = parseFloat(worksheet['D45']?.v || 0) || 0;  // Amazon rent
    const amazonElec = parseFloat(worksheet['J45']?.v || 0) || 0;  // Amazon electricity
    const amazonWater = parseFloat(worksheet['P45']?.v || 0) || 0; // Amazon water

    // Rooms: Sum D24:D26 (or detect from A24:A42 rows with N10x pattern)
    let roomsRent = 0, roomsElec = 0, roomsWater = 0;
    for (let row = 24; row <= 42; row++) {
      const d = worksheet[`D${row}`]?.v;
      const j = worksheet[`J${row}`]?.v;
      const p = worksheet[`P${row}`]?.v;
      if (d !== undefined) roomsRent += parseFloat(d) || 0;
      if (j !== undefined) roomsElec += parseFloat(j) || 0;
      if (p !== undefined) roomsWater += parseFloat(p) || 0;
    }

    // Trash total from S48
    const totalTrash = parseFloat(worksheet['S48']?.v || 0) || 0;

    // Calculate totals
    const totalRent = roomsRent + nestRent + amazonRent;
    const totalElec = roomsElec + nestElec + amazonElec;
    const totalWater = roomsWater + nestWater + amazonWater;
    const total = totalRent + totalElec + totalWater + totalTrash;

    if (total > 0) {
      monthlyData.push({
        month: idx - startIdx + 1,
        sheetName: sheetName,
        rent: totalRent,
        electricity: totalElec,
        water: totalWater,
        trash: totalTrash,
        total: total,
        breakdown: { rooms: roomsRent, nest: nestRent, amazon: amazonRent } // For debug
      });
    }
  }

  return monthlyData;
}

function displayBillingImportPreview(monthlyData, year) {
  const previewDiv = document.getElementById('billingPreviewData');
  const monthNames = ['มค', 'กพ', 'มีค', 'เมษา', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];

  let html = `<strong>ข้อมูลบิลปี ${year} (Rooms + Nest + Amazon):</strong><br>`;
  html += `<div style="font-family:'Sarabun',sans-serif;font-size:0.9rem;overflow-x:auto;margin-top:0.5rem;">`;
  html += `<table style="width:100%;border-collapse:collapse;">`;
  html += `<thead>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.8rem;text-align:left;border-right:1px solid var(--border);">เดือน</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};color:${DashColors.GREEN_DEEP};font-weight:700;">🏠 Rooms</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};color:#4a148c;font-weight:700;">🏢 Nest</th>
      <th colspan="5" style="padding:0.8rem;text-align:center;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};color:#f57f17;font-weight:700;">📦 Amazon</th>
      <th style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">รวม</th>
    </tr>
    <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
      <th style="padding:0.2rem;border-right:1px solid var(--border);"></th>
      <th class="dx-th-rooms">เช่า</th>
      <th class="dx-th-rooms">ไฟ</th>
      <th class="dx-th-rooms">น้ำ</th>
      <th class="dx-th-rooms">ขยะ</th>
      <th class="dx-th-rooms">รวม</th>
      <th class="dx-th-nest">เช่า</th>
      <th class="dx-th-nest">ไฟ</th>
      <th class="dx-th-nest">น้ำ</th>
      <th class="dx-th-nest">ขยะ</th>
      <th class="dx-th-nest">รวม</th>
      <th class="dx-th-amazon">เช่า</th>
      <th class="dx-th-amazon">ไฟ</th>
      <th class="dx-th-amazon">น้ำ</th>
      <th class="dx-th-amazon">ขยะ</th>
      <th class="dx-th-amazon">รวม</th>
      <th style="padding:0.2rem;text-align:right;font-size:0.8rem;color:var(--green);font-weight:700;">รวม</th>
    </tr>
  </thead>
  <tbody>`;

  let roomsRentSum = 0, roomsElecSum = 0, roomsWaterSum = 0, roomsTrashSum = 0, roomsTotal = 0;
  let nestRentSum = 0, nestElecSum = 0, nestWaterSum = 0, nestTrashSum = 0, nestTotal = 0;
  let amazonRentSum = 0, amazonElecSum = 0, amazonWaterSum = 0, amazonTrashSum = 0, amazonTotal = 0;
  let yearlyTotal = 0;

  monthlyData.forEach(m => {
    const bd = m.breakdown || {};
    const rooms = bd.rooms || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
    const nest = bd.nest || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
    const amazon = bd.amazon || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };

    const monthName = monthNames[m.month - 1] || `เดือน${m.month}`;
    html += `<tr style="border-bottom:1px solid var(--border);">`;
    html += `<td style="padding:0.5rem;text-align:left;border-right:1px solid var(--border);">${monthName}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};">฿${(rooms.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};">฿${(rooms.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};">฿${(rooms.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};">฿${(rooms.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.GREEN_BG};font-weight:600;">฿${(rooms.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};">฿${(nest.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};">฿${(nest.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};">฿${(nest.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};">฿${(nest.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.PURPLE_BG};font-weight:600;">฿${(nest.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};">฿${(amazon.rent||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};">฿${(amazon.elec||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};">฿${(amazon.water||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};">฿${(amazon.trash||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;border-right:1px solid var(--border);background:${DashColors.YELLOW_BG};font-weight:600;">฿${(amazon.total||0).toLocaleString()}</td>`;
    html += `<td style="padding:0.5rem;text-align:right;font-weight:600;color:var(--green);">฿${m.total.toLocaleString()}</td>`;
    html += `</tr>`;

    roomsRentSum += rooms.rent||0;
    roomsElecSum += rooms.elec||0;
    roomsWaterSum += rooms.water||0;
    roomsTrashSum += rooms.trash||0;
    roomsTotal += rooms.total||0;
    nestRentSum += nest.rent||0;
    nestElecSum += nest.elec||0;
    nestWaterSum += nest.water||0;
    nestTrashSum += nest.trash||0;
    nestTotal += nest.total||0;
    amazonRentSum += amazon.rent||0;
    amazonElecSum += amazon.elec||0;
    amazonWaterSum += amazon.water||0;
    amazonTrashSum += amazon.trash||0;
    amazonTotal += amazon.total||0;
    yearlyTotal += m.total;
  });

  html += `  </tbody>
  <tfoot>
    <tr style="background:var(--bg-secondary);border-top:2px solid var(--border);font-weight:700;">
      <td style="padding:0.8rem;border-right:1px solid var(--border);">รวมทั้งปี</td>
      <td class="dx-td-rooms">฿${roomsRentSum.toLocaleString()}</td>
      <td class="dx-td-rooms">฿${roomsElecSum.toLocaleString()}</td>
      <td class="dx-td-rooms">฿${roomsWaterSum.toLocaleString()}</td>
      <td class="dx-td-rooms">฿${roomsTrashSum.toLocaleString()}</td>
      <td class="dx-td-rooms">฿${roomsTotal.toLocaleString()}</td>
      <td class="dx-td-nest">฿${nestRentSum.toLocaleString()}</td>
      <td class="dx-td-nest">฿${nestElecSum.toLocaleString()}</td>
      <td class="dx-td-nest">฿${nestWaterSum.toLocaleString()}</td>
      <td class="dx-td-nest">฿${nestTrashSum.toLocaleString()}</td>
      <td class="dx-td-nest">฿${nestTotal.toLocaleString()}</td>
      <td class="dx-td-amazon">฿${amazonRentSum.toLocaleString()}</td>
      <td class="dx-td-amazon">฿${amazonElecSum.toLocaleString()}</td>
      <td class="dx-td-amazon">฿${amazonWaterSum.toLocaleString()}</td>
      <td class="dx-td-amazon">฿${amazonTrashSum.toLocaleString()}</td>
      <td class="dx-td-amazon">฿${amazonTotal.toLocaleString()}</td>
      <td style="padding:0.8rem;text-align:right;color:var(--green);font-weight:700;">฿${yearlyTotal.toLocaleString()}</td>
    </tr>
  </tfoot>
  </table>
  </div>`;

  previewDiv.innerHTML = html;
  document.getElementById('billingResultsSection').classList.remove('u-hidden');
}

// Handle billing import data that comes from meter import flow (V1/V2 billing format)
async function approveBillingImportDataFromMeter(importData, matchResults) {
  console.info('💾 Processing billing data import to localStorage', { importData, matchResults });

  try {
    const year = importData.year;
    const month = importData.month;
    const roomsData = importData.rooms || {};

    // Convert meter readings to billing amounts
    // For V1/V2 billing format: eNew/eOld are electricity, wNew/wOld are water
    // Create monthly breakdown
    const monthlyData = [{
      rent: 0,
      electricity: 0,
      water: 0,
      trash: 0,
      total: 0,
      breakdown: {
        rooms: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        nest: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 },
        amazon: { rent: 0, elec: 0, water: 0, trash: 0, total: 0 }
      }
    }];

    // Process room data based on building
    const building = importData.building || 'rooms';
    if (building === 'rooms' || building === 'all') {
      // For Rooms building, eNew/eOld are electricity, wNew/wOld are water
      for (let roomNum in roomsData) {
        const room = roomsData[roomNum];
        const elecUsage = Math.abs(room.eNew - room.eOld) || 0;
        const waterUsage = Math.abs(room.wNew - room.wOld) || 0;

        // Simple calculation: multiply usage by assumed rates (can be refined)
        const elecCharge = elecUsage * 5; // ฿5 per unit
        const waterCharge = waterUsage * 10; // ฿10 per unit
        const trash = 50; // Fixed trash fee per room
        const rent = 1500; // Default rent (can be retrieved from data if available)

        const roomTotal = elecCharge + waterCharge + trash + rent;

        // Add to Rooms building breakdown
        monthlyData[0].breakdown.rooms.elec += elecCharge;
        monthlyData[0].breakdown.rooms.water += waterCharge;
        monthlyData[0].breakdown.rooms.trash += trash;
        monthlyData[0].breakdown.rooms.rent += rent;
        monthlyData[0].breakdown.rooms.total += roomTotal;
      }
    }

    // Update totals
    monthlyData[0].rent = monthlyData[0].breakdown.rooms.rent + monthlyData[0].breakdown.nest.rent + monthlyData[0].breakdown.amazon.rent;
    monthlyData[0].electricity = monthlyData[0].breakdown.rooms.elec + monthlyData[0].breakdown.nest.elec + monthlyData[0].breakdown.amazon.elec;
    monthlyData[0].water = monthlyData[0].breakdown.rooms.water + monthlyData[0].breakdown.nest.water + monthlyData[0].breakdown.amazon.water;
    monthlyData[0].trash = monthlyData[0].breakdown.rooms.trash + monthlyData[0].breakdown.nest.trash + monthlyData[0].breakdown.amazon.trash;
    monthlyData[0].total = monthlyData[0].rent + monthlyData[0].electricity + monthlyData[0].water + monthlyData[0].trash;

    // Create months array for this year
    const months = monthlyData.map(m => ({
      total: [m.rent, m.electricity, m.water, m.trash, m.total],
      rooms: [m.breakdown.rooms.rent, m.breakdown.rooms.elec, m.breakdown.rooms.water, m.breakdown.rooms.trash, m.breakdown.rooms.total],
      nest: [m.breakdown.nest.rent, m.breakdown.nest.elec, m.breakdown.nest.water, m.breakdown.nest.trash, m.breakdown.nest.total],
      amazon: [m.breakdown.amazon.rent, m.breakdown.amazon.elec, m.breakdown.amazon.water, m.breakdown.amazon.trash, m.breakdown.amazon.total]
    }));

    const yearPayload = {
      label: `ปี ${2500 + parseInt(year)} (${year})`,
      months: months
    };

    // Phase 2c: dual-write local + Firestore (persist across devices)
    if (typeof HistoricalDataStore !== 'undefined') {
      await HistoricalDataStore.setYear(year, yearPayload);
    } else {
      const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
      historicalData[year] = yearPayload;
      localStorage.setItem('HISTORICAL_DATA', JSON.stringify(historicalData));
    }

    showImportStatus(`✅ บันทึกข้อมูลบิลปี ${year} (${months.length} เดือน) → ☁️ Firestore สำเร็จ!`, 'success');

    // Clean up and refresh
    setTimeout(() => {
      cancelImportProcess();
      if (typeof initDashboardCharts === 'function') {
        initDashboardCharts();
      }
    }, 1000);

  } catch (error) {
    showImportStatus(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
    console.error('Error processing billing data:', error);
  }
}

async function approveBillingImportData() {
  if (!window.pendingBillingData) {
    showBillingImportStatus('❌ ไม่มีข้อมูลที่รออนุมัติ', 'error');
    return;
  }

  try {
    const { year, monthlyData } = window.pendingBillingData;

    if (!monthlyData || !Array.isArray(monthlyData) || monthlyData.length === 0) {
      showBillingImportStatus('❌ ข้อมูลเดือนไม่ถูกต้องหรือเป็นช่วง', 'error');
      return;
    }

    // Create HISTORICAL_DATA structure with detailed breakdown (rooms, nest, amazon)
    const months = monthlyData.map(m => {
      // Ensure m is an object with default values
      if (!m || typeof m !== 'object') {
        return {
          total: [0, 0, 0, 0, 0],
          rooms: [0, 0, 0, 0, 0],
          nest: [0, 0, 0, 0, 0],
          amazon: [0, 0, 0, 0, 0]
        };
      }

      const bd = m.breakdown || {};
      const rooms = bd.rooms || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
      const nest = bd.nest || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };
      const amazon = bd.amazon || { rent: 0, elec: 0, water: 0, trash: 0, total: 0 };

      return {
        total: [m.rent || 0, m.electricity || 0, m.water || 0, m.trash || 0, m.total || 0],
        rooms: [rooms.rent || 0, rooms.elec || 0, rooms.water || 0, rooms.trash || 0, rooms.total || 0],
        nest: [nest.rent || 0, nest.elec || 0, nest.water || 0, nest.trash || 0, nest.total || 0],
        amazon: [amazon.rent || 0, amazon.elec || 0, amazon.water || 0, amazon.trash || 0, amazon.total || 0]
      };
    });

  const yearPayload = {
    label: `ปี ${2500 + parseInt(year)} (${year})`,
    months: months
  };

  // Phase 2c: dual-write local + Firestore historicalRevenue/{year}
  if (typeof HistoricalDataStore !== 'undefined') {
    await HistoricalDataStore.setYear(year, yearPayload);
  } else {
    const historicalData = JSON.parse(localStorage.getItem('HISTORICAL_DATA') || '{}');
    historicalData[year] = yearPayload;
    localStorage.setItem('HISTORICAL_DATA', JSON.stringify(historicalData));
  }

  showBillingImportStatus(`✅ บันทึกข้อมูลบิลปี ${year} (${months.length} เดือน) → ☁️ Firestore สำเร็จ!`, 'success');

  // Reload dashboard charts with new data
  showBillingImportStatus(`✅ กำลังอัพเดทข้อมูล...`, 'info');

  setTimeout(async () => {
    try {
      cancelBillingImportProcess();

      // Reload dashboard charts (await for completion)
      if (typeof initDashboardCharts === 'function') {
        console.info('🔄 Updating dashboard charts...');
        await initDashboardCharts();
        console.info('✅ Dashboard charts updated');
      }

      // Refresh historical data display
      if (typeof initHistoricalDataDisplay === 'function') {
        console.info('🔄 Updating historical data display...');
        initHistoricalDataDisplay();
        console.info('✅ Historical data display updated');
      }

      // Navigate to HISTORICAL_DATA page to show the imported data
      showBillingImportStatus(`✅ บันทึกข้อมูลและอัพเดทสำเร็จ!`, 'success');

      // Navigate to meter page to show the imported data in HISTORICAL_DATA
      setTimeout(() => {
        console.info('🔄 Navigating to HISTORICAL_DATA page...');
        // Find the meter page button and click it to navigate
        const meterPageBtn = document.querySelector('[onclick*="\'meter\'"]');
        if (meterPageBtn) {
          meterPageBtn.click();
          console.info('✅ Navigated to meter page');
        } else {
          console.warn('⚠️ Could not find meter page button, using window.showPage');
          if (typeof window.showPage === 'function') {
            window.showPage('meter');
          }
        }
      }, 1000);

    } catch (error) {
      console.error('❌ Error during billing import refresh:', error);
      showBillingImportStatus(`❌ เกิดข้อผิดพลาดขณะอัพเดท: ${error.message}`, 'error');
    }
  }, 500);
  } catch (error) {
    showBillingImportStatus(`❌ เกิดข้อผิดพลาด: ${error.message}`, 'error');
    console.error('Error in approveBillingImportData:', error);
  }
}

function cancelBillingImportProcess() {
  const fileInput = document.getElementById('billingFileInput');
  const resultsSection = document.getElementById('billingResultsSection');
  const previewData = document.getElementById('billingPreviewData');
  const statusMsg = document.getElementById('billingStatusMessage');

  if (fileInput) fileInput.value = '';
  if (resultsSection) resultsSection.classList.add('u-hidden');
  if (previewData) previewData.innerHTML = '';
  if (statusMsg) statusMsg.innerHTML = '';
  window.pendingBillingData = null;
}

function showBillingImportStatus(message, type) {
  const statusDiv = document.getElementById('billingStatusMessage');
  let bgColor = 'var(--accent-light)';
  let borderColor = 'var(--accent)';

  if (type === 'success') {
    bgColor = DashColors.GREEN_BG;
    borderColor = DashColors.GREEN_DARK;
  } else if (type === 'error') {
    bgColor = DashColors.RED_BG;
    borderColor = DashColors.RED_DEEP;
  }

  statusDiv.innerHTML = `<div style="padding:0.8rem;background:${bgColor};border:1px solid ${borderColor};border-radius:var(--radius-sm);color:var(--text);">${message}</div>`;
}

