/** SELECT-only pre-outcome capture. Never imports a writer or provider client. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildNbaAttestedNamedBookTrails, type NbaProfessionalMarketReader, type NbaReaderPriceRow } from "../../../lib/services/nba/nbaProfessionalMarketReader";

const release = "offline_nba_attested_forecast_cohort_2026_10_31_r1";
const root = process.argv.find(a => a.startsWith("--directory="))?.slice(12);
if (!root || !resolve(root).startsWith("/private/tmp/oddsphere-nba-forecast-")) {
  throw new Error("Use a dedicated --directory=/private/tmp/oddsphere-nba-forecast-... directory");
}
const sourcePath = `${root}/locked-inputs-r1.json`;
const outputPath = `${root}/attested-forecast-source-r1.json`;
if (existsSync(outputPath)) throw new Error("Immutable source receipt already exists");
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
type RecordRow = { id: number; game_id: number; model_version: string; locked_at: string; slate_date: string;
  event: number; tip: string; projection: unknown; intelligence: unknown;
  audit: { market_reader?: NbaProfessionalMarketReader; independent_projection?: Record<string, unknown>; [key: string]: unknown } | null };
type Price = { id: number; provider: string; provider_event_id: string | null; ingestion_run_id: string | null;
  sportsbook: string; market_type: "moneyline" | "spread" | "total"; selection_key: string;
  american_price: number | null; line: number | null; provider_timestamp: string | null; fetched_at: string };
let requests = 0, bytes = 0;
async function select<T>(table: string, query: Record<string, string>): Promise<T[]> {
  if (!new Set(["prediction_records", "market_price_observations_v2"]).has(table)) throw new Error("Read table outside declared scope");
  if (++requests > 160) throw new Error("SELECT request budget exceeded");
  const url = new URL(`/rest/v1/${table}`, process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.search = new URLSearchParams(query).toString();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing DB read credential");
  const response = await fetch(url, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${table}: HTTP${response.status}`);
  const encoded = await response.text(); bytes += Buffer.byteLength(encoded);
  if (bytes > 64 * 1024 ** 2 || Buffer.byteLength(encoded) > 16 * 1024 ** 2) throw new Error("Read byte budget exceeded");
  return JSON.parse(encoded) as T[];
}
async function main() {
  let records: RecordRow[];
  if (existsSync(sourcePath)) records = JSON.parse(readFileSync(sourcePath, "utf8")).records;
  else {
    records = await select<RecordRow>("prediction_records", {
      select: "id,game_id,model_version,locked_at,slate_date,event:snapshot_json->nba_game_dto_at_capture->game_external_id,tip:snapshot_json->nba_game_dto_at_capture->tip_iso_utc,projection:snapshot_json->nba_game_dto_at_capture->projection,intelligence:snapshot_json->nba_game_dto_at_capture->intelligence,audit:snapshot_json->nba_game_dto_at_capture->grounding_audit",
      sport: "eq.nba", market: "eq.moneyline", locked_at: "not.is.null", slate_date: "gte.2026-10-20",
      and: "(slate_date.lte.2026-10-29)", order: "id.asc", limit: "129",
    });
    assert.ok(records.length > 0 && records.length <= 128, "Declared cohort bounds");
    assert.equal(new Set(records.map(r => r.game_id)).size, records.length, "No duplicate locked game");
    writeFileSync(sourcePath, JSON.stringify({ release, requests, bytes, outcomeLabelsRead: 0, records }), { flag: "wx", mode: 0o600 });
  }
  assert.ok(records.length > 0 && records.length <= 128);
  assert.equal(new Set(records.map(r => r.game_id)).size, records.length);
  const lockedInputsSha256 = hash(readFileSync(sourcePath, "utf8"));
  const games = [];
  for (const record of records) {
    const reader = record.audit?.market_reader;
    const cutoff = Date.parse(reader?.evaluatedAt ?? ""), lock = Date.parse(record.locked_at), tip = Date.parse(record.tip);
    const errors: string[] = [];
    if (!Number.isFinite(cutoff) || !Number.isFinite(lock) || !Number.isFinite(tip) || cutoff > lock || lock >= tip) errors.push("unverified_pregame_capture_clock");
    if (!Number.isInteger(record.event) || !record.audit?.independent_projection) errors.push("missing_independent_or_event_identity");
    if (reader?.evidenceStatus !== "complete") errors.push("incomplete_original_reader_evidence");
    if (errors.length) { games.push({ recordId: record.id, errors, prices: [], attestedTrails: null }); continue; }
    const prices: Price[] = [];
    let last = 0;
    while (true) {
      const page = await select<Price>("market_price_observations_v2", {
        select: "id,provider,provider_event_id,ingestion_run_id,sportsbook,market_type,selection_key,american_price,line,provider_timestamp,fetched_at",
        league: "eq.nba", canonical_event_id: `eq.${record.event}`, sportsbook: "in.(circa,pinnacle,bookmaker)",
        provider: "in.(owls,canonical_lines)", fetched_at: `lte.${reader!.evaluatedAt}`, id: `gt.${last}`, order: "id.asc", limit: "1000",
      });
      assert.ok(page.every((row, i) => Number.isInteger(row.id) && row.id > (i === 0 ? last : page[i - 1]!.id)), "Invalid source pagination order");
      prices.push(...page);
      if (prices.length > 3000) throw new Error(`Source chronology cap reached for${record.id}; no truncated qualification`);
      if (page.length < 1000) break;
      last = page.at(-1)!.id;
    }
    const rows: NbaReaderPriceRow[] = prices.map(row => ({ provider: row.provider, providerEventId: row.provider_event_id,
      ingestionRunId: row.ingestion_run_id, sportsbook: row.sportsbook, sharpBook: true, market: row.market_type,
      selectionKey: row.selection_key, americanPrice: row.american_price, line: row.line,
      providerTimestamp: row.provider_timestamp, fetchedAt: row.fetched_at }));
    const attestedTrails = Object.fromEntries((["moneyline", "spread", "total"] as const).map(market => [market,
      buildNbaAttestedNamedBookTrails({ market, rows, evaluatedAt: reader!.evaluatedAt,
        excludedSportsbooks: reader!.reads[market].excludedSportsbooks })]));
    games.push({ recordId: record.id, errors, prices, attestedTrails });
  }
  assert.equal(hash(readFileSync(sourcePath, "utf8")), lockedInputsSha256);
  const summary = { release, lockedInputsSha256, games: records.length, eligibleCaptures: games.filter(g => !g.errors.length).length,
    withAttestedTrails: games.filter(g => Object.values(g.attestedTrails ?? {}).some(trails => trails.length > 0)).length,
    captureReleases: Object.fromEntries([...new Set(records.map(r => r.model_version))].map(v => [v, records.filter(r => r.model_version === v).length])),
    requests, bytes, outcomeLabelsRead: 0, providerCalls: 0, fits: 0, productionWrites: 0 };
  const encoded = JSON.stringify({ ...summary, records, captures: games });
  writeFileSync(outputPath, encoded, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ...summary, outputPath, outputSha256: hash(encoded) }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
