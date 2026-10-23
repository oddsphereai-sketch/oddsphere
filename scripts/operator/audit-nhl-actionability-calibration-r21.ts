/**
 * SELECT-only NHL actionability calibration audit.
 *
 * The model side, probability, exact selected price, and outcome are immutable
 * inputs. This script changes no rows and evaluates only a downstream grade
 * candidate under a chronological selection/confirmation boundary.
 */

import { supabase } from "../../lib/db/supabase";

type Market = "moneyline" | "spread" | "total";
type Verdict = "best_angle" | "lean" | "watchlist" | "pass";
type Result = "win" | "loss" | "push";

type Grade = {
  result: string | null;
  win: boolean | null;
  loss: boolean | null;
  push: boolean | null;
};

type Row = {
  id: number;
  game_id: number;
  slate_date: string;
  locked_at: string;
  market: Market;
  model_probability: number;
  odds_american: number;
  play_grade: string | null;
  no_bet: boolean | null;
  model_version: string;
  snapshot_json: {
    model_output?: { expected_total_goals?: number | null };
    feature_inputs?: { market?: { market_total_line?: number | null } };
  } | null;
  prediction_grades: Grade | Grade[] | null;
};

type Candidate = {
  edgeFloor: number;
  probabilityFloor: Record<Market, number>;
};

const RELEASES = [
  "nhl_regular_2026_r14_best_angle_calibration",
  "nhl_regular_2026_r15_complete_multibook_market_ingestion",
  "nhl_regular_2026_r16_exact_quote_price_mapping",
  "nhl_regular_2026_r17_target_excluded_total_reconciliation",
  "nhl_regular_2026_r18_fast_state_direct_probability",
  "nhl_regular_2026_r19_fresh_quote_authority",
  "nhl_regular_2026_r20_verified_current_board",
] as const;

const MARKETS: readonly Market[] = ["moneyline", "spread", "total"];
const EDGE_FLOORS = [0, 0.01, 0.02, 0.03, 0.05] as const;
const PROBABILITY_FLOORS: Record<Market, readonly number[]> = {
  moneyline: [0.52, 0.54, 0.56, 0.58, 0.60],
  total: [0.52, 0.54, 0.56, 0.58, 0.60],
  spread: [0.54, 0.56, 0.58, 0.60, 0.62],
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function result(row: Row): Result | null {
  const grade = one(row.prediction_grades);
  if (!grade) return null;
  if (grade.result === "win" || grade.win) return "win";
  if (grade.result === "loss" || grade.loss) return "loss";
  if (grade.result === "push" || grade.push) return "push";
  return null;
}

function incumbentVerdict(row: Row): Verdict {
  if (row.play_grade === "best_signal" || row.play_grade === "best_angle") return "best_angle";
  if (row.play_grade === "market_watch" || row.play_grade === "watchlist") return "watchlist";
  if (row.play_grade === "pass") return "pass";
  if (row.play_grade === "model_only" || row.play_grade === "lean") return row.no_bet ? "pass" : "lean";
  return row.no_bet ? "pass" : "watchlist";
}

function implied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function exactEdge(row: Row): number {
  return row.model_probability - implied(row.odds_american);
}

function candidateVerdict(row: Row, candidate: Candidate): Verdict {
  if (!Number.isFinite(row.odds_american) || row.odds_american <= -900) return "pass";
  const edge = exactEdge(row);
  const incumbent = incumbentVerdict(row);
  const bestAngleQualified = incumbent === "best_angle"
    && (row.market !== "moneyline" || (row.model_probability >= 0.70 && edge >= 0.05))
    && (row.market !== "total" || (row.model_probability >= 0.65 && edge >= 0.05))
    && (row.market !== "spread" || (row.model_probability >= 0.70 && edge >= 0.05))
    && row.odds_american > -200;
  if (bestAngleQualified) return "best_angle";
  return row.model_probability >= candidate.probabilityFloor[row.market]
    && edge >= candidate.edgeFloor
    ? "lean"
    : "watchlist";
}

function structuralVerdict(row: Row): Verdict {
  if (!Number.isFinite(row.odds_american) || row.odds_american <= -900) return "pass";
  const edge = exactEdge(row);
  const incumbent = incumbentVerdict(row);
  const bestAngleQualified = incumbent === "best_angle"
    && (row.market !== "moneyline" || (row.model_probability >= 0.70 && edge >= 0.05))
    && (row.market !== "total" || (row.model_probability >= 0.65 && edge >= 0.05))
    && (row.market !== "spread" || (row.model_probability >= 0.70 && edge >= 0.05))
    && row.odds_american > -200;
  if (bestAngleQualified) return "best_angle";
  if (row.market === "moneyline") {
    return row.model_probability >= 0.58 && edge >= 0 ? "lean" : "watchlist";
  }
  if (row.market === "spread") {
    return row.model_probability >= 0.58 && edge >= 0.015 ? "lean" : "watchlist";
  }
  const projected = row.snapshot_json?.model_output?.expected_total_goals;
  const line = row.snapshot_json?.feature_inputs?.market?.market_total_line;
  const gap = Number.isFinite(projected) && Number.isFinite(line)
    ? Math.abs(Number(projected) - Number(line))
    : null;
  return gap !== null && gap >= 0.30 && edge >= 0 ? "lean" : "watchlist";
}

function unit(row: Row): number {
  const settled = result(row);
  if (settled === "push" || settled === null) return 0;
  if (settled === "loss") return -1;
  return row.odds_american > 0 ? row.odds_american / 100 : 100 / -row.odds_american;
}

function isActionable(verdict: Verdict): boolean {
  return verdict === "best_angle" || verdict === "lean";
}

function round(value: number | null, digits = 5): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function summarize(rows: readonly Row[], verdictFor: (row: Row) => Verdict) {
  const scoped = rows.map((row) => ({ row, verdict: verdictFor(row), result: result(row) }));
  const actionable = scoped.filter((entry) => isActionable(entry.verdict));
  const watchlists = scoped.filter((entry) => entry.verdict === "watchlist");
  const summary = (entries: typeof scoped) => {
    const resolved = entries.filter((entry) => entry.result === "win" || entry.result === "loss");
    const wins = resolved.filter((entry) => entry.result === "win").length;
    const probabilities = resolved.map((entry) => entry.row.model_probability);
    const meanProbability = probabilities.length
      ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
      : null;
    const accuracy = resolved.length ? wins / resolved.length : null;
    return {
      rows: entries.length,
      wins,
      losses: resolved.length - wins,
      pushes: entries.filter((entry) => entry.result === "push").length,
      accuracy: round(accuracy),
      units: round(entries.reduce((sum, entry) => sum + unit(entry.row), 0)),
      roi: round(entries.length ? entries.reduce((sum, entry) => sum + unit(entry.row), 0) / entries.length : null),
      brier: round(resolved.length ? resolved.reduce((sum, entry) => (
        sum + (entry.row.model_probability - (entry.result === "win" ? 1 : 0)) ** 2
      ), 0) / resolved.length : null),
      logLoss: round(resolved.length ? resolved.reduce((sum, entry) => {
        const probability = Math.max(0.001, Math.min(0.999, entry.row.model_probability));
        const outcome = entry.result === "win" ? 1 : 0;
        return sum - (outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
      }, 0) / resolved.length : null),
      meanProbability: round(meanProbability),
      calibrationGap: round(meanProbability === null || accuracy === null ? null : meanProbability - accuracy),
    };
  };
  const grades = Object.fromEntries((["best_angle", "lean", "watchlist", "pass"] as const).map((grade) => [
    grade,
    summary(scoped.filter((entry) => entry.verdict === grade)),
  ]));
  return {
    pricedRows: scoped.length,
    actionable: summary(actionable),
    watchlist: summary(watchlists),
    grades,
    byMarket: Object.fromEntries(MARKETS.map((market) => [market, {
      pricedRows: scoped.filter((entry) => entry.row.market === market).length,
      actionable: summary(actionable.filter((entry) => entry.row.market === market)),
      watchlist: summary(watchlists.filter((entry) => entry.row.market === market)),
    }])),
  };
}

function impact(rows: readonly Row[], candidate: Candidate) {
  return impactAgainst(rows, (row) => candidateVerdict(row, candidate));
}

function impactAgainst(rows: readonly Row[], verdictFor: (row: Row) => Verdict) {
  const rank: Record<Verdict, number> = { pass: 0, watchlist: 1, lean: 2, best_angle: 3 };
  const changes = rows.map((row) => {
    const before = incumbentVerdict(row);
    const after = verdictFor(row);
    return { row, before, after };
  });
  return {
    promotions: changes.filter((entry) => rank[entry.after] > rank[entry.before]).length,
    demotions: changes.filter((entry) => rank[entry.after] < rank[entry.before]).length,
    actionablePromotions: changes.filter((entry) => !isActionable(entry.before) && isActionable(entry.after)).length,
    actionableDemotions: changes.filter((entry) => isActionable(entry.before) && !isActionable(entry.after)).length,
    unchanged: changes.filter((entry) => entry.before === entry.after).length,
  };
}

function candidateKey(candidate: Candidate): string {
  return [candidate.edgeFloor, candidate.probabilityFloor.moneyline, candidate.probabilityFloor.total, candidate.probabilityFloor.spread].join("/");
}

function selectionEligible(summary: ReturnType<typeof summarize>, incumbent: ReturnType<typeof summarize>): boolean {
  const candidateAccuracy = summary.actionable.accuracy ?? -Infinity;
  const incumbentAccuracy = incumbent.actionable.accuracy ?? -Infinity;
  const candidateUnits = summary.actionable.units ?? -Infinity;
  const incumbentUnits = incumbent.actionable.units ?? -Infinity;
  return summary.actionable.rows >= Math.ceil(summary.pricedRows * 0.25)
    && MARKETS.every((market) => summary.byMarket[market].actionable.rows > 0)
    && candidateAccuracy >= incumbentAccuracy
    && candidateUnits >= incumbentUnits;
}

function compareCandidates(
  left: { candidate: Candidate; summary: ReturnType<typeof summarize> },
  right: { candidate: Candidate; summary: ReturnType<typeof summarize> },
): number {
  return (right.summary.actionable.units ?? -Infinity) - (left.summary.actionable.units ?? -Infinity)
    || (right.summary.actionable.accuracy ?? -Infinity) - (left.summary.actionable.accuracy ?? -Infinity)
    || Math.abs(left.summary.actionable.calibrationGap ?? Infinity) - Math.abs(right.summary.actionable.calibrationGap ?? Infinity)
    || left.candidate.edgeFloor - right.candidate.edgeFloor
    || left.candidate.probabilityFloor.moneyline - right.candidate.probabilityFloor.moneyline
    || left.candidate.probabilityFloor.total - right.candidate.probabilityFloor.total
    || left.candidate.probabilityFloor.spread - right.candidate.probabilityFloor.spread
    || right.summary.actionable.rows - left.summary.actionable.rows;
}

function buildCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  for (const edgeFloor of EDGE_FLOORS) {
    for (const moneyline of PROBABILITY_FLOORS.moneyline) {
      for (const total of PROBABILITY_FLOORS.total) {
        for (const spread of PROBABILITY_FLOORS.spread) {
          candidates.push({ edgeFloor, probabilityFloor: { moneyline, total, spread } });
        }
      }
    }
  }
  return candidates;
}

async function main(): Promise<void> {
  const { data, error } = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,locked_at,market,model_probability,odds_american,play_grade,no_bet,model_version,snapshot_json,prediction_grades:prediction_grades!prediction_record_id(result,win,loss,push)")
    .eq("sport", "nhl")
    .in("model_version", [...RELEASES])
    .not("locked_at", "is", null)
    .not("model_probability", "is", null)
    .not("odds_american", "is", null)
    .in("market", [...MARKETS])
    .order("locked_at", { ascending: true });
  if (error) throw new Error(error.message);
  const settled = ((data ?? []) as unknown as Row[]).filter((row) => result(row) !== null);
  const games = [...new Map(settled.map((row) => [row.game_id, row.locked_at])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1]));
  const selectionGameCount = Math.floor(games.length * 0.70);
  const selectionIds = new Set(games.slice(0, selectionGameCount).map(([gameId]) => gameId));
  const selection = settled.filter((row) => selectionIds.has(row.game_id));
  const confirmation = settled.filter((row) => !selectionIds.has(row.game_id));
  const incumbentSelection = summarize(selection, incumbentVerdict);
  const evaluated = buildCandidates().map((candidate) => ({
    candidate,
    summary: summarize(selection, (row) => candidateVerdict(row, candidate)),
  }));
  const eligible = evaluated.filter((entry) => selectionEligible(entry.summary, incumbentSelection)).sort(compareCandidates);
  if (eligible.length === 0) throw new Error("No candidate passed the predeclared selection gates.");
  const selected = eligible[0]!;
  const selectedVerdict = (row: Row) => candidateVerdict(row, selected.candidate);
  const structuralSummary = (rows: readonly Row[]) => ({
    incumbent: summarize(rows, incumbentVerdict),
    candidate: summarize(rows, structuralVerdict),
    impact: impactAgainst(rows, structuralVerdict),
  });
  const report = {
    release: "nhl_actionability_calibration_audit_2026_10_23_r1",
    readOnly: true,
    writes: 0,
    candidateGrid: buildCandidates().length,
    eligibleSelectionCandidates: eligible.length,
    chronology: {
      games: games.length,
      selectionGames: selectionGameCount,
      confirmationGames: games.length - selectionGameCount,
      selectionThrough: selection.at(-1)?.locked_at ?? null,
      confirmationFrom: confirmation[0]?.locked_at ?? null,
    },
    selectedCandidate: selected.candidate,
    selection: {
      incumbent: incumbentSelection,
      candidate: selected.summary,
      impact: impact(selection, selected.candidate),
    },
    confirmation: {
      incumbent: summarize(confirmation, incumbentVerdict),
      candidate: summarize(confirmation, selectedVerdict),
      impact: impact(confirmation, selected.candidate),
    },
    full: {
      incumbent: summarize(settled, incumbentVerdict),
      candidate: summarize(settled, selectedVerdict),
      impact: impact(settled, selected.candidate),
    },
    fixedStructuralCandidate: {
      rule: {
        moneyline: { probabilityFloor: 0.58, exactPriceEdgeFloor: 0 },
        total: { projectionLineGapFloor: 0.30, exactPriceEdgeFloor: 0 },
        spread: { probabilityFloor: 0.58, exactPriceEdgeFloor: 0.015 },
      },
      selection: structuralSummary(selection),
      confirmation: structuralSummary(confirmation),
      full: structuralSummary(settled),
    },
    byRelease: Object.fromEntries([...new Set(settled.map((row) => row.model_version))].map((release) => {
      const rows = settled.filter((row) => row.model_version === release);
      return [release, {
        games: new Set(rows.map((row) => row.game_id)).size,
        incumbent: summarize(rows, incumbentVerdict),
        candidate: summarize(rows, selectedVerdict),
        impact: impact(rows, selected.candidate),
      }];
    })),
    topSelectionCandidates: eligible.slice(0, 10).map((entry) => ({
      key: candidateKey(entry.candidate),
      candidate: entry.candidate,
      actionable: entry.summary.actionable,
      byMarket: Object.fromEntries(MARKETS.map((market) => [market, entry.summary.byMarket[market].actionable])),
    })),
  };
  if (process.argv.includes("--compact")) {
    const compactSummary = (summary: ReturnType<typeof summarize>) => ({
      pricedRows: summary.pricedRows,
      actionable: summary.actionable,
      watchlist: summary.watchlist,
      byMarket: Object.fromEntries(MARKETS.map((market) => [market, {
        actionable: summary.byMarket[market].actionable,
        watchlist: summary.byMarket[market].watchlist,
      }])),
    });
    console.log(JSON.stringify({
      release: report.release,
      readOnly: report.readOnly,
      chronology: report.chronology,
      gridSelectedCandidate: report.selectedCandidate,
      gridConfirmation: report.confirmation,
      fixedStructuralCandidate: report.fixedStructuralCandidate,
      byRelease: Object.fromEntries(Object.entries(report.byRelease).map(([release, value]) => [release, {
        games: value.games,
        incumbent: compactSummary(value.incumbent),
        gridCandidate: compactSummary(value.candidate),
        impact: value.impact,
      }])),
    }, null, 2));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
