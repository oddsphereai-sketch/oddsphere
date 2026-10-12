import { CFB_TEAM_IDENTITIES } from "./cfbTeamIdentity";

/**
 * Provider-facing aliases that cannot be derived safely from the canonical
 * BALLDONTLIE display name. Keep this registry abbreviation-scoped: callers
 * already know which scheduled team they are trying to resolve, and an alias
 * must never be allowed to identify a different team merely because two school
 * names share a prefix.
 */
export const CFB_PROVIDER_TEAM_ALIASES: Readonly<Record<string, readonly string[]>> = {
  ALA: ["Alabama"],
  APP: ["App State", "Appalachian State", "Appalachian State Mountaineers"],
  CIT: ["Citadel", "Citadel Bulldogs"],
  CONN: ["Connecticut", "UConn"],
  FLA: ["Florida"],
  GRAM: ["Grambling", "Grambling State", "Grambling Tigers"],
  HCU: ["Houston Baptist", "Houston Baptist Huskies"],
  LIU: ["LIU", "Long Island University", "Long Island University Sharks"],
  MASS: ["Massachusetts", "UMass"],
  MIA: ["Miami", "Miami FL", "Miami Florida"],
  "M-OH": ["Miami OH", "Miami Ohio"],
  MTSU: ["Middle Tennessee", "Middle Tenn ST", "Middle Tennessee State"],
  NICH: ["Nicholls", "Nicholls State", "Nicholls State Colonels"],
  NCST: ["NC State", "North Carolina State"],
  NCSU: ["NC State", "North Carolina State"],
  SHSU: ["Sam Houston", "Sam Houston State", "Sam Houston State Bearkats"],
  SELA: ["SE Louisiana", "Southeastern Louisiana", "Southeastern Louisiana Lions"],
  SOU: ["Southern", "Southern University", "Southern University Jaguars"],
  UL: ["Louisiana", "Louisiana Lafayette"],
  UALB: ["Albany", "UAlbany"],
  USM: ["Southern Miss", "Southern Mississippi", "Southern Mississippi Golden Eagles"],
  "W&M": ["William & Mary", "William and Mary"],
  YSU: ["Youngstown State", "Youngstown St", "Youngstown St Penguins"],
};

const NORMALIZED_IDENTITIES_BY_TEAM = new Map<string, ReadonlySet<string>>(
  Object.entries(CFB_TEAM_IDENTITIES).map(([abbreviation, identity]) => [
    abbreviation,
    new Set([
      normalizeCfbProviderTeam(abbreviation),
      normalizeCfbProviderTeam(identity.displayName),
      ...(CFB_PROVIDER_TEAM_ALIASES[abbreviation] ?? []).map(normalizeCfbProviderTeam),
    ].filter(Boolean)),
  ]),
);

/**
 * Match a provider team label to one already-scheduled CFB team.
 *
 * Exact canonical/alias matches are preferred. Provider shorthand is accepted
 * only when that prefix belongs to exactly one team in the entire supported
 * identity catalog. This preserves useful labels such as "Appalachian State"
 * while rejecting unsafe generic labels such as "Florida" unless they are an
 * explicit abbreviation-scoped alias.
 */
export function cfbProviderTeamMatches(args: {
  observed: unknown;
  abbreviation: string;
  expectedName?: string | null;
}): boolean {
  const observed = normalizeCfbProviderTeam(args.observed);
  const abbreviation = args.abbreviation.toUpperCase();
  if (!observed || !abbreviation) return false;

  const expected = new Set([
    ...(NORMALIZED_IDENTITIES_BY_TEAM.get(abbreviation) ?? []),
    normalizeCfbProviderTeam(args.expectedName),
  ].filter(Boolean));
  if (expected.has(observed)) return true;

  const expectedPrefixLength = NORMALIZED_IDENTITIES_BY_TEAM.has(abbreviation) ? 5 : 3;
  const compatibleExpected = [...expected].filter((candidate) =>
    Math.min(candidate.length, observed.length) >= expectedPrefixLength &&
    (candidate.startsWith(observed) || observed.startsWith(candidate)),
  );
  if (compatibleExpected.length === 0) return false;

  const compatibleTeams = [...NORMALIZED_IDENTITIES_BY_TEAM.entries()].filter(([, identities]) =>
    [...identities].some((candidate) =>
      Math.min(candidate.length, observed.length) >= 5 &&
      (candidate.startsWith(observed) || observed.startsWith(candidate)),
    ),
  );
  if (compatibleTeams.length === 1 && compatibleTeams[0]![0] === abbreviation) return true;
  // Some FCS opponents are present in the authoritative schedule before the
  // static presentation catalog is regenerated. Preserve an expected-name
  // prefix only when neither its abbreviation nor observed shorthand can be
  // confused with any cataloged team.
  return compatibleTeams.length === 0 && !NORMALIZED_IDENTITIES_BY_TEAM.has(abbreviation);
}

export function normalizeCfbProviderTeam(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/^\s*\(\d+\)\s*/, "")
      .replace(/\s+[+-]?\d+(?:\.\d+)?(?:\s+[+-]?\d+(?:\.\d+)?)*\s*$/, "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " and ")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
    : "";
}
