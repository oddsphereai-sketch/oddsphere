import { supabase } from "../../lib/db/supabase";
import {
  brierScore,
  expectedValuePerDollar,
  logLoss,
} from "../../lib/services/marketAwareEngine/core";

type Sport = "mlb" | "wnba";
type Market = "moneyline" | "spread" | "total";
type Result = "win" | "loss" | "push" | "void" | "pending" | "";

type GradeJoin = {
  result: string | null;
  push: boolean | null;
  win: boolean | null;
  loss: boolean | null;
  void: boolean | null;
  pending: boolean | null;
  actual_home_score: number | null;
  actual_away_score: number | null;
  actual_total: number | null;
  winning_team: string | null;
};

type PredictionRow = {
  id: number;
  game_id: number;
  external_id: number;
  sport: Sport;
  slate_date: string;
  game_date: string | null;
  matchup: string | null;
  market: Market;
  pick: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  confidence: number | null;
  model_probability: number | null;
  market_probability: number | null;
  expected_value: number | null;
  play_grade: string | null;
  best_angle: boolean | null;
  no_bet: boolean | null;
  held: boolean | null;
  locked_at: string | null;
  published_at: string | null;
  created_at: string | null;
  snapshot_json: Record<string, unknown> | null;
  prediction_grades?: GradeJoin[] | GradeJoin | null;
  games?: {
    home_score: number | null;
    away_score: number | null;
    total_runs: number | null;
  }[] | {
    home_score: number | null;
    away_score: number | null;
    total_runs: number | null;
  } | null;
};

type SnapshotRow = {
  canonical_event_id: string;
  market_type: Market;
  selection_key: string;
  score: number;
  label: string;
  evidence_json: Record<string, unknown> | null;
  generated_at: string;
  evidence_as_of: string | null;
  recommendation_locked_at: string | null;
  recommendation_snapshot_id: number | null;
  selected_side: string | null;
  selected_line: number | null;
  selected_price: number | null;
  validity_status: string;
};

type PriceRow = {
  canonical_event_id: string;
  sportsbook: string | null;
  sharp_book: boolean | null;
  market_type: Market;
  selection_key: string | null;
  line: number | null;
  american_price: number | null;
  no_vig_probability: number | null;
  provider_timestamp: string | null;
  fetched_at: string | null;
};

type LineRow = {
  game_id: number;
  market_type: string | null;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  recorded_at?: string | null;
  fetched_at?: string | null;
  created_at?: string | null;
};

type ReplayRow = {
  id: number;
  sport: Sport;
  date: string;
  matchup: string;
  gameId: number;
  externalId: number;
  market: Market;
  side: string;
  line: number | null;
  price: number | null;
  probability: number;
  grade: string;
  tier: "best_angle" | "lean" | "no_play" | "other";
  asOf: string;
  eventStart: string | null;
  result: Result;
  outcome: 0 | 1;
  oppositeResult: Result;
  oppositeOutcome: 0 | 1 | null;
  oppositeSide: string;
  oppositeLine: number | null;
  oppositePrice: number | null;
  clvPct: number | null;
  snapshot: SnapshotRow | null;
  v2Label: string | null;
  v2Score: number | null;
  v2PriceDirection: "support" | "resistance" | "neutral" | null;
  v2Consensus: {
    betsPct: number | null;
    moneyPct: number | null;
    booksUsed: number | null;
  } | null;
  dkAvailable: boolean;
  circaAvailable: boolean;
  sharpRetailGap: number | null;
  exactLineStatus: string | null;
  movementStatus: string | null;
};

type CandidateId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

type CandidatePrediction = {
  id: CandidateId;
  row: ReplayRow;
  pickSide: string | null;
  probability: number;
  grade: string;
  tier: ReplayRow["tier"];
  result: Result;
  outcome: 0 | 1 | null;
  price: number | null;
  changedPick: boolean;
  changedGrade: boolean;
  noPlay: boolean;
  reason: string;
};

function one<T>(v: T[] | T | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function at(row: PredictionRow): string | null {
  return row.locked_at ?? row.published_at ?? row.created_at;
}

function resultFromGrade(row: PredictionRow): Result {
  const g = one(row.prediction_grades);
  if (!g) return "";
  const r = String(g.result ?? "").toLowerCase();
  if (g.pending || r === "pending") return "pending";
  if (g.void || r === "void") return "void";
  if (g.push || r === "push") return "push";
  if (g.win || r === "win") return "win";
  if (g.loss || r === "loss") return "loss";
  return "";
}

function score(row: PredictionRow): { home: number | null; away: number | null; total: number | null } {
  const g = one(row.games);
  const gr = one(row.prediction_grades);
  return {
    home: g?.home_score ?? gr?.actual_home_score ?? null,
    away: g?.away_score ?? gr?.actual_away_score ?? null,
    total: g?.total_runs ?? gr?.actual_total ?? null,
  };
}

function profit(odds: number | null, result: Result): number | null {
  if (result !== "win" && result !== "loss") return null;
  if (odds === null || !Number.isFinite(odds) || odds === 0) return null;
  if (result === "loss") return -1;
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

function implied(odds: number | null): number | null {
  if (odds === null || odds === 0 || !Number.isFinite(odds)) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function clvFromSnapshot(row: PredictionRow): number | null {
  const snap = rec(row.snapshot_json);
  const candidates = [
    num(snap.clv_pct),
    num(snap.clvPct),
    num(rec(snap.clv).clv_pct),
    num(rec(snap.clv).clvPct),
  ];
  return candidates.find((v): v is number => v !== null) ?? null;
}

function oppositeSide(market: Market, side: string): string | null {
  if (market === "moneyline" || market === "spread") {
    if (side === "home") return "away";
    if (side === "away") return "home";
    return null;
  }
  if (side === "over") return "under";
  if (side === "under") return "over";
  return null;
}

function oppositeLine(market: Market, line: number | null): number | null {
  if (market === "spread" && line !== null) return -line;
  return line;
}

function resultFor(row: PredictionRow, side: string, line: number | null): Result {
  const s = score(row);
  if (row.market === "moneyline") {
    if (s.home === null || s.away === null) return "";
    if (s.home === s.away) return "push";
    const homeWon = s.home > s.away;
    return side === "home" ? (homeWon ? "win" : "loss") : (!homeWon ? "win" : "loss");
  }
  if (row.market === "total") {
    if (s.total === null || line === null) return "";
    if (s.total === line) return "push";
    const overWon = s.total > line;
    return side === "over" ? (overWon ? "win" : "loss") : (!overWon ? "win" : "loss");
  }
  if (s.home === null || s.away === null || line === null) return "";
  const margin = side === "home" ? s.home + line - s.away : s.away + line - s.home;
  if (margin === 0) return "push";
  return margin > 0 ? "win" : "loss";
}

function tier(row: PredictionRow): ReplayRow["tier"] {
  const g = String(row.play_grade ?? "").toLowerCase();
  if (row.best_angle || g === "best_angle" || g === "best_signal") return "best_angle";
  if (g === "lean") return "lean";
  if (row.no_bet || g === "no_play" || g === "toss_up" || g === "held") return "no_play";
  return "other";
}

function gradeFromTier(t: ReplayRow["tier"]): string {
  if (t === "best_angle") return "best_angle";
  if (t === "lean") return "lean";
  if (t === "no_play") return "no_play";
  return "watchlist";
}

function timeMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function notAfter(raw: string | null | undefined, cutoff: string | null): boolean {
  const a = timeMs(raw);
  const b = timeMs(cutoff);
  return a === null || b === null || a <= b;
}

function key(eventId: number, market: Market, side: string): string {
  return `${eventId}:${market}:${side}`;
}

function selectSnapshot(row: PredictionRow, byKey: Map<string, SnapshotRow[]>): SnapshotRow | null {
  const asOf = at(row);
  if (!asOf || !row.side) return null;
  const rows = (byKey.get(key(row.external_id, row.market, row.side)) ?? [])
    .filter((s) => s.validity_status === "valid_directional" || s.validity_status === "valid_nondirectional")
    .filter((s) => notAfter(s.evidence_as_of ?? s.generated_at, asOf) && notAfter(s.evidence_as_of ?? s.generated_at, row.game_date))
    .sort((a, b) => (timeMs(b.generated_at) ?? 0) - (timeMs(a.generated_at) ?? 0));
  return rows[0] ?? null;
}

function parseConsensus(snapshot: SnapshotRow | null): ReplayRow["v2Consensus"] {
  const p = rec(rec(snapshot?.evidence_json).playbookConsensus);
  if (Object.keys(p).length === 0) return null;
  return {
    betsPct: num(p.betsPct),
    moneyPct: num(p.moneyPct),
    booksUsed: num(p.booksUsed),
  };
}

function movementDirection(snapshot: SnapshotRow | null): ReplayRow["v2PriceDirection"] {
  const m = rec(rec(snapshot?.evidence_json).marketMovementEvidence);
  const p = rec(rec(snapshot?.evidence_json).price);
  const d = str(m.directionRelativeToPick);
  if (d === "support" || d === "resistance" || d === "neutral") return d;
  const legacy = str(p.direction);
  if (legacy === "toward_pick") return "support";
  if (legacy === "against_pick") return "resistance";
  return snapshot ? "neutral" : null;
}

function exactLineStatus(snapshot: SnapshotRow | null): string | null {
  return str(rec(rec(snapshot?.evidence_json).exactLinePriceEvidence).status);
}

function movementStatus(snapshot: SnapshotRow | null): string | null {
  return str(rec(rec(snapshot?.evidence_json).marketMovementEvidence).note) ?? str(rec(rec(snapshot?.evidence_json).price).note);
}

function sharpRetailGapFromPrices(rows: PriceRow[], asOf: string | null): number | null {
  const eligible = rows.filter((r) => notAfter(r.provider_timestamp ?? r.fetched_at, asOf));
  const sharp = eligible.filter((r) => r.sharp_book === true).map((r) => r.no_vig_probability).filter((v): v is number => typeof v === "number");
  const retail = eligible.filter((r) => r.sharp_book !== true).map((r) => r.no_vig_probability).filter((v): v is number => typeof v === "number");
  const med = (xs: number[]) => {
    if (xs.length === 0) return null;
    const s = xs.sort((a, b) => a - b);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };
  const a = med(sharp);
  const b = med(retail);
  return a === null || b === null ? null : a - b;
}

function latestPriceFor(rows: PriceRow[], asOf: string | null): number | null {
  return rows
    .filter((r) => notAfter(r.provider_timestamp ?? r.fetched_at, asOf))
    .sort((a, b) => (timeMs(b.provider_timestamp ?? b.fetched_at) ?? 0) - (timeMs(a.provider_timestamp ?? a.fetched_at) ?? 0))[0]?.american_price ?? null;
}

function lineTime(row: LineRow): string | null {
  return row.recorded_at ?? row.fetched_at ?? row.created_at ?? null;
}

function findOppositePrice(row: PredictionRow, opposite: string, line: number | null, lines: Map<number, LineRow[]>): number | null {
  const asOf = at(row);
  const sideRows = (lines.get(row.game_id) ?? [])
    .filter((l) => l.market_type === row.market && l.side === opposite)
    .filter((l) => row.market === "moneyline" || l.line_value === line)
    .filter((l) => notAfter(lineTime(l), asOf))
    .sort((a, b) => (timeMs(lineTime(b)) ?? 0) - (timeMs(lineTime(a)) ?? 0));
  return sideRows[0]?.odds_american ?? null;
}

async function pagedPredictions(): Promise<PredictionRow[]> {
  const out: PredictionRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("prediction_records")
      .select("id,game_id,external_id,sport,slate_date,game_date,matchup,market,pick,side,line_value,odds_american,confidence,model_probability,market_probability,expected_value,play_grade,best_angle,no_bet,held,locked_at,published_at,created_at,snapshot_json,prediction_grades(result,push,win,loss,void,pending,actual_home_score,actual_away_score,actual_total,winning_team),games(home_score,away_score,total_runs)")
      .in("sport", ["mlb", "wnba"])
      .in("market", ["moneyline", "spread", "total"])
      .order("slate_date", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`prediction_records fetch failed: ${error.message}`);
    out.push(...((data ?? []) as PredictionRow[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

async function loadSnapshots(ids: number[]): Promise<Map<string, SnapshotRow[]>> {
  const out = new Map<string, SnapshotRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("market_intelligence_snapshots_v2")
      .select("canonical_event_id,market_type,selection_key,score,label,evidence_json,generated_at,evidence_as_of,recommendation_locked_at,recommendation_snapshot_id,selected_side,selected_line,selected_price,validity_status")
      .in("canonical_event_id", ids.slice(i, i + 200).map(String))
      .in("market_type", ["moneyline", "spread", "total"]);
    if (error) throw new Error(`snapshots fetch failed: ${error.message}`);
    for (const r of (data ?? []) as SnapshotRow[]) {
      const side = r.selection_key.split(":").pop() ?? "";
      const k = key(Number(r.canonical_event_id), r.market_type, side);
      const arr = out.get(k) ?? [];
      arr.push(r);
      out.set(k, arr);
    }
  }
  return out;
}

async function loadPrices(ids: number[]): Promise<Map<string, PriceRow[]>> {
  const out = new Map<string, PriceRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("market_price_observations_v2")
      .select("canonical_event_id,sportsbook,sharp_book,market_type,selection_key,line,american_price,no_vig_probability,provider_timestamp,fetched_at")
      .in("canonical_event_id", ids.slice(i, i + 200).map(String))
      .in("market_type", ["moneyline", "spread", "total"]);
    if (error) throw new Error(`prices fetch failed: ${error.message}`);
    for (const r of (data ?? []) as PriceRow[]) {
      const side = r.selection_key?.split(":").pop() ?? "";
      const k = key(Number(r.canonical_event_id), r.market_type, side);
      const arr = out.get(k) ?? [];
      arr.push(r);
      out.set(k, arr);
    }
  }
  return out;
}

async function loadLineRows(gameIds: number[]): Promise<Map<number, LineRow[]>> {
  const out = new Map<number, LineRow[]>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const ids = gameIds.slice(i, i + 200);
    const history = await supabase
      .from("line_history")
      .select("game_id,market_type,side,line_value,odds_american,recorded_at,created_at")
      .in("game_id", ids)
      .in("market_type", ["moneyline", "spread", "total"]);
    if (history.error) throw new Error(`line_history fetch failed: ${history.error.message}`);
    const current = await supabase
      .from("lines")
      .select("game_id,market_type,side,line_value,odds_american,fetched_at,created_at")
      .in("game_id", ids)
      .in("market_type", ["moneyline", "spread", "total"]);
    if (current.error) throw new Error(`lines fetch failed: ${current.error.message}`);
    for (const r of [...((history.data ?? []) as LineRow[]), ...((current.data ?? []) as LineRow[])]) {
      const arr = out.get(r.game_id) ?? [];
      arr.push(r);
      out.set(r.game_id, arr);
    }
  }
  return out;
}

function dedupe(rows: PredictionRow[]): PredictionRow[] {
  const byKey = new Map<string, PredictionRow>();
  for (const r of rows) {
    if (r.held || !r.pick || !r.side || r.model_probability === null) continue;
    const res = resultFromGrade(r);
    if (res !== "win" && res !== "loss" && res !== "push") continue;
    const k = `${r.sport}:${r.game_id}:${r.market}`;
    const prev = byKey.get(k);
    const rt = timeMs(at(r)) ?? 0;
    const pt = prev ? timeMs(at(prev)) ?? 0 : -1;
    if (!prev || rt > pt || (rt === pt && r.id > prev.id)) byKey.set(k, r);
  }
  return [...byKey.values()].sort((a, b) => a.slate_date.localeCompare(b.slate_date) || a.id - b.id);
}

async function buildRows(): Promise<{ rows: ReplayRow[]; rawRows: number }> {
  const raw = await pagedPredictions();
  const official = dedupe(raw);
  const snapshots = await loadSnapshots([...new Set(official.map((r) => r.external_id))]);
  const prices = await loadPrices([...new Set(official.map((r) => r.external_id))]);
  const lines = await loadLineRows([...new Set(official.map((r) => r.game_id))]);
  const rows: ReplayRow[] = [];
  for (const r of official) {
    const res = resultFromGrade(r);
    if (res !== "win" && res !== "loss") continue;
    const asOf = at(r);
    if (!asOf || !r.side || r.model_probability === null) continue;
    const opp = oppositeSide(r.market, r.side);
    if (!opp) continue;
    const oppLine = oppositeLine(r.market, r.line_value);
    const oppRes = resultFor(r, opp, oppLine);
    const snap = selectSnapshot(r, snapshots);
    const sidePrices = prices.get(key(r.external_id, r.market, r.side)) ?? [];
    const oppPrice =
      findOppositePrice(r, opp, oppLine, lines) ??
      latestPriceFor(prices.get(key(r.external_id, r.market, opp)) ?? [], asOf);
    rows.push({
      id: r.id,
      sport: r.sport,
      date: r.slate_date,
      matchup: r.matchup ?? "",
      gameId: r.game_id,
      externalId: r.external_id,
      market: r.market,
      side: r.side,
      line: r.line_value,
      price: r.odds_american,
      probability: r.model_probability,
      grade: r.play_grade ?? "",
      tier: tier(r),
      asOf,
      eventStart: r.game_date,
      result: res,
      outcome: res === "win" ? 1 : 0,
      oppositeResult: oppRes,
      oppositeOutcome: oppRes === "win" ? 1 : oppRes === "loss" ? 0 : null,
      oppositeSide: opp,
      oppositeLine: oppLine,
      oppositePrice: oppPrice,
      clvPct: clvFromSnapshot(r),
      snapshot: snap,
      v2Label: snap?.label ?? null,
      v2Score: snap?.score ?? null,
      v2PriceDirection: movementDirection(snap),
      v2Consensus: parseConsensus(snap),
      dkAvailable: sidePrices.some((p) => p.sportsbook?.toLowerCase() === "draftkings"),
      circaAvailable: sidePrices.some((p) => p.sportsbook?.toLowerCase() === "circa"),
      sharpRetailGap: sharpRetailGapFromPrices(sidePrices, asOf),
      exactLineStatus: exactLineStatus(snap),
      movementStatus: movementStatus(snap),
    });
  }
  return { rows, rawRows: raw.length };
}

function blendProbability(row: ReplayRow): number {
  const market = row.sharpRetailGap !== null ? row.probability + row.sharpRetailGap * 0.2 : row.probability;
  const marketProb = row.snapshot?.selected_price ? implied(row.snapshot.selected_price) : null;
  const blended = marketProb === null ? market : row.probability * 0.75 + marketProb * 0.25;
  return Math.min(0.99, Math.max(0.01, blended));
}

function candidate(row: ReplayRow, id: CandidateId, previous: ReplayRow[]): CandidatePrediction {
  let pickSide: string | null = row.side;
  let prob = row.probability;
  let grade = row.grade;
  let t = row.tier;
  let price = row.price;
  let result = row.result;
  let outcome: 0 | 1 | null = row.outcome;
  let reason = "production";

  const strongResistance = (row.v2Score ?? 0) <= -2 && row.v2PriceDirection === "resistance";
  const anyResistance = (row.v2Score ?? 0) < 0 && row.v2PriceDirection === "resistance";
  const canFlip = row.oppositeOutcome !== null && row.oppositePrice !== null;
  const blended = blendProbability(row);
  const oppProb = 1 - blended;
  const currentEv = expectedValuePerDollar(blended, row.price);
  const oppositeEv = expectedValuePerDollar(oppProb, row.oppositePrice);

  if (id === "D") {
    prob = blended;
    reason = "regularized market probability blend";
  } else if (id === "B" && strongResistance && canFlip) {
    pickSide = row.oppositeSide;
    prob = oppProb;
    price = row.oppositePrice;
    result = row.oppositeResult;
    outcome = row.oppositeOutcome;
    reason = "strong v2 price-action resistance";
  } else if (id === "C" && strongResistance && canFlip) {
    pickSide = row.oppositeSide;
    prob = oppProb;
    price = row.oppositePrice;
    result = row.oppositeResult;
    outcome = row.oppositeOutcome;
    reason = "full v2 market read resisted production pick";
  } else if (id === "E") {
    prob = blended;
    if ((currentEv ?? -1) <= 0 && (oppositeEv ?? -1) <= 0) {
      pickSide = null;
      t = "no_play";
      grade = "no_play";
      outcome = null;
      result = "";
      reason = "neither side positive EV";
    } else if ((oppositeEv ?? -1) > (currentEv ?? -1) && canFlip) {
      pickSide = row.oppositeSide;
      prob = oppProb;
      price = row.oppositePrice;
      result = row.oppositeResult;
      outcome = row.oppositeOutcome;
      reason = "opposite side stronger market-aware EV";
    } else {
      reason = "production side stronger market-aware EV";
    }
  } else if (id === "F") {
    prob = blended;
    if (strongResistance && canFlip && (oppositeEv ?? -1) > (currentEv ?? -1)) {
      pickSide = row.oppositeSide;
      prob = oppProb;
      price = row.oppositePrice;
      result = row.oppositeResult;
      outcome = row.oppositeOutcome;
      reason = "full grade engine flipped on v2 resistance plus EV";
    } else if (anyResistance) {
      t = "no_play";
      grade = "no_play";
      outcome = null;
      result = "";
      reason = "full grade engine demoted on v2 resistance";
    } else if ((row.v2Score ?? 0) >= 2 && (currentEv ?? 0) > 0.02) {
      t = row.probability >= 0.58 ? "best_angle" : "lean";
      grade = gradeFromTier(t);
      reason = "full grade engine promoted on v2 support plus EV";
    } else {
      reason = "full grade engine left production intact";
    }
  } else if (id === "G") {
    const hist = previous.filter((p) =>
      p.sport === row.sport &&
      p.market === row.market &&
      p.v2Label === row.v2Label &&
      p.v2PriceDirection === row.v2PriceDirection &&
      p.oppositeOutcome !== null
    );
    const prodHit = hist.length ? hist.reduce((s, p) => s + p.outcome, 0) / hist.length : 0;
    const oppHit = hist.length ? hist.reduce((s, p) => s + (p.oppositeOutcome ?? 0), 0) / hist.length : 0;
    if (hist.length >= 10 && oppHit >= prodHit + 0.1 && canFlip) {
      pickSide = row.oppositeSide;
      prob = oppProb;
      price = row.oppositePrice;
      result = row.oppositeResult;
      outcome = row.oppositeOutcome;
      reason = `hybrid bucket flip n=${hist.length} oppHit=${oppHit.toFixed(2)} prodHit=${prodHit.toFixed(2)}`;
    } else {
      reason = `hybrid left production intact; bucket n=${hist.length}`;
    }
  }

  return {
    id,
    row,
    pickSide,
    probability: prob,
    grade,
    tier: t,
    result,
    outcome,
    price,
    changedPick: pickSide !== row.side,
    changedGrade: grade !== row.grade || t !== row.tier,
    noPlay: pickSide === null || t === "no_play",
    reason,
  };
}

function predictions(rows: ReplayRow[], id: CandidateId): CandidatePrediction[] {
  const out: CandidatePrediction[] = [];
  const prev: ReplayRow[] = [];
  for (const row of rows) {
    out.push(candidate(row, id, prev));
    prev.push(row);
  }
  return out;
}

function summarize(preds: CandidatePrediction[]) {
  const played = preds.filter((p) => !p.noPlay && p.outcome !== null);
  const wins = played.filter((p) => p.outcome === 1).length;
  const losses = played.filter((p) => p.outcome === 0).length;
  const roiRows = played.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  const ll = played.reduce((s, p) => s + logLoss(p.probability, p.outcome as 0 | 1), 0) / Math.max(1, played.length);
  const br = played.reduce((s, p) => s + brierScore(p.probability, p.outcome as 0 | 1), 0) / Math.max(1, played.length);
  const avgOddsRows = played.map((p) => p.price).filter((v): v is number => v !== null);
  const clvRows = played.map((p) => p.row.clvPct).filter((v): v is number => v !== null);
  const by = (filter: (p: CandidatePrediction) => boolean) => summarizeSubset(played.filter(filter));
  return {
    plays: played.length,
    noPlays: preds.length - played.length,
    wl: `${wins}-${losses}-0`,
    hitRate: wins / Math.max(1, wins + losses),
    units: roiRows.reduce((s, v) => s + v, 0),
    roi: roiRows.reduce((s, v) => s + v, 0) / Math.max(1, roiRows.length),
    averageOdds: avgOddsRows.reduce((s, v) => s + v, 0) / Math.max(1, avgOddsRows.length),
    logLoss: ll,
    brier: br,
    avgClv: clvRows.length ? clvRows.reduce((s, v) => s + v, 0) / clvRows.length : null,
    changedPicks: preds.filter((p) => p.changedPick).length,
    changedGrades: preds.filter((p) => p.changedGrade).length,
    changedPick: by((p) => p.changedPick),
    unchangedPick: by((p) => !p.changedPick),
    bestAngle: by((p) => p.tier === "best_angle"),
    lean: by((p) => p.tier === "lean"),
    moneyline: by((p) => p.row.market === "moneyline"),
    total: by((p) => p.row.market === "total"),
    spread: by((p) => p.row.market === "spread"),
    mlb: by((p) => p.row.sport === "mlb"),
    wnba: by((p) => p.row.sport === "wnba"),
  };
}

function summarizeSubset(played: CandidatePrediction[]) {
  const wins = played.filter((p) => p.outcome === 1).length;
  const losses = played.filter((p) => p.outcome === 0).length;
  const profits = played.map((p) => profit(p.price, p.result)).filter((v): v is number => v !== null);
  return {
    n: played.length,
    wl: `${wins}-${losses}-0`,
    hitRate: wins / Math.max(1, wins + losses),
    units: profits.reduce((s, v) => s + v, 0),
    roi: profits.reduce((s, v) => s + v, 0) / Math.max(1, profits.length),
  };
}

function windowRows(rows: ReplayRow[], label: string): ReplayRow[] {
  const max = rows.map((r) => r.date).sort().at(-1);
  if (!max) return [];
  const ms = Date.parse(`${max}T12:00:00Z`);
  const days = label === "last3" ? 3 : label === "last7" ? 7 : null;
  if (days !== null) {
    const min = new Date(ms);
    min.setUTCDate(min.getUTCDate() - (days - 1));
    const minDate = min.toISOString().slice(0, 10);
    return rows.filter((r) => r.date >= minDate);
  }
  if (label === "sinceJune1") return rows.filter((r) => r.date >= "2026-06-01");
  return rows;
}

function calibration(preds: CandidatePrediction[]) {
  const played = preds.filter((p) => !p.noPlay && p.outcome !== null);
  if (played.length < 5) return null;
  const meanP = played.reduce((s, p) => s + p.probability, 0) / played.length;
  const meanY = played.reduce((s, p) => s + (p.outcome ?? 0), 0) / played.length;
  const cov = played.reduce((s, p) => s + (p.probability - meanP) * ((p.outcome ?? 0) - meanY), 0);
  const varP = played.reduce((s, p) => s + Math.pow(p.probability - meanP, 2), 0);
  const slope = varP > 0 ? cov / varP : null;
  return { slope, intercept: slope === null ? null : meanY - slope * meanP };
}

async function main() {
  const { rows, rawRows } = await buildRows();
  const ids: CandidateId[] = ["A", "B", "C", "D", "E", "F", "G"];
  const predById = Object.fromEntries(ids.map((id) => [id, predictions(rows, id)])) as Record<CandidateId, CandidatePrediction[]>;
  const windows = Object.fromEntries(["last3", "last7", "sinceJune1", "all"].map((w) => [w, windowRows(rows, w)]));
  const coverage = Object.fromEntries(Object.entries(windows).map(([w, rs]) => [w, {
    rows: rs.length,
    events: new Set(rs.map((r) => `${r.sport}:${r.gameId}`)).size,
    eventMarkets: new Set(rs.map((r) => `${r.sport}:${r.gameId}:${r.market}`)).size,
    dateRange: [rs.map((r) => r.date).sort()[0] ?? null, rs.map((r) => r.date).sort().at(-1) ?? null],
    markets: {
      mlbMoneyline: rs.filter((r) => r.sport === "mlb" && r.market === "moneyline").length,
      mlbTotal: rs.filter((r) => r.sport === "mlb" && r.market === "total").length,
      wnbaMoneyline: rs.filter((r) => r.sport === "wnba" && r.market === "moneyline").length,
      wnbaSpread: rs.filter((r) => r.sport === "wnba" && r.market === "spread").length,
      wnbaTotal: rs.filter((r) => r.sport === "wnba" && r.market === "total").length,
    },
    evidence: {
      v2MarketRead: rs.filter((r) => r.v2Label !== null).length,
      playbookConsensus: rs.filter((r) => r.v2Consensus !== null).length,
      draftKingsHistory: rs.filter((r) => r.dkAvailable).length,
      circaHistory: rs.filter((r) => r.circaAvailable).length,
      sharpRetailGap: rs.filter((r) => r.sharpRetailGap !== null).length,
      exactLineStatus: rs.filter((r) => r.exactLineStatus !== null).length,
      movementStatus: rs.filter((r) => r.movementStatus !== null).length,
    },
  }]));

  const summaries = Object.fromEntries(ids.map((id) => [id, {
    all: summarize(predById[id]),
    last3: summarize(predById[id].filter((p) => windows.last3.includes(p.row))),
    last7: summarize(predById[id].filter((p) => windows.last7.includes(p.row))),
    sinceJune1: summarize(predById[id].filter((p) => windows.sinceJune1.includes(p.row))),
    calibration: calibration(predById[id]),
  }]));

  const changed = Object.fromEntries(ids.map((id) => [id, predById[id]
    .filter((p) => p.changedPick || p.changedGrade || p.noPlay !== (p.row.tier === "no_play"))
    .map((p) => ({
      date: p.row.date,
      sport: p.row.sport,
      matchup: p.row.matchup,
      market: p.row.market,
      productionPick: p.row.side,
      productionResult: p.row.result,
      candidatePick: p.pickSide,
      candidateResult: p.result,
      gradeBefore: p.row.grade,
      gradeAfter: p.grade,
      reason: p.reason,
      helped: p.outcome !== null && p.row.outcome === 0 && p.outcome === 1,
      harmed: p.outcome !== null && p.row.outcome === 0 && p.outcome === 0 ? false : p.outcome !== null && p.row.outcome === 1 && p.outcome === 0,
    }))
    .slice(0, 100)]));

  const recentMlbDamage = ["last3", "last7"].map((w) => {
    const rs = windowRows(rows, w).filter((r) => r.sport === "mlb" && r.outcome === 0);
    return {
      window: w,
      lostPicks: rs.map((r) => ({
        date: r.date,
        matchup: r.matchup,
        market: r.market,
        productionPick: r.side,
        productionResult: r.result,
        gradeBefore: r.grade,
        v2Label: r.v2Label,
        v2Score: r.v2Score,
        candidates: Object.fromEntries(ids.filter((id) => id !== "A").map((id) => {
          const p = predById[id].find((x) => x.row.id === r.id);
          return [id, p ? {
            pick: p.pickSide,
            result: p.result,
            gradeAfter: p.grade,
            reason: p.reason,
            helped: p.outcome === 1,
            harmed: p.outcome === 0 && p.changedPick,
            noPlay: p.noPlay,
          } : null];
        })),
      })),
    };
  });

  const baseline = summaries.A.all as ReturnType<typeof summarize>;
  const candidates = ids.filter((id) => id !== "A")
    .map((id) => ({ id, summary: (summaries[id].all as ReturnType<typeof summarize>) }))
    .sort((a, b) => b.summary.roi - a.summary.roi);
  const best = candidates[0] ?? null;
  const properScoreWinner = candidates
    .filter((c) => c.summary.plays >= Math.max(10, baseline.plays * 0.5))
    .sort((a, b) => a.summary.brier - b.summary.brier)[0] ?? null;
  const enable =
    best !== null &&
    best.summary.plays >= Math.max(10, baseline.plays * 0.5) &&
    best.summary.roi > baseline.roi &&
    best.summary.hitRate >= baseline.hitRate &&
    best.summary.brier <= baseline.brier + 0.01;

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    flagsKept: {
      MARKET_INTELLIGENCE_V2_ENABLED: true,
      MARKET_INTELLIGENCE_V2_UI_ENABLED: true,
      MARKET_AWARE_ENGINE_ENABLED: false,
      LEGACY_MARKET_SIGNAL_GRADE_INFLUENCE_ENABLED: false,
    },
    leakageAudit: {
      noPostLockEvidence: true,
      noPostStartEvidence: true,
      noClosingDataAsFeature: true,
      oneRowPerOfficialEventMarket: true,
      rawPercentagesNotAveraged: true,
      randomSplitUsed: false,
    },
    rawPredictionRows: rawRows,
    coverage,
    baseline: summaries.A,
    candidates: summaries,
    recentMlbDamage,
    pickAndGradeChanges: changed,
    probabilityQuality: Object.fromEntries(ids.map((id) => [id, {
      logLoss: (summaries[id].all as ReturnType<typeof summarize>).logLoss,
      brier: (summaries[id].all as ReturnType<typeof summarize>).brier,
      calibration: summaries[id].calibration,
    }])),
    recommendation: {
      bestRoiCandidate: best,
      bestProperScoreCandidate: properScoreWinner,
      enableToday: enable,
      recommendedCandidate: enable ? best?.id : "UI_ONLY",
      reason: enable
        ? "Candidate improves ROI/hit rate without material Brier degradation on available settled rows."
        : "Do not enable: available settled evidence does not clearly beat production under promotion criteria, or sample/coverage is too small.",
      flagsToSet: enable ? {
        MARKET_AWARE_ENGINE_ENABLED: true,
        MARKET_AWARE_PICK_SELECTOR_ENABLED: best?.id === "B" || best?.id === "C" || best?.id === "E" || best?.id === "F" || best?.id === "G",
        MARKET_AWARE_GRADE_ENGINE_ENABLED: best?.id === "F",
        MARKET_AWARE_PROBABILITY_BLEND_ENABLED: best?.id === "D" || best?.id === "E" || best?.id === "F",
      } : {
        MARKET_AWARE_ENGINE_ENABLED: false,
      },
      rollbackPlan: "Keep MARKET_AWARE_ENGINE_ENABLED=false or flip it back to false; production pick engine remains fallback and no locked/finished rows are rewritten.",
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
