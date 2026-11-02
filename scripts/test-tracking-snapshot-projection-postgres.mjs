// Run with an explicitly installed PGlite module path. This creates a new,
// disposable in-memory PostgreSQL instance and never accepts a database URL.
// Example: node scripts/test-tracking-snapshot-projection-postgres.mjs /tmp/proof/node_modules/@electric-sql/pglite/dist/index.js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

if (!process.argv[2]) throw new Error("Supply the installed PGlite module path; production database connections are forbidden.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    -- Supabase grants service_role all table privileges by default; views
    -- inherit those defaults too. The migration must explicitly narrow them.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
    CREATE TABLE public.prediction_records (
      id integer PRIMARY KEY, snapshot_json jsonb,
      play_grade text DEFAULT 'no_play', locked_at timestamptz DEFAULT '2026-01-01Z'
    );
    ALTER TABLE public.prediction_records ENABLE ROW LEVEL SECURITY;
  `);
  const snapshots = [
    null, {}, [], "legacy", 42, true,
    { member_facing_at_lock: { grade: "Best Angle" } },
    { member_facing_at_lock: { grade: "Lean" }, tracking_display_grade_override: "watchlist" },
    { competition: "uefa_champions_league", member_market_at_capture: { held: true, soccerTotalContext: { displayed_side: "over" } } },
    { evidence_payload_sha256: "original-hash", published_pregame_recovery: { original_locked_at: null, frozen_at: "2026-11-02Z" }, supersedes_prediction_record_id: 99 },
  ];
  const keys = ["evidence_payload_sha256", "published_pregame_recovery", "competition", "member_market_at_capture", "tracking_display_grade_override", "member_facing_at_lock", "tracking_correction_release", "supersedes_prediction_record_id"];
  for (const value of [null, "", "original", 0, false, [], ["lean"], { grade: "Lean", retained: true }]) {
    snapshots.push(Object.fromEntries(keys.map(key => [key, value])));
  }
  for (let i = 0; i < snapshots.length; i++) {
    await db.query("INSERT INTO public.prediction_records(id,snapshot_json) VALUES($1,$2::jsonb)", [i + 1, snapshots[i] === null ? null : JSON.stringify(snapshots[i])]);
  }
  await db.exec("INSERT INTO public.prediction_records(id,snapshot_json) VALUES(99,'null'::jsonb)");
  const original = (await db.query("SELECT * FROM public.prediction_records ORDER BY id")).rows;
  const migration = readFileSync("lib/db/schema-migration-v53-tracking-snapshot-projection.sql", "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const comparison = await db.query(`
    SELECT p.id FROM public.prediction_records p
    JOIN public.prediction_records_tracking_projection v USING(id)
    WHERE jsonb_build_array(
      p.snapshot_json->>'evidence_payload_sha256',p.snapshot_json->'published_pregame_recovery',
      p.snapshot_json->>'competition',p.snapshot_json->'member_market_at_capture',
      p.snapshot_json->>'tracking_display_grade_override',p.snapshot_json->'member_facing_at_lock'->>'grade',
      p.snapshot_json->>'tracking_correction_release',p.snapshot_json->'supersedes_prediction_record_id'
    ) IS DISTINCT FROM jsonb_build_array(
      v.alternate_line_evidence_sha256,v.alternate_line_pregame_recovery,v.competition,
      v.member_market_at_capture,v.tracking_display_grade_override,v.member_facing_grade,
      v.tracking_correction_release,v.supersedes_prediction_record_id
    )
  `);
  assert.deepEqual(comparison.rows, [], "transported legacy values must match for every payload shape");
  assert.deepEqual((await db.query("SELECT * FROM public.prediction_records ORDER BY id")).rows, original, "stored locked records must remain byte-for-byte equivalent");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.prediction_records_tracking_projection")).rows[0].n, original.length, "null/scalar legacy snapshots must not suppress rows");
  const options = (await db.query("SELECT reloptions FROM pg_class WHERE oid='public.prediction_records_tracking_projection'::regclass")).rows[0].reloptions;
  assert(options.includes("security_invoker=true"));
  const access = (await db.query(`SELECT
    has_table_privilege('service_role','public.prediction_records_tracking_projection','SELECT') AS service_select,
    has_table_privilege('service_role','public.prediction_records_tracking_projection','UPDATE') AS service_update,
    has_table_privilege('anon','public.prediction_records_tracking_projection','SELECT') AS anon_select,
    has_table_privilege('authenticated','public.prediction_records_tracking_projection','SELECT') AS member_select`)).rows[0];
  assert.deepEqual(access, {service_select:true,service_update:false,anon_select:false,member_select:false});
  console.log(`tracking projection PostgreSQL parity, ${original.length} legacy shapes, rerun, row preservation, stored-lock immutability and invoker permissions: PASS`);
} finally { await db.close(); }
