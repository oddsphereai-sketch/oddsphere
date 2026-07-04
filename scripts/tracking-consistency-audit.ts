import { supabase } from "@/lib/db/supabase";
import {
  computeTrackingAggregate,
  effectiveTrackingPlayGrade,
  type AggregateMetrics,
  type SportMarketBucket,
} from "@/lib/services/trackingAggregateService";
import { isPublicallyTracked } from "@/lib/config/officialTrackingStart";
import type {
  PredictionGradeRow,
  PredictionRecordRow,
  TrackedMarketV17,
  TrackedSport,
} from "@/lib/types/domain/Tracking";

type Args = {
  date: string;
  sport: TrackedSport | "all";
  json: boolean;
};

type Row = {
  record: PredictionRecordRow;
  grade: PredictionGradeRow | null;
};

type CompactMetrics = Pick<
  AggregateMetrics,
  "picks" | "wins" | "losses" | "pushes" | "voids" | "pending"
>;

type CompactBucket = {
  sport: TrackedSport;
  market: TrackedMarketV17;
  metrics: CompactMetrics;
  bestAngles: CompactMetrics;
  leans: CompactMetrics;
};

type Mismatch = {
  key: string;
  field: "metrics" | "bestAngles" | "leans";
  expected: CompactMetrics;
  actual: CompactMetrics;
};

const TRACKING_GRADE_ID_CHUNK_SIZE = 500;

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(yyyyMmDd: string, deltaDays: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map((s) => Number.parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function parseSport(raw: string): TrackedSport | "all" {
  const sport = raw.toLowerCase();
  if (
    sport === "mlb" ||
    sport === "nfl" ||
    sport === "nba" ||
    sport === "cfb" ||
    sport === "cbb" ||
    sport === "nhl" ||
    sport === "ucl" ||
    sport === "soccer" ||
    sport === "wnba" ||
    sport === "all"
  ) {
    return sport;
  }
  throw new Error(`Unsupported sport "${raw}"`);
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    date: shiftDate(todayEt(), -1),
    sport: "all",
    json: false,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "date") {
      out.date =
        value === "today" ? todayEt() :
        value === "yesterday" ? shiftDate(todayEt(), -1) :
        value;
    }
    if (key === "sport") out.sport = parseSport(value);
  }
  return out;
}

function emptyMetrics(): CompactMetrics {
  return { picks: 0, wins: 0, losses: 0, pushes: 0, voids: 0, pending: 0 };
}

function compactMetrics(metrics: AggregateMetrics): CompactMetrics {
  return {
    picks: metrics.picks,
    wins: metrics.wins,
    losses: metrics.losses,
    pushes: metrics.pushes,
    voids: metrics.voids,
    pending: metrics.pending,
  };
}

function isTossUp(record: PredictionRecordRow): boolean {
  return (
    record.prediction_type === "toss_up" ||
    String(record.pick ?? "").trim().toLowerCase() === "toss-up"
  );
}

function addResult(metrics: CompactMetrics, row: Row): void {
  metrics.picks++;
  const grade = row.grade;
  if (grade === null || grade.result === "pending") {
    metrics.pending++;
    return;
  }
  if (grade.win) metrics.wins++;
  else if (grade.loss) metrics.losses++;
  else if (grade.push) metrics.pushes++;
  else if (grade.void) metrics.voids++;
}

function createBucket(sport: TrackedSport, market: TrackedMarketV17): CompactBucket {
  return {
    sport,
    market,
    metrics: emptyMetrics(),
    bestAngles: emptyMetrics(),
    leans: emptyMetrics(),
  };
}

async function fetchGrades(recordIds: number[]): Promise<Map<number, PredictionGradeRow>> {
  const out = new Map<number, PredictionGradeRow>();
  for (let i = 0; i < recordIds.length; i += TRACKING_GRADE_ID_CHUNK_SIZE) {
    const ids = recordIds.slice(i, i + TRACKING_GRADE_ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("prediction_grades")
      .select("*")
      .in("prediction_record_id", ids);
    if (error) throw new Error(`prediction_grades query failed: ${error.message}`);
    for (const grade of (data ?? []) as PredictionGradeRow[]) {
      out.set(grade.prediction_record_id, grade);
    }
  }
  return out;
}

function buildExpectedBuckets(rows: Row[]): CompactBucket[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.record.sport}::${row.record.market}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const mlbFiRows = groups.get("mlb::first_inning") ?? [];
  if (mlbFiRows.length > 0) {
    const nrfiRows = mlbFiRows.filter((r) => String(r.record.pick ?? "").toUpperCase() === "NRFI");
    const yrfiRows = mlbFiRows.filter((r) => String(r.record.pick ?? "").toUpperCase() === "YRFI");
    if (nrfiRows.length > 0) groups.set("mlb::nrfi", nrfiRows);
    if (yrfiRows.length > 0) groups.set("mlb::yrfi", yrfiRows);
  }

  const out: CompactBucket[] = [];
  for (const [key, groupRows] of groups) {
    const [sport, market] = key.split("::") as [TrackedSport, TrackedMarketV17];
    const bucket = createBucket(sport, market);
    for (const row of groupRows) {
      addResult(bucket.metrics, row);
      if (row.record.no_bet === true) continue;
      const effectiveGrade = effectiveTrackingPlayGrade(row.record);
      if (effectiveGrade === "best_angle") addResult(bucket.bestAngles, row);
      if (effectiveGrade === "lean") addResult(bucket.leans, row);
    }
    out.push(bucket);
  }
  out.sort((a, b) => {
    if (a.sport !== b.sport) return a.sport.localeCompare(b.sport);
    return a.market.localeCompare(b.market);
  });
  return out;
}

function compactActualBucket(bucket: SportMarketBucket): CompactBucket {
  return {
    sport: bucket.sport,
    market: bucket.market,
    metrics: compactMetrics(bucket.metrics),
    bestAngles: compactMetrics(bucket.bestAngles),
    leans: compactMetrics(bucket.leans),
  };
}

function metricsEqual(a: CompactMetrics, b: CompactMetrics): boolean {
  return (
    a.picks === b.picks &&
    a.wins === b.wins &&
    a.losses === b.losses &&
    a.pushes === b.pushes &&
    a.voids === b.voids &&
    a.pending === b.pending
  );
}

function compareBuckets(expected: CompactBucket[], actual: CompactBucket[]): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const actualByKey = new Map(actual.map((b) => [`${b.sport}::${b.market}`, b]));
  const expectedByKey = new Map(expected.map((b) => [`${b.sport}::${b.market}`, b]));
  const keys = Array.from(new Set([...expectedByKey.keys(), ...actualByKey.keys()])).sort();
  for (const key of keys) {
    const e = expectedByKey.get(key);
    const a = actualByKey.get(key);
    const blank = emptyMetrics();
    const expectedMetrics = e?.metrics ?? blank;
    const actualMetrics = a?.metrics ?? blank;
    if (!metricsEqual(expectedMetrics, actualMetrics)) {
      mismatches.push({ key, field: "metrics", expected: expectedMetrics, actual: actualMetrics });
    }
    const expectedBestAngles = e?.bestAngles ?? blank;
    const actualBestAngles = a?.bestAngles ?? blank;
    if (!metricsEqual(expectedBestAngles, actualBestAngles)) {
      mismatches.push({ key, field: "bestAngles", expected: expectedBestAngles, actual: actualBestAngles });
    }
    const expectedLeans = e?.leans ?? blank;
    const actualLeans = a?.leans ?? blank;
    if (!metricsEqual(expectedLeans, actualLeans)) {
      mismatches.push({ key, field: "leans", expected: expectedLeans, actual: actualLeans });
    }
  }
  return mismatches;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let query = supabase
    .from("prediction_records")
    .select("*")
    .eq("slate_date", args.date)
    .order("id", { ascending: true });
  if (args.sport !== "all") query = query.eq("sport", args.sport);
  const { data, error } = await query;
  if (error) throw new Error(`prediction_records query failed: ${error.message}`);

  const records = ((data ?? []) as PredictionRecordRow[]).filter(
    (record) =>
      !record.launch_day &&
      isPublicallyTracked(record.sport, record.slate_date) &&
      !isTossUp(record),
  );
  const recordIds = records.map((r) => r.id).filter((id): id is number => id !== undefined);
  const gradeByRecordId = await fetchGrades(recordIds);
  const rows: Row[] = records.map((record) => ({
    record,
    grade: record.id !== undefined ? gradeByRecordId.get(record.id) ?? null : null,
  }));

  const expected = buildExpectedBuckets(rows);
  const nextDate = shiftDate(args.date, 1);
  const aggregate = await computeTrackingAggregate({
    supabase,
    sport: args.sport === "all" ? undefined : args.sport,
    to: nextDate,
    includeLaunchDay: false,
  });
  const actual = aggregate.yesterday.bySportMarket.map(compactActualBucket);
  const mismatches = compareBuckets(expected, actual);

  const result = {
    mode: "tracking_consistency_audit",
    noPredictionChanges: true,
    noGradeChanges: true,
    noTrackingChanges: true,
    date: args.date,
    sport: args.sport,
    aggregateYesterdayDate: aggregate.yesterday.date,
    sourceRows: records.length,
    gradedRows: rows.filter((r) => r.grade !== null).length,
    expected,
    actual,
    mismatches,
    pass: mismatches.length === 0,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Tracking Consistency Audit — ${args.sport} ${args.date}`);
    console.log(`Source rows: ${result.sourceRows} · Graded rows: ${result.gradedRows}`);
    console.log(`Aggregate yesterday date: ${result.aggregateYesterdayDate ?? "none"}`);
    console.log(`Mismatches: ${mismatches.length}`);
    if (mismatches.length > 0) {
      console.log(JSON.stringify(mismatches, null, 2));
    }
  }

  if (mismatches.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
