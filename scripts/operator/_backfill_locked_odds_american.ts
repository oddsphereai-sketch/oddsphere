/**
 * URGENT one-shot. Backfills prediction_records.odds_american for
 * today's locked ML + OU rows where it is currently NULL. Source:
 * line_history rows at or BEFORE locked_at, ordered by BOOK_PRIORITY.
 *
 * Strict rules (matching the operator approval):
 *   • Only touches today's locked rows where odds_american IS NULL
 *   • Only ML and total markets
 *   • Picks the closest valid row at or before locked_at (never after)
 *   • Uses the same BOOK_PRIORITY Daily Edge uses for price selection
 *   • Skips kalshi (R-16G-A side-flip safety) and splits_consensus
 *     (not a real book price)
 *   • Defense-in-depth WHERE clauses on the UPDATE so a stray
 *     concurrent write can't redirect the touch
 *   • Does NOT touch pick / side / line_value / confidence /
 *     model_probability / market_probability / edge / best_angle /
 *     play_grade / snapshot_json / grade rows
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/_backfill_locked_odds_american.ts          # dry-run
 *   npx tsx --env-file=.env.local scripts/operator/_backfill_locked_odds_american.ts --apply  # commit
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SLATE_DATE = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);

// Same priority list Daily Edge uses (see app/api/lab/daily-edge/route.ts).
// kalshi intentionally excluded (R-16G-A side-flip safety). splits_consensus
// excluded for the backfill: it's a synthesized fallback, not a real
// historical book price.
const BOOK_PRIORITY: readonly string[] = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "fliff",
];

type Row = {
  id: number;
  game_id: number;
  market: string;
  pick: string | null;
  side: string | null;
  odds_american: number | null;
  locked_at: string | null;
};

type HistRow = {
  sportsbook: string;
  side: string | null;
  odds_american: number | null;
  recorded_at: string;
};

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n=== Backfill locked odds_american for ${SLATE_DATE} (apply=${APPLY}) ===\n`);

  const { data: rows, error } = await sb
    .from("prediction_records")
    .select("id, game_id, market, pick, side, odds_american, locked_at")
    .eq("sport", "mlb")
    .eq("slate_date", SLATE_DATE)
    .in("market", ["moneyline", "total"])
    .not("locked_at", "is", null)
    .is("odds_american", null);
  if (error) throw error;
  const targets = (rows ?? []) as Row[];
  console.log(`Eligible rows (locked, ML/OU, odds_american NULL): ${targets.length}`);

  let updates = 0;
  let leftNull = 0;
  const reasons: string[] = [];
  const errs: string[] = [];

  for (const r of targets) {
    if (r.side === null || r.locked_at === null) {
      leftNull++;
      reasons.push(`  rec_id=${r.id} game=${r.game_id} ${r.market}: side or locked_at is null — skip`);
      continue;
    }

    // Map our market name → line_history market_type label.
    const histMarket = r.market === "moneyline" ? "moneyline" : "total";

    const { data: histData, error: histErr } = await sb
      .from("line_history")
      .select("sportsbook, side, odds_american, recorded_at")
      .eq("game_id", r.game_id)
      .eq("market_type", histMarket)
      .eq("side", r.side)
      .lte("recorded_at", r.locked_at)
      .not("odds_american", "is", null)
      .order("recorded_at", { ascending: false }); // most recent at-or-before lock first
    if (histErr) {
      errs.push(`  rec_id=${r.id}: line_history read failed: ${histErr.message}`);
      leftNull++;
      continue;
    }
    const hist = (histData ?? []) as HistRow[];
    if (hist.length === 0) {
      leftNull++;
      reasons.push(`  rec_id=${r.id} game=${r.game_id} ${r.market} side=${r.side}: no line_history rows at or before locked_at=${r.locked_at}`);
      continue;
    }

    // BOOK_PRIORITY selection: walk books in order, pick the most-
    // recent (at or before lock) row from that book.
    let chosen: HistRow | null = null;
    for (const book of BOOK_PRIORITY) {
      const hit = hist.find((h) => h.sportsbook === book);
      if (hit) { chosen = hit; break; }
    }
    if (chosen === null) {
      leftNull++;
      const booksSeen = Array.from(new Set(hist.map((h) => h.sportsbook))).sort();
      reasons.push(`  rec_id=${r.id} game=${r.game_id} ${r.market}: no BOOK_PRIORITY-matching row; books available at lock time: ${booksSeen.join(",")}`);
      continue;
    }

    console.log(`  rec_id=${r.id} game=${r.game_id} ${r.market.padEnd(9)} pick=${r.pick} side=${r.side} ← ${chosen.sportsbook}=${chosen.odds_american} @ ${chosen.recorded_at}`);

    if (!APPLY) continue;

    const { error: upErr } = await sb
      .from("prediction_records")
      .update({ odds_american: chosen.odds_american })
      .eq("id", r.id)
      .is("odds_american", null) // defense-in-depth
      .not("locked_at", "is", null) // defense-in-depth
      .eq("market", r.market); // defense-in-depth
    if (upErr) { errs.push(`  rec_id=${r.id} UPDATE failed: ${upErr.message}`); }
    else updates++;
  }

  console.log();
  console.log(`Updates applied: ${updates}`);
  console.log(`Rows left null:  ${leftNull}`);
  if (reasons.length > 0) {
    console.log(`\nReasons rows were left null:`);
    for (const r of reasons) console.log(r);
  }
  if (errs.length > 0) {
    console.log(`\nErrors:`);
    for (const e of errs) console.log(e);
  }
  if (!APPLY) console.log(`\n(dry-run; pass --apply to commit)`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
