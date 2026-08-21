/**
 * Read-only MLB first-inning calibration and movement tournament.
 *
 * Candidate family was declared before inspecting its chronological output:
 *   - incumbent r61 25/75 independent/market blend;
 *   - fixed residual weights 0%, 10%, 15%, 20%, 25%, 35%;
 *   - train-only logistic market+residual calibration;
 *   - marginal-NRFI movement stand-downs at 0.5pp and 1.0pp;
 *   - paired market-concordant promotion from the Toss-Up band.
 *
 * No writes. Locked timestamps and stored game outcomes are authoritative.
 */
import { supabase } from "../../lib/db/supabase";
import { isBlockedSportsbook } from "../../lib/config/blockedSportsbooks";

const START = "2026-06-07";
const END = "2026-08-20";

type DbRow = Record<string, any>;
type Split = "train" | "development" | "validation" | "latest";
type Direction = "NRFI" | "YRFI" | "Toss-Up";

type Row = {
  id: number;
  gameId: number;
  date: string;
  lockedAt: string;
  outcomeNrfi: boolean;
  independent: number;
  market: number;
  nrfiOdds: number;
  yrfiOdds: number;
  tier: string;
  provisional: boolean;
  starterProxy: boolean;
  movementNrfiPp: number | null;
  directionalEligible: boolean;
  shrinkCapture: {
    awayLambda: number;
    homeLambda: number;
    awayOppFactor: number;
    homeOppFactor: number;
    awayStarterFiEra: number | null;
    awayStarterFiStarts: number | null;
    awayStarterFiWhip: number | null;
    homeStarterFiEra: number | null;
    homeStarterFiStarts: number | null;
    homeStarterFiWhip: number | null;
    awayStarterPreferred: boolean;
    homeStarterPreferred: boolean;
  } | null;
};

type Decision = { pick: Direction; pSelected: number | null; odds: number | null };
type Candidate = { id: string; probability: (row: Row) => number; decision?: (row: Row, p: number) => Decision };

function split(date: string): Split {
  if (date <= "2026-07-10") return "train";
  if (date <= "2026-07-31") return "development";
  if (date <= "2026-08-10") return "validation";
  return "latest";
}

function clamp(p: number): number { return Math.max(0.01, Math.min(0.99, p)); }
function logit(p: number): number { const q = clamp(p); return Math.log(q / (1 - q)); }
function logistic(x: number): number { return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)); }
function implied(odds: number): number { return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100); }
function noVigNrfi(nrfiOdds: number, yrfiOdds: number): number {
  const n = implied(nrfiOdds), y = implied(yrfiOdds);
  return n / (n + y);
}
function profit(odds: number, win: boolean): number { return win ? (odds > 0 ? odds / 100 : 100 / -odds) : -1; }
function factorClamp(value: number): number { return Math.max(0.55, Math.min(1.55, value)); }

function defaultDecision(row: Row, pNrfi: number): Decision {
  if (!row.directionalEligible) return { pick: "Toss-Up", pSelected: null, odds: null };
  if (pNrfi >= 0.52 && pNrfi >= row.market && row.nrfiOdds !== 0) return { pick: "NRFI", pSelected: pNrfi, odds: row.nrfiOdds };
  if (pNrfi <= 0.48 && 1 - pNrfi >= 1 - row.market && row.yrfiOdds !== 0) return { pick: "YRFI", pSelected: 1 - pNrfi, odds: row.yrfiOdds };
  return { pick: "Toss-Up", pSelected: null, odds: null };
}

function pageResult(r: { data: any[] | null; error: any }, label: string): any[] {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data ?? [];
}

async function runCurrentSlateComparison(date: string): Promise<void> {
  const predictionResult = await supabase.from("prediction_records")
    .select("id,game_id,slate_date,locked_at,snapshot_json")
    .eq("sport", "mlb").eq("market", "first_inning").eq("slate_date", date)
    .order("id", { ascending: true });
  const rawRecords = pageResult(predictionResult, "current prediction_records");
  const byGame = new Map<number, DbRow>();
  for (const record of rawRecords) byGame.set(Number(record.game_id), record);
  const records = [...byGame.values()];
  const gameIds = records.map((record) => Number(record.game_id));
  const gameResult = gameIds.length
    ? await supabase.from("games").select("id,home_team_id,away_team_id").in("id", gameIds)
    : { data: [], error: null };
  const games = pageResult(gameResult, "current games");
  const teamIds = [...new Set(games.flatMap((game) => [Number(game.home_team_id), Number(game.away_team_id)]))];
  const teamResult = teamIds.length
    ? await supabase.from("teams").select("id,abbreviation,name").in("id", teamIds)
    : { data: [], error: null };
  const teams = new Map(pageResult(teamResult, "current teams").map((team) => [Number(team.id), String(team.abbreviation || team.name || team.id)]));
  const gameMap = new Map(games.map((game) => [Number(game.id), game]));
  const rows = records.map((record) => {
    const audit = record.snapshot_json?.fi_v2_audit ?? {};
    const oldPick = String(audit.fi_pick ?? "Held") as Direction | "Held";
    const reason = String(audit.fi_pick_reason ?? "");
    const posterior = Number(audit.posterior_p_nrfi);
    const nrfiOdds = Number(audit.market_nrfi_odds_american);
    const yrfiOdds = Number(audit.market_yrfi_odds_american);
    let newPick = oldPick;
    if (oldPick === "NRFI" && posterior < 0.54 && posterior < implied(nrfiOdds)) newPick = "Toss-Up";
    else if (oldPick === "Toss-Up" && reason === "fi_toss_up_probability" && posterior > 0.5 && posterior >= implied(nrfiOdds)) newPick = "NRFI";
    const game = gameMap.get(Number(record.game_id));
    const matchup = game
      ? `${teams.get(Number(game.away_team_id)) ?? game.away_team_id}@${teams.get(Number(game.home_team_id)) ?? game.home_team_id}`
      : String(record.game_id);
    return {
      gameId: Number(record.game_id), matchup, lockedAt: record.locked_at,
      posteriorNrfi: Number.isFinite(posterior) ? +posterior.toFixed(4) : null,
      nrfiOdds: Number.isFinite(nrfiOdds) ? nrfiOdds : null,
      yrfiOdds: Number.isFinite(yrfiOdds) ? yrfiOdds : null,
      oldPick, newPick,
      transition: oldPick === newPick ? "retained" : oldPick === "Toss-Up" ? "promotion" : "demotion",
    };
  });
  const counts = (key: "oldPick" | "newPick") => Object.fromEntries(["NRFI", "YRFI", "Toss-Up", "Held"].map((pick) => [pick, rows.filter((row) => row[key] === pick).length]));
  console.log(JSON.stringify({
    mode: "read_only_current_slate_r63_vs_r64",
    noWrites: true,
    date,
    capturedAt: new Date().toISOString(),
    rawRecordCount: rawRecords.length,
    uniqueGameCount: records.length,
    duplicateCurrentGameRowsDiscarded: rawRecords.length - records.length,
    oldCounts: counts("oldPick"),
    newCounts: counts("newPick"),
    promotions: rows.filter((row) => row.transition === "promotion"),
    demotions: rows.filter((row) => row.transition === "demotion"),
    retained: rows.filter((row) => row.transition === "retained"),
  }, null, 2));
}

async function loadPredictionRows(): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let from = 0; ; from += 500) {
    const result = await supabase.from("prediction_records")
      .select("id,game_id,slate_date,locked_at,snapshot_json")
      .eq("sport", "mlb").eq("market", "first_inning")
      .gte("slate_date", START).lte("slate_date", END)
      .not("locked_at", "is", null).order("id", { ascending: true })
      .range(from, from + 499);
    const rows = pageResult(result, "prediction_records");
    out.push(...rows);
    if (rows.length < 500) return out;
  }
}

async function loadGames(ids: number[]): Promise<Map<number, DbRow>> {
  const map = new Map<number, DbRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const result = await supabase.from("games")
      .select("id,first_inning_runs").in("id", ids.slice(i, i + 200));
    for (const row of pageResult(result, "games")) map.set(row.id, row);
  }
  return map;
}

async function loadHistory(ids: number[]): Promise<DbRow[]> {
  const out: DbRow[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    for (let from = 0; ; from += 1000) {
      const result = await supabase.from("line_history")
        .select("game_id,market_type,sportsbook,side,line_value,odds_american,recorded_at,is_opener")
        .in("game_id", chunk).eq("market_type", "first_inning_total")
        .is("player_id", null).order("recorded_at", { ascending: true })
        .range(from, from + 999);
      const rows = pageResult(result, "line_history");
      out.push(...rows);
      if (rows.length < 1000) break;
    }
  }
  return out;
}

function movementFor(record: DbRow, history: DbRow[]): number | null {
  const audit = record.snapshot_json?.fi_v2_audit ?? {};
  const lock = Date.parse(record.locked_at);
  const bookFromReason = String(audit.market_reason ?? "").replace(/^fi_market_ok_/, "").toLowerCase();
  const lockBook = String(record.snapshot_json?.odds_source_at_lock_fi?.picked?.book ?? "").toLowerCase();
  const preferredBook = lockBook || bookFromReason;
  const eligible = history.filter((h) =>
    h.game_id === record.game_id &&
    Math.abs(Number(h.line_value) - 0.5) < 0.001 &&
    Number.isFinite(Number(h.odds_american)) &&
    !isBlockedSportsbook(String(h.sportsbook)) &&
    Date.parse(h.recorded_at) <= lock
  );
  const books = [...new Set(eligible.map((h) => String(h.sportsbook).toLowerCase()))];
  const book = books.includes(preferredBook)
    ? preferredBook
    : books.find((b) => eligible.some((h) => String(h.sportsbook).toLowerCase() === b && h.side === "under") && eligible.some((h) => String(h.sportsbook).toLowerCase() === b && h.side === "over"));
  if (!book) return null;
  const sideRows = (side: string) => eligible
    .filter((h) => String(h.sportsbook).toLowerCase() === book && h.side === side)
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
  const under = sideRows("under"), over = sideRows("over");
  if (!under.length || !over.length) return null;
  const openP = noVigNrfi(Number(under[0].odds_american), Number(over[0].odds_american));
  const lockP = noVigNrfi(Number(under.at(-1)!.odds_american), Number(over.at(-1)!.odds_american));
  return (lockP - openP) * 100;
}

function fitMarketResidual(rows: Row[]): [number, number, number] {
  let beta: [number, number, number] = [0, 1, 0.25];
  const x = (r: Row): [number, number, number] => [1, logit(r.market), logit(r.independent) - logit(r.market)];
  for (let iter = 0; iter < 5000; iter++) {
    const grad = [0, 0, 0];
    for (const row of rows) {
      const f = x(row), p = logistic(beta[0] * f[0] + beta[1] * f[1] + beta[2] * f[2]);
      const err = p - (row.outcomeNrfi ? 1 : 0);
      for (let j = 0; j < 3; j++) grad[j] += err * f[j];
    }
    // Mild ridge on deviations from the identity-market model.
    grad[0] += 0.5 * beta[0]; grad[1] += 0.5 * (beta[1] - 1); grad[2] += 0.5 * beta[2];
    const rate = 0.02 / Math.max(1, rows.length);
    beta = beta.map((b, j) => b - rate * grad[j]) as [number, number, number];
  }
  return beta;
}

function metric(rows: Row[], candidate: Candidate) {
  let brier = 0, ll = 0, actions = 0, wins = 0, units = 0, nrfi = 0, yrfi = 0;
  let negativeActualEv = 0;
  for (const row of rows) {
    const p = clamp(candidate.probability(row));
    const y = row.outcomeNrfi ? 1 : 0;
    brier += (p - y) ** 2;
    ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    const decision = candidate.decision ? candidate.decision(row, p) : defaultDecision(row, p);
    if (decision.pick === "Toss-Up" || decision.odds === null || decision.pSelected === null) continue;
    actions++;
    if (decision.pick === "NRFI") nrfi++; else yrfi++;
    const won = decision.pick === "NRFI" ? row.outcomeNrfi : !row.outcomeNrfi;
    if (won) wins++;
    units += profit(decision.odds, won);
    if (decision.pSelected < implied(decision.odds)) negativeActualEv++;
  }
  return {
    rows: rows.length,
    brier: +(brier / rows.length).toFixed(4),
    logLoss: +(ll / rows.length).toFixed(4),
    actions,
    record: `${wins}-${actions - wins}`,
    winPct: actions ? +(wins / actions * 100).toFixed(1) : null,
    units: +units.toFixed(3),
    roiPct: actions ? +(units / actions * 100).toFixed(1) : null,
    directions: { nrfi, yrfi, nrfiSharePct: actions ? +(nrfi / actions * 100).toFixed(1) : null },
    negativeActualEv,
  };
}

function subgroup(rows: Row[], predicate: (r: Row) => boolean, candidate: Candidate) {
  return Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, metric(rows.filter((r) => split(r.date) === s && predicate(r)), candidate)]));
}

function pairedImpact(rows: Row[], incumbent: Candidate, candidate: Candidate) {
  const cohorts: Record<string, Array<{ row: Row; decision: Decision }>> = {
    promotions: [], demotions: [], retained: [], sideChanges: [],
  };
  for (const row of rows) {
    const bp = incumbent.probability(row), cp = candidate.probability(row);
    const b = incumbent.decision ? incumbent.decision(row, bp) : defaultDecision(row, bp);
    const c = candidate.decision ? candidate.decision(row, cp) : defaultDecision(row, cp);
    const ba = b.pick !== "Toss-Up", ca = c.pick !== "Toss-Up";
    if (!ba && ca) cohorts.promotions.push({ row, decision: c });
    else if (ba && !ca) cohorts.demotions.push({ row, decision: b });
    else if (ba && ca && b.pick !== c.pick) cohorts.sideChanges.push({ row, decision: c });
    else if (ba && ca) cohorts.retained.push({ row, decision: c });
  }
  const summarize = (items: Array<{ row: Row; decision: Decision }>) => {
    let wins = 0, units = 0, nrfi = 0, yrfi = 0;
    for (const { row, decision } of items) {
      if (decision.pick === "NRFI") nrfi++; else if (decision.pick === "YRFI") yrfi++;
      const won = decision.pick === "NRFI" ? row.outcomeNrfi : !row.outcomeNrfi;
      if (won) wins++;
      if (decision.odds !== null) units += profit(decision.odds, won);
    }
    return { rows: items.length, record: `${wins}-${items.length - wins}`, units: +units.toFixed(3), nrfi, yrfi };
  };
  return Object.fromEntries(Object.entries(cohorts).map(([key, value]) => [key, summarize(value)]));
}

function clusteredBootstrap(rows: Row[], incumbent: Candidate, candidate: Candidate, iterations = 10000) {
  const dates = [...new Set(rows.map((r) => r.date))];
  const byDate = new Map(dates.map((date) => [date, rows.filter((r) => r.date === date)]));
  let state = 640821;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const diffs: Array<{ brier: number; units: number; actions: number }> = [];
  for (let i = 0; i < iterations; i++) {
    const sample: Row[] = [];
    for (let j = 0; j < dates.length; j++) sample.push(...(byDate.get(dates[Math.floor(random() * dates.length)]!) ?? []));
    const b = metric(sample, incumbent), c = metric(sample, candidate);
    diffs.push({ brier: c.brier - b.brier, units: c.units - b.units, actions: c.actions - b.actions });
  }
  const interval = (key: keyof typeof diffs[number]) => {
    const values = diffs.map((d) => d[key]).sort((a, b) => a - b);
    return { p025: values[Math.floor(values.length * 0.025)], median: values[Math.floor(values.length * 0.5)], p975: values[Math.floor(values.length * 0.975)] };
  };
  return { dateClusters: dates.length, iterations, candidateMinusIncumbent: { brier: interval("brier"), units: interval("units"), actions: interval("actions") } };
}

async function main() {
  const currentSlateArg = process.argv.find((arg) => arg.startsWith("--current-slate="));
  if (currentSlateArg) {
    await runCurrentSlateComparison(currentSlateArg.slice("--current-slate=".length));
    return;
  }
  const records = await loadPredictionRows();
  const gameLockGroups = new Map<string, DbRow[]>();
  for (const record of records) {
    const key = `${record.game_id}|${record.locked_at}`;
    const group = gameLockGroups.get(key) ?? [];
    group.push(record);
    gameLockGroups.set(key, group);
  }
  const recordsByGameLock = new Map<string, DbRow>();
  for (const record of records) recordsByGameLock.set(`${record.game_id}|${record.locked_at}`, record);
  const uniqueRecords = [...recordsByGameLock.values()];
  const recordUniqueness = {
    rawLockedPredictionRecords: records.length,
    uniqueGameLockObservations: uniqueRecords.length,
    duplicateGameLockRowsDiscarded: records.length - uniqueRecords.length,
    duplicateGroups: [...gameLockGroups.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([key, group]) => ({ key, recordIds: group.map((record) => record.id) })),
  };
  const ids = [...new Set(uniqueRecords.map((r) => Number(r.game_id)).filter(Number.isFinite))];
  const [games, history] = await Promise.all([loadGames(ids), loadHistory(ids)]);
  const histByGame = new Map<number, DbRow[]>();
  for (const h of history) (histByGame.get(h.game_id) ?? histByGame.set(h.game_id, []).get(h.game_id)!).push(h);
  const rows: Row[] = [];
  for (const record of uniqueRecords) {
    const fi = record.snapshot_json?.fi_v2_audit ?? {};
    const game = games.get(record.game_id);
    const firstInningRuns = Number(game?.first_inning_runs);
    const independent = Number(fi.independent_p_nrfi), market = Number(fi.market_nrfi_no_vig);
    const nrfiOdds = Number(fi.market_nrfi_odds_american), yrfiOdds = Number(fi.market_yrfi_odds_american);
    if (!Number.isFinite(independent) || !Number.isFinite(market) || !Number.isFinite(nrfiOdds) || !Number.isFinite(yrfiOdds) || !Number.isFinite(firstInningRuns)) continue;
    const sources = [fi.feature_audit?.away_starter_fi?.source, fi.feature_audit?.home_starter_fi?.source];
    rows.push({
      id: record.id, gameId: record.game_id, date: record.slate_date, lockedAt: record.locked_at,
      outcomeNrfi: firstInningRuns === 0,
      independent, market, nrfiOdds, yrfiOdds,
      tier: String(fi.data_quality_tier ?? "unknown"), provisional: fi.provisional === true,
      starterProxy: sources.includes("proxy"),
      movementNrfiPp: movementFor(record, histByGame.get(record.game_id) ?? []),
      directionalEligible: fi.fresh_data_ready !== false &&
        String(fi.data_quality_tier ?? "") !== "fallback" &&
        Number(fi.feature_audit?.missing_count ?? 0) < 6,
      shrinkCapture: (() => {
        const capture = fi.feature_capture;
        const awayLambda = Number(capture?.lambdas?.away), homeLambda = Number(capture?.lambdas?.home);
        const awayOppFactor = Number(capture?.factors?.away?.opp_starter), homeOppFactor = Number(capture?.factors?.home?.opp_starter);
        if (![awayLambda, homeLambda, awayOppFactor, homeOppFactor].every(Number.isFinite) || awayOppFactor <= 0 || homeOppFactor <= 0) return null;
        return {
          awayLambda, homeLambda, awayOppFactor, homeOppFactor,
          awayStarterFiEra: Number.isFinite(Number(capture?.starter?.away?.first_inning_era)) ? Number(capture.starter.away.first_inning_era) : null,
          awayStarterFiStarts: Number.isFinite(Number(capture?.starter?.away?.first_inning_starts)) ? Number(capture.starter.away.first_inning_starts) : null,
          awayStarterFiWhip: Number.isFinite(Number(capture?.starter?.away?.first_inning_whip)) ? Number(capture.starter.away.first_inning_whip) : null,
          homeStarterFiEra: Number.isFinite(Number(capture?.starter?.home?.first_inning_era)) ? Number(capture.starter.home.first_inning_era) : null,
          homeStarterFiStarts: Number.isFinite(Number(capture?.starter?.home?.first_inning_starts)) ? Number(capture.starter.home.first_inning_starts) : null,
          homeStarterFiWhip: Number.isFinite(Number(capture?.starter?.home?.first_inning_whip)) ? Number(capture.starter.home.first_inning_whip) : null,
          awayStarterPreferred: fi.feature_audit?.home_starter_fi?.source === "preferred",
          homeStarterPreferred: fi.feature_audit?.away_starter_fi?.source === "preferred",
        };
      })(),
    });
  }
  const train = rows.filter((r) => split(r.date) === "train");
  const beta = fitMarketResidual(train);
  const fixed = (weight: number): Candidate => ({
    id: `blend_independent_${Math.round(weight * 100)}`,
    probability: (r) => {
      const tierWeight = r.tier === "medium" ? 0.45 : r.tier === "low" ? 0.25 : r.tier === "fallback" ? 0.05 : weight;
      return tierWeight * r.independent + (1 - tierWeight) * r.market;
    },
  });
  const incumbent = fixed(0.25); incumbent.id = "incumbent_r61_25_75";
  const logisticCandidate: Candidate = {
    id: "train_only_logistic_market_residual",
    probability: (r) => logistic(beta[0] + beta[1] * logit(r.market) + beta[2] * (logit(r.independent) - logit(r.market))),
  };
  const movementPolicy = (threshold: number): Candidate => ({
    ...incumbent,
    id: `incumbent_plus_marginal_nrfi_move_standdown_${threshold}pp`,
    decision: (r, p) => {
      const base = defaultDecision(r, p);
      if (base.pick === "NRFI" && p < 0.54 && r.movementNrfiPp !== null && r.movementNrfiPp <= -threshold) return { pick: "Toss-Up", pSelected: null, odds: null };
      return base;
    },
  });
  const pairedPolicy = (threshold: number): Candidate => ({
    ...incumbent,
    id: `paired_move_policy_${threshold}pp`,
    decision: (r, p) => {
      const base = defaultDecision(r, p);
      if (base.pick === "NRFI" && p < 0.54 && r.movementNrfiPp !== null && r.movementNrfiPp <= -threshold) return { pick: "Toss-Up", pSelected: null, odds: null };
      if (base.pick === "Toss-Up" && r.market <= 0.48 && r.movementNrfiPp !== null && r.movementNrfiPp <= -threshold) return { pick: "YRFI", pSelected: 1 - r.market, odds: r.yrfiOdds };
      if (base.pick === "Toss-Up" && r.market >= 0.52 && r.movementNrfiPp !== null && r.movementNrfiPp >= threshold) return { pick: "NRFI", pSelected: r.market, odds: r.nrfiOdds };
      return base;
    },
  });
  const postedPricePolicy = (marginPp: number, minSelectedProbability: number): Candidate => ({
    ...incumbent,
    id: `posted_price_ev_margin_${marginPp}pp_minp_${Math.round(minSelectedProbability * 100)}`,
    decision: (r, p) => {
      if (!r.directionalEligible) return { pick: "Toss-Up", pSelected: null, odds: null };
      const pick: Direction = p >= 0.5 ? "NRFI" : "YRFI";
      const pSelected = pick === "NRFI" ? p : 1 - p;
      const odds = pick === "NRFI" ? r.nrfiOdds : r.yrfiOdds;
      if (odds === 0 || pSelected < minSelectedProbability || pSelected < implied(odds) + marginPp / 100) return { pick: "Toss-Up", pSelected: null, odds: null };
      return { pick, pSelected, odds };
    },
  });
  const asymmetricResidual = (nrfiWeight: number, yrfiWeight: number): Candidate => ({
    id: `asymmetric_residual_nrfi_${Math.round(nrfiWeight * 100)}_yrfi_${Math.round(yrfiWeight * 100)}`,
    probability: (r) => {
      const weight = r.independent >= r.market ? nrfiWeight : yrfiWeight;
      return weight * r.independent + (1 - weight) * r.market;
    },
  });
  const starterFiShrink = (k: number): Candidate => ({
    id: `starter_fi_era_empirical_bayes_k_${k}`,
    probability: (r) => {
      const c = r.shrinkCapture;
      if (!c) return 0.25 * r.independent + 0.75 * r.market;
      const shrunkenFactor = (era: number | null, starts: number | null, preferred: boolean, current: number) => {
        if (!preferred || era === null || starts === null || starts <= 0) return current;
        const shrunkenEra = (starts * era + k * 4.10) / (starts + k);
        return factorClamp(shrunkenEra / 4.10);
      };
      // Away batting lambda uses the home starter; home batting lambda uses the away starter.
      const awayFactor = shrunkenFactor(c.homeStarterFiEra, c.homeStarterFiStarts, c.homeStarterPreferred, c.awayOppFactor);
      const homeFactor = shrunkenFactor(c.awayStarterFiEra, c.awayStarterFiStarts, c.awayStarterPreferred, c.homeOppFactor);
      const awayLambda = c.awayLambda / c.awayOppFactor * awayFactor;
      const homeLambda = c.homeLambda / c.homeOppFactor * homeFactor;
      const independent = Math.exp(-(awayLambda + homeLambda));
      return 0.25 * independent + 0.75 * r.market;
    },
  });
  const fiWhipModifier = (whip: number | null, starts: number | null): number => {
    if (whip === null || starts === null || starts <= 0) return 1;
    const shrunken = (starts * whip + 10 * 1.225) / (starts + 10);
    return Math.max(0.96, Math.min(1.04, 1 + ((shrunken - 1.225) / 1.225) * 0.35));
  };
  const starterWhipCandidate = (eraShrinkK: number | null): Candidate => ({
    id: eraShrinkK === null ? "starter_fi_whip_conservative" : `starter_fi_era_shrink_k_${eraShrinkK}_plus_whip`,
    probability: (r) => {
      const c = r.shrinkCapture;
      if (!c) return 0.25 * r.independent + 0.75 * r.market;
      const eraFactor = (era: number | null, starts: number | null, preferred: boolean, current: number) => {
        if (eraShrinkK === null || !preferred || era === null || starts === null || starts <= 0) return current;
        return factorClamp(((starts * era + eraShrinkK * 4.10) / (starts + eraShrinkK)) / 4.10);
      };
      const awayEra = eraFactor(c.homeStarterFiEra, c.homeStarterFiStarts, c.homeStarterPreferred, c.awayOppFactor);
      const homeEra = eraFactor(c.awayStarterFiEra, c.awayStarterFiStarts, c.awayStarterPreferred, c.homeOppFactor);
      const awayLambda = c.awayLambda / c.awayOppFactor * awayEra * fiWhipModifier(c.homeStarterFiWhip, c.homeStarterFiStarts);
      const homeLambda = c.homeLambda / c.homeOppFactor * homeEra * fiWhipModifier(c.awayStarterFiWhip, c.awayStarterFiStarts);
      return 0.25 * Math.exp(-(awayLambda + homeLambda)) + 0.75 * r.market;
    },
  });
  const marginalNrfiPricePolicy = (maxNrfiProbability: number): Candidate => ({
    ...incumbent,
    id: `marginal_nrfi_price_gate_${Math.round(maxNrfiProbability * 1000)}`,
    decision: (r, p) => {
      const base = defaultDecision(r, p);
      if (!r.directionalEligible) return base;
      if (base.pick === "NRFI" && p < maxNrfiProbability && p < implied(r.nrfiOdds)) return { pick: "Toss-Up", pSelected: null, odds: null };
      if (base.pick === "Toss-Up" && p > 0.5) {
        if (r.nrfiOdds !== 0 && p >= implied(r.nrfiOdds)) return { pick: "NRFI", pSelected: p, odds: r.nrfiOdds };
      }
      return base;
    },
  });
  const pricePolicies = [postedPricePolicy(0, 0.5), postedPricePolicy(0, 0.51), postedPricePolicy(0.5, 0.5), postedPricePolicy(1, 0.5)];
  const asymmetricPolicies = [asymmetricResidual(0.2, 0.3), asymmetricResidual(0.2, 0.35), asymmetricResidual(0.15, 0.3), asymmetricResidual(0.15, 0.35)];
  const shrinkPolicies = [5, 10, 15, 20, 30, 50].map(starterFiShrink);
  const whipPolicies = [starterWhipCandidate(null), starterWhipCandidate(10), starterWhipCandidate(15)];
  const marginalPricePolicies = [marginalNrfiPricePolicy(0.535), marginalNrfiPricePolicy(0.54)];
  const candidates: Candidate[] = [fixed(0), fixed(0.1), fixed(0.15), fixed(0.2), incumbent, fixed(0.35), logisticCandidate, movementPolicy(0.5), movementPolicy(1), pairedPolicy(0.5), pairedPolicy(1), ...pricePolicies, ...asymmetricPolicies, ...shrinkPolicies, ...whipPolicies, ...marginalPricePolicies];
  const blend20 = candidates.find((candidate) => candidate.id === "blend_independent_20")!;
  const blend35 = candidates.find((candidate) => candidate.id === "blend_independent_35")!;
  const byCandidate = Object.fromEntries(candidates.map((c) => [c.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, metric(rows.filter((r) => split(r.date) === s), c)]))]));
  const coverageBySplit = Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => {
    const r = rows.filter((x) => split(x.date) === s);
    return [s, { rows: r.length, movementRows: r.filter((x) => x.movementNrfiPp !== null).length, observedNrfiPct: +(r.filter((x) => x.outcomeNrfi).length / r.length * 100).toFixed(1) }];
  }));
  const baseDecision = (r: Row) => defaultDecision(r, incumbent.probability(r));
  const baselineMovement = {
    marginalNrfiMarketTowardYrfi05: subgroup(rows, (r) => baseDecision(r).pick === "NRFI" && incumbent.probability(r) < 0.54 && (r.movementNrfiPp ?? Infinity) <= -0.5, incumbent),
    allNrfiMarketTowardYrfi05: subgroup(rows, (r) => baseDecision(r).pick === "NRFI" && (r.movementNrfiPp ?? Infinity) <= -0.5, incumbent),
    nrfiMarketTowardNrfi05: subgroup(rows, (r) => baseDecision(r).pick === "NRFI" && (r.movementNrfiPp ?? -Infinity) >= 0.5, incumbent),
    provisional: subgroup(rows, (r) => r.provisional, incumbent),
    starterProxy: subgroup(rows, (r) => r.starterProxy, incumbent),
  };
  const report = {
    mode: "read_only_predeclared_first_inning_calibration_tournament",
    noWrites: true,
    dateRange: { from: START, to: END },
    recordUniqueness,
    splitPolicy: { train: "Jun 7-Jul 10", development: "Jul 11-Jul 31", validation: "Aug 1-Aug 10", latest: "Aug 11-Aug 20" },
    coverageBySplit,
    fittedTrainOnlyLogistic: { intercept: beta[0], marketLogit: beta[1], independentResidualLogit: beta[2] },
    byCandidate,
    baselineMovement,
    blend20PairedImpact: Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, blend20)])),
    blend35PairedImpact: Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, blend35)])),
    postedPricePolicyPairedImpact: Object.fromEntries(pricePolicies.map((policy) => [policy.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, policy)]))])),
    asymmetricPolicyPairedImpact: Object.fromEntries(asymmetricPolicies.map((policy) => [policy.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, policy)]))])),
    shrinkPolicyPairedImpact: Object.fromEntries(shrinkPolicies.map((policy) => [policy.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, policy)]))])),
    whipPolicyPairedImpact: Object.fromEntries(whipPolicies.map((policy) => [policy.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, policy)]))])),
    marginalPricePolicyPairedImpact: Object.fromEntries(marginalPricePolicies.map((policy) => [policy.id, Object.fromEntries((["train", "development", "validation", "latest"] as Split[]).map((s) => [s, pairedImpact(rows.filter((r) => split(r.date) === s), incumbent, policy)]))])),
    blend20ValidationLatestBootstrap: clusteredBootstrap(rows.filter((r) => split(r.date) === "validation" || split(r.date) === "latest"), incumbent, blend20),
  };
  if (process.argv.includes("--marginal-price-summary")) {
    console.log(JSON.stringify({
      recordUniqueness,
      coverageBySplit,
      incumbent: byCandidate[incumbent.id],
      candidates: Object.fromEntries(marginalPricePolicies.map((policy) => [policy.id, byCandidate[policy.id]])),
      pairedImpact: report.marginalPricePolicyPairedImpact,
    }, null, 2));
  } else if (process.argv.includes("--whip-summary")) {
    console.log(JSON.stringify({
      coverageBySplit,
      incumbent: byCandidate[incumbent.id],
      whipCandidates: Object.fromEntries(whipPolicies.map((policy) => [policy.id, byCandidate[policy.id]])),
      whipPolicyPairedImpact: report.whipPolicyPairedImpact,
    }, null, 2));
  } else if (process.argv.includes("--shrink-summary")) {
    console.log(JSON.stringify({
      coverageBySplit,
      incumbent: byCandidate[incumbent.id],
      shrinkCandidates: Object.fromEntries(shrinkPolicies.map((policy) => [policy.id, byCandidate[policy.id]])),
      shrinkPolicyPairedImpact: report.shrinkPolicyPairedImpact,
    }, null, 2));
  } else if (process.argv.includes("--summary")) {
    console.log(JSON.stringify({
      coverageBySplit,
      incumbent: byCandidate[incumbent.id],
      asymmetricCandidates: Object.fromEntries(asymmetricPolicies.map((policy) => [policy.id, byCandidate[policy.id]])),
      asymmetricPolicyPairedImpact: report.asymmetricPolicyPairedImpact,
      shrinkCandidates: Object.fromEntries(shrinkPolicies.map((policy) => [policy.id, byCandidate[policy.id]])),
      shrinkPolicyPairedImpact: report.shrinkPolicyPairedImpact,
    }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
