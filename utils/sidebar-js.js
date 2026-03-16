/* ===== SIDEBAR JAVASCRIPT ===== */
/* Add this to the <script> section in dashboard.html */

// Sidebar Toggle State
let sidebarOpen = false;

/**
 * Toggle sidebar visibility on mobile
 */
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle = document.getElementById('sidebarToggle');

  sidebarOpen = !sidebarOpen;

  if (sidebarOpen) {
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.classList.add('sidebar-open');
    toggle.textContent = '✕';
    toggle.classList.add('close');
  } else {
    closeSidebar();
  }
}

/**
 * Close sidebar
 */
function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggle = document.getElementById('sidebarToggle');

  sidebarOpen = false;
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
  document.body.classList.remove('sidebar-open');
  toggle.textContent = '☰';
  toggle.classList.remove('close');
}

/**
 * Activate navigation item based on page ID
 * Called by showPage() function
 */
function activateNavItem(pageId) {
  // Remove active class from all nav items
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.classList.remove('active');
  });

  // Add active class to clicked item
  const activeItem = document.querySelector(`[data-page="${pageId}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
  }

  // Close sidebar on mobile after selection
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

/**
 * Update the main showPage() function to call activateNavItem()
 * This replaces the original showPage() logic
 */
window.showPageOriginal = window.showPage; // Store original

window.showPage = function(pageId, element) {
  // Show the page
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => page.classList.remove('active'));

  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  // Activate nav item
  activateNavItem(pageId);
};

/**
 * Initialize sidebar on page load
 */
document.addEventListener('DOMContentLoaded', function() {
  // Set initial active nav item (dashboard)
  activateNavItem('dashboard');

  // Close sidebar when window resizes to desktop
  window.addEventListener('resize', function() {
    if (window.innerWidth > 768) {
      closeSidebar();
    }
  });

  // Close sidebar on overlay click
  const overlay = document.getElementById('sidebarOverlay');
  if (overlay) {
    overlay.addEventListener('click', closeSidebar);
  }

  // Keyboard: Close sidebar on Escape
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && sidebarOpen) {
      closeSidebar();
    }
  });
});

/**
 * Update user info in sidebar footer
 * This updates the userInfo element that was moved from header
 */
function updateUserInfo() {
  const userInfoEl = document.getElementById('userInfo');
  if (userInfoEl && window.SecurityUtils) {
    const user = window.SecurityUtils.getSecureSession();
    if (user) {
      userInfoEl.innerHTML = `<strong>👤 ${window.SecurityUtils.sanitizeInput(user.name)}</strong><br>Admin`;
    }
  }
}

/**
 * Initialize sidebar and user info
 * Call this after authentication check
 */
function initializeSidebar() {
  updateUserInfo();

  // On very small screens, close sidebar by default
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

// Export functions for use in other scripts
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.activateNavItem = activateNavItem;
window.initializeSidebar = initializeSidebar;
