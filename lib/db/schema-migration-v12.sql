-- ═════════════════════════════════════════════════════════════════════════════
-- Oddsphere · Schema Migration V12 — admin_audit_log
-- ═════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   V2.1 Part 9 mandates an audit trail for every admin-side mutation —
--   slate publishes, manual prop overrides, retracted picks, etc. Without
--   one, we can't answer "what changed at 2pm yesterday and who did it?"
--   This table is the canonical record. Phase 7.5's Admin UI writes to it
--   whenever an admin action mutates a published-state row.
--
-- SHAPE
--   id              BIGSERIAL PRIMARY KEY
--   admin_user_id   UUID, NULLABLE. No FK in V1 — Phase 7 wires it to
--                   auth.users(id) when real auth lands. NULL while we run
--                   admin actions out-of-band before auth ships.
--   action_type     TEXT, NOT NULL — short verb-noun token like
--                   "slate.publish", "prop.override", "pick.retract".
--                   No CHECK constraint — admin tooling owns the vocabulary
--                   and adding new action types shouldn't require a migration.
--   target_table    TEXT, NOT NULL — name of the table mutated.
--   target_id       TEXT, NULLABLE — primary key (string-cast) of the row
--                   touched. NULL for slate-level actions that don't pin
--                   to one row.
--   before_state    JSONB, NULLABLE — snapshot before mutation. NULL for
--                   pure-create actions.
--   after_state     JSONB, NULLABLE — snapshot after mutation. NULL for
--                   pure-delete actions.
--   source_type     TEXT, NOT NULL, DEFAULT 'mock' — same provenance
--                   vocabulary as V11 (mock / manual / real_api), tagging
--                   which data mode the admin action ran in.
--   created_at      TIMESTAMPTZ, NOT NULL, DEFAULT NOW()
--
-- INDEXES
--   • (target_table, target_id)  — "show me everything that ever touched this row"
--   • (created_at DESC)          — "show me the most recent admin actions"
--   • (admin_user_id)            — "show me everything this admin has done" (Phase 7+)
--
-- ROW-LEVEL SECURITY
--   RLS ENABLED with NO policies for anon/authenticated roles. Only the
--   service-role key (server-side) can INSERT or SELECT. V2.1 V1 position:
--   audit logs are admin-internal and members never see them; Phase 7
--   may add an admin-claim SELECT policy when admin auth lands.
--
-- ROLLBACK
--   DROP TABLE admin_audit_log;
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  admin_user_id UUID NULL,
  action_type   TEXT NOT NULL,
  target_table  TEXT NOT NULL,
  target_id     TEXT NULL,
  before_state  JSONB NULL,
  after_state   JSONB NULL,
  source_type   TEXT NOT NULL DEFAULT 'mock',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE admin_audit_log
  DROP CONSTRAINT IF EXISTS admin_audit_log_source_type_chk;
ALTER TABLE admin_audit_log
  ADD CONSTRAINT admin_audit_log_source_type_chk
  CHECK (source_type IN ('mock', 'manual', 'real_api'));

COMMENT ON TABLE admin_audit_log IS
  'Append-only audit trail of admin-side mutations (slate publishes, prop overrides, retractions). Service-role-only via RLS. Phase 7 binds admin_user_id to auth.users when real auth ships.';

COMMENT ON COLUMN admin_audit_log.admin_user_id IS
  'UUID of the admin performing the action. NULL until Phase 7 auth ships. No FK in V1 to avoid a half-bound reference that would need to be dropped at auth wiring time.';
COMMENT ON COLUMN admin_audit_log.action_type IS
  'Short verb-noun token identifying the action. Examples: slate.publish, slate.retract, prop.override, pick.delete. Owned by admin tooling — no CHECK constraint to avoid migrations for new action types.';
COMMENT ON COLUMN admin_audit_log.target_table IS
  'Name of the table whose row was mutated. Lets the audit reader join back to the live row schema when needed.';
COMMENT ON COLUMN admin_audit_log.target_id IS
  'Primary key (as TEXT) of the mutated row. NULL for slate-level or batch actions that don''t pin to one row.';
COMMENT ON COLUMN admin_audit_log.before_state IS
  'JSONB snapshot of the row before mutation. NULL for pure-create actions.';
COMMENT ON COLUMN admin_audit_log.after_state IS
  'JSONB snapshot of the row after mutation. NULL for pure-delete actions.';
COMMENT ON COLUMN admin_audit_log.source_type IS
  'Provenance of the admin action: mock / manual / real_api. Same vocabulary as predictions tables (V11).';

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
  ON admin_audit_log (target_table, target_id);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_user_idx
  ON admin_audit_log (admin_user_id);

-- ── Row-Level Security: service-role-only ─────────────────────────────────
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Intentionally NO policies for anon / authenticated roles. Without a policy,
-- those roles see zero rows and cannot INSERT/UPDATE/DELETE. The Supabase
-- service-role key bypasses RLS so server-side admin code can write freely.
-- Phase 7 may add an admin-claim SELECT policy when admin auth ships.

COMMIT;

-- ═════════════════════════════════════════════════════════════════════════════
-- Verification queries (run after BEGIN..COMMIT succeeds):
--
-- 1. Table exists with expected columns:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'admin_audit_log'
--    ORDER BY ordinal_position;
--
-- 2. Three indexes present:
--    SELECT indexname FROM pg_indexes
--    WHERE tablename = 'admin_audit_log'
--    ORDER BY indexname;
--
-- 3. RLS enabled, zero policies:
--    SELECT relname, relrowsecurity
--    FROM pg_class WHERE relname = 'admin_audit_log';
--    SELECT policyname FROM pg_policies WHERE tablename = 'admin_audit_log';
--    -- expect: relrowsecurity = t, no policies returned
--
-- 4. CHECK constraint on source_type:
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint WHERE conname = 'admin_audit_log_source_type_chk';
--
-- 5. Service-role insert smoke (run as service role):
--    INSERT INTO admin_audit_log (action_type, target_table, target_id, after_state)
--    VALUES ('test.smoke', 'games', 'fake', '{"ok": true}'::jsonb);
--    SELECT * FROM admin_audit_log ORDER BY id DESC LIMIT 1;
--    DELETE FROM admin_audit_log WHERE action_type = 'test.smoke';
-- ═════════════════════════════════════════════════════════════════════════════
