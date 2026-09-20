/**
 * SELECT-only / provider-read-only proof for the September 19 CFB denominator repair.
 * It never writes evidence, predictions, grades, games, or lines.
 */
import { createHash } from "node:crypto";
import { supabase } from "../../lib/db/supabase";
import { CFB_TEAM_IDENTITIES } from "../../lib/services/football/cfbTeamIdentity";
import { readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { planCfbPriorResultReads } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { fetchBalldontlieNcaafResultsForDates } from "../../lib/services/football/balldontlieNcaafSlate";
import {
  cfbV1LineProbabilities,
  getCfbV1ForecastForGame,
} from "../../lib/services/football/cfbV1Decision";
import { activeCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import type { CfbForwardEvidencePayload } from "../../lib/services/football/cfbForwardEvidence";
import {
  buildCfbEspnOpeningRecoveryRecords,
  buildCfbPublishedCutoffRecoveryRecords,
} from "../../lib/services/football/cfbOfficialTrackingRecord";
import { CFB_ESPN_REFERENCE_LINE_RELEASE } from "../../lib/services/football/cfbEspnReferenceLine";
import type { PredictionRecordRow } from "../../lib/types/domain/Tracking";
import { gradePrediction } from "../../lib/services/predictionGrader";

const slateDate = process.argv[2] ?? "2026-09-19";
const season = Number.parseInt(slateDate.slice(0, 4), 10);
const markets = ["moneyline", "spread", "total"] as const;

type RecordRow = { game_id: number; external_id: number; matchup: string; market: string };
type EventTeam = { id?: string; abbreviation?: string; displayName?: string; name?: string };
type Event = {
  id?: string;
  date?: string;
  competitions?: Array<{ competitors?: Array<{ homeAway?: string; team?: EventTeam }> }>;
};
type Pickcenter = {
  provider?: { name?: string };
  pointSpread?: {
    home?: { open?: { line?: string; odds?: string } };
    away?: { open?: { line?: string; odds?: string } };
  };
  total?: {
    over?: { open?: { line?: string; odds?: string } };
    under?: { open?: { line?: string; odds?: string } };
  };
};

const ESPN_ID_OVERRIDES: Record<string, string> = {
  VAL: "2674", INST: "282", YALE: "43", HC: "107", CCSU: "2115", MTST: "147",
  PENN: "219", BUCK: "2083", SHU: "2529", ELON: "2210", NCCU: "2428", GWEB: "2241",
  CARK: "2110", SEMO: "2546", HCU: "2277", UIW: "2916",
};

function espnId(abbreviation: string): string | null {
  if (ESPN_ID_OVERRIDES[abbreviation]) return ESPN_ID_OVERRIDES[abbreviation]!;
  const identity = (CFB_TEAM_IDENTITIES as Record<string, { logoUrl?: string }>)[abbreviation];
  return identity?.logoUrl?.match(/\/(\d+)\.png$/)?.[1] ?? null;
}

function eventKey(event: Event): string | null {
  const teams = event.competitions?.[0]?.competitors ?? [];
  const away = teams.find((row) => row.homeAway === "away")?.team?.id;
  const home = teams.find((row) => row.homeAway === "home")?.team?.id;
  return away && home ? `${away}@${home}` : null;
}

function numeric(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/^PK$/i, "0").replace(/^[ou]/i, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function opening(row: Pickcenter) {
  const homeSpread = numeric(row.pointSpread?.home?.open?.line);
  const awaySpread = numeric(row.pointSpread?.away?.open?.line);
  const over = numeric(row.total?.over?.open?.line);
  const under = numeric(row.total?.under?.open?.line);
  if (homeSpread === null || awaySpread === null || over === null || under === null) return null;
  if (Math.abs(homeSpread + awaySpread) > 1e-9 || Math.abs(over - under) > 1e-9) return null;
  return { provider: row.provider?.name ?? null, homeSpread, awaySpread, total: over };
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return await response.json() as Record<string, unknown>;
}

function pmfHash(pmf: unknown): string {
  return createHash("sha256").update(JSON.stringify(pmf)).digest("hex");
}

async function main() {
  const { data: recordData, error: recordError } = await supabase
    .from("prediction_records")
    .select("game_id,external_id,matchup,market")
    .eq("sport", "cfb")
    .eq("slate_date", slateDate);
  if (recordError) throw new Error(recordError.message);
  const byGame = new Map<number, RecordRow[]>();
  for (const row of (recordData ?? []) as RecordRow[]) byGame.set(row.external_id, [...(byGame.get(row.external_id) ?? []), row]);
  const gaps = [...byGame.entries()].filter(([, rows]) => markets.some((market) => !rows.some((row) => row.market === market)));
  const externalIds = gaps.map(([externalId]) => String(externalId));

  const { data: evidenceData, error: evidenceError } = await supabase
    .from("cfb_forward_evidence_snapshots")
    .select("id,provider_game_id,captured_at,game_start_at,payload")
    .eq("evidence_release", "cfb_forward_evidence_snapshot_2026_09_19_r24_contained_spread_counter_signal")
    .in("provider_game_id", externalIds)
    .order("captured_at", { ascending: true });
  if (evidenceError) throw new Error(evidenceError.message);
  const latestByGame = new Map<string, CfbForwardEvidencePayload>();
  for (const raw of (evidenceData ?? []) as Array<{ provider_game_id: string; captured_at: string; game_start_at: string; payload: CfbForwardEvidencePayload }>) {
    if (Date.parse(raw.captured_at) > Date.parse(raw.game_start_at) - 60 * 60_000) continue;
    if (String(raw.payload.schemaRelease) !== "cfb_forward_evidence_snapshot_2026_09_19_r24_contained_spread_counter_signal") continue;
    latestByGame.set(raw.provider_game_id, raw.payload);
  }
  if (latestByGame.size !== gaps.length) throw new Error(`Expected ${gaps.length} immutable pre-cutoff payloads, found ${latestByGame.size}.`);

  const firstPayload = [...latestByGame.values()][0]!;
  const before = activeCfbWeeklyWindow(firstPayload.capturedAt).boardStartDate;
  const writerEvidence = await readCfbForwardWriterEvidence({ client: supabase, season });
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required.");
  const priorGames = [];
  let priorRequests = 0;
  for (const read of planCfbPriorResultReads({ rows: writerEvidence.metadata, before })) {
    const result = await fetchBalldontlieNcaafResultsForDates({ gameIds: read.gameIds, dates: read.dates, apiKey, pageBudget: 4 });
    priorRequests += result.providerRequests;
    priorGames.push(...result.games.filter((game) => game.homeScore !== null && game.awayScore !== null));
  }

  const yyyymmdd = slateDate.replaceAll("-", "");
  const scoreboardPayloads = await Promise.all([80, 81].map((group) =>
    fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yyyymmdd}&limit=400&groups=${group}`)));
  const events = scoreboardPayloads.flatMap((payload) => (payload.events ?? []) as Event[]);
  const eventByKey = new Map(events.map((event) => [eventKey(event), event]).filter((entry): entry is [string, Event] => entry[0] !== null));

  const recovered = [];
  const proposedRecords: PredictionRecordRow[] = [];
  for (const [externalId, rows] of gaps) {
    const payload = latestByGame.get(String(externalId))!;
    const key = `${espnId(payload.game.away.abbreviation)}@${espnId(payload.game.home.abbreviation)}`;
    const event = eventByKey.get(key);
    if (!event?.id) throw new Error(`No exact ESPN event for ${rows[0]!.matchup} (${key}).`);
    if (Math.abs(Date.parse(event.date ?? "") - Date.parse(payload.game.scheduledStart)) > 90 * 60_000) {
      throw new Error(`Kickoff mismatch for ${rows[0]!.matchup}: ESPN ${event.date ?? "missing"}, evidence ${payload.game.scheduledStart}.`);
    }
    const summary = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${event.id}`);
    const complete = ((summary.pickcenter ?? []) as Pickcenter[])
      .filter((row) => row.provider?.name === "DraftKings")
      .map(opening)
      .find((value) => value !== null) ?? null;
    if (!complete) throw new Error(`No complete ESPN opening line for ${rows[0]!.matchup}.`);

    const replay = getCfbV1ForecastForGame({ game: payload.game, completedGames: priorGames }).forecast;
    const expectedHash = payload.contextualEvidenceCapture?.prior.outcome.pmf.sha256 ?? null;
    const actualHash = pmfHash(replay.pmf);
    if (!expectedHash || actualHash !== expectedHash) throw new Error(`Immutable PMF replay mismatch for ${rows[0]!.matchup}: ${JSON.stringify({
      expectedHash,
      actualHash,
      captured: payload.contextualEvidenceCapture?.prior.outcome,
      replay: {
        expected: [replay.expectedAwayPoints, replay.expectedHomePoints],
        representative: [replay.representativeScore.away, replay.representativeScore.home],
        homeWin: replay.homeWinProbability,
        interval80: replay.interval80,
      },
    })}`);
    const existingSpread = payload.decisions.marketOutlooks?.spread ?? null;
    const existingTotal = payload.decisions.marketOutlooks?.total ?? null;
    const existingSpreadDecision = payload.decisions.evaluatedBets.find((decision) => decision.market === "spread") ?? null;
    const existingTotalDecision = payload.decisions.evaluatedBets.find((decision) => decision.market === "total") ?? null;
    const hasPublishedSpread = Boolean(existingSpread?.line !== null && existingSpread?.line !== undefined || existingSpreadDecision);
    const hasPublishedTotal = Boolean(existingTotal?.line !== null && existingTotal?.line !== undefined || existingTotalDecision);
    if ((!hasPublishedSpread || !hasPublishedTotal) &&
      payload.authoritativeForecast?.status !== "market_anchor_unavailable_hold") {
      throw new Error(`ESPN recovery for ${rows[0]!.matchup} requires an independently replayable held forecast.`);
    }
    const probabilities = cfbV1LineProbabilities({ forecast: replay, homeSpread: complete.homeSpread, totalLine: complete.total });
    const spread = probabilities.spread.home >= probabilities.spread.away
      ? { side: "home" as const, probability: probabilities.spread.home }
      : { side: "away" as const, probability: probabilities.spread.away };
    const total = probabilities.total.over >= probabilities.total.under
      ? { side: "over" as const, probability: probabilities.total.over }
      : { side: "under" as const, probability: probabilities.total.under };
    const alreadyPresent = new Set(rows.map((row) => row.market));
    const immutableRecords = buildCfbPublishedCutoffRecoveryRecords({ payload, gameId: rows[0]!.game_id })
      .filter((record) => !alreadyPresent.has(record.market));
    const immutableMarkets = new Set(immutableRecords.map((record) => record.market));
    const referenceLine = {
      release: CFB_ESPN_REFERENCE_LINE_RELEASE,
      provider: "espn" as const,
      sportsbook: "DraftKings" as const,
      providerEventId: event.id,
      capturedAt: new Date().toISOString(),
      lineType: "opening" as const,
      homeSpread: complete.homeSpread,
      awaySpread: complete.awaySpread,
      total: complete.total,
    };
    const espnRecords = hasPublishedSpread && hasPublishedTotal ? [] : buildCfbEspnOpeningRecoveryRecords({
      payload,
      gameId: rows[0]!.game_id,
      referenceLine,
      replayForecast: replay,
    }).filter((record) => !alreadyPresent.has(record.market) && !immutableMarkets.has(record.market));
    proposedRecords.push(...immutableRecords, ...espnRecords);
    recovered.push({
      externalId,
      matchup: rows[0]!.matchup,
      evidenceCapturedAt: payload.capturedAt,
      pmfSha256: actualHash,
      espnEventId: event.id,
      sportsbook: complete.provider,
      opening: { spread: complete.homeSpread, total: complete.total },
      source: hasPublishedSpread && hasPublishedTotal
        ? "immutable_published_prediction"
        : "espn_opening_line_independent_pmf_replay",
      spread: existingSpread?.line !== null && existingSpread?.line !== undefined ? {
        side: existingSpread.side,
        line: existingSpread.line,
        probability: existingSpread.independentProbability,
      } : existingSpreadDecision ? {
        side: existingSpreadDecision.side.startsWith(payload.game.home.abbreviation) ? "home" : "away",
        line: existingSpreadDecision.evaluatedQuote.line!,
        probability: existingSpreadDecision.modelProbability,
      } : {
        side: spread.side,
        line: spread.side === "home" ? complete.homeSpread : complete.awaySpread,
        probability: spread.probability,
      },
      total: existingTotal?.line !== null && existingTotal?.line !== undefined
        ? { side: existingTotal.side, line: existingTotal.line, probability: existingTotal.independentProbability }
        : existingTotalDecision
          ? { side: existingTotalDecision.side.startsWith("Over") ? "over" : "under", line: existingTotalDecision.evaluatedQuote.line!, probability: existingTotalDecision.modelProbability }
        : { side: total.side, line: complete.total, probability: total.probability },
    });
  }

  const recoveryGameIds = [...new Set(proposedRecords.map((record) => record.game_id).filter((value): value is number => typeof value === "number"))];
  const { data: recoveryGameData, error: recoveryGameError } = await supabase
    .from("games")
    .select("id,status,home_score,away_score,first_inning_runs")
    .in("id", recoveryGameIds);
  if (recoveryGameError) throw new Error(recoveryGameError.message);
  const recoveryGames = new Map(((recoveryGameData ?? []) as Array<{ id: number; status: string; home_score: number | null; away_score: number | null; first_inning_runs: number | null }>).map((game) => [game.id, game]));
  const recoveredGrades = proposedRecords.map((record) => {
    const game = recoveryGames.get(record.game_id!);
    if (!game) throw new Error(`Missing recovery game ${record.game_id}.`);
    return { record, grade: gradePrediction({ record, game, source: "auto_score_ingest" }) };
  });
  const gradeTally = (market: "spread" | "total") => Object.fromEntries(["win", "loss", "push", "void", "pending"].map((result) => [
    result,
    recoveredGrades.filter((row) => row.record.market === market && row.grade.result === result).length,
  ]));

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    slateDate,
    existingRecords: (recordData ?? []).length,
    games: byGame.size,
    missingGames: gaps.length,
    missingRecords: gaps.reduce((sum, [, rows]) => sum + markets.filter((market) => !rows.some((row) => row.market === market)).length, 0),
    immutableReplayMatches: recovered.length,
    exactEspnOpeningMatches: recovered.length,
    immutablePublishedPredictionGames: recovered.filter((row) => row.source === "immutable_published_prediction").length,
    espnOpeningReplayGames: recovered.filter((row) => row.source === "espn_opening_line_independent_pmf_replay").length,
    priorResultRequests: priorRequests,
    proposedRecoveryRecords: proposedRecords.length,
    proposedRecoveryMarkets: Object.fromEntries(markets.map((market) => [market, proposedRecords.filter((row) => row.market === market).length])),
    proposedRecoverySources: Object.fromEntries([...new Set(proposedRecords.map((row) => row.prediction_source))].map((source) => [source, proposedRecords.filter((row) => row.prediction_source === source).length])),
    proposedRecoveryDuplicateKeys: proposedRecords.length - new Set(proposedRecords.map((row) => `${row.external_id}:${row.market}`)).size,
    proposedRecoveryEconomicViolations: proposedRecords.filter((row) => row.odds_american !== null || row.market_probability !== null || row.edge !== null || row.expected_value !== null || row.best_angle || !row.no_bet).length,
    proposedRecoveryGrades: { spread: gradeTally("spread"), total: gradeTally("total") },
    recovered,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
