/**
 * Market interpretation engine (2026-06-16). PURE — no DB, no Next.
 *
 * Turns the live market backbone (movement from line_movements +
 * odds_current_stream) + cron public splits + the model pick into a compact,
 * plain-English "market chip" and an expanded detail breakdown. Everything is
 * DERIVED here — public-opposed movement, reported-handle divergence,
 * consensus, toward/against — nothing is
 * assumed from a vendor flag (SharpAPI doesn't provide RLM/steam on our tier).
 *
 * Splits are REST/cron, so they carry a freshness stamp; the chip never implies
 * splits are live. Movement (odds) IS live.
 *
 * Display/audit only — this does NOT influence picks/grades (any grade impact
 * stays shadow until backtested).
 */

import { classifyMove, americanCentsDelta, type MoveDirection } from "./lineDirection";

export type ChipTone = "emerald" | "amber" | "gray";

/** Public-share threshold for "heavy" on a side. */
const PUBLIC_HEAVY_PCT = 60;
/** Reserve the compact "public-heavy" chip for a truly crowded side. */
const PUBLIC_HEAVY_UNCONFIRMED_PCT = 65;
/** Money-vs-bets gap (pp) that counts as divergence. */
const MONEY_PUBLIC_DIVERGENCE_PP = 12;
/**
 * Reported-handle divergence thresholds — kept in lockstep with the legacy
 * grade guard
 * (hasOpposingPublicMoneyConflict in predictionRecordService): a side carries a
 * divergence signal when the MONEY share crosses 60% AND money−tickets ≥ 15pp.
 * "Against us" = the OPPOSITE side hits that bar (≡ our money ≤40% with the gap).
 */
const REPORTED_MONEY_SHARE = 60;
const REPORTED_MONEY_GAP_PP = 15;
/** Fraction of books moving the same way to call it consensus (vs isolated). */
const CONSENSUS_BOOK_SHARE = 0.6;

export type LastMove = {
  prevAmerican: number | null; // picked-side price before the last move
  nextAmerican: number | null; // picked-side price after the last move
  movedAtIso: string | null;
  booksMoved: number | null;
  totalBooks: number | null;
  /** LINE/point before→after the last move (e.g. total 8.5 → 9). Distinct from
   * the odds move above; null for moneyline or when the line didn't change. */
  prevLineValue: number | null;
  nextLineValue: number | null;
};

export type SplitsInput = {
  pickMoneyPct: number | null; // money % on the PICKED side
  pickBetsPct: number | null; // tickets % on the PICKED side
  observedAtIso: string | null;
  isStale: boolean;
};

export type MarketInterpretationInput = {
  pickSide: string | null; // null pre-pick → neutral interpretation
  openAmerican: number | null; // picked side
  postedAmerican: number | null; // picked side at first publish (Model Posted)
  currentAmerican: number | null; // picked side now (live overlay applied upstream)
  lastMove: LastMove | null;
  splits: SplitsInput | null;
  nowMs: number;
};

export type MarketInterpretation = {
  chipLabel: string;
  chipTone: ChipTone;
  /** Machine flags for downstream/shadow use. */
  flags: string[];
  /** Plain-English lines for the expanded timeline/detail. */
  detail: string[];
};

function fmt(n: number | null): string {
  return n === null ? "—" : n > 0 ? `+${n}` : `${n}`;
}

function relAgo(iso: string | null, nowMs: number): string {
  if (iso === null) return "";
  const ms = nowMs - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function consensusKind(lastMove: LastMove | null): "consensus" | "isolated" | null {
  if (lastMove === null || lastMove.booksMoved === null || lastMove.totalBooks === null || lastMove.totalBooks <= 0) {
    return null;
  }
  return lastMove.booksMoved / lastMove.totalBooks >= CONSENSUS_BOOK_SHARE ? "consensus" : "isolated";
}

export function interpretMarket(input: MarketInterpretationInput): MarketInterpretation {
  const flags: string[] = [];
  const detail: string[] = [];

  const overall: MoveDirection = classifyMove(input.openAmerican, input.currentAmerican);
  const last: MoveDirection = input.lastMove
    ? classifyMove(input.lastMove.prevAmerican, input.lastMove.nextAmerican)
    : "flat";

  // Open → Current
  if (input.openAmerican !== null && input.currentAmerican !== null) {
    detail.push(`Opened ${fmt(input.openAmerican)}, now ${fmt(input.currentAmerican)} (${dirWord(overall)}).`);
  }
  // Model Posted → Current (CLV direction since our publish)
  if (input.postedAmerican !== null && input.currentAmerican !== null) {
    const clvDir = classifyMove(input.postedAmerican, input.currentAmerican);
    if (clvDir === "toward") detail.push(`Since our post (${fmt(input.postedAmerican)} → ${fmt(input.currentAmerican)}): gaining value.`);
    else if (clvDir === "against") detail.push(`Since our post (${fmt(input.postedAmerican)} → ${fmt(input.currentAmerican)}): value slipping.`);
  }
  // Last move
  const consensus = consensusKind(input.lastMove);
  if (input.lastMove && input.lastMove.nextAmerican !== null && last !== "flat") {
    const cents = americanCentsDelta(input.lastMove.prevAmerican, input.lastMove.nextAmerican);
    const books = consensus !== null ? `, ${input.lastMove.booksMoved}/${input.lastMove.totalBooks} books (${consensus})` : "";
    detail.push(`Last move ${fmt(input.lastMove.prevAmerican)} → ${fmt(input.lastMove.nextAmerican)} (${dirWord(last)}${cents !== null ? `, ${Math.abs(cents)}¢` : ""}${books}) ${relAgo(input.lastMove.movedAtIso, input.nowMs)}.`);
    if (consensus === "consensus") flags.push("consensus_move");
    if (consensus === "isolated") flags.push("isolated_move");
  }

  // LINE/point move (e.g. total 8.5 → 9) — distinct from the odds move above.
  // Reader-only detail: the actual number moving is a strong, plain-English
  // signal members asked for ("show the original line and what it moved to").
  if (
    input.lastMove &&
    input.lastMove.prevLineValue !== null &&
    input.lastMove.nextLineValue !== null &&
    input.lastMove.prevLineValue !== input.lastMove.nextLineValue
  ) {
    flags.push("line_value_moved");
    detail.push(`Line moved ${input.lastMove.prevLineValue} → ${input.lastMove.nextLineValue}.`);
  }

  // Public splits (cron) + freshness
  const splits = input.splits;
  const pubHeavyOnPick = splits?.pickBetsPct != null && splits.pickBetsPct >= PUBLIC_HEAVY_PCT;
  const pubLightOnPick = splits?.pickBetsPct != null && splits.pickBetsPct <= 100 - PUBLIC_HEAVY_PCT;
  const moneyPublicGap =
    splits?.pickMoneyPct != null && splits?.pickBetsPct != null ? splits.pickMoneyPct - splits.pickBetsPct : null;
  if (splits && (splits.pickBetsPct != null || splits.pickMoneyPct != null)) {
    const staleNote = splits.isStale ? ` — splits last refreshed ${relAgo(splits.observedAtIso, input.nowMs) || "a while ago"}` : "";
    detail.push(
      `Public on our side: ${splits.pickBetsPct != null ? `${Math.round(splits.pickBetsPct)}% tickets` : "tickets n/a"} / ${splits.pickMoneyPct != null ? `${Math.round(splits.pickMoneyPct)}% money` : "money n/a"}${staleNote}.`,
    );
    if (splits.isStale) flags.push("splits_stale");
    if (moneyPublicGap !== null && Math.abs(moneyPublicGap) >= MONEY_PUBLIC_DIVERGENCE_PP) {
      flags.push("money_public_divergence");
      detail.push(`Reported money and tickets diverge by ${Math.round(Math.abs(moneyPublicGap))}pp${moneyPublicGap > 0 ? " (the average reported wager appears larger on our side; bettor identity is unverified)" : " (ticket share is heavier than reported money on our side)"}.`);
    }
  }

  // DERIVED public-opposed movement: public on one side, line moved the other
  // way. This is an RLM candidate, not proof of professional bettor identity or
  // that the split change preceded/caused the move.
  let rlm: "favor" | "against" | null = null;
  if (pubHeavyOnPick && overall === "against") rlm = "against";
  else if (pubLightOnPick && overall === "toward") rlm = "favor";
  if (rlm !== null) {
    flags.push("reverse_line_movement");
    detail.push(
      rlm === "favor"
        ? "Public-opposed movement: ticket share is light on our side while the market moved toward it; the cause and bettor identity are unverified."
        : "Public-opposed movement: ticket share is heavy on our side while the market moved away; the cause and bettor identity are unverified.",
    );
  }

  // DERIVED reported-handle divergence from the split percentages. This does
  // not establish wager count, dollar volume, bettor identity, causal timing,
  // or that the subsequent price move originated from this provider sample.
  // Legacy machine flags remain stable for downstream compatibility.
  const pm = splits?.pickMoneyPct ?? null;
  const pb = splits?.pickBetsPct ?? null;
  let reportedMoneyDivergence: "with" | "against" | null = null;
  if (pm != null && pb != null) {
    if (pm >= REPORTED_MONEY_SHARE && pm - pb >= REPORTED_MONEY_GAP_PP) reportedMoneyDivergence = "with";
    // opposite side: oppMoney = 100-pm, oppGap = (100-pm)-(100-pb) = pb-pm.
    else if (100 - pm >= REPORTED_MONEY_SHARE && pb - pm >= REPORTED_MONEY_GAP_PP) reportedMoneyDivergence = "against";
  }
  if (reportedMoneyDivergence === "with") flags.push("sharp_money_with");
  if (reportedMoneyDivergence === "against") flags.push("sharp_money_against");
  const splitPriceConflict =
    (reportedMoneyDivergence === "with" && overall === "against") ||
    (reportedMoneyDivergence === "against" && overall === "toward");
  if (splitPriceConflict) {
    flags.push("market_signal_conflict");
    detail.push(
      reportedMoneyDivergence === "with"
        ? "Split signal supports our side, but price movement is against the pick."
        : "Split signal is against our side, but price movement is toward the pick.",
    );
  }

  // Public-heavy with neither price confirmation nor a material reported-money
  // divergence. This is descriptive only; it does not infer who placed bets.
  const publicHeavyUnconfirmed =
    splits?.pickBetsPct != null &&
    splits.pickBetsPct >= PUBLIC_HEAVY_UNCONFIRMED_PCT &&
    overall !== "toward" &&
    rlm === null &&
    reportedMoneyDivergence === null;
  if (publicHeavyUnconfirmed) flags.push("public_heavy_unconfirmed");

  if (overall === "toward") flags.push("moved_toward");
  if (overall === "against") flags.push("moved_against");

  // ── Chip (single best signal, priority order) ──
  // Public-opposed movement ranks first; then reported-handle divergence; then
  // raw market drift; then the honest "unconfirmed".
  let chipLabel = "Market steady";
  let chipTone: ChipTone = "gray";
  if (rlm === "favor") { chipLabel = "Public-opposed move our way"; chipTone = "emerald"; }
  else if (rlm === "against") { chipLabel = "Public-opposed move against us"; chipTone = "amber"; }
  else if (splitPriceConflict) { chipLabel = "Mixed market signal"; chipTone = "gray"; }
  else if (reportedMoneyDivergence === "against") { chipLabel = "Reported money divergence against us"; chipTone = "amber"; }
  else if (reportedMoneyDivergence === "with") { chipLabel = "Reported money divergence our way"; chipTone = "emerald"; }
  else if (overall === "against") { chipLabel = "Market moved against our side"; chipTone = "amber"; }
  else if (overall === "toward") { chipLabel = "Market moved toward our side"; chipTone = "emerald"; }
  else if (publicHeavyUnconfirmed) { chipLabel = "Public-heavy, price unconfirmed"; chipTone = "amber"; }
  else if (last === "against") { chipLabel = "Last move against our side"; chipTone = "amber"; }
  else if (last === "toward") { chipLabel = "Last move toward our side"; chipTone = "emerald"; }
  else if (splits?.isStale && flags.length <= 1) { chipLabel = "Market steady · splits stale"; chipTone = "gray"; }

  return { chipLabel, chipTone, flags, detail };
}

function dirWord(d: MoveDirection): string {
  return d === "toward" ? "toward us" : d === "against" ? "against us" : "flat";
}
