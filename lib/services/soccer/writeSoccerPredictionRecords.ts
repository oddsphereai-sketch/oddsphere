/**
 * WC-4 Phase C — Soccer prediction_records writer with controlled DB
 * apply.
 *
 * Mirrors writeNhlPredictionRecords: reads internal `games` rows for
 * the slate, fetches live BDL + SharpAPI inputs, runs the WC-3
 * soccerAutoModelV1, builds prediction_records rows via the existing
 * builder, then upserts them with locked-row preservation. Honest
 * held rows are written by default so the Daily Edge card can render
 * the fixture + its hold reasons.
 *
 * Two-key gate (enforced at the operator/cron caller, not here):
 *   • SOCCER_PREDICTIONS_DB_WRITES_ENABLED=true in env
 *   • `apply: true` in the function input
 *
 * Locked-row preservation:
 *   • If an existing prediction_records row has locked_at IS NOT NULL,
 *     it is preserved unchanged. The writer does not mutate locked
 *     decisions.
 *
 * Tracked markets only (WC-1 contract):
 *   • match_result, double_chance, total, btts
 *
 * Scope:
 *   • Reads: BDL FIFA (`/matches`, `/odds`), SharpAPI (`/odds`,
 *     `/splits`), our `games`, `teams`, `prediction_records`.
 *   • Writes: prediction_records (sport='soccer') only.
 *   • NEVER writes any MLB / NBA / NHL row.
 *   • No lines table writes — that lives in a follow-up cycle.
 */

import { supabase } from "../../db/supabase";
import {
  BallDontLieFifaProvider,
  type NormalizedBdlMatch,
} from "../../providers/real_api/BallDontLieFifaProvider";
import { BdlFifaClient } from "../../providers/real_api/_bdlFifaClient";
import { SharpApiClient } from "../../providers/real_api/_sharpApiClient";
import { SharpApiSoccerOddsProvider } from "../../providers/real_api/SharpApiSoccerOddsProvider";
import {
  reconcileSoccerEvents,
  extractSharpEventCandidates,
  type ReconciliationKind,
} from "../../providers/real_api/_soccerReconciler";
import { loadDefaultEloPrior } from "./eloPrior";
import type { NormalizedSoccerOddsRecord } from "../../providers/real_api/_soccerMarketNormalizer";
import { runSoccerAutoModelV1 } from "./soccerAutoModelV1";
import { buildSoccerPredictionRows } from "./soccerPredictionWriter";

const SOCCER_MODEL_VERSION = "soccer_dixon_coles_v1";

/**
 * Competition discriminator stamped into snapshot_json on every soccer
 * prediction_records write. Internal `sport='soccer'` is shared with
 * future UCL / league play, but the COMPETITION distinguishes them at
 * the row level so the WC Daily Edge tab never accidentally surfaces a
 * UCL row (or vice versa). Member-facing label is "World Cup"; this
 * field is what makes that label honest.
 *
 * The Daily Edge adapter (buildSoccerDailyEdgeAdapted) filters
 * prediction_records on this exact value before loading games, so the
 * WC tab is competition-scoped end to end without touching the shared
 * `games` schema.
 */
const SOCCER_COMPETITION_FIFA_WORLD_CUP = "fifa_world_cup";

/**
 * Pre-calibration publish whitelist. Per the WC-3 contract, we hold
 * everything pre-calibration; this whitelist is the set of markets
 * we'd consider publishing once edge_pp is reasonable. Match result
 * + double chance stay off this list until in-tournament calibration
 * evidence exists. Setting empty here keeps the model holding all
 * markets and writing honest held rows — exactly the launch contract.
 */
const PRE_CALIBRATION_WHITELIST: Array<"match_result" | "double_chance" | "total" | "btts"> = [
  "total",
  "btts",
];

/** Lock window: 60 minutes before kickoff, mirroring T-60 convention. */
const LOCK_WINDOW_MINUTES = 60;

export type WriteSoccerRecordsOptions = {
  slateDate: string;
  apply: boolean;
  /**
   * Optional internal `games.id` filter. When set, the writer only
   * processes that single fixture and silently skips everything else
   * on the slate. Operator use case: surgical rerun of one game (e.g.
   * a pre-T60 fixture whose model output needs refresh) while every
   * other fixture on the slate stays untouched — including in_progress
   * games whose locked_at hasn't been stamped yet.
   */
  gameId?: number;
  /** Optional: provide pre-built providers (tests). Default: real clients. */
  providers?: {
    bdl: BallDontLieFifaProvider;
    sharp: SharpApiSoccerOddsProvider;
  };
  /** Sink for human-readable progress lines. Default no-op. */
  logger?: (msg: string) => void;
};

export type WriteSoccerRecordsResult = {
  mode: "dry-run" | "write" | "no-games";
  gamesProcessed: number;
  fixturesMatched: number;
  fixturesUnmatched: number;
  recordsCreated: number;
  recordsSkippedLocked: number;
  errors: string[];
};

type DbGame = {
  id: number;
  external_id: number;
  home_team_id: number | null;
  away_team_id: number | null;
  game_date: string;
  slate_date: string;
};

type TeamRow = { id: number; abbreviation: string };

function shouldLock(gameDateIso: string, now: Date): boolean {
  const kickoff = new Date(gameDateIso).getTime();
  const elapsedMs = kickoff - now.getTime();
  return elapsedMs <= LOCK_WINDOW_MINUTES * 60 * 1000;
}

function buildProviders(): {
  bdl: BallDontLieFifaProvider;
  sharp: SharpApiSoccerOddsProvider;
} {
  const bdlKey = process.env.BALLDONTLIE_API_KEY;
  const sharpKey = process.env.SHARPAPI_KEY;
  if (bdlKey === undefined || bdlKey === "") {
    throw new Error("BALLDONTLIE_API_KEY missing from env");
  }
  if (sharpKey === undefined || sharpKey === "") {
    throw new Error("SHARPAPI_KEY missing from env");
  }
  return {
    bdl: new BallDontLieFifaProvider(new BdlFifaClient(bdlKey)),
    sharp: new SharpApiSoccerOddsProvider(new SharpApiClient(sharpKey)),
  };
}

export async function writeSoccerPredictionRecords(
  opts: WriteSoccerRecordsOptions,
): Promise<WriteSoccerRecordsResult> {
  const log = opts.logger ?? (() => {});
  const errors: string[] = [];
  const now = new Date();

  // 1. Load internal soccer games for the slate.
  const { data: gamesData, error: gamesErr } = await supabase
    .from("games")
    .select("id, external_id, home_team_id, away_team_id, game_date, slate_date")
    .eq("sport", "soccer")
    .eq("slate_date", opts.slateDate);
  if (gamesErr !== null) throw new Error(`load soccer games: ${gamesErr.message}`);
  let games = (gamesData as DbGame[] | null) ?? [];

  // Single-game targeting (operator emergency rerun). Silently filter
  // every other fixture on the slate so in_progress / locked games stay
  // untouched even when their locked_at field is null.
  if (opts.gameId !== undefined) {
    const before = games.length;
    games = games.filter((g) => g.id === opts.gameId);
    log(`game-id filter active: ${opts.gameId} → ${games.length} of ${before} fixtures kept`);
  }

  if (games.length === 0) {
    log(`(no soccer games on slate ${opts.slateDate}${opts.gameId !== undefined ? ` matching game_id=${opts.gameId}` : ""})`);
    return {
      mode: "no-games",
      gamesProcessed: 0,
      fixturesMatched: 0,
      fixturesUnmatched: 0,
      recordsCreated: 0,
      recordsSkippedLocked: 0,
      errors,
    };
  }
  log(`Found ${games.length} soccer game(s) on slate ${opts.slateDate}`);

  // 2. Load team abbreviations for logging.
  const teamIds = new Set<number>();
  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
  }
  const { data: teamsData } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", [...teamIds]);
  const teamById = new Map<number, TeamRow>(
    ((teamsData as TeamRow[] | null) ?? []).map((t) => [t.id, t]),
  );

  // 3. Load Elo prior + initialize providers.
  const eloTable = loadDefaultEloPrior();
  log(
    `Elo prior: file=${eloTable.meta.snapshot_filename}  teams=${eloTable.meta.team_count}  ` +
      `mean=${eloTable.meta.mean_elo.toFixed(1)}  stddev=${eloTable.meta.stddev_elo.toFixed(1)}`,
  );
  const providers = opts.providers ?? buildProviders();

  // 4. Pull BDL fixtures + SharpAPI odds + splits once for the slate.
  log(`Fetching BDL FIFA tournament fixtures…`);
  const allBdlMatches = await providers.bdl.listMatches({ per_page: 25 });
  log(`  BDL total fixtures: ${allBdlMatches.length}`);

  log(`Fetching SharpAPI soccer odds…`);
  const sharpOddsRaw = await providers.sharp.listRawOdds({ maxPages: 2, limit: 200 });
  log(`  SharpAPI raw odds rows: ${sharpOddsRaw.length}`);

  const splitsResult = await providers.sharp.probeSplits();
  log(
    `  SharpAPI splits: ${splitsResult.status.classification} / ${splitsResult.status.status} ` +
      `(rows=${splitsResult.status.row_count})`,
  );

  const bdlByMatchId = new Map<number, NormalizedBdlMatch>();
  for (const m of allBdlMatches) bdlByMatchId.set(m.provider_match_id, m);

  // 5. Pre-build reconciliations for the slate's BDL matches only —
  //    reduces noise vs reconciling against the whole 104-fixture tournament.
  const slateBdlMatches: NormalizedBdlMatch[] = [];
  for (const g of games) {
    const m = bdlByMatchId.get(g.external_id);
    if (m !== undefined) slateBdlMatches.push(m);
  }
  const sharpCandidates = extractSharpEventCandidates(sharpOddsRaw);
  const reconciliations = reconcileSoccerEvents(slateBdlMatches, sharpCandidates);

  // 6. Per-game: run model → build rows → upsert with locked-row guard.
  let recordsCreated = 0;
  let recordsSkippedLocked = 0;
  let fixturesMatched = 0;
  let fixturesUnmatched = 0;

  for (const g of games) {
    const homeAbbr = g.home_team_id !== null ? teamById.get(g.home_team_id)?.abbreviation ?? "?" : "?";
    const awayAbbr = g.away_team_id !== null ? teamById.get(g.away_team_id)?.abbreviation ?? "?" : "?";
    const matchup = `${awayAbbr}@${homeAbbr}`;

    // Never rewrite a fixture once kickoff has passed. Re-running the
    // writer post-kickoff would refresh model probabilities + reset
    // locked_at, destroying the pre-game snapshot members would have
    // seen. Adapter hides post-kickoff games from the slate anyway,
    // but defense in depth: skip them here too.
    if (new Date(g.game_date).getTime() <= now.getTime()) {
      log(`  ⏭ ${matchup} game_id=${g.id}: kickoff passed (${g.game_date}) — preserving existing rows`);
      continue;
    }

    try {
      const match = bdlByMatchId.get(g.external_id);
      if (match === undefined) {
        const msg = `  ✗ ${matchup} game_id=${g.id} ext=${g.external_id}: no BDL fixture match`;
        log(msg);
        errors.push(msg);
        fixturesUnmatched += 1;
        continue;
      }

      const recon = reconciliations.find(
        (r) => r.bdl_match?.provider_match_id === match.provider_match_id,
      );
      const reconKind: ReconciliationKind = recon?.kind ?? "BDL_ONLY";
      const sharpEventId = recon?.sharp_event?.event_id ?? null;
      if (reconKind === "MATCHED") fixturesMatched += 1;
      else fixturesUnmatched += 1;

      const bdlRawOdds = await providers.bdl.listRawOdds({
        match_id: match.provider_match_id,
        per_page: 25,
      });
      const bdlNormalized = bdlRawOdds.flatMap((r) =>
        providers.bdl.normalizeOdds(r, {
          home_team: match.home_team_name,
          away_team: match.away_team_name,
        }),
      );
      const sharpNormalized = providers.sharp.normalizeOdds(
        sharpEventId !== null
          ? sharpOddsRaw.filter((r) => r.event_id === sharpEventId)
          : [],
      );
      const allOdds = [...bdlNormalized, ...sharpNormalized];
      log(
        `\n${matchup} (game_id=${g.id}, kickoff=${match.datetime}, recon=${reconKind})`,
      );
      log(
        `  normalized odds rows: BDL=${bdlNormalized.length}  SharpAPI=${sharpNormalized.length}  total=${allOdds.length}`,
      );

      if (allOdds.length === 0) {
        log(`  ⏭ no odds — skipping model + writer for this fixture`);
        continue;
      }

      const venueAltitudeMeters =
        match.stadium_country === "MEX" && match.stadium_name === "Estadio Azteca" ? 2240 : null;

      // WC-MODEL-7: opener odds (earliest line per book/selection) from
      // line_history, for line-movement awareness. Best-effort — on any
      // error we pass none and grading is unchanged.
      let openerOddsRows: NormalizedSoccerOddsRecord[] = [];
      try {
        const { data: lh } = await supabase
          .from("line_history")
          .select("market_type, side, line_value, odds_american, sportsbook, recorded_at")
          .eq("game_id", g.id)
          .in("market_type", ["match_result", "double_chance", "total", "btts"])
          .order("recorded_at", { ascending: true });
        const earliest = new Map<string, NormalizedSoccerOddsRecord>();
        for (const r of (lh ?? []) as Array<{
          market_type: string; side: string | null; line_value: number | null;
          odds_american: number | null; sportsbook: string | null; recorded_at: string;
        }>) {
          if (r.side === null || r.odds_american === null) continue;
          const key = `${r.market_type}|${r.side}|${r.line_value ?? ""}|${r.sportsbook ?? ""}`;
          if (earliest.has(key)) continue; // ascending → first seen per key is the opener
          earliest.set(key, {
            market: r.market_type as NormalizedSoccerOddsRecord["market"],
            selection: r.side as NormalizedSoccerOddsRecord["selection"],
            line: r.line_value,
            odds_american: r.odds_american,
            odds_decimal: null,
            sportsbook: r.sportsbook,
            provider: "bdl",
            provider_endpoint: "line_history_opener",
            fetched_at: r.recorded_at,
            provider_event_id: null,
          });
        }
        openerOddsRows = [...earliest.values()];
      } catch {
        openerOddsRows = [];
      }

      const modelOutput = runSoccerAutoModelV1({
        eloTable,
        match,
        oddsRows: allOdds,
        openerOddsRows,
        splitsStatus: splitsResult.status,
        reconciliation: reconKind,
        totalLine: 2.5,
        preCalibrationPublishWhitelist: PRE_CALIBRATION_WHITELIST,
        venueAltitudeMeters,
      });

      log(
        `  λ_home=${modelOutput.lambdaHome.toFixed(3)} λ_away=${modelOutput.lambdaAway.toFixed(3)} ` +
          `expected_total=${(modelOutput.lambdaHome + modelOutput.lambdaAway).toFixed(2)} ` +
          `fixture_hold=${modelOutput.fixtureHoldReason ?? "none"}`,
      );

      // Build all rows including held ones; the card needs honest held
      // rows to render the fixture with hold reasons (see WC-1 contract).
      const builtRows = buildSoccerPredictionRows({
        match,
        modelOutput,
        includeHeldRows: true,
      });
      log(`  rows produced (including held): ${builtRows.length}`);

      const isLockingNow = shouldLock(g.game_date, now);
      const lockedAtIso = isLockingNow ? now.toISOString() : null;

      // 6a. For each built row: replace BDL-keyed identifiers with the
      //     canonical internal `games.id` / `games.external_id`, then
      //     upsert with locked-row preservation.
      for (const row of builtRows) {
        const market = row.market;

        // Locked-row check first.
        const { data: existing } = await supabase
          .from("prediction_records")
          .select("id, locked_at")
          .eq("game_id", g.id)
          .eq("market", market)
          .eq("model_version", SOCCER_MODEL_VERSION)
          .eq("slate_date", g.slate_date)
          .maybeSingle();
        if (existing !== null && (existing as { locked_at: string | null }).locked_at !== null) {
          recordsSkippedLocked += 1;
          log(`  ⏭ ${market} (${row.pick}): locked row preserved`);
          continue;
        }

        const finalRow = {
          ...row,
          game_id: g.id,
          external_id: g.external_id,
          game_date: g.game_date,
          slate_date: g.slate_date,
          // T-60 lock semantic only — never inherit the snapshot's
          // capture-time stamp (which is also called `locked_at` in the
          // WC-3 snapshot builder but means "snapshot taken at"). Pre-T-60
          // rows must stay null so the route's deriveLockState can keep
          // the card refreshable.
          locked_at: lockedAtIso,
          // Competition discriminator at the row level — stamped into
          // snapshot_json so the Daily Edge route can filter
          // sport='soccer' rows by competition (WC vs future UCL vs
          // future leagues). Without this stamp every soccer row would
          // collide on the same Daily Edge tab.
          snapshot_json: {
            ...(row.snapshot_json as Record<string, unknown> | null ?? {}),
            competition: SOCCER_COMPETITION_FIFA_WORLD_CUP,
          },
        };

        if (!opts.apply) {
          log(
            `  [dry-run] ${market} pick=${row.pick}${row.line_value !== null ? `@${row.line_value}` : ""} ` +
              `grade=${row.play_grade} conf=${row.confidence?.toFixed?.(1) ?? row.confidence} ` +
              `edge_pp=${row.edge === null ? "n/a" : (row.edge as number).toFixed(2)} ` +
              `held=${row.held} no_bet=${row.no_bet} ` +
              `locked_at=${lockedAtIso ?? "null"}`,
          );
          recordsCreated += 1;
          continue;
        }

        const { error: upErr } = await supabase
          .from("prediction_records")
          .upsert(finalRow as unknown as Record<string, unknown>, {
            onConflict: "game_id,market,model_version,slate_date",
          });
        if (upErr !== null) {
          const msg = `  ✗ upsert ${matchup} ${market}: ${upErr.message}`;
          log(msg);
          errors.push(msg);
        } else {
          log(
            `  ✓ ${market} pick=${row.pick} held=${row.held} locked_at=${lockedAtIso ?? "null"}`,
          );
          recordsCreated += 1;
        }
      }
    } catch (e) {
      const msg = `  ✗ ${matchup} game ${g.id}: ${(e as Error).message}`;
      log(msg);
      errors.push(msg);
    }
  }

  return {
    mode: opts.apply ? "write" : "dry-run",
    gamesProcessed: games.length,
    fixturesMatched,
    fixturesUnmatched,
    recordsCreated,
    recordsSkippedLocked,
    errors,
  };
}
