import type {
  IParkFactorProvider,
  ParkFactorRecord,
} from "../interfaces/IParkFactorProvider";

import ballparksJson from "./fixtures/ballparks.json";
import teamsJson from "./fixtures/teams.json";

type BallparkFixture = {
  team_external_id: number;
  park_factor_runs: number;
  park_factor_hr: number;
  park_factor_hits: number;
  park_factor_so: number | null;
  park_factor_handedness_lhh: number | null;
  park_factor_handedness_rhh: number | null;
};

type TeamFixture = {
  external_id: number;
  abbreviation: string;
};

const BALLPARKS = ballparksJson as unknown as BallparkFixture[];
const TEAM_ABBR = new Map<number, string>(
  (teamsJson as unknown as TeamFixture[]).map((t) => [
    t.external_id,
    t.abbreviation,
  ])
);

export class MockParkFactorProvider implements IParkFactorProvider {
  async getParkFactors(season?: number): Promise<ParkFactorRecord[]> {
    // Mock data is locked to a single 3-yr rolling window. The season arg is
    // accepted for API parity; the same factors are returned regardless.
    const effectiveSeason = season ?? 2026;
    return BALLPARKS.map((b) => ({
      team_abbreviation: TEAM_ABBR.get(b.team_external_id) ?? "",
      season: effectiveSeason,
      park_factor_runs: b.park_factor_runs,
      park_factor_hr: b.park_factor_hr,
      park_factor_hits: b.park_factor_hits,
      park_factor_so: b.park_factor_so,
      park_factor_handedness_lhh: b.park_factor_handedness_lhh,
      park_factor_handedness_rhh: b.park_factor_handedness_rhh,
    }));
  }
}
