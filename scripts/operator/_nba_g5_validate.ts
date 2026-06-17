import { readFileSync } from "node:fs";
const e = readFileSync(".env.local", "utf8");
for (const l of e.split("\n")) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }

(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { buildNbaFeatureSnapshots } = await import("../../lib/services/nba/featureSnapshot");
  const { runNbaAutoModelV2 } = await import("../../lib/automodel/nba/nbaAutoModelV2");
  const { buildNbaMarketConsensus } = await import("../../lib/automodel/nba/nbaMarketConsensus");
  const { groundNbaPrediction } = await import("../../lib/automodel/nba/nbaGrounding");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  const snaps = await buildNbaFeatureSnapshots("2026-06-14", {});
  const s: any = snaps[0];
  if (!s) { console.log("no snapshot"); return; }
  const a = s.away_team.abbreviation, h = s.home_team.abbreviation;

  // raw V2
  const v2 = runNbaAutoModelV2(s, "final" as any);

  // raw book lines
  const { data: g } = await sb.from("games").select("id").eq("external_id", 401859967).single();
  const { data: lines } = await sb.from("lines").select("market_type,side,line_value,odds_american,sportsbook").eq("game_id", g!.id);

  // clean consensus
  const cons = buildNbaMarketConsensus((lines ?? []) as any);

  // injury state
  const injuriesKnown = s.data_quality.home_injuries_known && s.data_quality.away_injuries_known;

  // grounding
  const ground = groundNbaPrediction({
    rawHomeScore: v2.predicted_home_score,
    rawAwayScore: v2.predicted_away_score,
    consensusSpreadHome: cons.spreadHome,
    consensusTotal: cons.totalLine,
    consensusHomeMlNoVig: cons.mlHomeNoVig,
    mlIsSpreadImpliedFallback: cons.mlSource === "spread_implied_fallback",
    consensusStrength: cons.consensusStrength,
    tier: v2.audit.data_quality_tier,
    injuryHomePts: 0, injuryAwayPts: 0, injuriesKnown,
  });

  const P = (x: number | null) => (x === null ? "—" : (x * 100).toFixed(1) + "%");
  console.log(`\n════ NBA GAME 5 VALIDATION — ${a} @ ${h} (home=${h}) ════`);
  console.log(`\n[1] RAW V2 PROJECTION (market-free):`);
  console.log(`    ${a} ${ground.rawAwayScore}  @  ${h} ${ground.rawHomeScore}  | total=${ground.rawTotal} margin(home)=${ground.rawMargin} | tier=${v2.audit.data_quality_tier}`);
  console.log(`\n[2] RAW BOOK LINES:`);
  for (const r of (lines ?? []) as any[]) console.log(`    ${r.market_type.padEnd(9)} ${String(r.side).padEnd(5)} line=${r.line_value ?? "-"} odds=${r.odds_american} (${r.sportsbook})`);
  console.log(`\n[3] CONSENSUS ACCEPT/REJECT:`);
  console.log(`    consensus_strength=${cons.consensusStrength}  spread_confirmation=${cons.spreadConfirmation}`);
  console.log(`    ML accepted:  ${JSON.stringify(cons.mlAcceptedBooks)}  source=${cons.mlSource}`);
  console.log(`    ML rejected:  ${JSON.stringify(cons.mlRejectedBooks)}`);
  console.log(`    spread accepted: ${JSON.stringify(cons.spreadAcceptedBooks)}  rejected: ${JSON.stringify(cons.spreadRejectedBooks)}`);
  console.log(`    total accepted:  ${JSON.stringify(cons.totalAcceptedBooks)}  rejected: ${JSON.stringify(cons.totalRejectedBooks)}`);
  console.log(`    notes: ${JSON.stringify(cons.notes)}`);
  console.log(`\n[4] CLEAN MARKET BASELINE:`);
  console.log(`    ML no-vig: home(${h})=${P(cons.mlHomeNoVig)} away(${a})=${P(cons.mlAwayNoVig)}  | spread(home)=${cons.spreadHome}  total=${cons.totalLine}`);
  console.log(`\n[5] SPREAD-IMPLIED SANITY CHECK:`);
  console.log(`    spread favorite = ${cons.spreadImpliedFavorite}  → consistent with ML home>50%? ${cons.spreadImpliedFavorite === "home" ? (cons.mlHomeNoVig! > 0.5 ? "YES ✓" : "NO ✗") : cons.spreadImpliedFavorite === "away" ? (cons.mlHomeNoVig! < 0.5 ? "YES ✓" : "NO ✗") : "pickem"}`);
  console.log(`\n[6] INJURY/CONTEXT STATE:`);
  console.log(`    injuries_known=${injuriesKnown} (home=${s.data_quality.home_injuries_known}, away=${s.data_quality.away_injuries_known}) → ${injuriesKnown ? "applied" : "NO point impact, confidence capped"}`);
  console.log(`\n[7] GROUNDED PROJECTION (trust_indep=${ground.trustIndependent}, capApplied=${ground.distanceCapApplied}):`);
  console.log(`    ${a} ${ground.groundedAwayScore}  @  ${h} ${ground.groundedHomeScore}  | total=${ground.groundedTotal} (moved ${ground.groundedMovedFromMarket} from market) margin(home)=${ground.groundedMargin}`);
  console.log(`\n[8] FINAL ADJUSTED ML PROBABILITY:`);
  console.log(`    grounded home prob=${P(ground.mlHomeProbGrounded)} → regularized home prob=${P(ground.mlHomeProbRegularized)} (regCap=${ground.regularizationCapApplied})`);
  console.log(`    PICK: ${ground.mlPick === "home" ? h : a} @ ${P(ground.mlPickProb)}  | edge vs market=${ground.mlEdgePct}pp`);
  console.log(`\n[9] TOTAL (O/U):`);
  console.log(`    line=${ground.totalLineUsed}  lean=${ground.totalPick}  prob=${P(ground.totalPickProb)}`);
  console.log(`\n[10] CONFIDENCE + PLAY GRADE:`);
  console.log(`    confidence=${ground.confidence}  grade=${ground.playGrade}`);
  console.log(`    rationale: ${ground.gradeRationale}`);
  console.log(`    notes: ${JSON.stringify(ground.notes)}`);
  console.log(`\n[VERDICT] market clean=${cons.clean}${cons.holdReason ? " holdReason=" + cons.holdReason : ""}`);
})().catch((e) => console.error("ERR", e?.message || e, e?.stack?.split("\n").slice(1, 3).join(" | ")));
