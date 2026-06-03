/**
 * Phase 4.1.9.B — Six data reliability probes (READ-ONLY).
 *
 * Probes:
 *   1. line_history.is_opener fill rate by market_type
 *   2. sharp_signals.public_money_pct / public_betting_pct fill rate by market_type
 *   3. American prices (lines.odds_american) availability per market
 *   4. First-inning sharp data coverage (sharp_signals.market_type='first_inning_total')
 *   5. FeatureSnapshot field reliability (sport_specific.feature_snapshot fields)
 *   6. breakdown_v2.model_breakdown presence (sport_specific.breakdown_v2.model_breakdown)
 *
 * NO WRITES. NO DDL. NO MUTATIONS.
 *
 * Sample window: last 14 days of slate_dates (large enough to smooth out
 * day-to-day variance, small enough to reflect current pipeline behavior).
 *
 * Run: tsx --env-file=.env.local scripts/probes/phase-4_1_9_B-data-reliability.ts
 *
 * This script is intentionally NOT committed — it's a one-shot diagnostic
 * for the 4.1.9.B planning gate. Delete after the probe report is written.
 */

import { supabase } from "../../lib/db/supabase";

// ─── helpers ──────────────────────────────────────────────────────────

const SAMPLE_DAYS = 14;

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function rating(coverage: number, greenAt: number, yellowAt: number): "green" | "yellow" | "red" {
  if (coverage >= greenAt) return "green";
  if (coverage >= yellowAt) return "yellow";
  return "red";
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function row(label: string, value: string) {
  console.log(`  ${label.padEnd(48)} ${value}`);
}

// Compute the slate-date window: last SAMPLE_DAYS days ending today.
function getSlateWindow(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - SAMPLE_DAYS);
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

// ─── probe runner ─────────────────────────────────────────────────────

async function main() {
  const { from, to } = getSlateWindow();
  console.log(`\nPhase 4.1.9.B — Data reliability probes`);
  console.log(`Sample window: slate_date ${from} → ${to} (${SAMPLE_DAYS} days)`);
  console.log(`Source filter: source_type IN ('manual','real_api')  — production rows only\n`);

  // Fetch the base game set once (MLB games in the window).
  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, sport, slate_date, game_date, status")
    .eq("sport", "mlb")
    .gte("slate_date", from)
    .lte("slate_date", to);

  if (gamesErr) {
    console.error("Failed to fetch games:", gamesErr);
    process.exit(1);
  }
  const allGameIds = (games ?? []).map((g) => g.id);

  // Narrow to PRODUCTION games — those whose prediction has source_type in
  // ('manual','real_api'). Mock games dilute coverage and don't reflect the
  // production pipeline we're shipping.
  const { data: prodPreds, error: ppErr } = await supabase
    .from("game_predictions")
    .select("game_id, source_type")
    .in("game_id", allGameIds)
    .in("source_type", ["manual", "real_api"]);
  if (ppErr) {
    console.error("Failed to fetch prod predictions:", ppErr);
    process.exit(1);
  }
  const prodGameIds = Array.from(new Set((prodPreds ?? []).map((p) => p.game_id)));

  console.log(`Total MLB games in window:        ${allGameIds.length}`);
  console.log(`Production-source games (filter): ${prodGameIds.length}`);
  console.log("Probes that follow use the production-source subset.\n");

  const gameIds = prodGameIds;
  if (gameIds.length === 0) {
    console.log("No production games in window — bailing.");
    process.exit(0);
  }

  if (gameIds.length === 0) {
    console.log("No games in window — cannot probe. Bailing.");
    process.exit(0);
  }

  // ─── PROBE 1 — line_history.is_opener fill rate ──────────────────
  section("PROBE 1 — line_history.is_opener fill rate by market_type");
  {
    // Count games (per market_type) that have at least one is_opener=true row.
    const { data: openerRows, error } = await supabase
      .from("line_history")
      .select("game_id, market_type, is_opener")
      .in("game_id", gameIds)
      .eq("is_opener", true);

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const byMarket = new Map<string, Set<number>>();
      for (const r of openerRows ?? []) {
        if (!byMarket.has(r.market_type)) byMarket.set(r.market_type, new Set());
        byMarket.get(r.market_type)!.add(r.game_id);
      }
      const totalRows = (openerRows ?? []).length;
      row("Total is_opener=true rows", String(totalRows));

      for (const market of ["moneyline", "total", "first_inning_total"]) {
        const gamesCovered = byMarket.get(market)?.size ?? 0;
        const coverage = gamesCovered / gameIds.length;
        const r = rating(coverage, 0.8, 0.5);
        row(
          `  ${market.padEnd(20)} games with opener row`,
          `${gamesCovered}/${gameIds.length} = ${pct(gamesCovered, gameIds.length)}  [${r}]`
        );
      }

      // Also report all market_types present, in case unexpected ones exist
      const allMarketTypes = Array.from(byMarket.keys()).sort();
      row("All market_types observed in line_history (opener rows)", allMarketTypes.join(", ") || "(none)");
    }
  }

  // ─── PROBE 2 — public money / bets fill rate ─────────────────────
  section("PROBE 2 — sharp_signals public_money_pct / public_betting_pct fill rate");
  {
    const { data: signals, error } = await supabase
      .from("sharp_signals")
      .select("game_id, market_type, public_money_pct, public_betting_pct")
      .in("game_id", gameIds);

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const byMarketTotal = new Map<string, Set<number>>();
      const byMarketMoney = new Map<string, Set<number>>();
      const byMarketBets = new Map<string, Set<number>>();
      for (const s of signals ?? []) {
        if (!byMarketTotal.has(s.market_type)) {
          byMarketTotal.set(s.market_type, new Set());
          byMarketMoney.set(s.market_type, new Set());
          byMarketBets.set(s.market_type, new Set());
        }
        byMarketTotal.get(s.market_type)!.add(s.game_id);
        if (s.public_money_pct !== null) byMarketMoney.get(s.market_type)!.add(s.game_id);
        if (s.public_betting_pct !== null) byMarketBets.get(s.market_type)!.add(s.game_id);
      }
      row("Total sharp_signals rows", String((signals ?? []).length));

      for (const market of ["moneyline", "total", "first_inning_total"]) {
        const totalGames = byMarketTotal.get(market)?.size ?? 0;
        const moneyGames = byMarketMoney.get(market)?.size ?? 0;
        const betsGames = byMarketBets.get(market)?.size ?? 0;
        const moneyCov = totalGames === 0 ? 0 : moneyGames / totalGames;
        const betsCov = totalGames === 0 ? 0 : betsGames / totalGames;
        const moneyR = rating(moneyCov, 0.7, 0.4);
        const betsR = rating(betsCov, 0.7, 0.4);
        row(
          `  ${market.padEnd(20)} games with any signal row`,
          `${totalGames}/${gameIds.length} = ${pct(totalGames, gameIds.length)}`
        );
        row(
          `  ${market.padEnd(20)} money_pct populated`,
          `${moneyGames}/${totalGames} = ${pct(moneyGames, totalGames)}  [${moneyR}]`
        );
        row(
          `  ${market.padEnd(20)} bets_pct populated`,
          `${betsGames}/${totalGames} = ${pct(betsGames, totalGames)}  [${betsR}]`
        );
      }
    }
  }

  // ─── PROBE 3 — American prices availability ──────────────────────
  section("PROBE 3 — lines.odds_american availability per market");
  {
    const { data: lines, error } = await supabase
      .from("lines")
      .select("game_id, market_type, sportsbook, odds_american, line_value")
      .in("game_id", gameIds);

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const byMarketTotal = new Map<string, Set<number>>();
      const byMarketWithOdds = new Map<string, Set<number>>();
      const sportsbooksPerMarket = new Map<string, Set<string>>();
      for (const ln of lines ?? []) {
        if (!byMarketTotal.has(ln.market_type)) {
          byMarketTotal.set(ln.market_type, new Set());
          byMarketWithOdds.set(ln.market_type, new Set());
          sportsbooksPerMarket.set(ln.market_type, new Set());
        }
        byMarketTotal.get(ln.market_type)!.add(ln.game_id);
        if (ln.odds_american !== null) byMarketWithOdds.get(ln.market_type)!.add(ln.game_id);
        sportsbooksPerMarket.get(ln.market_type)!.add(ln.sportsbook);
      }
      row("Total lines rows", String((lines ?? []).length));

      for (const market of ["moneyline", "total", "first_inning_total"]) {
        const totalGames = byMarketTotal.get(market)?.size ?? 0;
        const oddsGames = byMarketWithOdds.get(market)?.size ?? 0;
        const cov = gameIds.length === 0 ? 0 : oddsGames / gameIds.length;
        const r = rating(cov, 0.8, 0.5);
        const books = Array.from(sportsbooksPerMarket.get(market) ?? []).sort().join(", ");
        row(
          `  ${market.padEnd(20)} games with any line row`,
          `${totalGames}/${gameIds.length} = ${pct(totalGames, gameIds.length)}`
        );
        row(
          `  ${market.padEnd(20)} games with odds_american !== null`,
          `${oddsGames}/${gameIds.length} = ${pct(oddsGames, gameIds.length)}  [${r}]`
        );
        row(`  ${market.padEnd(20)} books`, books || "(none)");
      }

      // Also report all market_types observed in lines (e.g., spread, prop_player_hits)
      const allMarketTypes = Array.from(byMarketTotal.keys()).sort();
      row("All market_types observed in lines", allMarketTypes.join(", ") || "(none)");
    }
  }

  // ─── PROBE 4 — first-inning sharp data coverage ──────────────────
  section("PROBE 4 — First-inning sharp_signals coverage");
  {
    const { data: firstInning, error } = await supabase
      .from("sharp_signals")
      .select("game_id, market_type, has_steam_move, has_reverse_line_movement, is_plus_ev, signal_strength")
      .in("game_id", gameIds)
      .eq("market_type", "first_inning_total");

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const gamesWithSignal = new Set<number>();
      let withSteam = 0;
      let withRlm = 0;
      let withEv = 0;
      let strongOrCaution = 0;
      for (const s of firstInning ?? []) {
        gamesWithSignal.add(s.game_id);
        if (s.has_steam_move) withSteam++;
        if (s.has_reverse_line_movement) withRlm++;
        if (s.is_plus_ev) withEv++;
        if (s.signal_strength === "strong" || s.signal_strength === "caution") strongOrCaution++;
      }
      const cov = gamesWithSignal.size / gameIds.length;
      const r = rating(cov, 0.7, 0.5);
      row("Total first_inning_total signal rows", String((firstInning ?? []).length));
      row("Games with any 1st-inning signal row", `${gamesWithSignal.size}/${gameIds.length} = ${pct(gamesWithSignal.size, gameIds.length)}  [${r}]`);
      row("  of those: has_steam_move=true", `${withSteam}`);
      row("  of those: has_reverse_line_movement=true", `${withRlm}`);
      row("  of those: is_plus_ev=true", `${withEv}`);
      row("  of those: signal_strength strong/caution", `${strongOrCaution}`);
    }
  }

  // ─── PROBE 5 — FeatureSnapshot field reliability ─────────────────
  section("PROBE 5 — FeatureSnapshot field reliability (sport_specific.feature_snapshot)");
  {
    const { data: preds, error } = await supabase
      .from("game_predictions")
      .select("game_id, sport_specific")
      .in("game_id", gameIds);

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const total = preds?.length ?? 0;
      row("Total game_predictions rows", String(total));

      // Counters against the ACTUAL auto_factors field names observed in
      // sport_specific. These are the candidate KeyStats inputs.
      const counters: Record<string, { populated: number }> = {
        "home_starter_era":              { populated: 0 },
        "away_starter_era":              { populated: 0 },
        "home_starter_era_factor":       { populated: 0 },
        "away_starter_era_factor":       { populated: 0 },
        "home_lineup_weighted_ops":      { populated: 0 },
        "away_lineup_weighted_ops":      { populated: 0 },
        "home_lineup_ops_factor_adj":    { populated: 0 },
        "away_lineup_ops_factor_adj":    { populated: 0 },
        "home_bullpen_factor":           { populated: 0 },
        "away_bullpen_factor":           { populated: 0 },
        "park_factor_runs":              { populated: 0 },
        "weather_total_adjust":          { populated: 0 },
        "nrfi_expected_runs":            { populated: 0 },
        "nrfi_used_top_of_order_data":   { populated: 0 },
      };

      function has(v: unknown): boolean {
        return v !== null && v !== undefined && v !== "";
      }

      for (const p of preds ?? []) {
        const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
        const snap =
          (ss.auto_factors as Record<string, unknown> | undefined) ??
          null;
        if (!snap) continue;

        const m: Record<string, string> = {
          "home_starter_era":              "home_starter_era",
          "away_starter_era":              "away_starter_era",
          "home_starter_era_factor":       "home_starter_era_factor",
          "away_starter_era_factor":       "away_starter_era_factor",
          "home_lineup_weighted_ops":      "home_lineup_weighted_ops",
          "away_lineup_weighted_ops":      "away_lineup_weighted_ops",
          "home_lineup_ops_factor_adj":    "home_lineup_ops_factor_adjusted",
          "away_lineup_ops_factor_adj":    "away_lineup_ops_factor_adjusted",
          "home_bullpen_factor":           "home_bullpen_factor",
          "away_bullpen_factor":           "away_bullpen_factor",
          "park_factor_runs":              "park_factor_runs",
          "weather_total_adjust":          "weather_total_adjust",
          "nrfi_expected_runs":            "nrfi_expected_runs",
          "nrfi_used_top_of_order_data":   "nrfi_used_top_of_order_data",
        };
        for (const [key, jsonKey] of Object.entries(m)) {
          if (has(snap[jsonKey])) counters[key].populated++;
        }
      }

      // Detect whether ANY snapshot was found at all
      let withSnapshot = 0;
      for (const p of preds ?? []) {
        const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
        if (ss.auto_factors || ss.feature_snapshot || ss.featureSnapshot || ss.snapshot) withSnapshot++;
      }
      row("game_predictions rows with auto_factors/snapshot", `${withSnapshot}/${total} = ${pct(withSnapshot, total)}`);

      // If a snapshot exists, dump its actual top-level keys from the first
      // few rows so we know the real field paths to look under.
      if (withSnapshot > 0) {
        const sampleKeys = new Set<string>();
        for (const p of (preds ?? []).slice(0, 5)) {
          const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
          const snap = (ss.auto_factors ?? ss.feature_snapshot ?? ss.featureSnapshot ?? ss.snapshot) as Record<string, unknown> | undefined;
          if (snap) for (const k of Object.keys(snap)) sampleKeys.add(k);
        }
        row("Snapshot top-level keys (first 5 rows)", Array.from(sampleKeys).sort().join(", "));
      }

      for (const [field, c] of Object.entries(counters)) {
        const pop = total === 0 ? 0 : c.populated / total;
        const r = rating(pop, 0.7, 0.4);
        row(`  ${field.padEnd(50)}`, `${c.populated}/${total} = ${pct(c.populated, total)}  [${r}]`);
      }

      // If no snapshots were found at all, surface the actual top-level keys
      // in sport_specific from a sample row so we know where the data lives.
      if (withSnapshot === 0 && (preds?.length ?? 0) > 0) {
        const sampleKeys = new Set<string>();
        for (const p of (preds ?? []).slice(0, 20)) {
          const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
          for (const k of Object.keys(ss)) sampleKeys.add(k);
        }
        row("⚠ No snapshot key found. Top-level sport_specific keys observed", Array.from(sampleKeys).sort().join(", ") || "(empty)");
      }
    }
  }

  // ─── PROBE 6 — breakdown_v2.model_breakdown presence ─────────────
  section("PROBE 6 — sport_specific.breakdown_v2.model_breakdown presence");
  {
    const { data: preds, error } = await supabase
      .from("game_predictions")
      .select("game_id, sport_specific")
      .in("game_id", gameIds);

    if (error) {
      console.error("  Query failed:", error.message);
    } else {
      const total = preds?.length ?? 0;
      let withV2 = 0;
      let withModelBreakdown = 0;
      let withMemberSummary = 0;
      for (const p of preds ?? []) {
        const ss = (p.sport_specific ?? {}) as Record<string, unknown>;
        const v2 = ss.breakdown_v2 as Record<string, unknown> | undefined;
        if (v2) {
          withV2++;
          const mb = v2.model_breakdown;
          if (typeof mb === "string" && mb.trim().length > 0) withModelBreakdown++;
        }
        const ms = ss.member_summary;
        if (typeof ms === "string" && ms.trim().length > 0) withMemberSummary++;
      }
      const r = rating(total === 0 ? 0 : withModelBreakdown / total, 0.9, 0.7);
      row("game_predictions rows total", String(total));
      row("rows with sport_specific.breakdown_v2", `${withV2}/${total} = ${pct(withV2, total)}`);
      row("rows with breakdown_v2.model_breakdown (non-empty)", `${withModelBreakdown}/${total} = ${pct(withModelBreakdown, total)}  [${r}]`);
      row("rows with legacy member_summary (non-empty)", `${withMemberSummary}/${total} = ${pct(withMemberSummary, total)}`);
    }
  }

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
