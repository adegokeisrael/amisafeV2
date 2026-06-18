// ═══════════════════════════════════════════════════════════════
//  Amisafe Backend — Database service
// ═══════════════════════════════════════════════════════════════
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

// ── Reports ───────────────────────────────────────────────────

export async function insertReport({
  pseudo_id, source = 'extension', harm_type, platform_domain,
  language, tags, feedback, evidence_types, evidence_keys,
  evidence_hashes, evidence_sizes, privacy_level,
}) {
  const { rows } = await pool.query(
    `INSERT INTO reports
       (pseudo_id, source, harm_type, platform_domain, language,
        tags, feedback, evidence_types, evidence_keys,
        evidence_hashes, evidence_sizes, privacy_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, pseudo_id, submitted_at`,
    [
      pseudo_id, source, harm_type, platform_domain, language,
      tags, feedback, evidence_types, evidence_keys,
      evidence_hashes, evidence_sizes, privacy_level,
    ]
  );
  return rows[0];
}

export async function findReportByPseudoId(pseudoId) {
  const { rows } = await pool.query(
    `SELECT pseudo_id, harm_type, platform_domain, language,
            evidence_types, privacy_level, submitted_at
       FROM reports
      WHERE pseudo_id = $1
      LIMIT 1`,
    [pseudoId]
  );
  return rows[0] || null;
}

// ── Dashboard aggregates ──────────────────────────────────────

export async function getDashboardStats() {
  const [totals, byHarm, byPlatform, byLanguage, weekly] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE privacy_level IN ('anon','partner')) AS public_count,
        COUNT(*) FILTER (WHERE array_length(evidence_types,1) > 0) AS with_evidence,
        COUNT(DISTINCT platform_domain)                   AS platform_count
      FROM reports
    `),

    pool.query(`
      SELECT harm_type, COUNT(*) AS count
        FROM reports
       WHERE privacy_level IN ('anon','partner')
       GROUP BY harm_type
       ORDER BY count DESC
    `),

    pool.query(`
      SELECT platform_domain, COUNT(*) AS count
        FROM reports
       WHERE privacy_level IN ('anon','partner')
         AND platform_domain IS NOT NULL
       GROUP BY platform_domain
       ORDER BY count DESC
       LIMIT 10
    `),

    pool.query(`
      SELECT language, COUNT(*) AS count
        FROM reports
       WHERE privacy_level IN ('anon','partner')
       GROUP BY language
       ORDER BY count DESC
    `),

    pool.query(`
      SELECT date_trunc('week', submitted_at) AS week,
             COUNT(*) AS count
        FROM reports
       WHERE privacy_level IN ('anon','partner')
         AND submitted_at > now() - INTERVAL '8 weeks'
       GROUP BY week
       ORDER BY week ASC
    `),
  ]);

  return {
    totals: totals.rows[0],
    by_harm_type: byHarm.rows,
    by_platform: byPlatform.rows,
    by_language: byLanguage.rows,
    weekly_trend: weekly.rows,
  };
}

// ── Partner: scoped data access ───────────────────────────────

export async function getAggregateForPartner({ harmType, period, region, limit = 100 }) {
  let where = `privacy_level IN ('anon','partner')`;
  const params = [];

  if (harmType) {
    params.push(harmType);
    where += ` AND harm_type = $${params.length}`;
  }
  if (period) {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
    where += ` AND submitted_at > now() - INTERVAL '${days} days'`;
  }

  params.push(Math.min(limit, 500));
  const limitClause = `LIMIT $${params.length}`;

  const { rows } = await pool.query(
    `SELECT harm_type, platform_domain, language,
            array_length(evidence_types,1) > 0 AS has_evidence,
            date_trunc('day', submitted_at) AS day
       FROM reports
      WHERE ${where}
      ORDER BY submitted_at DESC
      ${limitClause}`,
    params
  );
  return rows;
}

// ── API key auth ──────────────────────────────────────────────

export async function findApiKey(keyHash) {
  const { rows } = await pool.query(
    `SELECT id, label, scopes, revoked
       FROM api_keys
      WHERE key_hash = $1`,
    [keyHash]
  );
  return rows[0] || null;
}

export async function touchApiKey(id) {
  await pool.query(
    `UPDATE api_keys SET last_used_at = now() WHERE id = $1`,
    [id]
  );
}
