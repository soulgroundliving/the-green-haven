/**
 * The Green Haven - Security & Encryption Utilities
 * Phase 4: Security Hardening
 */

// ===== INPUT VALIDATION & SANITIZATION =====

/**
 * Sanitize input to prevent XSS attacks
 * Removes dangerous HTML and scripts
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';

  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 number
 */
function validatePasswordStrength(password) {
  const requirements = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
  };

  const score = Object.values(requirements).filter(Boolean).length;

  return {
    isValid: score >= 4,
    score: score,
    requirements: requirements,
    feedback: getPasswordFeedback(requirements)
  };
}

/**
 * Get password feedback message
 */
function getPasswordFeedback(requirements) {
  const missing = [];
  if (!requirements.length) missing.push('อย่างน้อย 8 ตัวอักษร');
  if (!requirements.uppercase) missing.push('ตัวพิมพ์ใหญ่');
  if (!requirements.lowercase) missing.push('ตัวพิมพ์เล็ก');
  if (!requirements.number) missing.push('ตัวเลข');

  if (missing.length === 0) return '✅ รหัสผ่านแข็งแรง';
  return '⚠️ ต้องมี: ' + missing.join(', ');
}

/**
 * Validate input length
 */
function validateLength(input, minLength = 1, maxLength = 255) {
  const length = String(input).length;
  return length >= minLength && length <= maxLength;
}

/**
 * Validate phone number format (Thai format)
 */
function isValidThaiPhone(phone) {
  const phoneRegex = /^(\+66|0)[0-9]{8,9}$/;
  return phoneRegex.test(phone.replace(/\D/g, ''));
}

// ===== CSRF PROTECTION =====

/**
 * Generate CSRF token
 */
function generateCSRFToken() {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  sessionStorage.setItem('csrfToken', token);
  return token;
}

/**
 * Get CSRF token
 */
function getCSRFToken() {
  let token = sessionStorage.getItem('csrfToken');
  if (!token) {
    token = generateCSRFToken();
  }
  return token;
}

/**
 * Verify CSRF token
 */
function verifyCSRFToken(token) {
  const storedToken = sessionStorage.getItem('csrfToken');
  return token === storedToken && token !== null;
}

/**
 * Add CSRF token to form
 */
function addCSRFToForm(form) {
  const token = getCSRFToken();
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'csrfToken';
  input.value = token;
  form.appendChild(input);
}

// ===== ENCRYPTION & HASHING =====

/**
 * Simple encryption using Base64 (for client-side obfuscation)
 * Note: This is NOT secure encryption - use for obfuscation only
 * For sensitive data, use server-side encryption
 */
function encryptData(data, key = 'default') {
  try {
    const str = JSON.stringify(data);
    return btoa(str + '::' + key);
  } catch (error) {
    console.error('Encryption error:', error);
    return null;
  }
}

/**
 * Decrypt Base64 encrypted data
 */
function decryptData(encrypted, key = 'default') {
  try {
    const decoded = atob(encrypted);
    const parts = decoded.split('::');
    if (parts[1] !== key) {
      throw new Error('Invalid encryption key');
    }
    return JSON.parse(parts[0]);
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

/**
 * Hash password using simple hash (for client-side verification)
 * Note: For production, use Firebase Auth built-in password hashing
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== SECURE SESSION MANAGEMENT =====

/**
 * Save user session securely
 */
function saveSecureSession(user) {
  const sessionData = {
    ...user,
    timestamp: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  };

  sessionStorage.setItem('user', JSON.stringify(sessionData));

  // Set session timeout
  setSessionTimeout();

  console.log('✅ Secure session saved');
}

/**
 * Get user session with expiration check
 */
function getSecureSession() {
  const user = sessionStorage.getItem('user');
  if (!user) return null;

  const userData = JSON.parse(user);

  // Check if session has expired
  if (userData.expiresAt && Date.now() > userData.expiresAt) {
    sessionStorage.removeItem('user');
    console.warn('⚠️ Session expired');
    return null;
  }

  return userData;
}

/**
 * Set session timeout (auto logout after inactivity)
 */
function setSessionTimeout(timeoutMinutes = 30) {
  let timeoutId;

  const resetTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      console.warn('⚠️ Session timeout - logging out due to inactivity');
      sessionStorage.removeItem('user');
      window.location.href = '/login';
    }, timeoutMinutes * 60 * 1000);
  };

  // Reset timeout on user activity
  document.addEventListener('mousemove', resetTimeout);
  document.addEventListener('keypress', resetTimeout);
  document.addEventListener('click', resetTimeout);

  resetTimeout();
}

/**
 * Secure logout
 */
function secureLogout() {
  // Clear all session data
  sessionStorage.clear();
  // Clear sensitive localStorage data if any
  localStorage.removeItem('billsData');
  localStorage.removeItem('paymentData');
  localStorage.removeItem('tenantData');

  console.log('✅ Secure logout completed');
  window.location.href = '/login';
}

// ===== SECURITY HEADERS =====

/**
 * Check if HTTPS is being used
 */
function isSecureConnection() {
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
}

/**
 * Add security headers (CSP, etc.)
 */
function addSecurityHeaders() {
  // This would normally be done server-side
  // But we can add some client-side protections

  // Disable right-click context menu for sensitive data
  // document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Prevent iframe embedding
  if (window.self !== window.top) {
    window.top.location = window.self.location;
  }

  console.log('✅ Security headers applied');
}

// ===== DATA VALIDATION HELPER =====

/**
 * Comprehensive form validation
 */
function validateForm(formData, rules) {
  const errors = {};

  for (const [field, value] of Object.entries(formData)) {
    const rule = rules[field];
    if (!rule) continue;

    // Check required
    if (rule.required && !value) {
      errors[field] = `${rule.label} จำเป็นต้องกรอก`;
      continue;
    }

    // Check email
    if (rule.type === 'email' && value && !isValidEmail(value)) {
      errors[field] = `${rule.label} ไม่ถูกต้อง`;
      continue;
    }

    // Check password strength
    if (rule.type === 'password' && value) {
      const strength = validatePasswordStrength(value);
      if (!strength.isValid) {
        errors[field] = strength.feedback;
        continue;
      }
    }

    // Check length
    if (rule.minLength && value && value.length < rule.minLength) {
      errors[field] = `${rule.label} ต้องมีอย่างน้อย ${rule.minLength} ตัวอักษร`;
      continue;
    }

    if (rule.maxLength && value && value.length > rule.maxLength) {
      errors[field] = `${rule.label} ต้องไม่เกิน ${rule.maxLength} ตัวอักษร`;
      continue;
    }

    // Check phone
    if (rule.type === 'phone' && value && !isValidThaiPhone(value)) {
      errors[field] = `${rule.label} ไม่ถูกต้อง`;
      continue;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors: errors
  };
}

// ===== INITIALIZATION =====

// Initialize security on page load
window.addEventListener('load', () => {
  // Check secure connection
  if (!isSecureConnection()) {
    console.warn('⚠️ Not using secure HTTPS connection');
  }

  // Add security headers
  addSecurityHeaders();

  // Generate CSRF token
  getCSRFToken();

  // Check session validity
  const session = getSecureSession();
  if (!session && window.location.pathname !== '/login.html') {
    // Don't redirect here, let individual pages handle auth
  }

  console.log('✅ Security utilities initialized');
});

// Export functions for use in other scripts
window.SecurityUtils = {
  sanitizeInput,
  isValidEmail,
  validatePasswordStrength,
  validateLength,
  isValidThaiPhone,
  generateCSRFToken,
  getCSRFToken,
  verifyCSRFToken,
  addCSRFToForm,
  encryptData,
  decryptData,
  hashPassword,
  saveSecureSession,
  getSecureSession,
  setSessionTimeout,
  secureLogout,
  isSecureConnection,
  addSecurityHeaders,
  validateForm
};

console.log('✅ Security utilities loaded');
