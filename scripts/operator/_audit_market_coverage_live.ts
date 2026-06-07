/**
 * READ-ONLY market coverage audit for today's MLB slate.
 *
 * For each game: shows what prices the `lines` table actually has for
 * ML home/away, total over/under, first_inning over/under, alongside
 * book(s), pick from game_predictions, and matches against what the
 * Daily Edge DTO would select. Flags every gap so we know whether
 * something is missing in raw ingestion vs DTO/selection vs UI.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/_audit_market_coverage_live.ts [YYYY-MM-DD]
 */
import { createClient } from "@supabase/supabase-js";

const SLATE_DATE = process.argv[2] ?? new Date().toISOString().slice(0, 10);

type LineRow = {
  id: number;
  game_id: number;
  market_type: string;
  side: string | null;
  sportsbook: string;
  line_value: number | null;
  odds_american: number | null;
  fetched_at: string | null;
};

type SignalRow = {
  game_id: number;
  market_type: string;
  side: string;
  public_money_pct: number | null;
  public_betting_pct: number | null;
};

function fmtAm(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}
function fmtBooks(rows: LineRow[]): string {
  if (rows.length === 0) return "—";
  return rows
    .map((r) => `${r.sportsbook}=${fmtAm(r.odds_american)}`)
    .join(",");
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log(`\n=== Market Coverage Audit for ${SLATE_DATE} ===\n`);

  // 1. Games
  const { data: games } = await sb
    .from("games")
    .select("id, external_id, sport, slate_date, game_date, home_team_id, away_team_id")
    .eq("sport", "mlb")
    .eq("slate_date", SLATE_DATE)
    .order("game_date", { ascending: true });
  if (!games || games.length === 0) { console.log("No games."); return; }
  const gameIds = (games as any[]).map((g) => g.id);

  const { data: teamRows } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(new Set((games as any[]).flatMap((g) => [g.home_team_id, g.away_team_id]))));
  const abbrev = new Map<number, string>(((teamRows ?? []) as any[]).map((t) => [t.id, t.abbreviation]));
  const matchup = (g: any) => `${abbrev.get(g.away_team_id) ?? "?"}@${abbrev.get(g.home_team_id) ?? "?"}`;

  // 2. game_predictions for picked side context
  const { data: preds } = await sb
    .from("game_predictions")
    .select("game_id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, locked_at")
    .in("game_id", gameIds);
  const predByGame = new Map<number, any>();
  for (const p of (preds ?? []) as any[]) predByGame.set(p.game_id, p);

  // 3. lines table
  const { data: lines } = await sb
    .from("lines")
    .select("id, game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .in("game_id", gameIds);
  const linesByGameMarket = new Map<string, LineRow[]>();
  for (const l of (lines ?? []) as LineRow[]) {
    const key = `${l.game_id}::${l.market_type}`;
    const arr = linesByGameMarket.get(key) ?? [];
    arr.push(l);
    linesByGameMarket.set(key, arr);
  }

  // 4. sharp_signals (for splits)
  const { data: signals } = await sb
    .from("sharp_signals")
    .select("game_id, market_type, side, public_money_pct, public_betting_pct")
    .in("game_id", gameIds);
  const sigByGameMarket = new Map<string, SignalRow[]>();
  for (const s of (signals ?? []) as SignalRow[]) {
    const key = `${s.game_id}::${s.market_type}`;
    const arr = sigByGameMarket.get(key) ?? [];
    arr.push(s);
    sigByGameMarket.set(key, arr);
  }

  // 5. Per-game table
  console.log(`${"matchup".padEnd(8)} ${"market".padEnd(11)} ${"pick".padEnd(6)} ${"home/over".padEnd(28)} ${"away/under".padEnd(28)} ${"line"}`);
  console.log("─".repeat(120));

  let gapsCount = 0;
  const gaps: string[] = [];
  const lineCounts = { ml_with_both: 0, ml_picked_only: 0, ml_missing: 0, ou_with_both: 0, ou_picked_only: 0, ou_missing: 0, ou_line: 0, fi_with_both: 0, fi_missing: 0 };

  for (const g of games as any[]) {
    const m = matchup(g);
    const p = predByGame.get(g.id);

    // ML
    const mlLines = linesByGameMarket.get(`${g.id}::moneyline`) ?? [];
    const mlHome = mlLines.filter((l) => l.side === "home");
    const mlAway = mlLines.filter((l) => l.side === "away");
    const mlPick = p?.predicted_ml_winner ?? "—";
    const mlHomeStr = mlHome.length > 0 ? fmtBooks(mlHome).slice(0, 28) : "MISSING";
    const mlAwayStr = mlAway.length > 0 ? fmtBooks(mlAway).slice(0, 28) : "MISSING";
    console.log(`${m.padEnd(8)} ${"moneyline".padEnd(11)} ${mlPick.padEnd(6)} ${mlHomeStr.padEnd(28)} ${mlAwayStr.padEnd(28)}`);
    if (mlHome.length > 0 && mlAway.length > 0) lineCounts.ml_with_both++;
    else if ((mlPick === "home" && mlHome.length > 0) || (mlPick === "away" && mlAway.length > 0)) lineCounts.ml_picked_only++;
    else { lineCounts.ml_missing++; gaps.push(`  ❌ ${m} ML missing picked-side price (pick=${mlPick}, home_rows=${mlHome.length}, away_rows=${mlAway.length})`); gapsCount++; }

    // OU (total)
    const ouLines = linesByGameMarket.get(`${g.id}::total`) ?? [];
    const ouOver = ouLines.filter((l) => l.side === "over");
    const ouUnder = ouLines.filter((l) => l.side === "under");
    const ouPick = p?.predicted_ou_side ?? "—";
    const ouOverStr = ouOver.length > 0 ? fmtBooks(ouOver).slice(0, 28) : "MISSING";
    const ouUnderStr = ouUnder.length > 0 ? fmtBooks(ouUnder).slice(0, 28) : "MISSING";
    const ouLine = ouLines.length > 0 ? (ouLines[0]!.line_value !== null ? ouLines[0]!.line_value.toFixed(1) : "—") : "—";
    console.log(`${m.padEnd(8)} ${"total".padEnd(11)} ${ouPick.padEnd(6)} ${ouOverStr.padEnd(28)} ${ouUnderStr.padEnd(28)} ${ouLine}`);
    if (ouOver.length > 0 && ouUnder.length > 0) lineCounts.ou_with_both++;
    else if ((ouPick === "over" && ouOver.length > 0) || (ouPick === "under" && ouUnder.length > 0)) lineCounts.ou_picked_only++;
    else { lineCounts.ou_missing++; gaps.push(`  ❌ ${m} OU missing picked-side price (pick=${ouPick}, over_rows=${ouOver.length}, under_rows=${ouUnder.length})`); gapsCount++; }
    if (ouLine !== "—") lineCounts.ou_line++;
    else if (ouLines.length > 0) { gaps.push(`  ⚠ ${m} OU has prices but no line_value`); gapsCount++; }

    // FI
    const fiLines = linesByGameMarket.get(`${g.id}::first_inning_total`) ?? [];
    const fiOver = fiLines.filter((l) => l.side === "over");
    const fiUnder = fiLines.filter((l) => l.side === "under");
    const fiPick = p?.predicted_nrfi === true ? "NRFI" : p?.predicted_nrfi === false ? "YRFI" : "—";
    const fiOverStr = fiOver.length > 0 ? fmtBooks(fiOver).slice(0, 28) : "—";
    const fiUnderStr = fiUnder.length > 0 ? fmtBooks(fiUnder).slice(0, 28) : "—";
    console.log(`${m.padEnd(8)} ${"first_inn".padEnd(11)} ${fiPick.padEnd(6)} ${fiOverStr.padEnd(28)} ${fiUnderStr.padEnd(28)}`);
    if (fiOver.length > 0 && fiUnder.length > 0) lineCounts.fi_with_both++;
    else if (fiLines.length === 0) lineCounts.fi_missing++;

    console.log(); // blank line between games
  }

  // 6. Sportsbook breakdown (which books are showing up overall)
  const bookCounts = new Map<string, { ml: number; ou: number; fi: number }>();
  for (const l of (lines ?? []) as LineRow[]) {
    const k = l.sportsbook;
    const cur = bookCounts.get(k) ?? { ml: 0, ou: 0, fi: 0 };
    if (l.market_type === "moneyline") cur.ml++;
    else if (l.market_type === "total") cur.ou++;
    else if (l.market_type === "first_inning_total") cur.fi++;
    bookCounts.set(k, cur);
  }
  console.log(`\n━━━ Sportsbooks present in lines table ━━━`);
  for (const [book, c] of bookCounts) {
    console.log(`  ${book.padEnd(20)} ML=${c.ml} OU=${c.ou} FI=${c.fi}`);
  }

  // 7. Summary
  console.log(`\n━━━ Coverage summary (15 games) ━━━`);
  console.log(`  ML both sides:   ${lineCounts.ml_with_both}/15`);
  console.log(`  ML picked only:  ${lineCounts.ml_picked_only}/15`);
  console.log(`  ML missing pick: ${lineCounts.ml_missing}/15`);
  console.log(`  OU both sides:   ${lineCounts.ou_with_both}/15`);
  console.log(`  OU picked only:  ${lineCounts.ou_picked_only}/15`);
  console.log(`  OU missing pick: ${lineCounts.ou_missing}/15`);
  console.log(`  OU with line_value: ${lineCounts.ou_line}/15`);
  console.log(`  FI both sides:   ${lineCounts.fi_with_both}/15`);
  console.log(`  FI missing:      ${lineCounts.fi_missing}/15`);

  console.log(`\n━━━ Gaps (${gapsCount}) ━━━`);
  for (const g of gaps) console.log(g);

  // 8. Fetched_at freshness
  if ((lines ?? []).length > 0) {
    const times = (lines as LineRow[]).map((l) => l.fetched_at).filter((t): t is string => t !== null);
    times.sort();
    console.log(`\n━━━ lines.fetched_at range ━━━`);
    console.log(`  oldest: ${times[0]}`);
    console.log(`  newest: ${times[times.length - 1]}`);
  }
}

main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
