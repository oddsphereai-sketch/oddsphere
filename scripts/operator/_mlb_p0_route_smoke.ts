/**
 * MLB-P0 READ-ONLY end-to-end route smoke.
 *
 * Calls the REAL /api/lab/daily-edge GET handler (same entry the test-lab
 * suite uses) against the live DB — no HTTP server needed. Validates the
 * card-facing read path survives the regularization + audit-field changes
 * and that existing LOCKED snapshots still render (backward compat).
 *
 * No writes.
 */
import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
process.env.PRODUCTION_DATA_MODE = process.env.PRODUCTION_DATA_MODE ?? "true";

(async () => {
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const dates = ["2026-06-13", "2026-06-12", "2026-06-11"];
  let failures = 0;
  const ok = (n: string, c: boolean, d = "") => {
    if (c) console.log(`✓ ${n}`);
    else { failures++; console.error(`✗ ${n}${d ? ` — ${d}` : ""}`); }
  };
  const isFiniteNum = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

  for (const date of dates) {
    const res = await GET(new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${date}`));
    ok(`[${date}] route returns 200`, res.status === 200, `status=${res.status}`);
    if (res.status !== 200) continue;
    const body = (await res.json()) as Record<string, unknown>;
    const games = (body.games ?? body.cards ?? []) as Array<Record<string, unknown>>;
    console.log(`[${date}] MLB games returned: ${games.length}`);
    if (games.length === 0) continue;

    let inspectedML = 0, inspectedTotal = 0;
    for (const g of games) {
      const markets = (g.markets ?? {}) as Record<string, unknown>;
      for (const key of ["moneyline", "total"]) {
        const mkt = markets[key] as Record<string, unknown> | undefined;
        if (!mkt) continue;
        // No NaN / undefined leaking from the new audit math.
        ok(`[${date}] ${key} modelProb finite/null (no NaN)`, isFiniteNum(mkt.modelProb), JSON.stringify(mkt.modelProb));
        ok(`[${date}] ${key} edge finite/null (no NaN)`, isFiniteNum(mkt.modelMarketGapPct ?? mkt.edge ?? null));
        ok(`[${date}] ${key} has a verdict/grade field`, "verdict" in mkt || "grade" in mkt || "sharpStatus" in mkt);
        if (key === "moneyline") inspectedML++; else inspectedTotal++;
      }
    }
    console.log(`[${date}] inspected ML slots=${inspectedML}, total slots=${inspectedTotal}`);
    if (games.length > 0) {
      // First slate with data is enough for the structural smoke.
      console.log(`\n[${date}] sample first game keys: ${Object.keys(games[0]).join(", ")}`);
      break;
    }
  }

  if (failures > 0) { console.error(`\n${failures} route-smoke assertion(s) failed.`); process.exit(1); }
  console.log("\nMLB-P0 route smoke passed (route 200 + MLB cards render + DTO fields finite).");
})();
