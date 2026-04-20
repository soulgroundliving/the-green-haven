/**
 * Gamification Rules — Single Source of Truth
 *
 * Canonical level tiers and badge catalog for Green Haven.
 * Shared between the tenant app (browser) and Cloud Functions (Node).
 *
 * UMD-style export:
 *   - Browser: attaches to `window.GamificationRules`
 *   - Node/CF: `module.exports`
 *
 * For Cloud Functions, this file is copied to `functions/gamification-rules.js`
 * at deploy time via firebase.json predeploy hook (see functions/package.json
 * "sync-shared" script). Do NOT edit the functions/ copy manually — it's
 * regenerated on every functions deploy.
 *
 * Related: memory/point_economy_rules.md — Nest-only, 10pts=1บาท,
 * on-time rent 150/100/40/15/0 by daysDiff.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.GamificationRules = api;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // ===== LEVEL TIERS (tenant-facing) =====
    // Point thresholds matched to memory/point_economy_rules.md earning rates.
    // Max plausible earn ~5,800 pts/คน/ปี, so Forest Master (3000+) is a 2-year target.
    // `level` is the 1-based tier index — used by UI that shows "Lv.N {name}"
    // (e.g. the world-map badge). Keep sequential; if a tier is added/removed,
    // renumber all levels.
    const LEVEL_TIERS = [
        { id: 'seedling',      name: 'Seedling',      emoji: '🌱', level: 1, min: 0,    max: 299 },
        { id: 'sprout',        name: 'Sprout',        emoji: '🌿', level: 2, min: 300,  max: 699 },
        { id: 'blooming',      name: 'Blooming',      emoji: '🌸', level: 3, min: 700,  max: 1499 },
        { id: 'guardian',      name: 'Guardian',      emoji: '🌳', level: 4, min: 1500, max: 2999 },
        { id: 'forest_master', name: 'Forest Master', emoji: '🏆', level: 5, min: 3000, max: Infinity }
    ];

    // ===== BADGE CATALOG =====
    // Awarded by functions/complaintAndGamification.js checkAndAwardBadges()
    // based on gamification.points crossing minPts threshold.
    const BADGE_CATALOG = [
        { id: 'first_month',     emoji: '🥇', label: 'The First Generation', minPts: 0    },
        { id: 'on_time',         emoji: '⏰', label: 'On Time',               minPts: 50   },
        { id: 'community_star',  emoji: '⭐', label: 'Community Star',        minPts: 75   },
        { id: 'green_guardian',  emoji: '🌿', label: 'Green Guardian',        minPts: 100  },
        { id: 'loyal_resident',  emoji: '💎', label: 'Loyal Resident',        minPts: 250  },
        { id: 'rising_star',     emoji: '🌟', label: 'Rising Star',           minPts: 300  },
        { id: 'perfect_record',  emoji: '🏆', label: 'Perfect Record',        minPts: 500  },
        { id: 'master_resident', emoji: '👑', label: 'Master Resident',       minPts: 1000 }
    ];

    // ===== RENT PAYMENT TIERS =====
    // daysDiff (slip transfer date vs dueDate) → points table.
    // Computed server-side in functions/verifySlip.js recordPaymentAndAwardPoints().
    // Client uses this to render the 5-column grid in "วิธีสะสมคะแนน".
    const RENT_POINT_TIERS = [
        { id: 'early_bird',    points: 150, label: 'ก่อน 4 วัน',  color: 'green'  },
        { id: 'on_time',       points: 100, label: 'ตรงเวลา',     color: 'green'  },
        { id: 'slightly_late', points: 40,  label: 'ช้า 1-3 วัน', color: 'yellow' },
        { id: 'late',          points: 15,  label: 'ช้า 4-5 วัน', color: 'orange' },
        { id: 'too_late',      points: 0,   label: 'ช้า ≥6 วัน',  color: 'gray'   }
    ];

    // ===== EARNING SOURCES =====
    // The "วิธีสะสมคะแนน" list shown on Profile → Achievements tab.
    // Values match memory/point_economy_rules.md earning table.
    // `tiered: true` means the card renders the RENT_POINT_TIERS grid instead
    // of a single "+N Pts" badge.
    const EARNING_SOURCES = [
        { id: 'save_water',     emoji: '💧', title: 'ประหยัดน้ำ (-10%)',       subtitle: 'เทียบกับค่าเฉลี่ย',               points: 20,  display: '+20 Pts' },
        { id: 'save_elec',      emoji: '⚡', title: 'ประหยัดไฟ (-10%)',       subtitle: 'เทียบกับค่าเฉลี่ย',               points: 30,  display: '+30 Pts' },
        { id: 'rent_ontime',    emoji: '📅', title: 'จ่ายค่าเช่าตรงเวลา',     subtitle: 'วันครบกำหนด: วันที่ 5 ของเดือน', tiered: true },
        { id: 'community',      emoji: '🌱', title: 'เข้าร่วมกิจกรรมชุมชน',   subtitle: 'สูงสุด 2 ครั้ง/เดือน',           points: 100, display: '+100 Pts' },
        { id: 'complaint_free', emoji: '🤝', title: 'ไม่มีการร้องเรียน 3+ เดือน', subtitle: 'โบนัสรายไตรมาส',             points: 50,  display: '+50 Pts' },
        { id: 'daily_login',    emoji: '📱', title: 'เช็คอินรายวัน',           subtitle: 'โบนัสครบ 7 วัน +3',              points: 1,   display: '+1 Pt/วัน' }
    ];

    // ===== URGENT QUESTS =====
    // Featured time-bound quests shown on Profile → Rankings tab "ภารกิจเร่งด่วน".
    // Keep short (1-3 entries). Pre-launch this is a UX placeholder; post-launch
    // admin can move to a Firestore `quests` collection and subscribe if needed.
    const URGENT_QUESTS = [
        { id: 'solar_afternoon', emoji: '☀️', title: 'ลดใช้ไฟช่วงบ่าย', subtitle: 'สะสมพลังงานแสงอาทิตย์', points: 10, borderColor: 'orange' }
    ];

    // ===== HELPERS =====

    function getLevelForPoints(pts) {
        const p = Math.max(0, Number(pts) || 0);
        return LEVEL_TIERS.find(t => p >= t.min && p <= t.max) || LEVEL_TIERS[LEVEL_TIERS.length - 1];
    }

    function getLevelProgress(pts) {
        const p = Math.max(0, Number(pts) || 0);
        const tier = getLevelForPoints(p);
        const i = LEVEL_TIERS.indexOf(tier);
        const next = LEVEL_TIERS[i + 1] || null;
        const range = next ? (next.min - tier.min) : 1;
        const within = Math.max(0, p - tier.min);
        const progress = next ? Math.min(100, (within / range) * 100) : 100;
        return { tier, next, progress, ptsToNext: next ? Math.max(0, next.min - p) : 0 };
    }

    // Canonical id from a badge value — accepts string (legacy) or object.
    function badgeId(b) {
        if (!b) return '';
        if (typeof b === 'string') return b.toLowerCase().replace(/ /g, '_');
        return b.id || '';
    }

    // Convert legacy badge formats (string[] or inconsistent objects) to
    // canonical [{ id, emoji, label, earnedAt }] shape. Uses BADGE_CATALOG
    // to enrich string-only entries with emoji/label.
    function normaliseBadges(raw, nowISO) {
        if (!Array.isArray(raw)) return [];
        return raw.map(b => {
            if (typeof b === 'string') {
                const id = badgeId(b);
                const match = BADGE_CATALOG.find(c => c.id === id || c.label === b);
                return match
                    ? { id: match.id, emoji: match.emoji, label: match.label, earnedAt: nowISO }
                    : { id, emoji: '🏅', label: b, earnedAt: nowISO };
            }
            return b;
        });
    }

    return {
        LEVEL_TIERS,
        BADGE_CATALOG,
        RENT_POINT_TIERS,
        EARNING_SOURCES,
        URGENT_QUESTS,
        getLevelForPoints,
        getLevelProgress,
        badgeId,
        normaliseBadges
    };
}));
