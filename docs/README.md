# 🏡 The Green Haven - Apartment Management System

Professional apartment management dashboard for **The Green Haven Residences** in Saimai, Bangkok.

## 🎯 Features

- **📊 Dashboard** - Tenant & room management
- **👥 Tenant Management** - Profile, contract, payment tracking
- **💳 Tenant Payment Portal** - App-like payment interface with PWA support
- **🔧 Maintenance System** - Report and track repairs
- **📅 Monthly Billing** - Automated bill generation
- **💸 Expense Tracking** - Record and categorize expenses
- **📈 Analytics** - Revenue and occupancy reports
- **📄 Contract Management** - Track lease agreements

## 🚀 Getting Started

### Requirements
- Modern web browser
- JavaScript enabled
- LocalStorage support

### Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/the-green-haven.git
cd the-green-haven
```

2. Serve locally
```bash
python -m http.server 8080
```

3. Open in browser
```
http://localhost:8080/dashboard.html
```

## 📱 Tenant Payment Portal

Accessible at `/tenant-payment.html`

Features:
- Real-time bill display
- PromptPay QR code generation
- Multiple payment methods (PromptPay, e-Banking)
- Payment history tracking
- PWA support (installable app)
- Offline capabilities

Usage: `https://yourdomain.com/tenant-payment.html?room=15`

## 🌐 Pages

- `dashboard.html` - Main admin dashboard
- `tenant-payment.html` - Tenant payment portal
- `manifest.json` - PWA manifest
- `sw.js` - Service Worker

## 📦 PWA Support

The app includes Progressive Web App features:
- Service Worker for offline support
- App manifest for installation
- Installable on mobile devices
- App-like header and navigation

## 💾 Data Storage

Currently uses browser localStorage for data persistence. For production, integrate with:
- Firebase Realtime Database
- Supabase
- Custom API backend

## 🔐 Security Notes

- Data stored locally in browser
- For production, implement proper authentication
- Use HTTPS in production
- Validate input on both client and server

## 📝 License

MIT License - © 2024 The Green Haven

## 📞 Contact

For inquiries: 089-123-4567

---

Made with ❤️ for The Green Haven Residences
