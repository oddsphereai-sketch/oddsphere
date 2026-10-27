import {
  createMarketBrainCapturePlan,
  type MarketBrainCapturePlan,
} from "../lib/services/marketBrain/marketBrainCapturePlan";
import {
  createMarketBrainEvidenceAttempt,
  type MarketBrainEvidenceAttempt,
} from "../lib/services/marketBrain/marketBrainEvidenceAttempt";
import { marketBrainCanonicalJson } from "../lib/services/marketBrain/marketBrainCanonical";

const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
const attemptId = "40000000-0000-4000-8000-000000000001";
const common = {
  product: "nba_daily_edge" as const,
  qualificationScopeKeys: ["moneyline", "spread", "total"] as const,
  provider: "sharpapi",
  feed: "main_odds",
  participant: "circa",
  eventId: "nba:postgres-proof",
  phase: "current" as const,
  plannedAt: iso(3_000),
  windowOpensAt: iso(2_000),
  windowClosesAt: iso(30_000),
};
const plan = createMarketBrainCapturePlan({
  planId: "40000000-0000-4000-8000-000000000002",
  createdAt: iso(0),
  horizonOpensAt: iso(2_000),
  horizonClosesAt: iso(60_000),
  attempts: [{ attemptId, ...common }],
  details: { fixture: "v48_postgresql_lifecycle" },
});
const collision = createMarketBrainCapturePlan({
  ...withoutReleaseAndChecksum(plan),
  details: { fixture: "forged_collision" },
});
const attempt = createMarketBrainEvidenceAttempt({
  attemptId,
  ...common,
  startedAt: iso(2_500),
  completedAt: iso(5_000),
  outcome: "success_with_rows",
  reasonCode: null,
  requestCount: 1,
  expectedPages: 1,
  receivedPages: 1,
  responseSha256: "a".repeat(64),
  rawArchiveSha256: "b".repeat(64),
  parserRelease: "sharpapi_main_odds_postgres_fixture_r1",
  accounting: {
    rawRows: 1, parsedRows: 1, unsupportedRows: 0, malformedRows: 0,
    matchedRows: 1, unmatchedRows: 0, ambiguousRows: 0,
    retainedRows: 1, duplicateRows: 0, filteredRows: 0, writeFailedRows: 0,
  },
  details: { fixture: "v48_postgresql_lifecycle" },
});
const unplanned = createMarketBrainEvidenceAttempt({
  ...withoutReleaseAndChecksum(attempt),
  attemptId: "40000000-0000-4000-8000-000000000003",
});

const planArgs = (value: MarketBrainCapturePlan) => {
  const { checksum: _checksum, ...checksumPayload } = value;
  return [
    `${literal(marketBrainCanonicalJson(value))}::jsonb`,
    literal(marketBrainCanonicalJson(value)),
    literal(marketBrainCanonicalJson(checksumPayload)),
    literal(value.checksum),
  ].join(", ");
};

process.stdout.write(`
SELECT public.persist_market_brain_capture_plan_v1(${planArgs(plan)});
SELECT pg_sleep(6);
-- Exact idempotent retry remains valid after the precommit horizon has opened.
SELECT public.persist_market_brain_capture_plan_v1(${planArgs(plan)});

DO $collision$
BEGIN
  BEGIN
    PERFORM public.persist_market_brain_capture_plan_v1(${planArgs(collision)});
    RAISE EXCEPTION 'forged capture-plan collision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'forged capture-plan collision was accepted' OR
       position('identity collision differs' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$collision$;

${attemptInsert(attempt)}

DO $unplanned$
BEGIN
  BEGIN
    ${attemptInsert(unplanned)}
    RAISE EXCEPTION 'unplanned evidence attempt was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unplanned evidence attempt was accepted' OR
       position('unplanned or differs' in SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;
END;
$unplanned$;

DO $immutability$
BEGIN
  BEGIN
    UPDATE public.market_brain_capture_plans SET attempt_count = 2
     WHERE release = ${literal(plan.release)} AND plan_id = ${literal(plan.planId)}::uuid;
    RAISE EXCEPTION 'capture plan mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'capture plan mutation was accepted' OR position('append-only' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.market_brain_evidence_attempts SET request_count = 2
     WHERE release = ${literal(attempt.release)} AND attempt_id = ${literal(attempt.attemptId)}::uuid;
    RAISE EXCEPTION 'evidence attempt mutation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'evidence attempt mutation was accepted' OR position('append-only' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
END;
$immutability$;

DO $assertions$
BEGIN
  IF (SELECT count(*) FROM public.market_brain_capture_plans) <> 1 OR
     (SELECT count(*) FROM public.market_brain_planned_attempts) <> 1 OR
     (SELECT count(*) FROM public.market_brain_evidence_attempts) <> 1 THEN
    RAISE EXCEPTION 'v47/v48 lifecycle did not retain exactly one immutable plan/obligation/receipt';
  END IF;
  IF has_table_privilege('service_role', 'public.market_brain_capture_plans', 'INSERT') OR
     has_table_privilege('service_role', 'public.market_brain_capture_plans', 'UPDATE') OR
     has_table_privilege('anon', 'public.market_brain_capture_plans', 'SELECT') OR
     NOT has_function_privilege('service_role',
       'public.persist_market_brain_capture_plan_v1(jsonb,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v48 plan grants are not private and RPC-only';
  END IF;
END;
$assertions$;
`);

function attemptInsert(value: MarketBrainEvidenceAttempt): string {
  const { checksum: _checksum, ...checksumPayload } = value;
  const a = value.accounting;
  const statement = `INSERT INTO public.market_brain_evidence_attempts (
    release, attempt_id, product_key, qualification_scope_keys, provider, feed, participant, event_id,
    phase, planned_at, window_opens_at, window_closes_at, started_at, completed_at, outcome, reason_code,
    request_count, expected_pages, received_pages, raw_rows, parsed_rows, unsupported_rows, malformed_rows,
    matched_rows, unmatched_rows, ambiguous_rows, retained_rows, duplicate_rows, filtered_rows,
    write_failed_rows, response_sha256, raw_archive_sha256, parser_release, attempt_checksum,
    attempt_payload, attempt_payload_text, checksum_payload_text
  ) VALUES (
    ${literal(value.release)}, ${literal(value.attemptId)}::uuid, ${literal(value.product)},
    ARRAY[${value.qualificationScopeKeys.map(literal).join(",")}], ${literal(value.provider)}, ${literal(value.feed)},
    ${nullable(value.participant)}, ${nullable(value.eventId)}, ${literal(value.phase)}, ${literal(value.plannedAt)}::timestamptz,
    ${literal(value.windowOpensAt)}::timestamptz, ${literal(value.windowClosesAt)}::timestamptz,
    ${nullable(value.startedAt, "timestamptz")}, ${literal(value.completedAt)}::timestamptz, ${literal(value.outcome)},
    ${nullable(value.reasonCode)}, ${value.requestCount}, ${value.expectedPages ?? "NULL"}, ${value.receivedPages},
    ${a.rawRows}, ${a.parsedRows}, ${a.unsupportedRows}, ${a.malformedRows}, ${a.matchedRows}, ${a.unmatchedRows},
    ${a.ambiguousRows}, ${a.retainedRows}, ${a.duplicateRows}, ${a.filteredRows}, ${a.writeFailedRows},
    ${nullable(value.responseSha256)}, ${nullable(value.rawArchiveSha256)}, ${nullable(value.parserRelease)},
    ${literal(value.checksum)}, ${literal(marketBrainCanonicalJson(value))}::jsonb,
    ${literal(marketBrainCanonicalJson(value))}, ${literal(marketBrainCanonicalJson(checksumPayload))}
  )`;
  return `${statement};`;
}

function withoutReleaseAndChecksum<T extends { release: string; checksum: string }>(value: T): Omit<T, "release" | "checksum"> {
  const { release: _release, checksum: _checksum, ...payload } = value;
  return payload;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function nullable(value: string | null, cast?: string): string {
  return value === null ? `NULL${cast ? `::${cast}` : ""}` : `${literal(value)}${cast ? `::${cast}` : ""}`;
}
