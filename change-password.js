// ===== Change Password Feature =====

function togglePasswordVisibility(fieldId) {
  const input = document.getElementById(fieldId);
  const icon = document.getElementById(`icon-${fieldId}`);

  if (input.type === 'password') {
    input.type = 'text';
    icon.textContent = '👁️‍🗨️';
  } else {
    input.type = 'password';
    icon.textContent = '👁️';
  }
}

function openChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    document.getElementById('cpMessage').innerHTML = '';
  }
}

function closeChangePasswordModal() {
  const modal = document.getElementById('changePasswordModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function changePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const messageBox = document.getElementById('cpMessage');

  // Validation
  if (!oldPassword || !newPassword || !confirmPassword) {
    showCPMessage('❌ กรุณากรอกข้อมูลให้ครบถ้วน', 'error');
    return;
  }

  if (newPassword !== confirmPassword) {
    showCPMessage('❌ รหัสผ่านใหม่ไม่ตรงกัน', 'error');
    return;
  }

  if (newPassword.length < 6) {
    showCPMessage('❌ รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร', 'error');
    return;
  }

  if (newPassword === oldPassword) {
    showCPMessage('❌ รหัสผ่านใหม่ต้องต่างจากเดิม', 'error');
    return;
  }

  try {
    showCPMessage('⏳ กำลังเปลี่ยนรหัสผ่าน...', 'info');

    const auth = window.firebaseAuth;
    const user = auth.currentUser;

    if (!user) {
      showCPMessage('❌ ไม่พบข้อมูลผู้ใช้ ลองออกจากระบบแล้วเข้าใหม่', 'error');
      return;
    }

    const email = user.email;

    // Step 1: Reauthenticate with old password
    const { getAuth: getAuthModule } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js');
    const { reauthenticateWithCredential, EmailAuthProvider, updatePassword } = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js');

    const credential = EmailAuthProvider.credential(email, oldPassword);

    try {
      await reauthenticateWithCredential(user, credential);
    } catch (error) {
      showCPMessage('❌ รหัสผ่านเดิมไม่ถูกต้อง', 'error');
      return;
    }

    // Step 2: Update password
    await updatePassword(user, newPassword);

    // Step 3: Success
    showCPMessage('✅ เปลี่ยนรหัสผ่านสำเร็จแล้ว!', 'success');

    // Log audit
    if (typeof logAudit === 'function') {
      logAudit('PASSWORD_CHANGED', {
        email: email,
        timestamp: new Date().toISOString()
      });
    }

    // Close modal after 2 seconds
    setTimeout(() => {
      closeChangePasswordModal();
    }, 2000);

  } catch (error) {
    console.error('Error:', error);
    let errorMsg = '❌ เกิดข้อผิดพลาด: ';

    if (error.code === 'auth/wrong-password') {
      errorMsg += 'รหัสผ่านเดิมไม่ถูกต้อง';
    } else if (error.code === 'auth/weak-password') {
      errorMsg += 'รหัสผ่านใหม่อ่อนแอเกินไป';
    } else if (error.code === 'auth/requires-recent-login') {
      errorMsg += 'ต้องเข้าระบบใหม่อีกครั้ง';
    } else {
      errorMsg += error.message;
    }

    showCPMessage(errorMsg, 'error');
  }
}

function showCPMessage(msg, type) {
  const messageBox = document.getElementById('cpMessage');
  messageBox.textContent = msg;
  messageBox.style.display = 'block';

  // Auto clear after 5 seconds if not error
  if (type !== 'error') {
    setTimeout(() => {
      messageBox.style.display = 'none';
    }, 5000);
  }
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('changePasswordModal');
  if (modal && e.target === modal) {
    closeChangePasswordModal();
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeChangePasswordModal();
  }
});
