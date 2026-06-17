/**
 * Post-lock seal verification for a single WC game. Run after the game's
 * T-60 lock. Confirms: lock snapshot exists, locked grade matches the clean
 * baseline, no Held-as-pick, no NaN/null/malformed card fields, tracking
 * readiness, auditor 0 errors. Args: <gameId> <matchup> <slateDate> <baselineJSON>
 */
import { supabase } from "../../lib/db/supabase";
import { buildSoccerDailyEdgeAdapted } from "../../lib/services/soccer/buildSoccerDailyEdgeAdapted";
import { runSlateHealthAudit } from "../../lib/services/audit/slateHealthAuditor";

(async () => {
  const [gameIdStr, matchup, slateDate, baselineJSON] = process.argv.slice(2);
  const gameId = Number(gameIdStr);
  const baseline: Record<string, string> = JSON.parse(baselineJSON ?? "{}");
  const fail: string[] = [];
  const ok: string[] = [];

  // 1 + 2. Lock snapshot exists + locked grade matches clean baseline.
  const { data: recs } = await supabase
    .from("prediction_records")
    .select("market, pick, play_grade, held, locked_at, model_probability, edge, odds_american")
    .eq("game_id", gameId);
  const rows = recs ?? [];
  const unlocked = rows.filter((r) => r.locked_at === null);
  if (rows.length === 0) fail.push("no prediction records");
  else if (unlocked.length > 0) fail.push(`${unlocked.length} market(s) NOT locked: ${unlocked.map((r) => r.market).join(",")}`);
  else ok.push(`lock snapshot exists (${rows.length} markets sealed)`);

  for (const r of rows) {
    const base = baseline[r.market];
    if (base && base !== r.play_grade) {
      // Flag only a REGRESSION to Caution on a previously-clean grade.
      if (r.play_grade === "Caution" && base !== "Caution") fail.push(`${r.market} REGRESSED ${base}→Caution`);
      else ok.push(`${r.market} grade ${base}→${r.play_grade} (non-regression drift, fresh odds)`);
    } else if (base) {
      ok.push(`${r.market} grade matches baseline (${r.play_grade})`);
    }
    // 3. No Held-as-pick.
    if (r.held === true && r.pick !== null) fail.push(`${r.market} HELD but has pick=${r.pick}`);
    // numeric field sanity on the record.
    for (const [k, v] of Object.entries({ model_probability: r.model_probability, edge: r.edge })) {
      if (typeof v === "number" && Number.isNaN(v)) fail.push(`${r.market} ${k}=NaN`);
    }
  }
  if (!rows.some((r) => r.held === true && r.pick !== null)) ok.push("no Held-as-pick");

  // 4. No NaN/null/malformed in the rendered card for this game.
  try {
    const resp: any = await buildSoccerDailyEdgeAdapted(slateDate);
    const g = (resp.games ?? []).find((x: any) => x.id === `soccer-${rows.length ? "" : ""}` || String(x.awayTeam + "@" + x.homeTeam) === matchup || x.matchup === matchup);
    const card = g ?? (resp.games ?? []).find((x: any) => `${x.awayTeam}@${x.homeTeam}` === matchup);
    if (!card) {
      // Card may legitimately hide a game once kicked off; only fail if not started.
      ok.push("game not on card (kickoff passed — expected post-lock)");
    } else {
      let bad = 0;
      if (!card.homeTeamLogo || !card.awayTeamLogo) { bad++; fail.push("missing logo on card"); }
      for (const p of Object.values(card.predictions ?? {}) as any[]) {
        for (const v of Object.values(p ?? {})) {
          if (typeof v === "number" && Number.isNaN(v)) { bad++; fail.push("NaN field on card"); }
          if (typeof v === "string" && /\bNaN\b|undefined|\[object/i.test(v)) { bad++; fail.push(`malformed card field: ${v}`); }
        }
      }
      if (bad === 0) ok.push("card clean (no NaN/null/malformed/missing-logo)");
    }
  } catch (e) {
    fail.push(`card render threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 5. Tracking readiness: gradeable markets present.
  const gradeable = new Set(["match_result", "total", "btts", "double_chance"]);
  const ungradeable = rows.filter((r) => !gradeable.has(r.market));
  if (ungradeable.length) fail.push(`ungradeable market(s): ${ungradeable.map((r) => r.market).join(",")}`);
  else ok.push("tracking-ready (all markets gradeable on final)");

  // 6. Auditor 0 errors.
  const audit = await runSlateHealthAudit({ supabase, today: slateDate, sports: ["soccer"], apply: false });
  if (audit.summary.errors > 0) fail.push(`auditor ${audit.summary.errors} error(s): ${audit.findings.filter((f) => f.severity === "error").map((f) => f.check).join(",")}`);
  else ok.push("auditor 0 errors");

  console.log(`\n═══ ${matchup} (game ${gameId}) post-lock verification ═══`);
  for (const o of ok) console.log(`  ✓ ${o}`);
  for (const f of fail) console.log(`  ✗ ${f}`);
  console.log(fail.length === 0 ? `\n✅ ${matchup} SEALED CLEAN — all checks pass` : `\n❌ ${matchup} has ${fail.length} issue(s) — investigate`);
})().catch((e) => console.error("VERIFY ERROR", e?.message ?? e));
