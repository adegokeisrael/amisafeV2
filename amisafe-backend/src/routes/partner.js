// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — /api/partner/*
//  Authenticated endpoints for vetted research organisations.
//  Requires: Authorization: Bearer <api_key>
// ═══════════════════════════════════════════════════════════════
import { Router }              from 'express';
import { getAggregateForPartner, pool } from '../services/db.js';
import { requireApiKey, requireScope }  from '../middleware/auth.js';
import { partnerLimiter }               from '../middleware/rateLimit.js';

const router = Router();

// All partner routes require a valid API key
router.use(requireApiKey);
router.use(partnerLimiter);

// ── GET /api/partner/reports ──────────────────────────────────
// Aggregate report data filtered by harm_type, period, region.
// Never returns individual report rows — only grouped aggregates.
//
// Query params:
//   harm_type   string   optional  filter by harm type
//   period      string   optional  7d | 30d | 90d  (default: all)
//   limit       number   optional  max rows returned (default: 100, max: 500)

router.get('/reports', async (req, res) => {
  try {
    const rows = await getAggregateForPartner({
      harmType: req.query.harm_type || null,
      period:   req.query.period   || null,
      limit:    Math.min(parseInt(req.query.limit || '100'), 500),
    });

    return res.json({
      partner:     req.apiKey.label,
      scopes:      req.apiKey.scopes,
      record_count: rows.length,
      records:      rows,
      note:         'Individual reports are never exposed. All rows are pre-aggregated.',
    });
  } catch (err) {
    console.error('Partner reports error:', err.message);
    return res.status(500).json({ error: 'Data unavailable' });
  }
});

// ── GET /api/partner/signals ──────────────────────────────────
// Confirmed safety signals — same data as the public dashboard
// but with full narrative and recommended_action fields.

router.get('/signals', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT signal_ref, harm_type, platform_domain, period_days,
              report_count, evidence_rate, countries, languages,
              vs_prior_pct, status, narrative, created_at, confirmed_at
         FROM signals
        WHERE status = 'confirmed'
        ORDER BY confirmed_at DESC
        LIMIT 50`
    );

    return res.json({
      partner: req.apiKey.label,
      signals: rows,
    });
  } catch (err) {
    console.error('Partner signals error:', err.message);
    return res.status(500).json({ error: 'Signals unavailable' });
  }
});

// ── GET /api/partner/export ───────────────────────────────────
// Full anonymised CSV-style export — only for keys with export:bulk scope.

router.get('/export', requireScope('export:bulk'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days || '90'), 365);

    const { rows } = await pool.query(
      `SELECT pseudo_id, harm_type, platform_domain, language,
              evidence_types, tags, privacy_level,
              date_trunc('day', submitted_at) AS date
         FROM reports
        WHERE privacy_level IN ('anon','partner')
          AND submitted_at > now() - ($1 || ' days')::interval
        ORDER BY submitted_at DESC`,
      [days]
    );

    // Set CSV headers so browsers/tools download it correctly
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="amisafe-export-${new Date().toISOString().slice(0,10)}.csv"`
    );

    const header = 'pseudo_id,harm_type,platform_domain,language,evidence_types,tags,privacy_level,date\n';
    const lines  = rows.map((r) =>
      [
        r.pseudo_id,
        r.harm_type,
        r.platform_domain || '',
        r.language,
        (r.evidence_types || []).join('|'),
        (r.tags           || []).join('|'),
        r.privacy_level,
        r.date ? r.date.toISOString().slice(0, 10) : '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );

    return res.send(header + lines.join('\n'));
  } catch (err) {
    console.error('Export error:', err.message);
    return res.status(500).json({ error: 'Export failed' });
  }
});

export default router;
