import { nbaResidualQuantile, type NbaPriceCoordinateLaw } from "./nbaPricedMarketMovement";
import type { NbaProfessionalMarketReader, NbaReaderTrail } from "./nbaProfessionalMarketReader";
export const NBA_NATIVE_COORDINATE_RELEASE = "nba_native_price_coordinate_2026_11_20_r1_canonical_margin_axis" as const;
export type NbaNativeCoordinate = { book: string; current: number; opening: number; capturedAt: string; sourceAt: string };
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function selectNbaNativeCoordinate(args: {
  reader: NbaProfessionalMarketReader; market: "spread" | "total"; evaluatedAt: string; law: NbaPriceCoordinateLaw;
}): NbaNativeCoordinate | null {
  const evaluated = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluated) || args.reader.evidenceFamilies?.prices === "failed" || args.reader.evidenceStatus === "unavailable") return null;
  const read = args.reader.reads[args.market];
  for (const book of ["pinnacle", "circa", "bookmaker"]) {
    if ((read.excludedSportsbooks ?? []).includes(book)) continue;
    const valid = read.trails.filter((t: NbaReaderTrail) => {
      if (t.provider !== "owls" || t.sourceClass !== "named" || t.sportsbook !== book || t.providerConflict ||
          ![t.currentNumber, t.openingNumber, t.currentFairFirstProbability, t.openingFairFirstProbability].every(finite) ||
          t.currentFairFirstProbability! <= 0 || t.currentFairFirstProbability! >= 1 || t.openingFairFirstProbability! <= 0 || t.openingFairFirstProbability! >= 1) return false;
      const captured = Date.parse(t.currentCaptureAt ?? ""), opening = Date.parse(t.openingCaptureAt ?? "");
      const observed = Date.parse(t.currentAt), first = Date.parse(t.openingAt);
      return [captured, opening, observed, first].every(Number.isFinite) && first <= opening && opening <= captured &&
        observed <= captured && captured <= evaluated && evaluated - captured <= 120 * 60000;
    });
    if (!valid.length) continue;
    const latestAt = Math.max(...valid.map(t => Date.parse(t.currentCaptureAt!)));
    const latest = valid.filter(t => Date.parse(t.currentCaptureAt!) === latestAt);
    const tuples = new Set(latest.map(t => JSON.stringify([t.currentNumber, t.openingNumber, t.currentFairFirstProbability, t.openingFairFirstProbability])));
    if (tuples.size !== 1) continue;
    const t = latest[0]!;
    // Reader numbers are ALREADY home-margin / total coordinates. No sign inversion.
    return { book, current: t.currentNumber! + nbaResidualQuantile(args.market, t.currentFairFirstProbability!, args.law),
      opening: t.openingNumber! + nbaResidualQuantile(args.market, t.openingFairFirstProbability!, args.law),
      capturedAt: t.currentCaptureAt!, sourceAt: t.currentAt };
  }
  return null;
}

