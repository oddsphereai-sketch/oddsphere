/** Offline, outcome-blind, zero-provider/zero-write replay of captured decisions.
 * Usage: node --import tsx scripts/operator/audit-confidence-led-market-grades.ts
 * --boards=/absolute/boards.json --nba=/absolute/records.json
 * --cbb=/absolute/member-games.json --date=2026-11-06 --out=/absolute/report.json */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gradeNbaMarket, gradeNbaR28MarketForAudit, type GradeInput } from "../../lib/services/nba/nbaMarketReview";
import { pairedNbaOpposingPrice, type NbaLineRow } from "../../lib/services/nba/nbaMarketIntelligence";
import { readCbbContextualOutcomeEvidence, type CbbReleasedOutcomeBoard } from "../../lib/services/cbb/cbbContextualOutcomeRuntime";
import { buildCbbInterpretedDecision } from "../../lib/cbb/contextualInterpretedDecision";

const flag = (key: string) => process.argv.find(x => x.startsWith(`--${key}=`))?.slice(key.length + 3);
const load = (key: string) => JSON.parse(readFileSync(flag(key) ?? (() => { throw Error(`--${key}= is required`); })(), "utf8"));
const date = flag("date") ?? "2026-11-06";
const boards = load("boards"), nba = load("nba"), cbb = load("cbb");
const originalNba = JSON.stringify(nba), originalCbb = JSON.stringify(cbb);
const et = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const today = (g: any) => typeof g.gameStartAt === "string" && Number.isFinite(Date.parse(g.gameStartAt)) && et.format(new Date(g.gameStartAt)) === date;
const count = (values: string[]) => values.reduce<Record<string, number>>((out, key) => (out[key] = (out[key] ?? 0) + 1, out), {});
const active = (grade: string) => ["lean", "best_angle", "Lean", "Best Angle"].includes(grade);
const sameNumber = (a: number | null, b: number | null) => a === b || a !== null && b !== null && Math.abs(a - b) < 1e-10;
const coverage = Object.fromEntries(Object.entries(boards.boards as Record<string, any>).map(([sport, board]) => {
  const games = (board.games ?? []).filter(today);
  const markets = games.flatMap((g: any) => Object.values(g.markets).filter(Boolean));
  return [sport, { games: games.length, markets: markets.length, asOf: board.as_of,
    grades: count(markets.map((m: any) => m.verdict?.key ?? m.verdict)),
    priced: markets.filter((m: any) => Number.isFinite(m.priceAmerican)).length,
    missingPrice: markets.filter((m: any) => !Number.isFinite(m.priceAmerican)).length }];
}));

const nbaRows: any[] = [], seen = new Set<number>();
for (const stored of nba) {
  if (stored.locked_at !== null || seen.has(stored.game_id)) continue;
  seen.add(stored.game_id);
  const g = stored.snapshot_json.nba_game_dto_at_capture;
  for (const slot of ["ml", "spread", "total"] as const) {
    const m = g.intelligence[slot], market = m.market;
    const selectedLine = market === "moneyline" ? null : m.consensus_line;
    const prices: NbaLineRow[] = [...m.per_book_pick_side, ...m.per_book_other_side].map((r: any) => ({ ...r, market_type: market }));
    const selected = prices.find(r => r.sportsbook === m.current_price.sportsbook && r.side === m.pick_side &&
      r.odds_american === m.current_price.odds_american && r.line_value === selectedLine &&
      Date.parse(r.fetched_at ?? "") === Date.parse(m.current_price.fetched_at));
    const input: GradeInput = { market, pick: m.pick_side, confidence: m.model_confidence, band: m.conflict_band,
      edge: market === "moneyline" ? (m.edge_prob_pp ?? 0) / 100 : (m.edge_points ?? 0) / (market === "spread" ? 10 : 15),
      dataQualityTier: g.data_quality_tier, injuriesKnown: g.injuries.home_known && g.injuries.away_known,
      modelProbabilityOnPick: m.model_prob_on_pick, currentPriceAmerican: m.current_price.odds_american,
      pairedOpposingPriceAmerican: pairedNbaOpposingPrice(prices, selected ?? null), namedBookPosture: m.named_book_posture };
    const previous = gradeNbaR28MarketForAudit(input), next = gradeNbaMarket(input);
    assert.equal(previous.grade, m.grade, `${g.matchup}/${market}: frozen R28 reproduction failed`);
    nbaRows.push({ gameId: g.game_external_id, matchup: g.matchup, market, previous: previous.grade, next: next.grade,
      probability: m.model_prob_on_pick, price: m.current_price.odds_american, opposingPrice: input.pairedOpposingPriceAmerican,
      expectedValue: m.model_prob_on_pick * (input.currentPriceAmerican! > 0 ? input.currentPriceAmerican! / 100 : 100 / -input.currentPriceAmerican!) - (1 - m.model_prob_on_pick),
      qualificationBasis: next.qualificationBasis ?? "existing_value_and_evidence_policy", rationale: next.rationale });
  }
}

const decoded: Array<{stored:any;read:NonNullable<ReturnType<typeof readCbbContextualOutcomeEvidence>>}> = cbb.filter((r: any) => r.payload.snapshot.lockedAt === null &&
  r.payload.snapshot.board.marketContext?.contextualOutcomeEvidence).map((r: any) => ({ stored: r,
    read: readCbbContextualOutcomeEvidence(r.payload.snapshot.board as CbbReleasedOutcomeBoard)! }));
const sampleCounts = new Map<string, number>();
for (const { read } of decoded) for (const row of read.decision.marketDecisions) if (row.recommendationRisk) {
  const key = read.decision.artifact.objectSha256, n = row.recommendationRisk.context.calibrationGames;
  assert(!sampleCounts.has(key) || sampleCounts.get(key) === n, "same artifact has different calibration-game counts");
  sampleCounts.set(key, n);
}
const cbbRows: any[] = [];
const gradingStarted=performance.now();
for (const { stored, read } of decoded) {
  const d = read.decision, cal = d.calibration.parameters, f = d.workingForecast;
  const n = sampleCounts.get(d.artifact.objectSha256);
  assert(n, "calibration-game count is unavailable from this exact captured artifact");
  const storedRisk=d.marketDecisions.find(row=>row.recommendationRisk)?.recommendationRisk?.context;
  const totalComponents=f.total.varianceComponents as {sourceLocation?:number;trendPosterior?:number;functionPosterior:number};
  const totalLocationVariance=totalComponents.trendPosterior??totalComponents.sourceLocation;
  assert(typeof totalLocationVariance==="number"&&Number.isFinite(totalLocationVariance));
  const risk = storedRisk??{ calibrationGames: n, marginLocationSd: Math.sqrt(f.margin.varianceComponents.sourceLocation + f.margin.varianceComponents.functionPosterior) * Math.exp(cal.logMarginScale),
    totalLocationSd: Math.sqrt(totalLocationVariance + totalComponents.functionPosterior) * Math.exp(cal.logTotalScale) };
  const next = buildCbbInterpretedDecision({ input: read.input, interpretation: d.interpretation,
    latent: d.numericalTrace.finalLatentDistribution, targets: d.marketDecisions.flatMap(r => r.target ? [r.target] : []), recommendationRisk: risk });
  for (const key of ["home", "away", "margin", "total", "homeWinProbability"] as const)
    assert(sameNumber(next.finalScore[key], d.finalScore[key]), `score changed ${d.gameId}/${key}`);
  for (const row of next.marketDecisions) {
    const old = d.marketDecisions.find(x => x.market === row.market)!;
    assert.equal(row.selection, old.selection, `side changed ${d.gameId}/${row.market}`);
    for (const key of ["probability", "loseProbability", "pushProbability", "price", "expectedValue"] as const)
      assert(sameNumber(row[key], old[key]), `${key} changed ${d.gameId}/${row.market}`);
    cbbRows.push({ gameId: d.gameId, matchup: `${stored.payload.memberGame.awayTeam}@${stored.payload.memberGame.homeTeam}`,
      market: row.market, previous: old.grade, next: row.grade, probability: row.probability, price: row.price,
      expectedValue: row.expectedValue, recommendationBasis: row.recommendationBasis ?? null,
      reason: row.reason, confidenceAssessment: row.confidenceLeanAssessment ?? null });
  }
}
assert.equal(JSON.stringify(nba), originalNba, "NBA stored payload was mutated");
assert.equal(JSON.stringify(cbb), originalCbb, "CBB stored payload was mutated");
const impact = (rows: any[]) => ({ markets: rows.length, before: count(rows.map(r => r.previous)), after: count(rows.map(r => r.next)),
  promotions: rows.filter(r => !active(r.previous) && active(r.next)).length,
  demotions: rows.filter(r => active(r.previous) && !active(r.next)).length,
  changes: rows.filter(r => r.previous !== r.next),
  byMarket: Object.fromEntries(["moneyline", "spread", "total"].map(m => [m, { before: count(rows.filter(r => r.market === m).map(r => r.previous)), after: count(rows.filter(r => r.market === m).map(r => r.next)) }])) });
const report = { generatedAt: new Date().toISOString(), date, productionWrites: 0, providerCalls: 0, fits: 0,
  cbbGradingMs:Math.round(performance.now()-gradingStarted),
  replaySourceClocks:{nba:[...new Set(nba.map((r:any)=>r.snapshot_json.as_of))],cbb:[...new Set(decoded.map(({stored})=>stored.payload.snapshot.capturedAt))]},
  startingBase: "b77b1ed087765f7f9b5ce9ec323c0517d00b5408", coverage,
  nba: impact(nbaRows), cbb: impact(cbbRows), unchanged: ["score", "selected_side", "probability", "push", "price", "nominal_expected_value", "stored_payloads"],
  inputHashes: { nba: createHash("sha256").update(originalNba).digest("hex"), cbb: createHash("sha256").update(originalCbb).digest("hex") },
  limits: "Functional, outcome-blind policy replay; no claim of improved future hit rate. Already locked records are excluded from regrading." };
if (flag("out")) writeFileSync(flag("out")!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
