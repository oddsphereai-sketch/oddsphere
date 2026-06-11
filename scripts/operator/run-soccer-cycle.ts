/**
 * Operator dry-run for the WC-3 soccer pipeline.
 *
 * Pulls live BDL FIFA matches + odds and SharpAPI WC odds, runs the
 * auto-model, prints normalized prediction rows + snapshot summary.
 *
 * Read-only against live providers. Zero DB writes — wiring to the
 * prediction_records writer is a separate step (WC-3b).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/run-soccer-cycle.ts \
 *     [--date YYYY-MM-DD] [--match-id N] [--include-held]
 *
 * Defaults:
 *   --date     today (UTC)
 *   --match-id (none — runs all matches for the date)
 *   --include-held (off — held markets are still printed but flagged)
 */

import { BdlFifaClient } from "../../lib/providers/real_api/_bdlFifaClient";
import { BallDontLieFifaProvider } from "../../lib/providers/real_api/BallDontLieFifaProvider";
import { SharpApiClient } from "../../lib/providers/real_api/_sharpApiClient";
import { SharpApiSoccerOddsProvider } from "../../lib/providers/real_api/SharpApiSoccerOddsProvider";
import { reconcileSoccerEvents, extractSharpEventCandidates, type ReconciliationKind } from "../../lib/providers/real_api/_soccerReconciler";
import { loadDefaultEloPrior } from "../../lib/services/soccer/eloPrior";
import { runSoccerAutoModelV1 } from "../../lib/services/soccer/soccerAutoModelV1";
import { buildSoccerPredictionRows } from "../../lib/services/soccer/soccerPredictionWriter";

type Cli = {
  date: string;
  matchId: number | null;
  includeHeld: boolean;
};

function parseCli(argv: string[]): Cli {
  let date = new Date().toISOString().split("T")[0];
  let matchId: number | null = null;
  let includeHeld = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) date = argv[++i];
    else if (argv[i] === "--match-id" && argv[i + 1]) matchId = Number(argv[++i]);
    else if (argv[i] === "--include-held") includeHeld = true;
  }
  return { date, matchId, includeHeld };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (!bdlKey || !sharpKey) {
    console.error("Missing BALLDONTLIE_API_KEY or SHARPAPI_KEY in env.");
    process.exit(1);
  }

  console.log(`\n═══ SOCCER AUTO-MODEL DRY-RUN — ${new Date().toISOString()} ═══`);
  console.log(`  date=${cli.date}  match-id=${cli.matchId ?? "(all)"}  include-held=${cli.includeHeld}\n`);

  // Load Elo prior.
  const eloTable = loadDefaultEloPrior();
  console.log(`Loaded Elo snapshot: file=${eloTable.meta.snapshot_filename}  teams=${eloTable.meta.team_count}  mean=${eloTable.meta.mean_elo.toFixed(1)}  stddev=${eloTable.meta.stddev_elo.toFixed(1)}\n`);

  // Providers.
  const bdl = new BallDontLieFifaProvider(new BdlFifaClient(bdlKey));
  const sharpClient = new SharpApiClient(sharpKey);
  const sharp = new SharpApiSoccerOddsProvider(sharpClient);

  // Fetch matches + reconcile.
  const matches = await bdl.listMatches({ start_date: cli.date, end_date: cli.date, per_page: 25 });
  const scopedMatches = cli.matchId !== null ? matches.filter((m) => m.provider_match_id === cli.matchId) : matches;
  console.log(`BDL fixtures on ${cli.date}: ${matches.length} (after filter: ${scopedMatches.length})`);
  if (scopedMatches.length === 0) {
    console.log("No fixtures to model. Exiting.");
    return;
  }

  // SharpAPI odds + splits status. SharpAPI enforces offset ≤ 500 so we
  // cap pages tightly; the dry-run focuses on launch market coverage
  // rather than every alt line.
  const sharpOddsRaw = await sharp.listRawOdds({ maxPages: 2, limit: 200 });
  const splitsResult = await sharp.probeSplits();
  console.log(`SharpAPI raw odds rows: ${sharpOddsRaw.length}`);
  console.log(`SharpAPI splits: ${splitsResult.status.classification} / ${splitsResult.status.status} (rows=${splitsResult.status.row_count})\n`);

  // Reconcile fixtures.
  const sharpCandidates = extractSharpEventCandidates(sharpOddsRaw);
  const reconciliations = reconcileSoccerEvents(scopedMatches, sharpCandidates);

  for (const match of scopedMatches) {
    const recon = reconciliations.find((r) => r.bdl_match?.provider_match_id === match.provider_match_id);
    const reconKind: ReconciliationKind = recon?.kind ?? "BDL_ONLY";
    const sharpEventId = recon?.sharp_event?.event_id ?? null;

    console.log("\n────────────────────────────────────────────────────────────────");
    console.log(`Fixture: ${match.away_team_name} @ ${match.home_team_name}  (BDL match_id=${match.provider_match_id})`);
    console.log(`  datetime: ${match.datetime}`);
    console.log(`  stage: ${match.stage_name}  group: ${match.group_name ?? "-"}  stadium: ${match.stadium_name ?? "-"}, ${match.stadium_country ?? "-"}`);
    console.log(`  reconciliation: ${reconKind}  sharp_event_id: ${sharpEventId ?? "(none)"}`);

    // BDL odds for this match.
    const bdlRawOdds = await bdl.listRawOdds({ match_id: match.provider_match_id, per_page: 25 });
    const bdlNormalized = bdlRawOdds.flatMap((r) =>
      bdl.normalizeOdds(r, { home_team: match.home_team_name, away_team: match.away_team_name }),
    );
    const sharpNormalized = sharp.normalizeOdds(
      sharpEventId !== null ? sharpOddsRaw.filter((r) => r.event_id === sharpEventId) : [],
    );
    const allOdds = [...bdlNormalized, ...sharpNormalized];
    console.log(`  normalized odds rows: BDL=${bdlNormalized.length}  SharpAPI=${sharpNormalized.length}  total=${allOdds.length}`);

    if (allOdds.length === 0) {
      console.log("  (no normalized odds — skipping model run for this fixture)");
      continue;
    }

    // Run auto-model.
    const modelOutput = runSoccerAutoModelV1({
      eloTable,
      match,
      oddsRows: allOdds,
      splitsStatus: splitsResult.status,
      reconciliation: reconKind,
      totalLine: 2.5,
      preCalibrationPublishWhitelist: ["total", "btts"],
      venueAltitudeMeters: match.stadium_country === "MEX" && match.stadium_name === "Estadio Azteca" ? 2240 : null,
    });

    if (modelOutput.fixtureHoldReason !== null) {
      console.log(`  FIXTURE STATUS: ${modelOutput.fixtureHoldReason}`);
      // Continue to print per-market diagnostic output below — operators
      // want to see WHY each market was held, not just the rollup.
    }

    console.log(`  λ_home=${modelOutput.lambdaHome.toFixed(3)}  λ_away=${modelOutput.lambdaAway.toFixed(3)}  expected_total=${(modelOutput.lambdaHome + modelOutput.lambdaAway).toFixed(2)}`);
    console.log(`  raw model probabilities:`);
    console.log(`    match_result: H=${(modelOutput.marketProbs.match_result.home * 100).toFixed(1)}%  D=${(modelOutput.marketProbs.match_result.draw * 100).toFixed(1)}%  A=${(modelOutput.marketProbs.match_result.away * 100).toFixed(1)}%`);
    console.log(`    double_chance: 1X=${(modelOutput.marketProbs.double_chance.home_or_draw * 100).toFixed(1)}%  X2=${(modelOutput.marketProbs.double_chance.away_or_draw * 100).toFixed(1)}%  12=${(modelOutput.marketProbs.double_chance.home_or_away * 100).toFixed(1)}%`);
    console.log(`    total 2.5: over=${(modelOutput.marketProbs.total.over * 100).toFixed(1)}%  under=${(modelOutput.marketProbs.total.under * 100).toFixed(1)}%`);
    console.log(`    btts: yes=${(modelOutput.marketProbs.btts.yes * 100).toFixed(1)}%  no=${(modelOutput.marketProbs.btts.no * 100).toFixed(1)}%`);

    for (const m of modelOutput.perMarket) {
      console.log(`  → ${m.market} pick=${m.pick}${m.line !== null ? ` @ ${m.line}` : ""}  grade=${m.grade.grade}  conf=${m.grade.confidence.toFixed(1)}  edge_pp=${m.grade.edge_pp === null ? "n/a" : m.grade.edge_pp.toFixed(2)}  best_angle=${m.grade.best_angle}  agreement=${m.grade.model_market_agreement}`);
      if (m.hold.hold) console.log(`      HELD: ${m.hold.code} — ${m.hold.reason}`);
      if (m.grade.confidence_reductions.length > 0) {
        for (const r of m.grade.confidence_reductions) {
          console.log(`      reduction: -${r.pp}pp (${r.code}) — ${r.reason}`);
        }
      }
    }

    const rows = buildSoccerPredictionRows({ match, modelOutput, includeHeldRows: cli.includeHeld });
    console.log(`  prediction_records rows that WOULD be written: ${rows.length}`);
  }

  console.log(`\n═══ DRY-RUN COMPLETE — no DB writes performed ═══\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
