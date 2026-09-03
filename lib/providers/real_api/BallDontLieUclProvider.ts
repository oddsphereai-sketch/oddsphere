import {
  BallDontLieEplProvider,
  type BdlEplMatch,
  type BdlEplMatchLineup,
  type BdlEplOdds,
  type BdlEplPlayerInjury,
  type BdlEplPregameForm,
  type BdlEplStanding,
  type BdlEplTeam,
  type BdlEplTeamMatchStats,
} from "./BallDontLieEplProvider";

/** Official dedicated BALLDONTLIE Champions League product. It deliberately
 * shares the typed club-soccer envelope with EPL; only the provider namespace
 * differs. The UCL API has no league-id query parameter. */
export const BALLDONTLIE_UCL_API_BASE_URL = "https://api.balldontlie.io/ucl/v1" as const;
export const UCL_HISTORY_PROVIDER_CONTRACT_DEVIATION = "documented seasons[] and start_date/end_date filters ignored; using separately validated season= requests" as const;

export type BdlUclMatch = BdlEplMatch;
export type BdlUclMatchLineup = BdlEplMatchLineup;
export type BdlUclOdds = BdlEplOdds;
export type BdlUclPlayerInjury = BdlEplPlayerInjury;
export type BdlUclPregameForm = BdlEplPregameForm;
export type BdlUclStanding = BdlEplStanding;
export type BdlUclTeam = BdlEplTeam;
export type BdlUclTeamMatchStats = BdlEplTeamMatchStats;

export type UclHistoryFetchTelemetry = {
  status: "ready";
  strategy: "singular_season_provider_deviation";
  requestedSeasons: number[];
  providerContractDeviation: string;
  rowsBySeason: Record<string, number>;
  rows: number;
};

export class UclSeasonCohortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UclSeasonCohortError";
  }
}

export function dedupeValidatedUclMatches(rows: BdlUclMatch[], label: string): BdlUclMatch[] {
  const byId = new Map<number, BdlUclMatch>();
  for (const row of rows) {
    const prior = byId.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) {
      throw new UclSeasonCohortError(`BALLDONTLIE UCL ${label} returned conflicting duplicate match ${row.id}`);
    }
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.id - right.id);
}

export function validateUclHistoryCohort(rows: BdlUclMatch[], seasons: number[]): void {
  const expected = new Set(seasons);
  const invalid = rows.filter((row) => !expected.has(row.season));
  if (invalid.length) {
    const sample = invalid.slice(0, 5).map((row) => `${row.id}:${row.season}`).join(", ");
    throw new UclSeasonCohortError(`BALLDONTLIE UCL /matches returned rows outside requested seasons [${seasons.join(",")}]: ${sample}`);
  }
}

function hasRegulationFinalScore(row: BdlUclMatch): boolean {
  if (row.status_state !== "final") return false;
  const special = row.status_detail === "AET" || row.status_detail === "FT-Pens"
    || row.status === "STATUS_FINAL_AET" || row.status === "STATUS_FINAL_PEN";
  if (!special) return typeof row.home_score === "number" && typeof row.away_score === "number";
  return [row.first_half_home_score, row.first_half_away_score, row.second_half_home_score, row.second_half_away_score]
    .every((value) => typeof value === "number" && Number.isFinite(value));
}

export function validateCompleteUclHistoryCohort(rows: BdlUclMatch[], seasons: number[]): void {
  validateUclHistoryCohort(rows, seasons);
  const missing = seasons.filter((season) => !rows.some((row) => row.season === season && hasRegulationFinalScore(row)));
  if (missing.length) {
    throw new UclSeasonCohortError(`BALLDONTLIE UCL history has no regulation-final rows for requested seasons [${missing.join(",")}]`);
  }
}

export class BallDontLieUclProvider extends BallDontLieEplProvider {
  constructor(apiKey: string, fetchImpl: typeof fetch = globalThis.fetch) {
    super(apiKey, fetchImpl, BALLDONTLIE_UCL_API_BASE_URL, "UCL");
  }

  /** General documented query surface, retained for date-scoped settlement.
   * Production season cohorts use the strict singular methods below because
   * live UCL tests proved the documented plural filter is ignored. */
  override async listMatches(options: { season?: number; seasons?: number[]; dates?: string[]; teamIds?: number[] }): Promise<BdlUclMatch[]> {
    const requestedSeasons = options.seasons ?? (options.season === undefined ? [] : [options.season]);
    const rows = await super.listMatches({
      seasons: requestedSeasons.length ? requestedSeasons : undefined,
      dates: options.dates,
      teamIds: options.teamIds,
    });
    if (requestedSeasons.length) {
      const expected = new Set(requestedSeasons);
      const mismatches = rows.filter((row) => !expected.has(row.season));
      if (mismatches.length) {
        const sample = mismatches.slice(0, 5).map((row) => `${row.id}:${row.season}`).join(", ");
        throw new UclSeasonCohortError(`BALLDONTLIE UCL /matches returned rows outside requested seasons [${requestedSeasons.join(",")}]: ${sample}`);
      }
    }
    return rows;
  }

  /** Current-season discovery uses the empirically verified singular filter,
   * never the ignored plural/date history paths. */
  async listCurrentSeasonMatches(season: number): Promise<BdlUclMatch[]> {
    const rows = await super.listMatches({ season });
    validateUclHistoryCohort(rows, [season]);
    if (!rows.length) throw new UclSeasonCohortError(`BALLDONTLIE UCL current season ${season} returned no matches`);
    return dedupeValidatedUclMatches(rows, `season=${season}`);
  }

  /** BDL's documented plural and date filters currently ignore their values
   * for UCL. Production history therefore uses the empirically verified
   * singular parameter once per season, with strict returned-row validation.
   * This explicit deviation is telemetry-visible and never a silent fallback. */
  async listHistoricalMatches(seasons: number[]): Promise<{ matches: BdlUclMatch[]; telemetry: UclHistoryFetchTelemetry }> {
    const requestedSeasons = [...new Set(seasons)].sort((left, right) => left - right);
    if (!requestedSeasons.length) throw new Error("UCL historical matches require at least one season");
    const cohorts = await Promise.all(requestedSeasons.map(async (season) => {
      const rows = await super.listMatches({ season });
      validateCompleteUclHistoryCohort(rows, [season]);
      return rows;
    }));
    const matches = dedupeValidatedUclMatches(cohorts.flat(), "/matches");
    return {
      matches,
      telemetry: {
        status: "ready",
        strategy: "singular_season_provider_deviation",
        requestedSeasons,
        providerContractDeviation: UCL_HISTORY_PROVIDER_CONTRACT_DEVIATION,
        rowsBySeason: Object.fromEntries(requestedSeasons.map((season) => [String(season), matches.filter((row) => row.season === season).length])),
        rows: matches.length,
      },
    };
  }
}
