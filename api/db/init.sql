-- AmiSafe Database Schema
-- PostgreSQL 16

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy text search on transcripts

-- ─── Harm reports (encrypted report store) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  pseudo_id       TEXT        NOT NULL,                   -- rotating anonymous reporter ID
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_date     DATE        NOT NULL DEFAULT CURRENT_DATE,

  -- Harm metadata
  category        TEXT        NOT NULL,                   -- from taxonomy e.g. 'deepfake'
  severity        TEXT        NOT NULL DEFAULT 'medium',
  disclosure      TEXT        NOT NULL,                   -- private | anon_research | verified_partner
  lang            TEXT        NOT NULL DEFAULT 'en',      -- language of the report

  -- Evidence (screenshots are NOT stored at full size in DB — stored in object storage)
  screenshot_key  TEXT,                                   -- S3/R2 object key or NULL
  screenshot_hash TEXT,                                   -- SHA-256 of original for integrity
  has_voice       BOOLEAN     NOT NULL DEFAULT FALSE,
  has_text        BOOLEAN     NOT NULL DEFAULT FALSE,

  -- NER-stripped text content (no names, numbers, locations)
  text_anon       TEXT,                                   -- anonymised free-text
  transcript_anon TEXT,                                   -- anonymised voice transcript

  -- Context (no personal identifiers)
  platform        TEXT,                                   -- e.g. 'Facebook', 'TikTok'
  url_domain      TEXT,                                   -- domain only, no full URL
  country_code    TEXT,                                   -- 2-letter ISO from IP geo (no IP stored)

  -- Processing state
  processed       BOOLEAN     NOT NULL DEFAULT FALSE,
  cluster_id      UUID,                                   -- FK to pattern_clusters
  pattern_id      UUID,                                   -- FK to patterns

  CONSTRAINT severity_check  CHECK (severity  IN ('low','medium','high','critical')),
  CONSTRAINT disclosure_check CHECK (disclosure IN ('private','anon_research','verified_partner'))
);

-- Index for pattern detection queries
CREATE INDEX IF NOT EXISTS idx_reports_category    ON reports (category);
CREATE INDEX IF NOT EXISTS idx_reports_platform    ON reports (platform);
CREATE INDEX IF NOT EXISTS idx_reports_country     ON reports (country_code);
CREATE INDEX IF NOT EXISTS idx_reports_created     ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_cluster     ON reports (cluster_id);
CREATE INDEX IF NOT EXISTS idx_reports_text_search ON reports USING GIN (text_anon gin_trgm_ops);

-- ─── Pattern clusters ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pattern_clusters (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  category       TEXT        NOT NULL,
  platform       TEXT,
  country_codes  TEXT[],                                  -- affected regions
  languages      TEXT[],                                  -- languages of source reports
  report_count   INTEGER     NOT NULL DEFAULT 1,

  -- Human-readable cluster summary (auto-generated, NER-stripped)
  summary        TEXT,

  -- Status
  status         TEXT        NOT NULL DEFAULT 'emerging', -- emerging | confirmed | resolved | false_positive
  signal_sent    BOOLEAN     NOT NULL DEFAULT FALSE,       -- has a Safety Signal Report been dispatched?
  signal_sent_at TIMESTAMPTZ,

  CONSTRAINT cluster_status_check CHECK (
    status IN ('emerging','confirmed','resolved','false_positive')
  )
);

CREATE INDEX IF NOT EXISTS idx_clusters_category ON pattern_clusters (category);
CREATE INDEX IF NOT EXISTS idx_clusters_status   ON pattern_clusters (status);

-- ─── Safety signal reports ────────────────────────────────────────────────────
-- Generated when a pattern is confirmed; dispatched to developers / regulators
CREATE TABLE IF NOT EXISTS safety_signals (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cluster_id   UUID        NOT NULL REFERENCES pattern_clusters (id),
  recipient    TEXT        NOT NULL,  -- e.g. 'NITDA', 'GitHub:org/repo', 'KE_CA'
  channel      TEXT        NOT NULL,  -- email | github_issue | api_webhook
  payload      JSONB       NOT NULL,  -- structured signal report (no PII)
  delivered    BOOLEAN     NOT NULL DEFAULT FALSE,
  delivered_at TIMESTAMPTZ
);

-- ─── Partner organisations ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_orgs (
  id          UUID  PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT  NOT NULL UNIQUE,
  country     TEXT,
  contact     TEXT,   -- encrypted separately; not shown in API
  api_key_hash TEXT NOT NULL,  -- bcrypt hash of their API key
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit log (access to individual reports) ────────────────────────────────
-- Ensures any access by partner orgs is traceable
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL   PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor       TEXT        NOT NULL,  -- partner org name or 'system'
  action      TEXT        NOT NULL,  -- e.g. 'view_cluster', 'export_stats'
  target_id   UUID,
  meta        JSONB
);

-- ─── Aggregate stats cache ────────────────────────────────────────────────────
-- Pre-computed daily for the public dashboard (no individual report data)
CREATE TABLE IF NOT EXISTS stats_cache (
  date          DATE  PRIMARY KEY,
  total_reports INTEGER NOT NULL DEFAULT 0,
  by_category   JSONB   NOT NULL DEFAULT '{}',
  by_platform   JSONB   NOT NULL DEFAULT '{}',
  by_country    JSONB   NOT NULL DEFAULT '{}',
  by_lang       JSONB   NOT NULL DEFAULT '{}',
  active_clusters INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
