/**
 * SELECT-only audit for the behavior-neutral WNBA forward-evidence package.
 *
 * The natural writer adds no provider or database reads. This operator script
 * may join the existing append-only MI-v2 archive after the fact; it never
 * refreshes, predicts, writes, locks, grades, or republishes anything.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/operator/audit-wnba-forward-evidence-capture.ts --date 2026-09-02
 */
import { supabase } from "../../lib/db/supabase";
import {
  readWnbaForwardEvidenceCapture,
  WNBA_FORWARD_EVIDENCE_CAPTURE_KEY,
  WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET,
  WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES,
  WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES,
} from "../../lib/services/wnba/wnbaForwardEvidenceCapture";

type Row = Record<string, unknown>;
type Market = "moneyline" | "spread" | "total";

const args = process.argv.slice(2);
const dateIndex = args.indexOf("--date");
const slateDate = dateIndex >= 0 ? args[dateIndex + 1] : new Date().toISOString().slice(0, 10);
if (!slateDate || !/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
  throw new Error("Pass --date YYYY-MM-DD.");
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function selectionSide(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const side = value.split(":").at(-1);
  return side === "home" || side === "away" || side === "over" || side === "under" ? side : null;
}

async function main(): Promise<void> {
  const { data, error } = await supabase
    .from("prediction_records")
    .select("id, game_id, external_id, slate_date, market, locked_at, snapshot_json")
    .eq("sport", "wnba")
    .eq("slate_date", slateDate)
    .in("market", ["moneyline", "spread", "total"])
    .limit(500);
  if (error) throw new Error(`prediction_records: ${error.message}`);

  const records = (data ?? []) as Row[];
  const captures = records.map((record) => {
    const snapshot = object(record.snapshot_json);
    const capture = readWnbaForwardEvidenceCapture(snapshot[WNBA_FORWARD_EVIDENCE_CAPTURE_KEY]);
    return { record, capture };
  });
  const valid = captures.filter((entry) => entry.capture !== null);
  const eventIds = [...new Set(valid
    .map((entry) => entry.capture!.game.external_id)
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String))];

  let archiveRows: Row[] = [];
  let archiveReadError: string | null = null;
  if (eventIds.length > 0) {
    const archive = await supabase
      .from("market_split_observations_v2")
      .select("canonical_event_id, market_type, selection_key, provider, source_book, source_type, bets_pct, money_pct, source_observed_at, fetched_at, source_timestamp_verified, minutes_to_start, ingestion_run_id")
      .eq("league", "wnba")
      .in("canonical_event_id", eventIds)
      .in("market_type", ["moneyline", "spread", "total"])
      .order("fetched_at", { ascending: false })
      .limit(5000);
    archiveRows = (archive.data ?? []) as Row[];
    archiveReadError = archive.error?.message ?? null;
  }

  const markets: Record<Market, {
    records: number;
    captures: number;
    locked: number;
    currentBookPairs: number;
    openingBookPairs: number;
    movements: number;
    targetExcludedAlternatives: number;
    circaPricePairs: number;
    embeddedPublicPairs: number;
    missingPublicProvenance: number;
    truncated: number;
    overMarketByteBound: number;
  }> = {
    moneyline: { records: 0, captures: 0, locked: 0, currentBookPairs: 0, openingBookPairs: 0, movements: 0, targetExcludedAlternatives: 0, circaPricePairs: 0, embeddedPublicPairs: 0, missingPublicProvenance: 0, truncated: 0, overMarketByteBound: 0 },
    spread: { records: 0, captures: 0, locked: 0, currentBookPairs: 0, openingBookPairs: 0, movements: 0, targetExcludedAlternatives: 0, circaPricePairs: 0, embeddedPublicPairs: 0, missingPublicProvenance: 0, truncated: 0, overMarketByteBound: 0 },
    total: { records: 0, captures: 0, locked: 0, currentBookPairs: 0, openingBookPairs: 0, movements: 0, targetExcludedAlternatives: 0, circaPricePairs: 0, embeddedPublicPairs: 0, missingPublicProvenance: 0, truncated: 0, overMarketByteBound: 0 },
  };

  let overGameByteBound = 0;
  let overBookBound = 0;
  let releaseMismatch = 0;
  for (const entry of captures) {
    const market = entry.record.market as Market;
    if (!(market in markets)) continue;
    const summary = markets[market];
    summary.records += 1;
    if (entry.record.locked_at != null) summary.locked += 1;
    if (!entry.capture) continue;
    summary.captures += 1;
    const marketCapture = entry.capture.markets[market];
    if (!marketCapture) continue;
    summary.currentBookPairs += marketCapture.current_book_pairs.length;
    summary.openingBookPairs += marketCapture.opening_book_pairs.length;
    summary.movements += marketCapture.same_book_movement.length;
    summary.targetExcludedAlternatives += marketCapture.evaluation.target_excluded_complete_pair_count;
    summary.circaPricePairs += marketCapture.current_book_pairs.filter((pair) => pair.source_class === "circa").length;
    summary.embeddedPublicPairs += marketCapture.source_aware_public_pairs.length;
    if (marketCapture.coverage.source_aware_unavailable_reason !== null) summary.missingPublicProvenance += 1;
    if (marketCapture.coverage.payload_truncated) summary.truncated += 1;
    if (bytes(entry.capture) > WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES) overGameByteBound += 1;
    if (bytes(entry.capture) > WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES) summary.overMarketByteBound += 1;
    if (marketCapture.current_book_pairs.length > WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET) overBookBound += 1;
    const tuple = marketCapture.evaluation.tuple;
    if (tuple && (
      tuple.model_version !== entry.capture.releases.model_version ||
      tuple.distribution_version !== entry.capture.releases.distribution_version ||
      tuple.grade_policy_version !== entry.capture.releases.grade_policy_version
    )) releaseMismatch += 1;
  }

  const archivePredecisionRows = archiveRows.filter((row) => {
    const eventId = String(row.canonical_event_id);
    const capture = valid.find((entry) => String(entry.capture!.game.external_id) === eventId)?.capture;
    const fetchedAt = typeof row.fetched_at === "string" ? Date.parse(row.fetched_at) : Number.NaN;
    return capture != null && Number.isFinite(fetchedAt) && fetchedAt <= Date.parse(capture.decision_at);
  });
  const archiveGroups = new Map<string, Set<string>>();
  for (const row of archivePredecisionRows) {
    const side = selectionSide(row.selection_key);
    if (!side) continue;
    const identity = [
      row.canonical_event_id,
      row.market_type,
      row.provider,
      row.source_book,
      row.source_type,
      row.ingestion_run_id ?? row.fetched_at,
    ].join("|");
    const sides = archiveGroups.get(identity) ?? new Set<string>();
    sides.add(side);
    archiveGroups.set(identity, sides);
  }
  const completeArchivePairs = [...archiveGroups.entries()].filter(([identity, sides]) => {
    const market = identity.split("|")[1];
    return market === "total"
      ? sides.has("over") && sides.has("under")
      : sides.has("home") && sides.has("away");
  }).length;

  console.log(JSON.stringify({
    mode: "select_only",
    natural_writer_added_queries: 0,
    natural_writer_added_provider_calls: 0,
    slate_date: slateDate,
    records: records.length,
    captures: valid.length,
    invalid_or_missing_captures: records.length - valid.length,
    bounds: {
      max_game_bytes: WNBA_FORWARD_EVIDENCE_MAX_GAME_BYTES,
      max_market_bytes: WNBA_FORWARD_EVIDENCE_MAX_MARKET_BYTES,
      max_books_per_market: WNBA_FORWARD_EVIDENCE_MAX_BOOKS_PER_MARKET,
      over_game_byte_bound: overGameByteBound,
      over_market_byte_bound: Object.values(markets).reduce((sum, market) => sum + market.overMarketByteBound, 0),
      over_book_bound: overBookBound,
    },
    integrity: { release_mismatches: releaseMismatch },
    markets,
    offline_existing_archive_join: {
      rows: archiveRows.length,
      predecision_rows: archivePredecisionRows.length,
      complete_two_sided_source_pairs: completeArchivePairs,
      read_error: archiveReadError,
    },
    board_impact: {
      projections: 0,
      probabilities: 0,
      sides: 0,
      grades: 0,
      stakes: 0,
      locks: 0,
    },
  }, null, 2));
}

void main();
