PRAGMA foreign_keys = ON;

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  title TEXT NOT NULL,
  description_encrypted TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('focus', 'secondary', 'candidate', 'paused', 'completed')
  ),
  priority_order INTEGER NOT NULL CHECK (priority_order >= 1),
  started_at TEXT,
  ended_at TEXT,
  tags TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_goals_status_priority
  ON goals (status, priority_order)
  WHERE deleted_at IS NULL;

CREATE TABLE journals (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  title_prefix TEXT NOT NULL DEFAULT '',
  mood TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  content_encrypted TEXT NOT NULL,
  encryption_kid TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  deletion_plan_until TEXT
);

CREATE INDEX idx_journals_date
  ON journals (date DESC, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_journals_mood
  ON journals (mood, date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_journals_title_prefix
  ON journals (title_prefix)
  WHERE deleted_at IS NULL;

CREATE TABLE journal_revisions (
  id TEXT PRIMARY KEY,
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  title TEXT NOT NULL DEFAULT '',
  mood TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  content_encrypted TEXT NOT NULL,
  encryption_kid TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  UNIQUE (journal_id, revision)
);

CREATE INDEX idx_journal_revisions_journal
  ON journal_revisions (journal_id, revision DESC);

CREATE TABLE health_days (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  date TEXT NOT NULL UNIQUE,
  sleep_start TEXT,
  sleep_end TEXT,
  sleep_duration_min INTEGER CHECK (
    sleep_duration_min IS NULL OR sleep_duration_min >= 0
  ),
  steps INTEGER CHECK (steps IS NULL OR steps >= 0),
  active_energy_kcal INTEGER CHECK (
    active_energy_kcal IS NULL OR active_energy_kcal >= 0
  ),
  sleep_quality_device TEXT,
  raw_payload_encrypted TEXT NOT NULL,
  source_device_encrypted TEXT,
  encryption_kid TEXT NOT NULL
);

CREATE INDEX idx_health_days_date
  ON health_days (date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE daily_checkins (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  date TEXT NOT NULL UNIQUE,
  sleep_quality TEXT,
  energy TEXT,
  mood TEXT,
  real_life_score TEXT,
  anchors_encrypted TEXT,
  action_items TEXT NOT NULL DEFAULT '[]',
  notes_encrypted TEXT,
  health_day_id TEXT REFERENCES health_days(id) ON DELETE SET NULL
);

CREATE INDEX idx_daily_checkins_date
  ON daily_checkins (date DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE weekly_reviews (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  week_start TEXT NOT NULL UNIQUE,
  summary_encrypted TEXT,
  goals_hit_rate TEXT NOT NULL DEFAULT '{}',
  action_items TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_weekly_reviews_week
  ON weekly_reviews (week_start DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE phase_reviews (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  phase_name TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  body_encrypted TEXT,
  goals_before TEXT NOT NULL DEFAULT '[]',
  goals_after TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_phase_reviews_range
  ON phase_reviews (started_at DESC, ended_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE health_segments (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  encryption_version TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'direct-sites',
  migration_batch TEXT,
  health_day_id TEXT NOT NULL REFERENCES health_days(id) ON DELETE CASCADE,
  segment_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_min INTEGER NOT NULL CHECK (duration_min >= 0),
  value_1_encrypted TEXT,
  value_2_encrypted TEXT,
  source_encrypted TEXT,
  encryption_kid TEXT NOT NULL
);

CREATE INDEX idx_health_segments_day_time
  ON health_segments (health_day_id, started_at);
CREATE INDEX idx_health_segments_type_time
  ON health_segments (segment_type, started_at);

CREATE TABLE idempotency_keys (
  key_hash TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  cached_response_json TEXT NOT NULL
);

CREATE INDEX idx_idempotency_expiry
  ON idempotency_keys (expires_at);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL,
  result TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE INDEX idx_audit_events_created
  ON audit_events (created_at DESC);
CREATE INDEX idx_audit_events_resource
  ON audit_events (resource_type, resource_id, created_at DESC);

CREATE TABLE backup_exports (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING', 'SKIPPED')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_error TEXT,
  completed_at TEXT,
  sync_agent TEXT,
  UNIQUE (resource_type, resource_id, revision)
);

CREATE INDEX idx_backup_exports_queue
  ON backup_exports (status, next_attempt_at, created_at);

CREATE TABLE migration_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  phase TEXT NOT NULL CHECK (
    phase IN (
      'NOT_STARTED',
      'PLANNING',
      'VALIDATING',
      'READY_TO_SWITCH',
      'SWITCHED',
      'ROLLED_BACK'
    )
  ),
  source_truth TEXT NOT NULL CHECK (
    source_truth IN ('ICLOUD_PRIMARY', 'SITES_D1_PRIMARY')
  ),
  batch_id TEXT,
  rollback_window_until TEXT,
  plan_json TEXT,
  validation_report_json TEXT,
  switched_at TEXT,
  rolled_back_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO migration_state (
  singleton_id,
  phase,
  source_truth,
  updated_at
) VALUES (
  1,
  'NOT_STARTED',
  'ICLOUD_PRIMARY',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
