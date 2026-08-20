const ESPN_EPL_TEAM_IDS: Record<string, number> = {
  ARS: 359,
  AVL: 362,
  BHA: 331,
  BOU: 349,
  BRE: 337,
  CHE: 363,
  COV: 388,
  CRY: 384,
  EVE: 368,
  FUL: 370,
  HUL: 306,
  IPS: 373,
  LEE: 357,
  LIV: 364,
  MAN: 360,
  MNC: 382,
  NEW: 361,
  NFO: 393,
  SUN: 366,
  TOT: 367,
};

/** Presentation-only current EPL crest source. It never enters a model input. */
export function eplTeamLogo(abbreviation: string): string | null {
  const id = ESPN_EPL_TEAM_IDS[abbreviation.toUpperCase()];
  return id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` : null;
}
