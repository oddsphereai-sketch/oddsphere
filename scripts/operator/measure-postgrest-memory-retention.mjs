// Offline synthetic transport experiment. Refuses hosted databases and all
// database names outside the disposable memory_retention_* namespace.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

const [binary, pgModule, databaseUrl, outputDirectory] = process.argv.slice(2);
assert(binary && pgModule && databaseUrl && outputDirectory, "binary, pg module, disposable URL, output directory required");
assert.equal(process.platform, "linux", "Linux /proc accounting required");
const uri = new URL(databaseUrl);
assert(["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname), "Only loopback databases allowed");
assert(/^\/memory_retention_[a-z0-9_]+$/.test(uri.pathname), "Disposable database name required");
assert(["postgres:", "postgresql:"].includes(uri.protocol));
assert(!uri.search && !uri.hash, "No connection overrides allowed");
mkdirSync(outputDirectory, { recursive: true });
const { default: pg } = await import(pathToFileURL(pgModule).href);
const db = new pg.Client({ connectionString: uri.href });
await db.connect();
const version = (await db.query("SELECT version() AS version")).rows[0].version;
await db.query(`
  CREATE ROLE memory_reader NOLOGIN;
  GRANT pg_read_all_stats TO memory_reader;
  CREATE TABLE public.memory_fixture(id integer PRIMARY KEY,payload jsonb NOT NULL);
  INSERT INTO public.memory_fixture
    SELECT n,jsonb_build_object('fixture',n,'syntheticEvidence',repeat(md5(n::text),1560))
    FROM generate_series(1,1000)n;
  CREATE FUNCTION public.memory_probe() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object('pid',pg_backend_pid(),'managedBytes',
      (SELECT sum(total_bytes) FROM pg_backend_memory_contexts))
  $$;
  GRANT USAGE ON SCHEMA public TO memory_reader;
  GRANT SELECT ON public.memory_fixture TO memory_reader;
  GRANT EXECUTE ON FUNCTION public.memory_probe() TO memory_reader;
  ANALYZE public.memory_fixture;
`);
await db.end();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const observations = [];
const cases = [
  { name: "current_pages", legacy: false, idleGc: false },
  { name: "legacy_then_current_pages", legacy: true, idleGc: false },
  { name: "legacy_then_current_pages_idle_gc", legacy: true, idleGc: true },
];
function memory(pid) {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const smaps = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
  const values = {};
  for (const text of [status, smaps]) {
    for (const match of text.matchAll(/^(VmRSS|VmSize|VmData|VmSwap|Rss|Pss|Private_Clean|Private_Dirty|Anonymous|Swap):\s+(\d+) kB/gm)) {
      values[match[1] + "Bytes"] = Number(match[2]) * 1024;
    }
  }
  return values;
}
const childEnvironment = { PATH: process.env.PATH, LANG: "C.UTF-8" };
const port = 55563;
const base = `http://127.0.0.1:${port}`;
const expectedResponses = new Map();
for (const entry of cases) {
  const configPath = `${outputDirectory}/${entry.name}.conf`;
  writeFileSync(configPath, `db-uri=${JSON.stringify(uri.href)}\ndb-schemas="public"\ndb-anon-role="memory_reader"\ndb-pool=5\ndb-pool-max-lifetime=1800\ndb-pool-max-idletime=30\ndb-max-rows=1000\nserver-host="127.0.0.1"\nserver-port=${port}\nlog-level="error"\n`, { mode: 0o600 });
  const log = openSync(`${outputDirectory}/${entry.name}.log`, "w", 0o600);
  const child = spawn(binary, [configPath, "+RTS", "-N2", ...(entry.idleGc ? ["-I0.1"] : []), `-S${outputDirectory}/${entry.name}-gc.log`, "-RTS"], { env: childEnvironment, stdio: ["ignore", log, log] });
  closeSync(log);
  let timer;
  const samples = [];
  let phase = "startup";
  async function probe() {
    const replies = [];
    for (let round = 0; round < 2; round++) {
      replies.push(...await Promise.all(Array.from({ length: 5 }, async () => {
        const r = await fetch(`${base}/rpc/memory_probe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10000) });
        assert(r.ok, `probe HTTP ${r.status}`);
        return r.json();
      })));
    }
    return [...new Map(replies.map((row) => [row.pid, row])).values()];
  }
  async function checkpoint(name, includeProbe = true) {
    phase = name;
    // Capture allocations before the diagnostic request can recycle the pool.
    const measured = memory(child.pid);
    const backends = includeProbe ? await probe() : [];
    const row = { name, ...measured, backends };
    console.log(JSON.stringify({ case: entry.name, ...row }));
    return row;
  }
  async function readPage(limit) {
    const r = await fetch(`${base}/memory_fixture?select=id,payload&order=id.asc&limit=${limit}`, { signal: AbortSignal.timeout(30000) });
    assert(r.ok, `fixture HTTP ${r.status}`);
    const checksum = createHash("sha256");
    let bytes = 0;
    for await (const chunk of r.body) { checksum.update(chunk); bytes += chunk.length; }
    const result = { limit, bytes, sha256: checksum.digest("hex") };
    if (expectedResponses.has(limit)) assert.deepEqual(result, expectedResponses.get(limit), "GC/pool/case must not alter any response bytes");
    else expectedResponses.set(limit, result);
    return result;
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      assert.equal(child.exitCode, null, "local API exited during startup");
      try { const r = await fetch(`${base}/`); if (r.ok) { await r.arrayBuffer(); ready = true; break; } } catch {}
      await wait(100);
    }
    assert(ready, "local API startup");
    timer = setInterval(() => { samples.push({ phase, ...memory(child.pid) }); }, 100);
    const baseline = await checkpoint("baseline");
    const requests = [];
    if (entry.legacy) {
      phase = "legacy_burst";
      requests.push(...await Promise.all(Array.from({ length: 5 }, () => readPage(1000))));
    }
    phase = "current_pages";
    for (let round = 0; round < 3; round++) requests.push(...await Promise.all([250, 100, 50, 50, 50].map(readPage)));
    const afterWork = await checkpoint("after_work");
    phase = "idle";
    await wait(35000);
    const afterIdle = await checkpoint("after_idle_before_request", false);
    const afterPoolRecycle = await checkpoint("after_pool_recycle");
    for (let i = 0; i < 10; i++) { await probe(); await wait(100); }
    await wait(2000);
    const final = await checkpoint("final");
    const result = { ...entry, baseline, afterWork, afterIdle, afterPoolRecycle, final, requests, peakRssBytes: Math.max(...samples.map((s) => s.VmRSSBytes)), samples };
    observations.push(result);
    writeFileSync(`${outputDirectory}/results.json`, JSON.stringify({ version, postgrest: execFileSync(binary, ["--version"], { encoding: "utf8", env: childEnvironment }).trim(), syntheticOnly: true, caveats: "API process /proc metrics, not production host attribution. VmSize is address space, not committed memory. Three current-page rounds after one five-request legacy burst; no production data, credentials or endpoints.", observations }, null, 2));
  } finally {
    clearInterval(timer);
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), wait(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
console.log("Exact response hashes unchanged across cases.");
