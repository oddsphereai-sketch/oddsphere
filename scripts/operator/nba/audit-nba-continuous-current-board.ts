/** Bounded SELECT-only, outcome-free current unlocked decision-stage rehearsal.
 * Keeps each stored independent forecast/quality/caps and executable board;
 * never refits, refreshes a provider, writes predictions or regrades locks.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { NBA_PROFESSIONAL_MODEL_ARTIFACT as artifact } from "../../../lib/automodel/nba/nbaProfessionalRuntimeArtifacts";
import { V1_CONFIDENCE_CEILING } from "../../../lib/automodel/nba/nbaFeatureWeights";
import type { NbaModelV1Output } from "../../../lib/automodel/nba/nbaAutoModelV2";
import type { NbaGameSnapshot } from "../../../lib/automodel/nba/types";
import type { NbaDailyEdgeGameDto } from "../../../lib/services/nba/buildNbaDailyEdgeDto";
import { buildNbaGameIntelligence, type NbaLineRow } from "../../../lib/services/nba/nbaMarketIntelligence";
import { buildNbaProfessionalCandidate, applyNbaProfessionalCandidate } from "../../../lib/services/nba/nbaProfessionalCandidate";
import { buildNbaProfessionalMarketReader, type NbaReaderPriceRow, type NbaReaderSplitRow } from "../../../lib/services/nba/nbaProfessionalMarketReader";
import { resolveNbaExecutionFixedPoint } from "../../../lib/services/nba/nbaMarketExecution";

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const date = flag("date"), output = flag("output");
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !output?.startsWith("/private/tmp/")) throw new Error("Pass --date=YYYY-MM-DD --output=/private/tmp/new-receipt.json");
let requests = 0, bytes = 0;
async function get<T>(table: string, query: Record<string, string>): Promise<T[]> {
  if (++requests > 64) throw new Error("Read budget exceeded");
  const url = new URL(`/rest/v1/${table}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.search = new URLSearchParams(query).toString();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing configured read credential");
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${table}: HTTP${response.status}`);
  const encoded = await response.text(); bytes += Buffer.byteLength(encoded);
  if (bytes > 12 * 1024 ** 2) throw new Error("Read byte budget exceeded");
  return JSON.parse(encoded) as T[];
}
async function paged<T>(table: string, query: Record<string, string>, budget: number): Promise<T[]> {
  const all: (T & { id: number })[] = [];
  let cursor = 0;
  while (true) {
    const page = await get<T & { id: number }>(table, { ...query, select: `id,${query.select}`, id: `gt.${cursor}`, order: "id.asc", limit: "1000" });
    if (page.some((row, i) => !Number.isInteger(row.id) || row.id <= (i ? page[i - 1]!.id : cursor))) throw new Error("Observation pagination identity/order invalid");
    all.push(...page);
    if (all.length > budget) throw new Error("Observation chronology budget exceeded; refusing truncation");
    if (page.length < 1000) return all;
    cursor = page.at(-1)!.id;
  }
}
async function main() {
  const now = new Date().toISOString();
  const records = await get<{ id: number; game_id: number; model_version: string; as_of: string; game: NbaDailyEdgeGameDto }>("prediction_records", {
    select: "id,game_id,model_version,as_of:snapshot_json->>as_of,game:snapshot_json->nba_game_dto_at_capture",
    sport: "eq.nba", market: "eq.moneyline", slate_date: `eq.${date}`, locked_at: "is.null", order: "id.asc", limit: "13",
  });
  if (records.length > 12 || new Set(records.map(r => r.game_id)).size !== records.length) throw new Error("Board budget/identity exceeded");
  const source: unknown[] = [], comparisons = [];
  for (const record of records) {
    const g = record.game;
    if (!g || !g.tip_iso_utc || Date.parse(g.tip_iso_utc) <= Date.parse(now)) continue;
    const a = g.grounding_audit as { independent_projection?: { home_score: number; away_score: number; margin_home: number; total: number }; market_reader?: { evaluatedAt: string } };
    if (!a?.independent_projection || !a.market_reader || !record.as_of) throw new Error(`Missing exact stored independent-stage receipt: ${record.id}`);
    const prices = await paged<{ provider: string; provider_event_id: string; ingestion_run_id: string; sportsbook: string; market_type: string;
      selection_key: string; american_price: number | null; line: number | null; provider_timestamp: string | null; fetched_at: string }>("market_price_observations_v2", {
      select: "provider,provider_event_id,ingestion_run_id,sportsbook,market_type,selection_key,american_price,line,provider_timestamp,fetched_at",
      league: "eq.nba", canonical_event_id: `eq.${g.game_external_id}`, provider: "in.(owls,canonical_lines)",
      fetched_at: `gte.${new Date(Date.parse(record.as_of) - 12 * 3600000).toISOString()}`, order: "id.asc", limit: "3001",
    }, 6000);
    if (prices.length > 3000) throw new Error("Price chronology requires a declared larger audit, not silent truncation");
    const splits = await paged<{ provider: string; source_book: string; source_type: string; market_type: string; selection_key: string;
      bets_pct: number | null; money_pct: number | null; market_line: number | null; source_observed_at: string | null; fetched_at: string }>("market_split_observations_v2", {
      select: "provider,source_book,source_type,market_type,selection_key,bets_pct,money_pct,market_line,source_observed_at,fetched_at",
      league: "eq.nba", canonical_event_id: `eq.${g.game_external_id}`, fetched_at: `gte.${record.as_of}`, order: "id.asc", limit: "1001",
    }, 2000);
    if (splits.length > 1000) throw new Error("Split chronology budget exceeded");
    source.push({ record, prices, splits });
    const priceRows: NbaReaderPriceRow[] = prices.map(p => ({ provider: p.provider, providerEventId: p.provider_event_id, ingestionRunId: p.ingestion_run_id,
      sportsbook: p.sportsbook, sharpBook: ["circa", "pinnacle", "bookmaker"].includes(p.sportsbook), market: p.market_type as "moneyline" | "spread" | "total",
      selectionKey: p.selection_key, americanPrice: p.american_price, line: p.line, providerTimestamp: p.provider_timestamp, fetchedAt: p.fetched_at }));
    const splitRows: NbaReaderSplitRow[] = splits.map(p => ({ provider: p.provider, sourceBook: p.source_book, sourceType: p.source_type,
      market: p.market_type as "moneyline" | "spread" | "total", selectionKey: p.selection_key, betsPct: p.bets_pct, moneyPct: p.money_pct,
      marketLine: p.market_line, sourceObservedAt: p.source_observed_at, fetchedAt: p.fetched_at }));
    const lines: NbaLineRow[] = (["ml", "spread", "total"] as const).flatMap(m => [...g.intelligence[m].per_book_pick_side, ...g.intelligence[m].per_book_other_side]
      .map(p => ({ ...p, market_type: m === "ml" ? "moneyline" : m })));
    const independent = { homeScore: a.independent_projection.home_score, awayScore: a.independent_projection.away_score,
      marginHome: a.independent_projection.margin_home, total: a.independent_projection.total };
    const args = { artifact, featureRow: {}, lines, history: [], externalGameId: g.game_external_id, independentOverride: independent };
    const context = { eventId: String(g.game_external_id), inputFingerprint: `stored:${record.id}:${record.as_of}`, evaluatedAt: record.as_of,
      priceRows, splitRows, pricesTrusted: true, splitsTrusted: true };
    const seeded = buildNbaProfessionalCandidate({ ...args, marketContext: context });
    const snapshot = { game_external_id: g.game_external_id, home_team: { abbreviation: g.home_abbr }, away_team: { abbreviation: g.away_abbr },
      data_quality: { home_injuries_known: g.injuries.home_known, away_injuries_known: g.injuries.away_known } } as NbaGameSnapshot;
    const baseline = { audit: { data_quality_tier: g.data_quality_tier, confidence_ceiling: V1_CONFIDENCE_CEILING[g.data_quality_tier], model_integrity_notes: [] },
      v1_breakdown: { applied_caps: g.admin_model_badge?.applied_caps ?? [], notes: [], injury_review: { major_out_count: 0, major_unknown_count: 0, reasons: [] } } } as unknown as NbaModelV1Output;
    const intelligence = (c: ReturnType<typeof buildNbaProfessionalCandidate>, legacyGradePolicyAudit = false) => buildNbaGameIntelligence({ snapshot,
      prediction: applyNbaProfessionalCandidate({ baseline, candidate: c }), lines, splitsRow: null, opportunities: [], injuriesSource: "none", legacyGradePolicyAudit });
    const executionBooks = (c: ReturnType<typeof buildNbaProfessionalCandidate>) => {
      const intel = intelligence(c);
      return { moneyline: intel.ml.current_price.sportsbook ? [intel.ml.current_price.sportsbook] : [],
        spread: intel.spread.current_price.sportsbook ? [intel.spread.current_price.sportsbook] : [], total: intel.total.current_price.sportsbook ? [intel.total.current_price.sportsbook] : [] };
    };
    const resolved = resolveNbaExecutionFixedPoint({ initial: seeded, executionBooks, evaluate: (excludedSportsbooksByMarket, disabledMarkets) => {
      const reader = buildNbaProfessionalMarketReader({ evaluatedAt: now, priceRows, splitRows, excludedSportsbooksByMarket,
        selectedLines: { spreadHome: seeded.consensus.spreadHome, total: seeded.consensus.totalLine } });
      return buildNbaProfessionalCandidate({ ...args, marketReader: reader, marketContext: { ...context, evaluatedAt: now,
        previousState: seeded.marketConsequence!.state, excludedSportsbooksByMarket, disabledMarkets } });
    } });
    const candidate = resolved.candidate, intel = intelligence(candidate);
    // Same final forecast and evidence, ONLY grade-policy selection differs.
    // This identifies a grading change; it is not historical accuracy proof.
    const legacyGradeAtFinal = intelligence(candidate, true);
    const continuousGradeAtIndependent = intelligence(buildNbaProfessionalCandidate(args));
    comparisons.push({ event: g.game_external_id, matchup: g.matchup, incumbentRelease: record.model_version, epoch: record.as_of,
      priorProjection: g.projection, candidateProjection: candidate.final, consequence: candidate.marketConsequence,
      markets: (["ml", "spread", "total"] as const).map(m => ({ market: m, before: { pick: g.intelligence[m].pick_side, grade: g.intelligence[m].grade },
        after: { pick: intel[m].pick_side, grade: intel[m].grade, probability: intel[m].model_prob_on_pick, book: intel[m].current_price.sportsbook },
        attribution: { incumbentPolicyAtFinalForecast: legacyGradeAtFinal[m].grade,
          continuousPolicyAtIndependentForecast: continuousGradeAtIndependent[m].grade,
          sameForecastGradePolicyChanges: legacyGradeAtFinal[m].grade !== intel[m].grade,
          newMarketEffect: m === "total" ? candidate.marketConsequence?.totalApplied : candidate.marketConsequence?.marginApplied,
          candidateRationale: intel[m].rationale,
          priorProjectionDiffers: m === "total" ? Math.abs(g.projection.total - candidate.final.total) > 1e-9
            : Math.abs(g.projection.spread_home - candidate.final.marginHome) > 1e-9 } })) });
  }
  const actionable = (g: string) => ["lean", "best_angle"].includes(g), markets = comparisons.flatMap(c => c.markets);
  const report = { at: now, date, requests, bytes, sourceSha256: createHash("sha256").update(JSON.stringify(source)).digest("hex"), games: comparisons.length,
    beforeActionables: markets.filter(m => actionable(m.before.grade)).length, afterActionables: markets.filter(m => actionable(m.after.grade)).length,
    promotions: markets.filter(m => !actionable(m.before.grade) && actionable(m.after.grade)).length,
    demotions: markets.filter(m => actionable(m.before.grade) && !actionable(m.after.grade)).length,
    providerCalls: 0, writes: 0, outcomesRead: 0, historicalExperiments: 0,
    limitation: "Current unlocked stored independent/quality/caps/quotes decision-stage rehearsal; raw independent features are frozen, not rebuilt. Simulated epoch starts at that stored input receipt, not historical news publication. Not an accuracy test or lock replacement.", comparisons };
  writeFileSync(output!, JSON.stringify(report), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, at: now, date, requests, bytes, games: report.games,
    beforeActionables: report.beforeActionables, afterActionables: report.afterActionables, promotions: report.promotions, demotions: report.demotions,
    providerCalls: 0, writes: 0, outcomesRead: 0, comparisons: comparisons.map(c => ({ matchup: c.matchup,
      marginAdjusted: c.consequence?.marginApplied, totalAdjusted: c.consequence?.totalApplied,
      anchors: Object.keys(c.consequence?.state.anchors ?? {}).length, books: c.consequence?.books.length,
      changedActionables: c.markets.filter(m => actionable(m.before.grade) !== actionable(m.after.grade)) })) }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
