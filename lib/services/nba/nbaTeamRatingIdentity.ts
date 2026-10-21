import { normalizeBbrAbbr, type BbrTeamRatings } from "../../providers/real_api/_basketballReferenceClient";
import { normalizeTeamAbbr } from "../../providers/playbook/playbookTeamNormalizer";

export const NBA_TEAM_RATINGS_REFRESH_RELEASE =
  "nba_team_ratings_refresh_2026_10_21_r1_exact_team_identity_prior_recovery" as const;

export type NbaTeamRow = {
  id: number;
  abbreviation: string;
};

export type NbaTeamRatingPayload = {
  team_id: number;
  season: number;
  season_type: "regular" | "playoffs";
  off_rating: number | null;
  def_rating: number | null;
  net_rating: number | null;
  pace: number | null;
  off_efg_pct: number | null;
  off_tov_pct: number | null;
  off_orb_pct: number | null;
  off_ft_rate: number | null;
  def_efg_pct: number | null;
  def_tov_pct: number | null;
  def_drb_pct: number | null;
  def_ft_rate_allowed: number | null;
  source: string;
  source_url: string;
  fetched_at: string;
};

export function matchBbrRatingToNbaTeam(
  bbr: BbrTeamRatings,
  teamRows: readonly NbaTeamRow[],
): NbaTeamRow | null {
  const canonicalBbrAbbr = normalizeTeamAbbr("nba", normalizeBbrAbbr(bbr.abbreviation));
  if (canonicalBbrAbbr === null) return null;
  const matches = teamRows.filter(
    (team) => normalizeTeamAbbr("nba", team.abbreviation) === canonicalBbrAbbr,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function buildNbaTeamRatingPayload(
  row: BbrTeamRatings,
  team: NbaTeamRow,
  season: number,
  seasonType: "regular" | "playoffs",
): NbaTeamRatingPayload {
  return {
    team_id: team.id,
    season,
    season_type: seasonType,
    off_rating: row.off_rating,
    def_rating: row.def_rating,
    net_rating: row.net_rating,
    pace: row.pace,
    off_efg_pct: row.off_efg_pct,
    off_tov_pct: row.off_tov_pct,
    off_orb_pct: row.off_orb_pct,
    off_ft_rate: row.off_ft_rate,
    def_efg_pct: row.def_efg_pct,
    def_tov_pct: row.def_tov_pct,
    def_drb_pct: row.def_drb_pct,
    def_ft_rate_allowed: row.def_ft_rate_allowed,
    source: "basketball-reference",
    source_url: row.source_url,
    fetched_at: row.fetched_at,
  };
}
