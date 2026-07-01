import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import {
  buildAiAuditorCostPreview,
  buildDailyEdgeResponseForCostPreview,
  eachDateInclusive,
  parseAiAuditorMarkets,
  type AiAuditorCompactMarketPayload,
  type AiAuditorPayloadEstimate,
} from "@/lib/services/aiAuditor/costPreview";
import type { Sport } from "@/lib/types/domain/Sport";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";

type Args = {
  sport: Sport;
  from: string;
  to: string;
  markets: string;
  json: boolean;
};

type ResultRow = {
  result: string;
  units: number;
  oddsAmerican: number | null;
};

type FlatRow = {
  payload: AiAuditorPayloadEstimate;
  market: AiAuditorCompactMarketPayload;
  result: ResultRow | null;
};

type Rule = {
  id: string;
  market: Market;
  description: string;
  apply: (row: FlatRow) => Grade;
};

const GRADES: Grade[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];
const MARKETS: Market[] = ["moneyline", "total", "first_inning"];

function parseArgs(argv: string[]): Args {
  const out: Args = {
    sport: "mlb",
    from: "2026-06-22",
    to: "2026-06-28",
    markets: "ML,TOTAL,FI",
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
    if (key === "sport") out.sport = value.toLowerCase() as Sport;
    else if (key === "from") out.from = value;
    else if (key === "to") out.to = value;
    else if (key === "markets") out.markets = value;
  }
  return out;
}

function inc(map: Record<string, number>, key: string | null | undefined): void {
  map[key ?? "unknown"] = (map[key ?? "unknown"] ?? 0) + 1;
}

function resultKey(externalId: number, market: Market): string {
  return `${externalId}:${market}`;
}

function americanUnits(odds: number | null, result: string | null | undefined): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (odds === null || odds === 0) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

async function loadPostgameResults(args: { sport: Sport; from: string; to: string; payloads: AiAuditorPayloadEstimate[] }) {
  const { supabase } = await import("@/lib/db/supabase");
  const externalIds = Array.from(new Set(args.payloads.map((payload) => payload.externalId)));
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, external_id")
    .eq("sport", args.sport)
    .in("external_id", externalIds);
  if (gamesError) throw new Error(gamesError.message);
  const internalToExternal = new Map<number, number>();
  for (const game of (games ?? []) as Array<{ id: number; external_id: number }>) {
    internalToExternal.set(game.id, game.external_id);
  }
  const { data, error } = await supabase
    .from("prediction_records")
    .select("game_id,market,odds_american,prediction_grades(result)")
    .eq("sport", args.sport)
    .gte("slate_date", args.from)
    .lte("slate_date", args.to)
    .in("game_id", Array.from(internalToExternal.keys()))
    .in("market", MARKETS);
  if (error) throw new Error(error.message);
  const out = new Map<string, ResultRow>();
  for (const record of (data ?? []) as Array<{
    game_id: number;
    market: Market;
    odds_american: number | null;
    prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
  }>) {
    const externalId = internalToExternal.get(record.game_id);
    if (externalId === undefined) continue;
    const grade = Array.isArray(record.prediction_grades) ? record.prediction_grades[0] ?? null : record.prediction_grades;
    const result = grade?.result ?? "unknown";
    out.set(resultKey(externalId, record.market), {
      result,
      units: americanUnits(record.odds_american, result),
      oddsAmerican: record.odds_american,
    });
  }
  return out;
}

function rank(grade: string | null | undefined): number {
  return GRADES.indexOf(grade as Grade);
}

function gradeAt(value: string | null | undefined): Grade {
  return GRADES.includes(value as Grade) ? value as Grade : "No Play";
}

function capGrade(original: Grade, cap: Grade): Grade {
  return rank(original) > rank(cap) ? cap : original;
}

function hasSharp(value: unknown): boolean {
  const sharp = value as { rows?: unknown[]; signal?: string | null; label?: string | null } | null;
  return Boolean(sharp && (sharp.signal || sharp.label || (Array.isArray(sharp.rows) && sharp.rows.length > 0)));
}

function marketResistance(row: AiAuditorCompactMarketPayload): boolean {
  return /resistance|mixed/.test(row.marketRead?.status ?? "") || row.sourceConflict === true;
}

function dataWarning(row: AiAuditorCompactMarketPayload): boolean {
  return row.dataQuality.reviewFlags.length > 0;
}

function criticalFiWarning(row: AiAuditorCompactMarketPayload): boolean {
  return row.dataQuality.reviewFlags.some((flag) => /starter|lineup|injury|stale|partial|mismatch/i.test(flag));
}

function lineOpposes(row: AiAuditorCompactMarketPayload): boolean {
  const open = row.lineMovement.openAmerican;
  const current = row.lineMovement.currentAmerican;
  if (open === null || current === null) return false;
  const delta = current - open;
  if (Math.abs(delta) < 8) return false;
  return current < 0 ? delta > 0 : delta < 0;
}

function splitKey(row: AiAuditorCompactMarketPayload): string {
  if (row.market === "moneyline") return row.priceAmerican !== null && row.priceAmerican < 0 ? "favorite" : "dog";
  if (row.market === "total") return /under/i.test(row.pick ?? "") ? "under" : /over/i.test(row.pick ?? "") ? "over" : "unknown";
  return /nrfi/i.test(row.pick ?? "") ? "nrfi" : /yrfi/i.test(row.pick ?? "") ? "yrfi" : "unknown";
}

function buildRows(payloads: AiAuditorPayloadEstimate[], results: Map<string, ResultRow>): FlatRow[] {
  return payloads.flatMap((payload) =>
    payload.payload.markets.map((market) => ({
      payload,
      market,
      result: results.get(resultKey(payload.externalId, market.market)) ?? null,
    })),
  );
}

function recordSummary(rows: Array<{ grade: Grade; result: ResultRow | null }>) {
  const out: Record<string, { count: number; wins: number; losses: number; voids: number; pending: number; unknown: number; units: number; winRate: number | null }> = {};
  for (const grade of GRADES) out[grade] = { count: 0, wins: 0, losses: 0, voids: 0, pending: 0, unknown: 0, units: 0, winRate: null };
  for (const row of rows) {
    const target = out[row.grade];
    target.count += 1;
    const result = row.result?.result ?? "unknown";
    if (result === "win") target.wins += 1;
    else if (result === "loss") target.losses += 1;
    else if (result === "void") target.voids += 1;
    else if (result === "pending") target.pending += 1;
    else target.unknown += 1;
    target.units = +(target.units + Number(row.result?.units ?? 0)).toFixed(4);
    const settled = target.wins + target.losses;
    target.winRate = settled > 0 ? +(target.wins / settled).toFixed(4) : null;
  }
  return out;
}

function evaluateRule(rule: Rule, allRows: FlatRow[]) {
  const rows = allRows.filter((row) => row.market.market === rule.market);
  const originalRows = rows.map((row) => ({ grade: gradeAt(row.market.playGrade), result: row.result }));
  const simulatedRows = rows.map((row) => ({ grade: rule.apply(row), result: row.result }));
  let winnersRemoved = 0;
  let losersRemoved = 0;
  let winnersPromoted = 0;
  let losersPromoted = 0;
  let unitsImpact = 0;
  let changed = 0;
  const examples: string[] = [];
  for (const row of rows) {
    const original = gradeAt(row.market.playGrade);
    const simulated = rule.apply(row);
    if (original === simulated) continue;
    changed += 1;
    const result = row.result?.result ?? "unknown";
    const publicOriginal = original === "Lean" || original === "Best Angle";
    const publicSimulated = simulated === "Lean" || simulated === "Best Angle";
    if (publicOriginal && !publicSimulated) {
      if (result === "win") winnersRemoved += 1;
      if (result === "loss") {
        losersRemoved += 1;
        unitsImpact = +(unitsImpact - Number(row.result?.units ?? 0)).toFixed(4);
      }
    }
    if (rank(simulated) > rank(original)) {
      if (result === "win") winnersPromoted += 1;
      if (result === "loss") losersPromoted += 1;
    }
    if (examples.length < 8) {
      examples.push(`${row.payload.date} ${row.payload.matchup} ${row.market.market} ${row.market.pick}: ${original}->${simulated} ${result}`);
    }
  }
  const original = recordSummary(originalRows);
  const simulated = recordSummary(simulatedRows);
  return {
    id: rule.id,
    market: rule.market,
    description: rule.description,
    sampleSize: rows.length,
    changed,
    originalBestAngle: original["Best Angle"],
    simulatedBestAngle: simulated["Best Angle"],
    originalLean: original.Lean,
    simulatedLean: simulated.Lean,
    originalCaution: original.Caution,
    simulatedCaution: simulated.Caution,
    winnersRemoved,
    losersRemoved,
    winnersPromoted,
    losersPromoted,
    netUnitsImpact: unitsImpact,
    overfitWarning: rows.length < 100 || changed < 10 ? "High overfit risk: one-week sample and/or small changed cohort." : "Moderate overfit risk: still one-week sample.",
    examples,
  };
}

function mlRules(): Rule[] {
  const heavyCap = (threshold: number, edgeThreshold: number, cap: Grade): Rule => ({
    id: `ml_heavy_juice_cap_${Math.abs(threshold)}_${cap.toLowerCase()}`,
    market: "moneyline",
    description: `Cap ML Best Angle worse than ${threshold} to ${cap} unless model edge >= ${edgeThreshold}.`,
    apply: ({ market }) => {
      const original = gradeAt(market.playGrade);
      if (original === "Best Angle" && (market.priceAmerican ?? 0) < threshold && (market.modelMarketGapPct ?? 0) < edgeThreshold) {
        return cap;
      }
      return original;
    },
  });
  return [
    heavyCap(-150, 8, "Lean"),
    heavyCap(-160, 9, "Lean"),
    heavyCap(-175, 10, "Watchlist"),
    heavyCap(-200, 11, "Watchlist"),
    {
      id: "ml_missing_sharp_best_angle_cap",
      market: "moneyline",
      description: "Cap ML Best Angle to Lean when sharp source missing unless strong edge, support/aligned read, and price not heavy juice.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        if (original !== "Best Angle" || hasSharp(market.sharpBookSplits)) return original;
        const strongException = (market.modelMarketGapPct ?? 0) >= 9 &&
          /aligned|support/.test(market.marketRead?.status ?? "") &&
          (market.priceAmerican ?? 0) >= -150;
        return strongException ? original : "Lean";
      },
    },
    {
      id: "ml_resistance_best_angle_cap",
      market: "moneyline",
      description: "Cap ML Best Angle with market resistance/mixed to Lean unless edge >= 10.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        return original === "Best Angle" && marketResistance(market) && (market.modelMarketGapPct ?? 0) < 10 ? "Lean" : original;
      },
    },
    {
      id: "ml_data_warning_compound_cap",
      market: "moneyline",
      description: "Cap ML Best Angle to Lean when data warning combines with heavy juice or market resistance.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        const compound = dataWarning(market) && (((market.priceAmerican ?? 0) < -150) || marketResistance(market));
        return original === "Best Angle" && compound ? "Lean" : original;
      },
    },
    {
      id: "ml_watchlist_plus_price_promotion",
      market: "moneyline",
      description: "Promote ML Watchlist to Lean when plus/dog price, edge >= 3, no data warning, and support/aligned read.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        if (original === "Watchlist" && (market.priceAmerican ?? -1) > 0 && (market.modelMarketGapPct ?? 0) >= 3 && !dataWarning(market) && /aligned|support/.test(market.marketRead?.status ?? "")) {
          return "Lean";
        }
        return original;
      },
    },
    {
      id: "ml_combined_v3_candidate",
      market: "moneyline",
      description: "Combined ML candidate: heavy-juice/missing-sharp/resistance/data caps plus selective dog Watchlist promotion.",
      apply: (row) => {
        let grade = gradeAt(row.market.playGrade);
        const m = row.market;
        if (grade === "Best Angle") {
          if ((m.priceAmerican ?? 0) < -175 && (m.modelMarketGapPct ?? 0) < 11) grade = "Watchlist";
          else if ((m.priceAmerican ?? 0) < -150 && (m.modelMarketGapPct ?? 0) < 9) grade = "Lean";
          else if (!hasSharp(m.sharpBookSplits) && !((m.modelMarketGapPct ?? 0) >= 9 && /aligned|support/.test(m.marketRead?.status ?? "") && (m.priceAmerican ?? 0) >= -150)) grade = "Lean";
          else if (marketResistance(m) && (m.modelMarketGapPct ?? 0) < 10) grade = "Lean";
          else if (dataWarning(m) && (((m.priceAmerican ?? 0) < -150) || marketResistance(m))) grade = "Lean";
        }
        if (grade === "Watchlist" && (m.priceAmerican ?? -1) > 0 && (m.modelMarketGapPct ?? 0) >= 3 && !dataWarning(m) && /aligned|support/.test(m.marketRead?.status ?? "")) {
          grade = "Lean";
        }
        return grade;
      },
    },
  ];
}

function totalRules(): Rule[] {
  return [
    {
      id: "total_best_angle_resistance_or_warning_cap",
      market: "total",
      description: "Cap Totals Best Angle to Lean when resistance, line opposition, or data warning exists unless edge >= 9.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        if (original === "Best Angle" && (marketResistance(market) || lineOpposes(market) || dataWarning(market)) && (market.modelMarketGapPct ?? 0) < 9) return "Lean";
        return original;
      },
    },
    {
      id: "total_thin_edge_best_angle_cap",
      market: "total",
      description: "Cap Totals Best Angle to Lean when model edge < 7.",
      apply: ({ market }) => gradeAt(market.playGrade) === "Best Angle" && (market.modelMarketGapPct ?? 0) < 7 ? "Lean" : gradeAt(market.playGrade),
    },
    {
      id: "total_lean_protection",
      market: "total",
      description: "Protect Totals Lean: no downgrade for mixed/resistance alone; only cap Best Angles.",
      apply: ({ market }) => gradeAt(market.playGrade),
    },
    {
      id: "total_watchlist_edge_promotion",
      market: "total",
      description: "Promote Totals Watchlist to Lean when edge >= 5, price playable, no data warning, and no line opposition.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        if (original === "Watchlist" && (market.modelMarketGapPct ?? 0) >= 5 && (market.priceAmerican ?? -200) >= -125 && !dataWarning(market) && !lineOpposes(market)) return "Lean";
        return original;
      },
    },
    {
      id: "total_combined_v3_candidate",
      market: "total",
      description: "Combined Totals candidate: cap only vulnerable Best Angles and selectively promote clean Watchlists.",
      apply: ({ market }) => {
        let grade = gradeAt(market.playGrade);
        if (grade === "Best Angle" && ((marketResistance(market) || lineOpposes(market) || dataWarning(market)) && (market.modelMarketGapPct ?? 0) < 9)) grade = "Lean";
        if (grade === "Best Angle" && (market.modelMarketGapPct ?? 0) < 7) grade = "Lean";
        if (grade === "Watchlist" && (market.modelMarketGapPct ?? 0) >= 5 && (market.priceAmerican ?? -200) >= -125 && !dataWarning(market) && !lineOpposes(market)) grade = "Lean";
        return grade;
      },
    },
  ];
}

function fiRules(): Rule[] {
  return [
    {
      id: "fi_lean_protection",
      market: "first_inning",
      description: "Protect FI Lean from downgrade for missing/no market signal alone.",
      apply: ({ market }) => gradeAt(market.playGrade),
    },
    {
      id: "fi_cap_only_critical_or_thin",
      market: "first_inning",
      description: "Cap FI Lean to Watchlist only for critical starter/lineup/stale issue, unplayable price, or thin edge.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        const unplayable = (market.priceAmerican ?? 0) < -160;
        const thin = (market.modelMarketGapPct ?? 0) < 2;
        return original === "Lean" && (criticalFiWarning(market) || unplayable || thin) ? "Watchlist" : original;
      },
    },
    {
      id: "fi_watchlist_to_lean_test",
      market: "first_inning",
      description: "Promote FI Watchlist to Lean when price playable and no critical warning.",
      apply: ({ market }) => {
        const original = gradeAt(market.playGrade);
        return original === "Watchlist" && (market.priceAmerican ?? -200) >= -150 && !criticalFiWarning(market) ? "Lean" : original;
      },
    },
    {
      id: "fi_combined_protected_candidate",
      market: "first_inning",
      description: "Combined FI candidate: protect Lean; promote tiny Watchlist sample cautiously; cap only critical/thin/unplayable.",
      apply: ({ market }) => {
        let grade = gradeAt(market.playGrade);
        const unplayable = (market.priceAmerican ?? 0) < -160;
        const thin = (market.modelMarketGapPct ?? 0) < 2;
        if (grade === "Lean" && (criticalFiWarning(market) || unplayable || thin)) grade = "Watchlist";
        if (grade === "Watchlist" && (market.priceAmerican ?? -200) >= -150 && !criticalFiWarning(market)) grade = "Lean";
        return grade;
      },
    },
  ];
}

function featureSeparators(rows: FlatRow[], market: Market, grade: Grade) {
  const selected = rows.filter((row) => row.market.market === market && row.market.playGrade === grade);
  const group = (result: string) => selected.filter((row) => row.result?.result === result);
  const summarize = (items: FlatRow[]) => {
    const byRead: Record<string, number> = {};
    const bySplit: Record<string, number> = {};
    for (const row of items) {
      inc(byRead, row.market.marketRead?.status);
      inc(bySplit, splitKey(row.market));
    }
    const avg = (values: number[]) => values.length ? +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4) : null;
    return {
      count: items.length,
      avgEdge: avg(items.map((row) => Number(row.market.modelMarketGapPct ?? 0))),
      avgPrice: avg(items.map((row) => Number(row.market.priceAmerican ?? 0))),
      dataWarningRate: items.length ? +(items.filter((row) => dataWarning(row.market)).length / items.length).toFixed(4) : null,
      missingSharpRate: items.length ? +(items.filter((row) => !hasSharp(row.market.sharpBookSplits)).length / items.length).toFixed(4) : null,
      marketRead: byRead,
      split: bySplit,
    };
  };
  return { winners: summarize(group("win")), losers: summarize(group("loss")) };
}

function proposal() {
  return {
    mlbMoneyline: {
      bestAngle: ["Edge >= 9 if price worse than -150; otherwise edge >= 7", "No heavy-juice Best Angle worse than -175 without exceptional edge", "Market resistance requires explicit model-edge override", "Data warning + heavy juice caps to Lean"],
      lean: ["Playable price", "Edge >= 4", "Resistance acceptable only with honest override copy"],
      watchlistPromotion: ["Prefer plus/dog or fair price", "Edge >= 3", "Support/aligned read", "No data warning"],
    },
    mlbTotals: {
      bestAngle: ["Edge >= 7", "Playable price", "No meaningful line opposition/data warning unless edge >= 9"],
      leanProtection: ["Do not downgrade Lean for mixed/resistance alone", "Require thin edge, opposing movement, or data issue to cap"],
    },
    mlbFirstInning: {
      leanProtection: ["Missing FI market signal is low-materiality", "Preserve FI Lean unless critical starter/lineup/stale issue, unplayable price, or edge < 2"],
      downgradeCriteria: ["starter/lineup mismatch", "stale starter data", "price worse than -160", "thin model edge"],
    },
    aiV3Role: [
      "Review deterministic grade candidate, not replace it.",
      "Explain Market Read and contradictions.",
      "Flag material data issues.",
      "Recommend promotion/downgrade only when deterministic feature scores support it.",
      "Do not be the primary grade engine.",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.AI_AUDITOR_COST_PREVIEW_ONLY = "true";
  const responses: Array<{ date: string; response: DailyEdgeResponse }> = [];
  for (const date of eachDateInclusive(args.from, args.to)) {
    responses.push({ date, response: await buildDailyEdgeResponseForCostPreview({ sport: args.sport, date }) });
  }
  const preview = buildAiAuditorCostPreview({
    sport: args.sport,
    from: args.from,
    to: args.to,
    markets: parseAiAuditorMarkets(args.markets),
    refreshesPerDay: 1,
    miniEscalationRates: [0.05, 0.1, 0.2],
    skipUnchangedPayloads: false,
    oneCallPerGameCard: true,
    includePeakSlateAssumptions: false,
    payloadsByDate: responses,
  });
  const results = await loadPostgameResults({ sport: args.sport, from: args.from, to: args.to, payloads: preview.payloads });
  const rows = buildRows(preview.payloads, results);
  const rules = [...mlRules(), ...totalRules(), ...fiRules()];
  const report = {
    mode: "deterministic_counterfactual_no_openai",
    noOpenAiCalls: true,
    noLiveChanges: true,
    sport: args.sport,
    from: args.from,
    to: args.to,
    rows: rows.length,
    cards: preview.payloads.length,
    ruleResults: rules.map((rule) => evaluateRule(rule, rows)),
    featureSeparators: {
      mlWatchlist: featureSeparators(rows, "moneyline", "Watchlist"),
      totalBestAngle: featureSeparators(rows, "total", "Best Angle"),
      totalLean: featureSeparators(rows, "total", "Lean"),
      fiLean: featureSeparators(rows, "first_inning", "Lean"),
      fiWatchlist: featureSeparators(rows, "first_inning", "Watchlist"),
    },
    proposedV3DeterministicGradeLayer: proposal(),
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("AI Auditor Deterministic Counterfactual Calibration (no OpenAI calls)");
  console.log(`Range: ${args.sport} ${args.from}..${args.to}; cards=${report.cards}; marketRows=${report.rows}`);
  for (const result of report.ruleResults) {
    console.log(`${result.id}: ${JSON.stringify(result)}`);
  }
  console.log("Feature separators:");
  console.log(JSON.stringify(report.featureSeparators, null, 2));
  console.log("Proposed v3 deterministic grade layer:");
  console.log(JSON.stringify(report.proposedV3DeterministicGradeLayer, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
