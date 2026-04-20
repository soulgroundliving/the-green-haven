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
    const LEVEL_TIERS = [
        { id: 'seedling',      name: 'Seedling',      emoji: '🌱', min: 0,    max: 299 },
        { id: 'sprout',        name: 'Sprout',        emoji: '🌿', min: 300,  max: 699 },
        { id: 'blooming',      name: 'Blooming',      emoji: '🌸', min: 700,  max: 1499 },
        { id: 'guardian',      name: 'Guardian',      emoji: '🌳', min: 1500, max: 2999 },
        { id: 'forest_master', name: 'Forest Master', emoji: '🏆', min: 3000, max: Infinity }
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
        getLevelForPoints,
        getLevelProgress,
        badgeId,
        normaliseBadges
    };
}));
