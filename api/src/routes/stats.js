/**
 * routes/stats.js — Aggregate statistics for the public dashboard
 * No individual report data is ever returned here.
 */
import { Router } from 'express';
import { pool }   from '../db/pool.js';

const router = Router();

// GET /api/stats — aggregate totals
router.get('/', async (_req, res) => {
  const { rows: [totals] } = await pool.query(`
    SELECT
      COUNT(*)                                          AS total_reports,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')  AS reports_last_7d,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS reports_last_30d,
      COUNT(DISTINCT pseudo_id)                        AS unique_reporters,
      COUNT(DISTINCT platform)                         AS platforms_affected,
      COUNT(DISTINCT country_code)                     AS countries_affected
    FROM reports
    WHERE disclosure != 'private'
  `);

  const { rows: byCategory } = await pool.query(`
    SELECT category, COUNT(*) AS count
    FROM reports WHERE disclosure != 'private'
    GROUP BY category ORDER BY count DESC
  `);

  const { rows: byPlatform } = await pool.query(`
    SELECT platform, COUNT(*) AS count
    FROM reports WHERE disclosure != 'private' AND platform IS NOT NULL
    GROUP BY platform ORDER BY count DESC LIMIT 10
  `);

  const { rows: byLang } = await pool.query(`
    SELECT lang, COUNT(*) AS count
    FROM reports WHERE disclosure != 'private'
    GROUP BY lang ORDER BY count DESC
  `);

  const { rows: byCountry } = await pool.query(`
    SELECT country_code, COUNT(*) AS count
    FROM reports WHERE disclosure != 'private' AND country_code IS NOT NULL
    GROUP BY country_code ORDER BY count DESC LIMIT 20
  `);

  const { rows: [clusters] } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'emerging')  AS emerging,
      COUNT(*) FILTER (WHERE signal_sent = TRUE)   AS signals_sent
    FROM pattern_clusters
  `);

  // 30-day daily trend
  const { rows: trend } = await pool.query(`
    SELECT report_date::text AS date, COUNT(*) AS count
    FROM reports
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND disclosure != 'private'
    GROUP BY report_date
    ORDER BY report_date
  `);

  res.json({
    totals,
    byCategory,
    byPlatform,
    byLang,
    byCountry,
    clusters,
    trend,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
