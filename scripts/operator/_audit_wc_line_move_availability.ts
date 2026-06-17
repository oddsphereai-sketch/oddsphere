/**
 * READ-ONLY — WC line-move availability audit.
 *
 * For the current World Cup slate (today + 1 day forward), checks
 * for every (game, market, side) whether:
 *   • `line_history` has any row at all (opener resolvable)
 *   • `lines` has a current price for that (game, market, side)
 *   • prediction_records carries a current price in snapshot_json
 *
 * Reports per-fixture coverage + aggregate counts + a verdict on
 * whether the missing line-move data is provider-side, writer-side,
 * or UI null-handling. Pure read; no mutations.
 *
 * Usage: npx tsx scripts/operator/_audit_wc_line_move_availability.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local manually — these operator scripts run outside Next's
// auto-loaded env context.
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SOCCER_MARKETS = ["match_result", "double_chance", "total", "btts"] as const;
type SoccerMarket = (typeof SOCCER_MARKETS)[number];

const SIDES_BY_MARKET: Record<SoccerMarket, string[]> = {
  match_result: ["home", "draw", "away"],
  double_chance: ["home_or_draw", "away_or_draw", "home_or_away"],
  total: ["over", "under"],
  btts: ["yes", "no"],
};

type GameRow = {
  id: number;
  external_id: number;
  game_date: string;
  slate_date: string;
  home_team_id: number | null;
  away_team_id: number | null;
};

type LinesRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string | null;
  odds_american: number | null;
  line_value: number | null;
};

type HistoryRow = {
  game_id: number;
  market_type: string;
  side: string | null;
  is_opener: boolean | null;
  odds_american: number | null;
  recorded_at: string;
};

type TeamRow = {
  id: number;
  abbreviation: string;
};

type PredictionRow = {
  game_id: number;
  market: string;
  snapshot_json: Record<string, unknown> | null;
};

async function main(): Promise<void> {
  console.log("\nREAD-ONLY — WC line-move availability audit");
  console.log("=".repeat(72));

  // 1. WC games in the current visible window.
  // Use the same window the adapter uses: today's UTC slate_date and the next day.
  const today = new Date();
  const isoToday = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const isoTomorrow = tomorrow.toISOString().slice(0, 10);

  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, game_date, slate_date, home_team_id, away_team_id, sport")
    .eq("sport", "soccer")
    .in("slate_date", [isoToday, isoTomorrow])
    .order("game_date", { ascending: true });

  if (gamesErr !== null) {
    console.error("games query failed:", gamesErr);
    process.exit(1);
  }
  const games = (gamesData as GameRow[] | null) ?? [];

  // 1b. Filter to fixtures that have predictions (i.e., what the card actually shows).
  const allGameIds = games.map((g) => g.id);
  if (allGameIds.length === 0) {
    console.log("\nNo WC games on today/tomorrow slate_date. Audit complete.");
    return;
  }
  const { data: predsData } = await supabase
    .from("prediction_records")
    .select("game_id, market, snapshot_json")
    .in("game_id", allGameIds);
  const preds = (predsData as PredictionRow[] | null) ?? [];
  const wcPreds = preds.filter((p) => {
    const comp = (p.snapshot_json as { competition?: string } | null)?.competition;
    return comp === "fifa_world_cup";
  });
  const wcGameIds = Array.from(new Set(wcPreds.map((p) => p.game_id)));
  const wcGames = games.filter((g) => wcGameIds.includes(g.id));

  if (wcGames.length === 0) {
    console.log("\nNo WC fixtures with predictions on today/tomorrow. Audit complete.");
    return;
  }

  // 2. Teams for labelling.
  const teamIds = Array.from(
    new Set(
      wcGames
        .flatMap((g) => [g.home_team_id, g.away_team_id])
        .filter((id): id is number => id !== null),
    ),
  );
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const teamMap = new Map((teamsData as TeamRow[] | null ?? []).map((t) => [t.id, t.abbreviation]));
  const matchupFor = (g: GameRow): string => {
    const home = g.home_team_id !== null ? teamMap.get(g.home_team_id) ?? "?" : "?";
    const away = g.away_team_id !== null ? teamMap.get(g.away_team_id) ?? "?" : "?";
    return `${away} vs ${home}`;
  };

  // 3. Lines (current).
  const { data: linesData } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, odds_american, line_value")
    .in("game_id", wcGameIds)
    .in("market_type", SOCCER_MARKETS as unknown as string[]);
  const lines = (linesData as LinesRow[] | null) ?? [];

  // 4. line_history (opener resolution).
  const { data: histData } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, is_opener, odds_american, recorded_at")
    .in("game_id", wcGameIds)
    .in("market_type", SOCCER_MARKETS as unknown as string[])
    .order("recorded_at", { ascending: true });
  const history = (histData as HistoryRow[] | null) ?? [];

  // 5. Reduce: per (game, market, side) → { has_current_price, has_history_row, has_opener }.
  type Slot = {
    gameId: number;
    market: SoccerMarket;
    side: string;
    has_current_price: boolean;
    has_history_row: boolean;
    has_opener: boolean;
    history_count: number;
    current_books: number;
  };
  const slots: Slot[] = [];
  for (const g of wcGames) {
    for (const market of SOCCER_MARKETS) {
      for (const side of SIDES_BY_MARKET[market]) {
        const linesFor = lines.filter(
          (l) => l.game_id === g.id && l.market_type === market && l.side === side && l.odds_american !== null,
        );
        const histFor = history.filter(
          (h) => h.game_id === g.id && h.market_type === market && h.side === side && h.odds_american !== null,
        );
        const opener = histFor.some((h) => h.is_opener === true) || histFor.length > 0;
        slots.push({
          gameId: g.id,
          market,
          side,
          has_current_price: linesFor.length > 0,
          has_history_row: histFor.length > 0,
          has_opener: opener,
          history_count: histFor.length,
          current_books: linesFor.length,
        });
      }
    }
  }

  // 6. Aggregate per market.
  console.log(`\nFixtures audited: ${wcGames.length}`);
  for (const g of wcGames) {
    console.log(`  • g${g.id} ${matchupFor(g)} (${g.game_date})`);
  }

  console.log(`\nTotal (fixture × market × side) slots: ${slots.length}`);
  const totalCurrent = slots.filter((s) => s.has_current_price).length;
  const totalOpener = slots.filter((s) => s.has_opener).length;
  console.log(`  with current price (lines):    ${totalCurrent} / ${slots.length}`);
  console.log(`  with opener (line_history):    ${totalOpener} / ${slots.length}`);
  const missingOpener = slots.length - totalOpener;
  console.log(`  missing opener:                ${missingOpener} / ${slots.length}`);

  console.log("\nPer-market breakdown:");
  console.log("  market           slots  current   opener   missing_opener");
  for (const market of SOCCER_MARKETS) {
    const ss = slots.filter((s) => s.market === market);
    const cur = ss.filter((s) => s.has_current_price).length;
    const op = ss.filter((s) => s.has_opener).length;
    const miss = ss.length - op;
    console.log(`  ${market.padEnd(16)} ${String(ss.length).padStart(5)}  ${String(cur).padStart(7)}  ${String(op).padStart(7)}  ${String(miss).padStart(14)}`);
  }

  // 7. Per-fixture-per-market summary (only flag rows where current exists but opener missing).
  console.log("\nGaps (current price exists but opener does NOT — likely UI shows '—' for line move):");
  let gapCount = 0;
  for (const g of wcGames) {
    const slotsForGame = slots.filter((s) => s.gameId === g.id);
    const gapsForGame = slotsForGame.filter((s) => s.has_current_price && !s.has_opener);
    if (gapsForGame.length === 0) continue;
    gapCount += gapsForGame.length;
    console.log(`\n  g${g.id} ${matchupFor(g)}:`);
    for (const s of gapsForGame) {
      console.log(`    ${s.market}|${s.side}  current_books=${s.current_books}  history_rows=${s.history_count}`);
    }
  }
  if (gapCount === 0) {
    console.log("  (no gaps — every priced slot has an opener)");
  }

  // 8. Pure-no-data cases (provider-side missing).
  console.log("\nProvider-side gaps (neither current price NOR history row):");
  let providerGapCount = 0;
  for (const g of wcGames) {
    const slotsForGame = slots.filter((s) => s.gameId === g.id);
    const noPriceNoHist = slotsForGame.filter((s) => !s.has_current_price && !s.has_history_row);
    if (noPriceNoHist.length === 0) continue;
    providerGapCount += noPriceNoHist.length;
    console.log(`\n  g${g.id} ${matchupFor(g)}: ${noPriceNoHist.length} slots empty`);
    const perMarket = new Map<string, number>();
    for (const s of noPriceNoHist) {
      perMarket.set(s.market, (perMarket.get(s.market) ?? 0) + 1);
    }
    for (const [m, n] of perMarket.entries()) {
      console.log(`    ${m}: ${n}`);
    }
  }
  if (providerGapCount === 0) {
    console.log("  (none — every slot has either current price or history)");
  }

  // 9. Verdict.
  console.log("\nVerdict:");
  if (totalOpener === slots.length) {
    console.log("  ✓ All priced slots have an opener. Line-move UI will populate fully. No fix needed.");
  } else if (gapCount > 0 && providerGapCount === 0) {
    console.log(
      "  ⚠ Writer-side gap. Current price exists in `lines` but line_history is missing rows " +
      "for the same (game, market, side). Investigate writeSoccerLines line_history insert.",
    );
  } else if (providerGapCount > 0 && gapCount === 0) {
    console.log(
      "  ⚠ Provider-side gap. No current price AND no history — vendor didn't surface these " +
      "(game, market, side) combos. UI null-handling is honest; no code fix needed.",
    );
  } else {
    console.log(
      `  ⚠ Mixed. ${gapCount} writer-side gaps + ${providerGapCount} provider-side gaps. ` +
      "Triage each list before any code change.",
    );
  }
  console.log("\n  Read-only audit — no DB writes occurred.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
