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
  readWnbaCoreModelCalibrationFlagsFromEnv,
} from "@/lib/automodel/wnbaCoreModelCalibration";

const BDL = "https://api.balldontlie.io/wnba/v1";
const SHARP = "https://api.sharpapi.io/api/v1";
const BLOCKED = new Set(["fliff", "kalshi", "polymarket"]);
export const SHARP_BOOKS = new Set(["circa", "betonline", "draftkings", "betmgm", "caesars", "bet365 us", "betrivers", "pinnacle"]);
const HFA = 65, K = 20, PPE = 25, SIG_M = 12.8, SIG_T = 15.0, COLD = 15;

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
type Grade = "Best Angle" | "Lean" | "Watchlist" | "Caution";
export type ModelState = { elo: Map<number, number>; games: Map<number, number>; pf: Map<number, number[]>; pa: Map<number, number[]>; nameById: Map<number, string>; mascot: [string, number][]; rawGames: BdlGame[]; computedAt: number };

function moneylineGradeFromPickedEdge(args: {
  pickedEdge: number | null;
  pickedOdds: number | null;
  conflict: boolean;
  marketReliability: number;
  bookCount: number;
  sharpPresent: boolean;
  projectedMargin: number;
}): Grade {
  const { pickedEdge, pickedOdds, conflict, marketReliability, bookCount, sharpPresent, projectedMargin } = args;
  if (pickedEdge === null) return "Watchlist";
  if (pickedEdge <= -0.01) return "Watchlist";
  if (pickedOdds !== null && pickedOdds <= -300) return "Watchlist";
  if (conflict && marketReliability >= 0.8 && pickedEdge < 0.04) return "Caution";
  if (
    pickedEdge >= 0.04 &&
    bookCount >= 6 &&
    sharpPresent &&
    Math.abs(projectedMargin) >= 3 &&
    pickedOdds !== null &&
    pickedOdds <= -200 &&
    pickedOdds > -300
  ) return "Best Angle";
  if (pickedEdge >= 0.02 && bookCount >= 4) return "Lean";
  return "Watchlist";
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
  const elo = new Map<number, number>(), ls = new Map<number, number>(), games_ = new Map<number, number>(), pf = new Map<number, number[]>(), pa = new Map<number, number[]>();
  const E = (t: number) => elo.get(t) ?? 1500;
  for (const g of games) {
    for (const t of [g.h, g.a]) { if (ls.get(t) !== undefined && ls.get(t) !== g.season) elo.set(t, 1500 + 0.75 * (E(t) - 1500)); ls.set(t, g.season); }
    const eh = E(g.h), ea = E(g.a), pH = dexp(-(eh + HFA - ea)), won = g.hs > g.as ? 1 : 0;
    const m = g.hs - g.as, hw = m > 0, mult = Math.log(Math.abs(m) + 1) * (2.2 / ((hw ? eh + HFA - ea : ea - eh - HFA) * 0.001 + 2.2));
    elo.set(g.h, eh + K * mult * (won - pH)); elo.set(g.a, ea - K * mult * (won - pH));
    games_.set(g.h, (games_.get(g.h) ?? 0) + 1); games_.set(g.a, (games_.get(g.a) ?? 0) + 1);
    for (const [t, f, ag] of [[g.h, g.hs, g.as], [g.a, g.as, g.hs]] as [number, number, number][]) { (pf.get(t) ?? pf.set(t, []).get(t)!).push(f); (pa.get(t) ?? pa.set(t, []).get(t)!).push(ag); }
  }
  MODEL_CACHE = { elo, games: games_, pf, pa, nameById, mascot, rawGames, computedAt: Date.now() };
  return MODEL_CACHE;
}
const roll10 = (m: Map<number, number[]>, t: number) => { const x = m.get(t) ?? []; return x.length ? x.slice(-10).reduce((s, v) => s + v, 0) / Math.min(10, x.length) : 82; };

// ── SharpAPI odds (cursor; game markets; resolve teams; pair+date; trusted consensus) ──
export type OddRow = { book: string; sharp: boolean; mkt: string; selType: string; odds: number | null; line: number | null; date: string | null; h: number; a: number };
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
        rows.push({ book, sharp: SHARP_BOOKS.has(book), mkt, selType: String(x.selection_type), odds: x.odds_american == null ? null : Number(x.odds_american),
          line: x.line == null ? null : Number(x.line), date: evDate(String(x.event_id)) ?? evDate(String(x.event_start_time)), h, a });
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
export function computeWnbaPrediction(
  M: ModelState,
  g: { id: number; date: string; h: number; a: number },
  r: OddRow[],
  publicSignals: WnbaPublicMarketSignals = {},
) {
  const E = (t: number) => M.elo.get(t) ?? 1500;
  const hN = M.nameById.get(g.h) ?? wnbaAbbr(g.h) ?? String(g.h);
  const aN = M.nameById.get(g.a) ?? wnbaAbbr(g.a) ?? String(g.a);
  const gpH = M.games.get(g.h) ?? 0, gpA = M.games.get(g.a) ?? 0;

  // market consensus: all non-blocked books (storage/audit) + sharp subset (decision)
  const mlH: { book: string; odds: number }[] = [], mlA: { book: string; odds: number }[] = [];
  const spBooks: { sportsbook: string; line_value: number }[] = [], spS: number[] = [];
  const toBooks: { sportsbook: string; line_value: number }[] = [], toS: number[] = [];
  for (const x of r) {
    const homeIsBdlHome = x.h === g.h;
    if (x.mkt === "moneyline" && x.odds != null) ((x.selType === "home") === homeIsBdlHome ? mlH : mlA).push({ book: x.book, odds: x.odds });
    if (x.mkt === "point_spread" && x.line != null && Math.abs(x.line) < 40 && (x.selType === "home") === homeIsBdlHome) { spBooks.push({ sportsbook: x.book, line_value: x.line }); if (x.sharp) spS.push(x.line); }
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
  const lm = mktPDec != null ? 400 * Math.log10(mktPDec / (1 - mktPDec)) : null;
  const coldAdj = (gms: number, isHome: boolean, own: number, opp: number) => {
    if (gms >= COLD || lm == null) return { rating: own, w: 0, mi: null as number | null };
    const w = clamp(Math.exp(-gms / 8), 0.1, 0.7); const mi = isHome ? opp - HFA + lm : opp + HFA - lm; return { rating: w * mi + (1 - w) * own, w, mi };
  };
  const csH = coldAdj(gpH, true, ehN, eaN), csA = coldAdj(gpA, false, eaN, ehN);
  const eh = csH.rating, ea = csA.rating;
  const modelP = platt(dexp(-(eh + HFA - ea)));
  // projMargin is derived from finalP AFTER the blend (coherence) — see below.
  const projTotal = (roll10(M.pf, g.h) + roll10(M.pa, g.a)) / 2 + (roll10(M.pf, g.a) + roll10(M.pa, g.h)) / 2;
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

  // COHERENCE: projected margin (→ score + spread basis) derived from the SAME
  // blended win prob the ML uses, so the projected winner / ML / spread agree.
  const projMargin = sigM * probit(clp(finalP));
  const calibrationAudit = buildWnbaCoreModelCalibrationAudit({
    rawProjectedAwayScore: null,
    rawProjectedHomeScore: null,
    rawProjectedTotal: projTotal,
    rawProjectedHomeMargin: projMargin,
    marketTotal: mktTotal,
    marketSpreadForHome: mktSpread,
    ...readWnbaCoreModelCalibrationFlagsFromEnv(),
  });
  const totalForRecommendation =
    calibrationAudit.recommendation_uses_calibrated_total &&
    finite(calibrationAudit.recommendation_projected_total_used)
      ? calibrationAudit.recommendation_projected_total_used
      : projTotal;
  const marginForSpreadRecommendation =
    calibrationAudit.recommendation_uses_calibrated_spread &&
    finite(calibrationAudit.recommendation_home_margin_used)
      ? calibrationAudit.recommendation_home_margin_used
      : projMargin;
  const marginForDisplayedScore =
    calibrationAudit.recommendation_uses_calibrated_spread &&
    finite(calibrationAudit.recommendation_home_margin_used)
      ? calibrationAudit.recommendation_home_margin_used
      : projMargin;
  const totalForDisplayedScore =
    calibrationAudit.recommendation_uses_calibrated_total &&
    finite(calibrationAudit.recommendation_projected_total_used)
      ? calibrationAudit.recommendation_projected_total_used
      : projTotal;

  // sides
  const mlSide = finalP >= 0.5 ? hN : aN, mlConf = Math.round(Math.max(finalP, 1 - finalP) * 100);
  const mlPrice = median((mlSide === hN ? mlH : mlA).map((z) => z.odds));
  const mlPickIsHome = mlSide === hN;
  const mlPickedEdge =
    mktPDec == null
      ? null
      : mlPickIsHome
        ? modelP - mktPDec
        : (1 - modelP) - (1 - mktPDec);
  const mlGradeBase: Grade = moneylineGradeFromPickedEdge({
    pickedEdge: mlPickedEdge,
    pickedOdds: mlPrice,
    conflict,
    marketReliability: marketRel,
    bookCount: mlBooks,
    sharpPresent,
    projectedMargin: projMargin,
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
  const spPublicContext = spGradeBase !== null && spSideKey !== null ? applyPublicMarketContext({
    grade: spGradeBase,
    picked: publicSignals.spread?.[spSideKey] ?? null,
    opposite: publicSignals.spread?.[spSideKey === "home" ? "away" : "home"] ?? null,
  }) : null;
  const spGrade = spPublicContext?.gradeAfter ?? spGradeBase;

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

  return {
    game_id: g.id, date: g.date, start_time: r.find((x) => x)?.date ?? g.date,
    home_team_id: g.h, away_team_id: g.a, home_abbr: wnbaAbbr(g.h), away_abbr: wnbaAbbr(g.a),
    home: hN, away: aN,
    projected_score: { home: projHome, away: projAway },
    moneyline: { side: mlSide, confidence: mlConf, grade: mlGrade, price: mlPrice },
    spread: { side: spSide, line: mktSpread, confidence: spConf, grade: spGrade },
    total: { side: toSide, line: mktTotal, confidence: toConf, grade: toGrade },
    model: { home_win_prob: r1(modelP * 100) / 100, margin: r1(projMargin), total: r1(projTotal) },
    wnba_core_model_calibration: calibrationAudit,
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

  const E = (t: number) => M.elo.get(t) ?? 1500;
  const games = slate.map((g) => {
    const r = [shiftDate(g.date, -1), g.date, shiftDate(g.date, 1)].flatMap((d) => byGame.get([g.h, g.a].sort().join("|") + "|" + d) ?? []);
    if (!r.length) return null;
    const hN = M.nameById.get(g.h)!, aN = M.nameById.get(g.a)!, gpH = M.games.get(g.h) ?? 0, gpA = M.games.get(g.a) ?? 0;

    // ---- market consensus (computed first so it can inform the cold-start prior) ----
    const mlH: { book: string; odds: number }[] = [], mlA: { book: string; odds: number }[] = [], sp: number[] = [], spS: number[] = [], to: number[] = [], toS: number[] = [];
    for (const x of r) { const homeIsBdlHome = x.h === g.h;
      if (x.mkt === "moneyline" && x.odds != null) ((x.selType === "home") === homeIsBdlHome ? mlH : mlA).push({ book: x.book, odds: x.odds });
      if (x.mkt === "point_spread" && x.line != null && Math.abs(x.line) < 40 && (x.selType === "home") === homeIsBdlHome) { sp.push(x.line); if (x.sharp) spS.push(x.line); }
      if (x.mkt === "total_points" && x.selType === "over" && x.line != null && x.line > 120 && x.line < 220) { to.push(x.line); if (x.sharp) toS.push(x.line); }
    }
    const bP: number[] = [], sP: number[] = [];
    for (const h of mlH) { const a = mlA.find((z) => z.book === h.book); if (a) { const p = amProb(h.odds) / (amProb(h.odds) + amProb(a.odds)); bP.push(p); if (SHARP_BOOKS.has(h.book)) sP.push(p); } }
    const mktP = median(bP), sharpMktP = median(sP), mlBooks = bP.length;
    const mktSpread = median(sp), sharpSpread = median(spS), spDisp = sp.length ? r1(Math.max(...sp) - Math.min(...sp)) : 0;
    const mktTotal = median(to), sharpTotal = median(toS), toDisp = to.length ? r1(Math.max(...to) - Math.min(...to)) : 0;

    // ---- independent model + cold-start prior ----
    const ehN = E(g.h), eaN = E(g.a), naiveP = platt(dexp(-(ehN + HFA - eaN)));
    const lm = mktP != null ? 400 * Math.log10(mktP / (1 - mktP)) : null;
    const coldAdj = (gms: number, isHome: boolean, own: number, opp: number) => {
      if (gms >= COLD || lm == null) return { rating: own, w: 0, mi: null as number | null };
      const w = clamp(Math.exp(-gms / 8), 0.1, 0.7); const mi = isHome ? opp - HFA + lm : opp + HFA - lm; return { rating: w * mi + (1 - w) * own, w, mi };
    };
    const csH = coldAdj(gpH, true, ehN, eaN), csA = coldAdj(gpA, false, eaN, ehN);
    const eh = csH.rating, ea = csA.rating;
    const modelP = platt(dexp(-(eh + HFA - ea)));
    // projMargin is derived from finalP AFTER the blend (coherence) — see below.
    const projTotal = (roll10(M.pf, g.h) + roll10(M.pa, g.a)) / 2 + (roll10(M.pf, g.a) + roll10(M.pa, g.h)) / 2;
    const minG = Math.min(gpH, gpA), unc = 0.5 * Math.exp(-minG / 8), sigM = SIG_M * (1 + unc), sigT = SIG_T * (1 + unc);
    const coldStart = csH.w > 0 || csA.w > 0;

    // ---- dynamic blend (market = calibrator, not the answer) ----
    const sharpPresent = sP.length > 0;
    const marketRel = mktP != null ? clamp((Math.min(mlBooks, 8) / 8) * (spDisp <= 1 ? 1 : spDisp <= 3 ? 0.85 : 0.6) * (sharpPresent ? 1 : 0.85), 0.3, 1) : 0;
    const modelStab = clamp(minG / 25, 0.4, 1);
    let wMkt = mktP != null ? clamp(0.55 * marketRel / modelStab, 0.35, 0.75) : 0;
    const edge = mktP != null ? modelP - mktP : 0;
    if (Math.abs(edge) >= 0.06 && modelStab >= 0.8) wMkt = Math.max(0.35, wMkt - 0.15); // large explainable edge → model leads
    let finalP = mktP != null ? wMkt * mktP + (1 - wMkt) * modelP : modelP;
    const conflict = mktP != null && (modelP >= 0.5) !== (mktP >= 0.5);
    if (conflict && marketRel >= 0.8 && Math.abs(edge) < 0.04) finalP = 0.5 + (finalP - 0.5) * 0.5; // fighting clean market weakly → damp

    // COHERENCE: the projected margin (→ score + spread basis) is derived from
    // the SAME blended win prob the ML uses. So the projected winner, the ML
    // pick, and the spread always tell one story (no ML-on-CHI while the score
    // says POR). σ = sigM so a pick'em spread maps back exactly to the ML prob.
    const projMargin = sigM * probit(clp(finalP));

    // ---- sides ----
    const mlSide = finalP >= 0.5 ? hN : aN, mlConf = Math.round(Math.max(finalP, 1 - finalP) * 100);
    const mlPrice = median((mlSide === hN ? mlH : mlA).map((z) => z.odds)); // representative consensus price on the pick side
    const mlPickIsHome = mlSide === hN;
    const mlPickedEdge =
      mktP == null
        ? null
        : mlPickIsHome
          ? modelP - mktP
          : (1 - modelP) - (1 - mktP);
    const mlGrade: Grade = moneylineGradeFromPickedEdge({
      pickedEdge: mlPickedEdge,
      pickedOdds: mlPrice,
      conflict,
      marketReliability: marketRel,
      bookCount: mlBooks,
      sharpPresent,
      projectedMargin: projMargin,
    });

    const pCoverHome = mktSpread != null ? 1 - Phi((-mktSpread - projMargin) / sigM) : null;
    const spEdge = mktSpread != null ? projMargin - -mktSpread : null;
    // Use canonical abbreviations (POR/GS/TOR), never BDL mascot names ("Fire").
  const spHomeAbbr = wnbaAbbr(g.h) ?? hN, spAwayAbbr = wnbaAbbr(g.a) ?? aN;
  const spSide = mktSpread != null ? (pCoverHome! >= 0.5 ? `${spHomeAbbr} ${mktSpread > 0 ? "+" : ""}${mktSpread}` : `${spAwayAbbr} ${mktSpread > 0 ? "" : "+"}${-mktSpread}`) : null;
    const spConf = pCoverHome != null ? Math.round(Math.max(pCoverHome, 1 - pCoverHome) * 100) : null;
    const spGrade = mktSpread != null ? gradeMarket(Math.abs(spEdge!), sp.length, spDisp, sharpSpread != null && Math.sign(sharpSpread - -projMargin) === Math.sign(spEdge!)) : null;

    const pOver = mktTotal != null ? 1 - Phi((mktTotal - projTotal) / sigT) : null;
    const toEdge = mktTotal != null ? projTotal - mktTotal : null;
    const toSide = mktTotal != null ? (pOver! >= 0.5 ? `Over ${mktTotal}` : `Under ${mktTotal}`) : null;
    const toConf = pOver != null ? Math.round(Math.max(pOver, 1 - pOver) * 100) : null;
    const toGrade = mktTotal != null ? gradeMarket(Math.abs(toEdge!), to.length, toDisp, sharpTotal != null && Math.sign(sharpTotal - projTotal) === -Math.sign(toEdge!)) : null;

    // projected score from total + margin
    const projHome = r1((projTotal + projMargin) / 2), projAway = r1((projTotal - projMargin) / 2);
    const flags: string[] = [];
    if (mlBooks < 3) flags.push("thin_ml_books");
    if (mktSpread == null) flags.push("no_spread_line");
    if (mktTotal == null) flags.push("no_total_line");
    if (minG < COLD) flags.push("low_history_team");

    return {
      game_id: g.id, date: g.date, start_time: r.find((x) => x)?.date ?? g.date,
      home_team_id: g.h, away_team_id: g.a, home_abbr: wnbaAbbr(g.h), away_abbr: wnbaAbbr(g.a),
      home: hN, away: aN,
      projected_score: { home: projHome, away: projAway },
      moneyline: { side: mlSide, confidence: mlConf, grade: mlGrade, price: mlPrice },
      spread: { side: spSide, line: mktSpread, confidence: spConf, grade: spGrade },
      total: { side: toSide, line: mktTotal, confidence: toConf, grade: toGrade },
      model: { home_win_prob: r1(modelP * 100) / 100, margin: r1(projMargin), total: r1(projTotal) },
      market: { home_win_prob: mktP != null ? r1(mktP * 100) / 100 : null, spread: mktSpread, total: mktTotal, book_count: mlBooks, dispersion: { spread: spDisp, total: toDisp } },
      sharp: sharpMktP != null || sharpSpread != null || sharpTotal != null ? { home_win_prob: sharpMktP != null ? r1(sharpMktP * 100) / 100 : null, spread: sharpSpread, total: sharpTotal } : null,
      dynamic_market_weight: r1(wMkt * 100) / 100,
      cold_start: coldStart ? { home: { games: gpH, elo: r1(ehN), market_prior: csH.mi != null ? r1(csH.mi) : null, weight: r1(csH.w * 100) / 100, final_rating: r1(csH.rating) }, away: { games: gpA, elo: r1(eaN), market_prior: csA.mi != null ? r1(csA.mi) : null, weight: r1(csA.w * 100) / 100, final_rating: r1(csA.rating) }, rating_uncertainty: r1(unc * 100) / 100, naive_home_win_prob: r1(naiveP * 100) / 100, learning_rate: "fixed K=20 (dynamic K tested & rejected)" } : null,
      data_quality: { ml_books: mlBooks, spread_books: sp.length, total_books: to.length, flags },
    };
  }).filter(Boolean);

  return { sport: "wnba", preview: true, slate_date: cutoff, generated_at: new Date().toISOString(), game_count: games.length, games };
}
