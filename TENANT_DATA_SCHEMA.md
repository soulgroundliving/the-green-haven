# Green Haven - Complete Tenant Data Schema
## ✅ Comprehensive with Simplified License Plate Field

## 📋 Complete Tenant Profile Structure

```json
{
  "id": "TENANT_001",

  // ===== 1. IDENTITY & PERSONAL INFO =====
  "identity": {
    "firstName": "Somchai",
    "lastName": "Surijan",
    "tenantName": "Sammy",
    "phone": "099-999-9999",
    "email": "sammy@example.com",
    "dateOfBirth": "1990-05-15",
    "nationality": "Thai",
    "idCardNumber": "1234567890123",
    "idCardPhotoUrl": "https://...",
    "profilePhotoUrl": "https://..."
  },

  // ===== 2. EMERGENCY CONTACTS (Critical!) =====
  "emergencyContacts": [
    {
      "name": "Anucha Surijan",
      "relationship": "Sister",
      "phone": "089-888-8888",
      "email": "anucha@example.com",
      "canAuthorizeRepairs": true
    },
    {
      "name": "Pornchai Hospital",
      "relationship": "Employer",
      "phone": "02-123-4567",
      "email": "hr@hospital.com",
      "canAuthorizeRepairs": false
    }
  ],

  // ===== 3. LEASE AGREEMENT =====
  "lease": {
    "building": "Nest",
    "roomId": "402",
    "roomName": "Nest 402",
    "floor": "4",
    "status": "active",
    "rentAmount": 5800,
    "currency": "THB",
    "deposit": 11600,
    "depositStatus": "paid",
    "contractDocument": "https://storage.../contracts/TENANT_001_lease.pdf",
    "contractSignedDate": "2026-04-01",
    "moveInDate": "2026-04-01",
    "moveOutDate": null,
    "moveOutDatePlanned": "2027-04-01",
    "leaseTermMonths": 12,
    "renewalNoticeDate": "2027-02-01",
    "guarantor": {
      "name": "Somrit Surijan",
      "relationship": "Father",
      "phone": "081-777-7777",
      "idNumber": "9876543210123"
    }
  },

  // ===== 4. BILLING & PAYMENT =====
  "billing": {
    "billingCycle": {
      "dayOfMonth": 1,
      "cycleName": "Monthly",
      "paymentDueDate": 5,
      "gracePeriodDays": 5,
      "lateFeePercentage": 2,
      "autoPayEnabled": true,
      "autoPayMethod": "bank_transfer"
    },
    "paymentMethods": [
      {
        "type": "bank_transfer",
        "accountName": "Somchai Surijan",
        "bankName": "Kasikornbank",
        "accountNumber": "123-456-7890",
        "isDefault": true
      },
      {
        "type": "payment_slip",
        "isAccepted": true
      },
      {
        "type": "cash",
        "isAccepted": false
      }
    ],
    "paymentHistory": [
      {
        "month": 4,
        "year": 2026,
        "dueDate": "2026-05-05",
        "paidDate": "2026-04-28",
        "amount": 5800,
        "method": "bank_transfer",
        "status": "paid",
        "receiptUrl": "https://..."
      }
    ],
    "outstandingBalance": 0,
    "paymentStreak": 1,
    "onTimePaymentPercentage": 100
  },

  // ===== 5. UTILITIES & METERS =====
  "utilities": {
    "electricityMeter": {
      "meterNumber": "EL-402-001",
      "unit": "kWh",
      "ratePerUnit": 4.50,
      "lastReading": 1250,
      "lastReadingDate": "2026-04-01",
      "monthlyConsumption": 50,
      "estimatedMonthlyBill": 225
    },
    "waterMeter": {
      "meterNumber": "WL-402-001",
      "unit": "m³",
      "ratePerUnit": 8.00,
      "lastReading": 125,
      "lastReadingDate": "2026-04-01",
      "monthlyConsumption": 5,
      "estimatedMonthlyBill": 40
    },
    "maintenanceFee": {
      "amount": 40,
      "frequency": "monthly",
      "description": "Common area maintenance"
    },
    "internetProvider": {
      "provider": "True Internet",
      "packageName": "Fiber 300 Mbps",
      "monthlyFee": 799,
      "accountNumber": "TI-12345678",
      "contactPhone": "1100"
    }
  },

  // ===== 6. VEHICLE & PARKING =====
  "plateNumber": "8กย6666",
  "vehicle": {
    "hasParking": true,
    "parkingSpaces": [
      {
        "spaceNumber": "P-B2-15",
        "level": "B2",
        "type": "car",
        "monthlyFee": 500,
        "status": "assigned",
        "assignedDate": "2026-04-01"
      }
    ]
  },

  // ===== 7. PETS =====
  "petFriendly": {
    "petPolicyAccepted": true,
    "hasPets": true,
    "petsAllowed": 2,
    "petsOwned": 1,
    "pets": [
      {
        "id": "PET_001",
        "name": "Mochi",
        "type": "Cat",
        "breed": "Scottish Fold",
        "color": "Orange",
        "microchipNumber": "978000123456789",
        "dateOfBirth": "2020-06-15",
        "vaccineStatus": "updated",
        "vaccineType": "FVRCP",
        "lastVaccineDate": "2025-04-01",
        "nextVaccineDate": "2026-04-01",
        "vaccineExpireDate": "2026-04-01",
        "vaccineDocument": "https://...",
        "healthCheckDate": "2026-03-15",
        "healthCheckDocument": "https://...",
        "petPhotoUrl": "https://...",
        "insurance": {
          "provider": "Pet Safe",
          "policyNumber": "PS-12345",
          "coverageAmount": 50000,
          "expireDate": "2026-12-31"
        },
        "emergencyVetClinic": "Sukhumvit Pet Hospital",
        "vetContactPhone": "02-123-4567"
      }
    ],
    "petDepositAmount": 2000,
    "petDepositStatus": "paid"
  },

  // ===== 8. DELIVERY & LOGISTICS =====
  "logistics": {
    "preferredDelivery": "Sky Hook",
    "deliveryInstructions": "Please put in the blue basket",
    "deliveryNotes": "Available 9am-5pm weekdays only",
    "allowPackageDelivery": true,
    "allowFoodDelivery": true,
    "allowMailDelivery": true,
    "useMailBox": true,
    "mailBoxLocation": "Ground Floor - Box 402",
    "deliveryContact": {
      "name": "Sammy",
      "phone": "099-999-9999"
    },
    "restrictedDeliveryTimes": [
      {
        "day": "Sunday",
        "startTime": "06:00",
        "endTime": "08:00",
        "reason": "Quiet hours"
      }
    ]
  },

  // ===== 9. MAINTENANCE & OPERATIONS =====
  "maintenance": {
    "lastMaintenanceDate": "2026-03-15",
    "lastMaintenanceType": "Air conditioning inspection",
    "lastMaintenanceNotes": "Filter changed, system working normally",
    "maintenanceSchedule": {
      "acCleaning": {
        "frequency": "quarterly",
        "lastDate": "2026-03-15",
        "nextDate": "2026-06-15"
      },
      "plumbingInspection": {
        "frequency": "semi-annually",
        "lastDate": "2026-01-15",
        "nextDate": "2026-07-15"
      },
      "electricalInspection": {
        "frequency": "annually",
        "lastDate": "2025-04-01",
        "nextDate": "2026-04-01"
      }
    },
    "maintenanceHistory": [
      {
        "date": "2026-03-15",
        "type": "AC Cleaning",
        "description": "Quarterly maintenance - filter change",
        "status": "completed",
        "cost": 500,
        "technician": "Somchai AC Service",
        "notes": "Filter dirty, replaced. System working normally",
        "photoUrl": "https://..."
      }
    ],
    "reportedIssues": [],
    "knownProblems": [
      {
        "description": "Slightly loose towel rack in bathroom",
        "priority": "low",
        "reportedDate": "2026-03-20",
        "status": "scheduled",
        "scheduledFixDate": "2026-04-15"
      }
    ]
  },

  // ===== 10. OPERATIONS & ADMIN (For Luktan) =====
  "operations": {
    "referralSource": {
      "channel": "friend_referral",
      "details": "Referred by Anucha (sister)",
      "referrerName": "Anucha Surijan",
      "referrerTenantId": "TENANT_002",
      "referralDate": "2026-03-01",
      "referralBonus": 500,
      "referralBonusStatus": "applied"
    },
    "marketingSource": "Word of Mouth",
    "viewingDate": "2026-03-25",
    "viewedBy": "Admin Luktan",
    "visaStatus": "Thai Citizen",
    "workPermitRequired": false,
    "employmentStatus": "Employed",
    "employer": "Pornchai Hospital",
    "employerPhone": "02-123-4567",
    "keyManagementStatus": {
      "numberOfKeys": 2,
      "keyDeposit": 500,
      "keyDepositStatus": "paid",
      "keysIssued": true,
      "issueDate": "2026-04-01",
      "keyTag": "K-402-001",
      "keyTag2": "K-402-002"
    },
    "guestPolicies": {
      "maxGuestsPerNight": 4,
      "overnightGuestNotice": 24,
      "longTermGuestLimit": 30,
      "requiresApprovalForLongTermGuest": true
    }
  },

  // ===== 11. GAMIFICATION & ENGAGEMENT =====
  "gamification": {
    "points": 450,
    "rank": "Gold",
    "rankName": "The First Generation",
    "interests": ["Yoga", "Gardening", "Cooking"],
    "badges": [
      {
        "id": "BADGE_001",
        "name": "Secret Gardener",
        "description": "Decorated balcony with plants",
        "earnedDate": "2026-03-20",
        "icon": "🌱"
      },
      {
        "id": "BADGE_002",
        "name": "On-Time Payer",
        "description": "Paid rent 3 months early",
        "earnedDate": "2026-04-01",
        "icon": "💳"
      }
    ],
    "milestones": [
      {
        "type": "rent_payment",
        "count": 1,
        "earnedDate": "2026-04-28",
        "pointsAwarded": 5
      },
      {
        "type": "community_event",
        "count": 5,
        "earnedDate": "2026-04-01",
        "pointsAwarded": 75
      }
    ],
    "nextRankPoints": 500,
    "pointsToNextRank": 50
  },

  // ===== 12. COMPLAINTS & FEEDBACK =====
  "complaints": {
    "totalComplaints": 0,
    "openComplaints": 0,
    "resolvedComplaints": 0,
    "complaintHistory": [],
    "avgResolutionDays": null,
    "satisfactionRating": null
  },

  // ===== 13. PREFERENCES & SETTINGS =====
  "preferences": {
    "communicationChannel": "phone",
    "communicationLanguage": "Thai",
    "preferredContactTime": {
      "startTime": "09:00",
      "endTime": "21:00",
      "daysOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    },
    "notificationsEnabled": true,
    "smsNotifications": true,
    "emailNotifications": true,
    "appNotifications": true,
    "quietHours": {
      "startTime": "22:00",
      "endTime": "08:00",
      "includeWeekends": true
    }
  },

  // ===== 14. COMPLIANCE & DOCUMENTATION =====
  "compliance": {
    "contractSigned": true,
    "contractSignedDate": "2026-04-01",
    "rulesAccepted": true,
    "rulesAcceptedDate": "2026-04-01",
    "privacyPolicyAccepted": true,
    "privacyPolicyAcceptedDate": "2026-04-01",
    "backgroundCheckStatus": "passed",
    "backgroundCheckDate": "2026-03-20",
    "backgroundCheckDocument": "https://...",
    "creditCheckStatus": "passed",
    "creditCheckDate": "2026-03-20",
    "referenceCheck": {
      "status": "passed",
      "referrerName": "Previous Landlord",
      "referrerPhone": "02-555-5555"
    }
  },

  // ===== 15. METADATA & SYSTEM INFO =====
  "metadata": {
    "createdAt": "2026-04-05T00:00:00Z",
    "createdBy": "Admin Luktan",
    "updatedAt": "2026-04-05T12:30:00Z",
    "updatedBy": "Admin Luktan",
    "lastActiveDate": "2026-04-05T10:15:00Z",
    "dataVersion": "2.1",
    "status": "active",
    "notes": "Model tenant, excellent payment history",
    "internalRating": 5,
    "riskLevel": "low",
    "nextReviewDate": "2026-07-05"
  }
}
```

---

## 🎯 KEY FIELDS ADDED FOR LUKTAN'S OPERATIONS

### 1. **Emergency Contacts** (Critical!) 🆘
```json
"emergencyContacts": [
  {
    "name": "Anucha Surijan",
    "relationship": "Sister",
    "phone": "089-888-8888",
    "canAuthorizeRepairs": true
  }
]
```
**Why:** Quick contact for urgent repairs, emergencies, lockouts

### 2. **License Plate Number** 🚗 (Simplified!)
```json
"plateNumber": "8กย6666"
```
**Why:** Parking management, security, vehicle identification

### 3. **Billing Cycle** 💰
```json
"billingCycle": {
  "dayOfMonth": 1,
  "paymentDueDate": 5,
  "gracePeriodDays": 5,
  "lateFeePercentage": 2
}
```
**Why:** Automated billing, late fee calculation, payment tracking

### 4. **Last Maintenance Date** 🔧
```json
"lastMaintenanceDate": "2026-03-15",
"lastMaintenanceType": "Air conditioning inspection",
"maintenanceSchedule": {
  "acCleaning": {
    "frequency": "quarterly",
    "lastDate": "2026-03-15",
    "nextDate": "2026-06-15"
  }
}
```
**Why:** Preventive maintenance scheduling, compliance tracking

### 5. **Referral Source** 📊
```json
"referralSource": {
  "channel": "friend_referral",
  "referrerName": "Anucha Surijan",
  "referralBonus": 500
}
```
**Why:** Marketing analytics, know what channels work best

---

## ✅ NOW COMPLETE WITH ALL SECTIONS

### For Luktan's Admin Dashboard:
- ✅ Tenant Identity & Personal Info
- ✅ **Emergency Contacts** (Critical!)
- ✅ Lease Agreements
- ✅ Billing & Payments with **Billing Cycle**
- ✅ Utilities & Meters
- ✅ Vehicle & Parking with **Simple plateNumber**
- ✅ Pet Management with Vaccination Tracking
- ✅ Delivery & Logistics
- ✅ **Maintenance Operations** (Last Maintenance Date!)
- ✅ **Operations & Admin** (Referral Source!)
- ✅ Gamification & Engagement
- ✅ Complaints & Feedback
- ✅ Preferences & Settings
- ✅ Compliance & Documentation
- ✅ System Metadata

---

## 🔧 WHAT LUKTAN CAN DO WITH THIS DATA

1. **Emergency Response** ✅ - Call sister in 2 seconds
2. **Parking Management** ✅ - Know which car is in which spot
3. **Auto-Billing** ✅ - Different payment due dates per tenant
4. **Maintenance Planning** ✅ - Schedule AC cleaning automatically
5. **Marketing Analytics** ✅ - See which referral sources work
6. **Payment Monitoring** ✅ - Auto-calculate late fees
7. **Pet Tracking** ✅ - Know vaccination expiry dates
8. **Key Management** ✅ - Track all keys and deposits
9. **Guest Policies** ✅ - Enforce long-term guest rules
10. **Compliance** ✅ - Track all required documents

---

**Status:** ✅ **COMPREHENSIVE AND READY FOR FIRESTORE IMPLEMENTATION**
