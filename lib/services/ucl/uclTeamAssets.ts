export type UclTeamAsset = {
  displayName: string;
  espnId: number;
  primaryColor: string;
};

/**
 * Presentation-only club identity for the current Champions League field.
 *
 * The identifiers, crests, and colors use the same ESPN soccer asset family
 * already used by the Premier League cards. They never enter a forecast,
 * market comparison, grade, lock, or settlement decision.
 */
export const UCL_TEAM_ASSETS: Record<string, UclTeamAsset> = {
  AEK: { displayName: "AEK Athens", espnId: 887, primaryColor: "#FFFF00" },
  ARS: { displayName: "Arsenal", espnId: 359, primaryColor: "#E20520" },
  ATM: { displayName: "Atlético Madrid", espnId: 1068, primaryColor: "#CA3624" },
  AVL: { displayName: "Aston Villa", espnId: 362, primaryColor: "#660E36" },
  BAR: { displayName: "Barcelona", espnId: 83, primaryColor: "#990000" },
  BET: { displayName: "Real Betis", espnId: 244, primaryColor: "#288A00" },
  BODO: { displayName: "Bodo/Glimt", espnId: 2980, primaryColor: "#FCEE33" },
  BRU: { displayName: "Club Brugge", espnId: 570, primaryColor: "#0081FF" },
  COMO: { displayName: "Como", espnId: 2572, primaryColor: "#4169E1" },
  DOR: { displayName: "Borussia Dortmund", espnId: 124, primaryColor: "#FFEE00" },
  FCP: { displayName: "FC Porto", espnId: 437, primaryColor: "#0000DD" },
  FEN: { displayName: "Fenerbahce", espnId: 436, primaryColor: "#FFFF00" },
  FEY: { displayName: "Feyenoord Rotterdam", espnId: 142, primaryColor: "#EF2F24" },
  GAL: { displayName: "Galatasaray", espnId: 432, primaryColor: "#AA0031" },
  INT: { displayName: "Internazionale", espnId: 110, primaryColor: "#00239C" },
  LAS: { displayName: "LASK Linz", espnId: 4411, primaryColor: "#FFFFFF" },
  LILL: { displayName: "Lille", espnId: 166, primaryColor: "#C2051B" },
  LIV: { displayName: "Liverpool", espnId: 364, primaryColor: "#D11317" },
  MAN: { displayName: "Manchester United", espnId: 360, primaryColor: "#DA020E" },
  MNC: { displayName: "Manchester City", espnId: 382, primaryColor: "#99C5EA" },
  MUN: { displayName: "Bayern Munich", espnId: 132, primaryColor: "#DC052D" },
  NAP: { displayName: "Napoli", espnId: 114, primaryColor: "#0677D2" },
  PSG: { displayName: "Paris Saint-Germain", espnId: 160, primaryColor: "#011F68" },
  PSV: { displayName: "PSV Eindhoven", espnId: 148, primaryColor: "#EF2F24" },
  RBL: { displayName: "RB Leipzig", espnId: 11420, primaryColor: "#FFFFFF" },
  RCL: { displayName: "Lens", espnId: 175, primaryColor: "#E91514" },
  RMA: { displayName: "Real Madrid", espnId: 86, primaryColor: "#FFFFFF" },
  ROMA: { displayName: "AS Roma", espnId: 104, primaryColor: "#990A2C" },
  SAB: { displayName: "Sabah FK", espnId: 21922, primaryColor: "#000000" },
  SCP: { displayName: "Sporting CP", espnId: 2250, primaryColor: "#008127" },
  SHK: { displayName: "Shakhtar Donetsk", espnId: 493, primaryColor: "#FF5900" },
  SLB: { displayName: "Slovan Bratislava", espnId: 521, primaryColor: "#81C0FF" },
  SLP: { displayName: "Slavia Prague", espnId: 494, primaryColor: "#DC1F26" },
  VFB: { displayName: "VfB Stuttgart", espnId: 134, primaryColor: "#FFFFFF" },
  VIK: { displayName: "Viking FK", espnId: 510, primaryColor: "#000080" },
  VIL: { displayName: "Villarreal", espnId: 102, primaryColor: "#FFFF00" },
};

export function uclTeamAsset(abbreviation: string): UclTeamAsset | null {
  return UCL_TEAM_ASSETS[abbreviation.trim().toUpperCase()] ?? null;
}

export function uclTeamLogo(abbreviation: string): string | null {
  const asset = uclTeamAsset(abbreviation);
  return asset ? `https://a.espncdn.com/i/teamlogos/soccer/500/${asset.espnId}.png` : null;
}
