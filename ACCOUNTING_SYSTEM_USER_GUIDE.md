# The Green Haven - Tax Filing System User Guide
## ระบบยื่นแบบประเมินภาษี สำหรับ สรรพากร

**Version:** 1.0
**Last Updated:** March 16, 2026
**Language:** Thai/English Bilingual

---

## 📋 Table of Contents
1. [System Overview](#system-overview)
2. [Getting Started](#getting-started)
3. [User Roles](#user-roles)
4. [Key Features](#key-features)
5. [How to Use](#how-to-use)
6. [Tax Reports & Exports](#tax-reports--exports)
7. [Troubleshooting](#troubleshooting)
8. [Contact Support](#contact-support)

---

## System Overview

The Tax Filing System is a comprehensive web-based application designed to help The Green Haven apartment rental company manage and submit tax documents to the Thai Revenue Department (สรรพากร) efficiently.

### Key Capabilities:
- **Real-time revenue tracking** from tenant payments (rent, electricity, water)
- **Expense management** (contractor labor, housekeeping, utilities, common area)
- **Automatic tax calculations** based on Thai tax regulations
- **Multiple report formats:**
  - Monthly Tax Reports (รายงานเดือน)
  - Quarterly Returns (แบบประเมิน ป.พ.6)
  - Annual Returns (แบบประเมิน ภ.ป.ภ. 50)
- **Export capabilities:** PDF, Excel formats
- **Audit trail logging** for compliance and verification

---

## Getting Started

### System Requirements:
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- User account (Admin or Accountant role)

### Accessing the System:
```
1. Navigate to: https://the-green-haven.vercel.app
2. Click "บัญชี" (Accountant) tab on login screen
3. Enter credentials
4. Click "เข้าสู่ระบบ" (Login)
5. Select "ยื่นแบบประเมิน" (Tax Filing) from sidebar
```

### Initial Setup:
The system uses data from your Accounting Module:
- Bills/Revenue data (from tenant payments)
- Expense records (contractor, maintenance, utilities)
- All historical data is automatically synchronized

---

## User Roles

### Admin Role
- **Permissions:** Full access to all features
- **Responsibilities:**
  - System configuration
  - User management
  - Data validation
  - Report verification

### Accountant Role ⭐ (Primary Tax User)
- **Permissions:** Create and export tax reports
- **Responsibilities:**
  - Generate monthly tax reports
  - Prepare quarterly and annual returns
  - Reconcile withholding taxes
  - Submit documents to Revenue Department
  - Track filing deadlines

---

## Key Features

### 1. Tax Dashboard
**Path:** Sidebar → Tax Filing → Tax Dashboard (Default Page)

**What you see:**
- 📊 Annual Revenue (รายได้ปี)
- 📉 Annual Expenses (ค่าใช้จ่ายปี)
- 💰 Net Income (กำไรสุทธิ)
- 🏛️ Estimated Tax (ประมาณภาษี)
- 📈 12-month revenue trend chart
- 🥧 Expense breakdown pie chart
- 📅 Filing deadline timeline

**How to use:**
- View at-a-glance financial summary
- Identify revenue patterns
- Monitor tax liability
- Check upcoming filing deadlines

---

### 2. Monthly Tax Reports (รายงานเดือน)

**Path:** Sidebar → Tax Filing → รายงานเดือน

**What it shows:**
- Monthly revenue breakdown by room
- Monthly expenses by category
- Withholding tax (หัก ณ ที่จ่าย) details
- Net profit for the month
- Report status (Draft/Ready/Submitted)

**How to generate:**
1. Click "รายงานเดือน" in sidebar
2. Select month from dropdown (default: March)
3. Select year (Buddhist calendar, e.g., 2569 for 2026)
4. Click "สร้าง" (Generate)
5. View report or export as PDF/Excel

**When to use:**
- Monthly bookkeeping records
- Identifying trend changes
- Tracking deductible expenses
- Archival documentation

---

### 3. Quarterly Tax Returns (ป.พ.6)

**Path:** Sidebar → Tax Filing → ประเมินไตรมาส

**What it includes:**
- 3-month aggregate revenue and expenses
- Taxable income calculation
- Estimated tax liability
- Payment due date
- Signature line for authorization

**How to generate:**
1. Click "ประเมินไตรมาส" in sidebar
2. Click quarter button (Q1, Q2, Q3, or Q4)
3. System automatically aggregates 3-month data
4. Review and export as PDF for submission

**Filing deadlines (Thai Tax Year):**
- Q1 (Jan-Mar): Due by April 15
- Q2 (Apr-Jun): Due by July 15
- Q3 (Jul-Sep): Due by October 15
- Q4 (Oct-Dec): Due by January 15 (next year)

---

### 4. Annual Tax Return (ภ.ป.ภ. 50)

**Path:** Sidebar → Tax Filing → ประเมินประจำปี

**What it contains:**
- Complete financial statement (12 months)
- Income statement (revenue - expenses = income)
- Tax calculation details
- Withholding tax summary
- Final balance due/refundable

**How to generate:**
1. Click "ประเมินประจำปี" in sidebar
2. Select tax year (Buddhist calendar)
3. Click "สร้าง" (Generate)
4. Review all sections:
   - Financial Summary
   - Tax Calculation
   - Filing Deadline & Form Type
5. Export to PDF for submission

**Annual Filing Deadline:** March 31 (for previous tax year)

---

### 5. Withholding Tax Reconciliation (ตรวจสอบหัก ณ ที่จ่าย)

**Path:** Sidebar → Tax Filing → ตรวจสอบหัก ณ ที่จ่าย

**What it shows:**
- Withholding taxes paid to contractors
- Comparison: Expected vs. Actual
- Discrepancies flagged for review
- Status indicators

**How to use:**
1. Click "ตรวจสอบหัก ณ ที่จ่าย" in sidebar
2. Review withholding payment summary
3. Verify all contractor payments are recorded
4. Flag any discrepancies
5. Generate withholding certificate (ใบหัก ณ ที่จ่าย) if needed

**Important:** Contractors must receive withholding certificates annually

---

### 6. Tax Filing Checklist (เช็คลิสต์ยื่นแบบประเมิน)

**Path:** Sidebar → Tax Filing → เช็คลิสต์ยื่นแบบประเมิน

**Checklist items:**
- ☐ Monthly reports completed
- ☐ Quarterly returns verified
- ☐ Annual return prepared
- ☐ Withholding taxes reconciled
- ☐ All documents exported
- ☐ Ready for submission
- ☐ Submitted to Revenue Department

**How to use:**
1. Review checklist on this page
2. Mark items as complete
3. Use as submission timeline
4. Track compliance status

---

## How to Use

### Step 1: Review Dashboard
```
Start → Tax Dashboard
- Check annual summary
- Identify any issues
- Note upcoming deadlines
```

### Step 2: Generate Monthly Reports
```
Every month:
1. Go to รายงานเดือน
2. Select current month
3. Click Generate
4. Review for accuracy
5. Save to archive
```

### Step 3: Prepare Quarterly Returns
```
End of each quarter:
1. Go to ประเมินไตรมาส
2. Select quarter
3. Generate and review
4. Export to PDF
5. Prepare for submission
```

### Step 4: File Annual Return
```
By March 31:
1. Go to ประเมินประจำปี
2. Select tax year
3. Generate annual return
4. Verify all data
5. Export to PDF
6. Submit to สรรพากร
```

---

## Tax Reports & Exports

### Exporting Reports

#### PDF Export (นำออกเป็น PDF)
- Professional format for official submission
- Includes company information and signature lines
- Suitable for government filing
- Can be printed or emailed

**How to export:**
1. Generate report (monthly/quarterly/annual)
2. Click "PDF" button
3. Browser downloads file automatically
4. File naming: `TaxReport_[Month]_[Year].pdf`

#### Excel Export (นำออกเป็น Excel)
- Editable spreadsheet format
- Useful for data analysis
- Can be shared with auditors/accountants
- Allows for additional calculations

**How to export:**
1. Generate report
2. Click "Excel" button
3. Download spreadsheet file
4. Open in Microsoft Excel or Google Sheets

### File Organization Recommendation:
```
The Green Haven - Tax Documents
├── 2026 (Tax Year)
│   ├── Monthly Reports
│   │   ├── January.pdf
│   │   ├── February.pdf
│   │   └── ...
│   ├── Quarterly Returns
│   │   ├── Q1_2026.pdf
│   │   ├── Q2_2026.pdf
│   │   └── ...
│   ├── Annual
│   │   └── Annual_Return_2026.pdf
│   └── Supporting Documents
│       ├── Withholding Certificates
│       └── Expense Receipts
```

---

## Troubleshooting

### Issue: Dashboard shows ฿0.00 for all values

**Cause:** No bills or expense data in the accounting system

**Solution:**
1. Go to Accounting Module
2. Ensure bills are created and marked as "paid"
3. Verify expense records exist
4. Return to Tax Dashboard and refresh (F5)

### Issue: Report generation is slow or unresponsive

**Cause:** Large dataset or browser performance issue

**Solution:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Close other browser tabs
3. Try a different browser
4. Use smaller date range if possible
5. Contact support if problem persists

### Issue: Export button not working

**Cause:** Browser popup blocker or missing library

**Solution:**
1. Allow popups for this website in browser settings
2. Ensure JavaScript is enabled
3. Try different browser
4. Try exporting a simpler report first

### Issue: Year field showing Buddhist year but I want Gregorian

**Note:** The system uses Buddhist calendar years (Gregorian + 543):
- 2026 = 2569 (Buddhist)
- 2025 = 2568 (Buddhist)
- 2024 = 2567 (Buddhist)

This is standard for Thai government forms.

---

## Common Tax Rates & Thresholds

### Corporate Income Tax (Thailand 2026)
- **Standard Rate:** 15%
- **Withholding on Contractors:** 10%
- **Withholding on Services:** 10%

### Deductible Expenses:
✅ **Allowed:**
- Contractor labor costs
- Housekeeping/cleaning services
- Utilities (electricity, water, internet)
- Common area maintenance
- Professional fees

❌ **Not Allowed:**
- Personal expenses
- Entertainment expenses
- Non-business related costs

### Filing Deadlines:
| Form | Thai Name | Deadline |
|------|-----------|----------|
| Monthly Report | รายงานเดือน | End of month |
| Quarterly (Q1) | ป.พ.6 Q1 | April 15 |
| Quarterly (Q2) | ป.พ.6 Q2 | July 15 |
| Quarterly (Q3) | ป.พ.6 Q3 | October 15 |
| Quarterly (Q4) | ป.พ.6 Q4 | January 15 |
| Annual Return | ภ.ป.ภ. 50 | March 31 |

---

## Contact Support

### For Technical Issues:
- **Email:** support@thegreenhaven.com
- **Phone:** +66-2-XXXX-XXXX
- **Hours:** Monday-Friday, 9 AM - 5 PM (Bangkok Time)

### Document Submission:
Contact the accounting department for:
- Official PDF copies for filing
- Signature authorization
- Revenue Department submission

### Tax Consultation:
Consult with your tax advisor or Revenue Department (สรรพากร):
- **Phone:** 1566 (Thai tax hotline)
- **Website:** www.rd.go.th
- **Address:** Revenue Department, Bangkok

---

## System Updates & Versions

### Version 1.0 (March 2026)
- ✅ Tax Dashboard with KPI metrics
- ✅ Monthly report generation
- ✅ Quarterly and annual returns
- ✅ PDF/Excel export functionality
- ✅ Withholding tax reconciliation
- ✅ Filing checklist
- ⏳ Mobile app (planned)
- ⏳ Integration with Revenue Department (planned)

---

## Legal Disclaimer

This system is designed to help organize tax information for The Green Haven. However:
- Users are responsible for accurate data entry
- Always verify calculations before submission
- Consult tax professionals for complex situations
- The system does not replace professional tax consultation
- Government regulations may change - stay updated

---

**Document Prepared By:** Development Team
**For Questions:** Contact Accounting Department
**Last Review:** March 16, 2026

