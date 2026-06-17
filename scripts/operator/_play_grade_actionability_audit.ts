/**
 * Read-only audit v2: also reads game_predictions.ml_grade/ou_grade
 * (the V2.1 framework grade) which is what drives the public per-market
 * pill rendering in sharedCardParts.tsx (tile.grade === null → "—").
 */
import { createClient } from "@supabase/supabase-js";

const ET_TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  console.log(`\n═══════ play_grade ↔ public-pill audit · ${ET_TODAY} ═══════\n`);

  const { data: recs } = await sb
    .from("prediction_records")
    .select("id, game_id, game_prediction_id, market, pick, side, no_bet, play_grade, best_angle, confidence, locked_at, snapshot_json")
    .eq("sport", "mlb")
    .in("market", ["moneyline", "total"])
    .eq("slate_date", ET_TODAY)
    .order("id");
  if (!recs?.length) { console.log("No ML/OU rows today.\n"); return; }

  const predIds = Array.from(new Set(recs.map((r) => r.game_prediction_id).filter((x): x is number => x !== null)));
  const { data: preds } = await sb
    .from("game_predictions")
    .select("id, ml_grade, ou_grade, nrfi_grade, ml_confidence, ou_confidence, nrfi_confidence")
    .in("id", predIds);
  const predMap = new Map<number, any>((preds ?? []).map((p: any) => [p.id, p]));

  const gameIds = Array.from(new Set(recs.map((r) => r.game_id)));
  const { data: games } = await sb.from("games").select("id, home_team_id, away_team_id").in("id", gameIds);
  const teamIds = new Set<number>();
  for (const g of games ?? []) { teamIds.add(g.home_team_id); teamIds.add(g.away_team_id); }
  const { data: teams } = await sb.from("teams").select("id, abbreviation").in("id", Array.from(teamIds));
  const teamMap = new Map<number, string>((teams ?? []).map((t: any) => [t.id, t.abbreviation ?? `#${t.id}`]));
  const gameMap = new Map<number, any>((games ?? []).map((g: any) => [g.id, g]));

  console.log("Per row — record vs game_predictions vs snapshot:\n");
  console.log("  rec mkt  matchup     locked   pick   conf%  rec.play_grade  rec.no_bet  pred.ml_grade/ou_grade   snap.pg     snap.BA  pillShown?  status");

  type Bucket = { id: number; matchup: string; market: string; reason: string };
  const A: Bucket[] = []; // pillShown but play_grade non-actionable
  const B: Bucket[] = []; // pillHidden but play_grade actionable
  const C: Bucket[] = []; // pred grade ≠ V2.2 audit story

  for (const r of recs) {
    const g = gameMap.get(r.game_id);
    const matchup = g ? `${teamMap.get(g.away_team_id) ?? "?"}@${teamMap.get(g.home_team_id) ?? "?"}` : "?@?";
    const p = predMap.get(r.game_prediction_id);
    const frameworkGrade = r.market === "moneyline" ? (p?.ml_grade ?? null) : (p?.ou_grade ?? null);
    const sp = (r.snapshot_json ?? {}) as Record<string, unknown>;
    const v22 = (sp.v2_2_audit as Record<string, unknown> | undefined) ?? {};
    const snapPg = r.market === "moneyline"
      ? (v22.ml_play_grade as string | undefined) ?? null
      : (v22.ou_play_grade as string | undefined) ?? null;
    const snapBA = r.market === "moneyline"
      ? (v22.ml_best_angle_eligible as boolean | undefined) ?? null
      : (v22.ou_best_angle_eligible as boolean | undefined) ?? null;

    // Public pill is shown iff tile.grade !== null AND pick !== null AND confidence !== null
    // (per app/lab/components/daily-edge/sharedCardParts.tsx isNoPick check)
    const pillShown = frameworkGrade !== null && r.pick !== null && r.confidence !== null;
    const status = pillShown ? "shown" : "—";

    const nonActionableLabels = ["no_bet", "held", "toss_up"];
    if (pillShown && r.play_grade !== null && nonActionableLabels.includes(r.play_grade)) {
      A.push({ id: r.id, matchup, market: r.market, reason: `play_grade="${r.play_grade}" but customer pill SHOWED ${r.pick} (framework grade=${frameworkGrade}, conf=${r.confidence}%)` });
    }
    if (!pillShown && r.play_grade !== null && !nonActionableLabels.includes(r.play_grade)) {
      B.push({ id: r.id, matchup, market: r.market, reason: `play_grade="${r.play_grade}" but customer pill HIDDEN (framework grade=${frameworkGrade}, conf=${r.confidence})` });
    }
    if (snapPg !== null && snapPg !== r.play_grade) {
      C.push({ id: r.id, matchup, market: r.market, reason: `record.play_grade=${r.play_grade} ≠ snapshot.v2_2_audit.${r.market === "moneyline" ? "ml" : "ou"}_play_grade=${snapPg}` });
    }

    console.log(`  ${String(r.id).padStart(3)} ${r.market.slice(0,4).padEnd(4)} ${matchup.padEnd(11)} ${(r.locked_at?.slice(11,19) ?? "no").padEnd(8)} ${(r.pick ?? "?").padEnd(6)} ${String(r.confidence ?? "-").padStart(5)}  ${String(r.play_grade ?? "-").padEnd(14)} ${String(r.no_bet).padEnd(10)}  ${String(frameworkGrade ?? "null").padEnd(23)} ${String(snapPg ?? "-").padEnd(11)} ${String(snapBA ?? "-").padEnd(7)} ${status.padEnd(10)} ${pillShown ? "actionable" : "no-pill"}`);
  }

  console.log(`\n─── Findings ───`);
  console.log(`A) pillShown but play_grade is non-actionable label ("no_bet"/"held"/"toss_up") — ${A.length}`);
  for (const r of A) console.log(`   rec=${r.id} ${r.matchup} ${r.market} — ${r.reason}`);
  console.log(`\nB) pillHidden but play_grade is actionable label — ${B.length}`);
  for (const r of B) console.log(`   rec=${r.id} ${r.matchup} ${r.market} — ${r.reason}`);
  console.log(`\nC) record.play_grade ≠ snapshot.v2_2_audit play_grade — ${C.length}`);
  for (const r of C) console.log(`   rec=${r.id} ${r.matchup} ${r.market} — ${r.reason}`);
}
main().catch((e) => { console.error("FATAL:", e?.message ?? e); process.exit(1); });
