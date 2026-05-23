/**
 * Tests for /api/lab/daily-edge (Phase 5B).
 *
 * Test design: the DB state for this slate is NOT fully deterministic across
 * test runs — Phase 4 suites (test-admin-upload, verdict regeneration) modify
 * game_predictions + sharp_signals between runs. Rather than couple the test
 * to a specific seed snapshot, this suite asserts:
 *
 *   1. Structural correctness (route returns 200, expected shape, 12 games)
 *   2. Server-side verdict aggregation is INTERNALLY CONSISTENT — for every
 *      game returned, its verdict matches the per-market sharpStatus values
 *      it carries (Decision G — server is the single source of truth)
 *   3. The sharpStatus mapping function correctly handles the actual signal
 *      rows in DB (strong + matching side ⇒ confirm; strong + opposite side
 *      ⇒ caution; null/moderate/missing ⇒ mixed)
 *
 * This way the test stays green regardless of what previous suites mutated.
 *
 * Run with: npm run test:lab-daily-edge
 */

import { GET as dailyEdge } from "../app/api/lab/daily-edge/route";
import { supabase } from "../lib/db/supabase";
import type {
  DailyEdgeGameDto,
  DailyEdgeResponse,
  DailyEdgeVerdict,
  SharpStatus,
} from "../app/lab/lib/labTypes";

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

/** Pure restatement of the route's verdict aggregator — used for consistency checks. */
function expectedVerdict(
  ml: SharpStatus,
  total: SharpStatus,
  nrfi: SharpStatus
): DailyEdgeVerdict {
  const statuses = [ml, total, nrfi];
  const confirms = statuses.filter((s) => s === "confirm").length;
  const cautions = statuses.filter((s) => s === "caution").length;
  if (confirms === 3) return "triple_lock";
  if (confirms === 2) return "strong";
  if (confirms === 1 && cautions === 0) return "lean";
  return "caution";
}

async function main() {
  // ─── Happy path: MLB slate ────────────────────────────────────────────────
  section("GET /api/lab/daily-edge?sport=mlb&date=2026-05-22");

  const res = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${SLATE_DATE}`)
  );
  check("returns 200", res.status === 200);

  const body = (await res.json()) as DailyEdgeResponse;
  check("body.sport = 'mlb'", body.sport === "mlb");
  check(`body.date = '${SLATE_DATE}'`, body.date === SLATE_DATE);
  check(
    "body.as_of is recent ISO",
    typeof body.as_of === "string" && Date.now() - new Date(body.as_of).getTime() < 5_000
  );
  check("body.games is an array", Array.isArray(body.games));
  check(`12 games on the slate`, body.games.length === 12, `got: ${body.games.length}`);

  if (body.games.length === 0) {
    console.error("No games returned — aborting downstream assertions");
    process.exit(1);
  }

  // ─── DTO shape (first game) ──────────────────────────────────────────────
  section("Per-game DTO shape");

  const first = body.games[0]!;
  check("game.id is a non-empty string", typeof first.id === "string" && first.id.length > 0);
  check("game.external_id is numeric", typeof first.external_id === "number");
  check("game.sport = 'mlb'", first.sport === "mlb");
  check(
    "game.awayTeam / homeTeam are populated abbreviations",
    typeof first.awayTeam === "string" && first.awayTeam.length > 0 && first.awayTeam !== "home" && first.awayTeam !== "away" &&
    typeof first.homeTeam === "string" && first.homeTeam.length > 0 && first.homeTeam !== "home" && first.homeTeam !== "away"
  );
  check(
    "game.gameTime looks like 'H:MM AM/PM'",
    /^\d{1,2}:\d{2}\s+(AM|PM)$/.test(first.gameTime),
    `got: ${first.gameTime}`
  );
  check("game.gameStartMinutes >= 0", first.gameStartMinutes >= 0);
  check("game.predictions has ml, total, nrfi", typeof first.predictions === "object" && "ml" in first.predictions && "total" in first.predictions && "nrfi" in first.predictions);
  check("game.predictions.total.line > 0", first.predictions.total.line > 0);
  check(
    "game.predictions.total.pick is 'Over' or 'Under'",
    first.predictions.total.pick === "Over" || first.predictions.total.pick === "Under",
    `got: ${first.predictions.total.pick}`
  );
  check(
    "game.predictions.nrfi.pick is NRFI or YRFI",
    first.predictions.nrfi.pick === "NRFI" || first.predictions.nrfi.pick === "YRFI"
  );
  check(
    "game.predictions.ml.pick is a team abbreviation (not 'home'/'away')",
    first.predictions.ml.pick !== "home" && first.predictions.ml.pick !== "away" && first.predictions.ml.pick.length > 0
  );
  check("game.projected is { away, home }", typeof first.projected === "object" && typeof first.projected.away === "number" && typeof first.projected.home === "number");
  check("game.sharpSignals is an array", Array.isArray(first.sharpSignals));
  check(
    "game.verdict is one of the 4 tiers",
    ["triple_lock", "strong", "lean", "caution"].includes(first.verdict),
    `got: ${first.verdict}`
  );
  check("game.verdictSubtitle is a non-empty string", typeof first.verdictSubtitle === "string" && first.verdictSubtitle.length > 0);

  // ─── Confidence values are in [0, 1] for every game ───────────────────────
  section("Confidence range");

  const allInRange = body.games.every((g) =>
    [g.predictions.ml.confidence, g.predictions.total.confidence, g.predictions.nrfi.confidence].every((c) => c >= 0 && c <= 1)
  );
  check("every game's ml/total/nrfi confidence in [0, 1]", allInRange);

  // ─── Sort order: gameStartMinutes ascending ──────────────────────────────
  section("Sort order");

  const isSorted = body.games.every((g, i, arr) =>
    i === 0 ? true : arr[i - 1]!.gameStartMinutes <= g.gameStartMinutes
  );
  check("games sorted by gameStartMinutes asc", isSorted);

  // ─── Verdict-status invariant (Decision G — server is source of truth) ────
  section("Server-derived verdict invariants");

  let invariantFailures = 0;
  for (const g of body.games) {
    const recomputed = expectedVerdict(
      g.predictions.ml.sharpStatus,
      g.predictions.total.sharpStatus,
      g.predictions.nrfi.sharpStatus
    );
    if (recomputed !== g.verdict) {
      invariantFailures++;
      console.log(`    inconsistency: ext_id=${g.external_id} verdict=${g.verdict} but ml/total/nrfi=${g.predictions.ml.sharpStatus}/${g.predictions.total.sharpStatus}/${g.predictions.nrfi.sharpStatus} → expected=${recomputed}`);
    }
  }
  check(
    `every game's verdict matches the aggregation of its 3 sharpStatuses`,
    invariantFailures === 0
  );

  // Subtitle ⇄ verdict: triple_lock / caution have specific text shapes.
  let subtitleFailures = 0;
  for (const g of body.games) {
    if (g.verdict === "caution" && g.verdictSubtitle !== "Mixed signals · proceed with caution") {
      subtitleFailures++;
    }
    if (g.verdict === "triple_lock" && !g.verdictSubtitle.startsWith("All three confirm")) {
      subtitleFailures++;
    }
  }
  check(`subtitle text matches verdict semantics`, subtitleFailures === 0);

  // ─── sharpStatus mapping consistency against DB sharp_signals ─────────────
  section("sharpStatus mapping consistency");

  // Pull raw sharp_signals rows for the slate's games and verify the route's
  // per-market sharpStatus values follow our rule:
  //   strong + same side as predicted ⇒ confirm
  //   strong + opposite side          ⇒ caution
  //   caution + same side             ⇒ caution
  //   else                            ⇒ mixed
  const gameIds = body.games.map((g) => g.external_id);
  const { data: gameRows } = await supabase
    .from("games")
    .select(
      `id, external_id,
       game_predictions ( predicted_ml_winner, predicted_ou_side, predicted_nrfi )`
    )
    .in("external_id", gameIds);

  const idByExternal = new Map<number, number>();
  const predByExternal = new Map<
    number,
    { ml: string; ou: string; nrfi: boolean }
  >();
  for (const row of (gameRows ?? []) as Array<{
    id: number;
    external_id: number;
    game_predictions: { predicted_ml_winner: string | null; predicted_ou_side: string | null; predicted_nrfi: boolean | null } | null;
  }>) {
    idByExternal.set(row.external_id, row.id);
    const p = row.game_predictions;
    if (p) {
      predByExternal.set(row.external_id, {
        ml: p.predicted_ml_winner ?? "home",
        ou: p.predicted_ou_side ?? "under",
        nrfi: p.predicted_nrfi ?? true,
      });
    }
  }

  const gameDbIds = Array.from(idByExternal.values());
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type, side, signal_strength")
    .in("game_id", gameDbIds);

  const signalsByGameAndMarket = new Map<string, { side: string; strength: string | null }>();
  for (const s of (signalRows ?? []) as Array<{ game_id: number; market_type: string; side: string; signal_strength: string | null }>) {
    signalsByGameAndMarket.set(`${s.game_id}:${s.market_type}`, { side: s.side, strength: s.signal_strength });
  }

  function expectStatus(predicted: string, signal: { side: string; strength: string | null } | undefined): SharpStatus {
    if (!signal) return "mixed";
    const strength = (signal.strength ?? "").toLowerCase();
    const same = signal.side === predicted;
    if (same && strength === "strong") return "confirm";
    if (same && strength === "caution") return "caution";
    if (!same && strength === "strong") return "caution";
    return "mixed";
  }

  let mapFailures = 0;
  for (const g of body.games) {
    const dbId = idByExternal.get(g.external_id);
    const pred = predByExternal.get(g.external_id);
    if (dbId === undefined || !pred) continue;
    const mlSignal = signalsByGameAndMarket.get(`${dbId}:moneyline`);
    const totalSignal = signalsByGameAndMarket.get(`${dbId}:total`);
    const nrfiSignal = signalsByGameAndMarket.get(`${dbId}:first_inning_total`);
    const nrfiSide = pred.nrfi ? "under" : "over";
    const expectedMl = expectStatus(pred.ml, mlSignal);
    const expectedTotal = expectStatus(pred.ou, totalSignal);
    const expectedNrfi = expectStatus(nrfiSide, nrfiSignal);
    if (
      g.predictions.ml.sharpStatus !== expectedMl ||
      g.predictions.total.sharpStatus !== expectedTotal ||
      g.predictions.nrfi.sharpStatus !== expectedNrfi
    ) {
      mapFailures++;
      console.log(
        `    map mismatch ext_id=${g.external_id} ml: got=${g.predictions.ml.sharpStatus} expect=${expectedMl} | total: got=${g.predictions.total.sharpStatus} expect=${expectedTotal} | nrfi: got=${g.predictions.nrfi.sharpStatus} expect=${expectedNrfi}`
      );
    }
  }
  check(
    `route's per-market sharpStatus matches the deriveSharpStatus rule for every game`,
    mapFailures === 0
  );

  // ─── sharpSignals[] count matches DB row count ────────────────────────────
  section("sharpSignals[] count");

  const dbSignalCount = signalRows?.length ?? 0;
  const responseSignalCount = body.games.reduce((acc, g) => acc + g.sharpSignals.length, 0);
  check(
    `total sharpSignals across response (${responseSignalCount}) matches DB rows (${dbSignalCount})`,
    responseSignalCount === dbSignalCount
  );

  // At least one signal carries actionable strength (strong/caution) — i.e.,
  // the route correctly surfaces sharp data when present.
  if (dbSignalCount > 0) {
    const actionable = body.games.flatMap((g) => g.sharpSignals).filter((s) => s.direction !== "neutral");
    check(
      `at least one sharpSignal has direction in {positive, negative}`,
      actionable.length > 0,
      `none of ${responseSignalCount} signals were actionable`
    );
  }

  // ─── Non-live sport → empty games array ───────────────────────────────────
  section("Non-live sport returns empty games");

  const nbaRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=nba&date=${SLATE_DATE}`)
  );
  check("returns 200 (not 404)", nbaRes.status === 200);
  const nbaBody = (await nbaRes.json()) as DailyEdgeResponse;
  check("nba body.sport = 'nba'", nbaBody.sport === "nba");
  check("nba body.games = [] (empty, not error)", Array.isArray(nbaBody.games) && nbaBody.games.length === 0);

  // ─── Invalid sport → falls back to MLB ────────────────────────────────────
  section("Invalid sport falls back to MLB");

  const bogusRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=quidditch&date=${SLATE_DATE}`)
  );
  check("returns 200", bogusRes.status === 200);
  const bogusBody = (await bogusRes.json()) as DailyEdgeResponse;
  check("falls back to mlb", bogusBody.sport === "mlb");
  check("still returns 12 games", bogusBody.games.length === 12);

  // ─── Invalid date → falls back to today UTC ───────────────────────────────
  section("Invalid date falls back to today UTC");

  const badDateRes = await dailyEdge(
    new Request(`https://x/api/lab/daily-edge?sport=mlb&date=not-a-date`)
  );
  check("returns 200", badDateRes.status === 200);
  const badDateBody = (await badDateRes.json()) as DailyEdgeResponse;
  check(
    "date param normalized to YYYY-MM-DD",
    /^\d{4}-\d{2}-\d{2}$/.test(badDateBody.date),
    `got: ${badDateBody.date}`
  );

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All daily-edge tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-lab-daily-edge failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
