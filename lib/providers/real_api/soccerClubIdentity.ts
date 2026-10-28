export const SOCCER_CLUB_IDENTITY_RELEASE =
  "soccer_club_identity_2026_10_28_r1_provider_neutral_exact_ucl" as const;

const EPL_EQUIVALENCE_GROUPS = [
  ["coventrycity", "coventry"],
  ["crystalpalace", "cpalace", "palace"],
  ["manchesterunited", "manunited", "manutd"],
  ["manchestercity", "mancity"],
  ["nottinghamforest", "nottmforest"],
  ["wolverhamptonwanderers", "wolves", "wolverhampton"],
  ["tottenhamhotspur", "tottenham", "spurs"],
] as const;

const UCL_EQUIVALENCE_GROUPS = [
  ["sabahfk", "sabah", "sabahmasazir", "fcsabahmasazir", "sabahbakufk"],
  ["asroma", "roma"],
  ["fcporto", "porto"],
  ["psveindhoven", "psv", "eindhoven"],
  ["sscnapoli", "napoli"],
  ["bodoglimt", "bodoeglimt", "bodglimt"],
  ["fcbarcelona", "barcelona"],
  ["manchesterunited", "manunited"],
  ["vikingfk", "viking", "vikingstavanger"],
  ["manchestercity", "mancity"],
  ["internazionalemilano", "internazionale", "intermilan", "inter"],
  ["parisstgermain", "parissaintgermain", "psg"],
  ["sportingclubedeportugal", "sportingcp", "sportinglisbon", "sporting"],
  ["slaviapraha", "slaviaprague"],
  ["bayer04leverkusen", "bayerleverkusen", "leverkusen"],
  ["bayernmunchen", "bayernmunich", "bayern"],
  ["atletico", "atleticomadrid", "atleticodemadrid"],
  ["olympiquedemarseille", "marseille"],
  ["olympiacosfc", "olympiacos"],
  ["borussiadortmund", "dortmund"],
  ["borussiamonchengladbach", "monchengladbach"],
  ["realbetis", "betis"],
  ["fcshakhtardonetsk", "fkshakhtardonetsk", "shakhtardonetsk", "shakhtar"],
  ["slovanbratislava", "skslovanbratislava", "sbratislava"],
  ["vfbstuttgart", "vfbstuttgart1893", "stuttgart"],
] as const;

function key(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inSameGroup(left: string, right: string, groups: readonly (readonly string[])[]): boolean {
  return groups.some((group) => group.includes(left) && group.includes(right));
}

export function eplClubNamesMatch(left: string, right: string): boolean {
  const a = key(left);
  const b = key(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a) || inSameGroup(a, b, EPL_EQUIVALENCE_GROUPS);
}

export function uclClubNamesMatch(left: string, right: string): boolean {
  const a = key(left);
  const b = key(right);
  if (!a || !b) return false;
  return a === b || inSameGroup(a, b, UCL_EQUIVALENCE_GROUPS);
}
