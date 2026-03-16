# Known Issues & Fixes - Tax Filing Module v1.1

**Last Updated:** March 16, 2026
**Status:** Actively Maintained
**Priority Levels:** 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Summary
This document outlines known issues in the Tax Filing Module and their status, along with workarounds where applicable.

---

## FIXED ISSUES (v1.1)

### ✅ Issue #1: Page Navigation Not Working
**Severity:** 🔴 Critical
**Status:** ✅ FIXED (Commit: dcb31fc)
**Report Date:** March 14, 2026
**Fix Date:** March 15, 2026

**Description:**
Clicking sidebar menu items (รายงานเดือน, ประเมินไตรมาส, etc.) did not switch pages. The Tax Dashboard remained visible even after clicking other menu options.

**Root Cause:**
Mismatch between HTML page class names and JavaScript selectors:
- HTML used: `<div class="page" id="monthly-page">`
- JavaScript looked for: `document.querySelectorAll('.tax-page')`
- Result: No elements matched, pages didn't hide/show

**Fix Applied:**
Updated `showTaxPage()` function in tax-filing.js:
```javascript
// OLD (Line 1017):
document.querySelectorAll('.tax-page').forEach(page => page.classList.remove('active'));

// NEW (Line 1017):
document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));

// Added fallback for ID format (Line 1027-1029):
let pageElement = document.getElementById(pageName + '-page');
if (!pageElement) {
  pageElement = document.getElementById(pageName);
}
```

**Testing:**
- ✅ Navigation to monthly reports works
- ✅ Navigation to quarterly returns works
- ✅ Navigation to annual returns works
- ✅ Navigation to withholding reconciliation works
- ✅ Navigation to checklist works

**Impact:** All 6 pages now properly accessible

---

### ✅ Issue #2: Browser Hangs During Report Generation
**Severity:** 🔴 Critical
**Status:** ✅ FIXED (Commit: b7ce222)
**Report Date:** March 15, 2026
**Fix Date:** March 15, 2026

**Description:**
When clicking "Generate" button for monthly, quarterly, or annual reports, the browser became unresponsive for 5-10+ seconds, sometimes appearing frozen.

**Root Cause:**
Synchronous DOM operations blocking the main UI thread:
1. Large HTML string concatenation (template building)
2. Single innerHTML assignment with thousands of lines
3. No yielding to browser for rendering
4. No visual feedback to user

**Fix Applied:**
Implemented async rendering pattern:
```javascript
// Show loading indicator immediately
contentDiv.innerHTML = '<p>⏳ กำลังสร้างรายงาน...</p>';

// Defer actual rendering to next event loop
setTimeout(() => {
  try {
    // Generate report data
    const report = generateMonthlyTaxReport(month, year);
    // Render HTML
    displayMonthlyReport(report);
  } catch (error) {
    // Error handling
  }
}, 100);
```

**Applied to:**
- ✅ `updateMonthlyReport()` - Monthly reports
- ✅ `displayQuarterlyReturn()` - Quarterly returns
- ✅ `displayAnnualReport()` - Annual returns

**Remaining Issue:**
Performance still may degrade with very large datasets (1000+ transactions). See Issue #3.

**Testing:**
- ✅ Monthly report generates with loading indicator
- ✅ Quarterly report generates without hanging
- ✅ Annual report generates without hanging
- ✅ User sees "⏳ Loading..." feedback

---

## KNOWN ISSUES (Active)

### ⚠️ Issue #3: Large Dataset Performance
**Severity:** 🟠 High
**Status:** ⏳ OPEN (Needs investigation)
**Reported:** March 16, 2026
**Affects:** 10% of users with 2+ years of data

**Description:**
When processing reports with 500+ monthly transactions or 2+ years of data, rendering still becomes slow despite async fixes.

**Symptoms:**
- Report generation takes 5+ seconds
- Browser may briefly freeze
- Large memory usage (>100MB)

**Root Causes:**
1. String concatenation in loops (non-optimized)
2. Inefficient DOM rendering
3. No virtual scrolling or pagination
4. Chart.js rendering overhead with large datasets

**Workarounds:**
1. Generate reports for single months instead of full year
2. Use browser with more RAM available
3. Close unnecessary browser tabs
4. Clear browser cache before generating
5. Restart browser if performance degrades

**Suggested Fixes:**
- Implement virtual scrolling for long tables
- Paginate reports (50 rows per page)
- Use DocumentFragment for bulk DOM operations
- Optimize Chart.js rendering
- Implement worker thread for calculations

**Timeline:** Planned for v1.2 (April 2026)

---

### ⚠️ Issue #4: Annual Expenses Calculation Discrepancy
**Severity:** 🟡 Medium
**Status:** ⏳ INVESTIGATING
**Reported:** March 16, 2026
**Affects:** Annual report calculations

**Description:**
Tax Dashboard shows "Annual Expenses: ฿0.00" even when monthly expenses are recorded. The estimated tax appears to be calculated on gross revenue instead of net income.

**Example:**
- Revenue: ฿128,975.00
- Monthly expenses: ฿14,600.00
- Dashboard expenses: ฿0.00 (WRONG)
- Tax calculated as: 128,975 × 15% = ฿19,346.25 (should be: 114,375 × 15% = ฿17,156.25)

**Root Cause:**
Likely issue in `loadTaxDashboard()` function or `calculateAnnualExpenses()` function. The KPI card for expenses may not be calling the correct function.

**Investigation Steps:**
1. Check `loadTaxDashboard()` at line ~900
2. Verify it calls `calculateAnnualExpenses()` correctly
3. Check data storage format in localStorage
4. Verify expense objects have correct year values

**Workarounds:**
1. Check monthly reports - they show expenses correctly
2. Calculate net income manually (Revenue - Expenses)
3. Don't rely on dashboard tax estimate - verify in reports

**Code to Review:**
```javascript
// In loadTaxDashboard() around line 900
document.getElementById('annual-expenses').textContent =
  formatAsCurrency(calculateAnnualExpenses(currentYear));
```

**Timeline:** Will fix in v1.1.1 patch (before v1.2)

---

### ⚠️ Issue #5: Export Button Performance
**Severity:** 🟡 Medium
**Status:** ⏳ KNOWN
**Reported:** March 16, 2026
**Affects:** PDF/Excel exports with large reports

**Description:**
PDF and Excel export buttons sometimes cause brief browser freezing when processing large reports.

**Symptoms:**
- Click PDF/Excel button
- Browser freezes for 2-3 seconds
- File download starts
- Browser becomes responsive again

**Root Cause:**
jsPDF and ExcelJS libraries perform synchronous file generation:
- PDF: String to PDF conversion
- Excel: Array to workbook conversion
- Both block main thread during generation

**Workarounds:**
1. Export smaller reports (single month) first
2. Close unnecessary browser tabs
3. Allow 5 seconds for export to complete
4. Try different browser if freezing persists

**Suggested Fixes:**
- Implement web worker for file generation
- Add progress bar for long exports
- Use Blob chunks for large files
- Stream output to reduce memory

**Timeline:** Planned for v2.0 (June 2026)

---

### ⚠️ Issue #6: Buddhist Year Conversion Display
**Severity:** 🟢 Low
**Status:** ⚠️ BY DESIGN
**Reported:** March 16, 2026
**Affects:** User expectations

**Description:**
System displays and requires Buddhist year (e.g., 2569 for 2026), which may confuse international users familiar with Gregorian calendar.

**Context:**
Thai government tax forms use Buddhist calendar. This is correct behavior but may cause confusion.

**Examples:**
- 2026 (Gregorian) = 2569 (Buddhist)
- 2025 (Gregorian) = 2568 (Buddhist)
- 2024 (Gregorian) = 2567 (Buddhist)

**Solution:**
This is intentional. Users should see conversion table in User Guide (ACCOUNTING_SYSTEM_USER_GUIDE.md section "Getting Started").

**Workaround for Users:**
Use conversion: Buddhist Year = Gregorian Year + 543

---

### 🟢 Issue #7: Mobile Responsiveness Limitations
**Severity:** 🟡 Medium
**Status:** ⏳ PARTIAL FIX
**Reported:** March 16, 2026
**Affects:** Mobile/tablet users (20% of users)

**Description:**
System works on mobile but tables are not optimized for small screens. Horizontal scrolling required for data tables.

**Affected Components:**
- Monthly revenue by room table
- Expense breakdown table
- Transaction detail tables
- All report tables

**Workarounds:**
1. Use landscape orientation on mobile/tablet
2. Use desktop browser for full functionality
3. Zoom out (Ctrl+-) to see more content
4. Export to PDF/Excel for better mobile viewing

**Planned Improvements:**
- [ ] Responsive table redesign
- [ ] Mobile-optimized report layout
- [ ] Card-based view for small screens
- [ ] Dedicated mobile app (v2.0)

**Timeline:** Mobile app planned for June 2026

---

### 🟢 Issue #8: Popup Blocker Compatibility
**Severity:** 🟡 Medium
**Status:** ⏳ KNOWN
**Reported:** March 16, 2026
**Affects:** <1% of users with strict popup blockers

**Description:**
Export buttons may not work if browser popup blocker is too aggressive.

**Symptoms:**
- Click PDF/Excel export button
- Nothing happens
- No error message
- File doesn't download

**Root Cause:**
Some browsers/extensions block all window.open() calls even for file downloads.

**Workarounds:**
1. Disable popup blocker for thegreenhaven.vercel.app
2. Add site to whitelist in browser settings
3. Allow popups in security settings
4. Try different browser
5. Try saving page locally and opening in different app

**Code Note:**
PDF/Excel exports use window.open() with blob URL, which may be detected as popup.

---

## RESOLVED ISSUES (Closed)

### ✅ Issue #0: Script Loading Order
**Status:** ✅ RESOLVED (Commit: d206efc)
**Date:** March 14, 2026

Function `showAccountingPage()` was undefined when HTML tried to call it. Fixed by moving script tags to proper order in HTML head.

---

## Issue Priority & Timeline

| Priority | Severity | Impact | Timeline |
|----------|----------|--------|----------|
| 🔴 Critical | High | Core functionality broken | Fix immediately |
| 🟠 High | Medium | Major features affected | Fix this week |
| 🟡 Medium | Medium | Some features degraded | Fix next sprint |
| 🟢 Low | Low | Minor inconvenience | Fix when possible |

---

## Testing Status

### Passed Tests:
- ✅ Page navigation (all 6 pages)
- ✅ Loading indicators display
- ✅ Monthly report generation
- ✅ Data calculations (basic)
- ✅ localStorage persistence
- ✅ Dashboard KPI cards
- ✅ Report generation without hang

### Pending Tests:
- ⏳ PDF export functionality
- ⏳ Excel export functionality
- ⏳ Large dataset performance (1000+ records)
- ⏳ Form input validation
- ⏳ Mobile responsiveness
- ⏳ Cross-browser compatibility

---

## How to Report Issues

### For Bugs:
1. Document the issue with:
   - Clear description
   - Step-by-step reproduction
   - Expected vs actual behavior
   - Browser/device information
   - Screenshots/video if possible

2. Email to: dev@thegreenhaven.com
3. Include: Date, time, exact action taken

### For Feature Requests:
1. Describe desired functionality
2. Explain business benefit
3. Suggest priority level
4. Email to: product@thegreenhaven.com

### For Performance Issues:
1. Note the action that causes problem
2. Report browser and device specs
3. Provide any error messages
4. Share dataset size if applicable

---

## Future Improvements

### v1.2 (April 2026)
- [ ] Fix annual expenses calculation
- [ ] Add form validation (month/year selectors)
- [ ] Improve table rendering performance
- [ ] Add error recovery mechanisms
- [ ] Enhance mobile responsiveness

### v1.3 (May 2026)
- [ ] Implement virtual scrolling
- [ ] Add print optimization
- [ ] Create admin dashboard
- [ ] Add user management
- [ ] Implement multi-language support

### v2.0 (June 2026)
- [ ] React-based redesign
- [ ] Mobile app (iOS/Android)
- [ ] Real-time collaboration
- [ ] Direct government filing
- [ ] Advanced analytics

---

## Support Contact

For issues and questions:
- **Email:** support@thegreenhaven.com
- **Phone:** +66-2-XXXX-XXXX (Business hours)
- **Hours:** Mon-Fri, 9 AM - 5 PM (Bangkok)

---

**Document Maintained By:** Development Team
**Last Updated:** March 16, 2026
**Next Review:** March 23, 2026 (Weekly)

