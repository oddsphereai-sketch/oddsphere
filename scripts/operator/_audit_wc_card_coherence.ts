/**
 * READ-ONLY audit of World Cup card coherence.
 *
 * Daniel's 2026-06-12 ask: show whether each WC fixture × market on
 * the current slate has customer-facing contradictions between the
 * displayed pick, model probability, value side, and projected
 * (where applicable) total direction.
 *
 * No DB writes. No prediction rewrites. SELECT only.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
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

type SnapshotJson = Record<string, unknown>;

function dec(snap: SnapshotJson): Record<string, unknown> {
  return (snap.decision as Record<string, unknown>) ?? {};
}
function model(snap: SnapshotJson): Record<string, unknown> {
  return (snap.model as Record<string, unknown>) ?? {};
}
function market(snap: SnapshotJson): Record<string, unknown> {
  return (snap.market as Record<string, unknown>) ?? {};
}
function fnum(v: unknown, d = 3): string {
  if (typeof v !== "number") return "—";
  return v.toFixed(d);
}

async function main(): Promise<void> {
  const today = etToday();
  console.log(`\n=== WC card coherence audit — ET sports-day ${today} ===\n`);

  const { data: games, error: gErr } = await sb
    .from("games")
    .select("id, external_id, sport, slate_date, game_date, status, home_team_id, away_team_id")
    .eq("sport", "soccer")
    .eq("slate_date", today)
    .order("game_date", { ascending: true });
  if (gErr) { console.error("games err:", gErr.message); process.exit(1); }
  console.log(`WC games (sport=soccer, slate_date=${today}): ${games?.length ?? 0}`);
  if ((games?.length ?? 0) === 0) {
    console.log("Trying yesterday + tomorrow…");
    const dates = [(() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    })(), (() => {
      const d = new Date(); d.setDate(d.getDate() + 1);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    })()];
    const { data: g2 } = await sb
      .from("games")
      .select("id, external_id, sport, slate_date, game_date, status")
      .eq("sport", "soccer")
      .in("slate_date", dates);
    console.log(`yesterday/tomorrow rows: ${g2?.length ?? 0}`);
    for (const r of g2 ?? []) console.log(`  game.id=${r.id} ext=${r.external_id} slate=${r.slate_date} game=${r.game_date} status=${r.status}`);
  }

  const gameIds = (games ?? []).map((g) => g.id);
  if (gameIds.length === 0) { console.log("\nNo WC games today. Exiting."); process.exit(0); }

  // Team names for readability
  const teamIds = new Set<number>();
  for (const g of games ?? []) {
    if ((g as { home_team_id?: number }).home_team_id) teamIds.add((g as { home_team_id: number }).home_team_id);
    if ((g as { away_team_id?: number }).away_team_id) teamIds.add((g as { away_team_id: number }).away_team_id);
  }
  const { data: teams } = await sb.from("teams").select("id, abbreviation, name").in("id", [...teamIds]);
  const teamById = new Map<number, { abbr: string; name: string }>();
  for (const t of teams ?? []) teamById.set((t as { id: number }).id, { abbr: (t as { abbreviation: string }).abbreviation, name: (t as { name: string }).name });

  const { data: preds } = await sb
    .from("prediction_records")
    .select("id, game_id, market, snapshot_json, locked_at, created_at")
    .in("game_id", gameIds);
  console.log(`prediction_records: ${preds?.length ?? 0}\n`);

  type Row = { game_id: number; market: string; locked_at: string | null; snap: SnapshotJson };
  const byGame = new Map<number, Row[]>();
  for (const p of preds ?? []) {
    const arr = byGame.get((p as { game_id: number }).game_id) ?? [];
    arr.push({
      game_id: (p as { game_id: number }).game_id,
      market: (p as { market: string }).market,
      locked_at: (p as { locked_at: string | null }).locked_at,
      snap: ((p as { snapshot_json: SnapshotJson }).snapshot_json ?? {}) as SnapshotJson,
    });
    byGame.set((p as { game_id: number }).game_id, arr);
  }

  for (const game of games ?? []) {
    const g = game as { id: number; external_id: string; home_team_id: number; away_team_id: number; game_date: string };
    const home = teamById.get(g.home_team_id) ?? { abbr: "?", name: "?" };
    const away = teamById.get(g.away_team_id) ?? { abbr: "?", name: "?" };
    console.log(`\n━━━ Game ${g.id}: ${away.abbr} @ ${home.abbr}  (${g.game_date}) ━━━`);
    const rows = byGame.get(g.id) ?? [];
    for (const r of rows) {
      const snap = r.snap;
      const d = dec(snap);
      const m = model(snap);
      const k = market(snap);
      const locked = r.locked_at ? `LOCKED ${r.locked_at.slice(11,19)}` : "unlocked";
      console.log(`\n  → market: ${r.market}  (${locked})`);

      const displayed = d.pick;
      const grade = d.grade;
      const noBet = d.no_bet;
      const noBetReason = d.no_bet_reason;
      const cap = d.grade_cap; // present from WC-MODEL-2/3 work
      const confidence = d.confidence;

      // Pull raw model + market structures per market.
      const raw = (m.raw_probabilities as Record<string, unknown>) ?? {};
      const implied = (k.implied_probabilities as Record<string, unknown>) ?? {};
      const devig = (k.devigged_probabilities as Record<string, unknown>) ?? {};
      const edge_pp = (k.edge_pp as Record<string, unknown>) ?? {};

      console.log(`    displayed pick      = ${displayed}`);
      console.log(`    grade               = ${grade}    no_bet=${noBet}    cap=${cap ?? "-"}`);
      console.log(`    confidence          = ${confidence}`);
      if (noBet === true && typeof noBetReason === "string") console.log(`    no_bet_reason       = ${noBetReason}`);

      if (r.market === "match_result") {
        const mr = (raw.match_result as Record<string, unknown>) ?? {};
        const home_p = fnum(mr.home);
        const draw_p = fnum(mr.draw);
        const away_p = fnum(mr.away);
        const i_home = fnum(implied["match_result|home"]);
        const i_draw = fnum(implied["match_result|draw"]);
        const i_away = fnum(implied["match_result|away"]);
        const dv_home = fnum(devig["match_result|home"]);
        const dv_draw = fnum(devig["match_result|draw"]);
        const dv_away = fnum(devig["match_result|away"]);
        const e_home = fnum(edge_pp["match_result|home"], 1);
        const e_draw = fnum(edge_pp["match_result|draw"], 1);
        const e_away = fnum(edge_pp["match_result|away"], 1);
        console.log(`    model_p             home=${home_p}  draw=${draw_p}  away=${away_p}`);
        console.log(`    market_implied      home=${i_home}  draw=${i_draw}  away=${i_away}`);
        console.log(`    market_devig        home=${dv_home}  draw=${dv_draw}  away=${dv_away}`);
        console.log(`    edge_pp             home=${e_home}  draw=${e_draw}  away=${e_away}`);
        // Argmaxes
        const pSides = [["home", mr.home], ["draw", mr.draw], ["away", mr.away]] as Array<[string, number]>;
        const argmaxProb = pSides.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
        const eSides = [["home", edge_pp["match_result|home"]], ["draw", edge_pp["match_result|draw"]], ["away", edge_pp["match_result|away"]]] as Array<[string, number]>;
        const argmaxEdge = eSides.filter((x) => typeof x[1] === "number").sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "—";
        console.log(`    argmax_model        ${argmaxProb}`);
        console.log(`    argmax_value        ${argmaxEdge}`);
        console.log(`    displayed_side_eq_argmax_model = ${displayed === argmaxProb}`);
        console.log(`    displayed_side_eq_argmax_value = ${displayed === argmaxEdge}`);
      } else if (r.market === "double_chance") {
        const dc = (raw.double_chance as Record<string, unknown>) ?? {};
        const hd = fnum(dc.home_or_draw);
        const ad = fnum(dc.away_or_draw);
        const ha = fnum(dc.home_or_away);
        const i_hd = fnum(implied["double_chance|home_or_draw"]);
        const i_ad = fnum(implied["double_chance|away_or_draw"]);
        const i_ha = fnum(implied["double_chance|home_or_away"]);
        const dv_hd = fnum(devig["double_chance|home_or_draw"]);
        const dv_ad = fnum(devig["double_chance|away_or_draw"]);
        const dv_ha = fnum(devig["double_chance|home_or_away"]);
        const e_hd = fnum(edge_pp["double_chance|home_or_draw"], 1);
        const e_ad = fnum(edge_pp["double_chance|away_or_draw"], 1);
        const e_ha = fnum(edge_pp["double_chance|home_or_away"], 1);
        console.log(`    model_p             HD=${hd}  AD=${ad}  HA=${ha}`);
        console.log(`    market_implied      HD=${i_hd}  AD=${i_ad}  HA=${i_ha}`);
        console.log(`    market_devig        HD=${dv_hd}  AD=${dv_ad}  HA=${dv_ha}`);
        console.log(`    edge_pp             HD=${e_hd}  AD=${e_ad}  HA=${e_ha}`);
        const pSides = [["home_or_draw", dc.home_or_draw], ["away_or_draw", dc.away_or_draw], ["home_or_away", dc.home_or_away]] as Array<[string, number]>;
        const argmaxProb = pSides.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0];
        const eSides = [["home_or_draw", edge_pp["double_chance|home_or_draw"]], ["away_or_draw", edge_pp["double_chance|away_or_draw"]], ["home_or_away", edge_pp["double_chance|home_or_away"]]] as Array<[string, number]>;
        const argmaxEdge = eSides.filter((x) => typeof x[1] === "number").sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "—";
        console.log(`    argmax_model        ${argmaxProb}`);
        console.log(`    argmax_value        ${argmaxEdge}`);
        console.log(`    displayed_side_eq_argmax_model = ${displayed === argmaxProb}`);
        console.log(`    displayed_side_eq_argmax_value = ${displayed === argmaxEdge}`);
      } else if (r.market === "total") {
        const t = (raw.total_at_canonical as Record<string, unknown>) ?? {};
        const line = t.line as number;
        const over_p = fnum(t.over);
        const under_p = fnum(t.under);
        const push_p = fnum(t.push);
        const lambda_h = m.lambda_home as number;
        const lambda_a = m.lambda_away as number;
        const exp_total = m.expected_total as number;
        const i_over = fnum(implied[`total|over|${line}`]);
        const i_under = fnum(implied[`total|under|${line}`]);
        const dv_over = fnum(devig[`total|over|${line}`]);
        const dv_under = fnum(devig[`total|under|${line}`]);
        const e_over = fnum(edge_pp[`total|over|${line}`], 1);
        const e_under = fnum(edge_pp[`total|under|${line}`], 1);
        console.log(`    line                = ${line}`);
        console.log(`    expected_total      = ${fnum(exp_total)}    λ_home=${fnum(lambda_h)}  λ_away=${fnum(lambda_a)}`);
        console.log(`    model_p             over=${over_p}  under=${under_p}  push=${push_p}`);
        console.log(`    market_implied      over=${i_over}  under=${i_under}`);
        console.log(`    market_devig        over=${dv_over}  under=${dv_under}`);
        console.log(`    edge_pp             over=${e_over}  under=${e_under}`);
        const argmaxProb = ((t.over as number) ?? 0) >= ((t.under as number) ?? 0) ? "over" : "under";
        const mean_dir = exp_total > line ? "over" : exp_total < line ? "under" : "tied";
        const eOver = edge_pp[`total|over|${line}`] as number | null;
        const eUnder = edge_pp[`total|under|${line}`] as number | null;
        const argmaxEdge = eOver === null || eUnder === null ? "—" : (eOver > eUnder ? "over" : eUnder > eOver ? "under" : "tied");
        console.log(`    argmax_model        ${argmaxProb}`);
        console.log(`    argmax_value        ${argmaxEdge}`);
        console.log(`    mean_direction      ${mean_dir}    (exp_total ${fnum(exp_total)} vs line ${line})`);
        console.log(`    displayed_side_eq_argmax_model        = ${displayed === argmaxProb}`);
        console.log(`    displayed_side_eq_mean_direction      = ${displayed === mean_dir}`);
        console.log(`    displayed_side_eq_argmax_value        = ${displayed === argmaxEdge}`);
        // CONTRADICTION CHECK — the MLB-style coherence check
        if (mean_dir !== "tied" && displayed && displayed !== mean_dir) {
          console.log(`    ⚠️  CONTRADICTION: displayed_side=${displayed} but expected_total ${fnum(exp_total)} ${mean_dir === "over" ? ">" : "<"} ${line}`);
        }
      } else if (r.market === "btts") {
        const b = (raw.btts as Record<string, unknown>) ?? {};
        const yes_p = fnum(b.yes);
        const no_p = fnum(b.no);
        const i_yes = fnum(implied["btts|yes"]);
        const i_no = fnum(implied["btts|no"]);
        const dv_yes = fnum(devig["btts|yes"]);
        const dv_no = fnum(devig["btts|no"]);
        const e_yes = fnum(edge_pp["btts|yes"], 1);
        const e_no = fnum(edge_pp["btts|no"], 1);
        console.log(`    model_p             yes=${yes_p}  no=${no_p}`);
        console.log(`    market_implied      yes=${i_yes}  no=${i_no}`);
        console.log(`    market_devig        yes=${dv_yes}  no=${dv_no}`);
        console.log(`    edge_pp             yes=${e_yes}  no=${e_no}`);
        const argmaxProb = ((b.yes as number) ?? 0) >= ((b.no as number) ?? 0) ? "yes" : "no";
        const eYes = edge_pp["btts|yes"] as number | null;
        const eNo = edge_pp["btts|no"] as number | null;
        const argmaxEdge = eYes === null || eNo === null ? "—" : (eYes > eNo ? "yes" : eNo > eYes ? "no" : "tied");
        console.log(`    argmax_model        ${argmaxProb}`);
        console.log(`    argmax_value        ${argmaxEdge}`);
        console.log(`    displayed_side_eq_argmax_model = ${displayed === argmaxProb}`);
        console.log(`    displayed_side_eq_argmax_value = ${displayed === argmaxEdge}`);
      }
    }
  }
  console.log("\n=== end audit ===\n");
}

main().then(() => process.exit(0), (e) => { console.error("FATAL:", e); process.exit(1); });
