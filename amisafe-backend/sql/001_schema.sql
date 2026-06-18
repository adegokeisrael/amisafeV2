-- ═══════════════════════════════════════════════════════════════
--  Amisafe Backend — Database Schema
--  Run via: node src/migrate.js
--  Or paste directly into Render's psql console.
-- ═══════════════════════════════════════════════════════════════

-- ── Reports ──────────────────────────────────────────────────────
-- No personal identifiers. pseudo_id is generated client-side by
-- the extension and has no link to any user account or IP address.
CREATE TABLE IF NOT EXISTS reports (
  id               BIGSERIAL PRIMARY KEY,
  pseudo_id        TEXT        NOT NULL,
  source           TEXT        NOT NULL DEFAULT 'extension', -- 'extension' | 'whatsapp'
  harm_type        TEXT        NOT NULL,
  platform_domain  TEXT,
  language         TEXT        NOT NULL DEFAULT 'en',
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  feedback         TEXT,
  evidence_types   TEXT[]      NOT NULL DEFAULT '{}',   -- ['screenshot','voice','video']
  evidence_keys    TEXT[]      NOT NULL DEFAULT '{}',   -- R2 object keys
  evidence_hashes  TEXT[]      NOT NULL DEFAULT '{}',   -- SHA-256 fingerprints
  evidence_sizes   BIGINT[]    NOT NULL DEFAULT '{}',   -- bytes
  privacy_level    TEXT        NOT NULL DEFAULT 'private', -- 'private'|'anon'|'partner'
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT chk_harm_type     CHECK (harm_type IN ('deepfake','misinfo','financial','harassment','bias','other')),
  CONSTRAINT chk_privacy_level CHECK (privacy_level IN ('private','anon','partner')),
  CONSTRAINT chk_source        CHECK (source IN ('extension','whatsapp'))
);

CREATE INDEX IF NOT EXISTS idx_reports_harm_type     ON reports (harm_type);
CREATE INDEX IF NOT EXISTS idx_reports_platform      ON reports (platform_domain);
CREATE INDEX IF NOT EXISTS idx_reports_language      ON reports (language);
CREATE INDEX IF NOT EXISTS idx_reports_submitted_at  ON reports (submitted_at);
CREATE INDEX IF NOT EXISTS idx_reports_privacy_level ON reports (privacy_level);
CREATE INDEX IF NOT EXISTS idx_reports_pseudo_id     ON reports (pseudo_id);


-- ── Partner API keys ─────────────────────────────────────────────
-- Vetted civil society / research organisations get a scoped API key.
-- Keys are stored as SHA-256 hashes — the raw key is shown once at
-- creation and never stored in plaintext.
CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL   PRIMARY KEY,
  key_hash     TEXT        NOT NULL UNIQUE,  -- SHA-256 of the raw key
  label        TEXT        NOT NULL,          -- e.g. "Paradigm Initiative"
  scopes       TEXT[]      NOT NULL DEFAULT '{"reports:aggregate","signals:read"}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked      BOOLEAN     NOT NULL DEFAULT false
);


-- ── Signal log ───────────────────────────────────────────────────
-- Confirmed safety signals generated from pattern detection.
CREATE TABLE IF NOT EXISTS signals (
  id               BIGSERIAL   PRIMARY KEY,
  signal_ref       TEXT        NOT NULL UNIQUE, -- e.g. "SIG-2026-047"
  harm_type        TEXT        NOT NULL,
  platform_domain  TEXT,
  period_days      INTEGER     NOT NULL DEFAULT 7,
  report_count     INTEGER     NOT NULL,
  evidence_rate    NUMERIC(4,3),
  countries        TEXT[]      NOT NULL DEFAULT '{}',
  languages        TEXT[]      NOT NULL DEFAULT '{}',
  vs_prior_pct     INTEGER,                    -- % change vs prior period
  status           TEXT        NOT NULL DEFAULT 'candidate', -- 'candidate'|'confirmed'|'closed'
  reviewer         TEXT,
  narrative        TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at     TIMESTAMPTZ
);


-- ── Public aggregate view ────────────────────────────────────────
-- Only anon + partner tier reports are ever exposed.
-- Counts rounded to nearest 5 to prevent re-identification.
CREATE OR REPLACE VIEW dashboard_aggregate AS
SELECT
  harm_type,
  platform_domain,
  language,
  date_trunc('week', submitted_at)                                   AS week,
  ROUND(COUNT(*) / 5.0) * 5                                         AS report_count,
  ROUND(COUNT(*) FILTER (
    WHERE array_length(evidence_types,1) > 0
  ) / 5.0) * 5                                                       AS with_evidence_count
FROM   reports
WHERE  privacy_level IN ('anon','partner')
GROUP  BY harm_type, platform_domain, language, week;
