/**
 * READ ONLY.
 *
 * Deep, leakage-safe audit of lock-frozen MLB public/consensus/sharp splits.
 * This script does not write to Supabase and does not alter grades.
 */
import { supabase } from "../lib/db/supabase";
import { MLB_MODEL_LAYER_VERSION_IDS } from "../lib/automodel/mlbModelLayerVersions";

type Market = "moneyline" | "total" | "first_inning";
type Result = "win" | "loss";
type Raw = Record<string, any>;
type Split = { bets: number | null; money: number | null };
type Row = {
  id: number;
  date: string;
  gameId: number;
  market: Market;
  side: string;
  line: number | null;
  odds: number | null;
  flipOdds: number | null;
  p: number | null;
  edge: number | null;
  grade: string;
  actionable: boolean;
  result: Result;
  release: string;
  legacy: Split;
  consensus: Split;
  sharp: Split;
  movement: string;
  crossMlConsensus: Split;
  crossTotalConsensus: Split;
  actionRuleId: string | null;
  demoteReason: string | null;
  totalFrictionCap: boolean;
  head: string | null;
};
type Metrics = {
  n: number;
  w: number;
  l: number;
  units: number;
  roi: number;
  winPct: number;
  avgP: number | null;
  brier: number | null;
  dates: number;
};
type Rule = {
  name: string;
  kind: "confirm" | "promote" | "demote" | "flip" | "fi_cross";
  test: (r: Row) => boolean;
};

const START = "2026-06-07";
const pct = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 1 ? n * 100 : n;
};
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const result = (raw: unknown): Result | null => {
  const v = String(raw ?? "").toLowerCase();
  return v === "win" || v === "loss" ? v : null;
};
const profit = (odds: number, won: boolean): number =>
  won ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1;
const normSide = (value: unknown): string => {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("home")) return "home";
  if (v.includes("away")) return "away";
  if (v.includes("over") || v === "yrfi") return "over";
  if (v.includes("under") || v === "nrfi") return "under";
  return v;
};
const opposite = (side: string): string =>
  side === "home" ? "away" : side === "away" ? "home" : side === "over" ? "under" : "over";
const selectionSide = (key: unknown): string => normSide(String(key ?? "").split(":").at(-1));
const emptySplit = (): Split => ({ bets: null, money: null });

function sourceSplit(snapshot: Raw, market: string, side: string, source: "consensus" | "sharp"): Split {
  if (market === "first_inning") return emptySplit();
  const rows = Array.isArray(snapshot.source_aware_split_rows_at_lock)
    ? snapshot.source_aware_split_rows_at_lock as Raw[]
    : [];
  const matches = rows.filter((r) => {
    const provider = String(r.provider ?? "").toLowerCase();
    const sourceType = String(r.source_type ?? "").toLowerCase();
    const sourceMatch = source === "consensus"
      ? provider === "playbook" || sourceType === "multi_book_consensus"
      : provider === "sharpapi" && sourceType === "sharp_adjacent_book";
    return sourceMatch && String(r.market_type ?? "") === market && selectionSide(r.selection_key) === side;
  });
  if (!matches.length) return emptySplit();
  // Never average providers. Prefer the freshest row for the selected side.
  matches.sort((a, b) =>
    String(b.source_observed_at ?? b.fetched_at ?? "").localeCompare(
      String(a.source_observed_at ?? a.fetched_at ?? ""),
    ));
  return { bets: pct(matches[0].bets_pct), money: pct(matches[0].money_pct) };
}

function legacySplit(snapshot: Raw): Split {
  const s = snapshot.public_splits ?? {};
  return { bets: pct(s.picked_bets_pct), money: pct(s.picked_money_pct) };
}

function bestOppositePrice(snapshot: Raw, market: Market, side: string, line: number | null): number | null {
  const marketType = market === "first_inning" ? "first_inning_total" : market;
  const prices = (Array.isArray(snapshot.lines_at_lock) ? snapshot.lines_at_lock : [])
    .filter((r: Raw) => {
      if (String(r.market_type ?? "") !== marketType || normSide(r.side) !== opposite(side)) return false;
      if (market === "total" || market === "first_inning") {
        return line !== null && num(r.line_value) === line;
      }
      return true;
    })
    .map((r: Raw) => num(r.odds_american))
    .filter((v: number | null): v is number => v !== null && v >= -500 && v <= 1000);
  return prices.length ? Math.max(...prices) : null;
}

function metrics(rows: Row[], flipped = false): Metrics {
  const priced = rows.filter((r) => (flipped ? r.flipOdds : r.odds) !== null);
  let units = 0;
  let brier = 0;
  let pCount = 0;
  let pSum = 0;
  let wins = 0;
  for (const r of priced) {
    const won = flipped ? r.result === "loss" : r.result === "win";
    if (won) wins++;
    units += profit((flipped ? r.flipOdds : r.odds)!, won);
    if (!flipped && r.p !== null) {
      const pp = Math.max(0, Math.min(1, r.p));
      brier += (pp - (won ? 1 : 0)) ** 2;
      pSum += pp;
      pCount++;
    }
  }
  return {
    n: priced.length,
    w: wins,
    l: priced.length - wins,
    units,
    roi: priced.length ? 100 * units / priced.length : 0,
    winPct: priced.length ? 100 * wins / priced.length : 0,
    avgP: pCount ? 100 * pSum / pCount : null,
    brier: pCount ? brier / pCount : null,
    dates: new Set(priced.map((r) => r.date)).size,
  };
}

type SideDecision = "keep" | "flip" | null;
function strategyMetrics(rows: Row[], choose: (row: Row) => SideDecision): Metrics {
  let units = 0;
  let wins = 0;
  const priced: Row[] = [];
  for (const row of rows) {
    const decision = choose(row);
    const odds = decision === "keep" ? row.odds : decision === "flip" ? row.flipOdds : null;
    if (decision === null || odds === null) continue;
    const won = decision === "keep" ? row.result === "win" : row.result === "loss";
    priced.push(row);
    if (won) wins++;
    units += profit(odds, won);
  }
  return {
    n: priced.length,
    w: wins,
    l: priced.length - wins,
    units,
    roi: priced.length ? 100 * units / priced.length : 0,
    winPct: priced.length ? 100 * wins / priced.length : 0,
    avgP: null,
    brier: null,
    dates: new Set(priced.map((r) => r.date)).size,
  };
}

function fmt(m: Metrics): string {
  return `n=${m.n} dates=${m.dates} ${m.w}-${m.l} units=${m.units.toFixed(2)} ROI=${m.roi.toFixed(1)}% win=${m.winPct.toFixed(1)}%`
    + (m.avgP === null ? "" : ` avgP=${m.avgP.toFixed(1)}% Brier=${m.brier!.toFixed(4)}`);
}

function splitDates(rows: Row[]): { train: Row[]; holdout: Row[]; cut: string } {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const cut = dates[Math.max(1, Math.floor(dates.length * 0.7))] ?? "9999-12-31";
  return { train: rows.filter((r) => r.date < cut), holdout: rows.filter((r) => r.date >= cut), cut };
}

function candidates(): Rule[] {
  const out: Rule[] = [];
  const sources: Array<[string, (r: Row) => Split]> = [
    ["legacy", (r) => r.legacy],
    ["consensus", (r) => r.consensus],
    ["sharp", (r) => r.sharp],
  ];
  for (const [source, get] of sources) {
    for (const threshold of [50, 55, 60, 65, 70, 75]) {
      out.push({
        name: `${source}: picked money >=${threshold}`,
        kind: "confirm",
        test: (r) => (get(r).money ?? -1) >= threshold,
      });
      out.push({
        name: `${source}: picked money <${threshold}`,
        kind: "confirm",
        test: (r) => get(r).money !== null && get(r).money! < threshold,
      });
    }
    for (const threshold of [5, 10, 15, 20, 25]) {
      out.push({
        name: `${source}: money-bets >=${threshold}`,
        kind: "confirm",
        test: (r) => get(r).money !== null && get(r).bets !== null
          && get(r).money! - get(r).bets! >= threshold,
      });
      out.push({
        name: `${source}: bets-money >=${threshold}`,
        kind: "confirm",
        test: (r) => get(r).money !== null && get(r).bets !== null
          && get(r).bets! - get(r).money! >= threshold,
      });
    }
  }
  for (const direction of ["toward_pick", "against_pick"]) {
    out.push({ name: `movement=${direction}`, kind: "confirm", test: (r) => r.movement === direction });
  }
  for (const [label, test] of [
    ["consensus+sharp both >=55", (r: Row) => (r.consensus.money ?? -1) >= 55 && (r.sharp.money ?? -1) >= 55],
    ["consensus+sharp both <45", (r: Row) => r.consensus.money !== null && r.consensus.money < 45 && r.sharp.money !== null && r.sharp.money < 45],
    ["consensus supports, sharp resists", (r: Row) => (r.consensus.money ?? -1) >= 55 && r.sharp.money !== null && r.sharp.money < 45],
    ["sharp supports, consensus resists", (r: Row) => (r.sharp.money ?? -1) >= 55 && r.consensus.money !== null && r.consensus.money < 45],
  ] as Array<[string, (r: Row) => boolean]>) out.push({ name: label, kind: "confirm", test });
  return out;
}

function reportRules(label: string, pool: Row[], holdout: Row[], rules: Rule[], flipped = false): void {
  const selected = rules.map((rule) => {
    const trainRows = pool.filter(rule.test);
    return { rule, train: metrics(trainRows, flipped) };
  }).filter((x) => x.train.n >= 20 && x.train.dates >= 8)
    .sort((a, b) => b.train.roi - a.train.roi)
    .slice(0, 12);
  console.log(`\n### ${label} (rules selected on TRAIN only)`);
  if (!selected.length) console.log("  no candidate met discovery support");
  for (const x of selected) {
    const validation = metrics(holdout.filter(x.rule.test), flipped);
    console.log(`  ${x.rule.name}`);
    console.log(`    train   ${fmt(x.train)}`);
    console.log(`    holdout ${fmt(validation)}${validation.n < 15 || validation.dates < 5 ? " [INSUFFICIENT]" : ""}`);
  }
}

async function load(): Promise<Row[]> {
  const all: Raw[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("prediction_records")
      .select("id,slate_date,game_id,market,pick,side,line_value,odds_american,model_probability,edge,play_grade,best_angle,no_bet,launch_day,locked_at,snapshot_json,prediction_grades(result)")
      .eq("sport", "mlb")
      .gte("slate_date", START)
      .not("locked_at", "is", null)
      .in("market", ["moneyline", "total", "first_inning"])
      .order("id", { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  // One member-facing locked decision per game/market/date. Latest locked record wins.
  const seen = new Set<string>();
  const deduped = all.filter((r) => {
    const key = `${r.slate_date}|${r.game_id}|${r.market}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.flatMap((r): Row[] => {
    if (r.launch_day === true || r.no_bet === true) return [];
    const gradeJoin = Array.isArray(r.prediction_grades) ? r.prediction_grades[0] : r.prediction_grades;
    const settled = result(gradeJoin?.result);
    if (!settled) return [];
    const market = String(r.market) as Market;
    const side = normSide(r.side ?? r.pick);
    const snapshot = (r.snapshot_json ?? {}) as Raw;
    const release = String(
      snapshot.model_layer_versions?.decision_release_id
      ?? snapshot.modelLayerVersions?.decision_release_id
      ?? "legacy_unstamped",
    );
    const grade = String(r.play_grade ?? "").toLowerCase();
    return [{
      id: Number(r.id),
      date: String(r.slate_date),
      gameId: Number(r.game_id),
      market,
      side,
      line: num(r.line_value),
      odds: num(r.odds_american),
      flipOdds: bestOppositePrice(snapshot, market, side, num(r.line_value)),
      p: num(r.model_probability),
      edge: num(r.edge),
      grade,
      actionable: r.best_angle === true || grade === "best_angle" || grade === "lean",
      result: settled,
      release,
      legacy: legacySplit(snapshot),
      consensus: sourceSplit(snapshot, market, side, "consensus"),
      sharp: sourceSplit(snapshot, market, side, "sharp"),
      movement: String(snapshot.line_movement?.direction ?? "unknown"),
      crossMlConsensus: sourceSplit(snapshot, "moneyline", "home", "consensus"),
      crossTotalConsensus: sourceSplit(snapshot, "total", "over", "consensus"),
      actionRuleId: typeof snapshot.decision_pipeline?.action_rule_id === "string"
        ? snapshot.decision_pipeline.action_rule_id
        : null,
      demoteReason: typeof snapshot.best_angle_resolution?.demote_reason === "string"
        ? snapshot.best_angle_resolution.demote_reason
        : null,
      totalFrictionCap: snapshot.total_lean_market_friction_cap !== null
        && typeof snapshot.total_lean_market_friction_cap === "object",
      head: typeof snapshot.model_layer_versions?.active_probability_head === "string"
        ? snapshot.model_layer_versions.active_probability_head
        : null,
    }];
  });
}

function coverage(rows: Row[]): void {
  console.log("## COVERAGE BY RELEASE / MARKET");
  const keys = [...new Set(rows.map((r) => `${r.release}|${r.market}`))].sort();
  for (const key of keys) {
    const [release, market] = key.split("|");
    const x = rows.filter((r) => r.release === release && r.market === market);
    const legacy = x.filter((r) => r.legacy.money !== null || r.legacy.bets !== null).length;
    const consensus = x.filter((r) => r.consensus.money !== null || r.consensus.bets !== null).length;
    const sharp = x.filter((r) => r.sharp.money !== null || r.sharp.bets !== null).length;
    const movement = x.filter((r) => r.movement !== "unknown").length;
    console.log(`  ${release} | ${market}: n=${x.length} dates=${new Set(x.map((r) => r.date)).size} legacy=${legacy} consensus=${consensus} sharp=${sharp} movement=${movement}`);
  }
}

function pairedBoardImpact(rows: Row[], rule: Rule): void {
  const action = rows.filter((r) => r.actionable);
  const watch = rows.filter((r) => !r.actionable);
  const demoted = action.filter(rule.test);
  const promoted = watch.filter(rule.test);
  console.log(`  ${rule.name}: demote=${demoted.length} (${fmt(metrics(demoted))}) promote=${promoted.length} (${fmt(metrics(promoted))}) net=${promoted.length - demoted.length}`);
}

async function main(): Promise<void> {
  const rows = await load();
  coverage(rows);
  const { train, holdout, cut } = splitDates(rows);
  console.log(`\n## CHRONOLOGY\n  all=${rows.length}; train=${train.length}; holdout=${holdout.length}; holdout starts ${cut}`);
  console.log("  Rule search uses only train. Holdout remains untouched until reporting.");
  const rules = candidates();

  for (const market of ["moneyline", "total"] as Market[]) {
    const tr = train.filter((r) => r.market === market);
    const ho = holdout.filter((r) => r.market === market);
    reportRules(`${market.toUpperCase()} confirmations — actionable pool`, tr.filter((r) => r.actionable), ho.filter((r) => r.actionable), rules);
    reportRules(`${market.toUpperCase()} promotions — Watch/No Play pool`, tr.filter((r) => !r.actionable), ho.filter((r) => !r.actionable), rules);
    reportRules(`${market.toUpperCase()} flips — all priceable originals`, tr.filter((r) => r.flipOdds !== null), ho.filter((r) => r.flipOdds !== null), rules, true);
  }

  console.log("\n## PAIRED BOARD IMPACT ON HOLDOUT");
  const weakTrain = rules.map((rule) => ({ rule, m: metrics(train.filter((r) => r.actionable && rule.test(r))) }))
    .filter((x) => x.m.n >= 20 && x.m.dates >= 8)
    .sort((a, b) => a.m.roi - b.m.roi)
    .slice(0, 8);
  for (const x of weakTrain) pairedBoardImpact(holdout, x.rule);

  console.log("\n## FIRST-INNING CROSS-MARKET EXPLORATION");
  console.log("  No native first-inning split rows exist; these are full-game context only.");
  const fiRules: Rule[] = [
    { name: "full-game home ML consensus money >=60", kind: "fi_cross", test: (r) => (r.crossMlConsensus.money ?? -1) >= 60 },
    { name: "full-game home ML consensus money <40", kind: "fi_cross", test: (r) => r.crossMlConsensus.money !== null && r.crossMlConsensus.money < 40 },
    { name: "full-game Over consensus money >=60", kind: "fi_cross", test: (r) => (r.crossTotalConsensus.money ?? -1) >= 60 },
    { name: "full-game Over consensus money <40", kind: "fi_cross", test: (r) => r.crossTotalConsensus.money !== null && r.crossTotalConsensus.money < 40 },
  ];
  reportRules(
    "FI context — actionable pool",
    train.filter((r) => r.market === "first_inning" && r.actionable),
    holdout.filter((r) => r.market === "first_inning" && r.actionable),
    fiRules,
  );

  console.log("\n## RELEASE-SPECIFIC BASELINES");
  for (const release of [...new Set(rows.map((r) => r.release))].sort()) {
    const rr = rows.filter((r) => r.release === release);
    console.log(`  ${release}: all ${fmt(metrics(rr))}; actionable ${fmt(metrics(rr.filter((r) => r.actionable)))}`);
  }

  console.log("\n## EXISTING SPLIT/MOVEMENT RULE AUDIT (exact stored audit tags)");
  const tagged: Array<[string, (r: Row) => boolean]> = [
    ["BA demoted: opposing_public_money", (r) => r.demoteReason === "opposing_public_money"],
    ["BA demoted: line_movement_against_pick", (r) => r.demoteReason === "line_movement_against_pick"],
    ["BA demoted: large_unconfirmed_regularized_edge", (r) => r.demoteReason === "large_unconfirmed_regularized_edge"],
    ["Total Lean capped: market friction", (r) => r.totalFrictionCap],
  ];
  for (const [label, test] of tagged) {
    const tr = train.filter(test);
    const ho = holdout.filter(test);
    console.log(`  ${label}`);
    console.log(`    train   ${fmt(metrics(tr))}`);
    console.log(`    holdout ${fmt(metrics(ho))}${ho.length < 15 || new Set(ho.map((r) => r.date)).size < 5 ? " [INSUFFICIENT]" : ""}`);
  }

  console.log("\n## KEY SURVIVING MONEYLINE PROMOTION FAMILY BY ERA");
  const promotionRules: Array<[string, (r: Row) => boolean]> = [
    ["legacy picked-side money-bets >=10", (r) => r.market === "moneyline" && !r.actionable && r.legacy.money !== null && r.legacy.bets !== null && r.legacy.money - r.legacy.bets >= 10],
    ["legacy picked-side money-bets >=15", (r) => r.market === "moneyline" && !r.actionable && r.legacy.money !== null && r.legacy.bets !== null && r.legacy.money - r.legacy.bets >= 15],
    ["consensus picked-side money >=60", (r) => r.market === "moneyline" && !r.actionable && (r.consensus.money ?? -1) >= 60],
    ["ACTIONABLE confirmation: consensus picked-side money >=60", (r) => r.market === "moneyline" && r.actionable && (r.consensus.money ?? -1) >= 60],
    ["ACTIONABLE confirmation: sharp money-bets >=5", (r) => r.market === "moneyline" && r.actionable && r.sharp.money !== null && r.sharp.bets !== null && r.sharp.money - r.sharp.bets >= 5],
    ["TOTAL FLIP: consensus money-bets >=5", (r) => r.market === "total" && r.flipOdds !== null && r.consensus.money !== null && r.consensus.bets !== null && r.consensus.money - r.consensus.bets >= 5],
  ];
  for (const [label, test] of promotionRules) {
    console.log(`  ${label}`);
    for (const era of ["legacy_unstamped", "stamped_releases"]) {
      const cohort = rows.filter(test).filter((r) =>
        era === "legacy_unstamped" ? r.release === "legacy_unstamped" : r.release !== "legacy_unstamped",
      );
      console.log(`    ${era}: ${fmt(metrics(cohort, label.startsWith("TOTAL FLIP:")))}`);
    }
  }

  console.log("\n## MONEYLINE PROMOTION TIER SEARCH");
  console.log("  Candidate tiers selected on pre-2026-07-11 discovery only; recent stamped releases are a separate stress test.");
  const mlBase = (r: Row): boolean =>
    r.market === "moneyline" &&
    !r.actionable &&
    r.legacy.money !== null &&
    r.legacy.bets !== null &&
    r.legacy.money - r.legacy.bets >= 10;
  const tierRules: Array<[string, (r: Row) => boolean]> = [
    ["base gap>=10", () => true],
    ["gap>=15", (r) => r.legacy.money! - r.legacy.bets! >= 15],
    ["gap>=20", (r) => r.legacy.money! - r.legacy.bets! >= 20],
    ["gap>=25", (r) => r.legacy.money! - r.legacy.bets! >= 25],
    ["gap 10..<20", (r) => r.legacy.money! - r.legacy.bets! < 20],
    ["model p 50..<55", (r) => r.p !== null && r.p >= .50 && r.p < .55],
    ["model p 55..<60", (r) => r.p !== null && r.p >= .55 && r.p < .60],
    ["model p >=60", (r) => r.p !== null && r.p >= .60],
    ["price >=-150", (r) => r.odds !== null && r.odds >= -150],
    ["price >=-125", (r) => r.odds !== null && r.odds >= -125],
    ["plus money", (r) => r.odds !== null && r.odds >= 100],
    ["movement toward", (r) => r.movement === "toward_pick"],
    ["movement not against", (r) => r.movement !== "against_pick"],
    ["consensus money>=55", (r) => (r.consensus.money ?? -1) >= 55],
    ["consensus money>=60", (r) => (r.consensus.money ?? -1) >= 60],
    ["sharp money-bets>=5", (r) => r.sharp.money !== null && r.sharp.bets !== null && r.sharp.money - r.sharp.bets >= 5],
    ["gap>=20 + price>=-150", (r) => r.legacy.money! - r.legacy.bets! >= 20 && r.odds !== null && r.odds >= -150],
    ["gap>=20 + movement not against", (r) => r.legacy.money! - r.legacy.bets! >= 20 && r.movement !== "against_pick"],
    ["gap>=20 + movement toward", (r) => r.legacy.money! - r.legacy.bets! >= 20 && r.movement === "toward_pick"],
    ["gap>=20 + model p 55..<60", (r) => r.legacy.money! - r.legacy.bets! >= 20 && r.p !== null && r.p >= .55 && r.p < .60],
    ["gap>=20 + model p >=55", (r) => r.legacy.money! - r.legacy.bets! >= 20 && r.p !== null && r.p >= .55],
    ["gap>=25 + movement not against", (r) => r.legacy.money! - r.legacy.bets! >= 25 && r.movement !== "against_pick"],
    ["gap>=10 + consensus money>=55", (r) => (r.consensus.money ?? -1) >= 55],
    ["gap>=10 + sharp money-bets>=5", (r) => r.sharp.money !== null && r.sharp.bets !== null && r.sharp.money - r.sharp.bets >= 5],
  ];
  const discoveryPool = train.filter(mlBase);
  const validationPool = holdout.filter((r) => r.release === "legacy_unstamped").filter(mlBase);
  const recentPool = rows.filter((r) => r.release !== "legacy_unstamped").filter(mlBase);
  const tierSelected = tierRules
    .map(([name, test]) => ({ name, test, discovery: metrics(discoveryPool.filter(test)) }))
    .filter((x) => x.discovery.n >= 10 && x.discovery.dates >= 6)
    .sort((a, b) => b.discovery.roi - a.discovery.roi);
  for (const x of tierSelected) {
    const validation = metrics(validationPool.filter(x.test));
    const recent = metrics(recentPool.filter(x.test));
    console.log(`  ${x.name}`);
    console.log(`    discovery ${fmt(x.discovery)}`);
    console.log(`    validation ${fmt(validation)}${validation.n < 12 || validation.dates < 5 ? " [INSUFFICIENT]" : ""}`);
    console.log(`    recent     ${fmt(recent)}${recent.n < 15 || recent.dates < 5 ? " [INSUFFICIENT]" : ""}`);
  }

  console.log("\n## MARKET-ONLY SIDE SELECTION (independent of model direction)");
  const majority = (split: Split): SideDecision =>
    split.money === null ? null : split.money >= 50 ? "keep" : "flip";
  const divergence = (split: Split, minimum = 5): SideDecision => {
    if (split.money === null || split.bets === null) return null;
    const gap = split.money - split.bets;
    return gap >= minimum ? "keep" : gap <= -minimum ? "flip" : null;
  };
  const movementSide = (r: Row): SideDecision =>
    r.movement === "toward_pick" ? "keep" : r.movement === "against_pick" ? "flip" : null;
  const marketRules: Array<[string, (r: Row) => SideDecision]> = [
    ["consensus money majority", (r) => majority(r.consensus)],
    ["sharp money majority", (r) => majority(r.sharp)],
    ["consensus money-ticket divergence >=5", (r) => divergence(r.consensus, 5)],
    ["sharp money-ticket divergence >=5", (r) => divergence(r.sharp, 5)],
    ["consensus divergence >=10", (r) => divergence(r.consensus, 10)],
    ["sharp divergence >=10", (r) => divergence(r.sharp, 10)],
    ["consensus+sharp majority agree", (r) => {
      const c = majority(r.consensus), s = majority(r.sharp);
      return c !== null && c === s ? c : null;
    }],
    ["consensus+sharp divergence agree", (r) => {
      const c = divergence(r.consensus, 5), s = divergence(r.sharp, 5);
      return c !== null && c === s ? c : null;
    }],
    ["provider majority disagrees: follow consensus", (r) => {
      const c = majority(r.consensus), s = majority(r.sharp);
      return c !== null && s !== null && c !== s ? c : null;
    }],
    ["provider majority disagrees: follow sharp", (r) => {
      const c = majority(r.consensus), s = majority(r.sharp);
      return c !== null && s !== null && c !== s ? s : null;
    }],
    ["line movement selects side", movementSide],
    ["movement + consensus majority agree", (r) => {
      const m = movementSide(r), c = majority(r.consensus);
      return m !== null && m === c ? m : null;
    }],
    ["movement + sharp majority agree", (r) => {
      const m = movementSide(r), s = majority(r.sharp);
      return m !== null && m === s ? m : null;
    }],
    ["movement + both providers agree", (r) => {
      const m = movementSide(r), c = majority(r.consensus), s = majority(r.sharp);
      return m !== null && m === c && m === s ? m : null;
    }],
  ];
  for (const market of ["moneyline", "total"] as Market[]) {
    const discovery = train.filter((r) => r.market === market && r.odds !== null);
    const validation = holdout.filter((r) => r.market === market && r.release === "legacy_unstamped");
    const recent = rows.filter((r) => r.market === market && r.release !== "legacy_unstamped");
    const selected = marketRules
      .map(([name, choose]) => ({ name, choose, discovery: strategyMetrics(discovery, choose) }))
      .filter((x) => x.discovery.n >= 20 && x.discovery.dates >= 8)
      .sort((a, b) => b.discovery.roi - a.discovery.roi);
    console.log(`  ${market.toUpperCase()}`);
    for (const x of selected) {
      const val = strategyMetrics(validation, x.choose);
      const rec = strategyMetrics(recent, x.choose);
      console.log(`    ${x.name}`);
      console.log(`      discovery ${fmt(x.discovery)}`);
      console.log(`      validation ${fmt(val)}${val.n < 15 || val.dates < 5 ? " [INSUFFICIENT]" : ""}`);
      console.log(`      recent     ${fmt(rec)}${rec.n < 15 || rec.dates < 5 ? " [INSUFFICIENT]" : ""}`);
    }
  }

  console.log("\n## EXACT ACTIVE MONEYLINE HEAD REPLAY");
  const activeMl = rows.filter((r) =>
    r.market === "moneyline" &&
    r.head === MLB_MODEL_LAYER_VERSION_IDS.moneyline_probability_head,
  );
  const headPeriods: Array<[string, Row[]]> = [
    ["discovery 07-11..07-17", activeMl.filter((r) => r.date >= "2026-07-11" && r.date <= "2026-07-17")],
    ["validation 07-18..07-22", activeMl.filter((r) => r.date >= "2026-07-18" && r.date <= "2026-07-22")],
    ["untouched 07-23+", activeMl.filter((r) => r.date >= "2026-07-23")],
  ];
  const exactPromotionRules: Array<[string, (r: Row) => boolean]> = [
    ["BA candidate: nonaction gap>=20 + movement not against", (r) =>
      !r.actionable && r.legacy.money !== null && r.legacy.bets !== null &&
      r.legacy.money - r.legacy.bets >= 20 && r.movement !== "against_pick"],
    ["broad candidate: nonaction gap>=10 + movement not against", (r) =>
      !r.actionable && r.legacy.money !== null && r.legacy.bets !== null &&
      r.legacy.money - r.legacy.bets >= 10 && r.movement !== "against_pick"],
    ["ship candidate: nonaction non-provisional gap>=10 + movement not against", (r) =>
      !r.actionable && r.grade !== "provisional" &&
      r.legacy.money !== null && r.legacy.bets !== null &&
      r.legacy.money - r.legacy.bets >= 10 && r.movement !== "against_pick"],
    ["probability candidate: nonaction gap>=10 + p55..<60", (r) =>
      !r.actionable && r.legacy.money !== null && r.legacy.bets !== null &&
      r.legacy.money - r.legacy.bets >= 10 && r.p !== null && r.p >= .55 && r.p < .60],
    ["consensus confirms model: nonaction money-bets>=5", (r) =>
      !r.actionable && r.consensus.money !== null && r.consensus.bets !== null &&
      r.consensus.money - r.consensus.bets >= 5],
    ["sharp confirms model: nonaction money-bets>=5", (r) =>
      !r.actionable && r.sharp.money !== null && r.sharp.bets !== null &&
      r.sharp.money - r.sharp.bets >= 5],
    ["both providers majority-confirm model: nonaction", (r) =>
      !r.actionable && (r.consensus.money ?? -1) >= 50 && (r.sharp.money ?? -1) >= 50],
    ["consensus divergence confirms + movement not against: nonaction", (r) =>
      !r.actionable && r.consensus.money !== null && r.consensus.bets !== null &&
      r.consensus.money - r.consensus.bets >= 5 && r.movement !== "against_pick"],
    ["sharp divergence confirms + movement not against: nonaction", (r) =>
      !r.actionable && r.sharp.money !== null && r.sharp.bets !== null &&
      r.sharp.money - r.sharp.bets >= 5 && r.movement !== "against_pick"],
    ["both providers majority-confirm + movement not against: nonaction", (r) =>
      !r.actionable && (r.consensus.money ?? -1) >= 50 && (r.sharp.money ?? -1) >= 50 &&
      r.movement !== "against_pick"],
  ];
  for (const [label, test] of exactPromotionRules) {
    console.log(`  ${label}`);
    for (const [period, periodRows] of headPeriods) {
      console.log(`    ${period}: ${fmt(metrics(periodRows.filter(test)))}`);
    }
  }
  const exactMarketRules: Array<[string, (r: Row) => SideDecision]> = [
    ["consensus divergence>=5 selects side", (r) => divergence(r.consensus, 5)],
    ["line movement selects side", movementSide],
    ["provider disagreement follows sharp", (r) => {
      const c = majority(r.consensus), s = majority(r.sharp);
      return c !== null && s !== null && c !== s ? s : null;
    }],
    ["hierarchy: disagreement sharp > consensus divergence > movement", (r) => {
      const c = majority(r.consensus), s = majority(r.sharp);
      if (c !== null && s !== null && c !== s) return s;
      return divergence(r.consensus, 5) ?? movementSide(r);
    }],
  ];
  for (const [label, choose] of exactMarketRules) {
    console.log(`  ${label}`);
    for (const [period, periodRows] of headPeriods) {
      const allMetrics = strategyMetrics(periodRows, choose);
      const flipMetrics = strategyMetrics(periodRows, (r) => choose(r) === "flip" ? "flip" : null);
      console.log(`    ${period}: all ${fmt(allMetrics)} | flip-only ${fmt(flipMetrics)}`);
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
