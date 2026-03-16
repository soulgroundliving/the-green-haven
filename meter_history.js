// ===== METER HISTORY & ANALYTICS =====
// The Green Haven - Meter History System
// Tracks, visualizes, and analyzes meter usage patterns

const NEST_ROOMS = ['13', '14', '15', '15ก', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];

let usageChart = null;
let selectedRoom = '';
let selectedMonths = 6;

// ===== INITIALIZATION =====

function initHistoryPage() {
  checkAdminAccess();
  populateRoomFilter();
  loadHistory();
}

function checkAdminAccess() {
  const userData = JSON.parse(localStorage.getItem('currentUser') || '{}');

  // Flexible role checking: accept multiple variations
  const userType = userData.userType ? userData.userType.toLowerCase() : '';
  const allowedRoles = ['admin', 'owner', 'superadmin'];

  // Check if user has any allowed role
  const hasAccess = allowedRoles.some(role => userType.includes(role)) || userData.email?.includes('admin');

  // If no currentUser at all, redirect to login
  if (!userData || !userData.email) {
    console.warn('⚠️ No user data found. Redirecting to login.');
    window.location.href = '/login';
    return;
  }

  // If user exists but doesn't have admin access, show warning
  if (!hasAccess) {
    console.warn('⚠️ User does not have admin access. Role:', userType);
    alert(`⚠️ สิทธิ์ไม่เพียงพอ\nบัญชี: ${userData.email}\nบทบาท: ${userData.userType || 'unknown'}\n\nติดต่อแอดมินเพื่อขออนุญาต`);
    window.location.href = '/login';
    return;
  }

  console.log('✅ Admin access granted for:', userData.email);
}

function populateRoomFilter() {
  const select = document.getElementById('roomFilter');

  NEST_ROOMS.forEach(room => {
    const option = document.createElement('option');
    option.value = room;
    option.textContent = `ห้อง ${room}`;
    select.appendChild(option);
  });
}

// ===== MAIN LOADING FUNCTION =====

function loadHistory() {
  selectedRoom = document.getElementById('roomFilter').value;
  selectedMonths = parseInt(document.getElementById('monthsFilter').value);

  if (!selectedRoom) {
    loadAllRoomsHistory();
  } else {
    loadSingleRoomHistory(selectedRoom);
  }
}

function loadSingleRoomHistory(roomId) {
  const history = getMeterHistoryForRoom(roomId, selectedMonths);

  if (!history || history.length === 0) {
    document.getElementById('historyTable').innerHTML =
      `<tr><td colspan="7" style="text-align: center; color: #6b7a8d;">ไม่มีข้อมูลประวัติสำหรับห้อง ${roomId}</td></tr>`;
    resetStats();
    return;
  }

  // Reverse to show oldest first
  history.reverse();

  // Calculate statistics
  const trendData = calculateTrendData(roomId, selectedMonths);
  updateStats(trendData);

  // Render table
  renderHistoryTable(history);

  // Render chart
  renderUsageChart(history, `ห้อง ${roomId}`);

  // Show month-over-month comparison
  if (history.length >= 2) {
    showComparison(history);
  }
}

function loadAllRoomsHistory() {
  const history = JSON.parse(localStorage.getItem('meterHistory') || '{}');

  let allHistory = [];
  for (const roomId of NEST_ROOMS) {
    if (history[roomId]) {
      allHistory = allHistory.concat(history[roomId].slice(-selectedMonths));
    }
  }

  if (allHistory.length === 0) {
    document.getElementById('historyTable').innerHTML =
      `<tr><td colspan="7" style="text-align: center; color: #6b7a8d;">ไม่มีข้อมูลประวัติ</td></tr>`;
    resetStats();
    return;
  }

  // Sort by month
  allHistory.sort((a, b) => a.month.localeCompare(b.month));

  // Calculate totals
  const totalWater = allHistory.reduce((sum, h) => sum + (h.waterUsage || 0), 0);
  const totalElectric = allHistory.reduce((sum, h) => sum + (h.electricUsage || 0), 0);
  const avgWater = (totalWater / allHistory.length).toFixed(1);
  const avgElectric = (totalElectric / allHistory.length).toFixed(1);

  document.getElementById('avgWater').textContent = avgWater + ' หน่วย';
  document.getElementById('avgElectric').textContent = avgElectric + ' หน่วย';
  document.getElementById('maxWater').textContent = Math.max(...allHistory.map(h => h.waterUsage)) + ' หน่วย';
  document.getElementById('maxElectric').textContent = Math.max(...allHistory.map(h => h.electricUsage)) + ' หน่วย';

  // Render table
  renderHistoryTable(allHistory, true);

  // Group by month for chart
  renderAggregateChart(allHistory);
}

// ===== STATISTICS & DISPLAY =====

function updateStats(trendData) {
  if (!trendData) {
    resetStats();
    return;
  }

  document.getElementById('avgWater').textContent = trendData.waterAverage + ' หน่วย';
  document.getElementById('avgElectric').textContent = trendData.electricAverage + ' หน่วย';
  document.getElementById('maxWater').textContent = trendData.waterMax + ' หน่วย';
  document.getElementById('maxElectric').textContent = trendData.electricMax + ' หน่วย';
}

function resetStats() {
  document.getElementById('avgWater').textContent = '--- หน่วย';
  document.getElementById('avgElectric').textContent = '--- หน่วย';
  document.getElementById('maxWater').textContent = '--- หน่วย';
  document.getElementById('maxElectric').textContent = '--- หน่วย';
}

// ===== TABLE RENDERING =====

function renderHistoryTable(historyData, isAggregate = false) {
  const tbody = document.getElementById('historyTable');
  tbody.innerHTML = '';

  if (!historyData || historyData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #6b7a8d;">ไม่มีข้อมูล</td></tr>`;
    return;
  }

  historyData.forEach(row => {
    const tr = document.createElement('tr');

    const monthDisplay = row.monthName ? `${row.monthName} (${row.month})` : row.month;
    const recordedDate = row.recordedAt ? formatThaiDate(row.recordedAt) : '---';

    tr.innerHTML = `
      <td><strong>${monthDisplay}</strong></td>
      <td>${row.waterUsage || 0}</td>
      <td>${row.electricUsage || 0}</td>
      <td>${formatCurrency(row.waterCharge || 0)}</td>
      <td>${formatCurrency(row.electricCharge || 0)}</td>
      <td><strong>${formatCurrency(row.totalCharge || 0)}</strong></td>
      <td>${recordedDate}</td>
    `;

    tbody.appendChild(tr);
  });
}

function showComparison(historyData) {
  if (historyData.length < 2) {
    document.getElementById('comparisonTable').innerHTML =
      '<p style="text-align: center; color: #6b7a8d;">ต้องมีข้อมูลอย่างน้อย 2 เดือนเพื่อเปรียบเทียบ</p>';
    return;
  }

  const current = historyData[historyData.length - 1];
  const previous = historyData[historyData.length - 2];

  const waterChange = current.waterUsage - previous.waterUsage;
  const electricChange = current.electricUsage - previous.electricUsage;
  const costChange = current.totalCharge - previous.totalCharge;

  const waterPercent = ((waterChange / previous.waterUsage) * 100).toFixed(1);
  const electricPercent = ((electricChange / previous.electricUsage) * 100).toFixed(1);
  const costPercent = ((costChange / previous.totalCharge) * 100).toFixed(1);

  const waterTrend = waterChange >= 0 ? '📈' : '📉';
  const electricTrend = electricChange >= 0 ? '📈' : '📉';
  const costTrend = costChange >= 0 ? '📈' : '📉';

  let html = `
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
      <div style="background: #f4f6f8; padding: 1rem; border-radius: 8px; border-left: 4px solid #ffc107;">
        <div style="font-size: 0.9rem; color: #6b7a8d;">ค่าน้ำ</div>
        <div style="font-size: 1.3rem; font-weight: 700; margin: 0.5rem 0;">
          ${current.waterUsage} หน่วย ${waterTrend}
        </div>
        <div style="font-size: 0.85rem;">
          <span class="${waterChange >= 0 ? 'trend-down' : 'trend-up'}">
            ${Math.abs(waterChange)} หน่วย (${Math.abs(waterPercent)}%)
          </span>
          จากเดือนที่แล้ว
        </div>
      </div>

      <div style="background: #f4f6f8; padding: 1rem; border-radius: 8px; border-left: 4px solid #ffc107;">
        <div style="font-size: 0.9rem; color: #6b7a8d;">ค่าไฟ</div>
        <div style="font-size: 1.3rem; font-weight: 700; margin: 0.5rem 0;">
          ${current.electricUsage} หน่วย ${electricTrend}
        </div>
        <div style="font-size: 0.85rem;">
          <span class="${electricChange >= 0 ? 'trend-down' : 'trend-up'}">
            ${Math.abs(electricChange)} หน่วย (${Math.abs(electricPercent)}%)
          </span>
          จากเดือนที่แล้ว
        </div>
      </div>

      <div style="background: #f4f6f8; padding: 1rem; border-radius: 8px; border-left: 4px solid #1976d2;">
        <div style="font-size: 0.9rem; color: #6b7a8d;">รวมค่าใช้</div>
        <div style="font-size: 1.3rem; font-weight: 700; margin: 0.5rem 0;">
          ${formatCurrency(current.totalCharge)} ${costTrend}
        </div>
        <div style="font-size: 0.85rem;">
          <span class="${costChange >= 0 ? 'trend-down' : 'trend-up'}">
            ${formatCurrency(Math.abs(costChange))} (${Math.abs(costPercent)}%)
          </span>
          จากเดือนที่แล้ว
        </div>
      </div>
    </div>
  `;

  document.getElementById('comparisonTable').innerHTML = html;
}

// ===== CHART RENDERING =====

function renderUsageChart(historyData, title) {
  const ctx = document.getElementById('usageChart').getContext('2d');

  // Prepare data
  const labels = historyData.map(h => h.monthName || h.month);
  const waterData = historyData.map(h => h.waterUsage);
  const electricData = historyData.map(h => h.electricUsage);

  // Destroy previous chart
  if (usageChart) {
    usageChart.destroy();
  }

  usageChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '💧 ค่าน้ำ (หน่วย)',
          data: waterData,
          borderColor: '#1976d2',
          backgroundColor: 'rgba(25, 118, 210, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#1976d2',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        },
        {
          label: '⚡ ค่าไฟ (หน่วย)',
          data: electricData,
          borderColor: '#ffc107',
          backgroundColor: 'rgba(255, 193, 7, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#ffc107',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `${title}`,
          font: { size: 14, weight: 'bold' }
        },
        legend: {
          display: true,
          position: 'bottom'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderAggregateChart(historyData) {
  const ctx = document.getElementById('usageChart').getContext('2d');

  // Group by month and sum
  const monthData = {};
  historyData.forEach(row => {
    if (!monthData[row.month]) {
      monthData[row.month] = {
        water: 0,
        electric: 0,
        month: row.monthName || row.month
      };
    }
    monthData[row.month].water += row.waterUsage || 0;
    monthData[row.month].electric += row.electricUsage || 0;
  });

  const sortedMonths = Object.keys(monthData).sort();
  const labels = sortedMonths.map(m => monthData[m].month);
  const waterData = sortedMonths.map(m => monthData[m].water);
  const electricData = sortedMonths.map(m => monthData[m].electric);

  if (usageChart) {
    usageChart.destroy();
  }

  usageChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: '💧 ค่าน้ำรวม (หน่วย)',
          data: waterData,
          backgroundColor: '#1976d2',
          borderRadius: 8
        },
        {
          label: '⚡ ค่าไฟรวม (หน่วย)',
          data: electricData,
          backgroundColor: '#ffc107',
          borderRadius: 8
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: 'รวมการใช้งาน (ทั้งหมด)',
          font: { size: 14, weight: 'bold' }
        },
        legend: {
          display: true,
          position: 'bottom'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ===== EXPORT FUNCTIONALITY =====

function exportHistory() {
  const selectedRoom = document.getElementById('roomFilter').value;

  if (!selectedRoom) {
    alert('❌ กรุณาเลือกห้องก่อน');
    return;
  }

  const history = getMeterHistoryForRoom(selectedRoom, selectedMonths);

  if (!history || history.length === 0) {
    alert('❌ ไม่มีข้อมูลที่จะส่งออก');
    return;
  }

  // Create CSV
  let csv = 'เดือน,ค่าน้ำ (หน่วย),ค่าไฟ (หน่วย),ค่าน้ำ (บาท),ค่าไฟ (บาท),รวมทั้งสิ้น (บาท),บันทึกเมื่อ\n';

  history.forEach(row => {
    const monthDisplay = row.monthName || row.month;
    const recordedDate = row.recordedAt ? formatThaiDate(row.recordedAt) : '---';

    csv += `"${monthDisplay}",${row.waterUsage || 0},${row.electricUsage || 0},${row.waterCharge || 0},${row.electricCharge || 0},${row.totalCharge || 0},"${recordedDate}"\n`;
  });

  // Download
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `meter_history_room_${selectedRoom}_${new Date().getTime()}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  logAudit('METER_HISTORY_EXPORTED', {
    room: selectedRoom,
    monthsExported: selectedMonths,
    format: 'CSV'
  });

  alert('✅ ส่งออกข้อมูลสำเร็จ');
}

// ===== HELPER FUNCTIONS =====

function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

function formatThaiDate(isoDate) {
  const d = new Date(isoDate);
  const day = d.getDate();
  const month = getMonthNameThai(d.getMonth() + 1);
  const year = d.getFullYear() + 543;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year} เวลา ${hours}:${minutes}`;
}

function logout() {
  if (confirm('ต้องการออกจากระบบหรือไม่?')) {
    localStorage.removeItem('currentUser');
    window.location.href = '/login';
  }
}

// ===== PAGE INITIALIZATION =====

window.addEventListener('load', initHistoryPage);
