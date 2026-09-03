/**
 * WNBA Daily Edge — PREVIEW adapter (Phase 1, 2026-06-23).
 *
 * Returns clean JSON for `/api/lab/daily-edge?sport=wnba&preview=1`. NO DB writes,
 * NO cron, NO lock, NO tracking, NO prod — preview-only and gated in the route.
 *
 * Philosophy (validated in wnba-research/): INDEPENDENT MODEL FIRST, market as
 * comparator/calibrator (not the answer), dynamic market weight, cold-start
 * market-informed prior for low-history teams, every market produces a final side,
 * spread/total use their OWN distribution confidence (never ML confidence).
 *
 * Sources: BallDontLie (authoritative schedule + scores → Elo) + SharpAPI (odds,
 * cursor-paginated, team-pair+date matched, trusted-book consensus, Fliff blocked,
 * stale/alt lines filtered). Future 0-0 games are guarded so they never corrupt
 * ratings/projections. ESPN four-factors were tested and dropped (didn't beat Elo).
 */

import { isRealWnbaTeam, wnbaAbbr } from "./wnbaTeams";
import { selectMainTotalLine } from "@/lib/services/selectMainTotalLine";
import { applyPublicMarketContext, type PublicMarketContext, type PublicMarketSignal } from "@/lib/services/publicMarketContext";
import {
  buildWnbaCoreModelCalibrationAudit,
  type WnbaCoreModelCalibrationInput,
} from "@/lib/automodel/wnbaCoreModelCalibration";
import {
  EXPECTED_WNBA_CALIBRATION_FLAGS,
  EXPECTED_WNBA_GRADE_POLICY_VERSION,
} from "@/lib/automodel/wnbaChampionRuntime";
import type { WnbaIndependentModelEvidence } from "./wnbaForwardEvidenceCapture";
import {
  buildWnbaMaximumEntropyMarginDistribution,
  buildWnbaResolvedMarketDecision,
  pairWnbaCompleteMarketRows,
  selectWnbaUpperMedianEvaluatedRow,
  standardNormalCdf,
  uniqueWnbaModalLine,
  wnbaExactPriceValueGate,
  wnbaIndependentSourceFamilyCount,
  wnbaMarginProbabilityAbove,
  wnbaPairRowForSide,
  type WnbaCompleteMarketPair,
  type WnbaTargetExcludedPriceRow,
} from "./wnbaTargetExcludedMarketDecision";

const BDL = "https://api.balldontlie.io/wnba/v1";
const SHARP = "https://api.sharpapi.io/api/v1";
const BLOCKED = new Set(["fliff", "kalshi", "polymarket"]);
export const SHARP_BOOKS = new Set(["circa", "pinnacle", "bookmaker"]);
// Margin sigma was validated on the 996-game possession/efficiency replay.
// Total sigma is intentionally wider than the launch value: the larger
// walk-forward score replay measured roughly 13.5-14.2 points of total MAE,
// while launch tracking showed that 15.0 overstated O/U confidence.
const HFA = 65, K = 20, PPE = 25, SIG_M = 12.8, SIG_T = 18.0, COLD = 15;

// ── math ──
const dexp = (d: number) => 1 / (1 + Math.pow(10, d / 400));
const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
const clp = (p: number) => Math.min(0.99, Math.max(0.01, p));
const platt = (p: number) => sigm(0.85 * logit(clp(p)) - 0.2); // calibration, validated OOS
const amProb = (o: number) => (o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100));
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const norm = (s: string) => String(s).replace(/[^a-z]/gi, "").toLowerCase();
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function erf(x: number) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const Phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
// Inverse normal CDF (Acklam) — maps a win probability back to a z-score so the
// projected margin can be derived coherently from the blended win prob.
function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1); }
  if (p <= ph) { q = p - 0.5; r = q * q; return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}
const r1 = (n: number) => Math.round(n * 10) / 10;

// ── types ──
type BdlGame = { id: number; date: string; season: number; postseason: boolean; h: number; a: number; hs: number; as: number };
export type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution";
export type ModelState = {
  elo: Map<number, number>;
  games: Map<number, number>;
  pf: Map<number, number[]>;
  pa: Map<number, number[]>;
  margins?: Map<number, number[]>;
  lastGameDate?: Map<number, string>;
  leagueAvgScore?: number;
  leagueAvgTotal?: number;
  nameById: Map<number, string>;
  mascot: [string, number][];
  rawGames: BdlGame[];
  computedAt: number;
};

function americanBreakEvenProbability(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function americanExpectedReturn(probability: number, odds: number): number {
  const winProfit = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  return probability * winProfit - (1 - probability);
}

/**
 * Grade the published WNBA moneyline probability against both the no-vig
 * market and the actual offered price. The old rule graded the independent
 * pre-blend edge and only allowed Best Angle for -200..-299 favorites. That
 * ranked expensive favorites above the value signal members could bet.
 */
export function wnbaMoneylineGradeFromValue(args: {
  finalPickedProbability: number | null;
  marketPickedProbability: number | null;
  pickedOdds: number | null;
  conflict: boolean;
  marketReliability: number;
  bookCount: number;
}): Grade {
  const {
    finalPickedProbability,
    marketPickedProbability,
    pickedOdds,
    conflict,
    marketReliability,
    bookCount,
  } = args;
  if (
    finalPickedProbability === null ||
    marketPickedProbability === null ||
    pickedOdds === null
  ) return "Watchlist";
  const pickedEdge = finalPickedProbability - marketPickedProbability;
  const priceEv = americanExpectedReturn(finalPickedProbability, pickedOdds);
  if (pickedEdge <= 0 || priceEv < 0) return "Watchlist";
  if (conflict && marketReliability >= 0.8 && (pickedEdge < 0.04 || priceEv < 0.02)) {
    return "Caution";
  }
  if (
    pickedEdge >= 0.04 &&
    priceEv >= 0.02 &&
    bookCount >= 4
  ) return "Best Angle";
  if (pickedEdge >= 0.02 && priceEv >= 0.02 && bookCount >= 4) return "Lean";
  return "Watchlist";
}

function wnbaMoneylineExactPriceGrade(args: {
  pickedProbability: number | null;
  pickedOdds: number | null;
  conflict: boolean;
  marketReliability: number;
}): Grade {
  if (args.pickedProbability === null || args.pickedOdds === null) return "Watchlist";
  const breakEven = americanBreakEvenProbability(args.pickedOdds);
  const priceEdge = args.pickedProbability - breakEven;
  const priceEv = americanExpectedReturn(args.pickedProbability, args.pickedOdds);
  if (priceEdge <= 0 || priceEv < 0) return "Watchlist";
  if (args.conflict && args.marketReliability >= 0.8 && (priceEdge < 0.04 || priceEv < 0.02)) {
    return "Caution";
  }
  if (priceEdge >= 0.04 && priceEv >= 0.02) return "Best Angle";
  if (priceEdge >= 0.02 && priceEv >= 0.02) return "Lean";
  return "Watchlist";
}

export const WNBA_SPREAD_ELO_STAT_AGREEMENT_RULE_ID =
  "wnba_home_spread_elo_stat_agreement_lean_v1_2026_08_10";
export const WNBA_SPREAD_ELO_STAT_MAX_GAP_EXCLUSIVE = 3;
export const WNBA_SPREAD_ELO_STAT_MIN_BOOKS = 10;
export const WNBA_SPREAD_PROJECTION_REST_RULE_ID =
  "wnba_spread_projection_rest_agreement_lean_v1_2026_08_12";
export const WNBA_SPREAD_PROJECTION_REST_MIN_BOOKS = 10;

export function resolveWnbaSpreadEloStatAgreementLean(args: {
  grade: Grade | null;
  selectedSide: "home" | "away" | null;
  eloMargin: number;
  statMargin: number;
  bookCount: number;
  pickedOdds: number | null;
  publicConflict: PublicMarketContext["conflict"];
  exactValueLeanEligible?: boolean;
}): { grade: Grade | null; promoted: boolean; gap: number } {
  const gap = Math.abs(args.eloMargin - args.statMargin);
  const promoted =
    args.grade === "Watchlist" &&
    args.selectedSide === "home" &&
    gap < WNBA_SPREAD_ELO_STAT_MAX_GAP_EXCLUSIVE &&
    args.bookCount >= WNBA_SPREAD_ELO_STAT_MIN_BOOKS &&
    args.pickedOdds !== null &&
    args.exactValueLeanEligible === true &&
    args.publicConflict === "none";
  return { grade: promoted ? "Lean" : args.grade, promoted, gap };
}

export function resolveWnbaSpreadProjectionRestLean(args: {
  grade: Grade | null;
  selectedSide: "home" | "away" | null;
  selectedProjectionGap: number | null;
  restDifference: number | null;
  bookCount: number;
  pickedOdds: number | null;
  publicConflict: PublicMarketContext["conflict"];
  exactValueLeanEligible?: boolean;
}): { grade: Grade | null; promoted: boolean } {
  const restNotAgainst =
    args.selectedSide !== null &&
    (args.restDifference === null ||
      (args.selectedSide === "home" ? args.restDifference >= 0 : args.restDifference <= 0));
  const promoted =
    args.grade === "Watchlist" &&
    args.selectedSide !== null &&
    args.selectedProjectionGap !== null &&
    args.selectedProjectionGap > 0 &&
    args.bookCount >= WNBA_SPREAD_PROJECTION_REST_MIN_BOOKS &&
    args.pickedOdds !== null &&
    args.exactValueLeanEligible === true &&
    restNotAgainst &&
    args.publicConflict === "none";
  return { grade: promoted ? "Lean" : args.grade, promoted };
}

// ── BDL fetch (cursor) ──
async function bdl(path: string, key: string): Promise<{ data: unknown[]; meta?: { next_cursor?: number } }> {
  const r = await fetch(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!r.ok) throw new Error(`BDL ${path} HTTP ${r.status}`);
  return r.json() as Promise<{ data: unknown[]; meta?: { next_cursor?: number } }>;
}
async function bdlGames(key: string): Promise<BdlGame[]> {
  // Fetch seasons in PARALLEL (was sequential — the dominant cost on a cold
  // serverless invocation). Pagination within a season stays sequential
  // (cursor dependency), but ~9 seasons no longer run back-to-back.
  const years = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const perYear = await Promise.all(years.map(async (yr) => {
    const out: BdlGame[] = [];
    let cursor: number | undefined; let pages = 0;
    while (pages < 8) {
      const j = await bdl(`/games?seasons[]=${yr}&per_page=100${cursor ? `&cursor=${cursor}` : ""}`, key);
      for (const g of j.data as Record<string, unknown>[]) {
        const hs = g.home_score as number, as = g.away_score as number;
        out.push({ id: g.id as number, date: String(g.date).slice(0, 10), season: g.season as number, postseason: !!g.postseason,
          h: (g.home_team as { id: number }).id, a: (g.visitor_team as { id: number }).id, hs, as });
      }
      pages++; cursor = j.meta?.next_cursor; if (!cursor) break;
    }
    return out;
  }));
  return perYear.flat().sort((x, y) => (x.date < y.date ? -1 : 1));
}

// ── Elo (fixed K=20; dynamic K tested & rejected) + recent scoring; cached in-process ──
let MODEL_CACHE: ModelState | null = null;
export async function getModel(): Promise<ModelState> {
  if (MODEL_CACHE && Date.now() - MODEL_CACHE.computedAt < 30 * 60 * 1000) return MODEL_CACHE;
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("missing BALLDONTLIE_API_KEY");
  const teamsJson = await bdl(`/teams`, key);
  const nameById = new Map<number, string>(); const mascot: [string, number][] = [];
  for (const t of teamsJson.data as Record<string, unknown>[]) { nameById.set(t.id as number, t.full_name as string); mascot.push([norm(t.name as string), t.id as number]); }
  const rawGames = await bdlGames(key);
  // GUARD: drop future 0-0 games AND non-franchise squads (All-Star / national
  // exhibition / TBD) so they never corrupt ratings or projections.
  const games = rawGames.filter((g) => g.hs > 0 && g.as > 0 && isRealWnbaTeam(g.h) && isRealWnbaTeam(g.a));
  const elo = new Map<number, number>(), ls = new Map<number, number>(), games_ = new Map<number, number>(), pf = new Map<number, number[]>(), pa = new Map<number, number[]>(), margins = new Map<number, number[]>(), lastGameDate = new Map<number, string>();
  let leaguePoints = 0, leagueTeamGames = 0;
  const E = (t: number) => elo.get(t) ?? 1500;
  for (const g of games) {
    for (const t of [g.h, g.a]) { if (ls.get(t) !== undefined && ls.get(t) !== g.season) elo.set(t, 1500 + 0.75 * (E(t) - 1500)); ls.set(t, g.season); }
    const eh = E(g.h), ea = E(g.a), pH = dexp(-(eh + HFA - ea)), won = g.hs > g.as ? 1 : 0;
    const m = g.hs - g.as, hw = m > 0, mult = Math.log(Math.abs(m) + 1) * (2.2 / ((hw ? eh + HFA - ea : ea - eh - HFA) * 0.001 + 2.2));
    elo.set(g.h, eh + K * mult * (won - pH)); elo.set(g.a, ea - K * mult * (won - pH));
    games_.set(g.h, (games_.get(g.h) ?? 0) + 1); games_.set(g.a, (games_.get(g.a) ?? 0) + 1);
    for (const [t, f, ag] of [[g.h, g.hs, g.as], [g.a, g.as, g.hs]] as [number, number, number][]) {
      (pf.get(t) ?? pf.set(t, []).get(t)!).push(f);
      (pa.get(t) ?? pa.set(t, []).get(t)!).push(ag);
      (margins.get(t) ?? margins.set(t, []).get(t)!).push(f - ag);
      lastGameDate.set(t, g.date);
      leaguePoints += f;
      leagueTeamGames++;
    }
  }
  const leagueAvgScore = leagueTeamGames > 0 ? leaguePoints / leagueTeamGames : 82;
  MODEL_CACHE = { elo, games: games_, pf, pa, margins, lastGameDate, leagueAvgScore, leagueAvgTotal: leagueAvgScore * 2, nameById, mascot, rawGames, computedAt: Date.now() };
  return MODEL_CACHE;
}
const rollN = (m: Map<number, number[]> | undefined, t: number, fallback: number, n = 10) => {
  const x = m?.get(t) ?? [];
  return x.length ? x.slice(-n).reduce((s, v) => s + v, 0) / Math.min(n, x.length) : fallback;
};
const daysBetween = (from: string | undefined, to: string) => {
  if (!from) return 7;
  const d = Math.round((+new Date(to + "T12:00:00Z") - +new Date(from + "T12:00:00Z")) / 86400000);
  return Number.isFinite(d) ? d : 7;
};

// ── SharpAPI odds (cursor; game markets; resolve teams; pair+date; trusted consensus) ──
export type OddRow = { book: string; sharp: boolean; mkt: string; selType: string; odds: number | null; line: number | null; date: string | null; observedAt?: string | null; startsAt?: string | null; h: number; a: number };
export type WnbaPublicMarketSignals = Partial<Record<"moneyline" | "total" | "spread", Partial<Record<string, PublicMarketSignal>>>>;
async function wnbaOdds(resolve: (s: string) => number | null): Promise<OddRow[]> {
  const key = process.env.SHARPAPI_KEY; if (!key) throw new Error("missing SHARPAPI_KEY");
  const evDate = (s: string) => { const m = String(s).match(/20\d\d-\d\d-\d\d/); return m ? m[0] : null; };
  // Fetch the 3 markets in PARALLEL (pagination within a market stays
  // sequential on its cursor).
  const perMarket = await Promise.all(["moneyline", "point_spread", "total_points"].map(async (mkt) => {
    const rows: OddRow[] = [];
    let cursor: string | null = null, pages = 0;
    while (pages < 10) {
      const url = `${SHARP}/odds?league=wnba&market_type=${mkt}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) break;
      const j = await r.json() as { data?: Record<string, unknown>[]; pagination?: { has_more?: boolean; next_cursor?: string } };
      for (const x of j.data ?? []) {
        const book = String(x.sportsbook ?? "").toLowerCase();
        if (BLOCKED.has(book) || x.is_main_line === false || x.is_stale_pregame_price === true) continue;
        const h = resolve(String(x.home_team)), a = resolve(String(x.away_team)); if (!h || !a || h === a) continue;
        const providerObservedAt = [x.updated_at, x.fetched_at, x.observed_at]
          .find((value) => typeof value === "string" && Number.isFinite(Date.parse(value))) as string | undefined;
        rows.push({ book, sharp: SHARP_BOOKS.has(book), mkt, selType: String(x.selection_type), odds: x.odds_american == null ? null : Number(x.odds_american),
          line: x.line == null ? null : Number(x.line), date: evDate(String(x.event_id)) ?? evDate(String(x.event_start_time)), observedAt: providerObservedAt ?? null,
          startsAt: typeof x.event_start_time === "string" ? x.event_start_time : null, h, a });
      }
      pages++; if (!j.pagination?.has_more || !j.pagination?.next_cursor) break; cursor = j.pagination.next_cursor;
    }
    return rows;
  }));
  return perMarket.flat();
}

const shiftDate = (d: string, n: number) => new Date(+new Date(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function gradeMarket(absEdge: number, books: number, disp: number, sharpAgree: boolean): Grade {
  if (books < 2) return "Watchlist";
  if (absEdge >= 4 && disp <= 2 && books >= 4 && sharpAgree) return "Best Angle";
  if (absEdge >= 2.5 && disp <= 3 && books >= 3) return "Lean";
  return "Watchlist";
}

/**
 * Canonical per-game WNBA model compute (single-sourced; used by the DB-backed
 * runWnbaModel and the live preview). DECISION LAYER honors Decision A: all
 * non-blocked books feed dispersion/audit, but the FINAL market probability
 * prefers the trusted/sharp consensus (falls back to all-books), and the
 * DISPLAYED line uses modal consensus (selectMainTotalLine) so one outlier/alt
 * line can never drive the side. Coherent by construction: the side is decided
 * vs the SAME modal line that is displayed/locked/graded.
 */
function computeWnbaPredictionIncumbent(
  M: ModelState,
  g: { id: number; date: string; h: number; a: number },
  r: OddRow[],
  publicSignals: WnbaPublicMarketSignals = {},
  calibrationFlags: Pick<
    WnbaCoreModelCalibrationInput,
    | "coreModelEnabled"
    | "totalProjectionCalibrationEnabled"
    | "spreadMarginCalibrationEnabled"
    | "totalRecommendationUsesCalibratedProjection"
    | "spreadRecommendationUsesCalibratedMargin"
    | "gradeCalibrationEnabled"
  > = EXPECTED_WNBA_CALIBRATION_FLAGS,
  evidenceObserver?: (evidence: WnbaIndependentModelEvidence) => void,
  inferenceOptions: { applyColdStartMarketPrior?: boolean } = {},
) {
  const E = (t: number) => M.elo.get(t) ?? 1500;
  const hN = M.nameById.get(g.h) ?? wnbaAbbr(g.h) ?? String(g.h);
  const aN = M.nameById.get(g.a) ?? wnbaAbbr(g.a) ?? String(g.a);
  const gpH = M.games.get(g.h) ?? 0, gpA = M.games.get(g.a) ?? 0;

  // market consensus: all non-blocked books (storage/audit) + sharp subset (decision)
  const mlH: { book: string; odds: number }[] = [], mlA: { book: string; odds: number }[] = [];
  const spBooks: { sportsbook: string; line_value: number; odds_american: number | null }[] = [], spS: number[] = [];
  const toBooks: { sportsbook: string; line_value: number }[] = [], toS: number[] = [];
  for (const x of r) {
    const homeIsBdlHome = x.h === g.h;
    if (x.mkt === "moneyline" && x.odds != null) ((x.selType === "home") === homeIsBdlHome ? mlH : mlA).push({ book: x.book, odds: x.odds });
    if (x.mkt === "point_spread" && x.line != null && Math.abs(x.line) < 40 && (x.selType === "home") === homeIsBdlHome) { spBooks.push({ sportsbook: x.book, line_value: x.line, odds_american: x.odds }); if (x.sharp) spS.push(x.line); }
    if (x.mkt === "total_points" && (x.selType === "over" || x.selType === "under") && x.line != null && x.line > 120 && x.line < 220) { toBooks.push({ sportsbook: x.book, line_value: x.line }); if (x.sharp) toS.push(x.line); }
  }
  const bP: number[] = [], sP: number[] = [];
  for (const h of mlH) { const a = mlA.find((z) => z.book === h.book); if (a) { const p = amProb(h.odds) / (amProb(h.odds) + amProb(a.odds)); bP.push(p); if (SHARP_BOOKS.has(h.book)) sP.push(p); } }
  const mktP = median(bP), sharpMktP = median(sP), mlBooks = bP.length, trustedBooks = sP.length;
  const mktPDec = sharpMktP ?? mktP; // DECISION: trusted/sharp consensus preferred
  const spVals = spBooks.map((b) => b.line_value), toVals = toBooks.map((b) => b.line_value);
  const mktSpread = selectMainTotalLine(spBooks), sharpSpread = median(spS); // displayed = modal consensus
  const mktTotal = selectMainTotalLine(toBooks), sharpTotal = median(toS);
  const spDisp = spVals.length ? r1(Math.max(...spVals) - Math.min(...spVals)) : 0;
  const toDisp = toVals.length ? r1(Math.max(...toVals) - Math.min(...toVals)) : 0;

  // independent model + cold-start prior
  const ehN = E(g.h), eaN = E(g.a), naiveP = platt(dexp(-(ehN + HFA - eaN)));
  const lm = inferenceOptions.applyColdStartMarketPrior === false || mktPDec === null
    ? null
    : 400 * Math.log10(mktPDec / (1 - mktPDec));
  const coldAdj = (gms: number, isHome: boolean, own: number, opp: number) => {
    if (gms >= COLD || lm == null) return { rating: own, w: 0, mi: null as number | null };
    const w = clamp(Math.exp(-gms / 8), 0.1, 0.7); const mi = isHome ? opp - HFA + lm : opp + HFA - lm; return { rating: w * mi + (1 - w) * own, w, mi };
  };
  const csH = coldAdj(gpH, true, ehN, eaN), csA = coldAdj(gpA, false, eaN, ehN);
  const eh = csH.rating, ea = csA.rating;
  const eloMargin = (eh + HFA - ea) / PPE;
  const leagueAvgScore = M.leagueAvgScore ?? 82;
  const leagueAvgTotal = M.leagueAvgTotal ?? leagueAvgScore * 2;
  const hOff = rollN(M.pf, g.h, leagueAvgScore);
  const aDef = rollN(M.pa, g.a, leagueAvgScore);
  const aOff = rollN(M.pf, g.a, leagueAvgScore);
  const hDef = rollN(M.pa, g.h, leagueAvgScore);
  const statHomeScore = (hOff + aDef) / 2;
  const statAwayScore = (aOff + hDef) / 2;
  const statTotal = statHomeScore + statAwayScore;
  const statMargin = statHomeScore - statAwayScore + 1.3;
  const marginForm = clamp(
    (rollN(M.margins, g.h, 0, 6) - rollN(M.margins, g.a, 0, 6)) * 0.08,
    -1.5,
    1.5,
  );
  const restH = daysBetween(M.lastGameDate?.get(g.h), g.date);
  const restA = daysBetween(M.lastGameDate?.get(g.a), g.date);
  const restAdv = clamp(restH - restA, -3, 3);
  const restAdj = restAdv * 0.25;
  const rawModelMargin = 0.52 * eloMargin + 0.48 * statMargin + marginForm + restAdj;
  const marginModelP = sigm(rawModelMargin / 6);
  const eloModelP = platt(dexp(-(eh + HFA - ea)));
  const modelP = clp(0.55 * eloModelP + 0.45 * marginModelP);
  const projTotal = Number.isFinite(statTotal) ? statTotal : leagueAvgTotal;
  const minG = Math.min(gpH, gpA), unc = 0.5 * Math.exp(-minG / 8), sigM = SIG_M * (1 + unc), sigT = SIG_T * (1 + unc);
  const coldStart = csH.w > 0 || csA.w > 0;

  // dynamic blend
  const sharpPresent = sP.length > 0;
  const marketRel = mktPDec != null ? clamp((Math.min(mlBooks, 8) / 8) * (spDisp <= 1 ? 1 : spDisp <= 3 ? 0.85 : 0.6) * (sharpPresent ? 1 : 0.85), 0.3, 1) : 0;
  const modelStab = clamp(minG / 25, 0.4, 1);
  let wMkt = mktPDec != null ? clamp(0.55 * marketRel / modelStab, 0.35, 0.75) : 0;
  const edge = mktPDec != null ? modelP - mktPDec : 0;
  if (Math.abs(edge) >= 0.06 && modelStab >= 0.8) wMkt = Math.max(0.35, wMkt - 0.15);
  let finalP = mktPDec != null ? wMkt * mktPDec + (1 - wMkt) * modelP : modelP;
  const conflict = mktPDec != null && (modelP >= 0.5) !== (mktPDec >= 0.5);
  if (conflict && marketRel >= 0.8 && Math.abs(edge) < 0.04) finalP = 0.5 + (finalP - 0.5) * 0.5;

  // COHERENCE: projections start from the independent team-stat margin, then
  // receive a small market-coherence nudge through finalP. This avoids letting
  // the market fully write the score while keeping ML/spread/score aligned.
  const finalPImpliedMargin = sigM * probit(clp(finalP));
  const projMargin = 0.7 * rawModelMargin + 0.3 * finalPImpliedMargin;
  const calibrationAudit = buildWnbaCoreModelCalibrationAudit({
    rawProjectedAwayScore: null,
    rawProjectedHomeScore: null,
    rawProjectedTotal: projTotal,
    rawProjectedHomeMargin: projMargin,
    marketTotal: mktTotal,
    marketSpreadForHome: mktSpread,
    ...calibrationFlags,
  });
  const totalForRecommendation =
    calibrationAudit.recommendation_uses_calibrated_total &&
    finite(calibrationAudit.recommendation_projected_total_used)
      ? calibrationAudit.recommendation_projected_total_used
      : projTotal;
  const calibratedMarginForSpreadRecommendation =
    calibrationAudit.recommendation_uses_calibrated_spread &&
    finite(calibrationAudit.recommendation_home_margin_used)
      ? calibrationAudit.recommendation_home_margin_used
      : projMargin;
  const mlWinnerSign = finalP > 0.5 ? 1 : finalP < 0.5 ? -1 : 0;
  const calibratedWinnerSign = Math.sign(calibratedMarginForSpreadRecommendation);
  const marginMlWinnerConflict =
    mlWinnerSign !== 0 && calibratedWinnerSign !== 0 && mlWinnerSign !== calibratedWinnerSign;
  // Canonical score/spread head. The market-calibrated expected margin is used
  // by BOTH the displayed score and spread probability. If spread-market
  // calibration would reverse the final ML winner, fall back to the margin
  // implied by that final ML probability. This preserves the validated
  // market-specific heads without allowing member-facing outputs to diverge.
  const canonicalHomeMargin = marginMlWinnerConflict
    ? finalPImpliedMargin
    : calibratedMarginForSpreadRecommendation;
  const marginForSpreadRecommendation = canonicalHomeMargin;
  const marginForDisplayedScore = canonicalHomeMargin;
  const totalForDisplayedScore =
    calibrationAudit.recommendation_uses_calibrated_total &&
    finite(calibrationAudit.recommendation_projected_total_used)
      ? calibrationAudit.recommendation_projected_total_used
      : projTotal;

  // sides
  const mlSide = finalP >= 0.5 ? hN : aN, mlConf = Math.round(Math.max(finalP, 1 - finalP) * 100);
  const mlPrice = median((mlSide === hN ? mlH : mlA).map((z) => z.odds));
  const mlPickIsHome = mlSide === hN;
  const finalPickedProbability = mlPickIsHome ? finalP : 1 - finalP;
  const marketPickedProbability =
    mktPDec == null ? null : mlPickIsHome ? mktPDec : 1 - mktPDec;
  const mlPickedEdge =
    marketPickedProbability === null
      ? null
      : finalPickedProbability - marketPickedProbability;
  const mlBreakEvenProbability = mlPrice === null ? null : americanBreakEvenProbability(mlPrice);
  const mlExpectedReturn = mlPrice === null
    ? null
    : americanExpectedReturn(finalPickedProbability, mlPrice);
  const mlGradeBase: Grade = wnbaMoneylineGradeFromValue({
    finalPickedProbability,
    marketPickedProbability,
    pickedOdds: mlPrice,
    conflict,
    marketReliability: marketRel,
    bookCount: mlBooks,
  });
  const mlSideKey = mlSide === hN ? "home" : "away";
  const mlPublicContext = applyPublicMarketContext({
    grade: mlGradeBase,
    picked: publicSignals.moneyline?.[mlSideKey] ?? null,
    opposite: publicSignals.moneyline?.[mlSideKey === "home" ? "away" : "home"] ?? null,
  });
  const mlGrade = mlPublicContext.gradeAfter;

  const pCoverHome = mktSpread != null ? 1 - Phi((-mktSpread - marginForSpreadRecommendation) / sigM) : null;
  const spEdge = mktSpread != null ? marginForSpreadRecommendation - -mktSpread : null;
  // Use canonical abbreviations (POR/GS/TOR), never BDL mascot names ("Fire").
  const spHomeAbbr = wnbaAbbr(g.h) ?? hN, spAwayAbbr = wnbaAbbr(g.a) ?? aN;
  const spSide = mktSpread != null ? (pCoverHome! >= 0.5 ? `${spHomeAbbr} ${mktSpread > 0 ? "+" : ""}${mktSpread}` : `${spAwayAbbr} ${mktSpread > 0 ? "" : "+"}${-mktSpread}`) : null;
  const spConf = pCoverHome != null ? Math.round(Math.max(pCoverHome, 1 - pCoverHome) * 100) : null;
  const rawSpEdge = mktSpread != null ? projMargin - -mktSpread : null;
  const spGradeEdge = calibrationAudit.grade_calibration_enabled ? spEdge : rawSpEdge;
  let spGradeBase = mktSpread != null ? gradeMarket(Math.abs(spGradeEdge!), spVals.length, spDisp, sharpSpread != null && Math.sign(sharpSpread - -marginForSpreadRecommendation) === Math.sign(spEdge!)) : null;
  if (
    spGradeBase !== null &&
    calibrationAudit.grade_calibration_enabled &&
    calibrationAudit.spread_margin_calibration_enabled
  ) {
    spGradeBase = "Watchlist";
  }
  const spSideKey = pCoverHome == null ? null : pCoverHome >= 0.5 ? "home" : "away";
  const spPickedOdds = spSideKey !== null && mktSpread !== null
    ? median(
        r
          .filter((book) => {
            if (book.mkt !== "point_spread" || book.odds === null || book.line === null) return false;
            const homeIsBdlHome = book.h === g.h;
            const selectionIsCanonicalHome = (book.selType === "home") === homeIsBdlHome;
            return spSideKey === "home"
              ? selectionIsCanonicalHome && book.line === mktSpread
              : !selectionIsCanonicalHome && book.line === -mktSpread;
          })
          .map((book) => book.odds)
          .filter(finite),
      )
    : null;
  const spPublicContext = spGradeBase !== null && spSideKey !== null ? applyPublicMarketContext({
    grade: spGradeBase,
    picked: publicSignals.spread?.[spSideKey] ?? null,
    opposite: publicSignals.spread?.[spSideKey === "home" ? "away" : "home"] ?? null,
    minGradeForBoost: "Best Angle",
    maxBoostGrade: "Best Angle",
  }) : null;
  const spAgreementLean = resolveWnbaSpreadEloStatAgreementLean({
    grade: spPublicContext?.gradeAfter ?? spGradeBase,
    selectedSide: spSideKey,
    eloMargin,
    statMargin,
    bookCount: spVals.length,
    pickedOdds: spPickedOdds,
    publicConflict: spPublicContext?.conflict ?? "none",
  });
  const spSelectedProjectionGap =
    mktSpread === null || spSideKey === null
      ? null
      : spSideKey === "home"
        ? canonicalHomeMargin + mktSpread
        : -canonicalHomeMargin - mktSpread;
  const spProjectionRestLean = resolveWnbaSpreadProjectionRestLean({
    grade: spAgreementLean.grade,
    selectedSide: spSideKey,
    selectedProjectionGap: spSelectedProjectionGap,
    restDifference: Number.isFinite(restH) && Number.isFinite(restA) ? restH - restA : null,
    bookCount: spVals.length,
    pickedOdds: spPickedOdds,
    publicConflict: spPublicContext?.conflict ?? "none",
  });
  const spGrade = spProjectionRestLean.grade;

  const pOver = mktTotal != null ? 1 - Phi((mktTotal - totalForRecommendation) / sigT) : null;
  const toEdge = mktTotal != null ? totalForRecommendation - mktTotal : null;
  const toSide = mktTotal != null ? (pOver! >= 0.5 ? `Over ${mktTotal}` : `Under ${mktTotal}`) : null;
  const toConf = pOver != null ? Math.round(Math.max(pOver, 1 - pOver) * 100) : null;
  const rawToEdge = mktTotal != null ? projTotal - mktTotal : null;
  const calibratedTotalGradeEdge =
    mktTotal != null &&
    calibrationAudit.total_projection_calibration_enabled &&
    finite(calibrationAudit.emergency_calibrated_projected_total)
      ? calibrationAudit.emergency_calibrated_projected_total - mktTotal
      : toEdge;
  const totalGradeEdge = calibrationAudit.grade_calibration_enabled ? calibratedTotalGradeEdge : rawToEdge;
  let toGradeBase = mktTotal != null ? gradeMarket(Math.abs(totalGradeEdge!), toVals.length, toDisp, sharpTotal != null && Math.sign(sharpTotal - totalForRecommendation) === -Math.sign(toEdge!)) : null;
  if (
    toGradeBase !== null &&
    calibrationAudit.grade_calibration_enabled &&
    calibrationAudit.total_projection_calibration_enabled &&
    !calibrationAudit.recommendation_uses_calibrated_total
  ) {
    toGradeBase = "Watchlist";
  }
  const totalSideKey = pOver == null ? null : pOver >= 0.5 ? "over" : "under";
  const totalPublicContext = toGradeBase !== null && totalSideKey !== null ? applyPublicMarketContext({
    grade: toGradeBase,
    picked: publicSignals.total?.[totalSideKey] ?? null,
    opposite: publicSignals.total?.[totalSideKey === "over" ? "under" : "over"] ?? null,
    minGradeForBoost: "Best Angle",
    maxBoostGrade: "Best Angle",
  }) : null;
  const toGrade = totalPublicContext?.gradeAfter ?? toGradeBase;

  const projHome = r1((totalForDisplayedScore + marginForDisplayedScore) / 2), projAway = r1((totalForDisplayedScore - marginForDisplayedScore) / 2);
  const outlierTotal = mktTotal != null && toVals.some((v) => Math.abs(v - mktTotal) >= 2);
  const outlierSpread = mktSpread != null && spVals.some((v) => Math.abs(v - mktSpread) >= 2);
  const flags: string[] = [];
  if (mlBooks < 3) flags.push("thin_ml_books");
  if (!trustedBooks) flags.push("no_trusted_book");
  if (mktSpread == null) flags.push("no_spread_line");
  if (mktTotal == null) flags.push("no_total_line");
  if (minG < COLD) flags.push("low_history_team");
  if (outlierTotal) flags.push("total_line_outlier");
  if (outlierSpread) flags.push("spread_line_outlier");
  if (marginMlWinnerConflict) flags.push("spread_ml_winner_coherence_override");

  // Capture-only observer: all recommendation math above is already complete,
  // and failures here are deliberately identity-neutral. Keeping this outside
  // the returned prediction object preserves every existing JSON field/value.
  try {
    evidenceObserver?.({
      home_win_probability: modelP,
      projected_home_margin: rawModelMargin,
      projected_total: projTotal,
      margin_sigma: sigM,
      total_sigma: sigT,
      rating_uncertainty: unc,
      model_stability: modelStab,
      home_games: gpH,
      away_games: gpA,
      cold_start: coldStart,
      home_cold_start_weight: csH.w,
      away_cold_start_weight: csA.w,
    });
  } catch {
    // Optional evidence cannot hold, flatten, or otherwise alter the champion.
  }

  return {
    _distribution_inputs: {
      modelP,
      finalP,
      projMargin,
      projTotal,
      sigM,
      sigT,
      eloMargin,
      statMargin,
      rawModelMargin,
      finalPImpliedMargin,
      statHomeScore,
      statAwayScore,
      marginForm,
      restAdj,
      restH,
      restA,
      marketRel,
      modelStab,
      wMkt,
      coldStartMarketPriorApplied: csH.mi !== null || csA.mi !== null,
      coldStart,
      csH,
      csA,
      ehN,
      eaN,
      naiveP,
      gpH,
      gpA,
      mktP,
      sharpMktP,
      mlBooks,
      trustedBooks,
    },
    game_id: g.id, date: g.date, start_time: r.find((x) => x)?.date ?? g.date,
    home_team_id: g.h, away_team_id: g.a, home_abbr: wnbaAbbr(g.h), away_abbr: wnbaAbbr(g.a),
    home: hN, away: aN,
    projected_score: { home: projHome, away: projAway },
    moneyline: { side: mlSide, confidence: mlConf, grade: mlGrade, price: mlPrice },
    spread: { side: spSide, line: mktSpread, confidence: spConf, grade: spGrade },
    total: { side: toSide, line: mktTotal, confidence: toConf, grade: toGrade },
    model: {
      home_win_prob: r1(modelP * 100) / 100,
      final_home_win_prob: r1(finalP * 100) / 100,
      margin: r1(canonicalHomeMargin),
      total: r1(totalForDisplayedScore),
      components: {
        elo_margin: r1(eloMargin),
        stat_margin: r1(statMargin),
        raw_model_margin: r1(rawModelMargin),
        market_coherent_margin: r1(finalPImpliedMargin),
        blended_precalibration_margin: r1(projMargin),
        calibrated_spread_margin: r1(calibratedMarginForSpreadRecommendation),
        canonical_home_margin: r1(canonicalHomeMargin),
        raw_projected_total: r1(projTotal),
        canonical_projected_total: r1(totalForDisplayedScore),
        stat_home_score: r1(statHomeScore),
        stat_away_score: r1(statAwayScore),
        margin_form_adjustment: r1(marginForm),
        rest_adjustment: r1(restAdj),
        home_rest_days: restH,
        away_rest_days: restA,
        market_weight: r1(wMkt),
        cold_start_market_prior_applied: csH.mi !== null || csA.mi !== null,
        moneyline_final_picked_probability: r1(finalPickedProbability * 100) / 100,
        moneyline_market_picked_probability:
          marketPickedProbability === null ? null : r1(marketPickedProbability * 100) / 100,
        moneyline_final_edge_pp: mlPickedEdge === null ? null : r1(mlPickedEdge * 100),
        moneyline_price_break_even_probability:
          mlBreakEvenProbability === null ? null : r1(mlBreakEvenProbability * 100) / 100,
        moneyline_expected_return_pct:
          mlExpectedReturn === null ? null : r1(mlExpectedReturn * 100),
        moneyline_picked_probability: r1(finalPickedProbability * 1000) / 1000,
        total_picked_probability:
          pOver === null ? null : r1(Math.max(pOver, 1 - pOver) * 1000) / 1000,
        spread_picked_probability:
          pCoverHome === null ? null : r1(Math.max(pCoverHome, 1 - pCoverHome) * 1000) / 1000,
      },
    },
    wnba_core_model_calibration: calibrationAudit,
    grade_policy_version: EXPECTED_WNBA_GRADE_POLICY_VERSION,
    spread_grade_policy: {
      rule_id: WNBA_SPREAD_ELO_STAT_AGREEMENT_RULE_ID,
      promoted: spAgreementLean.promoted,
      elo_stat_gap: r1(spAgreementLean.gap),
      maximum_gap_exclusive: WNBA_SPREAD_ELO_STAT_MAX_GAP_EXCLUSIVE,
      minimum_books: WNBA_SPREAD_ELO_STAT_MIN_BOOKS,
      picked_odds: spPickedOdds,
      public_conflict: spPublicContext?.conflict ?? "none",
      projection_rest_rule_id: WNBA_SPREAD_PROJECTION_REST_RULE_ID,
      projection_rest_promoted: spProjectionRestLean.promoted,
      selected_projection_gap: spSelectedProjectionGap,
      rest_difference: Number.isFinite(restH) && Number.isFinite(restA) ? restH - restA : null,
      projection_rest_minimum_books: WNBA_SPREAD_PROJECTION_REST_MIN_BOOKS,
    },
    market: { home_win_prob: mktP != null ? r1(mktP * 100) / 100 : null, spread: mktSpread, total: mktTotal, book_count: mlBooks, dispersion: { spread: spDisp, total: toDisp } },
    consensus_source: (sharpMktP != null ? "sharp" : "all_books") as "sharp" | "all_books",
    trusted: { home_win_prob: sharpMktP != null ? r1(sharpMktP * 100) / 100 : null, spread: sharpSpread, total: sharpTotal, trusted_book_count: trustedBooks },
    sharp: sharpMktP != null || sharpSpread != null || sharpTotal != null ? { home_win_prob: sharpMktP != null ? r1(sharpMktP * 100) / 100 : null, spread: sharpSpread, total: sharpTotal } : null,
    dynamic_market_weight: r1(wMkt * 100) / 100,
    cold_start: coldStart ? { home: { games: gpH, elo: r1(ehN), market_prior: csH.mi != null ? r1(csH.mi) : null, weight: r1(csH.w * 100) / 100, final_rating: r1(csH.rating) }, away: { games: gpA, elo: r1(eaN), market_prior: csA.mi != null ? r1(csA.mi) : null, weight: r1(csA.w * 100) / 100, final_rating: r1(csA.rating) }, rating_uncertainty: r1(unc * 100) / 100, naive_home_win_prob: r1(naiveP * 100) / 100, learning_rate: "fixed K=20 (dynamic K tested & rejected)" } : null,
    public_market_context: {
      moneyline: mlPublicContext,
      total: totalPublicContext,
      spread: spPublicContext,
    } satisfies Record<string, PublicMarketContext | null>,
    data_quality: { ml_books: mlBooks, trusted_books: trustedBooks, sharp_books: trustedBooks, spread_books: spVals.length, total_books: toVals.length, dispersion: { spread: spDisp, total: toDisp }, outlier_total: outlierTotal, outlier_spread: outlierSpread, flags },
  };
}

function oddRowsFromCompletePairs(
  pairs: readonly WnbaCompleteMarketPair[],
  game: { date: string; h: number; a: number },
): OddRow[] {
  return pairs.flatMap((pair) => [pair.first, pair.second].map((row) => ({
    book: row.sportsbook,
    sharp: pair.sourceClass === "originator",
    mkt: row.market === "moneyline" ? "moneyline" : row.market === "spread" ? "point_spread" : "total_points",
    selType: row.side,
    odds: row.priceAmerican,
    line: row.line,
    date: game.date,
    observedAt: row.observedAt,
    h: game.h,
    a: game.a,
  })));
}

/**
 * Authoritative WNBA market decision. The legacy calculator remains a private
 * source of the established sport features and dynamic ML logic; only complete,
 * fresh and target-excluded pairs are ever passed into that calculation.
 */
export function computeWnbaPrediction(
  M: ModelState,
  g: { id: number; date: string; h: number; a: number },
  r: OddRow[],
  publicSignals: WnbaPublicMarketSignals = {},
  calibrationFlags: Pick<
    WnbaCoreModelCalibrationInput,
    | "coreModelEnabled"
    | "totalProjectionCalibrationEnabled"
    | "spreadMarginCalibrationEnabled"
    | "totalRecommendationUsesCalibratedProjection"
    | "spreadRecommendationUsesCalibratedMargin"
    | "gradeCalibrationEnabled"
  > = EXPECTED_WNBA_CALIBRATION_FLAGS,
  evidenceObserver?: (evidence: WnbaIndependentModelEvidence) => void,
  decisionContext?: { decisionAt: string; startsAt: string; marketRows?: readonly OddRow[] },
) {
  const sourceRows = decisionContext?.marketRows ?? r;
  const canonicalRows = sourceRows.flatMap<WnbaTargetExcludedPriceRow>((row) => {
    const market = row.mkt === "moneyline"
      ? "moneyline"
      : row.mkt === "point_spread"
        ? "spread"
        : row.mkt === "total_points"
          ? "total"
          : null;
    if (market === null || row.odds === null) return [];
    const homeIsCanonicalHome = row.h === g.h;
    const side = market === "total"
      ? row.selType === "over" || row.selType === "under" ? row.selType : null
      : row.selType === "home" || row.selType === "away"
        ? ((row.selType === "home") === homeIsCanonicalHome ? "home" : "away")
        : null;
    if (side === null) return [];
    return [{
      market,
      side,
      sportsbook: row.book,
      line: market === "moneyline" ? null : row.line,
      priceAmerican: row.odds,
      observedAt: row.observedAt ?? null,
      sharp: row.sharp,
    }];
  });
  const effectiveContext = decisionContext ?? (() => {
    const startsAt = sourceRows
      .map((row) => row.startsAt)
      .find((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
    return startsAt ? { decisionAt: new Date().toISOString(), startsAt } : null;
  })();
  const pairsFor = (market: "moneyline" | "spread" | "total") => effectiveContext
    ? pairWnbaCompleteMarketRows({
        rows: canonicalRows,
        market,
        decisionAt: effectiveContext.decisionAt,
        startsAt: effectiveContext.startsAt,
      })
    : [];
  const mlPairs = pairsFor("moneyline");
  const spreadPairs = pairsFor("spread");
  const totalPairs = pairsFor("total");
  const allNonMlRows = oddRowsFromCompletePairs([...spreadPairs, ...totalPairs], g);
  const independent = computeWnbaPredictionIncumbent(
    M,
    g,
    allNonMlRows,
    {},
    calibrationFlags,
  );
  const independentInputs = independent._distribution_inputs;
  const independentDistribution = buildWnbaMaximumEntropyMarginDistribution({
    desiredMean: independentInputs.rawModelMargin,
    independentMean: independentInputs.rawModelMargin,
    standardDeviation: independentInputs.sigM,
    positiveProbability: independentInputs.modelP,
  });

  const independentMlSide = independentDistribution.positiveProbability >= 0.5 ? "home" : "away";
  const initialMlEvaluated = selectWnbaUpperMedianEvaluatedRow(mlPairs, independentMlSide, null);
  const fixedMlPair = initialMlEvaluated === null
    ? null
    : mlPairs.find((pair) => pair.sportsbook === initialMlEvaluated.sportsbook) ?? null;
  const mlAlternatives = fixedMlPair === null
    ? []
    : mlPairs.filter((pair) => pair.sportsbook !== fixedMlPair.sportsbook);
  const mlAlternativesQualified =
    mlAlternatives.length >= 2 &&
    wnbaIndependentSourceFamilyCount(mlAlternatives) >= 2;
  const targetExcludedRows = mlAlternativesQualified && fixedMlPair !== null
    ? [
        ...oddRowsFromCompletePairs(mlAlternatives, g),
        ...oddRowsFromCompletePairs(
          spreadPairs.filter((pair) => pair.sportsbook !== fixedMlPair.sportsbook),
          g,
        ),
        ...oddRowsFromCompletePairs(
          totalPairs.filter((pair) => pair.sportsbook !== fixedMlPair.sportsbook),
          g,
        ),
      ]
    : [];
  const marketCore = mlAlternativesQualified
    ? computeWnbaPredictionIncumbent(
        M,
        g,
        targetExcludedRows,
        {},
        calibrationFlags,
        undefined,
        { applyColdStartMarketPrior: false },
      )
    : independent;

  const spreadSelectionModal = uniqueWnbaModalLine(spreadPairs);
  const fixedSpreadLine = spreadSelectionModal?.line ?? spreadPairs[0]?.canonicalLine ?? null;
  const independentSpreadCover = fixedSpreadLine === null
    ? null
    : wnbaMarginProbabilityAbove(independentDistribution, -fixedSpreadLine);
  const initialSpreadSide = independentSpreadCover === null
    ? null
    : independentSpreadCover >= 0.5 ? "home" : "away";
  const initialSpreadEvaluated = initialSpreadSide === null
    ? null
    : selectWnbaUpperMedianEvaluatedRow(spreadPairs, initialSpreadSide, fixedSpreadLine);
  const fixedSpreadPair = initialSpreadEvaluated === null
    ? null
    : spreadPairs.find((pair) => pair.sportsbook === initialSpreadEvaluated.sportsbook) ?? null;
  const spreadAlternatives = fixedSpreadPair === null
    ? []
    : spreadPairs.filter((pair) => pair.sportsbook !== fixedSpreadPair.sportsbook);
  const spreadConsensus = uniqueWnbaModalLine(spreadAlternatives, 2, 2);
  const spreadAnchorEnabled =
    calibrationFlags.coreModelEnabled === true &&
    calibrationFlags.spreadMarginCalibrationEnabled === true &&
    calibrationFlags.spreadRecommendationUsesCalibratedMargin === true;
  const spreadMarketAuthorityQualified =
    spreadAnchorEnabled &&
    fixedSpreadPair !== null &&
    fixedSpreadLine !== null &&
    spreadConsensus !== null &&
    Math.abs(spreadConsensus.line - fixedSpreadLine) < 0.01;
  const marketInputs = marketCore._distribution_inputs;
  const spreadDesiredMean = spreadMarketAuthorityQualified && spreadConsensus !== null
    ? (() => {
        const marketImpliedMargin = -spreadConsensus.line;
        return marketImpliedMargin + 0.25 * (marketInputs.rawModelMargin - marketImpliedMargin);
      })()
    : marketInputs.rawModelMargin;
  const candidateMlMarketHomeProbability = mlAlternativesQualified
    ? marketInputs.sharpMktP ?? marketInputs.mktP
    : null;
  const mlMarketWinnerSign = candidateMlMarketHomeProbability === null
    ? 0
    : Math.sign(candidateMlMarketHomeProbability - 0.5);
  const spreadMarketWinnerSign = spreadConsensus === null ? 0 : Math.sign(-spreadConsensus.line);
  const spreadDesiredMeanSign = Math.sign(spreadDesiredMean);
  const crossMarketContradiction =
    mlAlternativesQualified &&
    spreadMarketAuthorityQualified &&
    mlMarketWinnerSign !== 0 &&
    (
      spreadMarketWinnerSign !== 0 && spreadMarketWinnerSign !== mlMarketWinnerSign ||
      spreadDesiredMeanSign !== 0 && spreadDesiredMeanSign !== mlMarketWinnerSign
    );
  const core = crossMarketContradiction ? independent : marketCore;
  const inputs = core._distribution_inputs;
  const distribution = crossMarketContradiction
    ? independentDistribution
    : buildWnbaMaximumEntropyMarginDistribution({
        desiredMean: spreadDesiredMean,
        independentMean: independentInputs.rawModelMargin,
        standardDeviation: inputs.sigM,
        positiveProbability: inputs.finalP,
      });
  const spreadSideForPrice = fixedSpreadLine === null
    ? null
    : wnbaMarginProbabilityAbove(distribution, -fixedSpreadLine) >= 0.5 ? "home" : "away";
  const spreadEvaluated = spreadSideForPrice === null || fixedSpreadPair === null
    ? null
    : wnbaPairRowForSide(fixedSpreadPair, spreadSideForPrice);
  const spreadDecision = buildWnbaResolvedMarketDecision({
    market: "spread",
    pairs: spreadPairs,
    line: fixedSpreadLine,
    evaluated: spreadEvaluated,
  });
  const spreadResolution = {
    distribution,
    decision: spreadDecision,
    forecastMarketLine:
      !crossMarketContradiction &&
      spreadMarketAuthorityQualified &&
      distribution.kind === "maximum_entropy_sign_tilt"
        ? fixedSpreadLine
        : null,
  };
  const mlSideKey = distribution.positiveProbability >= 0.5 ? "home" : "away";
  const mlEvaluated = fixedMlPair === null ? null : wnbaPairRowForSide(fixedMlPair, mlSideKey);
  const mlMarketAuthorityQualified = mlAlternativesQualified && !crossMarketContradiction;
  const mlMarketHomeProbability = mlMarketAuthorityQualified
    ? candidateMlMarketHomeProbability
    : null;
  const mlPickedProbability = mlSideKey === "home"
    ? distribution.positiveProbability
    : 1 - distribution.positiveProbability;
  const mlMarketPickedProbability = mlMarketHomeProbability === null
    ? null
    : mlSideKey === "home" ? mlMarketHomeProbability : 1 - mlMarketHomeProbability;
  const mlBreakEven = mlEvaluated === null
    ? null
    : americanBreakEvenProbability(mlEvaluated.priceAmerican);
  const mlGradeBase = wnbaMoneylineExactPriceGrade({
    pickedProbability: mlPickedProbability,
    pickedOdds: mlEvaluated?.priceAmerican ?? null,
    conflict: mlMarketHomeProbability !== null &&
      (inputs.modelP >= 0.5) !== (mlMarketHomeProbability >= 0.5),
    marketReliability: inputs.marketRel,
  });
  const rawMlPublicContext = applyPublicMarketContext({
    grade: mlGradeBase,
    picked: publicSignals.moneyline?.[mlSideKey] ?? null,
    opposite: publicSignals.moneyline?.[mlSideKey === "home" ? "away" : "home"] ?? null,
  });
  const mlGrade = mlGradeBase === "Watchlist" && rawMlPublicContext.gradeAfter === "Lean"
    ? "Watchlist"
    : rawMlPublicContext.gradeAfter;
  const mlPublicContext = { ...rawMlPublicContext, gradeAfter: mlGrade };

  const spreadLine = spreadDecision.line;
  const pCoverHome = spreadLine === null
    ? null
    : wnbaMarginProbabilityAbove(distribution, -spreadLine);
  const spreadSideKey = pCoverHome === null ? null : pCoverHome >= 0.5 ? "home" : "away";
  const spreadPickedProbability = pCoverHome === null ? null : Math.max(pCoverHome, 1 - pCoverHome);
  const spreadPointEdge = spreadLine === null ? null : distribution.mean + spreadLine;
  const spreadValue = wnbaExactPriceValueGate({
    modelProbability: spreadPickedProbability,
    evaluatedPriceAmerican: spreadDecision.evaluated?.priceAmerican ?? null,
    pointEdge: spreadPointEdge,
  });
  const spreadPublicContext = spreadSideKey === null ? null : applyPublicMarketContext({
    grade: spreadValue.grade,
    picked: publicSignals.spread?.[spreadSideKey] ?? null,
    opposite: publicSignals.spread?.[spreadSideKey === "home" ? "away" : "home"] ?? null,
    minGradeForBoost: "Best Angle",
    maxBoostGrade: "Best Angle",
  });
  const spreadEvidenceBookCount = crossMarketContradiction
    ? 0
    : spreadDecision.target_excluded_book_count;
  const spreadAgreement = resolveWnbaSpreadEloStatAgreementLean({
    grade: spreadPublicContext?.gradeAfter ?? (spreadLine === null ? null : spreadValue.grade),
    selectedSide: spreadSideKey,
    eloMargin: inputs.eloMargin,
    statMargin: inputs.statMargin,
    bookCount: spreadEvidenceBookCount,
    pickedOdds: spreadDecision.evaluated?.priceAmerican ?? null,
    publicConflict: spreadPublicContext?.conflict ?? "none",
    exactValueLeanEligible: spreadValue.eligibleLean,
  });
  const spreadProjectionRest = resolveWnbaSpreadProjectionRestLean({
    grade: spreadAgreement.grade,
    selectedSide: spreadSideKey,
    selectedProjectionGap: spreadSideKey === null || spreadPointEdge === null
      ? null
      : spreadSideKey === "home" ? spreadPointEdge : -spreadPointEdge,
    restDifference: Number.isFinite(inputs.restH) && Number.isFinite(inputs.restA)
      ? inputs.restH - inputs.restA
      : null,
    bookCount: spreadEvidenceBookCount,
    pickedOdds: spreadDecision.evaluated?.priceAmerican ?? null,
    publicConflict: spreadPublicContext?.conflict ?? "none",
    exactValueLeanEligible: spreadValue.eligibleLean,
  });
  const spreadGrade = spreadProjectionRest.grade;

  const totalModal = uniqueWnbaModalLine(totalPairs);
  const totalLine = totalModal?.line ?? totalPairs[0]?.canonicalLine ?? null;
  const pOver = totalLine === null
    ? null
    : 1 - standardNormalCdf((totalLine - independentInputs.projTotal) / independentInputs.sigT);
  const totalSideKey = pOver === null ? null : pOver >= 0.5 ? "over" : "under";
  const totalEvaluated = totalSideKey === null
    ? null
    : selectWnbaUpperMedianEvaluatedRow(totalPairs, totalSideKey, totalLine);
  const totalDecision = buildWnbaResolvedMarketDecision({
    market: "total",
    pairs: totalPairs,
    line: totalLine,
    evaluated: totalEvaluated,
  });
  const totalPickedProbability = pOver === null ? null : Math.max(pOver, 1 - pOver);
  const totalPointEdge = totalLine === null ? null : independentInputs.projTotal - totalLine;
  const totalValue = wnbaExactPriceValueGate({
    modelProbability: totalPickedProbability,
    evaluatedPriceAmerican: totalDecision.evaluated?.priceAmerican ?? null,
    pointEdge: totalPointEdge,
  });
  const totalPublicContext = totalSideKey === null ? null : applyPublicMarketContext({
    grade: totalValue.grade,
    picked: publicSignals.total?.[totalSideKey] ?? null,
    opposite: publicSignals.total?.[totalSideKey === "over" ? "under" : "over"] ?? null,
    minGradeForBoost: "Best Angle",
    maxBoostGrade: "Best Angle",
  });
  const totalGrade = totalLine === null ? null : totalPublicContext?.gradeAfter ?? totalValue.grade;

  const calibrationAudit = buildWnbaCoreModelCalibrationAudit({
    rawProjectedAwayScore: null,
    rawProjectedHomeScore: null,
    rawProjectedTotal: independentInputs.projTotal,
    rawProjectedHomeMargin: inputs.rawModelMargin,
    marketTotal: null,
    marketSpreadForHome: spreadResolution.forecastMarketLine,
    ...calibrationFlags,
  });
  const projectedHome = (independentInputs.projTotal + distribution.mean) / 2;
  const projectedAway = (independentInputs.projTotal - distribution.mean) / 2;
  const homeAbbr = wnbaAbbr(g.h) ?? core.home;
  const awayAbbr = wnbaAbbr(g.a) ?? core.away;
  const mlSide = mlSideKey === "home" ? core.home : core.away;
  const spreadSide = spreadLine === null || spreadSideKey === null
    ? null
    : spreadSideKey === "home"
      ? `${homeAbbr} ${spreadLine > 0 ? "+" : ""}${spreadLine}`
      : `${awayAbbr} ${spreadLine > 0 ? "" : "+"}${-spreadLine}`;
  const totalSide = totalLine === null || totalSideKey === null
    ? null
    : `${totalSideKey === "over" ? "Over" : "Under"} ${totalLine}`;
  const spreadAlternativeLines = spreadDecision.target_excluded_lines;
  const totalAlternativeLines = totalDecision.target_excluded_lines;
  const spreadDispersion = spreadAlternativeLines.length
    ? Math.max(...spreadAlternativeLines) - Math.min(...spreadAlternativeLines)
    : 0;
  const totalDispersion = totalAlternativeLines.length
    ? Math.max(...totalAlternativeLines) - Math.min(...totalAlternativeLines)
    : 0;
  const flags = [...core.data_quality.flags]
    .filter((flag) => !flag.startsWith("no_spread_line") && !flag.startsWith("no_total_line"));
  if (spreadLine === null) flags.push("no_fresh_complete_spread_pair");
  if (totalLine === null) flags.push("no_fresh_complete_total_pair");
  if (!mlAlternativesQualified) flags.push("moneyline_independent_fallback");
  if (crossMarketContradiction) flags.push("cross_market_contradiction_independent_fallback");
  if (distribution.kind === "independent_normal_fallback") flags.push(`margin_distribution_${distribution.fallbackReason}`);

  try {
    evidenceObserver?.({
      home_win_probability: independent._distribution_inputs.modelP,
      projected_home_margin: independent._distribution_inputs.projMargin,
      projected_total: independent._distribution_inputs.projTotal,
      margin_sigma: independent._distribution_inputs.sigM,
      total_sigma: independent._distribution_inputs.sigT,
      rating_uncertainty: 0.5 * Math.exp(-Math.min(independent._distribution_inputs.gpH, independent._distribution_inputs.gpA) / 8),
      model_stability: independent._distribution_inputs.modelStab,
      home_games: independent._distribution_inputs.gpH,
      away_games: independent._distribution_inputs.gpA,
      cold_start: independent._distribution_inputs.coldStart,
      home_cold_start_weight: independent._distribution_inputs.csH.w,
      away_cold_start_weight: independent._distribution_inputs.csA.w,
    });
  } catch {
    // Capture-only observation remains identity-neutral.
  }

  const { _distribution_inputs: _discarded, ...legacy } = core;
  void _discarded;
  return {
    ...legacy,
    projected_score: { home: projectedHome, away: projectedAway },
    moneyline: {
      side: mlSide,
      confidence: mlPickedProbability * 100,
      grade: mlGrade,
      price: mlEvaluated?.priceAmerican ?? null,
    },
    spread: {
      side: spreadSide,
      line: spreadLine,
      confidence: spreadPickedProbability === null ? null : spreadPickedProbability * 100,
      grade: spreadGrade,
    },
    total: {
      side: totalSide,
      line: totalLine,
      confidence: totalPickedProbability === null ? null : totalPickedProbability * 100,
      grade: totalGrade,
    },
    model: {
      ...core.model,
      home_win_prob: independent._distribution_inputs.modelP,
      final_home_win_prob: distribution.positiveProbability,
      margin: distribution.mean,
      total: inputs.projTotal,
      components: {
        ...core.model.components,
        elo_margin: inputs.eloMargin,
        stat_margin: inputs.statMargin,
        raw_model_margin: inputs.rawModelMargin,
        market_coherent_margin: inputs.finalPImpliedMargin,
        blended_precalibration_margin: inputs.projMargin,
        calibrated_spread_margin: distribution.mean,
        canonical_home_margin: distribution.mean,
        raw_projected_total: inputs.projTotal,
        canonical_projected_total: inputs.projTotal,
        stat_home_score: inputs.statHomeScore,
        stat_away_score: inputs.statAwayScore,
        margin_form_adjustment: inputs.marginForm,
        rest_adjustment: inputs.restAdj,
        market_weight: inputs.wMkt,
        pre_market_home_win_probability: independentInputs.modelP,
        post_cold_anchor_home_win_probability: inputs.modelP,
        cold_start_market_prior_applied: inputs.coldStartMarketPriorApplied,
        moneyline_market_interpretation_count: mlMarketAuthorityQualified ? 1 : 0,
        cross_market_context_regime: crossMarketContradiction
          ? "cross_market_contradictory_independent_fallback"
          : "compatible_or_insufficient",
        moneyline_final_picked_probability: mlPickedProbability,
        moneyline_market_picked_probability: mlMarketPickedProbability,
        moneyline_final_edge_pp: mlMarketPickedProbability === null
          ? null
          : (mlPickedProbability - mlMarketPickedProbability) * 100,
        moneyline_price_break_even_probability: mlBreakEven,
        moneyline_expected_return_pct: mlEvaluated === null
          ? null
          : americanExpectedReturn(mlPickedProbability, mlEvaluated.priceAmerican) * 100,
        moneyline_picked_probability: mlPickedProbability,
        total_picked_probability: totalPickedProbability,
        spread_picked_probability: spreadPickedProbability,
        margin_distribution_kind: distribution.kind,
        margin_distribution_standard_deviation: distribution.standardDeviation,
        margin_distribution_variance: distribution.variance,
      },
    },
    wnba_core_model_calibration: calibrationAudit,
    spread_grade_policy: {
      rule_id: WNBA_SPREAD_ELO_STAT_AGREEMENT_RULE_ID,
      promoted: spreadAgreement.promoted,
      elo_stat_gap: Math.abs(inputs.eloMargin - inputs.statMargin),
      maximum_gap_exclusive: WNBA_SPREAD_ELO_STAT_MAX_GAP_EXCLUSIVE,
      minimum_books: WNBA_SPREAD_ELO_STAT_MIN_BOOKS,
      picked_odds: spreadDecision.evaluated?.priceAmerican ?? null,
      public_conflict: spreadPublicContext?.conflict ?? "none",
      projection_rest_rule_id: WNBA_SPREAD_PROJECTION_REST_RULE_ID,
      projection_rest_promoted: spreadProjectionRest.promoted,
      selected_projection_gap: spreadSideKey === null || spreadPointEdge === null
        ? null
        : spreadSideKey === "home" ? spreadPointEdge : -spreadPointEdge,
      rest_difference: Number.isFinite(inputs.restH) && Number.isFinite(inputs.restA)
        ? inputs.restH - inputs.restA
        : null,
      projection_rest_minimum_books: WNBA_SPREAD_PROJECTION_REST_MIN_BOOKS,
    },
    market: {
      home_win_prob: inputs.mktP,
      spread: spreadLine,
      total: totalLine,
      book_count: inputs.mlBooks,
      dispersion: { spread: spreadDispersion, total: totalDispersion },
    },
    consensus_source: (inputs.sharpMktP !== null ? "sharp" : "all_books") as "sharp" | "all_books",
    trusted: {
      home_win_prob: inputs.sharpMktP,
      spread: median(spreadDecision.target_excluded_sharp_lines),
      total: median(totalDecision.target_excluded_sharp_lines),
      trusted_book_count: inputs.trustedBooks,
    },
    sharp: inputs.sharpMktP !== null || spreadDecision.target_excluded_sharp_lines.length > 0 || totalDecision.target_excluded_sharp_lines.length > 0
      ? {
          home_win_prob: inputs.sharpMktP,
          spread: median(spreadDecision.target_excluded_sharp_lines),
          total: median(totalDecision.target_excluded_sharp_lines),
        }
      : null,
    dynamic_market_weight: inputs.wMkt,
    public_market_context: {
      moneyline: mlPublicContext,
      total: totalPublicContext,
      spread: spreadPublicContext,
    } satisfies Record<string, PublicMarketContext | null>,
    target_excluded_market_decision: {
      moneyline: {
        evaluated: mlEvaluated,
        target_excluded_home_probability: mlMarketHomeProbability,
        target_excluded_book_count: marketInputs.mlBooks,
        target_excluded_sharp_book_count: marketInputs.trustedBooks,
        target_excluded_independent_family_count: wnbaIndependentSourceFamilyCount(mlAlternatives),
        target_excluded_sources: mlAlternatives.slice(0, 24).map((pair) => ({
          sportsbook: pair.sportsbook,
          source_class: pair.sourceClass,
          source_family: pair.sourceFamily,
        })),
        market_authority_qualified: mlMarketAuthorityQualified,
        unavailable_reason: crossMarketContradiction
          ? "cross_market_contradiction"
          : fixedMlPair === null
          ? "no_fresh_complete_pair"
          : mlAlternatives.length < 2
            ? "insufficient_target_excluded_books"
            : wnbaIndependentSourceFamilyCount(mlAlternatives) < 2
              ? "insufficient_independent_source_families"
              : null,
        independent_fallback: !mlMarketAuthorityQualified,
        cross_market_contradiction: crossMarketContradiction,
      },
      spread: {
        ...spreadDecision,
        forecast_market_line: spreadResolution.forecastMarketLine,
        forecast_used_target_excluded_market: spreadResolution.forecastMarketLine !== null,
        cross_market_contradiction: crossMarketContradiction,
        desired_home_margin: distribution.mean,
        raw_strength_grade: spreadValue.grade,
        exact_price_value: spreadValue,
        margin_distribution: distribution,
      },
      total: {
        ...totalDecision,
        forecast_market_line: null,
        forecast_used_target_excluded_market: false,
        raw_strength_grade: totalValue.grade,
        exact_price_value: totalValue,
      },
    },
    data_quality: {
      ml_books: mlPairs.length,
      trusted_books: mlPairs.filter((pair) => pair.first.sharp || pair.second.sharp).length,
      sharp_books: mlPairs.filter((pair) => pair.first.sharp || pair.second.sharp).length,
      spread_books: spreadPairs.length,
      total_books: totalPairs.length,
      dispersion: { spread: spreadDispersion, total: totalDispersion },
      outlier_total: totalAlternativeLines.some((line) => totalLine !== null && Math.abs(line - totalLine) >= 2),
      outlier_spread: spreadAlternativeLines.some((line) => spreadLine !== null && Math.abs(line - spreadLine) >= 2),
      flags,
    },
  };
}

export async function buildWnbaDailyEdgePreview(dateParam: string | null) {
  const M = await getModel();
  const resolve = (s: string): number | null => { const n = norm(s); for (const [m, id] of M.mascot) if (m.length >= 3 && n.includes(m)) return id; return null; };
  const odds = await wnbaOdds(resolve);
  const snapDates = new Set(odds.map((o) => o.date).filter(Boolean) as string[]);
  const cutoff = dateParam ?? (snapDates.size ? [...snapDates].sort()[0] : new Date().toISOString().slice(0, 10));
  const byGame = new Map<string, OddRow[]>();
  for (const o of odds) { if (!o.date) continue; const k = [o.h, o.a].sort().join("|") + "|" + o.date; (byGame.get(k) ?? byGame.set(k, []).get(k)!).push(o); }

  // authoritative upcoming games (BDL future 0-0), date>=cutoff, that we have odds
  // for — reuse the raw games already fetched for the model (no duplicate fetch).
  const allGames = M.rawGames;
  const seen = new Set<string>();
  const slate = allGames.filter((g) => g.hs === 0 && g.as === 0 && isRealWnbaTeam(g.h) && isRealWnbaTeam(g.a) && g.date >= cutoff && [shiftDate(g.date, -1), g.date, shiftDate(g.date, 1)].some((d) => snapDates.has(d)))
    .sort((x, y) => (x.date < y.date ? -1 : 1)).filter((g) => { const k = [g.h, g.a].sort().join("|") + g.date; if (seen.has(k)) return false; seen.add(k); return true; });

  const games = slate.map((g) => {
    const r = [shiftDate(g.date, -1), g.date, shiftDate(g.date, 1)].flatMap((d) => byGame.get([g.h, g.a].sort().join("|") + "|" + d) ?? []);
    if (!r.length) return null;
    return computeWnbaPrediction(M, g, r);
  }).filter(Boolean);

  return { sport: "wnba", preview: true, slate_date: cutoff, generated_at: new Date().toISOString(), game_count: games.length, games };
}
