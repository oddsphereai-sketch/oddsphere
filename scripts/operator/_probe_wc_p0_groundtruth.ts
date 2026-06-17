/**
 * READ-ONLY P0 ground-truth probe for the WC Daily Edge slate.
 *
 * For every soccer prediction_record on the current slate window, dumps the
 * exact fields the live card depends on so we can confirm:
 *   • P0B: is `odds_american` (source of card `priceAmerican`) null?
 *   • P0C: locked rows + projected-total vs displayed side coherence
 *   • P0E: play_grade casing + held/no_bet reasons (stale vs current code)
 *   • P0F: kickoff vs now (which fixtures the post-kickoff filter hides)
 *
 * No writes. SELECT only.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m === null) continue;
  if (!(m[1] in process.env)) process.env[m[1]] = m[2];
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

function pad(s: unknown, n: number): string {
  const str = String(s ?? "—");
  return str.length >= n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}

async function main() {
  const nowMs = Date.now();
  console.log(`now (UTC): ${new Date(nowMs).toISOString()}\n`);

  const isoToday = new Date(nowMs).toISOString().slice(0, 10);
  const isoTomorrow = new Date(nowMs + 24 * 3600_000).toISOString().slice(0, 10);
  const isoYesterday = new Date(nowMs - 24 * 3600_000).toISOString().slice(0, 10);

  const { data: gamesRaw, error: gErr } = await sb
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, status, slate_date")
    .eq("sport", "soccer")
    .in("slate_date", [isoYesterday, isoToday, isoTomorrow])
    .order("game_date");

  if (gErr) {
    console.log("games query error:", gErr.message);
    return;
  }
  const games = gamesRaw ?? [];
  if (games.length === 0) {
    console.log("No soccer games in slate window.");
    return;
  }

  const teamIds = Array.from(
    new Set(games.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x): x is number => x !== null)),
  );
  const { data: teamsRaw } = await sb.from("teams").select("id, abbreviation").in("id", teamIds);
  const teamMap = new Map((teamsRaw ?? []).map((t) => [t.id, t.abbreviation]));
  const lbl = (id: number | null) => (id !== null ? teamMap.get(id) ?? "?" : "?");

  for (const g of games) {
    const kicked = new Date(g.game_date).getTime() <= nowMs;
    console.log(
      `\n=== ${lbl(g.away_team_id)} @ ${lbl(g.home_team_id)}  (${g.game_date})  status=${g.status}  slate_date=${g.slate_date}  ${kicked ? "*** KICKED OFF (hidden by adapter filter) ***" : ""}`,
    );

    const { data: recs } = await sb
      .from("prediction_records")
      .select("market, side, pick, play_grade, held, no_bet, no_bet_reason, hold_reason, odds_american, locked_at, line, snapshot_json")
      .eq("game_id", g.id)
      .order("market");

    if (!recs || recs.length === 0) {
      console.log("  (no prediction_records)");
      continue;
    }

    console.log(
      `  ${pad("market", 14)}${pad("pick", 14)}${pad("grade", 12)}${pad("held", 6)}${pad("nobet", 6)}${pad("odds_am", 9)}${pad("locked", 6)}reason`,
    );
    for (const r of recs) {
      const snap = (r.snapshot_json ?? {}) as Record<string, unknown>;
      const decision = (snap.decision ?? {}) as Record<string, unknown>;
      const recon = (snap.total_projection_reconciliation ?? null) as Record<string, unknown> | null;
      const projTotal =
        recon && typeof recon.expected_total === "number"
          ? recon.expected_total
          : (decision.projected_total ?? null);
      const reason = r.no_bet_reason ?? r.hold_reason ?? "";
      const extra =
        r.market === "total"
          ? `  [proj=${projTotal ?? "?"} line=${r.line ?? "?"} disp=${decision.displayed_side ?? r.pick} recon=${recon ? "Y" : "N"}]`
          : "";
      console.log(
        `  ${pad(r.market, 14)}${pad(r.pick, 14)}${pad(r.play_grade, 12)}${pad(r.held, 6)}${pad(r.no_bet, 6)}${pad(r.odds_american, 9)}${pad(r.locked_at ? "Y" : "N", 6)}${reason}${extra}`,
      );
    }
  }

  // Cross-check: lines + line_history coverage for the same games
  console.log(`\n\n=== odds_american NULL summary (P0B) ===`);
  for (const g of games) {
    const { data: recs } = await sb
      .from("prediction_records")
      .select("market, side, odds_american")
      .eq("game_id", g.id);
    if (!recs) continue;
    const total = recs.length;
    const nullOdds = recs.filter((r) => r.odds_american === null).length;
    const { count: linesCount } = await sb
      .from("lines")
      .select("*", { count: "exact", head: true })
      .eq("game_id", g.id);
    console.log(
      `  ${pad(lbl(g.away_team_id) + "@" + lbl(g.home_team_id), 16)} odds_american null: ${nullOdds}/${total}   lines rows: ${linesCount ?? 0}`,
    );
  }
}

main().then(() => process.exit(0));
