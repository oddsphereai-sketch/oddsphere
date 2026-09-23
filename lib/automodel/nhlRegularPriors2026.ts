export type NhlCalibratedTeamState = {
  elo: number;
  goalsFor: number;
  goalsAgainst: number;
};

/**
 * Frozen 2026 opening priors produced by the release-pure 2023-2025
 * BALLDONTLIE regular-season tournament. Values already include the selected
 * between-season regression and are updated only by earlier 2026 final games.
 */
export const NHL_2026_OPENING_PRIORS: Readonly<Record<string, NhlCalibratedTeamState>> = {
  ANA: { elo: 1487.767484, goalsFor: 3.174452, goalsAgainst: 3.363668 },
  BOS: { elo: 1516.841342, goalsFor: 3.182193, goalsAgainst: 2.938142 },
  BUF: { elo: 1566.773613, goalsFor: 3.433564, goalsAgainst: 2.894951 },
  CAR: { elo: 1574.632182, goalsFor: 3.480601, goalsAgainst: 2.961378 },
  CBJ: { elo: 1495.355570, goalsFor: 2.957296, goalsAgainst: 2.967241 },
  CGY: { elo: 1469.164027, goalsFor: 2.820160, goalsAgainst: 3.177511 },
  CHI: { elo: 1414.518126, goalsFor: 2.683761, goalsAgainst: 3.398527 },
  COL: { elo: 1569.787229, goalsFor: 3.251340, goalsAgainst: 2.653233 },
  DAL: { elo: 1553.176477, goalsFor: 3.245921, goalsAgainst: 2.881241 },
  DET: { elo: 1480.194299, goalsFor: 2.922802, goalsAgainst: 3.260589 },
  EDM: { elo: 1505.212196, goalsFor: 3.267601, goalsAgainst: 3.063524 },
  FLA: { elo: 1495.031432, goalsFor: 3.107665, goalsAgainst: 3.280482 },
  LAK: { elo: 1471.193645, goalsFor: 2.954076, goalsAgainst: 3.069626 },
  MIN: { elo: 1527.258660, goalsFor: 3.246602, goalsAgainst: 3.053018 },
  MTL: { elo: 1555.418410, goalsFor: 3.230922, goalsAgainst: 2.909559 },
  NJD: { elo: 1499.138996, goalsFor: 2.986562, goalsAgainst: 3.140906 },
  NSH: { elo: 1483.269600, goalsFor: 3.092338, goalsAgainst: 3.090141 },
  NYI: { elo: 1494.778113, goalsFor: 2.804566, goalsAgainst: 3.087946 },
  NYR: { elo: 1460.844421, goalsFor: 3.121308, goalsAgainst: 3.015668 },
  OTT: { elo: 1537.414757, goalsFor: 3.303328, goalsAgainst: 2.815810 },
  PHI: { elo: 1527.449586, goalsFor: 3.157982, goalsAgainst: 2.880601 },
  PIT: { elo: 1500.762164, goalsFor: 3.557532, goalsAgainst: 3.406447 },
  SEA: { elo: 1441.756078, goalsFor: 2.798026, goalsAgainst: 3.317201 },
  SJS: { elo: 1468.022914, goalsFor: 3.030002, goalsAgainst: 3.399082 },
  STL: { elo: 1510.717115, goalsFor: 3.181451, goalsAgainst: 2.899135 },
  TBL: { elo: 1551.295951, goalsFor: 3.296081, goalsAgainst: 3.010202 },
  TOR: { elo: 1444.115166, goalsFor: 2.944760, goalsAgainst: 3.612045 },
  UTA: { elo: 1508.828485, goalsFor: 3.307877, goalsAgainst: 3.110741 },
  VAN: { elo: 1400.435670, goalsFor: 2.789868, goalsAgainst: 3.685673 },
  VGK: { elo: 1495.100480, goalsFor: 3.175916, goalsAgainst: 2.936177 },
  WPG: { elo: 1476.701479, goalsFor: 2.825742, goalsAgainst: 3.234351 },
  WSH: { elo: 1528.211954, goalsFor: 3.194029, goalsAgainst: 3.023204 },
};
