/**
 * routes/patterns.js — Public pattern intelligence endpoint
 */
import { Router } from 'express';
import { pool }   from '../db/pool.js';

const router = Router();

// GET /api/patterns — confirmed and emerging clusters (no individual reports)
router.get('/', async (req, res) => {
  const { category, country, status = 'confirmed', limit = 20, offset = 0 } = req.query;

  const conditions = [`status != 'false_positive'`];
  const params     = [];

  if (status)   { conditions.push(`status = $${params.push(status)}`); }
  if (category) { conditions.push(`category = $${params.push(category)}`); }
  if (country)  { conditions.push(`$${params.push(country)} = ANY(country_codes)`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       id, category, platform, country_codes, languages,
       report_count, status, summary, created_at, updated_at, signal_sent
     FROM pattern_clusters
     ${where}
     ORDER BY report_count DESC, updated_at DESC
     LIMIT $${params.push(parseInt(limit))}
     OFFSET $${params.push(parseInt(offset))}`,
    params
  );

  res.json({ patterns: rows });
});

// GET /api/patterns/:id — single cluster detail
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
       id, category, platform, country_codes, languages,
       report_count, status, summary, created_at, updated_at
     FROM pattern_clusters WHERE id = $1 AND status != 'false_positive'`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Pattern not found' });
  res.json(rows[0]);
});

export default router;
