/** Bounded SELECT-only exact stored-stage comparison. No provider refresh,
 * outcome labels, fits, prediction writes or historical lock replacement. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { NbaDailyEdgeGameDto } from "../../../lib/services/nba/buildNbaDailyEdgeDto";
import { buildNbaAttestedNamedBookTrails, type NbaProfessionalMarketReader } from "../../../lib/services/nba/nbaProfessionalMarketReader";
import { resolveNbaNamedBookPosture } from "../../../lib/services/nba/nbaNamedBookPosture";
import { gradeNbaMarket, type GradeInput } from "../../../lib/services/nba/nbaMarketReview";

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = flag("directory");
if (!directory?.startsWith("/private/tmp/")) throw new Error("Pass a dedicated --directory=/private/tmp/... receipt directory.");
const revision = flag("revision") ?? "r1";
if (!["r1", "r2", "r3"].includes(revision)) throw new Error("Unsupported receipt revision");
const sourcePath = `${directory}/source-${revision}.json`, output = `${directory}/comparison-${revision}.json`;
const dates = (flag("dates") ?? "2026-10-30,2026-10-31").split(",");
if (dates.length > 2 || dates.some(d => !/^2026-10-(30|31)$/.test(d))) throw new Error("This receipt is limited to the declared Oct30/31 NBA board.");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
type Price = { id?: number; provider?: string; provider_event_id?: string | null; ingestion_run_id?: string | null;
  sportsbook: string; market_type: string; selection_key: string; american_price: number | null;
  line: number | null; provider_timestamp: string | null; fetched_at: string };
type Audit = { market_reader: NbaProfessionalMarketReader; independent_projection: { margin_home: number; total: number };
  market_reader_decision: { spreadMagnitudePoints: number | null; totalMagnitudePoints: number | null;
    spreadReadQualified: boolean; totalReadQualified: boolean; spreadCorrectionApplied: boolean; totalCorrectionApplied: boolean } };
type Stored = { id: number; game_id: number; locked_at: string | null; model_version: string; play_grade: string; game: NbaDailyEdgeGameDto };
type Source = { dates: string[]; requests: number; bytes: number; records: Stored[]; endpoints: Record<string, Price[]>; previousSourceSha256?: string };
let requests = 0, bytes = 0;
async function get<T>(table: string, query: Record<string, string>): Promise<T[]> {
  if (++requests > (revision === "r3" ? 40 : 24)) throw new Error("SELECT budget exceeded");
  const url = new URL(`/rest/v1/${table}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.search = new URLSearchParams(query).toString();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing configured DB read credential");
  const response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${table}: HTTP${response.status}`);
  const encoded = await response.text(); bytes += Buffer.byteLength(encoded);
  if (Buffer.byteLength(encoded) > 8 * 1024 ** 2 || bytes > 16 * 1024 ** 2) throw new Error("SELECT response budget exceeded");
  return JSON.parse(encoded) as T[];
}
function enrich(reader: NbaProfessionalMarketReader, prices: Price[]) {
  const result = structuredClone(reader);
  if (revision === "r3") {
    for (const market of ["moneyline", "spread", "total"] as const) {
      result.reads[market].namedBookPostureTrails = buildNbaAttestedNamedBookTrails({ market,
        evaluatedAt: reader.evaluatedAt, excludedSportsbooks: reader.reads[market].excludedSportsbooks,
        rows: prices.map(row => ({ provider: row.provider, providerEventId: row.provider_event_id,
          ingestionRunId: row.ingestion_run_id, sportsbook: row.sportsbook, sharpBook: true,
          market: row.market_type as "moneyline" | "spread" | "total", selectionKey: row.selection_key,
          americanPrice: row.american_price, line: row.line, providerTimestamp: row.provider_timestamp, fetchedAt: row.fetched_at })),
      });
    }
    return result;
  }
  for (const market of ["spread", "total"] as const) for (const trail of result.reads[market].trails) {
    if (trail.sourceClass !== "named") continue;
    const fair = (at: string, number: number | null): number | undefined => {
      const first = market === "total" ? "over" : "home", second = market === "total" ? "under" : "away";
      const matching = prices.filter(p => p.market_type === market && p.sportsbook === trail.sportsbook &&
        Date.parse(p.provider_timestamp ?? p.fetched_at) === Date.parse(at) && Date.parse(p.fetched_at) <= Date.parse(reader.evaluatedAt) &&
        p.line !== null && (market === "spread" ? -p.line * (p.selection_key.endsWith(":home") ? 1 : -1) : p.line) === number);
      const pairs = new Set<string>();
      for (const stamp of new Set(matching.map(p => p.fetched_at))) {
        const rows = matching.filter(p => p.fetched_at === stamp);
        const a = rows.filter(p => p.selection_key.endsWith(`:${first}`)), b = rows.filter(p => p.selection_key.endsWith(`:${second}`));
        if (a.length !== 1 || b.length !== 1 || !a[0]?.american_price || !b[0]?.american_price) continue;
        pairs.add(JSON.stringify([a[0].american_price, b[0].american_price]));
      }
      if (pairs.size !== 1) return undefined;
      const [a, b] = JSON.parse([...pairs][0]!) as [number, number];
      const implied = (p: number) => p < 0 ? -p / (-p + 100) : 100 / (p + 100);
      return implied(a) / (implied(a) + implied(b));
    };
    trail.openingFairFirstProbability = fair(trail.openingAt, trail.openingNumber);
    trail.currentFairFirstProbability = fair(trail.currentAt, trail.currentNumber);
  }
  return result;
}
async function main() {
  let source: Source;
  if (process.argv.includes("--capture")) {
    const previous = revision !== "r1" ? readFileSync(`${directory}/source-r1.json`, "utf8") : null;
    const records = previous ? (JSON.parse(previous) as Source).records : await get<Stored>("prediction_records", { select: "id,game_id,locked_at,model_version,play_grade,game:snapshot_json->nba_game_dto_at_capture",
      sport: "eq.nba", market: "eq.moneyline", slate_date: `in.(${dates.join(",")})`, order: "id.asc", limit: "21" });
    if (records.length > 20) throw new Error("Declared game budget exceeded");
    const endpoints: Record<string, Price[]> = {};
    for (const record of records) {
      const reader = (record.game?.grounding_audit as Audit | null)?.market_reader;
      if (!reader) continue;
      const times = [...new Set((["spread", "total"] as const).flatMap(m => reader.reads[m].trails
        .filter(t => t.sourceClass === "named").flatMap(t => [t.openingAt, t.currentAt])))];
      if (!times.length) continue;
      if (revision === "r3") {
        const all: Price[] = [];
        let last = 0;
        while (true) {
          const page = await get<Price>("market_price_observations_v2", {
            select: "id,provider,provider_event_id,ingestion_run_id,sportsbook,market_type,selection_key,american_price,line,provider_timestamp,fetched_at",
            league: "eq.nba", canonical_event_id: `eq.${record.game.game_external_id}`,
            sportsbook: "in.(circa,pinnacle,bookmaker)", provider: "in.(owls,canonical_lines)",
            fetched_at: `lte.${reader.evaluatedAt}`, order: "id.asc", id: `gt.${last}`, limit: "1000",
          });
          if (page.some((row, i) => !Number.isInteger(row.id) || row.id! <= (i === 0 ? last : page[i - 1]!.id!))) throw new Error("Source page ID order invalid");
          all.push(...page);
          if (all.length > 3000) throw new Error("Per-game chronology budget exceeded");
          if (page.length < 1000) break;
          last = page.at(-1)!.id!;
        }
        endpoints[String(record.id)] = all;
        continue;
      }
      const rows = await get<Price>("market_price_observations_v2", {
        select: "sportsbook,market_type,selection_key,american_price,line,provider_timestamp,fetched_at", league: "eq.nba",
        canonical_event_id: `eq.${record.game.game_external_id}`, sportsbook: "in.(circa,pinnacle,bookmaker)",
        market_type: "in.(spread,total)",
        ...(revision === "r2" ? { or: `(provider_timestamp.in.(${times.join(",")}),fetched_at.in.(${times.join(",")}))` }
          : { provider_timestamp: `in.(${times.join(",")})` }),
        fetched_at: `lte.${reader.evaluatedAt}`, limit: "201",
      });
      if (rows.length > 200) throw new Error("Endpoint row budget exceeded; do not silently truncate");
      endpoints[String(record.id)] = rows;
    }
    source = { dates, requests, bytes, records, endpoints, ...(previous ? { previousSourceSha256: sha(previous) } : {}) };
    writeFileSync(sourcePath, JSON.stringify(source), { flag: "wx", mode: 0o600 });
  } else source = JSON.parse(readFileSync(sourcePath, "utf8")) as Source;
  const beforeHash = sha(readFileSync(sourcePath, "utf8"));
  const comparisons = [];
  for (const record of source.records) {
    const game = record.game, audit = game?.grounding_audit as Audit | null;
    if (!audit?.market_reader) throw new Error(`Missing stored reader for ${record.id}`);
    const reader = enrich(audit.market_reader, source.endpoints[String(record.id)] ?? []), d = audit.market_reader_decision;
    for (const market of ["moneyline", "spread", "total"] as const) {
      const intel = game.intelligence[market === "moneyline" ? "ml" : market];
      assert.ok(intel.pick_side);
      const input: GradeInput = { market, pick: intel.pick_side, confidence: intel.model_confidence,
        band: intel.conflict_band, edge: market === "moneyline" ? (intel.edge_prob_pp ?? 0) / 100 : (intel.edge_points ?? 0) / (market === "spread" ? 10 : 15),
        dataQualityTier: game.data_quality_tier, injuriesKnown: game.data_quality_tier === "high",
        currentPriceAmerican: intel.current_price.odds_american, modelProbabilityOnPick: intel.model_prob_on_pick,
        independentEdgePoints: market === "spread" ? audit.independent_projection.margin_home + (intel.pick_side === "home" ? intel.consensus_line! : -intel.consensus_line!)
          : market === "total" ? audit.independent_projection.total - intel.consensus_line! : null,
        readerQualified: market === "spread" ? d.spreadReadQualified : d.totalReadQualified,
        readerCorrectionApplied: market === "spread" ? d.spreadCorrectionApplied : d.totalCorrectionApplied,
        readerMagnitudePoints: market === "spread" ? d.spreadMagnitudePoints : d.totalMagnitudePoints,
        moneylineEvidence: { directReadQualified: reader.reads.moneyline.status === "qualified", directReadSide: reader.reads.moneyline.side as "home" | "away" | null,
          spreadReadQualified: reader.reads.spread.status === "qualified", spreadReadSide: reader.reads.spread.side as "home" | "away" | null,
          spreadCorrectionApplied: d.spreadCorrectionApplied },
      };
      const prior = gradeNbaMarket(input);
      assert.equal(prior.grade, intel.grade, `Stored incumbent grade parity ${record.id}:${market}`);
      const posture = resolveNbaNamedBookPosture({ reader, market, pickedSide: intel.pick_side });
      const next = gradeNbaMarket({ ...input, namedBookPosture: posture });
      const actionable = (g: string) => g === "lean" || g === "best_angle";
      assert.equal(actionable(prior.grade), actionable(next.grade));
      assert.equal(prior.effectiveConfidence, next.effectiveConfidence);
      comparisons.push({ record: record.id, event: game.game_external_id, matchup: game.matchup, market, lock: record.locked_at,
        release: record.model_version, probability: intel.model_prob_on_pick, price: intel.current_price.odds_american,
        pick: intel.pick_side, line: intel.consensus_line, oldGrade: prior.grade, candidateGrade: next.grade, posture,
        hypotheticalLockedRegradeOnly: record.locked_at !== null, productionMutationAllowed: false });
    }
  }
  assert.equal(sha(readFileSync(sourcePath, "utf8")), beforeHash);
  const report = { release: `nba_named_opposition_stored_stage_audit_2026_10_31_${revision}`, sourceSha256: beforeHash,
    requests: source.requests, bytes: source.bytes, games: source.records.length, markets: comparisons.length,
    bestToLean: comparisons.filter(c => c.oldGrade !== c.candidateGrade).length,
    actionablePromotions: 0, actionableDemotions: 0, forecastChanges: 0, priceChanges: 0, probabilityChanges: 0,
    providerCalls: 0, writes: 0, fits: 0, outcomeLabelsRead: 0,
    limitation: "Exact stored grade-stage comparison and retained endpoint recovery, not whole-writer input replay, accuracy qualification, or replacement of a historical lock.", comparisons };
  const encoded = JSON.stringify(report); writeFileSync(output, encoded, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, sha256: sha(encoded), games: report.games, markets: report.markets, bestToLean: report.bestToLean,
    actionablePromotions: 0, actionableDemotions: 0, requests: source.requests, bytes: source.bytes,
    toronto: comparisons.filter(c => c.event === 401909281) }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
