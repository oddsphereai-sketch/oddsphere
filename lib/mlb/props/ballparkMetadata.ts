import ballparks from "@/lib/providers/mock/fixtures/ballparks.json";

export type MlbBallparkMetadata = {
  name: string;
  latitude: number;
  longitude: number;
  roofStatus: "outdoor" | "dome" | "retractable";
};

const VENUE_ALIASES: Record<string, string> = {
  "american family field": "miller park",
  "daikin park": "minute maid park",
  "rate field": "guaranteed rate field",
  "uniqlo field at dodger stadium": "dodger stadium",
};

export function resolveMlbBallparkMetadata(venue: string | null | undefined): MlbBallparkMetadata | null {
  if (!venue) return null;
  const requested = VENUE_ALIASES[normalizeVenue(venue)] ?? normalizeVenue(venue);
  const row = ballparks.find((candidate) => normalizeVenue(candidate.name) === requested);
  if (!row || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) return null;
  return {
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    roofStatus: row.is_dome ? "dome" : row.is_retractable ? "retractable" : "outdoor",
  };
}

function normalizeVenue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
