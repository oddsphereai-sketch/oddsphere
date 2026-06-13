/**
 * BDL FIFA returns ISO 3166-1 alpha-3 country codes (MEX, KOR, CZE…) but
 * flag CDN services need alpha-2 (mx, kr, cz). This module maps the WC 2026
 * participating nations (and the broader FIFA WC pool) from alpha-3 → alpha-2.
 *
 * Source of truth for the mapping: ISO 3166-1. FIFA's own codes match ISO
 * for almost every member — the exceptions surface for legacy codes like
 * RSA (South Africa, ISO=ZA) and KOR (South Korea, ISO=KR).
 *
 * Pure module. No I/O. No DB. Safe to import anywhere.
 */

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  // 2026 World Cup confirmed + likely participants. Expand as fixtures
  // are seeded — the helper falls back to abbr.toLowerCase() when a
  // code is missing, so we'll still get something on day 0.
  ARG: "ar", AUS: "au", AUT: "at", BEL: "be", BIH: "ba",
  BRA: "br", CAN: "ca", COL: "co", CRC: "cr", CRO: "hr",
  CZE: "cz", DEN: "dk", ECU: "ec", EGY: "eg", ENG: "gb-eng",
  ESP: "es", FIJ: "fj", FRA: "fr", GER: "de", GHA: "gh",
  HAI: "ht", HTI: "ht", HUN: "hu", IRN: "ir", ITA: "it", JPN: "jp", KOR: "kr",
  MAR: "ma", MEX: "mx", NED: "nl", NGA: "ng", NOR: "no",
  PAN: "pa", PAR: "py", PER: "pe", POL: "pl", POR: "pt",
  QAT: "qa", RSA: "za", SCO: "gb-sct", SEN: "sn", SRB: "rs",
  SUI: "ch", SVK: "sk", SVN: "si", SWE: "se", TUN: "tn",
  TUR: "tr", UAE: "ae", UKR: "ua", URU: "uy", USA: "us",
  WAL: "gb-wls", VEN: "ve",
};

/**
 * Resolve a CDN flag URL for a country code. Returns null when the code
 * is unknown — the caller should fall back to text abbreviation rather
 * than render a broken image.
 *
 * `flagcdn.com` is a small static CDN; h60 = 60-pixel height variant
 * which is plenty for our card chip.
 */
export function flagCdnUrl(alpha3: string | null | undefined, height: 40 | 60 | 80 = 60): string | null {
  if (typeof alpha3 !== "string" || alpha3.length !== 3) return null;
  const code = ALPHA3_TO_ALPHA2[alpha3.toUpperCase()];
  if (code === undefined) return null;
  return `https://flagcdn.com/h${height}/${code}.png`;
}

/**
 * Emoji-flag fallback for terminals / no-image contexts. Returns the
 * regional-indicator pair for the country, or an empty string when the
 * code is unknown.
 */
export function flagEmoji(alpha3: string | null | undefined): string {
  if (typeof alpha3 !== "string" || alpha3.length !== 3) return "";
  const code = ALPHA3_TO_ALPHA2[alpha3.toUpperCase()];
  if (code === undefined) return "";
  const base = 0x1f1e6;
  const a = code.toUpperCase().charCodeAt(0) - 65 + base;
  const b = code.toUpperCase().charCodeAt(1) - 65 + base;
  return String.fromCodePoint(a) + String.fromCodePoint(b);
}
