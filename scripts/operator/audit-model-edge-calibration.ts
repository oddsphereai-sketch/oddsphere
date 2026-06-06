/**
 * Push 3C — Model Edge Calibration + Underdog Sanity Audit (read-only).
 *
 * READ-ONLY. Performs no DB writes, no provider calls, no model runs.
 * Pulls game_predictions + lines for the requested slate(s) and
 * produces calibration tables for ML, O/U, and FI V2.
 *
 * Specifically audits:
 *   • Can V2.2 pick the market underdog? At what rate, with what edge?
 *   • Is displayed ml_confidence calibrated to (model_prob − market_prob)
 *     or purely to model_prob?
 *   • Same question for ou_confidence and (post-cutover) FI V2.
 *   • Are Best-Angle / no_bet labels driven by real model-vs-market edge?
 *
 * USAGE:
 *   npx tsx --env-file=.env.local \
 *     scripts/operator/audit-model-edge-calibration.ts \
 *       --sport mlb --dates 2026-06-04,2026-06-05,2026-06-06 \
 *       [--markets ml,total,fi] [--verbose]
 *
 * NEVER writes. Refuses if `--apply` is passed (defense-in-depth).
 */

import { supabase } from "../../lib/db/supabase";
import type { Sport } from "../../lib/types/domain/Sport";

type Market = "ml" | "total" | "fi";
type Opts = {
  sport: Sport;
  dates: string[];
  markets: Set<Market>;
  verbose: boolean;
};

function parseArgs(argv: string[]): Opts {
  let dates: string[] = [];
  let sport: Sport = "mlb";
  const markets = new Set<Market>(["ml", "total", "fi"]);
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sport" && argv[i + 1]) { sport = argv[++i] as Sport; continue; }
    if (a === "--dates" && argv[i + 1]) { dates = argv[++i]!.split(",").map((s) => s.trim()); continue; }
    if (a === "--markets" && argv[i + 1]) {
      markets.clear();
      for (const m of argv[++i]!.split(",").map((s) => s.trim() as Market)) markets.add(m);
      continue;
    }
    if (a === "--verbose") { verbose = true; continue; }
    if (a === "--apply") {
      console.error("✗ --apply not supported (read-only).");
      process.exit(2);
    }
  }
  if (dates.length === 0) {
    console.error("Usage: audit-model-edge-calibration.ts --sport mlb --dates YYYY-MM-DD[,YYYY-MM-DD,...]");
    process.exit(1);
  }
  return { sport, dates, markets, verbose };
}

function americanToImpliedProb(odds: number | null): number | null {
  if (odds === null || !Number.isFinite(odds)) return null;
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

function noVigPair(homeOdds: number | null, awayOdds: number | null): { homeNoVig: number; awayNoVig: number } | null {
  const h = americanToImpliedProb(homeOdds);
  const a = americanToImpliedProb(awayOdds);
  if (h === null || a === null) return null;
  const sum = h + a;
  if (sum <= 0) return null;
  return { homeNoVig: h / sum, awayNoVig: a / sum };
}

type PerGame = {
  slate_date: string;
  matchup: string;
  game_external_id: number;
  // ML
  ml_pick: "home" | "away" | null;
  ml_confidence: number | null;
  ml_model_home_prob: number | null;
  ml_market_home_prob_no_vig: number | null;
  ml_pick_model_prob: number | null;
  ml_pick_market_prob_no_vig: number | null;
  ml_edge_pct: number | null;
  ml_pick_is_underdog: boolean | null;
  ml_play_grade: string | null;
  ml_best_angle: boolean | null;
  // OU
  ou_pick: "over" | "under" | null;
  ou_confidence: number | null;
  predicted_total: number | null;
  listed_total: number | null;
  ou_projected_delta: number | null;
  ou_edge_pct: number | null;
  ou_play_grade: string | null;
  ou_best_angle: boolean | null;
  // FI
  fi_pick: string | null;
  fi_confidence: number | null;
  fi_posterior_nrfi: number | null;
  fi_market_nrfi_no_vig: number | null;
  fi_edge_pct: number | null;
  fi_play_grade: string | null;
  fi_best_angle: boolean | null;
  fi_model_used: string | null;
  // misc
  data_quality_tier: string | null;
};

async function main() {
  const opts = parseArgs(process.argv);
  console.log(`\n━━━ MODEL EDGE CALIBRATION AUDIT · ${opts.sport.toUpperCase()} ${opts.dates.join(",")} ━━━`);
  console.log(`     markets=${[...opts.markets].join(",")}  READ-ONLY  no model runs\n`);

  const { data: teams } = await supabase.from("teams").select("id, abbreviation");
  const abbr = new Map((teams ?? []).map((t) => [t.id as number, t.abbreviation as string]));

  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, slate_date, home_team_id, away_team_id")
    .in("slate_date", opts.dates)
    .eq("sport", opts.sport);
  if (!games || games.length === 0) {
    console.log("No games on slate. Done.");
    return;
  }
  const gameIds = games.map((g) => g.id as number);
  const gameById = new Map(games.map((g) => [g.id as number, g]));

  const { data: preds } = await supabase
    .from("game_predictions")
    .select("game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_total, predicted_home_score, predicted_away_score, predicted_nrfi, nrfi_confidence, sport_specific")
    .in("game_id", gameIds);
  const predByGameId = new Map((preds ?? []).map((p) => [p.game_id as number, p]));

  const { data: lineRows } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", gameIds);

  // Build best-available market for each (game, market_type).
  type LineSummary = {
    homeOdds: number | null;
    awayOdds: number | null;
    line: number | null;
    overOdds: number | null;
    underOdds: number | null;
    nrfiOdds: number | null;
    yrfiOdds: number | null;
    book: string | null;
  };
  function pickFreshest(rows: typeof lineRows): LineSummary {
    const summary: LineSummary = {
      homeOdds: null, awayOdds: null, line: null,
      overOdds: null, underOdds: null,
      nrfiOdds: null, yrfiOdds: null,
      book: null,
    };
    if (!rows || rows.length === 0) return summary;
    // Prefer most recent fetched_at; group by side
    const sorted = [...rows].sort((a, b) => (b.fetched_at ?? "").localeCompare(a.fetched_at ?? ""));
    for (const r of sorted) {
      const side = (r.side as string | null)?.toLowerCase() ?? "";
      const o = r.odds_american as number | null;
      const v = r.line_value as number | null;
      const book = r.sportsbook as string | null;
      summary.book = summary.book ?? book;
      if (side === "home" && summary.homeOdds === null) summary.homeOdds = o;
      else if (side === "away" && summary.awayOdds === null) summary.awayOdds = o;
      else if (side === "over") {
        if (summary.overOdds === null) summary.overOdds = o;
        if (summary.line === null && v !== null) summary.line = v;
      }
      else if (side === "under") {
        if (summary.underOdds === null) summary.underOdds = o;
        if (summary.line === null && v !== null) summary.line = v;
      }
      else if (side === "nrfi" && summary.nrfiOdds === null) summary.nrfiOdds = o;
      else if (side === "yrfi" && summary.yrfiOdds === null) summary.yrfiOdds = o;
    }
    return summary;
  }

  const linesByGameByMarket = new Map<string, LineSummary>();
  const groups = new Map<string, typeof lineRows>();
  for (const r of lineRows ?? []) {
    const k = `${r.game_id}::${r.market_type}`;
    const arr = groups.get(k) ?? [];
    arr.push(r);
    groups.set(k, arr);
  }
  for (const [k, rows] of groups) linesByGameByMarket.set(k, pickFreshest(rows));

  const perGame: PerGame[] = [];
  for (const g of games) {
    const p = predByGameId.get(g.id as number);
    if (!p) continue;
    const home = abbr.get(g.home_team_id as number) ?? "?";
    const away = abbr.get(g.away_team_id as number) ?? "?";
    const matchup = `${away}@${home}`;
    const sp = (p.sport_specific as Record<string, unknown> | null) ?? {};
    const audit = (sp.v2_2_audit as Record<string, unknown> | undefined) ?? {};
    const fiAudit = (sp.fi_v2_audit as Record<string, unknown> | undefined) ?? {};
    const tier = (audit.data_quality_tier as string | undefined) ?? (fiAudit.data_quality_tier as string | undefined) ?? null;

    // ── ML ──
    const mlLines = linesByGameByMarket.get(`${g.id}::moneyline`);
    const mlNoVig = mlLines ? noVigPair(mlLines.homeOdds, mlLines.awayOdds) : null;
    const mlPick = (p.predicted_ml_winner as "home" | "away" | null) ?? null;
    const modelHomeProb = (audit.ml_model_prob as number | undefined) ?? null;
    // V2.2 audit stores ml_model_prob as the PICK-SIDE probability, not always home
    // So we reconstruct home prob using the winner direction.
    let mlPickModelProb: number | null = null;
    let mlPickMarketProb: number | null = null;
    if (mlPick !== null && typeof audit.ml_model_prob === "number") {
      mlPickModelProb = audit.ml_model_prob as number;
    }
    if (mlPick !== null && mlNoVig) {
      mlPickMarketProb = mlPick === "home" ? mlNoVig.homeNoVig : mlNoVig.awayNoVig;
    }
    let mlEdgePct: number | null = null;
    if (mlPickModelProb !== null && mlPickMarketProb !== null) {
      mlEdgePct = (mlPickModelProb - mlPickMarketProb) * 100;
    }
    // Underdog check using market no-vig
    let mlPickIsUnderdog: boolean | null = null;
    if (mlPick !== null && mlNoVig) {
      const pickMarket = mlPick === "home" ? mlNoVig.homeNoVig : mlNoVig.awayNoVig;
      mlPickIsUnderdog = pickMarket < 0.5;
    }
    const mlPlayGrade = (audit.ml_play_grade as string | undefined) ?? null;
    const mlBestAngle = (audit.ml_best_angle_eligible as boolean | undefined) ?? null;

    // ── OU ──
    const ouLines = linesByGameByMarket.get(`${g.id}::total`);
    const listedTotal = ouLines?.line ?? null;
    const projectedTotal = (p.predicted_total as number | null) ?? null;
    const ouProjectedDelta = listedTotal !== null && projectedTotal !== null
      ? projectedTotal - listedTotal
      : null;
    const ouEdgePct = (audit.ou_edge_pct as number | undefined) ?? null;
    const ouPlayGrade = (audit.ou_play_grade as string | undefined) ?? null;
    const ouBestAngle = (audit.ou_best_angle_eligible as boolean | undefined) ?? null;

    // ── FI ──
    const fiLines = linesByGameByMarket.get(`${g.id}::first_inning_total`);
    const fiMarketNoVigNrfi = fiLines ? (noVigPair(fiLines.nrfiOdds, fiLines.yrfiOdds)?.homeNoVig ?? null) : null;
    const fiPick = (sp.nrfi_decision_kind as string | undefined) === "toss_up"
      ? "Toss-Up"
      : Array.isArray(sp.hold_picks) && (sp.hold_picks as string[]).includes("nrfi")
        ? "Held"
        : p.predicted_nrfi === true ? "NRFI" : p.predicted_nrfi === false ? "YRFI" : null;
    const fiPosteriorNrfi = (fiAudit.posterior_p_nrfi as number | undefined) ?? null;
    const fiEdge = (fiAudit.fi_edge_pct as number | undefined) ?? null;
    const fiPlayGrade = (fiAudit.fi_play_grade as string | undefined) ?? null;
    const fiBestAngle = fiPlayGrade === "best_angle";
    const fiModelUsed = (sp.fi_model_used as string | undefined) ?? null;
    void modelHomeProb;

    perGame.push({
      slate_date: g.slate_date as string,
      matchup,
      game_external_id: g.external_id as number,
      ml_pick: mlPick,
      ml_confidence: (p.ml_confidence as number | null) ?? null,
      ml_model_home_prob: null,
      ml_market_home_prob_no_vig: mlNoVig?.homeNoVig ?? null,
      ml_pick_model_prob: mlPickModelProb,
      ml_pick_market_prob_no_vig: mlPickMarketProb,
      ml_edge_pct: mlEdgePct,
      ml_pick_is_underdog: mlPickIsUnderdog,
      ml_play_grade: mlPlayGrade,
      ml_best_angle: mlBestAngle,
      ou_pick: (p.predicted_ou_side as "over" | "under" | null) ?? null,
      ou_confidence: (p.ou_confidence as number | null) ?? null,
      predicted_total: projectedTotal,
      listed_total: listedTotal,
      ou_projected_delta: ouProjectedDelta,
      ou_edge_pct: ouEdgePct,
      ou_play_grade: ouPlayGrade,
      ou_best_angle: ouBestAngle,
      fi_pick: fiPick,
      fi_confidence: (p.nrfi_confidence as number | null) ?? null,
      fi_posterior_nrfi: fiPosteriorNrfi,
      fi_market_nrfi_no_vig: fiMarketNoVigNrfi,
      fi_edge_pct: fiEdge,
      fi_play_grade: fiPlayGrade,
      fi_best_angle: fiBestAngle,
      fi_model_used: fiModelUsed,
      data_quality_tier: tier,
    });
  }

  // ─── 1. ML underdog audit ────────────────────────────────────────────
  if (opts.markets.has("ml")) {
    console.log(`━━━ 1. Full-game V2.2 ML — underdog selection ━━━`);
    const mlGames = perGame.filter((p) => p.ml_pick !== null && p.ml_pick_market_prob_no_vig !== null);
    const favPicks = mlGames.filter((p) => p.ml_pick_is_underdog === false);
    const dogPicks = mlGames.filter((p) => p.ml_pick_is_underdog === true);
    const dogPosEdge = dogPicks.filter((p) => (p.ml_edge_pct ?? 0) > 0);
    const dogNegEdge = dogPicks.filter((p) => (p.ml_edge_pct ?? 0) <= 0);
    console.log(`  V2.2 games audited:              ${mlGames.length}`);
    console.log(`  Favorite picks:                  ${favPicks.length}  (${(favPicks.length / Math.max(1, mlGames.length) * 100).toFixed(1)}%)`);
    console.log(`  Underdog picks:                  ${dogPicks.length}  (${(dogPicks.length / Math.max(1, mlGames.length) * 100).toFixed(1)}%)`);
    console.log(`    underdog with positive edge:   ${dogPosEdge.length}`);
    console.log(`    underdog with negative edge:   ${dogNegEdge.length}`);

    if (opts.verbose && dogPicks.length > 0) {
      console.log(`\n  Underdog ML picks (verbose):`);
      console.log(`    ${"date".padEnd(11)} ${"matchup".padEnd(10)} side  conf  m_prob  mkt_prob  edge%  pg          tier`);
      for (const p of dogPicks.sort((a, b) => (b.ml_edge_pct ?? 0) - (a.ml_edge_pct ?? 0))) {
        console.log(`    ${p.slate_date.padEnd(11)} ${p.matchup.padEnd(10)} ${(p.ml_pick ?? "").padEnd(5)} ${String(p.ml_confidence ?? "—").padStart(4)}  ${(p.ml_pick_model_prob ?? 0).toFixed(3)}   ${(p.ml_pick_market_prob_no_vig ?? 0).toFixed(3)}   ${(p.ml_edge_pct ?? 0).toFixed(1).padStart(5)}  ${(p.ml_play_grade ?? "—").padEnd(11)} ${p.data_quality_tier ?? "—"}`);
      }
    }
  }

  // ─── 2. ML confidence vs no-vig audit ────────────────────────────────
  if (opts.markets.has("ml")) {
    console.log(`\n━━━ 2. ML confidence vs market no-vig calibration ━━━`);
    const buckets: Array<{ name: string; min: number; max: number }> = [
      { name: "edge ≤ 0%",  min: -Infinity, max: 0 },
      { name: "0–2%",       min: 0,          max: 2 },
      { name: "2–4%",       min: 2,          max: 4 },
      { name: "4–6%",       min: 4,          max: 6 },
      { name: "6%+",        min: 6,          max: Infinity },
    ];
    const mlBucketed = perGame.filter((p) => p.ml_edge_pct !== null && p.ml_confidence !== null);
    console.log(`  ${"bucket".padEnd(12)} count  avg_conf  best_angle  no_bet  lean  market_aligned`);
    for (const b of buckets) {
      const rows = mlBucketed.filter((r) => (r.ml_edge_pct ?? 0) > b.min && (r.ml_edge_pct ?? 0) <= b.max);
      const avgConf = rows.length ? rows.reduce((s, r) => s + (r.ml_confidence ?? 0), 0) / rows.length : 0;
      const ba = rows.filter((r) => r.ml_best_angle === true).length;
      const nb = rows.filter((r) => r.ml_play_grade === "no_bet").length;
      const ln = rows.filter((r) => r.ml_play_grade === "lean").length;
      const ma = rows.filter((r) => r.ml_play_grade === "market_aligned").length;
      console.log(`  ${b.name.padEnd(12)} ${String(rows.length).padStart(5)}  ${avgConf.toFixed(1).padStart(7)}  ${String(ba).padStart(10)}  ${String(nb).padStart(6)}  ${String(ln).padStart(4)}  ${String(ma).padStart(14)}`);
    }
    // High-confidence + low-edge flag
    const flagged = mlBucketed.filter((r) => (r.ml_confidence ?? 0) >= 60 && Math.abs(r.ml_edge_pct ?? 0) < 2);
    console.log(`\n  ⚠ High-confidence (≥60) + low-edge (|edge|<2%) games: ${flagged.length}`);
    if (opts.verbose && flagged.length > 0) {
      for (const p of flagged.slice(0, 20)) {
        console.log(`    ${p.slate_date} ${p.matchup.padEnd(10)} ${p.ml_pick}  conf=${p.ml_confidence}  edge=${(p.ml_edge_pct ?? 0).toFixed(2)}%  pg=${p.ml_play_grade}`);
      }
    }
  }

  // ─── 3. O/U confidence calibration ────────────────────────────────────
  if (opts.markets.has("total")) {
    console.log(`\n━━━ 3. O/U confidence vs projected-line delta ━━━`);
    const buckets: Array<{ name: string; min: number; max: number }> = [
      { name: "|Δ| ≤ 0.25", min: 0, max: 0.25 },
      { name: "0.25–0.75", min: 0.25, max: 0.75 },
      { name: "0.75–1.25", min: 0.75, max: 1.25 },
      { name: "1.25+",     min: 1.25, max: Infinity },
    ];
    const ouRows = perGame.filter((p) => p.ou_pick !== null && p.ou_projected_delta !== null && p.ou_confidence !== null);
    console.log(`  ${"bucket".padEnd(12)} count  avg_conf  best_angle  no_bet  lean  market_aligned`);
    for (const b of buckets) {
      const rows = ouRows.filter((r) => Math.abs(r.ou_projected_delta ?? 0) > b.min && Math.abs(r.ou_projected_delta ?? 0) <= b.max);
      const avgConf = rows.length ? rows.reduce((s, r) => s + (r.ou_confidence ?? 0), 0) / rows.length : 0;
      const ba = rows.filter((r) => r.ou_best_angle === true).length;
      const nb = rows.filter((r) => r.ou_play_grade === "no_bet").length;
      const ln = rows.filter((r) => r.ou_play_grade === "lean").length;
      const ma = rows.filter((r) => r.ou_play_grade === "market_aligned").length;
      console.log(`  ${b.name.padEnd(12)} ${String(rows.length).padStart(5)}  ${avgConf.toFixed(1).padStart(7)}  ${String(ba).padStart(10)}  ${String(nb).padStart(6)}  ${String(ln).padStart(4)}  ${String(ma).padStart(14)}`);
    }
    const flagged = ouRows.filter((r) => (r.ou_confidence ?? 0) >= 60 && Math.abs(r.ou_projected_delta ?? 0) < 0.25);
    console.log(`\n  ⚠ High-confidence (≥60) + tiny line delta (<0.25 runs): ${flagged.length}`);
  }

  // ─── 4. FI V2 calibration ────────────────────────────────────────────
  if (opts.markets.has("fi")) {
    console.log(`\n━━━ 4. FI V2 confidence vs market edge ━━━`);
    const buckets: Array<{ name: string; min: number; max: number }> = [
      { name: "edge ≤ 0%",     min: -Infinity, max: 0 },
      { name: "0–2%",          min: 0,          max: 2 },
      { name: "2–4%",          min: 2,          max: 4 },
      { name: "4%+",           min: 4,          max: Infinity },
    ];
    const fiRows = perGame.filter((p) => p.fi_play_grade !== null);
    const withEdge = fiRows.filter((r) => r.fi_edge_pct !== null);
    console.log(`  ${"bucket".padEnd(12)} count  avg_conf  best_angle  no_bet  lean  toss_up  held`);
    for (const b of buckets) {
      const rows = withEdge.filter((r) => Math.abs(r.fi_edge_pct ?? 0) > b.min && Math.abs(r.fi_edge_pct ?? 0) <= b.max);
      const avgConf = rows.length ? rows.reduce((s, r) => s + (r.fi_confidence ?? 0), 0) / rows.length : 0;
      const ba = rows.filter((r) => r.fi_play_grade === "best_angle").length;
      const nb = rows.filter((r) => r.fi_play_grade === "no_bet").length;
      const ln = rows.filter((r) => r.fi_play_grade === "lean").length;
      const tu = rows.filter((r) => r.fi_play_grade === "toss_up").length;
      const hd = rows.filter((r) => r.fi_play_grade === "held").length;
      console.log(`  ${b.name.padEnd(12)} ${String(rows.length).padStart(5)}  ${avgConf.toFixed(1).padStart(7)}  ${String(ba).padStart(10)}  ${String(nb).padStart(6)}  ${String(ln).padStart(4)}  ${String(tu).padStart(7)}  ${String(hd).padStart(4)}`);
    }
    const tossUp = fiRows.filter((r) => r.fi_play_grade === "toss_up");
    const held = fiRows.filter((r) => r.fi_play_grade === "held");
    const noBet = fiRows.filter((r) => r.fi_play_grade === "no_bet");
    console.log(`\n  Toss-Up rows:       ${tossUp.length}  (avg confidence ${tossUp.length ? (tossUp.reduce((s, r) => s + (r.fi_confidence ?? 0), 0) / tossUp.length).toFixed(1) : "—"})`);
    console.log(`  Held rows:          ${held.length}`);
    console.log(`  no_bet rows:        ${noBet.length}  (avg confidence ${noBet.length ? (noBet.reduce((s, r) => s + (r.fi_confidence ?? 0), 0) / noBet.length).toFixed(1) : "—"})`);
    const flagged = withEdge.filter((r) => (r.fi_confidence ?? 0) >= 55 && Math.abs(r.fi_edge_pct ?? 0) < 1.5 && r.fi_play_grade !== "toss_up");
    console.log(`  ⚠ FI confidence ≥55 + |edge|<1.5% + not toss_up: ${flagged.length}`);
    if (opts.verbose && flagged.length > 0) {
      for (const r of flagged.slice(0, 10)) {
        console.log(`    ${r.slate_date} ${r.matchup.padEnd(10)} ${r.fi_pick?.padEnd(8)} conf=${r.fi_confidence}  post=${(r.fi_posterior_nrfi ?? 0).toFixed(3)}  edge=${(r.fi_edge_pct ?? 0).toFixed(2)}%  pg=${r.fi_play_grade}  tier=${r.data_quality_tier}`);
      }
    }
  }

  // ─── 5. Display calibration spot-check ───────────────────────────────
  console.log(`\n━━━ 5. Display-layer spot-check (confidence vs edge mismatch) ━━━`);
  const mlMismatch = perGame.filter((p) =>
    p.ml_confidence !== null && p.ml_edge_pct !== null &&
    (p.ml_confidence ?? 0) >= 58 &&
    p.ml_edge_pct < 1 && p.ml_play_grade !== "no_bet",
  );
  const ouMismatch = perGame.filter((p) =>
    p.ou_confidence !== null && p.ou_projected_delta !== null &&
    (p.ou_confidence ?? 0) >= 58 && Math.abs(p.ou_projected_delta) < 0.20 && p.ou_play_grade !== "no_bet",
  );
  const fiMismatch = perGame.filter((p) =>
    p.fi_confidence !== null && p.fi_edge_pct !== null &&
    (p.fi_confidence ?? 0) >= 55 && Math.abs(p.fi_edge_pct) < 1 && p.fi_play_grade !== "toss_up" && p.fi_play_grade !== "held",
  );
  console.log(`  Visible-as-strong but edge-low (confidence ≥ thresholds, edge ≈ 0):`);
  console.log(`    ML:    ${mlMismatch.length}`);
  console.log(`    O/U:   ${ouMismatch.length}`);
  console.log(`    FI:    ${fiMismatch.length}`);

  // ─── 6. Underdog sanity ─────────────────────────────────────────────
  console.log(`\n━━━ 6. Underdog sanity (V2.2 model probability vs market) ━━━`);
  const mlPickable = perGame.filter((p) => p.ml_pick_model_prob !== null && p.ml_market_home_prob_no_vig !== null);
  const indepBuckets = [
    { name: "model > 55%",   min: 0.55, max: 1 },
    { name: "model 50-55%",  min: 0.50, max: 0.55 },
    { name: "model 45-50%",  min: 0.45, max: 0.50 },
    { name: "model 40-45%",  min: 0.40, max: 0.45 },
    { name: "model < 40%",   min: 0,    max: 0.40 },
  ];
  console.log(`  pick-side model prob bucket  | n  | avg edge  | avg conf  | underdog count`);
  for (const b of indepBuckets) {
    const rows = mlPickable.filter((r) => (r.ml_pick_model_prob ?? 0) > b.min && (r.ml_pick_model_prob ?? 0) <= b.max);
    const avgEdge = rows.length ? rows.reduce((s, r) => s + (r.ml_edge_pct ?? 0), 0) / rows.length : 0;
    const avgConf = rows.length ? rows.reduce((s, r) => s + (r.ml_confidence ?? 0), 0) / rows.length : 0;
    const dogs = rows.filter((r) => r.ml_pick_is_underdog === true).length;
    console.log(`  ${b.name.padEnd(27)} | ${String(rows.length).padStart(2)} | ${avgEdge.toFixed(2).padStart(8)}% | ${avgConf.toFixed(1).padStart(8)}  | ${dogs}`);
  }

  console.log(`\n━━━ END · ${perGame.length} games audited · NO writes ━━━\n`);
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
