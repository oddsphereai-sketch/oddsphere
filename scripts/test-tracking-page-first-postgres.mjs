// Isolated, disposable PostgreSQL only. Never accepts a database URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Supply the installed PGlite module path.");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  const migration = readFileSync("lib/db/schema-migration-v65-tracking-page-first.sql", "utf8");
  const columns = [...migration.matchAll(/^          v\.(\w+)/gm)].map(m => m[1]);
  assert.equal(columns.length, 47);
  const projected = new Set(["alternate_line_evidence_sha256", "alternate_line_pregame_recovery", "competition",
    "member_market_at_capture", "tracking_display_grade_override", "member_facing_grade", "tracking_correction_release", "supersedes_prediction_record_id"]);
  const types = { id: "integer PRIMARY KEY", slate_date: "date", locked_at: "timestamptz", published_at: "timestamptz", created_at: "timestamptz" };
  const base = columns.filter(c => !projected.has(c));
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.prediction_records (${base.map(c => `${c} ${types[c] ?? "text"}`).join(",")},snapshot_json jsonb);
    ALTER TABLE public.prediction_records ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON public.prediction_records TO service_role;
    CREATE POLICY service_read ON public.prediction_records FOR SELECT TO service_role USING(true);`);
  const shapes = [null, {}, [], "legacy", 42, true,
    { member_facing_at_lock: { grade: "Best Angle" }, tracking_display_grade_override: "watchlist",
      competition: "uefa_champions_league", member_market_at_capture: { side: "over", price: -112, legacy: [null, false, ""] } },
    { evidence_payload_sha256: "original", published_pregame_recovery: { locked_at: null }, supersedes_prediction_record_id: 99 }];
  await db.exec(`INSERT INTO public.prediction_records(id,sport,slate_date,locked_at,play_grade,model_version,snapshot_json)
    SELECT i,CASE WHEN i%2=0 THEN 'soccer' ELSE 'nfl' END,'2026-10-01'::date+(i%3),
      '2026-10-01T12:00:00Z'::timestamptz,'original_locked_grade','original-release','{}'::jsonb
    FROM generate_series(1,1105) i;`);
  for (let i = 0; i < shapes.length; i++) await db.query("UPDATE public.prediction_records SET snapshot_json=$1::jsonb WHERE id=$2", [shapes[i] === null ? null : JSON.stringify(shapes[i]), i + 1]);
  await db.query("UPDATE public.prediction_records SET snapshot_json=$1::jsonb WHERE id=14", [JSON.stringify(shapes[6])]);
  const original = (await db.query("SELECT * FROM public.prediction_records ORDER BY id")).rows;
  await db.exec(readFileSync("lib/db/schema-migration-v53-tracking-snapshot-projection.sql", "utf8"));
  await db.exec(migration); await db.exec(migration);
  const args = [[null,null,null,null], ["soccer",null,null,null], [null,"2026-10-02","2026-10-03",null],
    ["soccer","2026-10-01","2026-10-03","uefa_champions_league"], [null,"2030-01-01",null,null]];
  for (const filters of args) for (const offset of [0, 1000, 50000]) {
    const expected = (await db.query(`SELECT ${columns.map(c => `v.${c}`).join(",")} FROM public.prediction_records_tracking_projection v
      WHERE ($1::text IS NULL OR v.sport=$1) AND ($2::date IS NULL OR v.slate_date>=$2)
        AND ($3::date IS NULL OR v.slate_date<=$3) AND ($4::text IS NULL OR v.snapshot_json @> jsonb_build_object('competition',$4::text))
      ORDER BY v.id LIMIT 1000 OFFSET $5`, [...filters, offset])).rows;
    const actual = (await db.query("SELECT public.tracking_prediction_records_page($1,$2,$3,$4,$5,1000) body", [...filters, offset])).rows[0].body;
    // Date/timestamp decoding differs between a PostgreSQL row and a JSON
    // scalar. Compare as JSON inside PostgreSQL so original serialization wins.
    const equal = await db.query(`SELECT $1::jsonb = coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT ${columns.map(c => `v.${c}`).join(",")} FROM public.prediction_records_tracking_projection v
      WHERE ($2::text IS NULL OR v.sport=$2) AND ($3::date IS NULL OR v.slate_date>=$3)
        AND ($4::date IS NULL OR v.slate_date<=$4) AND ($5::text IS NULL OR v.snapshot_json @> jsonb_build_object('competition',$5::text))
      ORDER BY v.id LIMIT 1000 OFFSET $6) t),'[]'::jsonb) equal`, [JSON.stringify(actual), ...filters, offset]);
    assert.equal(equal.rows[0].equal, true);
    assert.equal(actual.length, expected.length);
  }
  for (const [offset, limit] of [[-1,1000],[null,1000],[0,0],[0,1001],[0,null]])
    await assert.rejects(db.query("SELECT public.tracking_prediction_records_page(NULL,NULL,NULL,NULL,$1,$2)", [offset, limit]), /Invalid bounded tracking/);
  assert.deepEqual((await db.query("SELECT * FROM public.prediction_records ORDER BY id")).rows, original, "migration/read must preserve every locked stored field");
  const access = (await db.query(`SELECT proisstrict,prosecdef,provolatile,proconfig,
    has_function_privilege('anon',oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',oid,'EXECUTE') member_execute,
    has_function_privilege('service_role',oid,'EXECUTE') service_execute
    FROM pg_proc WHERE oid='public.tracking_prediction_records_page(text,date,date,text,integer,integer)'::regprocedure`)).rows[0];
  assert.equal(access.prosecdef,false); assert.equal(access.provolatile,"s");
  assert(access.proconfig.includes("search_path=pg_catalog"));
  assert.equal(access.anon_execute,false); assert.equal(access.member_execute,false); assert.equal(access.service_execute,true);
  await db.exec("SET ROLE service_role");
  assert.equal((await db.query("SELECT json_array_length(public.tracking_prediction_records_page(NULL,NULL,NULL,NULL,0,1000)) n")).rows[0].n,1000);
  await assert.rejects(db.query("UPDATE public.prediction_records SET play_grade='changed' WHERE id=1"), /permission denied/);
  await db.exec("RESET ROLE");
  assert.deepEqual((await db.query("SELECT * FROM public.prediction_records ORDER BY id")).rows, original);
  console.log("tracking page-first PostgreSQL parity, RLS/invoker access and locked-record immutability: PASS");
} finally { await db.close(); }
