// Official local PostgREST + disposable Unix-socket DB only; no hosted URL.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const [binary, modulePath, fixturePath] = process.argv.slice(2);
if (!binary?.startsWith("/private/tmp/") || !modulePath || !fixturePath)
  throw Error("Supply local test binary,module and fixture");
const native = JSON.parse(
  readFileSync(
    "/private/tmp/oddsphere-cfb-history-native-benchmark-20261104.json",
    "utf8",
  ),
);
const { default: pg } = await import(pathToFileURL(modulePath).href);
const db = new pg.Client({
  host: "/private/tmp/oddsphere-cfb-history-pg-socket-20261104",
  port: 55478,
  user: "postgres",
  database: native.database,
});
await db.connect();
await db.query(
  "GRANT SELECT ON cfb_forward_evidence_snapshots TO service_role",
);
await db.end();
const fixtures = JSON.parse(readFileSync(fixturePath, "utf8")).rows;
const source = readFileSync(
  "lib/services/football/cfbForwardEvidenceStore.ts",
  "utf8",
);
const region = source.match(
  /const CFB_FORWARD_MARKET_HISTORY_SELECT = \[([\s\S]*?)\]\.join\(","\)/,
)[1];
const select = [...region.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(",");
const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [label, pageSize] of [
  ["legacy", 1000],
  ["bounded_page", 250],
]) {
  const config = `db-uri="postgresql://postgres@localhost/${native.database}?host=/private/tmp/oddsphere-cfb-history-pg-socket-20261104&port=55478"\ndb-schemas="public"\ndb-anon-role="service_role"\ndb-pool=1\ndb-max-rows=1000\nserver-host="127.0.0.1"\nserver-port=55479\nlog-level="error"\n`;
  const path = `/private/tmp/oddsphere-cfb-history-api-${label}.conf`;
  writeFileSync(path, config, { mode: 0o600 });
  const child = spawn(binary, [path], { stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  child.stdout.on("data", (b) => (logs += b));
  child.stderr.on("data", (b) => (logs += b));
  let timer;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error("Local API exited: " + logs);
      try {
        const r = await fetch("http://127.0.0.1:55479/");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await wait(50);
    }
    if (!ready) throw Error("Local API failed to start: " + logs);
    const rss = () =>
      Number(
        spawnSync("/bin/ps", ["-o", "rss=", "-p", String(child.pid)], {
          encoding: "utf8",
        }).stdout.trim(),
      ) * 1024;
    const baseline = rss();
    let peak = baseline;
    timer = setInterval(() => (peak = Math.max(peak, rss())), 15);
    const hash = createHash("sha256");
    let rows = 0,
      requests = 0,
      responseBytes = 0;
    const started = Date.now();
    for (let offset = 0; offset < 50000; offset += pageSize) {
      const url = new URL(
        label === "legacy"
          ? "/cfb_forward_market_history_projection"
          : "/rpc/cfb_forward_market_history_page",
        "http://127.0.0.1:55479",
      );
      let options;
      if (label === "legacy") {
        for (const [k, v] of Object.entries({
          select,
          season: "eq.2026",
          evidence_release: `in.(${[...new Set(fixtures.map((f) => f.evidence_release))].join(",")})`,
          provider_game_id: `in.(${fixtures.map((f) => f.provider_game_id).join(",")})`,
          or: "(stage.eq.opening,captured_at.gte.2026-11-01T12:00:00Z)",
          order: "captured_at.asc,id.asc",
          offset: String(offset),
          limit: String(pageSize),
        }))
          url.searchParams.set(k, v);
      } else
        options = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            p_season: 2026,
            p_releases: [...new Set(fixtures.map((f) => f.evidence_release))],
            p_game_ids: fixtures.map((f) => f.provider_game_id),
            p_captured_after: "2026-11-01T12:00:00Z",
            p_offset: offset,
            p_limit: pageSize,
          }),
        };
      const r = await fetch(url, options);
      const raw = await r.text();
      if (!r.ok) throw Error("API " + r.status + ": " + raw);
      responseBytes += Buffer.byteLength(raw);
      const body = JSON.parse(raw);
      assert(Array.isArray(body));
      requests++;
      for (const row of body) hash.update(JSON.stringify(row));
      rows += body.length;
      if (body.length < pageSize) break;
    }
    const elapsedMs = Date.now() - started;
    await wait(750);
    const idle = rss();
    clearInterval(timer);
    timer = null;
    results.push({
      label,
      pageSize,
      requests,
      rows,
      responseSha256: hash.digest("hex"),
      responseBytes,
      elapsedMs,
      baselineRssBytes: baseline,
      peakRssBytes: peak,
      idleRssBytes: idle,
    });
  } finally {
    if (timer) clearInterval(timer);
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once("exit", resolve);
    });
  }
}
assert.equal(results[0].rows, results[1].rows);
assert.equal(
  results[0].responseSha256,
  results[1].responseSha256,
  "real HTTP transport must preserve all25fields and full ordered history",
);
const out = {
  at: new Date().toISOString(),
  postgrest: "14.5",
  allHistoryIdentical: true,
  results,
};
writeFileSync(
  "/private/tmp/oddsphere-cfb-history-api-benchmark-20261104.json",
  JSON.stringify(out, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify(out));
