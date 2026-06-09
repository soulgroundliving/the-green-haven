// ===== World Map dynamic background — time + weather (5 modes) =====
// Extracted from tenant_app.html. Exports:
//   window.updateWorldMapBg  — called on load + setInterval 30min + showPage(payment/usage)
//   window.updateDashboard   — called on load + authReady/firebaseInitialized events + setInterval 15min
//   window._TH_DATE_FMT      — Intl formatter used by renderTicketsList() in inline script
(function () {
    'use strict';

    // Hoist Intl formatters — `new Intl.DateTimeFormat(...)` is expensive (~ms each
    // on mobile). Called per world-map refresh tick + per ticket render.
    const _BKK_HOUR_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', hour: 'numeric', hour12: false });
    const _TH_DATE_FMT = new Intl.DateTimeFormat('th-TH');
    window._TH_DATE_FMT = _TH_DATE_FMT; // used by renderTicketsList() in inline script

    function _bangkokHour() {
        try {
            const parts = _BKK_HOUR_FMT.formatToParts(new Date());
            const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
            return isNaN(h) ? new Date().getHours() : h;
        } catch (_) { return new Date().getHours(); }
    }

    function _isRainCode(code) {
        // WMO: 45-48 fog, 51-67 drizzle/rain, 80-82 showers, 95-99 thunderstorm
        if (code == null) return false;
        return (code >= 45 && code <= 48) || (code >= 51 && code <= 67) ||
               (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
    }

    function _isCloudyCode(code) {
        // WMO: 1-3 mainly clear / partly / overcast
        return code != null && code >= 1 && code <= 3;
    }

    const WORLD_MAP_GRADIENTS = {
        // Base weather/time modes
        'day-clear':   'linear-gradient(180deg, #cfe5d8 0%, #e8f5e9 50%, #f3ece0 100%)',
        'day-cloudy':  'linear-gradient(180deg, #b5c5c9 0%, #d4dcdb 55%, #e4e2d6 100%)',
        'rain':        'linear-gradient(180deg, #47525e 0%, #6b7a8d 55%, #8a9aa8 100%)',
        'dusk':        'linear-gradient(180deg, #f2a880 0%, #e8906a 50%, #7a5a6e 100%)',
        'night-clear': 'linear-gradient(180deg, #1a2332 0%, #2a3a50 45%, #3b5066 100%)',
        'night-rain':  'linear-gradient(180deg, #0d1520 0%, #1f2a38 55%, #2c3a48 100%)',
        // Holiday overrides
        'halloween':        'linear-gradient(180deg, #2d1a3a 0%, #5b2d5c 45%, #a84e3a 100%)',
        'christmas-night':  'linear-gradient(180deg, #1e2a3e 0%, #3a4a66 45%, #6b7f99 100%)',
        'christmas-day':    'linear-gradient(180deg, #d9e0e8 0%, #e8dfd0 55%, #f2d9c2 100%)',
        'newyear':          'linear-gradient(180deg, #7bc8f0 0%, #f4c87d 55%, #e89a55 100%)',
        'songkran':         'linear-gradient(180deg, #a0e1ff 0%, #fff2c2 55%, #ffd48a 100%)',
    };

    // Holiday windows (Asia/Bangkok) — ระบุ from/to เป็น {month:0-11, day, hour}
    // hour = null ครอบทั้งวัน; hour=17 คือ 17:00-24:00 ของวันนั้น; hour=6 คือ 00:00-05:59
    function _checkHoliday() {
        const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
        const month = d.getMonth();  // 0-11
        const day = d.getDate();
        const hour = d.getHours();

        // Halloween: 31 ต.ค. 17:00 → 1 พ.ย. 06:00
        if ((month === 9 && day === 31 && hour >= 17) ||
            (month === 10 && day === 1 && hour < 6)) return 'halloween';

        // Christmas: 24-26 ธ.ค. (แยก day/night)
        if (month === 11 && day >= 24 && day <= 26) {
            const isNight = (hour >= 18 || hour < 6);
            return isNight ? 'christmas-night' : 'christmas-day';
        }

        // New Year: 31 ธ.ค. – 2 ม.ค.
        if ((month === 11 && day === 31) || (month === 0 && day <= 2)) return 'newyear';

        // Songkran: 13-15 เม.ย. (ทั้งวัน)
        if (month === 3 && day >= 13 && day <= 15) return 'songkran';

        return null;
    }

    function _pickBgMode(weatherCode) {
        // 1. Holiday ชนะทุกอย่าง
        const holiday = _checkHoliday();
        if (holiday) return holiday;
        // 2. Regular modes ตามเวลา + อากาศ
        const h = _bangkokHour();
        const isNight = (h >= 19 || h < 6);
        const isDusk  = (h >= 17 && h < 19);  // 17:00-18:59 golden hour
        const rain = _isRainCode(weatherCode);
        if (isNight && rain) return 'night-rain';
        if (isNight) return 'night-clear';
        if (rain) return 'rain';
        if (isDusk) return 'dusk';            // ก่อนมืด golden hour
        if (_isCloudyCode(weatherCode)) return 'day-cloudy';
        return 'day-clear';
    }

    function updateWorldMapBg(weatherCode) {
        const mode = _pickBgMode(weatherCode);
        const container = document.querySelector('#world-map-page .map-container');
        const root = document.getElementById('world-map-page');
        if (!container) return;
        const img = `shared/bg/nest-${mode}.webp`;
        // stack fallback: image first → gradient (ถ้าไฟล์ 404 browser render gradient ซ้อน)
        container.style.backgroundImage = `url('${img}'), ${WORLD_MAP_GRADIENTS[mode]}`;
        container.style.backgroundSize = 'cover, cover';
        container.style.backgroundPosition = 'center, center';
        container.style.backgroundRepeat = 'no-repeat, no-repeat';
        // ตั้ง data attribute ให้ debug/test ได้
        if (root) root.dataset.bgMode = mode;
        // Frame-less chip (2026-06-09): no pill background — keep the name/level
        // legible on BOTH light (day) and dark (night/rain) map backgrounds via an
        // adaptive text colour + a matching text-shadow halo. Targets .map-chip-text
        // directly: the chip is now nested inside a flex row, so the old
        // ':scope > div' selected the wrapper, not the text.
        if (root) {
            const darkModes = ['night-clear','night-rain','rain','halloween','christmas-night'];
            const isDark = darkModes.includes(mode);
            root.querySelectorAll('.map-chip-text').forEach(p => {
                const isLevel = p.id === 'world-map-level';
                p.style.color = isDark
                    ? (isLevel ? '#bdf0b8' : '#ffffff')   // light green / white on dark bg
                    : (isLevel ? '#1f6b35' : '#1f2e22');  // deep green / near-black on light bg
                p.style.textShadow = isDark
                    ? '0 1px 3px rgba(0,0,0,0.6)'         // dark halo lifts light text off dark bg
                    : '0 1px 2px rgba(255,255,255,0.85)'; // light halo lifts dark text off light bg
            });
        }
    }

    // Pick weather emoji from Open-Meteo WMO weather_code + temperature
    // WMO codes: https://open-meteo.com/en/docs (0=clear, 1-3=cloudy, 45/48=fog, 51-67=rain, 71-77=snow, 80-82=showers, 95+=thunder)
    function pickWeatherEmoji(temp, code) {
        if (code >= 95) return '⛈️';        // thunderstorm
        if (code >= 71 && code <= 77) return '❄️';
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return '🌧️';
        if (code === 45 || code === 48) return '🌫️';
        if (temp >= 35) return '🥵';          // very hot
        if (temp >= 30) return '☀️';          // hot
        if (temp < 22) return '❄️';           // cold (for Thailand context)
        if (code >= 2) return '⛅';
        return '🌤️';
    }

    // US EPA AQI tier — labels (Thai), face emoji, and card background color.
    // Mirrors IQAir's tier visualization (the user's reference) so green/yellow/
    // orange/red/purple/maroon banding matches what tenants would see on iqair.com.
    function aqiTier(aqi) {
        if (aqi <= 50)  return { label: 'ดี',                    face: '😊', bg: '#A8E6A0' };
        if (aqi <= 100) return { label: 'ปานกลาง',               face: '😐', bg: '#FCD34D' };
        if (aqi <= 150) return { label: 'ไม่ดีต่อกลุ่มเสี่ยง',    face: '😷', bg: '#FB923C' };
        if (aqi <= 200) return { label: 'ไม่ดีต่อสุขภาพ',         face: '😷', bg: '#EF4444' };
        if (aqi <= 300) return { label: 'อันตราย',               face: '🤢', bg: '#A78BFA' };
        return                  { label: 'อันตรายมาก',           face: '☠️', bg: '#7F1D1D' };
    }

    async function updateDashboard() {
        const LAT = 13.92, LON = 100.64;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

        // Open-Meteo for weather (free, no key, exact lat/lon — IQAir's bundled
        // weather is at nearest-city granularity). IQAir-via-CF for AQI + main
        // pollutant — server-side cached 1h so we use ~720 of 10K monthly quota.
        // Both run in parallel; neither blocks the other.
        const [wPromise, aqPromise] = [
            fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=Asia%2FBangkok`),
            (async () => {
                if (!window.firebase?.functions?.httpsCallable) return null;
                // WAQI is station-level (Thai PCD sensors); IQAir Community tier
                // returns Sai Mai city aggregate which can lag the per-station value.
                const callable = window.firebase.functions.httpsCallable('getAirQualityWAQI');
                const r = await callable({ lat: LAT, lon: LON });
                return r?.data || null;
            })()
        ];

        const [wRes, aqRes] = await Promise.allSettled([wPromise, aqPromise]);

        // Weather (temperature + wind + humidity + condition emoji + heat alert)
        if (wRes.status === 'fulfilled') {
            try {
                const wData = await wRes.value.json();
                const temp  = Math.round(wData.current?.temperature_2m ?? 0);
                const code  = wData.current?.weather_code ?? 0;
                const wind  = Math.round(wData.current?.wind_speed_10m ?? 0);
                const humid = Math.round(wData.current?.relative_humidity_2m ?? 0);
                updateWorldMapBg(code);
                set('weather-emoji',   pickWeatherEmoji(temp, code));
                set('temp-display',    `${temp}°`);
                set('wind-display',    wind);
                set('humidity-display', humid);
                const heatAlert = document.getElementById('heat-alert');
                if (heatAlert) heatAlert.classList.toggle('hidden', temp < 35);
                const dateEl = document.getElementById('weather-date');
                if (dateEl) dateEl.textContent = new Date().toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            } catch (e) { console.error('Weather API parse error:', e); }
        }

        // Air quality from IQAir CF — { aqi, mainPollutant, mainLabel, concentration, ... }
        if (aqRes.status === 'fulfilled' && aqRes.value) {
            try {
                const d = aqRes.value;
                const aqi  = Math.round(Number(d.aqi) || 0);
                const tier = aqiTier(aqi);
                const card = document.getElementById('iqair-card');
                if (card) card.style.background = tier.bg;
                set('aqi-display',           aqi);
                set('aqi-label',             tier.label);
                set('aqi-face',              tier.face);
                set('main-pollutant-display', d.mainLabel || d.mainPollutant || 'PM2.5');
                set('pm25-display',          d.concentration != null ? d.concentration : '—');
            } catch (e) { console.error('AQI CF parse error:', e); }
        } else if (aqRes.status === 'rejected') {
            console.info('getAirQuality CF unavailable:', aqRes.reason?.message || aqRes.reason);
        }
    }

    window.updateWorldMapBg = updateWorldMapBg;
    window.updateDashboard  = updateDashboard;
})();
