/**
 * READ-ONLY audit of MIA@PIT total for 2026-06-12.
 *
 * Per Daniel's request, answer exactly:
 *  - Is the totals row locked?
 *  - What is predicted_ou_side, predicted_total, market line?
 *  - Edge, public splits, line history at lock vs now.
 *  - Locked-snapshot vs current model.
 *
 * NO WRITES. Read everything; print everything.
 */

import { supabase } from "../../lib/db/supabase";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function pad(label: string, v: unknown): string {
  return `  ${label.padEnd(38, " ")} ${v === null || v === undefined ? "(null)" : JSON.stringify(v)}`;
}

async function main(): Promise<void> {
  const today = etToday();
  console.log(`\n=== MIA@PIT total audit — ET sports-day ${today} ===\n`);

  // ── Step 1: find the game(s) ────────────────────────────────────────
  // Look up team ids first.
  const { data: teams, error: teamsErr } = await supabase
    .from("teams")
    .select("id, abbreviation, name, sport")
    .eq("sport", "mlb")
    .in("abbreviation", ["MIA", "PIT"]);
  if (teamsErr) { console.error("teamsErr:", teamsErr); process.exit(1); }
  console.log("Teams (MLB MIA / PIT):", teams);

  const teamIds = (teams ?? []).map((t: any) => t.id);

  // Fetch games involving either team on today's slate.
  const { data: games, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, sport, slate_date, game_date, status, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id")
    .eq("sport", "mlb")
    .eq("slate_date", today)
    .or(`home_team_id.in.(${teamIds.join(",")}),away_team_id.in.(${teamIds.join(",")})`);
  if (gamesErr) { console.error("gamesErr:", gamesErr); process.exit(1); }
  console.log(`\nGames touching MIA or PIT on slate_date=${today}: ${games?.length ?? 0}`);
  for (const g of (games ?? []) as any[]) {
    console.log(`  game.id=${g.id} ext=${g.external_id} status=${g.status} game_date=${g.game_date} h=${g.home_team_id} a=${g.away_team_id}`);
  }

  // Pick the MIA@PIT (PIT home) row if present, else the first match.
  const teamByAbbr: Record<string, number> = {};
  for (const t of teams ?? []) teamByAbbr[(t as any).abbreviation] = (t as any).id;
  const miaId = teamByAbbr["MIA"];
  const pitId = teamByAbbr["PIT"];
  const target = (games ?? []).find((g: any) => (g.home_team_id === pitId && g.away_team_id === miaId) || (g.home_team_id === miaId && g.away_team_id === pitId)) as any;
  if (!target) {
    console.log("\nNo MIA@PIT game found on today's slate. Exiting.");
    process.exit(0);
  }
  const gameId = target.id;
  console.log(`\nTarget game.id=${gameId}  ext=${target.external_id}  status=${target.status}`);

  // ── Step 2: prediction row ──────────────────────────────────────────
  const { data: preds, error: predsErr } = await supabase
    .from("prediction_records")
    .select("*")
    .eq("game_id", gameId);
  if (predsErr) { console.error("predsErr:", predsErr); process.exit(1); }
  console.log(`\nprediction_records rows: ${preds?.length ?? 0}`);
  for (const p of (preds ?? []) as any[]) {
    console.log(`\n  pr.id=${p.id} market=${p.market} version=${p.version}`);
    console.log(pad("locked_at",                 p.locked_at));
    console.log(pad("predicted_ml_winner",       p.predicted_ml_winner));
    console.log(pad("predicted_ou_side",         p.predicted_ou_side));
    console.log(pad("predicted_total",           p.predicted_total));
    console.log(pad("ou_confidence",             p.ou_confidence));
    console.log(pad("ou_grade",                  p.ou_grade));
    console.log(pad("ou_signal_type",            p.ou_signal_type));
    console.log(pad("ou_market_signal",          p.ou_market_signal));
    console.log(pad("listed_total_line",         p.listed_total_line ?? p.listed_total ?? null));
    console.log(pad("play_grade",                p.play_grade));
    console.log(pad("verdict",                   p.verdict));
    console.log(pad("updated_at",                p.updated_at));
    console.log(pad("created_at",                p.created_at));
    console.log(pad("breakdown_present",         !!p.breakdown));
    const snap = (p as any).snapshot_json ?? null;
    if (snap && typeof snap === "object") {
      const s = snap as any;
      console.log("  snapshot_json (key fields):");
      console.log(pad("    held",                s.held));
      console.log(pad("    hold_reason",         s.hold_reason));
      console.log(pad("    stale",               s.stale));
      console.log(pad("    stale_reason",        s.stale_reason));
      console.log(pad("    stage",               s.stage));
      console.log(pad("    model_version",       s.model_version));
      console.log(pad("    model_used",          s.model_used));
      console.log(pad("    listed_line",         JSON.stringify(s.listed_line)));
      console.log(pad("    ml_play_grade",       s.ml_play_grade));
      console.log(pad("    ou_play_grade",       s.ou_play_grade));
      console.log(pad("    public_splits",       JSON.stringify(s.public_splits)?.slice(0, 400)));
      console.log(pad("    line_movement",       JSON.stringify(s.line_movement)?.slice(0, 400)));
      console.log(pad("    lines_at_lock",       JSON.stringify(s.lines_at_lock)?.slice(0, 400)));
      console.log(pad("    auto_factors",        JSON.stringify(s.auto_factors)?.slice(0, 600)));
      console.log(pad("    ai_sanity",           JSON.stringify(s.ai_sanity)?.slice(0, 400)));
      console.log(pad("    review_v1",           JSON.stringify(s.review_v1)?.slice(0, 600)));
      console.log(pad("    hold_picks",          JSON.stringify(s.hold_picks)?.slice(0, 200)));
      console.log(pad("    v2_2_audit",          JSON.stringify(s.v2_2_audit)?.slice(0, 400)));
    } else {
      console.log("  snapshot_json: (none)");
    }
  }

  // ── Step 3: lines / odds for total ──────────────────────────────────
  const { data: lines, error: linesErr } = await supabase
    .from("lines")
    .select("game_id, market_type, side, sportsbook, line_value, odds_american, fetched_at")
    .eq("game_id", gameId)
    .eq("market_type", "total")
    .order("fetched_at", { ascending: false })
    .limit(30);
  if (linesErr) { console.error("linesErr:", linesErr); }
  console.log(`\nlines rows (market_type=total, latest 30): ${lines?.length ?? 0}`);
  for (const l of (lines ?? []) as any[]) {
    console.log(`  fetched_at=${l.fetched_at} book=${l.sportsbook} side=${l.side} line=${l.line_value} american=${l.odds_american}`);
  }

  // ── Step 4: line history (movement) ─────────────────────────────────
  const { data: hist, error: histErr } = await supabase
    .from("line_history")
    .select("*")
    .eq("game_id", gameId)
    .eq("market_type", "total")
    .order("captured_at", { ascending: true })
    .limit(40);
  if (histErr) { console.error("histErr:", histErr); }
  console.log(`\nline_history rows (market_type=total, first 40): ${hist?.length ?? 0}`);
  for (const h of (hist ?? []) as any[]) {
    console.log(`  cap=${h.captured_at ?? h.snapshot_at ?? h.fetched_at} book=${h.sportsbook} side=${h.side} line=${h.line_value ?? h.line} american=${h.odds_american}`);
  }

  // ── Step 5: sharp_signals (public splits + line movement signals) ──
  const { data: sigs, error: sigsErr } = await supabase
    .from("sharp_signals")
    .select("*")
    .eq("game_id", gameId)
    .order("fetched_at", { ascending: false })
    .limit(20);
  if (sigsErr) { console.error("sigsErr:", sigsErr); }
  console.log(`\nsharp_signals rows (any market, latest 20): ${sigs?.length ?? 0}`);
  for (const s of (sigs ?? []) as any[]) {
    console.log(`  fetched_at=${s.fetched_at} market=${s.market_type ?? s.market} side=${s.side} pm%=${s.public_money_pct} pb%=${s.public_bets_pct} sharp=${s.sharp_status} sig=${s.signal_type ?? s.signal}`);
  }

  // ── Step 6: game_predictions (legacy v1 if present) ────────────────
  const { data: gp } = await supabase
    .from("game_predictions")
    .select("*")
    .eq("game_id", gameId)
    .limit(5);
  console.log(`\ngame_predictions rows: ${gp?.length ?? 0}`);
  for (const g of (gp ?? []) as any[]) {
    console.log(`  predicted_ou_side=${g.predicted_ou_side} predicted_total=${g.predicted_total} ou_confidence=${g.ou_confidence} ou_grade=${g.ou_grade} locked_at=${g.locked_at} updated_at=${g.updated_at}`);
  }

  console.log("\n=== end audit ===\n");
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
