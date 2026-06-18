/**
 * routes/admin.js
 *
 * Partner-only endpoints. Protected by X-Partner-Key header.
 * Used by vetted civil society organisations and the internal
 * safety signal generation system.
 */

import { Router } from 'express';
import { pool }   from '../db/pool.js';

const router = Router();

// ─── Partner auth middleware ───────────────────────────────────────────────────
function requirePartnerKey(req, res, next) {
  const key = req.headers['x-partner-key'];
  if (!key || key !== process.env.PARTNER_API_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

router.use(requirePartnerKey);

// POST /api/admin/signal — Mark a cluster as having received a safety signal
router.post('/signal', async (req, res) => {
  const { clusterId, recipient, channel, notes } = req.body;
  if (!clusterId || !recipient || !channel) {
    return res.status(400).json({ error: 'clusterId, recipient, and channel are required' });
  }

  const { rows: [cluster] } = await pool.query(
    'SELECT * FROM pattern_clusters WHERE id = $1', [clusterId]
  );
  if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

  // Insert safety signal record
  const { rows: [signal] } = await pool.query(
    `INSERT INTO safety_signals (cluster_id, recipient, channel, payload, delivered)
     VALUES ($1, $2, $3, $4, FALSE) RETURNING id`,
    [
      clusterId, recipient, channel,
      JSON.stringify({
        category:     cluster.category,
        platform:     cluster.platform,
        countryCoges: cluster.country_codes,
        reportCount:  cluster.report_count,
        status:       cluster.status,
        notes,
      }),
    ]
  );

  // Update cluster flag
  await pool.query(
    `UPDATE pattern_clusters SET signal_sent = TRUE, signal_sent_at = NOW() WHERE id = $1`,
    [clusterId]
  );

  // Audit log
  await pool.query(
    `INSERT INTO audit_log (actor, action, target_id, meta)
     VALUES ($1, 'signal_dispatched', $2, $3)`,
    [req.headers['x-partner-name'] || 'partner', clusterId, JSON.stringify({ recipient, channel })]
  );

  res.status(201).json({ signalId: signal.id, status: 'created' });
});

// GET /api/admin/clusters — Full cluster list with report detail (partner-only)
router.get('/clusters', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      pc.*,
      (SELECT COUNT(*) FROM reports r WHERE r.cluster_id = pc.id) AS verified_count
    FROM pattern_clusters pc
    ORDER BY report_count DESC, updated_at DESC
    LIMIT 100
  `);
  res.json({ clusters: rows });
});

export default router;
