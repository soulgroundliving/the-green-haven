# Vercel Deployment Guide - The Green Haven Phase 5

## ⚠️ Current Status
- Code: ✅ Committed to GitHub (commit: 80a07f6 + redeploy trigger)
- Vercel: ❌ Project not connected / needs manual setup

## 🚀 Quick Fix (Do This Now)

### Option 1: Manual Vercel Setup (Recommended)

1. **Go to Vercel**: https://vercel.com/dashboard

2. **Create New Project**:
   - Click "Add New..." → "Project"
   - Select "Import Git Repository"
   - Search for: `soulgroundliving/the-green-haven`
   - Click "Import"

3. **Configure Project**:
   - **Project Name**: `the-green-haven` (or similar)
   - **Framework Preset**: Select "Other"
   - **Build Command**: Leave blank or use `echo 'Static site'`
   - **Output Directory**: `.` (current directory)
   - **Environment Variables**: (none needed)

4. **Deploy**:
   - Click "Deploy"
   - Wait 2-5 minutes for build and deployment
   - Once complete, you'll get a live URL

5. **Verify**:
   - Access the deployed site
   - Navigate to: Dashboard → 💰 บัญชี button
   - Should load accounting.html

### Option 2: If Project Already Exists on Vercel

1. Go to: https://vercel.com/dashboard
2. Find "the-green-haven" project
3. Go to Settings → Git
4. Verify GitHub repository is connected
5. If connected, go to Deployments
6. Click "Redeploy" on latest commit
7. Wait for deployment to complete

### Option 3: Using Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy from project directory
cd /path/to/the-green-haven
vercel --prod
```

## 📋 What Gets Deployed

### Phase 5 New Files
- `accounting.html` - Accounting dashboard UI (718 lines)
- `accounting.js` - Business logic (1,103 lines)
- `PHASE-5-FINANCIAL.md` - Documentation

### Phase 5 Modified Files
- `login.html` - Added Accountant user type
- `dashboard.html` - Added Accounting navigation
- `audit.js` - Added expense action types

### All Static Files
- HTML files: login.html, dashboard.html, accounting.html, tenant-payment.html, index.html
- JavaScript: security.js, audit.js, accounting.js
- JSON: vercel.json, firebase config

## 🔗 Key Files

**Main Entry Point**: 
- `login.html` - Initial login page

**Phase 5 Accounting**:
- `accounting.html` - Dashboard, expenses, reports, settings
- `accounting.js` - All business logic
- Access via: Dashboard → 💰 บัญชี button

## ✅ Deployment Checklist

- [x] Code committed to GitHub
- [x] All Phase 5 files created
- [x] Security.js integrated
- [x] Audit.js updated
- [ ] Vercel project created (needs manual setup)
- [ ] GitHub repository connected to Vercel
- [ ] Deployment triggered
- [ ] Live site verified
- [ ] accounting.html loads correctly
- [ ] Login works with Accountant role

## 🆘 Troubleshooting

**Still Getting 404?**
1. Check Vercel dashboard for build errors
2. Verify GitHub repository is selected
3. Try different project name
4. Check if another Vercel project already exists
5. Clear browser cache and try again

**Build Failing?**
1. Go to Vercel Deployments tab
2. Click latest deployment
3. Check "Build Logs" for errors
4. Ensure vercel.json exists in root
5. All HTML/JS files must be in root directory

**Site Loads But Accounting Page Broken?**
1. Check browser console for JavaScript errors (F12)
2. Verify security.js and audit.js are loading
3. Confirm localStorage is enabled
4. Check if Chart.js CDN is accessible

## 📞 GitHub Repository

**URL**: https://github.com/soulgroundliving/the-green-haven

**Latest Commit**: 
```
92a48c2 - Trigger Vercel redeploy - Phase 5 Financial Management System
80a07f6 - Phase 5: Add Complete Financial Management System for Accounting Department
```

All code is ready and tested. Just need Vercel to connect and deploy!

---

**Timeline**: Once Vercel is connected, deployment should complete in 2-5 minutes.
**Contact**: Check GitHub Actions logs or Vercel deployment logs for detailed build information.
