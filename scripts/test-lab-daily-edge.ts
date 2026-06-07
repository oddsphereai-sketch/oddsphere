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

// Fix 5.1 (Flag C1): the production source filter now fails CLOSED by
// default — filters mock rows unless ODDSPHERE_DATA_MODE === "development".
// This suite exercises the seed slate's mock data and depends on the dev-
// mode pass-through, so opt in explicitly here. Runs before the route's
// module imports any filter helpers; isProductionDataMode reads env at
// call time, so this assignment is effective.
process.env.ODDSPHERE_DATA_MODE = "development";

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
  // Fix 7.2.5: total.line is nullable. Seed slate has lines.total rows
  // for every game so the route's priority chain (lines table → sport_
  // specific.listed_line → null) lands on a real positive number here.
  check(
    "game.predictions.total.line > 0 (non-null from seed lines table)",
    first.predictions.total.line !== null && first.predictions.total.line > 0
  );
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
    "game.predictions.ml.pick is a team abbreviation (not 'home'/'away') or null for held",
    first.predictions.ml.pick === null ||
      (first.predictions.ml.pick !== "home" &&
        first.predictions.ml.pick !== "away" &&
        first.predictions.ml.pick.length > 0)
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

  // Phase 4.2.C.2 — confidence is nullable (held markets). Null is
  // acceptable; only non-null values must be in [0, 1].
  const allInRange = body.games.every((g) =>
    [g.predictions.ml.confidence, g.predictions.total.confidence, g.predictions.nrfi.confidence].every(
      (c) => c === null || (c >= 0 && c <= 1)
    )
  );
  check("every game's ml/total/nrfi confidence is null or in [0, 1]", allInRange);

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

  // Fix 4.1 (Gap-18+19, Flag D1): sharpStatus derives from per-pick grade,
  // not from legacy signal_strength. Mirror the route's deriveSharpStatus()
  // rule here for the cross-check:
  //   best_signal / sharp_confirmed → confirm
  //   sharp_conflict                → caution
  //   everything else (incl. null)  → mixed
  function expectStatusFromGrade(grade: Grade | null): SharpStatus {
    if (grade === "best_signal" || grade === "sharp_confirmed") return "confirm";
    if (grade === "sharp_conflict") return "caution";
    return "mixed";
  }

  let mapFailures = 0;
  for (const g of body.games) {
    const expectedMl = expectStatusFromGrade(g.predictions.ml.grade);
    const expectedTotal = expectStatusFromGrade(g.predictions.total.grade);
    const expectedNrfi = expectStatusFromGrade(g.predictions.nrfi.grade);
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
    `route's per-market sharpStatus matches the grade-based deriveSharpStatus rule for every game (Fix 4.1)`,
    mapFailures === 0
  );

  // ─── sharpSignals[] count matches DB row count ────────────────────────────
  section("sharpSignals[] count");

  // Fix 4.1: re-query sharp_signals (now without signal_strength column).
  const gameDbIds = Array.from(idByExternal.values());
  const { data: signalRows } = await supabase
    .from("sharp_signals")
    .select("game_id, market_type")
    .in("game_id", gameDbIds);
  const dbSignalCount = signalRows?.length ?? 0;
  const responseSignalCount = body.games.reduce((acc, g) => acc + g.sharpSignals.length, 0);
  check(
    `total sharpSignals across response (${responseSignalCount}) matches DB rows (${dbSignalCount})`,
    responseSignalCount === dbSignalCount
  );

  // At least one signal carries actionable direction (positive or negative)
  // — i.e., the route correctly surfaces grade-aligned signals.
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
    // 4.1.10 — stub MarketEdgeDto for fixtures that test headline-grade
    // ranking, which targets the legacy `predictions` block. The new
    // per-market enriched fields are not exercised by these assertions.
    const stubMarket = () => ({
      pick: "X",
      confidence: 0.5,
      grade: null,
      signalType: null,
      marketSignal: null,
      sharpStatus: "mixed" as SharpStatus,
      held: false,  // Phase 4.2.C.2 — stub default
      verdict: { key: "no_play" as const, label: "No Play" },
      guidedGuide: "stub",
      guidedWatchOut: "stub",
      whyLine: "stub",
      riskLine: "stub",
      modelProb: null,
      marketFairProb: null,
      pinnacleEvPct: null,
      moneyPct: null,
      betsPct: null,
      publicSplits: [],
      priceAmerican: null,
      lineOpenAmerican: null,
      modelTotal: null,
      marketTotal: null,
      line: null,
      keyStats: [],
      modelTrustPct: null,
      marketImpliedPct: null,
      modelMarketGapPct: null,
      marketSource: null,
      marketDataQuality: "unavailable" as const,
      reviewFlags: [],
      reviewActionSummary: "keep" as const,
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
      scheduledLockAt: "2026-05-29T23:10:00.000Z",
      lockState: "open" as const,
      lockedAt: null,
      updatedAt: null,
      generatedAt: null,
      holdReason: null,
      homeStarter: null,
      awayStarter: null,
      predictions: {
        ml: tile(ml),
        total: { ...tile(total), line: 9 },
        nrfi: tile(nrfi),
      },
      markets: {
        moneyline: stubMarket(),
        total: stubMarket(),
        first_inning: stubMarket(),
      },
      decisionLine: "stub decision line",
      projected: { away: 0, home: 0 },
      sharpSignals: [],
      status: {
        lineupConfirmed: null,
        linesLocked: false,
        sharpSignalPending: true,
        marketDataLimited: false,
      },
      result: null,
      // Phase 4.1.8.B — breakdown is non-nullable on the DTO. Headline-grade
      // tests don't exercise breakdown semantics; supply a minimal stub that
      // satisfies the type. The verdict + sharpRead derivation are tested
      // separately below.
      breakdown: {
        verdict: { key: "no_play", label: "No Play" },
        sharpRead: {
          key: "no_data",
          sentence: "No clear sharp read on this matchup yet.",
        },
        modelBreakdown: null,
      },
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

  // ─── Fix 7.2.5 — Total card line: null fallback + listed_line + priority ──
  // Verifies the route's new total-line priority chain:
  //   1. lines table sportsbook total  (Pinnacle preferred)
  //   2. sport_specific.listed_line    (operator-entered fallback)
  //   3. null                          (no misleading predicted_total)
  //
  // Strategy: temporarily mutate one seed slate row at a time, request
  // daily-edge, assert the response's predictions.total.line, then
  // restore the seed state. Uses the same dailyEdge handler the
  // earlier sections used. The seed game we mutate is the first one
  // (sorted by game_date) so all subsequent tests can find it via
  // `body.games[0]`.
  section("Fix 7.2.5 — total.line priority chain + null fallback");

  // Snapshot the seed slate's first game and its current lines.total rows
  // so we can restore everything verbatim afterwards.
  const fix725Res = await dailyEdge(
    new Request("http://x?sport=mlb&date=2026-05-22")
  );
  const fix725Body = (await fix725Res.json()) as DailyEdgeResponse;
  const fix725Game = fix725Body.games[0]!;
  const fix725ExternalId = fix725Game.external_id;

  // Get the games.id for this external_id so we can scope the lines + sport_specific mutations.
  const { data: gameDbRow } = await supabase
    .from("games")
    .select("id")
    .eq("sport", "mlb")
    .eq("external_id", fix725ExternalId)
    .maybeSingle();
  const fix725GameDbId = (gameDbRow as { id: number } | null)?.id;
  check(`Fix 7.2.5 setup: found games.id for external_id=${fix725ExternalId}`, typeof fix725GameDbId === "number");

  // Snapshot existing lines.total rows for this game (we'll restore them).
  const { data: existingLines } = await supabase
    .from("lines")
    .select("*")
    .eq("game_id", fix725GameDbId!)
    .eq("market_type", "total");
  const linesSnapshot = (existingLines ?? []) as Record<string, unknown>[];

  // Snapshot the prediction's sport_specific (we'll restore it).
  const { data: predBefore } = await supabase
    .from("game_predictions")
    .select("id, sport_specific")
    .eq("game_id", fix725GameDbId!)
    .maybeSingle();
  const predDbId = (predBefore as { id: number } | null)?.id;
  const sportSpecificSnapshot = (predBefore as { sport_specific: Record<string, unknown> | null } | null)?.sport_specific ?? null;

  // ─ Test A: lines table present → DTO line === lines.total value ──────────
  // The baseline (seed) state already has lines.total rows. Pull the
  // expected value via the same Pinnacle-preferred priority the route uses.
  const baselineRes = await dailyEdge(
    new Request("http://x?sport=mlb&date=2026-05-22")
  );
  const baselineBody = (await baselineRes.json()) as DailyEdgeResponse;
  const baselineLine = baselineBody.games[0]!.predictions.total.line;
  check(
    `Fix 7.2.5 Test A: baseline (lines table present) → DTO line is non-null number (got ${baselineLine})`,
    typeof baselineLine === "number" && baselineLine > 0
  );

  // ─ Test B: no lines + no listed_line → DTO line === null ─────────────────
  // Delete the seed's total lines for this game (we restore in finally).
  // Also confirm sport_specific has no listed_line so the priority chain
  // bottoms out at null.
  await supabase
    .from("lines")
    .delete()
    .eq("game_id", fix725GameDbId!)
    .eq("market_type", "total");
  // Strip any listed_line from sport_specific (defensive — should be absent on seed).
  const strippedSportSpecific =
    sportSpecificSnapshot && typeof sportSpecificSnapshot === "object"
      ? Object.fromEntries(
          Object.entries(sportSpecificSnapshot).filter(([k]) => k !== "listed_line")
        )
      : null;
  await supabase
    .from("game_predictions")
    .update({ sport_specific: strippedSportSpecific })
    .eq("id", predDbId!);

  let nullTestPassed = false;
  let listedFallbackTestPassed = false;
  let priorityTestPassed = false;
  try {
    const noLinesRes = await dailyEdge(
      new Request("http://x?sport=mlb&date=2026-05-22")
    );
    const noLinesBody = (await noLinesRes.json()) as DailyEdgeResponse;
    const noLinesGame = noLinesBody.games.find(
      (g: { external_id: number }) => g.external_id === fix725ExternalId
    );
    nullTestPassed =
      noLinesGame !== undefined && noLinesGame.predictions.total.line === null;
    check(
      `Fix 7.2.5 Test B: no lines + no listed_line → DTO line === null (got ${noLinesGame?.predictions.total.line})`,
      nullTestPassed
    );
    // Critical anti-fallback assertion: line should NOT equal predicted_total.
    const predictedTotal = 8; // arbitrary; the point is line is null
    void predictedTotal;
    check(
      "Fix 7.2.5 Test B: DTO line is NOT silently substituted from predicted_total",
      noLinesGame?.predictions.total.line === null
    );

    // ─ Test C: no lines + listed_line=9.5 in sport_specific → DTO line=9.5 ──
    const listedSportSpecific = {
      ...(strippedSportSpecific ?? {}),
      listed_line: 9.5,
    };
    await supabase
      .from("game_predictions")
      .update({ sport_specific: listedSportSpecific })
      .eq("id", predDbId!);

    const listedRes = await dailyEdge(
      new Request("http://x?sport=mlb&date=2026-05-22")
    );
    const listedBody = (await listedRes.json()) as DailyEdgeResponse;
    const listedGame = listedBody.games.find(
      (g: { external_id: number }) => g.external_id === fix725ExternalId
    );
    listedFallbackTestPassed = listedGame?.predictions.total.line === 9.5;
    check(
      `Fix 7.2.5 Test C: no lines + sport_specific.listed_line=9.5 → DTO line=9.5 (got ${listedGame?.predictions.total.line})`,
      listedFallbackTestPassed
    );

    // ─ Test D: lines table AND listed_line both present → lines wins ────────
    // Insert ONE lines row at a different value (7.0) than listed_line (9.5).
    // Route should prefer lines table → DTO line=7.0. Schema columns:
    // game_id, market_type, sportsbook are NOT NULL; everything else optional.
    // fetched_at defaults to NOW().
    const { error: insertErr } = await supabase.from("lines").insert({
      game_id: fix725GameDbId!,
      market_type: "total",
      sportsbook: "pinnacle",
      side: "over",
      line_value: 7.0,
      odds_american: -110,
    });
    check(
      `Fix 7.2.5 Test D setup: lines insert succeeded (err: ${insertErr?.message ?? "none"})`,
      insertErr === null
    );

    const priorityRes = await dailyEdge(
      new Request("http://x?sport=mlb&date=2026-05-22")
    );
    const priorityBody = (await priorityRes.json()) as DailyEdgeResponse;
    const priorityGame = priorityBody.games.find(
      (g: { external_id: number }) => g.external_id === fix725ExternalId
    );
    priorityTestPassed = priorityGame?.predictions.total.line === 7.0;
    check(
      `Fix 7.2.5 Test D: lines table (7.0) + listed_line (9.5) → lines wins, DTO line=7.0 (got ${priorityGame?.predictions.total.line})`,
      priorityTestPassed
    );
  } finally {
    // ─ Cleanup: restore everything to seed state ──────────────────────────────
    await supabase
      .from("lines")
      .delete()
      .eq("game_id", fix725GameDbId!)
      .eq("market_type", "total");
    if (linesSnapshot.length > 0) {
      await supabase.from("lines").insert(linesSnapshot);
    }
    await supabase
      .from("game_predictions")
      .update({ sport_specific: sportSpecificSnapshot })
      .eq("id", predDbId!);

    // Verify cleanup landed.
    const { count: linesAfter } = await supabase
      .from("lines")
      .select("*", { count: "exact", head: true })
      .eq("game_id", fix725GameDbId!)
      .eq("market_type", "total");
    check(
      `Fix 7.2.5 cleanup: lines.total rows restored for game_id=${fix725GameDbId} (count=${linesAfter}, snapshot=${linesSnapshot.length})`,
      (linesAfter ?? 0) === linesSnapshot.length
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4.1.8.B — DTO extension: model-side breakdown extraction + verdict
  // and Sharp Read derivation in the API
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type ExtractFn = (s: unknown) => string | null;
    type DeriveVerdictFn = (
      pred: Record<string, unknown>,
      signals?: Array<Record<string, unknown>>,
    ) => {
      headlineGrade: string | null;
      headlineMarket: string | null;
      verdict: string;
    };
    type ProjectFn = (
      signals: Array<Record<string, unknown>>,
      pred: Record<string, unknown>
    ) => Array<{ market: string; direction: string }>;
    type BuildBreakdownFn = (
      pred: Record<string, unknown>,
      signals: Array<Record<string, unknown>>
    ) => {
      verdict: { key: string; label: string };
      sharpRead: { key: string; sentence: string };
      modelBreakdown: string | null;
    };
    const {
      extractModelBreakdown,
      deriveVerdictForRow,
      projectSharpSignalsForRead,
      buildBreakdownDto,
      GRADE_RANK,
    } = await import("../app/api/lab/daily-edge/route").then(
      (m) =>
        // Cast through unknown so the test helper signatures (which use loose
        // Record<string,unknown> shapes) can address the strictly-typed
        // production __TEST__ exports. Mirrors the existing loose-cast pattern
        // used elsewhere in this file for the pre-4.1.8 extractMemberBreakdown.
        (m as unknown as {
          __TEST__: {
            extractModelBreakdown: ExtractFn;
            deriveVerdictForRow: DeriveVerdictFn;
            projectSharpSignalsForRead: ProjectFn;
            buildBreakdownDto: BuildBreakdownFn;
            GRADE_RANK: Record<string, number>;
          };
        }).__TEST__
    );

    // ─── extractModelBreakdown: v2 namespace + legacy fallback ─────────────
    section("Phase 4.1.8.B — extractModelBreakdown reader");
    {
      // 1. v2 happy path
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "Cole has been sharp early." },
      });
      check(
        "[4.1.8.B.1] sport_specific.breakdown_v2.model_breakdown populated → returns string",
        r === "Cole has been sharp early."
      );
    }
    {
      // 2. Legacy fallback
      const r = extractModelBreakdown({
        member_summary: "Legacy single-blob copy from Phase 4.1.5.",
      });
      check(
        "[4.1.8.B.2] sport_specific.member_summary only → falls back to legacy",
        r === "Legacy single-blob copy from Phase 4.1.5."
      );
    }
    {
      // 3. Both present → v2 wins
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "v2 wins." },
        member_summary: "stale v1 should not appear",
      });
      check(
        "[4.1.8.B.3] both v2 and legacy present → v2 wins",
        r === "v2 wins."
      );
    }
    {
      // 4. Neither present
      const r = extractModelBreakdown({ other_key: "x" });
      check("[4.1.8.B.4] neither v2 nor legacy present → null", r === null);
    }
    {
      // 5. Null sport_specific
      check(
        "[4.1.8.B.5] sport_specific null → null",
        extractModelBreakdown(null) === null
      );
    }
    {
      // 6. Undefined sport_specific
      check(
        "[4.1.8.B.6] sport_specific undefined → null",
        extractModelBreakdown(undefined) === null
      );
    }
    {
      // 7. v2 with empty model_breakdown → falls through to legacy/null
      const r1 = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "" },
        member_summary: "legacy here",
      });
      check(
        "[4.1.8.B.7a] v2.model_breakdown empty + legacy present → returns legacy",
        r1 === "legacy here"
      );
      const r2 = extractModelBreakdown({
        breakdown_v2: { model_breakdown: "" },
      });
      check("[4.1.8.B.7b] v2.model_breakdown empty + no legacy → null", r2 === null);
    }
    {
      // 8. v2 with non-string model_breakdown → falls through
      const r = extractModelBreakdown({
        breakdown_v2: { model_breakdown: 42 },
        member_summary: "ok legacy",
      });
      check(
        "[4.1.8.B.8] v2.model_breakdown non-string + legacy present → returns legacy",
        r === "ok legacy"
      );
    }
    {
      // 9. Legacy non-string → null
      const r = extractModelBreakdown({ member_summary: 123 });
      check("[4.1.8.B.9] legacy non-string + no v2 → null", r === null);
    }
    {
      // 10. Malformed v2 (not an object) is gracefully ignored
      const r = extractModelBreakdown({
        breakdown_v2: "should-be-object",
        member_summary: "fallback works",
      });
      check(
        "[4.1.8.B.10] v2 not an object → falls back to legacy",
        r === "fallback works"
      );
    }

    // ─── deriveVerdictForRow: mirrors perPickHeadline + verdictDerivation ──
    section("Phase 4.1.8.B — deriveVerdictForRow");
    function predRow(over: Record<string, unknown>): Record<string, unknown> {
      return {
        ml_grade: null,
        ou_grade: null,
        nrfi_grade: null,
        ml_confidence: null,
        ou_confidence: null,
        nrfi_confidence: null,
        sport_specific: {},
        ...over,
      };
    }
    {
      const r = deriveVerdictForRow(predRow({}));
      check(
        "[4.1.8.B.11] all grades null → verdict=no_play",
        r.verdict === "no_play" && r.headlineGrade === null && r.headlineMarket === null
      );
    }
    {
      const r = deriveVerdictForRow(
        predRow({ ml_grade: "best_signal", ml_confidence: 60 })
      );
      check(
        "[4.1.8.B.12] ml=best_signal @ 0.60 conf → verdict=best_angle, market=ml",
        r.verdict === "best_angle" && r.headlineMarket === "ml"
      );
    }
    {
      // ML has weaker grade than total — total wins headline
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 64,
          ou_grade: "sharp_conflict",
          ou_confidence: 55,
        })
      );
      check(
        "[4.1.8.B.13] WSH @ ATL pattern: total=sharp_conflict outranks ml=market_watch → market=total, verdict=caution",
        r.headlineMarket === "total" && r.verdict === "caution"
      );
    }
    {
      // sharp_conflict + low confidence → still caution (4.1.8.A invariant
      // exercised through the API surface)
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "sharp_conflict",
          ml_confidence: 51,
          ou_confidence: 51,
          nrfi_confidence: 51,
        })
      );
      check(
        "[4.1.8.B.14] sharp_conflict + all confidences below floor → verdict=caution (NEVER no_play)",
        r.verdict === "caution"
      );
    }
    {
      // best_signal + all confidences below floor → no_play (floor wins
      // when sharp_conflict is NOT the grade)
      const r = deriveVerdictForRow(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 52,
          ou_confidence: 52,
          nrfi_confidence: 52,
        })
      );
      check(
        "[4.1.8.B.15] best_signal + all confidences below 0.53 → verdict=no_play",
        r.verdict === "no_play"
      );
    }
    {
      // Cross-equivalence with GRADE_RANK
      check(
        "[4.1.8.B.16] GRADE_RANK ordering: best_signal > sharp_confirmed > sharp_conflict",
        GRADE_RANK.best_signal > GRADE_RANK.sharp_confirmed &&
          GRADE_RANK.sharp_confirmed > GRADE_RANK.sharp_conflict
      );
    }

    // ─── Phase 6B.25 — locked-game verdict freeze ────────────────────
    section("Phase 6B.25 — locked-game verdict freeze");
    {
      // Locked game with a live opposing-money signal that would normally
      // be evaluated. The 6B.25 freeze passes empty signals to the
      // conflict / support helpers for locked games, so the frozen
      // sport_specific override propagates and live drift cannot flip
      // the displayed verdict away from what was locked.
      const opposingMoneyConflictSignal = [
        { market_type: "moneyline", side: "away", public_money_pct: 78, public_betting_pct: 50 },
      ];
      const lockedPred = predRow({
        ml_grade: "best_signal",
        ml_confidence: 60,
        predicted_ml_winner: "home",
        sport_specific: { ml_best_angle_eligible: true },
        locked_at: "2026-06-07T19:15:05Z",
      });
      const locked = deriveVerdictForRow(lockedPred, opposingMoneyConflictSignal as any);
      check(
        "[6B.25.1] LOCKED game ignores live opposing-money signal — frozen best_angle preserved",
        locked.verdict === "best_angle",
      );
    }
    {
      // Locked-grade sharp_conflict (frozen in pred.ml_grade itself) is
      // NOT a live signal — locked snapshot already includes that decision.
      // The 6B.25 freeze must NOT change locked-grade-driven verdicts.
      const locked = deriveVerdictForRow(
        predRow({
          ml_grade: "sharp_conflict",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          locked_at: "2026-06-07T19:15:05Z",
        }),
        [],
      );
      check(
        "[6B.25.2] locked game with locked sharp_conflict GRADE still routes to caution",
        locked.verdict === "caution",
      );
    }
    {
      // Unlocked games still respect live signals — 6B.25 only freezes
      // when locked_at !== null. Anti-regression for pre-lock UX.
      const unlocked = deriveVerdictForRow(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          predicted_ml_winner: "home",
          sport_specific: { ml_best_angle_eligible: true },
          locked_at: null,
        }),
        [],
      );
      check(
        "[6B.25.3] unlocked game + no signals still resolves to best_angle (no regression)",
        unlocked.verdict === "best_angle",
      );
    }

    // ─── projectSharpSignalsForRead: market normalization + direction ─────
    section("Phase 4.1.8.B — projectSharpSignalsForRead");
    {
      const projected = projectSharpSignalsForRead(
        [
          { market_type: "moneyline" },
          { market_type: "total" },
          { market_type: "first_inning_total" },
        ],
        predRow({
          ml_grade: "best_signal",
          ou_grade: "sharp_conflict",
          nrfi_grade: null,
        })
      );
      check(
        "[4.1.8.B.17] moneyline → market=ml, best_signal → direction=positive",
        projected[0]?.market === "ml" && projected[0]?.direction === "positive"
      );
      check(
        "[4.1.8.B.18] total → market=total, sharp_conflict → direction=negative",
        projected[1]?.market === "total" && projected[1]?.direction === "negative"
      );
      check(
        "[4.1.8.B.19] first_inning_total → market=nrfi, null grade → direction=neutral",
        projected[2]?.market === "nrfi" && projected[2]?.direction === "neutral"
      );
    }

    // ─── buildBreakdownDto: integration through the full surface ──────────
    section("Phase 4.1.8.B — buildBreakdownDto integration");
    {
      // 20. Empty row → no_play + no_data + null modelBreakdown
      const r = buildBreakdownDto(predRow({}), []);
      check(
        "[4.1.8.B.20] empty row → verdict=no_play + sharpRead=no_data + modelBreakdown=null",
        r.verdict.key === "no_play" &&
          r.verdict.label === "No Play" &&
          r.sharpRead.key === "no_data" &&
          r.modelBreakdown === null
      );
    }
    {
      // 21. Strong play + sharp support
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          sport_specific: {
            breakdown_v2: { model_breakdown: "Cole has been sharp early." },
          },
        }),
        [{ market_type: "moneyline" }]
      );
      check(
        "[4.1.8.B.21] best_signal + sharp signal on ml → verdict=best_angle + sharpRead=support + modelBreakdown=v2",
        r.verdict.key === "best_angle" &&
          r.verdict.label === "Best Angle" &&
          r.sharpRead.key === "support" &&
          r.sharpRead.sentence === "Sharp signals support this pick." &&
          r.modelBreakdown === "Cole has been sharp early."
      );
    }
    {
      // 22. Caution: sharp_conflict on total
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "market_watch",
          ou_grade: "sharp_conflict",
          ou_confidence: 55,
          sport_specific: {
            breakdown_v2: { model_breakdown: "Top of the order adds risk." },
          },
        }),
        [{ market_type: "total" }]
      );
      check(
        "[4.1.8.B.22] sharp_conflict on total → verdict=caution + sharpRead=push_against",
        r.verdict.key === "caution" &&
          r.sharpRead.key === "push_against" &&
          r.sharpRead.sentence ===
            "Sharp signals push against the model, so use caution."
      );
    }
    {
      // 23. Legacy fallback path still works (no v2 namespace)
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "market_watch",
          ml_confidence: 64,
          sport_specific: {
            member_summary: "Pre-4.1.8.B legacy text.",
          },
        }),
        []
      );
      check(
        "[4.1.8.B.23] legacy member_summary surfaces as modelBreakdown when v2 absent",
        r.modelBreakdown === "Pre-4.1.8.B legacy text." &&
          r.verdict.key === "watchlist" &&
          r.sharpRead.key === "no_data"
      );
    }
    {
      // 24. Operator keys never leak — verify the returned object has only
      //     the three approved fields
      const r = buildBreakdownDto(
        predRow({
          ml_grade: "best_signal",
          ml_confidence: 60,
          sport_specific: {
            breakdown_v2: { model_breakdown: "ok" },
            operator_detail: "INTERNAL: should never leak",
            breakdown_version: "v2.0",
            breakdown_generated_at: "2026-05-30T12:00:00Z",
          },
        }),
        []
      );
      const keys = Object.keys(r).sort();
      check(
        "[4.1.8.B.24a] breakdown DTO has exactly {verdict, sharpRead, modelBreakdown}",
        keys.length === 3 &&
          keys[0] === "modelBreakdown" &&
          keys[1] === "sharpRead" &&
          keys[2] === "verdict"
      );
      check(
        "[4.1.8.B.24b] breakdown DTO does not include operator_detail",
        !("operator_detail" in r) && !("operatorDetail" in r)
      );
      check(
        "[4.1.8.B.24c] breakdown DTO does not include breakdown_version",
        !("breakdown_version" in r) && !("breakdownVersion" in r)
      );
      check(
        "[4.1.8.B.24d] breakdown DTO does not include breakdown_generated_at",
        !("breakdown_generated_at" in r) && !("breakdownGeneratedAt" in r)
      );
    }
    {
      // 25. v2 wins over legacy when both present (integration form)
      const r = buildBreakdownDto(
        predRow({
          sport_specific: {
            breakdown_v2: { model_breakdown: "v2 fresh text" },
            member_summary: "stale v1 lingering",
          },
        }),
        []
      );
      check(
        "[4.1.8.B.25] both v2 and legacy present → modelBreakdown is v2",
        r.modelBreakdown === "v2 fresh text"
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4.1.8.B — cross-equivalence with perPickHeadline.ts (Sub-D2 risk R3)
  // ═══════════════════════════════════════════════════════════════════════════
  // Confirm the inlined GRADE_RANK + ordering in route.ts matches the
  // client helper at app/lab/lib/perPickHeadline.ts. Single failure here
  // means the two derivations drifted; consolidate before shipping.
  {
    const { headlineGrade } = await import("../app/lab/lib/perPickHeadline");
    const { deriveVerdictForRow } = await import(
      "../app/api/lab/daily-edge/route"
    ).then(
      (m) =>
        (m as unknown as {
          __TEST__: {
            deriveVerdictForRow: (
              p: Record<string, unknown>
            ) => { headlineGrade: string | null; headlineMarket: string | null };
          };
        }).__TEST__
    );

    // Three patterns drawn from observed 5/22 slate behavior
    const fixtures: Array<{
      label: string;
      ml: string | null;
      ou: string | null;
      nrfi: string | null;
      expectGrade: string | null;
    }> = [
      {
        label: "WSH @ ATL pattern: ml=market_watch + total=sharp_conflict + nrfi=market_watch",
        ml: "market_watch",
        ou: "sharp_conflict",
        nrfi: "market_watch",
        expectGrade: "sharp_conflict",
      },
      {
        label: "NYM @ PHI pattern: ml=sharp_confirmed + rest=market_watch",
        ml: "sharp_confirmed",
        ou: "market_watch",
        nrfi: "market_watch",
        expectGrade: "sharp_confirmed",
      },
      {
        label: "All null pattern: no grades",
        ml: null,
        ou: null,
        nrfi: null,
        expectGrade: null,
      },
    ];

    for (const fx of fixtures) {
      const clientGrade = headlineGrade({
        predictions: {
          ml: { grade: fx.ml as never, signalType: null, marketSignal: null } as never,
          total: {
            grade: fx.ou as never,
            signalType: null,
            marketSignal: null,
          } as never,
          nrfi: {
            grade: fx.nrfi as never,
            signalType: null,
            marketSignal: null,
          } as never,
        },
      } as never);
      const serverResult = deriveVerdictForRow({
        ml_grade: fx.ml,
        ou_grade: fx.ou,
        nrfi_grade: fx.nrfi,
        ml_confidence: 60,
        ou_confidence: 60,
        nrfi_confidence: 60,
      });
      check(
        `[4.1.8.B.equiv] ${fx.label} — server headlineGrade matches client (${
          serverResult.headlineGrade ?? "null"
        })`,
        serverResult.headlineGrade === fx.expectGrade &&
          clientGrade === fx.expectGrade
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 4.1.10 — per-market enrichment + status + lock placeholders
  // ──────────────────────────────────────────────────────────────────────
  section("4.1.10: DTO additives (per-market markets, status, lock placeholders)");
  {
    // Use the same live response we fetched at the top of main().
    const liveRes = await dailyEdge(
      new Request(`https://x/api/lab/daily-edge?sport=mlb&date=${SLATE_DATE}`)
    );
    const liveBody = (await liveRes.json()) as DailyEdgeResponse;
    if (!liveBody.games || liveBody.games.length === 0) {
      check("response has at least one game (precondition)", false);
    } else {
      const sample = liveBody.games[0]!;

      // ── lock fields (Phase 4.2.B) ──
      check(
        "[4.1.10] scheduledLockAt is a valid ISO string",
        typeof sample.scheduledLockAt === "string" &&
          !Number.isNaN(Date.parse(sample.scheduledLockAt))
      );
      // Phase 4.2.B — lockState is now driven by classifyLockState. The
      // visible-slate fallback (2026-05-22) has game_date in the past so
      // classifier returns "already_started", which the DTO maps to
      // "locked". For an actively-running slate the value would be "open"
      // or "locking". Accept any of the three valid enum values.
      check(
        `[4.2.B] lockState is one of "open"|"locking"|"locked"`,
        sample.lockState === "open" ||
          sample.lockState === "locking" ||
          sample.lockState === "locked"
      );
      // Pre-Phase 4.2.D cron activation, locked_at is NULL for every
      // existing row (the DDL added the column with no backfill). Lock
      // transitions only happen when pregame-sweep cron runs. So this
      // assertion still holds: until cron is scheduled, lockedAt stays
      // null even though lockState may map to "locked" (via the
      // already_started fallback for past slates).
      check(`[4.2.B] lockedAt === null pre-cron-activation`, sample.lockedAt === null);
      check(
        `[4.2.B] updatedAt is string|null`,
        sample.updatedAt === null || typeof sample.updatedAt === "string"
      );
      check(
        `[4.1.10] generatedAt is string|null`,
        sample.generatedAt === null || typeof sample.generatedAt === "string"
      );
      check(`[4.1.10] result === null pre-grading`, sample.result === null);

      // ── status block ──
      check(
        "[4.1.10] status.lineupConfirmed is boolean|null",
        sample.status.lineupConfirmed === null || typeof sample.status.lineupConfirmed === "boolean"
      );
      check("[4.1.10] status.linesLocked is boolean", typeof sample.status.linesLocked === "boolean");
      check("[4.1.10] status.sharpSignalPending is boolean", typeof sample.status.sharpSignalPending === "boolean");
      check("[4.1.10] status.marketDataLimited is boolean", typeof sample.status.marketDataLimited === "boolean");

      // ── decisionLine ──
      check("[4.1.10] decisionLine is a non-empty string", typeof sample.decisionLine === "string" && sample.decisionLine.length > 0);

      // ── markets block: all three present ──
      check("[4.1.10] markets.moneyline is present", typeof sample.markets?.moneyline === "object" && sample.markets.moneyline !== null);
      check("[4.1.10] markets.total is present", typeof sample.markets?.total === "object" && sample.markets.total !== null);
      check("[4.1.10] markets.first_inning is present", typeof sample.markets?.first_inning === "object" && sample.markets.first_inning !== null);

      // ── per-market shape ──
      const m = sample.markets.moneyline;
      check("[4.1.10] moneyline.verdict.key set", typeof m.verdict?.key === "string");
      check("[4.1.10] moneyline.verdict.label set", typeof m.verdict?.label === "string");
      check("[4.1.10] moneyline.guidedGuide non-empty", typeof m.guidedGuide === "string" && m.guidedGuide.length > 0);
      check("[4.1.10] moneyline.guidedWatchOut non-empty", typeof m.guidedWatchOut === "string" && m.guidedWatchOut.length > 0);
      check("[4.1.10] moneyline.whyLine non-empty", typeof m.whyLine === "string" && m.whyLine.length > 0);
      check("[4.1.10] moneyline.riskLine non-empty", typeof m.riskLine === "string" && m.riskLine.length > 0);
      check("[4.1.10] moneyline.modelProb is number 0-1", typeof m.modelProb === "number" && m.modelProb >= 0 && m.modelProb <= 1);
      check("[4.1.10] moneyline.keyStats is an array", Array.isArray(m.keyStats));

      // ── first_inning: splits fields are always null in V1 ──
      const fi = sample.markets.first_inning;
      check("[4.1.10] first_inning.moneyPct === null (V1)", fi.moneyPct === null);
      check("[4.1.10] first_inning.betsPct === null (V1)", fi.betsPct === null);
      // First-inning copy must not reference public splits / sharps
      const fiCopy = `${fi.guidedGuide} ${fi.guidedWatchOut} ${fi.whyLine} ${fi.riskLine}`.toLowerCase();
      const forbidden = ["public split", "public bet", "public money", "handle %", "bet %", "sharp action", "sharp money"];
      const dirty = forbidden.find((t) => fiCopy.includes(t));
      check(`[4.1.10] first_inning copy does not reference splits/sharps`, dirty === undefined, dirty ? `contained "${dirty}"` : undefined);

      // ── totals-only fields ──
      const t = sample.markets.total;
      check(`[4.1.10] total.modelTotal is number|null`, t.modelTotal === null || typeof t.modelTotal === "number");
      check(`[4.1.10] total.marketTotal is number|null`, t.marketTotal === null || typeof t.marketTotal === "number");

      // ── existing `predictions` block STILL present (backwards compat) ──
      check("[4.1.10] predictions.ml still present (backwards compat)", typeof sample.predictions?.ml === "object");
      check("[4.1.10] predictions.total still present", typeof sample.predictions?.total === "object");
      check("[4.1.10] predictions.nrfi still present", typeof sample.predictions?.nrfi === "object");

      // ── no banned terms in user-facing copy across ALL games ──
      const allCopyOk = liveBody.games.every((g) => {
        const fields = [
          g.decisionLine,
          g.markets.moneyline.guidedGuide,
          g.markets.moneyline.guidedWatchOut,
          g.markets.moneyline.whyLine,
          g.markets.moneyline.riskLine,
          g.markets.total.guidedGuide,
          g.markets.total.guidedWatchOut,
          g.markets.total.whyLine,
          g.markets.total.riskLine,
          g.markets.first_inning.guidedGuide,
          g.markets.first_inning.guidedWatchOut,
          g.markets.first_inning.whyLine,
          g.markets.first_inning.riskLine,
          ...g.markets.moneyline.keyStats.map((k) => k.label),
          ...g.markets.total.keyStats.map((k) => k.label),
          ...g.markets.first_inning.keyStats.map((k) => k.label),
        ];
        // Replicate the banned-terms regex locally to keep the test self-contained.
        const bannedRe = /\b(pinnacle|expected value|vig|vigorish|juice|consensus|reverse line movement|closing line value|book hold|arbitrage|arb)\b|\+\s*EV\b|\bEV\b|\bRLM\b|\bCLV\b|\bno[- ]vig\b|\bde[- ]vig(?:ged)?\b/i;
        return fields.every((f) => !bannedRe.test(f));
      });
      check(`[4.1.10] no banned terms across ${liveBody.games.length} games × all copy fields`, allCopyOk);
    }
  }

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
