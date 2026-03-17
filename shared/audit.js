/**
 * The Green Haven - Audit Logging System
 * Phase 4: Security & Compliance
 * Logs all admin actions for security and compliance purposes
 */

// ===== AUDIT LOGGER =====

/**
 * Audit Logger for tracking admin actions
 * Stores logs in localStorage and can be viewed by admins
 */
const AuditLogger = {
  storageKey: 'audit_logs',
  maxLogs: 1000, // Keep last 1000 logs to prevent storage overflow

  /**
   * Log an admin action
   * @param {string} action - Action type (e.g., 'BILL_GENERATED', 'USER_ADDED')
   * @param {string} details - Detailed description of the action
   * @param {object} metadata - Additional metadata about the action
   */
  log(action, details, metadata = {}) {
    const user = this.getCurrentUser();
    const log = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      action: action,
      details: details,
      user: user ? user.name : 'Unknown',
      email: user ? user.email : 'unknown@example.com',
      userType: user ? user.userType : 'unknown',
      metadata: metadata,
      ipAddress: this.getClientIp(), // Best effort - browser can't get real IP
      userAgent: navigator.userAgent
    };

    this.addLog(log);
    console.log('📝 Audit:', action, details);
    return log;
  },

  /**
   * Add log to storage
   */
  addLog(log) {
    try {
      const logs = this.getLogs();
      logs.unshift(log); // Add to beginning

      // Keep only the last maxLogs entries
      if (logs.length > this.maxLogs) {
        logs.splice(this.maxLogs);
      }

      localStorage.setItem(this.storageKey, JSON.stringify(logs));

      // Also save to Firebase if available
      if (window.firebaseSet && window.firebaseRef && window.firebaseDatabase) {
        this.syncToFirebase(logs.slice(0, 100)); // Keep last 100 in Firebase
      }
    } catch (error) {
      console.error('Failed to save audit log:', error);
    }
  },

  /**
   * Get all logs
   */
  getLogs() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || '[]');
    } catch (error) {
      console.error('Failed to retrieve audit logs:', error);
      return [];
    }
  },

  /**
   * Filter logs by criteria
   */
  filterLogs(criteria = {}) {
    const logs = this.getLogs();

    return logs.filter(log => {
      if (criteria.action && log.action !== criteria.action) return false;
      if (criteria.email && log.email !== criteria.email) return false;
      if (criteria.startDate && new Date(log.timestamp) < new Date(criteria.startDate)) return false;
      if (criteria.endDate && new Date(log.timestamp) > new Date(criteria.endDate)) return false;
      if (criteria.action_includes && !log.action.includes(criteria.action_includes)) return false;

      return true;
    });
  },

  /**
   * Search logs by keyword
   */
  searchLogs(keyword) {
    const logs = this.getLogs();
    const lowerKeyword = keyword.toLowerCase();

    return logs.filter(log =>
      log.action.toLowerCase().includes(lowerKeyword) ||
      log.details.toLowerCase().includes(lowerKeyword) ||
      log.user.toLowerCase().includes(lowerKeyword)
    );
  },

  /**
   * Get logs for a specific date range
   */
  getLogsByDateRange(startDate, endDate) {
    return this.filterLogs({
      startDate: startDate,
      endDate: endDate
    });
  },

  /**
   * Get logs for a specific user
   */
  getLogsByUser(email) {
    return this.filterLogs({ email: email });
  },

  /**
   * Get logs by action type
   */
  getLogsByAction(action) {
    return this.filterLogs({ action: action });
  },

  /**
   * Get log statistics
   */
  getStatistics() {
    const logs = this.getLogs();
    const stats = {
      totalLogs: logs.length,
      actions: {},
      users: {},
      dateRange: {}
    };

    logs.forEach(log => {
      // Count by action
      stats.actions[log.action] = (stats.actions[log.action] || 0) + 1;

      // Count by user
      stats.users[log.email] = (stats.users[log.email] || 0) + 1;
    });

    if (logs.length > 0) {
      stats.dateRange.oldest = logs[logs.length - 1].timestamp;
      stats.dateRange.newest = logs[0].timestamp;
    }

    return stats;
  },

  /**
   * Clear all logs (admin only)
   */
  clearLogs() {
    if (confirm('⚠️ ต้องการลบประวัติการดำเนินการทั้งหมดใช่หรือไม่?\n\nการกระทำนี้ไม่สามารถเลิกทำได้')) {
      localStorage.removeItem(this.storageKey);
      console.log('✅ All audit logs cleared');
      return true;
    }
    return false;
  },

  /**
   * Export logs as JSON
   */
  exportLogs(filters = {}) {
    const logs = filters.action ? this.getLogsByAction(filters.action) : this.getLogs();
    const dataStr = JSON.stringify(logs, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Export logs as CSV
   */
  exportLogsAsCSV(filters = {}) {
    const logs = filters.action ? this.getLogsByAction(filters.action) : this.getLogs();

    // Create CSV header
    const header = 'Timestamp,Action,User,Email,Details,Metadata\n';

    // Create CSV rows
    const rows = logs.map(log =>
      `"${log.timestamp}","${log.action}","${log.user}","${log.email}","${log.details}","${JSON.stringify(log.metadata).replace(/"/g, '\\"')}"`
    ).join('\n');

    const csv = header + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Sync logs to Firebase for centralized storage
   */
  async syncToFirebase(logs) {
    try {
      if (!window.firebaseSet || !window.firebaseRef) return;

      const ref = window.firebaseRef(window.firebaseDatabase, 'system/audit_logs');
      await window.firebaseSet(ref, {
        logs: logs,
        lastSync: new Date().toISOString(),
        count: logs.length
      });

      console.log('✅ Audit logs synced to Firebase');
    } catch (error) {
      console.warn('⚠️ Failed to sync audit logs to Firebase:', error);
    }
  },

  /**
   * Get current user from session
   */
  getCurrentUser() {
    try {
      const user = sessionStorage.getItem('user');
      return user ? JSON.parse(user) : null;
    } catch (error) {
      return null;
    }
  },

  /**
   * Get client IP (best effort from client side)
   * Note: Client-side IP detection is limited. Proper implementation requires server-side logging.
   */
  getClientIp() {
    return 'Client'; // Browser cannot access real IP
  }
};

// ===== ACTION TYPES =====

const AuditActionTypes = {
  // Authentication
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  REGISTER_NEW_USER: 'REGISTER_NEW_USER',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',

  // Bills
  BILL_GENERATED: 'BILL_GENERATED',
  INVOICE_SENT: 'INVOICE_SENT',
  RECEIPT_GENERATED: 'RECEIPT_GENERATED',
  BILL_DELETED: 'BILL_DELETED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',

  // Maintenance
  MAINTENANCE_CREATED: 'MAINTENANCE_CREATED',
  MAINTENANCE_UPDATED: 'MAINTENANCE_UPDATED',
  MAINTENANCE_CLOSED: 'MAINTENANCE_CLOSED',
  MAINTENANCE_DELETED: 'MAINTENANCE_DELETED',

  // Expenses (Phase 5)
  EXPENSE_ADDED: 'EXPENSE_ADDED',
  EXPENSE_UPDATED: 'EXPENSE_UPDATED',
  EXPENSE_DELETED: 'EXPENSE_DELETED',
  REPORT_GENERATED: 'REPORT_GENERATED',
  DOCUMENT_EXPORTED: 'DOCUMENT_EXPORTED',

  // Users
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',

  // Data
  DATA_EXPORTED: 'DATA_EXPORTED',
  DATA_IMPORTED: 'DATA_IMPORTED',
  DATA_BACKUP: 'DATA_BACKUP',
  DATA_RESTORED: 'DATA_RESTORED',

  // Meter Data
  METER_DATA_IMPORTED: 'METER_DATA_IMPORTED',

  // System
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  SECURITY_ALERT: 'SECURITY_ALERT',
  ERROR_OCCURRED: 'ERROR_OCCURRED'
};

// ===== LOGGING HELPER FUNCTIONS =====

/**
 * Log bill generation
 */
function logBillGenerated(room, amount, details) {
  AuditLogger.log(
    AuditActionTypes.BILL_GENERATED,
    `Generated invoice for room ${room}: ฿${amount.toLocaleString()}`,
    { room, amount, invoiceNumber: details?.invoiceNumber }
  );
}

/**
 * Log maintenance request
 */
function logMaintenanceCreated(room, description, category) {
  AuditLogger.log(
    AuditActionTypes.MAINTENANCE_CREATED,
    `Created maintenance request for room ${room}: ${category}`,
    { room, description, category }
  );
}

/**
 * Log payment verification
 */
function logPaymentVerified(room, amount, paymentMethod) {
  AuditLogger.log(
    AuditActionTypes.PAYMENT_VERIFIED,
    `Verified payment for room ${room}: ฿${amount.toLocaleString()} via ${paymentMethod}`,
    { room, amount, paymentMethod }
  );
}

/**
 * Log security-related events
 */
function logSecurityAlert(alertType, description, severity = 'INFO') {
  AuditLogger.log(
    AuditActionTypes.SECURITY_ALERT,
    `[${severity}] ${alertType}: ${description}`,
    { alertType, severity }
  );
}

/**
 * Log errors for debugging
 */
function logError(errorType, errorMessage, errorStack = '') {
  AuditLogger.log(
    AuditActionTypes.ERROR_OCCURRED,
    `${errorType}: ${errorMessage}`,
    { errorType, errorStack: errorStack.substring(0, 500) } // Limit stack trace length
  );
}

// ===== INITIALIZATION =====

console.log('✅ Audit Logger initialized');

// Export for use in other scripts
window.AuditLogger = AuditLogger;
window.AuditActionTypes = AuditActionTypes;
window.logBillGenerated = logBillGenerated;
window.logMaintenanceCreated = logMaintenanceCreated;
window.logPaymentVerified = logPaymentVerified;
window.logSecurityAlert = logSecurityAlert;
window.logError = logError;
