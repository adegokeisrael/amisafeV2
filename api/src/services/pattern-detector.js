/**
 * services/pattern-detector.js
 *
 * Async pattern detection pipeline.
 *
 * Flow:
 *   1. A new report ID is pushed to Redis queue
 *   2. A background worker polls the queue
 *   3. For each unprocessed report, it looks for similar recent reports
 *      (same category + platform + country within a 14-day window)
 *   4. If a cluster threshold is met, a pattern_cluster record is created
 *      or updated
 *   5. Confirmed clusters (≥5 reports) trigger Safety Signal generation
 */

import { pool }  from '../db/pool.js';
import { createClient } from 'ioredis';

const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', err => console.error('Redis error:', err));

const QUEUE_KEY          = 'amisafe:report_queue';
const CLUSTER_THRESHOLD  = 5;   // reports needed to confirm a pattern
const CLUSTER_WINDOW_DAYS = 14;  // look-back window for clustering

// ─── Enqueue ──────────────────────────────────────────────────────────────────
export async function enqueueForClustering(reportId) {
  await redis.lpush(QUEUE_KEY, reportId);
}

// ─── Worker (called on a schedule, e.g. every 60s) ───────────────────────────
export async function processQueue() {
  let reportId;
  while ((reportId = await redis.rpop(QUEUE_KEY))) {
    try {
      await processReport(reportId);
    } catch (err) {
      console.error(`Pattern detection failed for report ${reportId}:`, err);
    }
  }
}

// ─── Core clustering logic ────────────────────────────────────────────────────
async function processReport(reportId) {
  // Fetch the report
  const { rows } = await pool.query(
    'SELECT * FROM reports WHERE id = $1', [reportId]
  );
  if (!rows.length) return;
  const report = rows[0];

  // Find similar reports in the time window
  const { rows: similar } = await pool.query(
    `SELECT id, cluster_id FROM reports
     WHERE  category     = $1
       AND  platform     = $2
       AND  country_code = $3
       AND  created_at  >= NOW() - INTERVAL '${CLUSTER_WINDOW_DAYS} days'
       AND  id          != $4
       AND  disclosure  != 'private'
     ORDER  BY created_at DESC
     LIMIT  50`,
    [report.category, report.platform, report.country_code, reportId]
  );

  // Check if any similar report already belongs to a cluster
  const existingClusterId = similar.find(r => r.cluster_id)?.cluster_id;

  if (existingClusterId) {
    // Join existing cluster
    await pool.query(
      `UPDATE reports    SET cluster_id = $1, processed = TRUE WHERE id = $2`,
      [existingClusterId, reportId]
    );
    await pool.query(
      `UPDATE pattern_clusters
       SET report_count = report_count + 1,
           updated_at   = NOW(),
           country_codes = array_append(COALESCE(country_codes, '{}'), $2::text),
           languages     = array_append(COALESCE(languages,     '{}'), $3::text)
       WHERE id = $1`,
      [existingClusterId, report.country_code, report.lang]
    );
    await maybeEscalate(existingClusterId);

  } else if (similar.length >= CLUSTER_THRESHOLD - 1) {
    // Enough critical mass — create a new cluster
    const { rows: [cluster] } = await pool.query(
      `INSERT INTO pattern_clusters
         (category, platform, country_codes, languages, report_count, status, summary)
       VALUES ($1, $2, $3, $4, $5, 'emerging', $6)
       RETURNING id`,
      [
        report.category,
        report.platform,
        [report.country_code],
        [report.lang],
        similar.length + 1,
        `Emerging pattern: ${report.category} on ${report.platform}`,
      ]
    );

    // Assign all similar reports + this one to the new cluster
    const allIds = [reportId, ...similar.map(r => r.id)];
    await pool.query(
      `UPDATE reports SET cluster_id = $1, processed = TRUE
       WHERE  id = ANY($2::uuid[])`,
      [cluster.id, allIds]
    );

    await maybeEscalate(cluster.id);

  } else {
    // Not enough for a cluster yet — mark as processed
    await pool.query(
      'UPDATE reports SET processed = TRUE WHERE id = $1', [reportId]
    );
  }
}

// ─── Escalation to confirmed pattern ─────────────────────────────────────────
async function maybeEscalate(clusterId) {
  const { rows: [cluster] } = await pool.query(
    'SELECT * FROM pattern_clusters WHERE id = $1', [clusterId]
  );
  if (!cluster) return;

  if (cluster.report_count >= CLUSTER_THRESHOLD && cluster.status === 'emerging') {
    await pool.query(
      `UPDATE pattern_clusters SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
      [clusterId]
    );
    console.log(`Pattern confirmed: cluster ${clusterId} (${cluster.category} / ${cluster.platform})`);
    // TODO: trigger Safety Signal Report generation
    // await generateSafetySignal(clusterId);
  }
}
