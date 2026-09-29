export const NHL_OPPONENT_ADJUSTED_STATE_RELEASE =
  "nhl_opponent_adjusted_state_2026_09_29_r1" as const;

export const NHL_OPPONENT_ADJUSTED_ALPHA = 0.085;

export type NhlOpponentAdjustedState = {
  attack: number;
  defenseWeakness: number;
};

/**
 * Frozen 2026 opening state from the release-pure 2016-2025 MoneyPuck
 * game-by-game replay. Each season boundary regresses both components 35%
 * toward league average. Current-season updates consume only earlier games.
 */
export const NHL_2026_OPPONENT_ADJUSTED_OPENING_STATE: Readonly<Record<string, NhlOpponentAdjustedState>> = {
  ANA: { attack: 0.404606068, defenseWeakness: 0.209675732 },
  BOS: { attack: 0.001116617, defenseWeakness: 0.115593050 },
  BUF: { attack: 0.007523662, defenseWeakness: 0.037225214 },
  CAR: { attack: 0.379932631, defenseWeakness: -0.146189140 },
  CBJ: { attack: -0.009845393, defenseWeakness: -0.157295255 },
  CGY: { attack: -0.235295234, defenseWeakness: 0.248780876 },
  CHI: { attack: -0.262182859, defenseWeakness: 0.268491029 },
  COL: { attack: 0.342350244, defenseWeakness: -0.090515927 },
  DAL: { attack: -0.014753875, defenseWeakness: -0.125769984 },
  DET: { attack: -0.029650575, defenseWeakness: 0.022656979 },
  EDM: { attack: 0.184597845, defenseWeakness: -0.086844678 },
  FLA: { attack: 0.029933187, defenseWeakness: 0.146205058 },
  LAK: { attack: -0.050438394, defenseWeakness: -0.114960954 },
  MIN: { attack: 0.207931312, defenseWeakness: -0.040172582 },
  MTL: { attack: 0.199905321, defenseWeakness: 0.204612005 },
  NJD: { attack: 0.149516016, defenseWeakness: -0.068752533 },
  NSH: { attack: -0.074552569, defenseWeakness: 0.187498620 },
  NYI: { attack: 0.120493578, defenseWeakness: 0.156323438 },
  NYR: { attack: -0.084734101, defenseWeakness: 0.099162806 },
  OTT: { attack: 0.268262276, defenseWeakness: -0.282472551 },
  PHI: { attack: -0.015243108, defenseWeakness: -0.293212915 },
  PIT: { attack: 0.145414170, defenseWeakness: 0.136339744 },
  SEA: { attack: -0.318187521, defenseWeakness: 0.042383357 },
  SJS: { attack: -0.173696117, defenseWeakness: 0.060995589 },
  STL: { attack: -0.114049354, defenseWeakness: -0.090767876 },
  TBL: { attack: 0.115000634, defenseWeakness: -0.092230334 },
  TOR: { attack: -0.158913803, defenseWeakness: 0.512677332 },
  UTA: { attack: 0.132854733, defenseWeakness: 0.093856688 },
  VAN: { attack: -0.244537234, defenseWeakness: 0.172309288 },
  VGK: { attack: 0.117895384, defenseWeakness: -0.184132927 },
  WPG: { attack: -0.003690519, defenseWeakness: 0.069859057 },
  WSH: { attack: 0.097173604, defenseWeakness: 0.045624479 },
};

export function openingNhlOpponentAdjustedState(): Map<string, NhlOpponentAdjustedState> {
  return new Map(Object.entries(NHL_2026_OPPONENT_ADJUSTED_OPENING_STATE).map(
    ([team, state]) => [team, { ...state }],
  ));
}
