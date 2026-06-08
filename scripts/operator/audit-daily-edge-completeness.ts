/**
 * Phase 6B.30C — Daily Edge Completeness Audit (operator CLI).
 *
 * Hydrates the audit input from the production DB and prints a
 * report. Read-only — no writes. Used for one-off operator checks
 * before/after slate cycles to detect:
 *   • games with starters missing
 *   • games with lines but no prediction (the SEA@BAL bug class)
 *   • games with broad neutral fallback usage
 *   • mapping/coverage gaps (pitcher_id set but no player row, etc.)
 *
 * Usage:
 *   npx tsx scripts/operator/audit-daily-edge-completeness.ts [--date YYYY-MM-DD] [--threshold N]
 *
 * Default date: today (UTC). Default neutral-fallback threshold: 3.
 *
 * Output: human-readable structured report plus a non-zero exit code
 * when slate-level red flags are detected (so the script can be wired
 * into CI / pre-deploy checks later).
 */

import { createClient } from "@supabase/supabase-js";
import {
  auditDailyEdgeCompleteness,
  type AuditGameInput,
  type AuditLinesInput,
  type AuditStarterInput,
  type AuditFeatureCounts,
} from "../../lib/services/dailyEdgeCompletenessAudit";

function parseArgs(): { date: string; threshold: number } {
  const args = process.argv.slice(2);
  let date = new Date().toISOString().slice(0, 10);
  let threshold = 3;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date" && args[i + 1]) {
      date = args[i + 1]!;
      i++;
    } else if (args[i] === "--threshold" && args[i + 1]) {
      threshold = Number(args[i + 1]);
      i++;
    }
  }
  return { date, threshold };
}

async function main() {
  const { date, threshold } = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // ── Games on the slate ──────────────────────────────────────────
  const { data: gamesRaw, error: gamesErr } = await sb
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, updated_at")
    .eq("sport", "mlb")
    .eq("slate_date", date);
  if (gamesErr) throw new Error(`games query failed: ${gamesErr.message}`);
  const games = (gamesRaw ?? []) as Array<{
    id: number;
    external_id: number;
    home_team_id: number;
    away_team_id: number;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
    updated_at: string | null;
  }>;
  if (games.length === 0) {
    console.log(`No games found on slate ${date}.`);
    process.exit(0);
  }

  // ── Teams (for matchup display) ─────────────────────────────────
  const teamIds = new Set<number>();
  for (const g of games) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const { data: teams } = await sb
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamMap = new Map<number, string>((teams ?? []).map((t: any) => [t.id, t.abbreviation as string]));

  // ── Predictions ─────────────────────────────────────────────────
  const gameIds = games.map((g) => g.id);
  const { data: preds } = await sb
    .from("game_predictions")
    .select("game_id, model_version, sport_specific")
    .in("game_id", gameIds);
  const predMap = new Map<number, { tier: AuditGameInput["prediction_tier"]; provisional: boolean | null; held: boolean; holdPicks: ReadonlyArray<"ml" | "ou" | "nrfi">; featureCounts: AuditFeatureCounts | null }>();
  for (const p of preds ?? []) {
    const pp = p as any;
    const ss = pp.sport_specific ?? {};
    const v22 = ss.v2_2_audit ?? null;
    const tier = (v22?.data_quality_tier ?? ss.v2_data_quality_tier ?? null) as AuditGameInput["prediction_tier"];
    const provisional = v22?.provisional ?? ss.v2_provisional ?? null;
    const featureCounts: AuditFeatureCounts | null = v22 ? {
      preferred: v22.feature_preferred_count ?? 0,
      fallback_real: v22.feature_fallback_real_count ?? 0,
      proxy: v22.feature_proxy_count ?? 0,
      neutral_fallback: v22.feature_neutral_fallback_count ?? 0,
      missing: v22.feature_missing_count ?? 0,
      present: v22.feature_present_count ?? 0,
    } : null;
    predMap.set(pp.game_id, {
      tier,
      provisional,
      held: ss.held === true,
      holdPicks: Array.isArray(ss.hold_picks) ? ss.hold_picks : [],
      featureCounts,
    });
  }

  // ── Players (for starter mapping) ───────────────────────────────
  const pitcherIds = new Set<number>();
  for (const g of games) {
    if (g.home_pitcher_id !== null) pitcherIds.add(g.home_pitcher_id);
    if (g.away_pitcher_id !== null) pitcherIds.add(g.away_pitcher_id);
  }
  const { data: players } = await sb
    .from("players")
    .select("id")
    .in("id", [...pitcherIds]);
  const mappedPlayerIds = new Set<number>((players ?? []).map((p: any) => p.id as number));

  // ── Season pitching stats (for coverage check) ──────────────────
  const season = Number(date.slice(0, 4));
  const { data: stats } = await sb
    .from("player_season_stats")
    .select("player_id")
    .eq("season", season)
    .in("player_id", [...pitcherIds]);
  const statsPresentPlayerIds = new Set<number>((stats ?? []).map((s: any) => s.player_id as number));

  // ── Lines (book counts per market) ──────────────────────────────
  const { data: lines } = await sb
    .from("lines")
    .select("game_id, market_type, sportsbook")
    .in("game_id", gameIds);
  const linesByGame = new Map<number, { ml: Set<string>; ou: Set<string>; fi: Set<string> }>();
  for (const l of lines ?? []) {
    const ll = l as any;
    const slot = linesByGame.get(ll.game_id) ?? { ml: new Set<string>(), ou: new Set<string>(), fi: new Set<string>() };
    if (ll.market_type === "moneyline") slot.ml.add(ll.sportsbook);
    else if (ll.market_type === "total") slot.ou.add(ll.sportsbook);
    else if (ll.market_type === "first_inning_total") slot.fi.add(ll.sportsbook);
    linesByGame.set(ll.game_id, slot);
  }

  // ── Build audit inputs ──────────────────────────────────────────
  const auditGames: AuditGameInput[] = games.map((g) => {
    const homeAbbr = teamMap.get(g.home_team_id) ?? "?";
    const awayAbbr = teamMap.get(g.away_team_id) ?? "?";
    const home: AuditStarterInput = {
      pitcher_id: g.home_pitcher_id,
      mapped: g.home_pitcher_id !== null && mappedPlayerIds.has(g.home_pitcher_id),
      season_stats_present: g.home_pitcher_id !== null && statsPresentPlayerIds.has(g.home_pitcher_id),
      last_updated_iso: g.updated_at,
    };
    const away: AuditStarterInput = {
      pitcher_id: g.away_pitcher_id,
      mapped: g.away_pitcher_id !== null && mappedPlayerIds.has(g.away_pitcher_id),
      season_stats_present: g.away_pitcher_id !== null && statsPresentPlayerIds.has(g.away_pitcher_id),
      last_updated_iso: g.updated_at,
    };
    const lnSlot = linesByGame.get(g.id) ?? { ml: new Set<string>(), ou: new Set<string>(), fi: new Set<string>() };
    const lns: AuditLinesInput = {
      ml_books_count: lnSlot.ml.size,
      ou_books_count: lnSlot.ou.size,
      fi_books_count: lnSlot.fi.size,
    };
    const pred = predMap.get(g.id);
    return {
      game_external_id: g.external_id,
      game_id: g.id,
      matchup: `${awayAbbr}@${homeAbbr}`,
      home,
      away,
      lines: lns,
      has_prediction: pred !== undefined,
      prediction_tier: pred?.tier ?? null,
      prediction_provisional: pred?.provisional ?? null,
      prediction_held: pred?.held ?? false,
      prediction_hold_picks: pred?.holdPicks ?? [],
      feature_counts: pred?.featureCounts ?? null,
    };
  });

  const report = auditDailyEdgeCompleteness({
    sport: "mlb",
    slate_date: date,
    games: auditGames,
    neutral_fallback_threshold: threshold,
  });

  // ── Output ──────────────────────────────────────────────────────
  console.log(`\n═══ Daily Edge Completeness Audit — ${report.sport} ${report.slate_date} ═══`);
  console.log(`Official games:                 ${report.official_count}`);
  console.log(`With prediction:                ${report.prediction_count}`);
  console.log(`No prediction:                  ${report.no_prediction_count}`);
  console.log(`Provisional fallback:           ${report.provisional_fallback_count}`);
  console.log(`Starter warning (any side):     ${report.starter_warning_count}`);
  console.log(`Starter warning (both sides):   ${report.starter_both_missing_count}`);
  console.log(`Lines present but no pred:      ${report.lines_present_but_no_prediction_count}`);
  console.log(`Broad neutral fallback (>${threshold}):  ${report.broad_neutral_fallback_count}`);
  console.log(`\nSlate red flags:                ${report.red_flags.length === 0 ? "NONE" : report.red_flags.join(", ")}`);

  console.log(`\nPer-game:`);
  console.log("  ext_id     matchup     classification          home              away              lines      tier      provisional  flags");
  for (const g of report.per_game) {
    const flagsStr = g.flags.length === 0 ? "-" : g.flags.join(",");
    console.log(
      `  ${String(g.game_external_id).padEnd(10)} ${g.matchup.padEnd(11)} ${g.classification.padEnd(23)} ` +
      `${g.starter_home.padEnd(17)} ${g.starter_away.padEnd(17)} ${g.lines.padEnd(10)} ` +
      `${(g.prediction_tier ?? "—").padEnd(9)} ${String(g.prediction_provisional ?? "—").padEnd(12)} ${flagsStr}`,
    );
  }

  if (report.red_flags.length > 0) {
    console.log(`\n✗ ${report.red_flags.length} red flag(s) detected — operator action recommended.`);
    process.exit(2);
  }
  console.log("\n✓ No slate-level red flags.");
}

main().catch((e) => { console.error("FATAL:", (e as Error).message); console.error((e as Error).stack); process.exit(1); });
