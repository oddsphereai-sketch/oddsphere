// Local Unix-socket PostgreSQL only. No production DB URL is accepted.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const [modulePath, fixturePath, socketPath] = process.argv.slice(2);
if (!modulePath || !fixturePath || !socketPath?.startsWith("/private/tmp/"))
  throw Error(
    "Supply local pg module, frozen fixture file and disposable Unix socket",
  );
const { default: pg } = await import(pathToFileURL(modulePath).href);
const config = {
  host: socketPath,
  port: 55478,
  user: "postgres",
  database: "postgres",
};
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")).rows;
assert.equal(fixtures.length, 6);
const bootstrap = new pg.Client(config);
await bootstrap.connect();
const database = "cfb_history_memory_" + randomUUID().replaceAll("-", "");
await bootstrap.query("CREATE DATABASE " + database);
const version = (await bootstrap.query("SELECT version() AS version")).rows[0]
  .version;
await bootstrap.end();
config.database = database;
const setup = new pg.Client(config);
await setup.connect();
try {
  await setup.query(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon')THEN CREATE ROLE anon;END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated')THEN CREATE ROLE authenticated;END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role')THEN CREATE ROLE service_role;END IF;
 END $$;
 CREATE TABLE cfb_forward_evidence_snapshots(id uuid PRIMARY KEY,season integer,week integer,evidence_release text,provider_game_id text,stage text,captured_at timestamptz,game_start_at timestamptz,payload_sha256 character(64),payload jsonb);
 CREATE UNIQUE INDEX cfb_forward_evidence_snapshot_evidence_release_provider_gam_key ON cfb_forward_evidence_snapshots(evidence_release,provider_game_id,stage,captured_at,payload_sha256);
 CREATE INDEX cfb_forward_evidence_season_stage_captured ON cfb_forward_evidence_snapshots(season,week,stage,captured_at DESC);`);
  for (const f of fixtures) {
    await setup.query(
      `WITH samples AS(SELECT i,CASE WHEN i=0 THEN 'opening' WHEN i=499 THEN 't60' ELSE 'unlocked' END AS stage,
   CASE WHEN i=0 THEN '2026-10-20Z'::timestamptz ELSE '2026-11-04T12:00:00Z'::timestamptz-(499-i)*interval '15 minutes' END AS captured FROM generate_series(0,499)i),
   payloads AS(SELECT i,stage,captured,jsonb_set(jsonb_set($1::jsonb,'{stage}',to_jsonb(stage)),'{capturedAt}',to_jsonb(to_char(captured AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))AS payload FROM samples)
   INSERT INTO cfb_forward_evidence_snapshots SELECT md5($2||':'||i)::uuid,2026,10,$3,$2,stage,captured,'2026-11-04T13:00:00Z',repeat(md5($2||':'||i),2),payload FROM payloads`,
      [JSON.stringify(f.payload), f.provider_game_id, f.evidence_release],
    );
  }
  await setup.query(
    readFileSync(
      "lib/db/schema-migration-v54-cfb-market-history-projection.sql",
      "utf8",
    ),
  );
  await setup.query(
    readFileSync(
      "lib/db/schema-migration-v58-cfb-bounded-history-page.sql",
      "utf8",
    ),
  );
  await setup.query("ANALYZE cfb_forward_evidence_snapshots");
} finally {
  await setup.end();
}
const source = readFileSync(
  "lib/services/football/cfbForwardEvidenceStore.ts",
  "utf8",
);
const region = source.match(
  /const CFB_FORWARD_MARKET_HISTORY_SELECT = \[([\s\S]*?)\]\.join\(","\)/,
)[1];
const fields = [...region.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const projection = fields
  .map((f) => {
    const [a, e] = f.split(":");
    return e
      ? `p.${e.replace(/(->>?)([A-Za-z_][A-Za-z_0-9]*)/g, "$1'$2'")} AS ${a}`
      : `p.${a}`;
  })
  .join(",");
const params = [
  2026,
  [...new Set(fixtures.map((f) => f.evidence_release))],
  fixtures.map((f) => f.provider_game_id),
  "2026-11-01T12:00:00Z",
  0,
  1000,
];
const old = `SELECT ${projection} FROM cfb_forward_market_history_projection p WHERE p.season=$1 AND p.evidence_release=ANY($2) AND p.provider_game_id=ANY($3) AND($4::timestamptz IS NULL OR p.stage='opening' OR p.captured_at>=$4) ORDER BY p.captured_at,p.id LIMIT $6 OFFSET $5`;
const next =
  "SELECT cfb_forward_market_history_page($1,$2,$3,$4,$5,$6) AS body";
const cases = [];
for (const [label, pageSize] of [
  ["legacy", 1000],
  ["bounded_250", 250],
  ["bounded_125", 125],
  ["bounded_100", 100],
]) {
  const client = new pg.Client(config);
  await client.connect();
  let timer;
  try {
    await client.query(
      "SET work_mem='7MB';SET statement_timeout='30s';SET max_parallel_workers_per_gather=0",
    );
    const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
      .pid;
    const rss = () =>
      Number(
        spawnSync("/bin/ps", ["-o", "rss=", "-p", String(pid)], {
          encoding: "utf8",
        }).stdout.trim(),
      ) * 1024;
    const baseline = rss();
    let peak = baseline;
    timer = setInterval(() => {
      peak = Math.max(peak, rss());
    }, 15);
    const pages = [],
      outputHash = createHash("sha256");
    let rows = 0;
    for (let offset = 0; offset < 50000; offset += pageSize) {
      const args = [...params];
      args[4] = offset;
      args[5] = pageSize;
      const statement =
        label === "legacy"
          ? `SELECT coalesce(json_agg(t),'[]'::json) AS body FROM(${old})t`
          : next;
      const body = (await client.query(statement, args)).rows[0].body;
      for (const row of body) outputHash.update(JSON.stringify(row));
      rows += body.length;
      const explain = (
        await client.query(
          `EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${statement}`,
          args,
        )
      ).rows[0]["QUERY PLAN"][0];
      pages.push({
        offset,
        rows: body.length,
        executionMs: explain["Execution Time"],
        tempWrittenBlocks: explain.Plan["Temp Written Blocks"] ?? 0,
        plan: explain,
      });
      if (body.length < pageSize) break;
    }
    clearInterval(timer);
    timer = null;
    peak = Math.max(peak, rss());
    cases.push({
      label,
      pageSize,
      rows,
      responseSha256: outputHash.digest("hex"),
      executionMs: pages.reduce((n, p) => n + p.executionMs, 0),
      tempWrittenBlocks: pages.reduce((n, p) => n + p.tempWrittenBlocks, 0),
      baselineRssBytes: baseline,
      peakRssBytes: peak,
      deltaRssBytes: peak - baseline,
      pages,
    });
  } finally {
    if (timer) clearInterval(timer);
    await client.end();
  }
}
for (const next of cases.slice(1)) {
  assert.equal(cases[0].rows, next.rows);
  assert.equal(
    cases[0].responseSha256,
    next.responseSha256,
    "all25original fields and complete ordered history must be exact across different batch sizes",
  );
}
const result = {
  at: new Date().toISOString(),
  database,
  version,
  sourceRows: 6,
  syntheticHistoryRows: 3000,
  workMemMB: 7,
  allHistoryIdentical: true,
  rssCaveat:
    "Local process RSS includes shared mappings; not production host commitment or a promised percentage.",
  cases,
};
writeFileSync(
  "/private/tmp/oddsphere-cfb-history-native-benchmark-20261104.json",
  JSON.stringify(result, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    ...result,
    cases: cases.map(({ pages, ...c }) => ({
      ...c,
      pages: pages.map(({ offset, rows, executionMs, tempWrittenBlocks }) => ({
        offset, rows, executionMs, tempWrittenBlocks,
      })),
    })),
  }),
);
