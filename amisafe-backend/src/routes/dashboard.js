// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — GET /api/dashboard
//  Public aggregate stats — no individual reports exposed.
// ═══════════════════════════════════════════════════════════════
import { Router }            from 'express';
import { getDashboardStats } from '../services/db.js';
import { dashboardLimiter }  from '../middleware/rateLimit.js';

const router = Router();

// Simple in-memory cache — refreshes every 5 minutes
// (avoids hammering the DB on every dashboard page load)
let cache = null;
let cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ── GET /api/dashboard ────────────────────────────────────────
router.get('/', dashboardLimiter, async (_req, res) => {
  try {
    const now = Date.now();

    if (cache && (now - cacheTs) < CACHE_TTL) {
      return res.json({ ...cache, cached: true });
    }

    const stats = await getDashboardStats();

    // Round totals to nearest 5 for privacy (already done in SQL view
    // but we double-check here for the raw totals query)
    const safeTotal = Math.round(Number(stats.totals.public_count) / 5) * 5;

    const payload = {
      generated_at:  new Date().toISOString(),
      totals: {
        reports:         safeTotal,
        with_evidence:   Math.round(Number(stats.totals.with_evidence) / 5) * 5,
        platform_count:  Number(stats.totals.platform_count),
      },
      by_harm_type:   stats.by_harm_type.map((r) => ({
        harm_type: r.harm_type,
        count:     Math.round(Number(r.count) / 5) * 5,
      })),
      by_platform:    stats.by_platform.map((r) => ({
        platform: r.platform_domain,
        count:    Math.round(Number(r.count) / 5) * 5,
      })),
      by_language:    stats.by_language.map((r) => ({
        language: r.language,
        count:    Math.round(Number(r.count) / 5) * 5,
      })),
      weekly_trend:   stats.weekly_trend.map((r) => ({
        week:  r.week,
        count: Number(r.count),
      })),
      privacy_note: 'All counts rounded to nearest 5. Only anonymised and partner-share reports included.',
    };

    cache   = payload;
    cacheTs = now;

    return res.json(payload);
  } catch (err) {
    console.error('Dashboard error:', err.message);
    return res.status(500).json({ error: 'Dashboard data unavailable' });
  }
});

export default router;
