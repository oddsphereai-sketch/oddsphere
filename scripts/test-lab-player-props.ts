/**
 * Tests for /api/lab/player-props (Phase 5C).
 *
 *   • Auth-free GET returns 200
 *   • Slate-scoped: 39 props on 2026-05-22 (matches DB)
 *   • prop_market filter (UI key → DB market translation works)
 *   • tier filter (comma-separated list, query-time per Phase 3C decision)
 *   • minEdge filter (decimal — 0.1 means ≥10% absolute)
 *   • Non-live sport returns []
 *   • player_id filter (powers PlayerDrillDown — Decision E)
 *   • Sort order: edge_pct DESC
 *   • DTO shape (player, propType, recent10, hitsLast10, edgeRaw, tier)
 *   • Honest last-N: recent10.length may be < 10 (acceptable per Decision E)
 *
 * Run with: npm run test:lab-player-props
 */

import { GET as playerProps } from "../app/api/lab/player-props/route";
import { supabase } from "../lib/db/supabase";
import type { PlayerPropsResponse } from "../app/lab/lib/labTypes";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const SLATE_DATE = "2026-05-22";

async function main() {
  // ─── (1) Baseline: full slate ────────────────────────────────────────────
  section(`GET /api/lab/player-props?sport=mlb&date=${SLATE_DATE}`);

  const res = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}`)
  );
  check("returns 200", res.status === 200);

  const body = (await res.json()) as PlayerPropsResponse;
  check("body.sport = 'mlb'", body.sport === "mlb");
  check(`body.date = '${SLATE_DATE}'`, body.date === SLATE_DATE);
  check("body.entries is array", Array.isArray(body.entries));
  check(`39 entries on seeded slate`, body.entries.length === 39, `got: ${body.entries.length}`);
  check("filters echoed back", body.filters && body.filters.prop_market === null && Array.isArray(body.filters.tiers));

  if (body.entries.length === 0) {
    console.error("No entries returned — aborting downstream assertions");
    process.exit(1);
  }

  // ─── DTO shape ────────────────────────────────────────────────────────────
  section("Per-entry DTO shape");

  const e0 = body.entries[0]!;
  check("entry.id is non-empty string", typeof e0.id === "string" && e0.id.length > 0);
  check("entry.sport = 'mlb'", e0.sport === "mlb");
  check("entry.player.name is populated", typeof e0.player.name === "string" && e0.player.name.length > 0);
  check("entry.player.team is abbreviation", typeof e0.player.team === "string" && e0.player.team.length > 0 && e0.player.team !== "—");
  check(
    "entry.player.opponent prefixed with 'vs' or '@'",
    /^(vs |@ )/.test(e0.player.opponent),
    `got: ${e0.player.opponent}`
  );
  check(
    "entry.player.gameTime looks like 'H:MM AM/PM'",
    /^\d{1,2}:\d{2}\s+(AM|PM)$/.test(e0.player.gameTime),
    `got: ${e0.player.gameTime}`
  );
  check("entry.propType is a string", typeof e0.propType === "string" && e0.propType.length > 0);
  check("entry.line is positive", typeof e0.line === "number" && e0.line > 0);
  check("entry.side is 'over' or 'under'", e0.side === "over" || e0.side === "under");
  check("entry.odds is a non-empty string", typeof e0.odds === "string" && e0.odds.length > 0);
  check("entry.edge is in [0, 1]", typeof e0.edge === "number" && e0.edge >= 0 && e0.edge <= 1);
  check("entry.edgeRaw is finite", typeof e0.edgeRaw === "number" && Number.isFinite(e0.edgeRaw));
  check(
    "entry.tier is premium/strong/good/skip",
    ["premium", "strong", "good", "skip"].includes(e0.tier),
    `got: ${e0.tier}`
  );
  check("entry.recent10 is array (may be empty)", Array.isArray(e0.recent10) && e0.recent10.length <= 10);
  check("entry.hitsLast10 matches recent10 wins", e0.hitsLast10 === e0.recent10.filter(Boolean).length);
  check("entry.signals is array (V1: empty)", Array.isArray(e0.signals) && e0.signals.length === 0);

  // ─── Sort order: edge DESC (edge_pct descending) ─────────────────────────
  section("Sort order");

  // Server orders by edge_pct DESC nullsFirst:false. Since we expose |edge| as
  // entry.edge AND signed as entry.edgeRaw, the deterministic ordering is on
  // edgeRaw (signed) descending.
  const sortedRaw = body.entries.every((e, i, arr) =>
    i === 0 ? true : (arr[i - 1]!.edgeRaw ?? -Infinity) >= (e.edgeRaw ?? -Infinity)
  );
  check("entries sorted by edgeRaw DESC", sortedRaw);

  // ─── (2) prop_market filter ───────────────────────────────────────────────
  section("prop_market filter (UI → DB translation)");

  const r2 = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&prop_market=hits`)
  );
  const b2 = (await r2.json()) as PlayerPropsResponse;
  check("hits filter returns 200", r2.status === 200);
  check(`hits filter: all entries have propType='hits'`, b2.entries.every((e) => e.propType === "hits"));
  check(`hits filter returns at least one entry`, b2.entries.length > 0, `got: ${b2.entries.length}`);
  check("filters.prop_market echoes 'hits'", b2.filters.prop_market === "hits");

  const r3 = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&prop_market=strikeouts`)
  );
  const b3 = (await r3.json()) as PlayerPropsResponse;
  check(`strikeouts filter returns at least one entry`, b3.entries.length > 0);
  check(`strikeouts filter: all propType='strikeouts'`, b3.entries.every((e) => e.propType === "strikeouts"));

  const r4 = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&prop_market=quidditch`)
  );
  const b4 = (await r4.json()) as PlayerPropsResponse;
  check(`unknown prop_market returns empty entries (200, not 400)`, r4.status === 200 && b4.entries.length === 0);

  // ─── (3) Tier filter (Phase 3C: query-time) ───────────────────────────────
  section("Tier filter");

  const rPrem = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&tier=premium`)
  );
  const bPrem = (await rPrem.json()) as PlayerPropsResponse;
  check(`tier=premium returns entries`, bPrem.entries.length >= 1);
  check(`tier=premium: all tier='premium'`, bPrem.entries.every((e) => e.tier === "premium"));

  const rPS = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&tier=premium,strong`)
  );
  const bPS = (await rPS.json()) as PlayerPropsResponse;
  check(`tier=premium,strong returns 2 entries`, bPS.entries.length === 2, `got: ${bPS.entries.length}`);
  check(`tier=premium,strong: all in {premium,strong}`, bPS.entries.every((e) => e.tier === "premium" || e.tier === "strong"));

  const rSkip = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&tier=skip`)
  );
  const bSkip = (await rSkip.json()) as PlayerPropsResponse;
  check(`tier=skip returns the 37 skip entries`, bSkip.entries.length === 37);
  check(`tier=skip: all tier='skip'`, bSkip.entries.every((e) => e.tier === "skip"));

  // ─── (4) minEdge filter ───────────────────────────────────────────────────
  section("minEdge filter");

  const rEdge10 = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&minEdge=0.1`)
  );
  const bEdge10 = (await rEdge10.json()) as PlayerPropsResponse;
  check(
    `minEdge=0.1: every entry has edge >= 10%`,
    bEdge10.entries.every((e) => e.edge >= 0.1 - 1e-9),
    `entries: ${bEdge10.entries.length}`
  );

  // Tolerate "minEdge=10" syntax (percent-style) — should match "0.1"
  const rEdgePct = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&minEdge=10`)
  );
  const bEdgePct = (await rEdgePct.json()) as PlayerPropsResponse;
  check(
    `minEdge=10 (percent style) equivalent to 0.1`,
    bEdgePct.entries.length === bEdge10.entries.length
  );

  // ─── (5) Non-live sport → empty ──────────────────────────────────────────
  section("Non-live sport returns empty");

  const rNba = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=nba&date=${SLATE_DATE}`)
  );
  const bNba = (await rNba.json()) as PlayerPropsResponse;
  check("nba: 200, entries=[]", rNba.status === 200 && bNba.entries.length === 0);
  check("nba: body.sport='nba'", bNba.sport === "nba");

  // ─── (6) player_id filter (Decision E — PlayerDrillDown) ─────────────────
  section("player_id filter");

  const samplePlayerId = body.entries[0]!.player.id;
  const rPlayer = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&player_id=${samplePlayerId}`)
  );
  const bPlayer = (await rPlayer.json()) as PlayerPropsResponse;
  check(`player_id=${samplePlayerId} returns at least one entry`, bPlayer.entries.length >= 1);
  check(
    `player_id filter: every entry has player.id=${samplePlayerId}`,
    bPlayer.entries.every((e) => e.player.id === samplePlayerId)
  );

  // Bogus player_id → empty
  const rBogus = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&player_id=999999`)
  );
  const bBogus = (await rBogus.json()) as PlayerPropsResponse;
  check(`bogus player_id returns empty`, bBogus.entries.length === 0);

  // ─── (7) Last-N history accuracy ──────────────────────────────────────────
  section("Last-N history accuracy");

  // For any entry with recent10 > 0, verify hitsLast10 matches the boolean
  // count and that recent10 only contains booleans.
  let badHist = 0;
  for (const e of body.entries) {
    if (!e.recent10.every((b) => typeof b === "boolean")) badHist++;
    if (e.hitsLast10 !== e.recent10.filter(Boolean).length) badHist++;
  }
  check("hitsLast10 and recent10 are consistent for every entry", badHist === 0);

  // Cross-check: pick an entry with recent10 > 0 and verify against DB.
  const withHistory = body.entries.find((e) => e.recent10.length > 0);
  if (withHistory) {
    const samplePlayerId = Number(withHistory.player.id);
    const dbMarket = uiToDbMarket(withHistory.propType);
    const { data: historyPredictions } = await supabase
      .from("prop_predictions")
      .select("id, computed_at")
      .eq("player_id", samplePlayerId)
      .eq("prop_market", dbMarket)
      .order("computed_at", { ascending: false });
    const ids = (historyPredictions ?? []).map((p) => p.id);
    const { data: results } = await supabase
      .from("prediction_results")
      .select("prop_prediction_id, outcome")
      .in("prop_prediction_id", ids);
    const outcomeById = new Map<number, string>();
    for (const r of results ?? []) outcomeById.set(r.prop_prediction_id, r.outcome);
    // Reconstruct expected recent10 (oldest-first, up to 10 resolved wins/losses)
    const expected: boolean[] = [];
    for (const h of historyPredictions ?? []) {
      const o = outcomeById.get(h.id);
      if (o === "win") expected.push(true);
      else if (o === "loss") expected.push(false);
      if (expected.length === 10) break;
    }
    expected.reverse();
    check(
      `recent10 matches DB-derived history for ${withHistory.player.name} (${withHistory.propType})`,
      JSON.stringify(expected) === JSON.stringify(withHistory.recent10),
      `expected: ${JSON.stringify(expected)}; got: ${JSON.stringify(withHistory.recent10)}`
    );
  } else {
    console.log("  ~ skipped DB cross-check: no entry had non-empty recent10");
  }

  // ─── (8) Side derivation from edge sign ───────────────────────────────────
  section("Side derivation");

  let sideMismatches = 0;
  for (const e of body.entries) {
    const expected = e.edgeRaw >= 0 ? "over" : "under";
    if (e.side !== expected) sideMismatches++;
  }
  check(`side matches edgeRaw sign for every entry`, sideMismatches === 0);

  // ─── (9) Filter combinations don't leak skip into premium ────────────────
  section("Filter combinations");

  const rPS2 = await playerProps(
    new Request(`https://x/api/lab/player-props?sport=mlb&date=${SLATE_DATE}&tier=premium,strong&prop_market=hits`)
  );
  const bPS2 = (await rPS2.json()) as PlayerPropsResponse;
  check(
    `tier=premium,strong + prop_market=hits: all entries match both`,
    bPS2.entries.every((e) => (e.tier === "premium" || e.tier === "strong") && e.propType === "hits")
  );

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All player-props tests passed.`);
}

function uiToDbMarket(uiKey: string): string {
  const map: Record<string, string> = {
    hits:         "batter_hits",
    home_runs:    "batter_home_runs",
    total_bases:  "batter_total_bases",
    strikeouts:   "pitcher_strikeouts",
    er_allowed:   "pitcher_earned_runs",
    rbis:         "batter_rbis",
  };
  return map[uiKey] ?? uiKey;
}

main().catch((e) => {
  console.error("\n❌ test-lab-player-props failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
