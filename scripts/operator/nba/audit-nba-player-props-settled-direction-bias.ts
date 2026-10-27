/** SELECT-only release-pure NBA player-props directional-bias audit. */
import { supabase } from "../../../lib/db/supabase";
import {
  decodeNbaPlayerPropsPrivatePayload,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateStore";
import {
  decodeNbaPlayerPropsPrivateTrackingHistory,
  type NbaPlayerPropsPrivateTrackingRow,
} from "../../../lib/services/nba/nbaPlayerPropsPrivateTracking";
import {
  buildNbaPlayerPropsSettlementRevision,
  nbaPlayerPropsSettlementKey,
  type NbaPlayerPropsSettlementHistory,
  type NbaPlayerPropsSettlementRevision,
} from "../../../lib/services/nba/nbaPlayerPropsSettlementStore";
import { readNbaPlayerPropsCurrentState } from "../../../lib/services/nba/nbaPlayerPropsCurrentState";
import { nbaPlayerPropsFrozenRuntimeArtifact } from "../../../lib/services/nba/nbaPlayerPropsFrozenRuntime";

type Side = "over" | "under";
type SnapshotRow = Readonly<{ snapshot_key: string; payload: unknown }>;
type Settled = Readonly<{
  slateDate: string;
  row: NbaPlayerPropsPrivateTrackingRow;
  actual: number;
  outcomeSide: Side;
  independentSide: Side;
  rawFinalProbability: number;
}>;

const frozenArtifact = nbaPlayerPropsFrozenRuntimeArtifact();

const SIDE_CALIBRATED_GRADE_CANDIDATE = {
  points: { signal: "model_market_average_probability", overBonus: -0.05 },
  assists: { signal: "final_probability", overBonus: -0.025 },
  points_assists: { signal: "final_probability", overBonus: 0.025 },
} as const;

function value(name: string): string | null {
  const argument = process.argv.find((item) => item.startsWith(`--${name}=`));
  return argument?.slice(name.length + 3) ?? null;
}

function actionable(grade: string): boolean {
  return grade === "Lean" || grade === "Best Angle";
}

function decisionKey(row: NbaPlayerPropsPrivateTrackingRow): string {
  return [row.decisionRelease, row.gameId, row.playerId, row.market, row.line].join("|");
}

function suffix(input: string): string {
  return input.match(/(\d+)$/)?.[1] ?? input;
}

function latestSettlements(history: NbaPlayerPropsSettlementHistory | null): Map<string, NbaPlayerPropsSettlementRevision> {
  const latest = new Map<string, NbaPlayerPropsSettlementRevision>();
  for (const revision of history?.revisions ?? []) {
    const prior = latest.get(revision.rowKey);
    if (!prior || revision.revision > prior.revision) latest.set(revision.rowKey, revision);
  }
  return latest;
}

function score(values: readonly Settled[]) {
  const result = (rows: readonly Settled[], side: "final" | "independent") => {
    const chosen = (row: Settled) => side === "final" ? row.row.side as Side : row.independentSide;
    const wins = rows.filter((row) => chosen(row) === row.outcomeSide).length;
    const overRows = rows.filter((row) => chosen(row) === "over");
    const underRows = rows.filter((row) => chosen(row) === "under");
    const sideResult = (items: readonly Settled[], selected: Side) => {
      const sideWins = items.filter((row) => row.outcomeSide === selected).length;
      return { records: items.length, wins: sideWins, losses: items.length - sideWins, hitRate: items.length ? sideWins / items.length : null };
    };
    return {
      records: rows.length,
      wins,
      losses: rows.length - wins,
      hitRate: rows.length ? wins / rows.length : null,
      overShare: rows.length ? overRows.length / rows.length : null,
      underShare: rows.length ? underRows.length / rows.length : null,
      bySide: {
        over: sideResult(overRows, "over"),
        under: sideResult(underRows, "under"),
      },
    };
  };
  const flips = values.filter((row) => row.independentSide !== row.row.side);
  return {
    final: result(values, "final"),
    independent: result(values, "independent"),
    marketReader: {
      flips: flips.length,
      overToUnder: flips.filter((row) => row.independentSide === "over" && row.row.side === "under").length,
      underToOver: flips.filter((row) => row.independentSide === "under" && row.row.side === "over").length,
      corrections: flips.filter((row) => row.independentSide !== row.outcomeSide && row.row.side === row.outcomeSide).length,
      harms: flips.filter((row) => row.independentSide === row.outcomeSide && row.row.side !== row.outcomeSide).length,
    },
  };
}

function sideCalibratedGradeCandidate(values: readonly Settled[]) {
  const baseline = values.filter((row) => actionable(row.row.grade));
  const baselineKeys = new Set(baseline.map((row) => decisionKey(row.row)));
  const selectedKeys = new Set<string>();
  const selectedBestKeys = new Set<string>();
  const groups = new Map<string, Settled[]>();
  for (const row of values) {
    if (!(row.row.market in SIDE_CALIBRATED_GRADE_CANDIDATE)) continue;
    const key = [row.row.decisionRelease, row.slateDate, row.row.market].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    const market = group[0]!.row.market as keyof typeof SIDE_CALIBRATED_GRADE_CANDIDATE;
    const definition = SIDE_CALIBRATED_GRADE_CANDIDATE[market];
    const incumbent = group.filter((row) => actionable(row.row.grade));
    const targetBest = incumbent.filter((row) => row.row.grade === "Best Angle").length;
    const eligible = group.filter((row) => row.row.finalProbability >= 0.5 && row.row.americanPrice >= -200
        && row.row.marketProbability !== null && (row.row.marketEvidence?.targetExcludedBooks ?? 0) >= 1)
      .sort((left, right) => candidateSignal(right, definition.signal, definition.overBonus)
        - candidateSignal(left, definition.signal, definition.overBonus)
        || right.row.finalProbability - left.row.finalProbability
        || decisionKey(left.row).localeCompare(decisionKey(right.row)));
    const eligibleKeys = new Set(eligible.map((row) => decisionKey(row.row)));
    const fallbacks = incumbent.filter((row) => !eligibleKeys.has(decisionKey(row.row)));
    const chosen = [...eligible, ...fallbacks].slice(0, incumbent.length);
    for (const row of chosen) selectedKeys.add(decisionKey(row.row));
    for (const row of chosen.slice(0, targetBest)) selectedBestKeys.add(decisionKey(row.row));
  }
  const candidate = values.filter((row) => {
    if (!(row.row.market in SIDE_CALIBRATED_GRADE_CANDIDATE)) return baselineKeys.has(decisionKey(row.row));
    return selectedKeys.has(decisionKey(row.row));
  });
  const candidateKeys = new Set(candidate.map((row) => decisionKey(row.row)));
  return {
    definitions: SIDE_CALIBRATED_GRADE_CANDIDATE,
    baseline: score(baseline),
    baselineBestAngle: score(baseline.filter((row) => row.row.grade === "Best Angle")),
    baselineLean: score(baseline.filter((row) => row.row.grade === "Lean")),
    candidate: score(candidate),
    candidateBestAngle: score(candidate.filter((row) => selectedBestKeys.has(decisionKey(row.row))
      || (!(row.row.market in SIDE_CALIBRATED_GRADE_CANDIDATE) && row.row.grade === "Best Angle"))),
    candidateLean: score(candidate.filter((row) => !selectedBestKeys.has(decisionKey(row.row))
      && ((row.row.market in SIDE_CALIBRATED_GRADE_CANDIDATE) || row.row.grade === "Lean"))),
    promotions: candidate.filter((row) => !baselineKeys.has(decisionKey(row.row))).length,
    demotions: baseline.filter((row) => !candidateKeys.has(decisionKey(row.row))).length,
  };
}

function candidateSignal(
  row: Settled,
  signal: "model_market_average_probability" | "final_probability",
  overBonus: number,
): number {
  const base = signal === "final_probability"
    ? row.row.finalProbability
    : (row.rawFinalProbability + (row.row.marketProbability ?? row.rawFinalProbability)) / 2;
  return base + (row.row.side === "over" ? overBonus : 0);
}

function rawFinalProbability(row: NbaPlayerPropsPrivateTrackingRow): number {
  if (!(row.market in frozenArtifact.distributions)) return row.finalProbability;
  const distribution = frozenArtifact.distributions[row.market as keyof typeof frozenArtifact.distributions];
  const z = (row.line - (row.finalProjection + distribution.bias)) / distribution.standardDeviation;
  const probabilityOver = Math.min(0.995, Math.max(0.005, 1 - normalCdf(z)));
  return row.side === "over" ? probabilityOver : 1 - probabilityOver;
}

function normalCdf(input: number): number {
  const sign = input < 0 ? -1 : 1;
  const x = Math.abs(input) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

async function main(): Promise<void> {
  const season = Number(value("season") ?? "2026");
  const start = value("start") ?? "2026-10-20";
  const end = value("end") ?? "2027-04-20";
  if (!Number.isInteger(season)) throw new Error("--season must be an integer.");
  const { data, error } = await supabase.from("lab_response_snapshots")
    .select("snapshot_key,payload")
    .like("snapshot_key", `nba::player-props-private-tracking::${season}::%`);
  if (error) throw new Error(`NBA player-props tracking read failed: ${error.message}`);
  const { data: settlementData, error: settlementError } = await supabase.from("lab_response_snapshots")
    .select("snapshot_key,payload")
    .eq("snapshot_key", nbaPlayerPropsSettlementKey(season))
    .maybeSingle();
  if (settlementError) throw new Error(`NBA player-props settlement read failed: ${settlementError.message}`);
  const settlement = decodeNbaPlayerPropsPrivatePayload<NbaPlayerPropsSettlementHistory>(settlementData?.payload, "tracking_history");
  const revisions = latestSettlements(settlement);
  const currentState = await readNbaPlayerPropsCurrentState({ client: supabase, season });
  const boxByGamePlayer = new Map((currentState?.boxes ?? []).map((box) => [`${box.gameId}|${box.playerId}`, box]));
  const settled: Settled[] = [];
  const conflicts: string[] = [];
  let decodedTrackingSnapshots = 0;
  let canonicalTrackingRows = 0;
  for (const snapshot of (data ?? []) as SnapshotRow[]) {
    const history = decodeNbaPlayerPropsPrivateTrackingHistory(snapshot.payload);
    if (!history || history.slateDate < start || history.slateDate > end) continue;
    decodedTrackingSnapshots += 1;
    const canonical = history.rows.filter((row) => row.canonicalMainLine && (row.side === "over" || row.side === "under"));
    canonicalTrackingRows += canonical.length;
    const byDecision = new Map<string, NbaPlayerPropsPrivateTrackingRow[]>();
    for (const row of canonical) byDecision.set(decisionKey(row), [...(byDecision.get(decisionKey(row)) ?? []), row]);
    for (const [key, rows] of byDecision) {
      const sides = new Set(rows.map((row) => row.side));
      if (sides.size !== 1) { conflicts.push(key); continue; }
      const row = rows[0]!;
      const revision = rows.map((candidate) => revisions.get(candidate.rowKey)).find((candidate) => candidate?.actual !== null)
        ?? (() => {
          const box = boxByGamePlayer.get(`${suffix(row.gameId)}|${suffix(row.playerId)}`) ?? null;
          return box
            ? buildNbaPlayerPropsSettlementRevision({ row, box, prior: null, observedAt: currentState?.updatedAt ?? new Date().toISOString() }).revision
            : null;
        })();
      if (!revision || revision.actual === null || revision.result === "push" || revision.result === "void") continue;
      const outcomeSide: Side = revision.actual > row.line ? "over" : "under";
      settled.push({
        slateDate: history.slateDate,
        row,
        actual: revision.actual,
        outcomeSide,
        independentSide: row.independentProjection > row.line ? "over" : "under",
        rawFinalProbability: rawFinalProbability(row),
      });
    }
  }
  const markets = [...new Set(settled.map((row) => row.row.market))].sort();
  const releases = [...new Set(settled.map((row) => row.row.decisionRelease))].sort();
  process.stdout.write(`${JSON.stringify({
    release: "nba_player_props_settled_direction_bias_audit_2026_10_27_r1",
    mode: "select_only",
    providerCalls: 0,
    season,
    start,
    end,
    storedTrackingSnapshots: (data ?? []).length,
    decodedTrackingSnapshots,
    canonicalTrackingRows,
    settlementRevisions: revisions.size,
    currentStateBoxes: currentState?.boxes.length ?? 0,
    settledDecisionScopes: settled.length,
    conflictingCanonicalScopes: conflicts.length,
    overall: score(settled),
    actionable: score(settled.filter((row) => actionable(row.row.grade))),
    sideCalibratedGradeCandidate: sideCalibratedGradeCandidate(settled),
    byMarket: Object.fromEntries(markets.map((market) => [market, {
      all: score(settled.filter((row) => row.row.market === market)),
      actionable: score(settled.filter((row) => row.row.market === market && actionable(row.row.grade))),
    }])),
    bySlateDate: Object.fromEntries([...new Set(settled.map((row) => row.slateDate))].sort().map((slateDate) => {
      const slateRows = settled.filter((row) => row.slateDate === slateDate);
      return [slateDate, {
        all: score(slateRows),
        actionable: score(slateRows.filter((row) => actionable(row.row.grade))),
        byMarket: Object.fromEntries(markets.map((market) => [market, {
          all: score(slateRows.filter((row) => row.row.market === market)),
          actionable: score(slateRows.filter((row) => row.row.market === market && actionable(row.row.grade))),
        }])),
      }];
    })),
    byRelease: Object.fromEntries(releases.map((release) => {
      const releaseRows = settled.filter((row) => row.row.decisionRelease === release);
      return [release, {
        all: score(releaseRows),
        actionable: score(releaseRows.filter((row) => actionable(row.row.grade))),
        sideCalibratedGradeCandidate: sideCalibratedGradeCandidate(releaseRows),
        byMarket: Object.fromEntries(markets.map((market) => [market, {
          all: score(releaseRows.filter((row) => row.row.market === market)),
          actionable: score(releaseRows.filter((row) => row.row.market === market && actionable(row.row.grade))),
        }])),
      }];
    })),
  }, null, 2)}\n`);
}

void main();
