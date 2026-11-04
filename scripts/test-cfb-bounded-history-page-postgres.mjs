// Disposable PostgreSQL only: supply a PGlite module path, never a DB URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (!process.argv[2] || process.argv[2].includes("://"))
  throw Error("Supply a local PGlite module path");
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.cfb_forward_evidence_snapshots(id uuid PRIMARY KEY,season integer,evidence_release text,provider_game_id text,stage text,captured_at timestamptz,game_start_at timestamptz,payload_sha256 character(64),payload jsonb);
 ALTER TABLE public.cfb_forward_evidence_snapshots ENABLE ROW LEVEL SECURITY;
 CREATE POLICY service_history ON public.cfb_forward_evidence_snapshots FOR SELECT TO service_role USING(provider_game_id<>'hidden');
 GRANT SELECT ON public.cfb_forward_evidence_snapshots TO service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;`);
  const shapes = [null, {}, [], 42, true, "legacy", null];
  for (const v of [null, "", 0, false, [], [1], { price: 10 }])
    shapes.push({
      schemaRelease: v,
      game: v,
      stage: v,
      capturedAt: v,
      market: v,
      requestBudget: v,
      contextualEvidenceCapture: v,
    });
  shapes.push({
    schemaRelease: "r1",
    game: { providerGameId: "g" },
    stage: "t60",
    capturedAt: "2026-11-04T00:00:00Z",
    market: {
      current: { price: -110 },
      currentBooks: [{ book: "circa", price: 100 }],
      displayBooks: [{ original: true }],
      providerOpening: { price: -105 },
      operationalOpening: { price: -101 },
      playbookSplits: { money: 57 },
      sharpApiSplits: { bets: 42 },
    },
    requestBudget: { requests: 1 },
    contextualEvidenceCapture: {
      markets: {
        moneyline: {
          families: [{ original: true }],
          targetExcludedFamilies: ["a"],
        },
        spread: { families: ["b"], targetExcludedFamilies: ["c"] },
        total: { families: ["d"], targetExcludedFamilies: ["e"] },
      },
    },
  });
  for (let i = 0; i < shapes.length; i++)
    await db.query(
      `INSERT INTO cfb_forward_evidence_snapshots VALUES($1,2026,'r1','g',$2,$3,'2026-11-05Z',$4,$5::jsonb)`,
      [
        `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
        i === 0 ? "opening" : "unlocked",
        i === 0 ? "2026-08-01Z" : "2026-11-04Z",
        "a".repeat(64),
        i === 0 ? null : JSON.stringify(shapes[i]),
      ],
    );
  await db.exec(`INSERT INTO cfb_forward_evidence_snapshots VALUES
 ('10000000-0000-0000-0000-000000000001',2026,'r1','hidden','opening','2026-08-01Z','2026-11-05Z',repeat('b',64),'{}'),
 ('20000000-0000-0000-0000-000000000001',2027,'r1','g','opening','2026-08-01Z','2026-11-05Z',repeat('c',64),'{}'),
 ('30000000-0000-0000-0000-000000000001',2026,'r2','g','opening','2026-08-01Z','2026-11-05Z',repeat('d',64),'{}'),
 ('40000000-0000-0000-0000-000000000001',2026,'r1','g','unlocked','2026-08-01Z','2026-11-05Z',repeat('e',64),'{}');`);
  const before = (
    await db.query("SELECT * FROM cfb_forward_evidence_snapshots ORDER BY id")
  ).rows;
  await db.exec(
    readFileSync(
      "lib/db/schema-migration-v54-cfb-market-history-projection.sql",
      "utf8",
    ),
  );
  const migration = readFileSync(
    "lib/db/schema-migration-v58-cfb-bounded-history-page.sql",
    "utf8",
  );
  await db.exec(migration);
  await db.exec(migration);
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
  const signature =
    "public.cfb_forward_market_history_page(integer,text[],text[],timestamp with time zone,integer,integer)";
  const flags = (
    await db.query(
      "SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE oid=$1::regprocedure",
      [signature],
    )
  ).rows[0];
  assert.equal(flags.prosecdef, false);
  assert.equal(flags.provolatile, "s");
  assert(flags.proconfig.includes("search_path=pg_catalog"));
  for (const role of ["anon", "authenticated"])
    assert.equal(
      (
        await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok", [
          role,
          signature,
        ])
      ).rows[0].ok,
      false,
    );
  await db.exec("SET ROLE service_role");
  for (const after of [null, "2026-11-01Z"])
    for (const games of [[], ["g"], ["g", "g"], ["missing"], ["g", "hidden"]])
      for (const releases of [[], ["r1"], ["r1", "r2"]]) {
        for (const offset of [0, 1, 5, 16, 30]) {
          const params = [2026, releases, games, after, offset, 5];
          const a = (
            await db.query(
              `SELECT coalesce(json_agg(x),'[]'::json) AS page FROM(SELECT ${projection} FROM public.cfb_forward_market_history_projection p WHERE p.season=$1 AND p.evidence_release=ANY($2) AND p.provider_game_id=ANY($3) AND($4::timestamptz IS NULL OR p.stage='opening' OR p.captured_at>=$4) ORDER BY p.captured_at,p.id LIMIT $6 OFFSET $5)x`,
              params,
            )
          ).rows[0].page;
          const b = (
            await db.query(
              "SELECT public.cfb_forward_market_history_page($1,$2,$3,$4,$5,$6) AS page",
              params,
            )
          ).rows[0].page;
          assert.deepEqual(
            b,
            a,
            "exact original projection, ordering, ties, page boundaries and RLS must match",
          );
        }
      }
  for (const [offset, limit, games] of [
    [-1, 5, ["g"]],
    [50000, 5, ["g"]],
    [0, 0, ["g"]],
    [0, 1001, ["g"]],
    [0, 5, Array(11).fill("g")],
  ])
    await assert.rejects(
      db.query(
        "SELECT * FROM cfb_forward_market_history_page(2026,ARRAY['r1'],$1,NULL,$2,$3)",
        [games, offset, limit],
      ),
      /Invalid bounded/,
    );
  await db.exec(
    "RESET ROLE;REVOKE SELECT ON cfb_forward_evidence_snapshots FROM service_role;SET ROLE service_role",
  );
  await assert.rejects(
    db.query(
      "SELECT * FROM cfb_forward_market_history_page(2026,ARRAY['r1'],ARRAY['g'],NULL,0,5)",
    ),
    /permission denied/,
  );
  await db.exec("RESET ROLE");
  assert.deepEqual(
    (await db.query("SELECT * FROM cfb_forward_evidence_snapshots ORDER BY id"))
      .rows,
    before,
    "every original snapshot, hash and frozen payload is unchanged",
  );
  console.log(
    `PASS bounded CFB history SQL: ${fields.length} exact fields, legacy/null shapes, full opening horizon, ordered ties/pages, wrong scope isolation, bounds, invoker RLS/grants, rerun and immutable original rows`,
  );
} finally {
  await db.close();
}
