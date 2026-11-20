/** Frozen evidence only. Diagnostics never change a pick or stored grade. */
export type FrozenNbaRow = {
  id: number; game_id: number; external_id: number; slate_date: string; game_date: string; matchup: string;
  market: string; side: string | null; line_value: number | null; odds_american: number | null;
  model_version: string; calibration_version: string | null; grade_policy_release: string | null;
  model_probability: number | null; play_grade: string; locked_at: string | null; held: boolean;
  independent_picks: { moneyline?: string; spread?: string; total?: string } | null;
  grades: { result: string; actual_home_score: number | null; actual_away_score: number | null;
    grade_source: string; graded_at: string } | null;
};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const actionable = (row: FrozenNbaRow) => !row.held && ["lean", "best_angle"].includes(row.play_grade);
function outcome(row: FrozenNbaRow, side = row.side): "win" | "loss" | "push" | null {
  const home = row.grades?.actual_home_score, away = row.grades?.actual_away_score;
  if (!finite(home) || !finite(away)) return null;
  let residual: number;
  if (row.market === "moneyline" && (side === "home" || side === "away")) residual = side === "home" ? home - away : away - home;
  else if (row.market === "total" && finite(row.line_value) && (side === "over" || side === "under")) residual = (home + away - row.line_value) * (side === "over" ? 1 : -1);
  else if (row.market === "spread" && finite(row.line_value) && (side === "home" || side === "away")) {
    // Stored line is the SELECTED team's handicap, not always the home line.
    const homeLine = row.side === "home" ? row.line_value : -row.line_value;
    residual = (home - away + homeLine) * (side === "home" ? 1 : -1);
  } else return null;
  return residual === 0 ? "push" : residual > 0 ? "win" : "loss";
}
function metrics(rows: readonly FrozenNbaRow[]) {
  const wins = rows.filter(r => r.grades?.result === "win").length, losses = rows.filter(r => r.grades?.result === "loss").length;
  const pushes = rows.filter(r => r.grades?.result === "push").length;
  const settled = rows.filter(r => ["win", "loss", "push"].includes(r.grades?.result ?? ""));
  const scored = settled.filter(r => r.grades!.result !== "push" && finite(r.model_probability) && r.model_probability >= 0 && r.model_probability <= 1);
  const priced = settled.filter(r => finite(r.odds_american) && Math.abs(r.odds_american) >= 100);
  const units = priced.reduce((sum, r) => sum + (r.grades!.result === "push" ? 0 : r.grades!.result === "loss" ? -1 : r.odds_american! < 0 ? 100 / -r.odds_american! : r.odds_american! / 100), 0);
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const observed = (r: FrozenNbaRow) => Number(r.grades!.result === "win");
  return { records: rows.length, wins, losses, pushes, pending: rows.filter(r => !r.grades).length,
    otherSettlements: rows.filter(r => r.grades && !["win", "loss", "push"].includes(r.grades.result)).length,
    probabilityRows: scored.length, meanProbability: mean(scored.map(r => r.model_probability!)), observedWinRate: mean(scored.map(observed)),
    brier: mean(scored.map(r => (r.model_probability! - observed(r)) ** 2)),
    logLoss: mean(scored.map(r => -Math.log(Math.max(1e-15, observed(r) ? r.model_probability! : 1 - r.model_probability!)))),
    calibrationGap: mean(scored.map(r => r.model_probability! - observed(r))),
    pricedSettlements: priced.length, unpricedSettlements: settled.length - priced.length,
    oneUnitProfit: units, oneUnitRoi: priced.length ? units / priced.length : null,
    grades: Object.fromEntries([...new Set(rows.map(r => r.play_grade))].sort().map(g => [g, rows.filter(r => r.play_grade === g).length])),
    buckets: [[0, .5], [.5, .55], [.55, .6], [.6, .65], [.65, .7], [.7, 1]].map(([low, high], index) => {
      const cohort = scored.filter(r => r.model_probability! >= low! && (index === 5 ? r.model_probability! <= high! : r.model_probability! < high!));
      return { low, high, rows: cohort.length, meanProbability: mean(cohort.map(r => r.model_probability!)), observedWinRate: mean(cohort.map(observed)) };
    }) };
}
export function buildNbaFrozenPerformance(rows: readonly FrozenNbaRow[]) {
  const issues: { id: number; reason: string }[] = [], seen = new Set<number>(), slots = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`Duplicate frozen record ${row.id}`);
    seen.add(row.id);
    const slot = JSON.stringify([row.game_id, row.market, row.model_version, row.calibration_version, row.grade_policy_release]);
    if (slots.has(slot)) issues.push({ id: row.id, reason: "duplicate_game_market_in_release" });
    slots.add(slot);
    if (row.held && ["lean", "best_angle"].includes(row.play_grade)) issues.push({ id: row.id, reason: "held_record_has_actionable_grade" });
    if (!row.locked_at || !Number.isFinite(Date.parse(row.locked_at)) || !Number.isFinite(Date.parse(row.game_date)) || Date.parse(row.locked_at) > Date.parse(row.game_date)) issues.push({ id: row.id, reason: "invalid_or_postgame_lock_clock" });
    if (row.model_probability !== null && (!finite(row.model_probability) || row.model_probability < 0 || row.model_probability > 1)) issues.push({ id: row.id, reason: "invalid_probability" });
    if (row.grades && ["win", "loss", "push"].includes(row.grades.result)) {
      const expected = outcome(row);
      if (expected === null || expected !== row.grades.result) issues.push({ id: row.id, reason: "stored_settlement_disagrees_with_saved_side_line_scores" });
    }
  }
  const eraKey = (r: FrozenNbaRow) => JSON.stringify([r.model_version, r.calibration_version, r.grade_policy_release]);
  const eras = [...new Set(rows.map(eraKey))].sort().map(key => {
    const cohort = rows.filter(r => eraKey(r) === key), times = cohort.map(r => r.locked_at).filter((t): t is string => !!t).sort();
    return { model: cohort[0]!.model_version, calibration: cohort[0]!.calibration_version, gradePolicy: cohort[0]!.grade_policy_release,
      lockedFrom: times[0] ?? null, lockedThrough: times.at(-1) ?? null,
      markets: ["moneyline", "spread", "total"].map(market => {
        const marketRows = cohort.filter(r => r.market === market);
        const paired = marketRows.flatMap(r => {
          const side = r.independent_picks?.[market as "moneyline" | "spread" | "total"];
          const baseline = side ? outcome(r, side) : null;
          return baseline && ["win", "loss", "push"].includes(r.grades?.result ?? "") ? [{ row: r, side, baseline }] : [];
        });
        return { market, all: metrics(marketRows), actionable: metrics(marketRows.filter(actionable)),
          byDate: [...new Set(marketRows.map(r => r.slate_date))].sort().map(date => ({ date, all: metrics(marketRows.filter(r => r.slate_date === date)), actionable: metrics(marketRows.filter(r => r.slate_date === date && actionable(r))) })),
          pairedIndependentDirection: { rows: paired.length, independentWins: paired.filter(p => p.baseline === "win").length,
            finalWins: paired.filter(p => p.row.grades!.result === "win").length, sideChanges: paired.filter(p => p.side !== p.row.side).length,
            changedToWin: paired.filter(p => p.side !== p.row.side && p.row.grades!.result === "win").length,
            changedToLoss: paired.filter(p => p.side !== p.row.side && p.row.grades!.result === "loss").length,
            note: "Same frozen handicap and saved independent side; hypothetical opposite-side prices are not reconstructed. Diagnostic, not a replacement backtest." } };
      }) };
  });
  return { release: "nba_frozen_performance_audit_2026_11_20_r1", status: issues.length ? "invalid_evidence" : "complete_frozen_audit", eras, issues,
    unitConvention: "One unit risked per saved-priced wager, with returned pushes in ROI denominator. All includes non-actionables; actionable includes only Best Angle and Lean.",
    productionWrites: 0, providerCalls: 0, modelFits: 0 };
}
