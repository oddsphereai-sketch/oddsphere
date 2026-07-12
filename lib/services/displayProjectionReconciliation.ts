/**
 * Display-projection reconciliation (2026-06-22).
 *
 * The member-facing card must tell ONE coherent story: the displayed projected
 * scores and total must SUPPORT the final official pick.
 *
 * TOTALS are display-reconciled only when the visible projected score would
 * contradict the visible O/U pick. The raw model projection remains preserved
 * upstream in game_predictions / snapshot_json; this module only prevents a
 * member-facing card from saying "Under 8.5" while showing a 9.0 projected
 * score, or "Over 8.5" while showing 8.2.
 *
 * The one thing that still needs reconciling is the ML MARGIN SIGN. A corrected
 * (flipped) ML pick has the raw projection favoring the side we flipped away
 * from — e.g. raw shows CLE outscoring CWS but the final pick is CWS. We flip
 * the margin sign so the displayed scores show the FINAL ML pick winning. When
 * total reconciliation is also needed, we scale the displayed total first and
 * then redistribute that total across the picked ML margin.
 *
 * Deterministic, conservative, and a NO-OP when the raw projection already
 * supports the pick. The raw projection is preserved upstream
 * (game_predictions / snapshot); nothing here surfaces as flip/fade language.
 */

export const DISPLAY_PROJECTION_RECON_RULE_ID = "display_projection_recon_v2";

/** Minimal winning margin (runs) when the raw projection has the ML pick LOSING. */
const ML_MIN_WIN_MARGIN = 0.3;
/**
 * Minimal DISPLAYED margin (runs) so the ML pick is always shown STRICTLY
 * winning. A raw near-pickem (e.g. 4.95 vs 4.97) rounds to a 5.0/5.0 tie at one
 * decimal, which would hide the pick. Flooring the displayed margin here keeps
 * the picked team visibly ahead without overstating a blowout.
 */
const ML_MIN_DISPLAY_MARGIN = 0.2;
/** Minimal distance from the total line so a rounded score never lands on push. */
const TOTAL_MIN_DISPLAY_GAP = 0.2;

export type DisplayProjectionInput = {
  rawAway: number | null;
  rawHome: number | null;
  /** Final official ML pick (already flipped if corrected). */
  mlPick: "home" | "away" | null;
  /** Final official O/U pick (already flipped if corrected); kept for API parity. */
  ouPick: "over" | "under" | null;
  /** Displayed sportsbook total line; kept for API parity. */
  line: number | null;
};

export type DisplayProjection = {
  away: number;
  home: number;
  total: number;
  reconciled: boolean;
  rule_id: string;
};

function round1(n: number): number { return Math.round(n * 10) / 10; }

export function reconcileDisplayProjection(i: DisplayProjectionInput): DisplayProjection {
  const rawAway = typeof i.rawAway === "number" && Number.isFinite(i.rawAway) ? i.rawAway : 0;
  const rawHome = typeof i.rawHome === "number" && Number.isFinite(i.rawHome) ? i.rawHome : 0;

  // Displayed total starts from raw, then moves only if it would contradict the
  // visible O/U pick. Keep one decimal so the score total and card math agree.
  const rawTotal = rawAway + rawHome;
  let targetTotal = rawTotal;
  let totalReconciled = false;
  if (i.line !== null && Number.isFinite(i.line)) {
    if (i.ouPick === "over" && targetTotal <= i.line) {
      targetTotal = i.line + TOTAL_MIN_DISPLAY_GAP;
      totalReconciled = true;
    } else if (i.ouPick === "under" && targetTotal >= i.line) {
      targetTotal = Math.max(0, i.line - TOTAL_MIN_DISPLAY_GAP);
      totalReconciled = true;
    }
  }
  targetTotal = round1(targetTotal);
  const rawMargin = rawHome - rawAway; // > 0 ⇒ home projected to win

  // Margin must show the FINAL ML pick winning. If the raw projection already
  // has the pick winning, keep its magnitude; otherwise (a flipped pick) give it
  // the minimal winning margin. Total is held fixed — we only redistribute.
  let signedMargin = rawMargin;
  let marginReconciled = false;
  if (i.mlPick === "home" || i.mlPick === "away") {
    const supportsRaw = i.mlPick === "home" ? rawMargin > 0 : rawMargin < 0;
    // Raw supports the pick: keep its magnitude, but floor it so the winner is
    // never hidden by a rounded tie. Raw contradicts the pick (a flip): give it
    // the minimal winning margin.
    const magnitude = supportsRaw
      ? Math.max(Math.abs(rawMargin), ML_MIN_DISPLAY_MARGIN)
      : ML_MIN_WIN_MARGIN;
    signedMargin = i.mlPick === "home" ? magnitude : -magnitude;
    if (!supportsRaw || magnitude !== Math.abs(rawMargin)) marginReconciled = true;
  }
  signedMargin = Math.max(-targetTotal, Math.min(targetTotal, signedMargin));

  const home = Math.max(0, round1((targetTotal + signedMargin) / 2));
  const away = Math.max(0, round1((targetTotal - signedMargin) / 2));
  const total = round1(home + away);

  return {
    away,
    home,
    total,
    reconciled: marginReconciled || totalReconciled,
    rule_id: DISPLAY_PROJECTION_RECON_RULE_ID,
  };
}
