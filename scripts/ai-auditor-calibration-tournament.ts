import type { Sport } from "@/lib/types/domain/Sport";

type Market = "moneyline" | "total" | "first_inning";
type Grade = "No Play" | "Caution" | "Watchlist" | "Lean" | "Best Angle";
type SplitName = "train" | "validation" | "full";

type Args = {
  sport: Sport;
  from: string | null;
  to: string | null;
  limit: number;
  top: number;
  json: boolean;
};

type RawPredictionRecord = {
  id: number;
  sport: string;
  slate_date: string;
  game_id: number | null;
  external_id: number | null;
  matchup: string | null;
  market: string | null;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  edge: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades: { result: string | null } | Array<{ result: string | null }> | null;
};

type Row = {
  id: number;
  sport: Sport;
  date: string;
  week: string;
  market: Market;
  gameId: number | null;
  externalId: number | null;
  matchup: string;
  pick: string | null;
  side: string | null;
  line: number | null;
  price: number | null;
  confidence: number | null;
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  originalGrade: Grade;
  result: string;
  units: number;
  locked: boolean;
  marketRead: string;
  lineDirection: "toward_pick" | "against_pick" | "flat" | "unknown";
  hasConsensus: boolean;
  hasSharp: boolean;
  missingHistoricalSource: boolean;
  sourceConflict: boolean;
  dataWarning: boolean;
  criticalDataWarning: boolean;
  split: "favorite" | "dog" | "over" | "under" | "nrfi" | "yrfi" | "unknown";
};

type Strategy = {
  id: string;
  market: Market | "overall";
  description: string;
  apply: (row: Row) => Grade;
};

const GRADES: Grade[] = ["No Play", "Caution", "Watchlist", "Lean", "Best Angle"];
const MARKETS: Market[] = ["moneyline", "total", "first_inning"];

function parseArgs(argv: string[]): Args {
  const out: Args = { sport: "mlb", from: null, to: null, limit: 20000, top: 10, json: false };
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
    else if (key === "limit") out.limit = Number(value);
    else if (key === "top") out.top = Number(value);
  }
  return out;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function rank(grade: Grade): number {
  return GRADES.indexOf(grade);
}

function normalizeMarket(value: string | null): Market | null {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "moneyline" || raw === "ml") return "moneyline";
  if (raw === "total" || raw === "ou" || raw === "over_under") return "total";
  if (raw === "first_inning" || raw === "nrfi" || raw === "yrfi" || raw === "fi") return "first_inning";
  return null;
}

function normalizeGrade(raw: string | null, bestAngle: boolean | null, noBet: boolean | null): Grade {
  if (bestAngle) return "Best Angle";
  const text = String(raw ?? "").toLowerCase().replace(/[_-]/g, " ");
  if (/best/.test(text)) return "Best Angle";
  if (/lean/.test(text)) return "Lean";
  if (/watch/.test(text) || /market aligned/.test(text)) return "Watchlist";
  if (/caution/.test(text)) return "Caution";
  if (noBet || /no bet|no play|pass/.test(text)) return "No Play";
  return "No Play";
}

function americanUnits(odds: number | null, result: string): number {
  if (result === "loss") return -1;
  if (result !== "win") return 0;
  if (!odds) return 0;
  return odds > 0 ? +(odds / 100).toFixed(4) : +(100 / Math.abs(odds)).toFixed(4);
}

function getPath(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let current = obj as Record<string, unknown> | null;
    let ok = true;
    for (const part of path.split(".")) {
      if (!current || typeof current !== "object" || !(part in current)) {
        ok = false;
        break;
      }
      current = current[part] as Record<string, unknown> | null;
    }
    if (ok && current !== undefined && current !== null) return current;
  }
  return null;
}

function boolish(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function extractMarketRead(snapshot: Record<string, unknown> | null, market: Market): string {
  const direct = getPath(snapshot, [
    "recommendationDecision.resolvedMarketRead.status",
    "resolvedMarketRead.status",
    "marketRead.status",
  ]);
  if (typeof direct === "string") return direct;
  const summary = getPath(snapshot, ["v2_1_audit.market_read_summary"]) as Record<string, unknown> | null;
  const side = market === "moneyline" ? summary?.market_read_ml_side : summary?.market_read_ou_side;
  if (typeof side === "string" && side !== "neutral") return side;
  return "unknown";
}

function sourcePresence(snapshot: Record<string, unknown> | null): { consensus: boolean; sharp: boolean; conflict: boolean; missingHistorical: boolean } {
  const consensus = Boolean(getPath(snapshot, [
    "recommendationDecision.consensusSplits",
    "consensusSplits",
    "public_splits",
    "v2_1_audit.market_read_summary.public_money_pct_over",
  ]));
  const sharp = Boolean(getPath(snapshot, [
    "recommendationDecision.sharpBookSplits",
    "sharpBookSplits",
    "sharp_signal",
    "public_splits.sharp",
  ]));
  const conflict = boolish(getPath(snapshot, [
    "recommendationDecision.sourceConflict",
    "sourceConflict",
    "public_splits.conflict",
    "v2_1_audit.market_read_summary.market_disagreement_ml",
    "v2_1_audit.market_read_summary.market_disagreement_ou",
  ]));
  return { consensus, sharp, conflict, missingHistorical: consensus && !sharp };
}

function dataWarnings(snapshot: Record<string, unknown> | null): { any: boolean; critical: boolean } {
  const json = JSON.stringify(snapshot ?? {}).toLowerCase();
  const any = /warning|missing|fallback|stale|lineup|starter|injury|provisional/.test(json);
  const critical = /starter|lineup|injury|stale|mismatch|critical/.test(json);
  return { any, critical };
}

function split(row: RawPredictionRecord, market: Market): Row["split"] {
  if (market === "moneyline") return (row.odds_american ?? 0) < 0 ? "favorite" : "dog";
  if (market === "total") return /under/i.test(row.pick ?? row.side ?? "") ? "under" : /over/i.test(row.pick ?? row.side ?? "") ? "over" : "unknown";
  return /nrfi/i.test(row.pick ?? row.side ?? "") ? "nrfi" : /yrfi/i.test(row.pick ?? row.side ?? "") ? "yrfi" : "unknown";
}

function lineDirection(_row: RawPredictionRecord): Row["lineDirection"] {
  return "unknown";
}

function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

async function loadRows(args: Args): Promise<Row[]> {
  const { supabase } = await import("@/lib/db/supabase");
  const rows: RawPredictionRecord[] = [];
  const pageSize = 1000;
  for (let from = 0; from < args.limit; from += pageSize) {
    let query = supabase
      .from("prediction_records")
      .select("id,sport,slate_date,game_id,external_id,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,edge,play_grade,best_angle,no_bet,locked_at,published_at,created_at,snapshot_json,prediction_grades(result)")
      .eq("sport", args.sport)
      .order("slate_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (args.from) query = query.gte("slate_date", args.from);
    if (args.to) query = query.lte("slate_date", args.to);
    const { data, error } = await query;
    if (error) throw new Error(`prediction_records load failed: ${error.message}`);
    rows.push(...((data ?? []) as RawPredictionRecord[]));
    if ((data ?? []).length < pageSize) break;
  }
  return rows.flatMap((raw) => {
    const market = normalizeMarket(raw.market);
    if (!market) return [];
    const grade = one(raw.prediction_grades);
    const result = String(grade?.result ?? "unknown").toLowerCase();
    const sources = sourcePresence(raw.snapshot_json);
    const warnings = dataWarnings(raw.snapshot_json);
    return [{
      id: raw.id,
      sport: raw.sport as Sport,
      date: raw.slate_date,
      week: weekKey(raw.slate_date),
      market,
      gameId: raw.game_id,
      externalId: raw.external_id,
      matchup: raw.matchup ?? "",
      pick: raw.pick,
      side: raw.side,
      line: raw.line_value,
      price: raw.odds_american,
      confidence: raw.confidence,
      modelProbability: raw.model_probability !== null && raw.model_probability > 1 ? raw.model_probability / 100 : raw.model_probability,
      marketProbability: raw.market_probability,
      edge: raw.edge,
      originalGrade: normalizeGrade(raw.play_grade, raw.best_angle, raw.no_bet),
      result,
      units: americanUnits(raw.odds_american, result),
      locked: Boolean(raw.locked_at || raw.published_at),
      marketRead: extractMarketRead(raw.snapshot_json, market),
      lineDirection: lineDirection(raw),
      hasConsensus: sources.consensus,
      hasSharp: sources.sharp,
      missingHistoricalSource: sources.missingHistorical,
      sourceConflict: sources.conflict,
      dataWarning: warnings.any,
      criticalDataWarning: warnings.critical,
      split: split(raw, market),
    }];
  });
}

function isPublic(grade: Grade): boolean {
  return grade === "Best Angle" || grade === "Lean";
}

function cap(original: Grade, target: Grade): Grade {
  return rank(original) > rank(target) ? target : original;
}

function record(rows: Array<{ grade: Grade; row: Row }>) {
  const out: Record<string, { count: number; wins: number; losses: number; voids: number; pending: number; unknown: number; units: number; roi: number | null }> = {};
  for (const grade of GRADES) out[grade] = { count: 0, wins: 0, losses: 0, voids: 0, pending: 0, unknown: 0, units: 0, roi: null };
  for (const item of rows) {
    const target = out[item.grade];
    target.count += 1;
    if (item.row.result === "win") target.wins += 1;
    else if (item.row.result === "loss") target.losses += 1;
    else if (item.row.result === "void") target.voids += 1;
    else if (item.row.result === "pending") target.pending += 1;
    else target.unknown += 1;
    target.units = +(target.units + item.row.units).toFixed(4);
    const settled = target.wins + target.losses;
    target.roi = settled > 0 ? +(target.units / settled).toFixed(4) : null;
  }
  return out;
}

function publicRecord(rows: Array<{ grade: Grade; row: Row }>) {
  const publicRows = rows.filter((item) => isPublic(item.grade));
  const wins = publicRows.filter((item) => item.row.result === "win").length;
  const losses = publicRows.filter((item) => item.row.result === "loss").length;
  const units = +publicRows.reduce((sum, item) => sum + item.row.units, 0).toFixed(4);
  return { count: publicRows.length, wins, losses, units, roi: wins + losses > 0 ? +(units / (wins + losses)).toFixed(4) : null };
}

function evaluateStrategy(strategy: Strategy, rows: Row[], splitName: SplitName) {
  const targetRows = strategy.market === "overall" ? rows : rows.filter((row) => row.market === strategy.market);
  const original = targetRows.map((row) => ({ grade: row.originalGrade, row }));
  const simulated = targetRows.map((row) => ({ grade: strategy.apply(row), row }));
  let winnersRemoved = 0;
  let losersRemoved = 0;
  let winnersPromoted = 0;
  let losersPromoted = 0;
  let changed = 0;
  for (const row of targetRows) {
    const next = strategy.apply(row);
    if (next !== row.originalGrade) changed += 1;
    if (isPublic(row.originalGrade) && !isPublic(next)) {
      if (row.result === "win") winnersRemoved += 1;
      if (row.result === "loss") losersRemoved += 1;
    }
    if (rank(next) > rank(row.originalGrade)) {
      if (row.result === "win") winnersPromoted += 1;
      if (row.result === "loss") losersPromoted += 1;
    }
  }
  const originalRecord = record(original);
  const simulatedRecord = record(simulated);
  const originalPublic = publicRecord(original);
  const simulatedPublic = publicRecord(simulated);
  const volumeRetained = originalPublic.count > 0 ? +(simulatedPublic.count / originalPublic.count).toFixed(4) : 1;
  const netUnitsImpact = +(simulatedPublic.units - originalPublic.units).toFixed(4);
  const overConservatismScore = +((1 - volumeRetained) + winnersRemoved * 0.05).toFixed(4);
  const overAggressionScore = +(losersPromoted * 0.08 + Math.max(0, simulatedPublic.count - originalPublic.count) * 0.01).toFixed(4);
  const score = +(
    netUnitsImpact +
    (simulatedRecord["Best Angle"].units - originalRecord["Best Angle"].units) * 0.5 +
    (simulatedRecord.Lean.units - originalRecord.Lean.units) * 0.25 -
    winnersRemoved * 0.35 +
    losersRemoved * 0.2 +
    winnersPromoted * 0.15 -
    losersPromoted * 0.35 -
    (volumeRetained < 0.65 ? 3 : 0)
  ).toFixed(4);
  return {
    split: splitName,
    strategy_id: strategy.id,
    market: strategy.market,
    description: strategy.description,
    sampleSize: targetRows.length,
    changed,
    gradeDistribution: simulated.reduce<Record<string, number>>((map, item) => {
      map[item.grade] = (map[item.grade] ?? 0) + 1;
      return map;
    }, {}),
    originalBestAngle: originalRecord["Best Angle"],
    simulatedBestAngle: simulatedRecord["Best Angle"],
    originalLean: originalRecord.Lean,
    simulatedLean: simulatedRecord.Lean,
    originalPublic,
    simulatedPublic,
    watchlist: simulatedRecord.Watchlist,
    caution: simulatedRecord.Caution,
    noPlay: simulatedRecord["No Play"],
    winnersRemoved,
    losersRemoved,
    winnersPromoted,
    losersPromoted,
    netUnitsImpact,
    volumeRetained,
    overConservatismScore,
    overAggressionScore,
    score,
    sampleSizeWarning: targetRows.length < 150 || changed < 10 ? "high_overfit_risk" : "moderate_overfit_risk",
  };
}

function marketResistance(row: Row): boolean {
  return /resistance|mixed/.test(row.marketRead) || row.sourceConflict;
}

function playablePrice(row: Row, maxJuice = -140): boolean {
  return row.price === null || row.price >= maxJuice;
}

function mlStrategies(): Strategy[] {
  const strategies: Strategy[] = [];
  for (const juice of [-150, -160, -175, -200]) {
    for (const edge of [6, 8, 10, 12]) {
      for (const capTarget of ["Lean", "Watchlist"] as Grade[]) {
        strategies.push({
          id: `ml_ba_heavy_${Math.abs(juice)}_edge_${edge}_cap_${capTarget}`,
          market: "moneyline",
          description: `Cap ML Best Angle worse than ${juice} to ${capTarget} unless edge >= ${edge}.`,
          apply: (row) => row.market === "moneyline" && row.originalGrade === "Best Angle" && (row.price ?? 0) < juice && (row.edge ?? 0) < edge ? cap(row.originalGrade, capTarget) : row.originalGrade,
        });
      }
    }
  }
  for (const edge of [6, 8, 10, 12]) {
    strategies.push({
      id: `ml_ba_missing_sharp_nonelite_${edge}`,
      market: "moneyline",
      description: `Cap ML Best Angle missing sharp source to Lean unless edge >= ${edge}, supportive read, and price playable.`,
      apply: (row) => row.market === "moneyline" && row.originalGrade === "Best Angle" && !row.hasSharp && !((row.edge ?? 0) >= edge && /support|aligned/.test(row.marketRead) && playablePrice(row, -150)) ? "Lean" : row.originalGrade,
    });
    strategies.push({
      id: `ml_ba_resistance_nonelite_${edge}`,
      market: "moneyline",
      description: `Cap ML Best Angle with resistance to Lean unless edge >= ${edge}.`,
      apply: (row) => row.market === "moneyline" && row.originalGrade === "Best Angle" && marketResistance(row) && (row.edge ?? 0) < edge ? "Lean" : row.originalGrade,
    });
    strategies.push({
      id: `ml_ba_data_warning_nonelite_${edge}`,
      market: "moneyline",
      description: `Cap ML Best Angle with data warning to Lean unless edge >= ${edge}.`,
      apply: (row) => row.market === "moneyline" && row.originalGrade === "Best Angle" && row.dataWarning && (row.edge ?? 0) < edge ? "Lean" : row.originalGrade,
    });
  }
  for (const edge of [4, 6, 8]) {
    strategies.push({
      id: `ml_watchlist_to_lean_edge_${edge}_playable`,
      market: "moneyline",
      description: `Promote ML Watchlist to Lean if edge >= ${edge}, playable price, no data warning.`,
      apply: (row) => row.market === "moneyline" && row.originalGrade === "Watchlist" && (row.edge ?? 0) >= edge && playablePrice(row, -140) && !row.dataWarning ? "Lean" : row.originalGrade,
    });
    strategies.push({
      id: `ml_watchlist_to_lean_plus_edge_${edge}_clean`,
      market: "moneyline",
      description: `Promote ML plus/pickem Watchlist to Lean if edge >= ${edge}, support/aligned, clean data.`,
      apply: (row) => row.market === "moneyline" && row.originalGrade === "Watchlist" && (row.price ?? -999) >= -110 && (row.edge ?? 0) >= edge && /support|aligned/.test(row.marketRead) && !row.dataWarning ? "Lean" : row.originalGrade,
    });
  }
  for (const juice of [-150, -160, -175, -200]) {
    for (const edge of [6, 8, 10, 12]) {
      for (const missingSharp of [false, true]) {
        for (const resistance of [false, true]) {
          for (const data of [false, true]) {
            if (!missingSharp && !resistance && !data) continue;
            const suffix = [
              missingSharp ? "missing_sharp" : null,
              resistance ? "resistance" : null,
              data ? "data" : null,
            ].filter(Boolean).join("_");
            strategies.push({
              id: `ml_combo_ba_${Math.abs(juice)}_edge_${edge}_${suffix}`,
              market: "moneyline",
              description: `Cap ML Best Angle to Lean when price < ${juice}, edge < ${edge}, and flags match: ${suffix}.`,
              apply: (row) => {
                if (row.market !== "moneyline" || row.originalGrade !== "Best Angle") return row.originalGrade;
                if ((row.price ?? 0) >= juice || (row.edge ?? 0) >= edge) return row.originalGrade;
                if (missingSharp && row.hasSharp) return row.originalGrade;
                if (resistance && !marketResistance(row)) return row.originalGrade;
                if (data && !row.dataWarning) return row.originalGrade;
                return "Lean";
              },
            });
          }
        }
      }
    }
  }
  strategies.push({
    id: "ml_v3_balanced_candidate",
    market: "moneyline",
    description: "Balanced ML: cap heavy/missing-sharp/resistance Best Angles; selective Watchlist promotion only on clean plus/pickem edge.",
    apply: (row) => {
      if (row.market !== "moneyline") return row.originalGrade;
      let grade = row.originalGrade;
      if (grade === "Best Angle") {
        if ((row.price ?? 0) < -175 && (row.edge ?? 0) < 12) grade = "Watchlist";
        else if ((row.price ?? 0) < -150 && (row.edge ?? 0) < 10) grade = "Lean";
        else if (!row.hasSharp && (row.edge ?? 0) < 10) grade = "Lean";
        else if (marketResistance(row) && (row.edge ?? 0) < 10) grade = "Lean";
        else if (row.dataWarning && (row.edge ?? 0) < 10) grade = "Lean";
      }
      if (grade === "Watchlist" && (row.price ?? -999) >= -110 && (row.edge ?? 0) >= 6 && /support|aligned/.test(row.marketRead) && !row.dataWarning) grade = "Lean";
      return grade;
    },
  });
  return strategies;
}

function totalStrategies(): Strategy[] {
  const strategies: Strategy[] = [];
  for (const edge of [3, 4, 5, 6]) {
    strategies.push({
      id: `total_ba_edge_below_${edge}_cap`,
      market: "total",
      description: `Cap Totals Best Angle to Lean if edge below ${edge}.`,
      apply: (row) => row.market === "total" && row.originalGrade === "Best Angle" && (row.edge ?? 0) < edge ? "Lean" : row.originalGrade,
    });
    strategies.push({
      id: `total_ba_thin_${edge}_resistance_cap`,
      market: "total",
      description: `Cap Totals Best Angle if edge < ${edge} and market resistance.`,
      apply: (row) => row.market === "total" && row.originalGrade === "Best Angle" && (row.edge ?? 0) < edge && marketResistance(row) ? "Lean" : row.originalGrade,
    });
  }
  for (const edge of [4, 5, 6]) {
    strategies.push({
      id: `total_watchlist_to_lean_edge_${edge}_clean`,
      market: "total",
      description: `Promote Totals Watchlist to Lean if edge >= ${edge}, no data warning, playable price.`,
      apply: (row) => row.market === "total" && row.originalGrade === "Watchlist" && (row.edge ?? 0) >= edge && !row.dataWarning && playablePrice(row, -125) ? "Lean" : row.originalGrade,
    });
    strategies.push({
      id: `total_caution_to_watchlist_edge_${edge}_noise_only`,
      market: "total",
      description: `Promote Totals Caution to Watchlist if edge >= ${edge} and no critical warning.`,
      apply: (row) => row.market === "total" && row.originalGrade === "Caution" && (row.edge ?? 0) >= edge && !row.criticalDataWarning ? "Watchlist" : row.originalGrade,
    });
  }
  for (const baEdge of [3, 4, 5, 6, 7, 8, 9]) {
    for (const requireResistance of [false, true]) {
      for (const requireData of [false, true]) {
        for (const requireOpposingMove of [false, true]) {
          if (!requireResistance && !requireData && !requireOpposingMove) continue;
          const suffix = [
            requireResistance ? "resistance" : null,
            requireData ? "data" : null,
            requireOpposingMove ? "opposing_move" : null,
          ].filter(Boolean).join("_");
          strategies.push({
            id: `total_combo_ba_edge_${baEdge}_${suffix}`,
            market: "total",
            description: `Cap Totals Best Angle to Lean when edge < ${baEdge} and flags match: ${suffix}.`,
            apply: (row) => {
              if (row.market !== "total" || row.originalGrade !== "Best Angle") return row.originalGrade;
              if ((row.edge ?? 0) >= baEdge) return row.originalGrade;
              if (requireResistance && !marketResistance(row)) return row.originalGrade;
              if (requireData && !row.dataWarning) return row.originalGrade;
              if (requireOpposingMove && row.lineDirection !== "against_pick") return row.originalGrade;
              return "Lean";
            },
          });
        }
      }
    }
  }
  for (const edge of [3, 4, 5, 6, 7, 8]) {
    for (const price of [-110, -120, -130, -150]) {
      for (const allowDataWarning of [false, true]) {
        strategies.push({
          id: `total_watchlist_promote_edge_${edge}_price_${Math.abs(price)}_${allowDataWarning ? "allow_data" : "clean"}`,
          market: "total",
          description: `Promote Totals Watchlist to Lean when edge >= ${edge}, price >= ${price}, ${allowDataWarning ? "data warning allowed" : "clean data only"}.`,
          apply: (row) => row.market === "total" &&
            row.originalGrade === "Watchlist" &&
            (row.edge ?? 0) >= edge &&
            playablePrice(row, price) &&
            (allowDataWarning || !row.dataWarning)
            ? "Lean"
            : row.originalGrade,
        });
      }
    }
  }
  strategies.push({
    id: "total_v3_balanced_candidate",
    market: "total",
    description: "Balanced Totals: protect Lean; cap vulnerable Best Angles; promote clean Watchlists.",
    apply: (row) => {
      if (row.market !== "total") return row.originalGrade;
      let grade = row.originalGrade;
      if (grade === "Best Angle" && ((marketResistance(row) && (row.edge ?? 0) < 8) || (row.dataWarning && marketResistance(row)) || (row.edge ?? 0) < 5)) grade = "Lean";
      if (grade === "Watchlist" && (row.edge ?? 0) >= 5 && !row.dataWarning && playablePrice(row, -125)) grade = "Lean";
      return grade;
    },
  });
  return strategies;
}

function fiStrategies(): Strategy[] {
  const strategies: Strategy[] = [{
    id: "fi_lean_protect_default",
    market: "first_inning",
    description: "Protect FI Lean; missing/no FI market signal is low materiality.",
    apply: (row) => row.originalGrade,
  }];
  for (const edge of [2, 3, 4]) {
    strategies.push({
      id: `fi_lean_cap_edge_below_${edge}`,
      market: "first_inning",
      description: `Cap FI Lean to Watchlist only when edge < ${edge}.`,
      apply: (row) => row.market === "first_inning" && row.originalGrade === "Lean" && (row.edge ?? 0) < edge ? "Watchlist" : row.originalGrade,
    });
    strategies.push({
      id: `fi_watchlist_to_lean_edge_${edge}_clean`,
      market: "first_inning",
      description: `Promote FI Watchlist to Lean if edge >= ${edge} and no critical warning.`,
      apply: (row) => row.market === "first_inning" && row.originalGrade === "Watchlist" && (row.edge ?? 0) >= edge && !row.criticalDataWarning ? "Lean" : row.originalGrade,
    });
  }
  for (const edge of [1, 2, 3, 4, 5]) {
    for (const price of [-140, -150, -160, -175]) {
      for (const criticalOnly of [false, true]) {
        strategies.push({
          id: `fi_lean_cap_edge_${edge}_price_${Math.abs(price)}_${criticalOnly ? "critical_only" : "any_data"}`,
          market: "first_inning",
          description: `Cap FI Lean to Watchlist if edge < ${edge}, price worse than ${price}, or ${criticalOnly ? "critical" : "any"} data warning.`,
          apply: (row) => {
            if (row.market !== "first_inning" || row.originalGrade !== "Lean") return row.originalGrade;
            const warning = criticalOnly ? row.criticalDataWarning : row.dataWarning;
            return (row.edge ?? 0) < edge || (row.price ?? 0) < price || warning ? "Watchlist" : row.originalGrade;
          },
        });
      }
    }
  }
  for (const edge of [1, 2, 3, 4, 5, 6]) {
    for (const price of [-125, -140, -150, -160]) {
      strategies.push({
        id: `fi_watchlist_or_noplay_promote_edge_${edge}_price_${Math.abs(price)}`,
        market: "first_inning",
        description: `Promote FI Watchlist to Lean and No Play to Watchlist when edge >= ${edge}, price >= ${price}, no critical warning.`,
        apply: (row) => {
          if (row.market !== "first_inning" || row.criticalDataWarning || (row.edge ?? 0) < edge || !playablePrice(row, price)) return row.originalGrade;
          if (row.originalGrade === "Watchlist") return "Lean";
          if (row.originalGrade === "No Play") return "Watchlist";
          return row.originalGrade;
        },
      });
    }
  }
  strategies.push({
    id: "fi_lean_cap_critical_or_unplayable",
    market: "first_inning",
    description: "Cap FI Lean only for critical starter/lineup/stale warning or price worse than -160.",
    apply: (row) => row.market === "first_inning" && row.originalGrade === "Lean" && (row.criticalDataWarning || (row.price ?? 0) < -160) ? "Watchlist" : row.originalGrade,
  });
  strategies.push({
    id: "fi_v3_protected_candidate",
    market: "first_inning",
    description: "Protected FI: keep Lean unless critical/unplayable/thin; promote clean FI Watchlist cautiously.",
    apply: (row) => {
      if (row.market !== "first_inning") return row.originalGrade;
      let grade = row.originalGrade;
      if (grade === "Lean" && (row.criticalDataWarning || (row.price ?? 0) < -160 || (row.edge ?? 0) < 2)) grade = "Watchlist";
      if (grade === "Watchlist" && (row.edge ?? 0) >= 3 && !row.criticalDataWarning && playablePrice(row, -150)) grade = "Lean";
      return grade;
    },
  });
  return strategies;
}

function overallStrategies(marketStrategies: Strategy[]): Strategy[] {
  const byId = new Map(marketStrategies.map((strategy) => [strategy.id, strategy]));
  const combos = [
    ["ml_v3_balanced_candidate", "total_v3_balanced_candidate", "fi_lean_protect_default"],
    ["ml_ba_missing_sharp_nonelite_10", "total_v3_balanced_candidate", "fi_lean_protect_default"],
    ["ml_v3_balanced_candidate", "total_watchlist_to_lean_edge_5_clean", "fi_v3_protected_candidate"],
  ];
  return combos.map((ids, index) => ({
    id: `overall_combo_${index + 1}`,
    market: "overall" as const,
    description: `Combined Daily Edge candidate: ${ids.join(" + ")}`,
    apply: (row: Row) => {
      const strategy = ids.map((id) => byId.get(id)).find((candidate) => candidate?.market === row.market);
      return strategy ? strategy.apply(row) : row.originalGrade;
    },
  }));
}

function splitRows(rows: Row[]) {
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort();
  const boundary = dates[Math.max(0, Math.floor(dates.length * 0.65) - 1)] ?? dates[0];
  return {
    boundary,
    train: rows.filter((row) => row.date <= boundary),
    validation: rows.filter((row) => row.date > boundary),
    full: rows,
  };
}

function stabilityByWeek(strategy: Strategy, rows: Row[]) {
  const byWeek = new Map<string, Row[]>();
  for (const row of rows) {
    byWeek.set(row.week, [...(byWeek.get(row.week) ?? []), row]);
  }
  return Array.from(byWeek.entries()).map(([week, weekRows]) => {
    const result = evaluateStrategy(strategy, weekRows, "full");
    return { week, publicUnits: result.simulatedPublic.units, publicRecord: `${result.simulatedPublic.wins}-${result.simulatedPublic.losses}`, volume: result.simulatedPublic.count };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadRows(args);
  const settledRows = rows.filter((row) => row.result === "win" || row.result === "loss" || row.result === "void");
  const splits = splitRows(settledRows);
  const marketStrategies = [...mlStrategies(), ...totalStrategies(), ...fiStrategies()];
  const strategies = [...marketStrategies, ...overallStrategies(marketStrategies)];
  const evaluated = strategies.map((strategy) => {
    const train = evaluateStrategy(strategy, splits.train, "train");
    const validation = evaluateStrategy(strategy, splits.validation, "validation");
    const full = evaluateStrategy(strategy, splits.full, "full");
    const stability = stabilityByWeek(strategy, settledRows);
    const validationFails = validation.netUnitsImpact < 0 || validation.simulatedPublic.units < validation.originalPublic.units;
    const overfitRisk = validationFails ? "high_validation_failure" : full.sampleSize < 150 ? "sample_size_risk" : "moderate";
    return {
      strategy_id: strategy.id,
      market: strategy.market,
      description: strategy.description,
      train,
      validation,
      full,
      stabilityByWeek: stability,
      overfitRisk,
      rankScore: +(validation.score * 0.6 + full.score * 0.3 + train.score * 0.1 - (validationFails ? 5 : 0)).toFixed(4),
    };
  });
  const topByMarket = (market: Market | "overall") => evaluated
    .filter((row) => row.market === market)
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, args.top);
  const availability = {
    sport: args.sport,
    dateRange: {
      from: rows.map((row) => row.date).sort()[0] ?? null,
      to: rows.map((row) => row.date).sort().at(-1) ?? null,
      trainThrough: splits.boundary,
    },
    totalMarketRows: rows.length,
    settledRows: settledRows.length,
    lockedRows: rows.filter((row) => row.locked).length,
    cards: new Set(rows.map((row) => `${row.date}:${row.gameId ?? row.externalId ?? row.matchup}`)).size,
    rowsWithPrices: rows.filter((row) => row.price !== null).length,
    rowsWithUnits: rows.filter((row) => row.units !== 0).length,
    rowsWithModelProbability: rows.filter((row) => row.modelProbability !== null).length,
    rowsWithEdge: rows.filter((row) => row.edge !== null).length,
    rowsWithMarketReads: rows.filter((row) => row.marketRead !== "unknown").length,
    rowsWithConsensus: rows.filter((row) => row.hasConsensus).length,
    rowsWithSharp: rows.filter((row) => row.hasSharp).length,
    rowsWithMissingHistoricalSource: rows.filter((row) => row.missingHistoricalSource).length,
    byMarket: MARKETS.reduce<Record<string, number>>((map, market) => {
      map[market] = rows.filter((row) => row.market === market).length;
      return map;
    }, {}),
  };
  const report = {
    mode: "calibration_tournament_no_openai",
    noOpenAiCalls: true,
    noLiveChanges: true,
    availability,
    strategyCount: strategies.length,
    topCandidates: {
      moneyline: topByMarket("moneyline"),
      total: topByMarket("total"),
      first_inning: topByMarket("first_inning"),
      overall: topByMarket("overall"),
    },
    aiRoleAfterCalibration: [
      "Review deterministic grade candidate.",
      "Explain Market Read.",
      "Catch contradictions.",
      "Flag material data issues.",
      "Validate promotion/demotion only when deterministic score supports it.",
      "Never act as the sole grade engine.",
    ],
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("OddSphere Calibration Tournament (no OpenAI calls)");
  console.log(JSON.stringify(availability, null, 2));
  for (const [market, rowsForMarket] of Object.entries(report.topCandidates)) {
    console.log(`\nTop ${market}:`);
    for (const candidate of rowsForMarket) {
      console.log(`${candidate.strategy_id} score=${candidate.rankScore} validationPublic=${candidate.validation.simulatedPublic.wins}-${candidate.validation.simulatedPublic.losses} ${candidate.validation.simulatedPublic.units}u fullPublic=${candidate.full.simulatedPublic.wins}-${candidate.full.simulatedPublic.losses} ${candidate.full.simulatedPublic.units}u risk=${candidate.overfitRisk}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
