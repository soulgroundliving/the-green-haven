/**
 * Mobile-Friendly Meter Trends Display
 * Enhanced version for tenant.html
 *
 * This replaces the displayMeterTrends() function with a mobile-optimized version
 * that properly scales charts and tables for all screen sizes.
 *
 * IMPROVEMENTS:
 * ✅ Responsive chart that scales to mobile
 * ✅ Responsive table with collapsible columns on mobile
 * ✅ Touch-friendly interaction (larger tap targets)
 * ✅ Optimized font sizes for mobile
 * ✅ Better spacing and padding
 * ✅ Mobile-first design
 */

/**
 * Mobile-optimized meter trends display function
 * Replace the existing displayMeterTrends() with this version
 */
function displayMeterTrendsMobile() {
  const container = document.getElementById('meterTrendsContainer');
  const canvas = document.getElementById('meterTrendsChart');
  const tbody = document.getElementById('meterTrendsTableBody');

  if (!container || !canvas || !tbody) return;

  // Check if tenant has any meter data
  if (!hasAnyMeterData()) {
    container.innerHTML = '<div style="background: var(--info-pale); padding: 0.8rem 1rem; border-radius: 8px; text-align: center; color: var(--neutral);">📊 ยังไม่มีข้อมูลการใช้พลังงาน (ผู้เช่าใหม่)</div>';
    container.style.display = 'block';
    return;
  }

  try {
    container.style.display = 'block';

    // Load all bills from localStorage
    let allBills = [];
    for (const year of [2567, 2568, 2569, 2570]) {
      const billsKey = `bills_${year}`;
      const billsData = localStorage.getItem(billsKey);
      if (billsData) {
        const parsed = JSON.parse(billsData);
        const yearBills = parsed.filter(b => {
          return b.building === currentBuilding && b.roomId === currentRoom;
        });
        allBills.push(...yearBills);
      }
    }

    // Build trends from bills
    const trends = [];
    const today = new Date();

    for (let i = 11; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const buddhistYear = year + 543;
      const buddhistYearShort = buddhistYear - 2500;

      const bill = allBills.find(b => b.year === buddhistYearShort && b.month === month);

      if (bill && bill.charges) {
        const thaiMonth = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const daysInMonth = new Date(year, month, 0).getDate();

        trends.push({
          month: thaiMonth[month],
          monthNum: month,
          year: year,
          electricUsage: bill.charges?.electric?.usage || 0,
          waterUsage: bill.charges?.water?.usage || 0,
          monthStr: `${thaiMonth[month]} ${buddhistYear}`,
          daysInMonth: daysInMonth,
          electricDaily: ((bill.charges?.electric?.usage || 0) / daysInMonth).toFixed(2),
          waterDaily: ((bill.charges?.water?.usage || 0) / daysInMonth).toFixed(2)
        });
      }
    }

    // Detect screen size for responsive design
    const isMobile = window.innerWidth < 768;
    const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;

    // Set canvas size based on screen size
    const containerWidth = canvas.parentElement.offsetWidth;
    let canvasWidth = containerWidth;
    let canvasHeight = isMobile ? 250 : (isTablet ? 280 : 300);

    if (isMobile) {
      canvasWidth = Math.min(containerWidth - 20, 400); // Leave padding on mobile
    } else if (isTablet) {
      canvasWidth = Math.min(containerWidth, 700);
    } else {
      canvasWidth = Math.min(containerWidth, 900);
    }

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';

    // Update chart data structure
    if (trends.length > 0) {
      const chartData = trends.map(t => ({
        month: t.month,
        electric: t.electricUsage,
        water: t.waterUsage,
        electricDaily: t.electricDaily,
        waterDaily: t.waterDaily
      }));

      // Draw the chart with responsive sizing
      const ctx = canvas.getContext('2d');
      const padding = isMobile ? 35 : 40;
      const chartWidth = canvas.width - (padding * 2);
      const chartHeight = canvas.height - (padding * 2);

      // Calculate bar width based on screen size
      let barWidth;
      let barGap;

      if (isMobile) {
        // Tighter spacing on mobile for better readability
        barWidth = chartWidth / (chartData.length * 3);
        barGap = barWidth * 0.3;
      } else {
        barWidth = chartWidth / (chartData.length * 2.5);
        barGap = barWidth * 0.5;
      }

      const maxElectric = Math.max(...chartData.map(d => d.electric), 1);
      const maxWater = Math.max(...chartData.map(d => d.water), 1);
      const maxValue = Math.max(maxElectric, maxWater) * 1.1;

      // Draw background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid lines
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const y = padding + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(canvas.width - padding, y);
        ctx.stroke();

        ctx.fillStyle = '#666';
        ctx.font = isMobile ? '10px Arial' : '12px Arial';
        ctx.textAlign = 'right';
        const value = Math.round((maxValue / 5) * (5 - i));
        ctx.fillText(value, padding - 10, y + 4);
      }

      // Draw bars
      chartData.forEach((data, idx) => {
        const x = padding + (idx * (barWidth * 2 + barGap));
        const electricHeight = (data.electric / maxValue) * chartHeight;
        const waterHeight = (data.water / maxValue) * chartHeight;

        // Electric bar (orange)
        ctx.fillStyle = '#FFB84D';
        ctx.fillRect(x, padding + chartHeight - electricHeight, barWidth, electricHeight);

        // Water bar (blue)
        ctx.fillStyle = '#64B5F6';
        ctx.fillRect(x + barWidth + 4, padding + chartHeight - waterHeight, barWidth, waterHeight);

        // Month label
        ctx.fillStyle = '#333';
        ctx.font = isMobile ? 'bold 9px Arial' : 'bold 11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(data.month, x + barWidth, canvas.height - 15);
      });

      // Draw axes
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, padding + chartHeight);
      ctx.lineTo(canvas.width - padding, padding + chartHeight);
      ctx.stroke();

      // Add interactive tooltip
      const tooltip = document.createElement('div');
      tooltip.id = 'chartTooltip';
      tooltip.style.cssText = `
        position: absolute;
        background: rgba(0,0,0,0.9);
        color: white;
        padding: 8px 10px;
        border-radius: 6px;
        font-size: ${isMobile ? '12px' : '13px'};
        pointer-events: none;
        z-index: 1000;
        display: none;
        white-space: nowrap;
      `;

      if (!document.getElementById('chartTooltip')) {
        canvas.parentElement.style.position = 'relative';
        canvas.parentElement.appendChild(tooltip);
      } else {
        const existing = document.getElementById('chartTooltip');
        existing.parentElement.removeChild(existing);
        canvas.parentElement.appendChild(tooltip);
      }

      // Track bar positions for hover/touch detection
      const barPositions = [];
      chartData.forEach((data, idx) => {
        const x = padding + (idx * (barWidth * 2 + barGap));
        barPositions.push({
          month: data.month,
          electric: data.electric,
          water: data.water,
          x: x,
          width: barWidth * 2 + 4
        });
      });

      // Handle mouse and touch events
      function showTooltip(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const posX = clientX - rect.left;
        const posY = clientY - rect.top;

        // Check if position is in chart area
        if (posX < padding || posX > canvas.width - padding ||
            posY < padding || posY > padding + chartHeight) {
          tooltip.style.display = 'none';
          return;
        }

        // Find which bar is hovered/tapped
        for (let bar of barPositions) {
          if (posX >= bar.x && posX <= bar.x + bar.width) {
            tooltip.innerHTML = `<strong>${bar.month}</strong><br>⚡ ${Math.round(bar.electric)} หน่วย<br>💧 ${Math.round(bar.water)} หน่วย`;
            tooltip.style.display = 'block';
            tooltip.style.left = (posX - 50) + 'px';
            tooltip.style.top = (posY - 60) + 'px';
            canvas.style.cursor = 'pointer';
            return;
          }
        }
        tooltip.style.display = 'none';
        canvas.style.cursor = 'default';
      }

      // Mouse events (desktop)
      canvas.addEventListener('mousemove', (e) => {
        showTooltip(e.clientX, e.clientY);
      });

      canvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
        canvas.style.cursor = 'default';
      });

      // Touch events (mobile/tablet) - larger tap targets
      canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
          e.preventDefault();
          showTooltip(e.touches[0].clientX, e.touches[0].clientY);
        }
      });

      canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
          e.preventDefault();
          showTooltip(e.touches[0].clientX, e.touches[0].clientY);
        }
      });

      canvas.addEventListener('touchend', () => {
        tooltip.style.display = 'none';
      });
    }

    // Calculate averages
    const avgElectric = trends.reduce((sum, t) => sum + t.electricUsage, 0) / trends.length;
    const avgWater = trends.reduce((sum, t) => sum + t.waterUsage, 0) / trends.length;
    const avgElectricDaily = trends.reduce((sum, t) => sum + parseFloat(t.electricDaily), 0) / trends.length;
    const avgWaterDaily = trends.reduce((sum, t) => sum + parseFloat(t.waterDaily), 0) / trends.length;

    // Update table headers
    const electricUsageHeader = document.getElementById('electricUsageHeader');
    const waterUsageHeader = document.getElementById('waterUsageHeader');
    const electricDailyHeader = document.getElementById('electricDailyHeader');
    const waterDailyHeader = document.getElementById('waterDailyHeader');

    if (electricUsageHeader) electricUsageHeader.textContent = `⚡ ไฟฟ้า (${avgElectric.toFixed(0)} เฉลี่ย)`;
    if (waterUsageHeader) waterUsageHeader.textContent = `💧 น้ำ (${avgWater.toFixed(0)} เฉลี่ย)`;
    if (electricDailyHeader) electricDailyHeader.textContent = `⚡ เฉลี่ยวัน (${avgElectricDaily.toFixed(2)})`;
    if (waterDailyHeader) waterDailyHeader.textContent = `💧 เฉลี่ยวัน (${avgWaterDaily.toFixed(2)})`;

    // Render responsive table
    tbody.innerHTML = trends.map((trend) => {
      const electricDaily = parseFloat(trend.electricDaily);
      const waterDaily = parseFloat(trend.waterDaily);

      if (isMobile) {
        // Mobile view: Stacked card layout instead of table
        return `
          <tr style="display: block; background: white; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 0.8rem; padding: 0.8rem;">
            <td style="display: block; padding: 0; margin-bottom: 0.4rem;">
              <strong style="font-size: 1rem;">${trend.monthStr}</strong>
            </td>
            <td style="display: block; padding: 0; margin-bottom: 0.3rem; font-size: 0.95rem;">
              <div style="display: flex; justify-content: space-between;">
                <span>⚡ ไฟฟ้า:</span>
                <span style="font-weight: 600;">${trend.electricUsage.toFixed(0)} หน่วย</span>
              </div>
              <div style="display: flex; justify-content: space-between; color: var(--neutral); font-size: 0.85rem;">
                <span>└─ เฉลี่ยวัน:</span>
                <span>${electricDaily.toFixed(2)} หน่วย</span>
              </div>
            </td>
            <td style="display: block; padding: 0; margin-bottom: 0;">
              <div style="display: flex; justify-content: space-between;">
                <span>💧 น้ำ:</span>
                <span style="font-weight: 600;">${trend.waterUsage.toFixed(0)} หน่วย</span>
              </div>
              <div style="display: flex; justify-content: space-between; color: var(--neutral); font-size: 0.85rem;">
                <span>└─ เฉลี่ยวัน:</span>
                <span>${waterDaily.toFixed(2)} หน่วย</span>
              </div>
            </td>
          </tr>
        `;
      } else {
        // Desktop/Tablet view: Table format
        return `
          <tr style="border-bottom: 1px solid var(--border); font-size: ${isTablet ? '0.9rem' : '0.95rem'};">
            <td style="padding: 0.6rem; text-align: left; font-weight: 600;">${trend.monthStr}</td>
            <td style="padding: 0.6rem; text-align: center;">${trend.electricUsage.toFixed(0)}</td>
            <td style="padding: 0.6rem; text-align: center;">${electricDaily.toFixed(2)}</td>
            <td style="padding: 0.6rem; text-align: center;">${trend.waterUsage.toFixed(0)}</td>
            <td style="padding: 0.6rem; text-align: center;">${waterDaily.toFixed(2)}</td>
          </tr>
        `;
      }
    }).join('');

  } catch (error) {
    console.error('❌ Error in displayMeterTrendsMobile:', error);
    container.innerHTML = `<div style="background: #ffebee; padding: 0.8rem 1rem; border-radius: 8px; text-align: center; color: #c62828;">❌ เกิดข้อผิดพลาด: ${error.message}</div>`;
    container.style.display = 'block';
  }
}

/**
 * Hide meter trends
 */
function hideMeterTrends() {
  const container = document.getElementById('meterTrendsContainer');
  if (container) {
    container.style.display = 'none';
  }
}

/**
 * Handle window resize for responsive chart
 */
window.addEventListener('resize', debounce(() => {
  const container = document.getElementById('meterTrendsContainer');
  if (container && container.style.display !== 'none') {
    displayMeterTrendsMobile();
  }
}, 300));

/**
 * Debounce function to prevent excessive recalculations
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
