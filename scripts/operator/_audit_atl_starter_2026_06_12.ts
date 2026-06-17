/**
 * READ-ONLY audit of the ATL (Atlanta Braves) MLB game on the
 * 2026-06-12 ET slate — starter source-of-truth investigation.
 *
 * Mirrors the MIA/PIT audit pattern. Answers, with DB ground truth:
 *   1. Exact ATL matchup + game_id.
 *   3. games.home_pitcher_id / away_pitcher_id (provider fixture link).
 *   4. auto_factors starter fields for that game_id.
 *   5/6. Starter snapshot inputs both the full-game and FI models read
 *        (same source: games.*_pitcher_id → players → season stats).
 *   7-11. players.id linkage, external_id (BDL/MLB person), names vs ids,
 *        season stats presence, lineup/injury fallbacks.
 *  12. Whether the prediction row / snapshot flags missing_starter.
 *
 * NO WRITES. Pure read; prints everything.
 *
 * Usage: npx tsx scripts/operator/_audit_atl_starter_2026_06_12.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local manually — operator scripts run outside Next's env.
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

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function pad(label: string, v: unknown): string {
  return `  ${label.padEnd(34, " ")} ${v === null || v === undefined ? "(null)" : JSON.stringify(v)}`;
}

const SEASON = 2026;

async function main(): Promise<void> {
  const today = etToday();
  console.log(`\n=== ATL starter audit — ET sports-day ${today} ===\n`);

  // ── Step 1: ATL team id ───────────────────────────────────────────
  const { data: teams } = await supabase
    .from("teams")
    .select("id, abbreviation, name, sport, external_id")
    .eq("sport", "mlb");
  const atl = (teams ?? []).find((t: any) => t.abbreviation === "ATL");
  if (!atl) { console.log("No ATL team row found."); process.exit(0); }
  console.log("ATL team:", atl);

  // Map team id -> abbr for labelling.
  const abbrById = new Map<number, string>();
  for (const t of teams ?? []) abbrById.set((t as any).id, (t as any).abbreviation);

  // ── Step 2: ATL game(s) on today's slate ──────────────────────────
  const { data: games } = await supabase
    .from("games")
    .select("id, external_id, sport, slate_date, game_date, status, slate_status, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id")
    .eq("sport", "mlb")
    .eq("slate_date", today)
    .or(`home_team_id.eq.${atl.id},away_team_id.eq.${atl.id}`);

  console.log(`\nATL games on slate_date=${today}: ${games?.length ?? 0}`);
  for (const g of (games ?? []) as any[]) {
    const home = abbrById.get(g.home_team_id) ?? "?";
    const away = abbrById.get(g.away_team_id) ?? "?";
    console.log(`\n  game.id=${g.id} ext=${g.external_id} ${away}@${home} status=${g.status} slate_status=${g.slate_status} game_date=${g.game_date}`);
    console.log(pad("home_team_id", g.home_team_id));
    console.log(pad("away_team_id", g.away_team_id));
    console.log(pad("home_pitcher_id", g.home_pitcher_id));
    console.log(pad("away_pitcher_id", g.away_pitcher_id));
    console.log(pad("ballpark_id", g.ballpark_id));
  }

  if (!games || games.length === 0) {
    console.log("\nNo ATL game on today's slate. Exiting.");
    process.exit(0);
  }

  for (const g of games as any[]) {
    const home = abbrById.get(g.home_team_id) ?? "?";
    const away = abbrById.get(g.away_team_id) ?? "?";
    console.log(`\n\n──────── DETAIL game.id=${g.id} ${away}@${home} ────────`);

    // ── Step 3+7+8+9+10: pitcher player rows + season stats ─────────
    const pitcherIds = [g.home_pitcher_id, g.away_pitcher_id].filter((x) => x !== null);
    for (const side of ["home", "away"] as const) {
      const pid = side === "home" ? g.home_pitcher_id : g.away_pitcher_id;
      console.log(`\n  [${side} starter]  games.${side}_pitcher_id = ${pid ?? "(null)"}`);
      if (pid === null) {
        console.log("    → games row has NO pitcher_id for this side. Card buildStarterDto -> null; model buildStarter -> null.");
        continue;
      }
      const { data: p } = await supabase
        .from("players")
        .select("id, external_id, full_name, first_name, last_name, team_id, position_abbr, is_pitcher, bats, throws, active, mlb_person_id")
        .eq("id", pid)
        .maybeSingle();
      if (!p) {
        console.log(`    → players.id=${pid} NOT FOUND. card join -> null; model playersById.get -> undefined -> null.`);
        continue;
      }
      console.log(pad("players.id", (p as any).id));
      console.log(pad("external_id (BDL)", (p as any).external_id));
      console.log(pad("mlb_person_id", (p as any).mlb_person_id));
      console.log(pad("full_name", (p as any).full_name));
      console.log(pad("first_name", (p as any).first_name));
      console.log(pad("last_name", (p as any).last_name));
      console.log(pad("team_id", (p as any).team_id));
      console.log(pad("position_abbr", (p as any).position_abbr));
      console.log(pad("is_pitcher", (p as any).is_pitcher));
      console.log(pad("throws", (p as any).throws));
      console.log(pad("active", (p as any).active));

      // Card render check: buildStarterDto needs first/last name to render.
      const first = ((p as any).first_name ?? "").trim();
      const last = ((p as any).last_name ?? "").trim();
      const cardName = `${first} ${last}`.trim();
      console.log(pad("CARD buildStarterDto name", cardName.length ? cardName : "(empty -> null)"));

      // Season stats (model input).
      const { data: ss } = await supabase
        .from("player_season_stats")
        .select("player_id, season, season_type, pitching_era, pitching_whip, pitching_gs, pitching_ip, first_inning_era, first_inning_starts")
        .eq("player_id", pid)
        .eq("season", SEASON)
        .eq("season_type", "regular")
        .maybeSingle();
      if (!ss) {
        console.log(`    season stats (${SEASON} regular): (none) -> model season_era=null`);
      } else {
        console.log(pad(`season_era (${SEASON})`, (ss as any).pitching_era));
        console.log(pad("season_whip", (ss as any).pitching_whip));
        console.log(pad("season_gs", (ss as any).pitching_gs));
        console.log(pad("first_inning_era", (ss as any).first_inning_era));
        console.log(pad("first_inning_starts", (ss as any).first_inning_starts));
      }
    }

    // ── Step 11: lineups (probable pitcher confirmation fallback) ───
    const { data: lus } = await supabase
      .from("lineups")
      .select("game_id, team_id, player_id, batting_position, starting_position, is_confirmed")
      .eq("game_id", g.id)
      .in("starting_position", ["P", "SP", "RP"]);
    console.log("\n  [lineups — pitcher rows]");
    if (!lus || lus.length === 0) console.log("    (none)");
    for (const l of (lus ?? []) as any[]) {
      console.log(`    team=${abbrById.get(l.team_id) ?? l.team_id} player_id=${l.player_id} pos=${l.starting_position} confirmed=${l.is_confirmed}`);
    }

    // ── Step 12: prediction row + snapshot hold flags ───────────────
    const { data: gp } = await supabase
      .from("game_predictions")
      .select("game_id, source_type, predicted_ml_winner, ml_grade, ou_grade, nrfi_grade, sport_specific, locked_at, computed_at")
      .eq("game_id", g.id)
      .maybeSingle();
    console.log("\n  [game_predictions]");
    if (!gp) {
      console.log("    (no game_predictions row -> card renders 'prediction_pending' placeholder)");
    } else {
      const p: any = gp;
      console.log(pad("source_type", p.source_type));
      console.log(pad("predicted_ml_winner", p.predicted_ml_winner));
      console.log(pad("ml_grade", p.ml_grade));
      console.log(pad("ou_grade", p.ou_grade));
      console.log(pad("nrfi_grade", p.nrfi_grade));
      console.log(pad("locked_at", p.locked_at));
      console.log(pad("computed_at", p.computed_at));
      const ss = p.sport_specific;
      if (ss && typeof ss === "object") {
        const s: any = ss;
        console.log("    sport_specific (key fields):");
        console.log(pad("    hold_reason", s.hold_reason));
        console.log(pad("    hold_picks", JSON.stringify(s.hold_picks)));
        console.log(pad("    reason_codes", JSON.stringify(s.reason_codes)?.slice(0, 300)));
        console.log(pad("    data_quality", JSON.stringify(s.data_quality)?.slice(0, 300)));
        console.log(pad("    starter_era", JSON.stringify(s.starter_era)?.slice(0, 400)));
        console.log(pad("    home_starter", JSON.stringify(s.home_starter)?.slice(0, 300)));
        console.log(pad("    away_starter", JSON.stringify(s.away_starter)?.slice(0, 300)));
        // auto_factors lives inside sport_specific; carries home/away_starter_id.
        const afo: any = s.auto_factors ?? null;
        if (afo && typeof afo === "object") {
          console.log(pad("    af.home_starter_id", afo.home_starter_id));
          console.log(pad("    af.away_starter_id", afo.away_starter_id));
          console.log(pad("    af.starter_era", JSON.stringify(afo.starter_era)?.slice(0, 400)));
          console.log(pad("    af.nrfi_used_fallback_era", afo.nrfi_used_fallback_era));
        } else {
          console.log(pad("    auto_factors", "(none in sport_specific)"));
        }
        // Dump any key that mentions starter.
        for (const k of Object.keys(s)) {
          if (/starter|pitcher/i.test(k)) {
            console.log(pad(`    ${k}`, JSON.stringify(s[k])?.slice(0, 300)));
          }
        }
        // Reviewer flags — definitive answer on missing_starter.
        const rv: any = s.review_v1 ?? null;
        console.log("    review_v1 (reviewer output):");
        if (!rv) {
          console.log("      (no review_v1)");
        } else {
          console.log(pad("    rv.flags", JSON.stringify(rv.flags ?? null)));
          console.log(pad("    rv.reasons", JSON.stringify(rv.reasons ?? null)?.slice(0, 500)));
          console.log(pad("    rv.ml_action", JSON.stringify(rv.ml_action ?? rv.mlAction ?? null)));
        }
        const sanity: any = s.ai_sanity ?? null;
        if (sanity) {
          console.log(pad("    ai_sanity.held", sanity.held));
          console.log(pad("    ai_sanity.hold_reason", sanity.hold_reason));
        }
      }
    }

    // ── prediction_records (new writer) for the game ────────────────
    const { data: prs } = await supabase
      .from("prediction_records")
      .select("id, market, locked_at, play_grade, verdict, snapshot_json, created_at")
      .eq("game_id", g.id);
    console.log(`\n  [prediction_records] rows: ${prs?.length ?? 0}`);
    for (const pr of (prs ?? []) as any[]) {
      console.log(`    pr.id=${pr.id} market=${pr.market} locked_at=${pr.locked_at} play_grade=${pr.play_grade} verdict=${pr.verdict}`);
      const s = pr.snapshot_json;
      if (s && typeof s === "object") {
        const o: any = s;
        const starterBits: Record<string, unknown> = {};
        for (const k of Object.keys(o)) {
          if (/starter|pitcher|hold_reason|missing/i.test(k)) starterBits[k] = o[k];
        }
        if (Object.keys(starterBits).length) {
          console.log(pad("    snapshot starter/hold bits", JSON.stringify(starterBits).slice(0, 600)));
        }
      }
    }
  }

  console.log("\n=== end audit ===\n");
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
