/** Offline point-stage comparison. Never represents full-market wager replay. */
import type { NbaPortableScore } from "../../automodel/nba/nbaPortableScoreModel";
import { scoreNbaScaledPlayerImpact, type NbaScaledImpactHead, type NbaScaledImpactInput } from "./nbaScaledPlayerImpact";

/** Direction diagnostic at the original line only; supplies no opposing price or grade. */
export function nbaImpactDirectionAtSavedLine(args: { margin: number; total: number; market: "moneyline" | "spread" | "total";
  storedSide: string; selectedLine: number | null; actualMargin: number; actualTotal: number }) {
  if (![args.margin, args.total, args.actualMargin, args.actualTotal].every(Number.isFinite) ||
      (args.market !== "moneyline" && (args.selectedLine === null || !Number.isFinite(args.selectedLine))) ||
      (args.market === "spread" && !["home", "away"].includes(args.storedSide))) throw Error("invalid_saved_line_diagnostic");
  const homeLine = args.market === "spread" ? args.selectedLine! * (args.storedSide === "home" ? 1 : -1) : 0;
  const first = args.market === "moneyline" ? args.margin >= 0 : args.market === "spread" ? args.margin + homeLine >= 0 : args.total >= args.selectedLine!;
  const actual = args.market === "moneyline" ? args.actualMargin : args.market === "spread" ? args.actualMargin + homeLine : args.actualTotal - args.selectedLine!;
  const difference = actual * (first ? 1 : -1);
  return { side: args.market === "total" ? first ? "over" : "under" : first ? "home" : "away",
    result: difference === 0 ? "push" : difference > 0 ? "win" : "loss", price: null, grade: null };
}

export function compareNbaScaledImpactWithSavedIncumbent(args: {
  head: NbaScaledImpactHead; input: NbaScaledImpactInput; savedAsOf: string;
  raw: NbaPortableScore; savedIndependent: { margin: number; total: number };
  oldRosterCorrection: { margin: number; total: number };
}) {
  const { raw, savedIndependent: saved, oldRosterCorrection: old } = args;
  if (!Number.isFinite(Date.parse(args.savedAsOf)) || Date.parse(args.input.cutoff) > Date.parse(args.savedAsOf)) {
    throw Error("impact_source_not_proven_by_saved_asof");
  }
  if (![raw.homeScore, raw.awayScore, raw.marginHome, raw.total, saved.margin, saved.total, old.margin, old.total].every(Number.isFinite) ||
      Math.abs(raw.homeScore - raw.awayScore - raw.marginHome) > 1e-9 || Math.abs(raw.homeScore + raw.awayScore - raw.total) > 1e-9 ||
      Math.abs(raw.marginHome + old.margin - saved.margin) > 1e-8 || Math.abs(raw.total + old.total - saved.total) > 1e-8) {
    throw Error("saved_incumbent_projection_parity_failed");
  }
  const c = scoreNbaScaledPlayerImpact(args.head, args.input);
  const margin = raw.marginHome + c.marginCorrection, total = raw.total + c.totalCorrection;
  if (!Number.isFinite(margin) || !Number.isFinite(total) || total <= Math.abs(margin)) throw Error("invalid_compared_impact_score");
  return { ...c, incumbent: { margin: saved.margin, total: saved.total, homeScore: (saved.total + saved.margin) / 2,
    awayScore: (saved.total - saved.margin) / 2 }, candidate: { margin, total, homeScore: (total + margin) / 2,
    awayScore: (total - margin) / 2 }, removedOldRosterCorrection: { ...old },
    fullMarketReplay: false as const, probabilityCalibrationQualified: false as const, productionPromotionEligible: false as const };
}
