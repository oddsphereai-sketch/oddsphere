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

// FIFA association alpha-3 code → flagcdn alpha-2 code. FIFA codes differ
// from ISO 3166-1 alpha-3 for several nations (RSA≠ZAF, GER≠DEU, NED≠NLD,
// POR≠PRT, …), and BDL returns the FIFA code, so this map is keyed by the
// FIFA code. UK home nations use flagcdn's subdivision codes (gb-eng etc.).
// Comprehensive across all six confederations so no WC team renders without
// a flag; unknown codes return null → the UI falls back to the text abbr.
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  // ── UEFA ──
  ALB: "al", AND: "ad", ARM: "am", AUT: "at", AZE: "az", BLR: "by", BEL: "be",
  BIH: "ba", BUL: "bg", CRO: "hr", CYP: "cy", CZE: "cz", DEN: "dk", ENG: "gb-eng",
  EST: "ee", FRO: "fo", FIN: "fi", FRA: "fr", GEO: "ge", GER: "de", GIB: "gi",
  GRE: "gr", HUN: "hu", ISL: "is", ISR: "il", ITA: "it", KAZ: "kz", KVX: "xk",
  KOS: "xk", LVA: "lv", LIE: "li", LTU: "lt", LUX: "lu", MLT: "mt", MDA: "md",
  MNE: "me", NED: "nl", MKD: "mk", NIR: "gb-nir", NOR: "no", POL: "pl", POR: "pt",
  IRL: "ie", ROU: "ro", RUS: "ru", SMR: "sm", SCO: "gb-sct", SRB: "rs", SVK: "sk",
  SVN: "si", ESP: "es", SWE: "se", SUI: "ch", TUR: "tr", UKR: "ua", WAL: "gb-wls",
  // ── CONMEBOL ──
  ARG: "ar", BOL: "bo", BRA: "br", CHI: "cl", COL: "co", ECU: "ec", PAR: "py",
  PER: "pe", URU: "uy", VEN: "ve",
  // ── CONCACAF ──
  ATG: "ag", BRB: "bb", BLZ: "bz", BER: "bm", CAN: "ca", CRC: "cr", CUB: "cu",
  CUW: "cw", DMA: "dm", DOM: "do", SLV: "sv", GRN: "gd", GUA: "gt", GUY: "gy",
  HAI: "ht", HTI: "ht", HON: "hn", JAM: "jm", MEX: "mx", NCA: "ni", PAN: "pa",
  KNA: "kn", LCA: "lc", VIN: "vc", SUR: "sr", TRI: "tt", USA: "us",
  // ── CAF ──
  ALG: "dz", ANG: "ao", BEN: "bj", BOT: "bw", BFA: "bf", BDI: "bi", CMR: "cm",
  CPV: "cv", CTA: "cf", CHA: "td", COM: "km", CGO: "cg", COD: "cd", CIV: "ci",
  DJI: "dj", EGY: "eg", EQG: "gq", ERI: "er", SWZ: "sz", ETH: "et", GAB: "ga",
  GAM: "gm", GHA: "gh", GUI: "gn", GNB: "gw", KEN: "ke", LES: "ls", LBR: "lr",
  LBY: "ly", MAD: "mg", MWI: "mw", MLI: "ml", MTN: "mr", MRI: "mu", MAR: "ma",
  MOZ: "mz", NAM: "na", NIG: "ne", NGA: "ng", RWA: "rw", STP: "st", SEN: "sn",
  SEY: "sc", SLE: "sl", SOM: "so", RSA: "za", SSD: "ss", SDN: "sd", TAN: "tz",
  TOG: "tg", TUN: "tn", UGA: "ug", ZAM: "zm", ZIM: "zw",
  // ── AFC ──
  AFG: "af", AUS: "au", BHR: "bh", BAN: "bd", BHU: "bt", BRU: "bn", CAM: "kh",
  CHN: "cn", TPE: "tw", GUM: "gu", HKG: "hk", IND: "in", IDN: "id", IRN: "ir",
  IRQ: "iq", JPN: "jp", JOR: "jo", KOR: "kr", PRK: "kp", KUW: "kw", KGZ: "kg",
  LAO: "la", LBN: "lb", MAS: "my", MDV: "mv", MGL: "mn", MYA: "mm", NEP: "np",
  OMA: "om", PAK: "pk", PLE: "ps", PHI: "ph", QAT: "qa", KSA: "sa", SGP: "sg",
  SRI: "lk", SYR: "sy", TJK: "tj", THA: "th", TLS: "tl", TKM: "tm", UAE: "ae",
  UZB: "uz", VIE: "vn", YEM: "ye",
  // ── OFC ──
  ASA: "as", COK: "ck", FIJ: "fj", NCL: "nc", NZL: "nz", PNG: "pg", SAM: "ws",
  SOL: "sb", TAH: "pf", TGA: "to", VAN: "vu",
};

/**
 * Resolve a CDN flag URL for a FIFA alpha-3 country code. Returns null when
 * the code is unknown — the caller falls back to the text abbreviation
 * rather than render a broken image. (We deliberately do NOT guess
 * abbr.toLowerCase(): an invalid 2-letter code yields a broken flagcdn
 * image, which looks worse than the text chip.)
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
