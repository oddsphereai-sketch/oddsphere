import { createHash } from "node:crypto";
import type { DailyEdgeGameDto, DailyEdgeResponse, MarketEdgeDto } from "../../app/lab/lib/labTypes";
import { CurrentSoccerMarketProvider } from "../../lib/providers/real_api/CurrentSoccerMarketProvider";
import type { EplSharpFixtureMarket } from "../../lib/providers/real_api/SharpApiEplMarketProvider";
import {
  buildEplDailyEdgePreview,
  hydrateEplPriceHistory,
  hydrateEplStoredPriceHistory,
  type EplMarketProvider,
} from "../../lib/services/epl/buildEplDailyEdgePreview";
import { buildEplShadowSlate } from "../../lib/services/epl/buildEplShadowSlate";
import { readEplStoredPriceHistory } from "../../lib/services/epl/eplLineHistoryStore";
import { readCurrentEplMemberSnapshot } from "../../lib/services/epl/eplMemberSnapshotStore";
import { deriveEplMatchResultDecision, deriveEplPreviewGrade } from "../../lib/services/epl/eplPreviewGrade";
import { selectEplMatchResultSide } from "../../lib/services/epl/eplShadowModel";
import { deriveEplR23IncumbentOutcome, EPL_R23_INCUMBENT_OUTCOME_RELEASE } from "./epl-r23-incumbent-outcome";

const INCUMBENT = {
  model: "epl_goals_coherent_2026_10_31_r23_partial_price_publication",
  outcome: EPL_R23_INCUMBENT_OUTCOME_RELEASE,
  grade: "epl_grade_policy_2026_10_31_v28_partial_price_publication",
} as const;
const CANDIDATE = {
  model: "epl_goals_coherent_2026_11_04_r24_relative_path_joint_pmf",
  outcome: "epl_coherent_market_outcome_2026_11_04_r4_relative_path_joint_pmf",
  grade: "epl_grade_policy_2026_11_04_v29_relative_path_joint_pmf",
} as const;
const gradeRank: Record<string, number> = { Held: 0, "No Play": 1, Caution: 1, Watchlist: 2, Lean: 3, "Best Angle": 4 };
const actionable = (grade: string) => grade === "Lean" || grade === "Best Angle";
const stable = (value: unknown) => JSON.stringify(value, (_, entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry);
const fixtureKey = (fixture: { home: string; away: string; kickoff: string; providerId?: number }) =>
  `${fixture.providerId ?? "none"}:${fixture.kickoff}:${fixture.away}@${fixture.home}`;

class OnePassRecordingProvider implements EplMarketProvider {
  readonly records = new Map<string, EplSharpFixtureMarket>();
  logicalLoads = 0;
  constructor(readonly source: CurrentSoccerMarketProvider) {}
  async loadFixture(fixture: { home: string; away: string; kickoff: string; providerId?: number }): Promise<EplSharpFixtureMarket> {
    this.logicalLoads += 1;
    const market = await this.source.loadFixture(fixture).catch(() => ({ eventId: null, odds: [], splits: [], splitsState: "error" as const }));
    this.records.set(fixtureKey(fixture), structuredClone(market));
    return structuredClone(market);
  }
}
class ExactReplayProvider implements EplMarketProvider {
  logicalLoads = 0;
  constructor(readonly records: ReadonlyMap<string, EplSharpFixtureMarket>) {}
  async loadFixture(fixture: { home: string; away: string; kickoff: string; providerId?: number }): Promise<EplSharpFixtureMarket> {
    this.logicalLoads += 1;
    const market = this.records.get(fixtureKey(fixture));
    if (!market) throw new Error(`Missing captured EPL fixture input: ${fixtureKey(fixture)}`);
    return structuredClone(market);
  }
}

type MarketName = "match_result" | "double_chance" | "total" | "btts";
const marketAt = (game: DailyEdgeGameDto, market: MarketName): MarketEdgeDto | null => market === "match_result"
  ? game.markets.moneyline : market === "double_chance" ? game.soccerDoubleChanceMarket ?? null
    : market === "total" ? game.markets.total : game.markets.first_inning;
function role(market: MarketName, value: MarketEdgeDto): "favorite" | "draw" | "underdog" | "unavailable" | "not_applicable" {
  if (market !== "match_result") return "not_applicable";
  const rows = value.soccerPriceBoard?.rows ?? [], selected = rows.find(row => row.selected);
  if (!selected) return "unavailable";
  if (selected.side === "draw") return "draw";
  const probabilities = rows.map(row => row.market_probability).filter((probability): probability is number =>
    typeof probability === "number" && Number.isFinite(probability));
  return probabilities.length === rows.length && selected.market_probability === Math.max(...probabilities) ? "favorite" : "underdog";
}
const gameMap = (response: DailyEdgeResponse) => new Map(response.games.map(game => [Number(game.external_id), game]));

async function main() {
  process.env.EPL_FOUNDATION_CACHE_WRITES_ENABLED = "false";
  const decisionAt = new Date().toISOString();
  const slate = await buildEplShadowSlate();
  const providerIds = slate.matches.map(match => match.id);
  const [storedPriceHistory, storedMemberSnapshot] = await Promise.all([
    readEplStoredPriceHistory(providerIds),
    readCurrentEplMemberSnapshot(),
  ]);
  hydrateEplPriceHistory(storedMemberSnapshot);
  hydrateEplStoredPriceHistory(storedPriceHistory);
  const source = new CurrentSoccerMarketProvider({ competition: "epl", owlsApiKey: process.env.OWLS_INSIGHT_API_KEY,
    theOddsApiKey: process.env.THE_ODDS_API_KEY, storedPriceHistory });
  const recorder = new OnePassRecordingProvider(source);
  const candidate = await buildEplDailyEdgePreview(slate, { marketProvider: recorder, storedPriceHistory,
    cacheNamespace: "epl-release-impact-candidate", cacheIdentity: decisionAt, auditDecisionAt: decisionAt,
    skipForwardEvidence: true });
  const replay = new ExactReplayProvider(recorder.records);
  const incumbent = await buildEplDailyEdgePreview(slate, { marketProvider: replay, storedPriceHistory,
    cacheNamespace: "epl-release-impact-incumbent", cacheIdentity: decisionAt, auditDecisionAt: decisionAt,
    skipForwardEvidence: true, authorities: {
      gradeRelease: INCUMBENT.grade,
      deriveCoherentOutcome: deriveEplR23IncumbentOutcome,
      deriveMatchResultDecision: deriveEplMatchResultDecision,
      derivePreviewGrade: deriveEplPreviewGrade,
      selectMatchResultSide: selectEplMatchResultSide,
    } });
  const oldGames = gameMap(incumbent), newGames = gameMap(candidate);
  const changes: Array<Record<string, unknown>> = [];
  const allRows: Array<Record<string, unknown>> = [];
  let promotions = 0, demotions = 0, removals = 0, sideChanges = 0, probabilityChanges = 0, scoreChanges = 0;
  let incumbentActionables = 0, candidateActionables = 0;
  for (const match of slate.matches) {
    const beforeGame = oldGames.get(match.id), afterGame = newGames.get(match.id);
    if (!beforeGame || !afterGame) throw new Error(`Release comparison missing game ${match.id}`);
    const beforeScore = beforeGame.projected, afterScore = afterGame.projected;
    const incumbentSource = beforeGame.soccerModelProvenance?.source ?? null;
    const candidateSource = afterGame.soccerModelProvenance?.source ?? null;
    const candidateAppliedMarkets = ((afterGame.soccerModelProvenance?.goalsReader as { relativeMarketReader?: { appliedMarkets?: string[] } } | undefined)
      ?.relativeMarketReader?.appliedMarkets ?? []);
    const scoreChanged = Math.abs(beforeScore.home - afterScore.home) > 1e-9 || Math.abs(beforeScore.away - afterScore.away) > 1e-9;
    if (scoreChanged) scoreChanges += 1;
    for (const market of ["match_result", "double_chance", "total", "btts"] as const) {
      const before = marketAt(beforeGame, market), after = marketAt(afterGame, market);
      if (!before || !after) throw new Error(`Release comparison missing ${market} for ${match.id}`);
      const beforeGrade = before.verdict.label, afterGrade = after.verdict.label;
      const promoted = (gradeRank[afterGrade] ?? 0) > (gradeRank[beforeGrade] ?? 0);
      const demoted = (gradeRank[afterGrade] ?? 0) < (gradeRank[beforeGrade] ?? 0);
      const removed = actionable(beforeGrade) && !actionable(afterGrade);
      const sideChanged = before.pick !== after.pick;
      const probabilityChanged = before.modelProb !== null && after.modelProb !== null && Math.abs(before.modelProb - after.modelProb) > 1e-9;
      promotions += Number(promoted); demotions += Number(demoted); removals += Number(removed);
      sideChanges += Number(sideChanged); probabilityChanges += Number(probabilityChanged);
      incumbentActionables += Number(actionable(beforeGrade)); candidateActionables += Number(actionable(afterGrade));
      const row = { gameId: match.id, game: `${match.awayTeam.abbreviation}@${match.homeTeam.abbreviation}`, kickoff: match.kickoff,
        market, roleBefore: role(market, before), roleAfter: role(market, after), sideBefore: before.pick, sideAfter: after.pick,
        probabilityBefore: before.modelProb, probabilityAfter: after.modelProb, gradeBefore: beforeGrade, gradeAfter: afterGrade,
        scoreBefore: beforeScore, scoreAfter: afterScore, incumbentSource, candidateSource, candidateAppliedMarkets,
        promoted, demoted, removed, sideChanged, probabilityChanged, scoreChanged };
      allRows.push(row);
      if (promoted || demoted || sideChanged || probabilityChanged || scoreChanged) changes.push(row);
    }
  }
  const fixtureInputs = [...recorder.records.entries()].sort(([left], [right]) => left.localeCompare(right));
  const inputFingerprint = createHash("sha256").update(stable({ decisionAt, slate: slate.matches.map(match => ({ id: match.id,
    kickoff: match.kickoff, prediction: match.prediction })), storedPriceHistory, fixtureInputs })).digest("hex");
  const report = { mode: "read_only_same_input_release_comparison", decisionAt, inputFingerprint,
    incumbent: INCUMBENT, candidate: CANDIDATE, fixtures: slate.matches.length, markets: allRows.length,
    inputUse: { slateBuilds: 1, storedHistoryReads: 1, memberSnapshotReads: 1, uniqueFixtureInputs: recorder.records.size,
      candidateLogicalLoads: recorder.logicalLoads, replayLogicalLoads: replay.logicalLoads, providerTelemetry: source.telemetry(), writes: 0 },
    impact: { promotions, demotions, removals, sideChanges, probabilityChanges, scoreChanges,
      actionablesBefore: incumbentActionables, actionablesAfter: candidateActionables,
      netActionables: candidateActionables - incumbentActionables }, changes, rows: allRows };
  const compact = process.argv.includes("--compact");
  console.log(JSON.stringify(compact ? { ...report,
    changes: changes.filter(row => row.promoted || row.demoted || row.removed || row.sideChanged), rows: undefined } : report, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
