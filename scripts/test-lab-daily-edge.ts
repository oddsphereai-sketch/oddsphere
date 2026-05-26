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
  SharpStatus,
} from "../app/lab/lib/labTypes";
import {
  headlineGrade,
  headlinePrimaryMarket,
} from "../app/lab/lib/perPickHeadline";
import { getAttribution } from "../app/lab/lib/gradeAttribution";
import type {
  Grade,
  MarketSignal,
  SignalType,
} from "../lib/types/domain/Grade";

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

const VALID_GRADES = new Set<Grade>([
  "best_signal",
  "sharp_confirmed",
  "market_led",
  "model_only",
  "market_watch",
  "public_smoke",
  "sharp_conflict",
]);

const VALID_SIGNAL_TYPES = new Set<SignalType>([
  "model_dominant",
  "market_dominant",
  "balanced",
  "model_only",
  "market_only",
]);

const VALID_MARKET_SIGNALS = new Set<MarketSignal>([
  "market_confirmed",
  "market_neutral",
  "market_resistance",
  "public_smoke",
  "steam_alert",
]);

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

  // V2.1.1 (Phase 6.3.5e): legacy top-level grade / signalType /
  // marketSignal / primaryMarket fields were dropped from the DTO.
  // Per-pick fields (predictions.{ml,total,nrfi}.{grade,signalType,marketSignal})
  // are the new source of truth — invariants below cover them.

  // ─── V2.1.1 per-pick DTO invariants (Phase 6.3.5c) ────────────────────────
  section("Per-pick DTO invariants");

  // 9 union checks — grade × {ml,total,nrfi} × {grade, signalType, marketSignal}
  for (const market of ["ml", "total", "nrfi"] as const) {
    const tile = first.predictions[market];
    check(
      `first.predictions.${market}.grade is null or in the canonical Grade union`,
      tile.grade === null || VALID_GRADES.has(tile.grade),
      `got: ${tile.grade}`
    );
    check(
      `first.predictions.${market}.signalType is null or in the canonical SignalType union`,
      tile.signalType === null || VALID_SIGNAL_TYPES.has(tile.signalType),
      `got: ${tile.signalType}`
    );
    check(
      `first.predictions.${market}.marketSignal is null or in the canonical MarketSignal union`,
      tile.marketSignal === null || VALID_MARKET_SIGNALS.has(tile.marketSignal),
      `got: ${tile.marketSignal}`
    );
  }

  // Co-derivation / skip-NULL coherence: when any per-pick field is null,
  // the other two on the same tile must also be null. Verified across all
  // 12 games, all 3 tiles.
  let perPickTripletNonAtomic = 0;
  for (const g of body.games) {
    for (const market of ["ml", "total", "nrfi"] as const) {
      const tile = g.predictions[market];
      const nullCount =
        (tile.grade === null ? 1 : 0) +
        (tile.signalType === null ? 1 : 0) +
        (tile.marketSignal === null ? 1 : 0);
      // Atomic: either all 3 null or all 3 populated. Never mixed.
      if (nullCount !== 0 && nullCount !== 3) perPickTripletNonAtomic++;
    }
  }
  check(
    "per-pick triplet is atomic: all 3 fields null together or all 3 populated",
    perPickTripletNonAtomic === 0
  );

  // Internal consistency: for every game with a primary pick, the legacy
  // top-level grade/signalType/marketSignal MUST match
  // predictions[primaryMarket].* (precedence-1 dual-shape parity).
  type DtoMarketKey = "ml" | "total" | "nrfi";
  const PRIMARY_TO_TILE: Record<string, DtoMarketKey> = {
    moneyline: "ml",
    total: "total",
    first_inning_total: "nrfi",
  };
  // 6.3.5e: the dual-shape parity assertion (legacy top-level fields ===
  // predictions[primaryMarket].*) was removed when the legacy DTO fields
  // were dropped. perPickHeadline.ts now derives the headline client-side
  // for UI consumers; there's nothing on the wire to compare against.

  // Sanity: at least one game has a non-null per-pick grade triplet on
  // ML (the precedence-1 market). Confirms the V13 columns are being
  // populated end-to-end through marketSignalDerivationService +
  // gradeDerivationService + the route SELECT + the DTO mapping.
  const mlGradedCount = body.games.filter(
    (g) => g.predictions.ml.grade !== null
  ).length;
  check(
    "at least one game has a non-null predictions.ml.grade (V13 pipeline end-to-end)",
    mlGradedCount > 0,
    `mlGradedCount=${mlGradedCount}`
  );

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

  // ─── V2.1.1 per-pick grade invariants (post-6.3.5e) ───────────────────────
  // The legacy row-level grade/signalType/marketSignal/primaryMarket fields
  // were removed from the DTO in 6.3.5e. Equivalent invariants now run
  // against the per-pick triplets — covered in the "Per-pick DTO invariants"
  // section above (atomicity + union checks per tile + pipeline sanity).

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
  for (const row of (gameRows ?? []) as unknown as Array<{
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

  // ─── perPickHeadline rank-based selection (6.3.5e-fix-2) ──────────────
  // Pre-fix the headline used first-non-null precedence (ML → OU → NRFI)
  // which buried a sharp_conflict on Total under a market_watch on ML. The
  // fix sorts per-pick candidates by GRADE_RANK desc with ML→OU→NRFI as
  // the tiebreaker. These pure-function tests lock the rank table + tie
  // behavior; the end-to-end smoke is covered by the live slate audit
  // below.
  section("perPickHeadline rank-based selection (6.3.5e-fix-2)");

  function mkDto(
    ml: Grade | null,
    total: Grade | null,
    nrfi: Grade | null
  ): DailyEdgeGameDto {
    const tile = (grade: Grade | null) => ({
      pick: "X",
      confidence: 0.5,
      sharpStatus: "mixed" as SharpStatus,
      grade,
      signalType: null,
      marketSignal: null,
    });
    return {
      id: "test-1",
      sport: "mlb",
      external_id: 1,
      awayTeam: "AAA",
      awayTeamLogo: null,
      homeTeam: "BBB",
      homeTeamLogo: null,
      gameTime: "7:10 PM",
      gameStartMinutes: 0,
      predictions: {
        ml: tile(ml),
        total: { ...tile(total), line: 9 },
        nrfi: tile(nrfi),
      },
      projected: { away: 0, home: 0 },
      sharpSignals: [],
    };
  }

  // WSH @ ATL pattern: weak ML + strong OU caution → OU wins
  check(
    "ML=market_watch + Total=sharp_conflict + NRFI=market_watch → headline grade = sharp_conflict (WSH @ ATL pattern)",
    headlineGrade(mkDto("market_watch", "sharp_conflict", "market_watch")) ===
      "sharp_conflict"
  );
  check(
    "ML=market_watch + Total=sharp_conflict + NRFI=market_watch → headline market = total",
    headlinePrimaryMarket(
      mkDto("market_watch", "sharp_conflict", "market_watch")
    ) === "total"
  );

  // 6.3.5d core pattern: ML carries the strongest grade — ML wins (precedence-1)
  check(
    "ML=sharp_confirmed + Total=market_watch → headline grade = sharp_confirmed (preserves 6.3.5d core 4 cards)",
    headlineGrade(mkDto("sharp_confirmed", "market_watch", "market_watch")) ===
      "sharp_confirmed"
  );
  check(
    "ML=sharp_confirmed + Total=market_watch → headline market = moneyline",
    headlinePrimaryMarket(
      mkDto("sharp_confirmed", "market_watch", "market_watch")
    ) === "moneyline"
  );

  // Rank ordering: best_signal beats sharp_confirmed beats sharp_conflict
  check(
    "best_signal on NRFI outranks sharp_confirmed on ML (rank 70 > 60)",
    headlineGrade(mkDto("sharp_confirmed", "market_watch", "best_signal")) ===
      "best_signal" &&
      headlinePrimaryMarket(
        mkDto("sharp_confirmed", "market_watch", "best_signal")
      ) === "first_inning_total"
  );
  check(
    "sharp_confirmed on OU outranks sharp_conflict on ML (rank 60 > 50)",
    headlineGrade(
      mkDto("sharp_conflict", "sharp_confirmed", "market_watch")
    ) === "sharp_confirmed" &&
      headlinePrimaryMarket(
        mkDto("sharp_conflict", "sharp_confirmed", "market_watch")
      ) === "total"
  );
  check(
    "sharp_conflict on OU outranks market_led on ML (rank 50 > 40)",
    headlineGrade(mkDto("market_led", "sharp_conflict", "market_watch")) ===
      "sharp_conflict" &&
      headlinePrimaryMarket(
        mkDto("market_led", "sharp_conflict", "market_watch")
      ) === "total"
  );
  check(
    "public_smoke outranks model_only (rank 30 > 20)",
    headlineGrade(mkDto("model_only", "public_smoke", "market_watch")) ===
      "public_smoke"
  );
  check(
    "model_only outranks market_watch (rank 20 > 10)",
    headlineGrade(mkDto("market_watch", "model_only", "market_watch")) ===
      "model_only"
  );

  // Tiebreaker: equal grades → ML → OU → NRFI precedence
  check(
    "ML=sharp_confirmed + Total=sharp_confirmed → ML wins (precedence tiebreaker)",
    headlinePrimaryMarket(
      mkDto("sharp_confirmed", "sharp_confirmed", "market_watch")
    ) === "moneyline"
  );
  check(
    "Total=sharp_confirmed + NRFI=sharp_confirmed (ML=market_watch) → Total wins (precedence over NRFI)",
    headlinePrimaryMarket(
      mkDto("market_watch", "sharp_confirmed", "sharp_confirmed")
    ) === "total"
  );

  // Fix 1.3 (Gap-21): all-null grades → null (NOT market_watch fallback).
  // Pre-Fix-1.3 this branch returned market_watch as a defensive coerce,
  // which falsely implied market activity per framework §"Edge Case
  // Handling — Model didn't pick the market". Post-Fix-1.3 the UI renders
  // the honest "No Pick" treatment via GradeBadge's null variant.
  check(
    "all per-pick grades null → headlineGrade returns null (No Pick — Fix 1.3 Gap-21)",
    headlineGrade(mkDto(null, null, null)) === null
  );
  check(
    "all per-pick grades null → headlinePrimaryMarket returns null",
    headlinePrimaryMarket(mkDto(null, null, null)) === null
  );

  // Partial-null: NRFI has the only grade → NRFI is the headline
  check(
    "ML/Total null + NRFI=best_signal → headline = best_signal on NRFI",
    headlineGrade(mkDto(null, null, "best_signal")) === "best_signal" &&
      headlinePrimaryMarket(mkDto(null, null, "best_signal")) ===
        "first_inning_total"
  );

  // Fix 1.3 (Gap-21/26/27): getAttribution accepts null and returns the
  // "No Pick" copy. Locks the Flag D1 copy at the test boundary so a future
  // edit doesn't silently drift the member-facing message.
  check(
    "getAttribution(null, ...) returns 'Model didn't generate a pick...' (Flag D1 copy)",
    getAttribution(null, "—") ===
      "Model didn't generate a pick for this market."
  );

  // Live-slate audit: every game in the API response should have a
  // headline grade and market that match a non-null per-pick triplet.
  // Fix 1.3: games with all-null grades skip the rank check (they would
  // produce headlineGrade=null — covered by the pure-function test above).
  section("perPickHeadline live-slate consistency");
  let headlineMismatches = 0;
  const GRADE_RANK_LOCAL: Record<Grade, number> = {
    best_signal: 70,
    sharp_confirmed: 60,
    sharp_conflict: 50,
    market_led: 40,
    public_smoke: 30,
    model_only: 20,
    market_watch: 10,
  };
  for (const g of body.games) {
    const hg = headlineGrade(g);
    const candidates: Grade[] = [];
    if (g.predictions.ml.grade !== null) candidates.push(g.predictions.ml.grade);
    if (g.predictions.total.grade !== null)
      candidates.push(g.predictions.total.grade);
    if (g.predictions.nrfi.grade !== null)
      candidates.push(g.predictions.nrfi.grade);
    if (candidates.length === 0) {
      // All-null row — headline must be null too (Fix 1.3 Gap-21).
      if (hg !== null) headlineMismatches++;
      continue;
    }
    if (hg === null) {
      headlineMismatches++;
      continue;
    }
    const strongestRank = Math.max(...candidates.map((c) => GRADE_RANK_LOCAL[c]));
    if (GRADE_RANK_LOCAL[hg] !== strongestRank) headlineMismatches++;
  }
  check(
    "every live-slate game's headline grade equals the strongest per-pick grade (or null when all picks null)",
    headlineMismatches === 0
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
