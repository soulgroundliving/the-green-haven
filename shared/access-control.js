/**
 * Access Control System
 * Role-based access control for Green Haven Management System
 *
 * Roles:
 * - admin: Full access to dashboard, all features
 * - accountant: Access to accounting, reports, tax filing
 * - tenant: Access to tenant portal, bills, payments, support
 */

class AccessControl {
  /**
   * Define page access permissions
   * Key: page path, Value: array of allowed roles
   */
  static PERMISSIONS = {
    // Admin Pages
    '/dashboard.html': ['admin'],
    '/dashboard': ['admin'],
    '': ['admin'], // Root/home redirects to dashboard for admin

    // Accounting Pages
    '/accounting.html': ['accountant', 'admin'],
    '/accounting': ['accountant', 'admin'],

    // Tenant Pages
    '/tenant_app.html': ['tenant'],
    '/tenant_app': ['tenant'],

    // Auth Pages (accessible to all)
    '/login.html': ['admin', 'accountant', 'tenant', 'guest'],
    '/login': ['admin', 'accountant', 'tenant', 'guest'],

    // Payment verification (usually in dashboard but tenant can view too)
    '#payment': ['tenant', 'admin'],
    '#bills': ['tenant', 'admin'],
  };

  /**
   * Define feature-level permissions
   * Features that may be accessible on shared pages with role restrictions
   */
  static FEATURE_PERMISSIONS = {
    'generate_bills': ['admin'],
    'download_invoices': ['admin'],
    'verify_payments': ['admin'],
    'create_maintenance_request': ['tenant'],
    'view_tenants': ['admin'],
    'manage_rooms': ['admin'],
    'access_accounting': ['accountant', 'admin'],
    'file_taxes': ['accountant', 'admin'],
    'view_payment_history': ['tenant', 'admin'],
    'upload_payment_slip': ['tenant'],
    'view_announcements': ['tenant', 'admin'],
  };

  /**
   * Get current user from session
   */
  static getCurrentUser() {
    try {
      // Try sessionStorage first (most reliable)
      const sessionUser = sessionStorage.getItem('user');
      if (sessionUser) {
        const user = JSON.parse(sessionUser);
        if (user && user.uid) {
          return user;
        }
      }

      // Try SecurityUtils as fallback
      if (window.SecurityUtils && typeof window.SecurityUtils.getSecureSession === 'function') {
        const secureUser = window.SecurityUtils.getSecureSession();
        if (secureUser && secureUser.uid) {
          return secureUser;
        }
      }

      return null;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  static isAuthenticated() {
    const user = this.getCurrentUser();
    return user !== null && user.uid !== undefined;
  }

  /**
   * Get current user's role
   */
  static getUserRole() {
    const user = this.getCurrentUser();
    return user ? user.userType : null;
  }

  /**
   * Check if user has access to a page
   */
  static hasPageAccess(pagePath) {
    const user = this.getCurrentUser();

    // Not authenticated
    if (!user) {
      // Only login page is accessible without auth
      return pagePath === '/login.html' || pagePath === '/login';
    }

    const userRole = user.userType;
    const allowedRoles = this.PERMISSIONS[pagePath] || [];

    if (allowedRoles.length === 0) {
      // If page not defined, allow admin access only (security-first approach)
      return userRole === 'admin';
    }

    return allowedRoles.includes(userRole);
  }

  /**
   * Check if user can access a feature
   */
  static hasFeatureAccess(feature) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const userRole = user.userType;
    const allowedRoles = this.FEATURE_PERMISSIONS[feature] || [];

    return allowedRoles.includes(userRole);
  }

  /**
   * Check if user has specific role
   */
  static hasRole(role) {
    const user = this.getCurrentUser();
    return user && user.userType === role;
  }

  /**
   * Check if user has any of the specified roles
   */
  static hasAnyRole(roles) {
    const user = this.getCurrentUser();
    if (!user) return false;
    return roles.includes(user.userType);
  }

  /**
   * Protect a page - redirect to login if not authenticated or authorized
   * Call this at the top of each page that requires authentication
   */
  static protectPage(requiredRole = null) {
    const currentPath = window.location.pathname;
    const user = this.getCurrentUser();

    // Not authenticated - redirect to login
    if (!user) {
      console.warn('⚠️ Access denied: Not authenticated');
      window.location.href = '/login.html';
      return false;
    }

    // Check role-based access
    if (requiredRole && !this.hasRole(requiredRole)) {
      console.warn(`⚠️ Access denied: Required role '${requiredRole}', but user is '${user.userType}'`);
      this.redirectToHomepage();
      return false;
    }

    // Check page-level permissions
    if (!this.hasPageAccess(currentPath)) {
      console.warn(`⚠️ Access denied: User '${user.userType}' cannot access '${currentPath}'`);
      this.redirectToHomepage();
      return false;
    }

    return true;
  }

  /**
   * Show/hide elements based on user role
   * Usage: <div data-access="admin,accountant">Content for admin and accountant</div>
   */
  static applyElementPermissions() {
    const user = this.getCurrentUser();
    if (!user) {
      // Hide all protected elements if not logged in
      document.querySelectorAll('[data-access]').forEach(el => {
        el.classList.add('u-hidden');
      });
      return;
    }

    const userRole = user.userType;

    document.querySelectorAll('[data-access]').forEach(el => {
      const allowedRoles = el.getAttribute('data-access').split(',').map(r => r.trim());

      if (allowedRoles.includes(userRole)) {
        el.classList.remove('u-hidden');  // Show
      } else {
        el.classList.add('u-hidden');  // Hide
      }
    });

    // Also handle data-feature-access for features
    document.querySelectorAll('[data-feature-access]').forEach(el => {
      const feature = el.getAttribute('data-feature-access');

      if (this.hasFeatureAccess(feature)) {
        el.classList.remove('u-hidden');  // Show
      } else {
        el.classList.add('u-hidden');  // Hide
      }
    });
  }

  /**
   * Disable/enable form buttons based on user role
   * Usage: <button data-access="admin">Generate Bills</button>
   */
  static applyButtonPermissions() {
    const user = this.getCurrentUser();
    if (!user) {
      document.querySelectorAll('[data-access]').forEach(el => {
        if (el.tagName === 'BUTTON' || el.tagName === 'A') {
          el.disabled = true;
          el.title = 'คุณไม่มีสิทธิ์ดำเนินการนี้';
        }
      });
      return;
    }

    const userRole = user.userType;

    document.querySelectorAll('[data-access]').forEach(el => {
      const allowedRoles = el.getAttribute('data-access').split(',').map(r => r.trim());

      if (el.tagName === 'BUTTON' || el.tagName === 'A') {
        if (!allowedRoles.includes(userRole)) {
          el.disabled = true;
          el.title = `เฉพาะ ${allowedRoles.join(', ')} เท่านั้น`;
          el.classList.add('u-op50', 'u-no-ptr');
        }
      }
    });
  }

  /**
   * Redirect user to appropriate homepage based on role
   */
  static redirectToHomepage() {
    const user = this.getCurrentUser();

    if (!user) {
      window.location.href = '/login.html';
      return;
    }

    switch (user.userType) {
      case 'admin':
        window.location.href = '/dashboard.html';
        break;
      case 'accountant':
        window.location.href = '/accounting.html';
        break;
      case 'tenant':
        window.location.href = `/tenant_app.html?room=${user.roomNumber || ''}`;
        break;
      default:
        window.location.href = '/login.html';
    }
  }

  /**
   * Initialize access control on page load
   * Call this in the window.addEventListener('load') or at page start
   */
  static initialize() {
    // Apply element visibility permissions
    this.applyElementPermissions();

    // Apply button permissions
    this.applyButtonPermissions();

    // Log current user info
    const user = this.getCurrentUser();
    if (user) {
      console.log(`✅ Access Control: User '${user.email}' logged in as '${user.userType}'`);
    } else {
      console.log('⚠️ Access Control: No user authenticated');
    }
  }

  /**
   * Logout user and redirect to login
   */
  static logout() {
    try {
      // Clear session
      if (window.SecurityUtils && typeof window.SecurityUtils.secureLogout === 'function') {
        window.SecurityUtils.secureLogout();
      } else {
        sessionStorage.clear();
        window.location.href = '/login.html';
      }
    } catch (error) {
      console.error('Logout error:', error);
      window.location.href = '/login.html';
    }
  }

  /**
   * Get user's accessible pages
   */
  static getAccessiblePages() {
    const user = this.getCurrentUser();
    if (!user) return [];

    const userRole = user.userType;
    const accessible = [];

    for (const [page, roles] of Object.entries(this.PERMISSIONS)) {
      if (roles.includes(userRole)) {
        accessible.push(page);
      }
    }

    return accessible;
  }

  /**
   * Check if feature is visible for current user
   * Useful for showing/hiding UI elements conditionally
   */
  static isFeatureVisible(feature) {
    return this.hasFeatureAccess(feature);
  }

  /**
   * Get all available features for current user
   */
  static getAvailableFeatures() {
    const user = this.getCurrentUser();
    if (!user) return [];

    const userRole = user.userType;
    const available = [];

    for (const [feature, roles] of Object.entries(this.FEATURE_PERMISSIONS)) {
      if (roles.includes(userRole)) {
        available.push(feature);
      }
    }

    return available;
  }

  /**
   * Require a specific role for an operation
   * Returns {allowed: boolean, message: string}
   */
  static requireRole(requiredRole, operation = 'this action') {
    const user = this.getCurrentUser();

    if (!user) {
      return {
        allowed: false,
        message: '❌ กรุณาเข้าสู่ระบบก่อน'
      };
    }

    if (!this.hasRole(requiredRole)) {
      return {
        allowed: false,
        message: `❌ เฉพาะ ${requiredRole} เท่านั้นที่สามารถ ${operation}`
      };
    }

    return {
      allowed: true,
      message: `✅ Authorized for ${operation}`
    };
  }

  /**
   * Create audit log for access attempts
   */
  static logAccessAttempt(page, allowed) {
    const user = this.getCurrentUser();
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      userEmail: user ? user.email : 'anonymous',
      userRole: user ? user.userType : 'none',
      attemptedPage: page,
      allowed: allowed,
      result: allowed ? 'SUCCESS' : 'DENIED'
    };

    // Store in localStorage (in production, send to server)
    try {
      let logs = JSON.parse(localStorage.getItem('access_logs') || '[]');
      logs.push(logEntry);

      // Keep only last 1000 logs
      if (logs.length > 1000) {
        logs = logs.slice(-1000);
      }

      localStorage.setItem('access_logs', JSON.stringify(logs));
      console.log(`📋 Access log: ${logEntry.result} - ${logEntry.userEmail} → ${page}`);
    } catch (error) {
      console.warn('Could not write access log:', error);
    }
  }
}

// Export for use in other scripts
window.AccessControl = AccessControl;

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  AccessControl.initialize();
});

console.log('✅ Access Control System loaded');
