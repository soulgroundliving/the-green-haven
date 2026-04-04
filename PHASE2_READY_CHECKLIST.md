# 🚀 PHASE 2 READY CHECKLIST

**Status:** Ready to update SlipOK Client when Cloud Function is deployed

---

## 📋 STEP-BY-STEP: Update SlipOK Client

### **ขั้นที่ 1: ได้ Cloud Function URL**

เมื่อ deploy Cloud Functions เสร็จ จะได้ URL แบบนี้:
```
https://us-central1-the-green-haven.cloudfunctions.net/verifySlip
```

**Copy URL นี้ไว้!**

---

### **ขั้นที่ 2: Update shared/slipok-secure-client.js**

**ไฟล์:** `shared/slipok-secure-client.js`

**หาตัวนี้:**
```javascript
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/verifySlip';
```

**แก้เป็น:**
```javascript
const SLIPOK_CLOUD_FUNCTION_URL = 'https://us-central1-the-green-haven.cloudfunctions.net/verifySlip';
```

---

### **ขั้นที่ 3: Verify Files Updated**

ตรวจสอบว่า 2 files อัปเดตแล้ว:

```powershell
# ตรวจ tenant.html
findstr /C:"slipok-secure-client.js" tenant.html

# ตรวจ dashboard.html
findstr /C:"slipok-secure-client.js" dashboard.html
```

ควรเห็น ทั้งสอง files import `slipok-secure-client.js` ✅

---

### **ขั้นที่ 4: Verify No API Keys in HTML**

```powershell
# ตรวจหา old API keys
findstr /C:"SLIPOK8P4B99Z" tenant.html
findstr /C:"SLIPOK8P4B99Z" dashboard.html
```

ควรเห็น **0 results** ✅ (API keys ต้องอยู่ใน Firebase config เท่านั้น)

---

### **ขั้นที่ 5: Test in Browser**

1. เปิด `tenant.html` → Payment page
2. Upload slip
3. Verify button ควร:
   - ✅ Call Cloud Function (ไม่ใช่ SlipOK direct)
   - ✅ Get result ใน 2-4 seconds
   - ✅ แสดง payment info

---

### **ขั้นที่ 6: Commit Changes**

```powershell
git add shared/slipok-secure-client.js
git commit -m "feat: Configure SlipOK Cloud Function URL for Phase 2

- Updated SLIPOK_CLOUD_FUNCTION_URL to the-green-haven project
- Both tenant.html and dashboard.html use secure client
- No API keys exposed in HTML files

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## 🎯 Next Steps After Phase 2

1. ✅ Update SlipOK client with Cloud Function URL
2. ✅ Test in both tenant app and dashboard
3. ⏭️ Phase 3: Remove old API keys (if any exist)
4. ⏭️ Phase 4: End-to-end testing with live slips

---

## 📞 Ready When Cloud Functions Deploy! 🚀

Wait for the Cloud Function URL from Phase 1, then follow steps above.
