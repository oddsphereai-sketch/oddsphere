import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import cfbArtifactJson from "./modelArtifacts/cfbV1WeeklyRuntimeArtifact.json";
import nflArtifactJson from "./modelArtifacts/nflR6MoneylineShadow.json";

export type FootballEvidenceMarket = "moneyline" | "spread" | "total";

type NflMetricBucket = Record<string, number>;
type NflTeamState = {
  offAdjusted: NflMetricBucket;
  defAdjusted: NflMetricBucket;
  elo: number;
};
type NflArtifact = {
  generatedAt: string;
  artifactRelease: string;
  teamStates: Record<string, NflTeamState>;
};
type CfbTeamProfile = {
  displayName: string;
  elo: number;
  lastPlayedAt: string | null;
  priorGames: number;
  rolling: Record<string, number | null>;
};
type CfbArtifact = {
  generatedAt: string;
  artifactRelease: string;
  teamProfiles: Record<string, CfbTeamProfile>;
};

const nflArtifact = nflArtifactJson as unknown as NflArtifact;
const cfbArtifact = cfbArtifactJson as unknown as CfbArtifact;

export function nflFootballEvidenceStats(args: {
  awayTeam: string;
  homeTeam: string;
  market: FootballEvidenceMarket;
  awayQuarterback: { name: string | null; status: "confirmed" | "projected" | "unknown" };
  homeQuarterback: { name: string | null; status: "confirmed" | "projected" | "unknown" };
  weather: {
    venueName: string;
    roofType: "outdoor" | "retractable" | "fixed";
    status: string;
    forecast: { temperature_f: number | null; wind_speed_mph: number | null; conditions: string | null } | null;
  };
}): MarketEdgeDto["keyStats"] {
  const away = nflArtifact.teamStates[nflArtifactTeam(args.awayTeam)];
  const home = nflArtifact.teamStates[nflArtifactTeam(args.homeTeam)];
  if (!away || !home) return currentNflContext(args);
  const modelRows = args.market === "total"
    ? [
        row("Decision-model input · Offensive plays per game", fixed(away.offAdjusted.plays, 1), fixed(home.offAdjusted.plays, 1)),
        row("Decision-model input · Explosive-play rate", percent(away.offAdjusted.explosive_rate), percent(home.offAdjusted.explosive_rate)),
        row("Decision-model input · Red-zone touchdown rate", percent(away.offAdjusted.redzone_td_rate), percent(home.offAdjusted.redzone_td_rate)),
        row("Decision-model input · Prior scoring profile", `${fixed(away.offAdjusted.points, 1)} scored`, `${fixed(home.offAdjusted.points, 1)} scored`),
      ]
    : args.market === "spread"
      ? [
          row("Decision-model input · Opponent-adjusted offense EPA/play", signed(away.offAdjusted.epa, 3), signed(home.offAdjusted.epa, 3)),
          row("Decision-model input · Opponent-adjusted defense EPA/play allowed", signed(away.defAdjusted.epa, 3), signed(home.defAdjusted.epa, 3)),
          row("Decision-model input · Sack rate allowed", percent(away.offAdjusted.sack_rate), percent(home.offAdjusted.sack_rate)),
          row("Decision-model input · Team strength rating", fixed(away.elo, 0), fixed(home.elo, 0)),
        ]
      : [
          row("Decision-model input · Opponent-adjusted offense EPA/play", signed(away.offAdjusted.epa, 3), signed(home.offAdjusted.epa, 3)),
          row("Decision-model input · Opponent-adjusted success rate", percent(away.offAdjusted.success), percent(home.offAdjusted.success)),
          row("Decision-model input · Early-down pass efficiency", signed(away.offAdjusted.early_down_pass_epa, 3), signed(home.offAdjusted.early_down_pass_epa, 3)),
          row("Decision-model input · Team strength rating", fixed(away.elo, 0), fixed(home.elo, 0)),
        ];
  return [
    ...modelRows,
    row("Decision-model input · Frozen sample", nflSampleLabel(), nflSampleLabel()),
    ...currentNflContext(args),
  ];
}

export function cfbFootballEvidenceStats(args: {
  awayTeamName: string;
  homeTeamName: string;
  market: FootballEvidenceMarket;
  awayQuarterback: { name: string | null; status: "projected" | "unknown" };
  homeQuarterback: { name: string | null; status: "projected" | "unknown" };
}): MarketEdgeDto["keyStats"] {
  const away = cfbArtifact.teamProfiles[normalizeTeam(args.awayTeamName)];
  const home = cfbArtifact.teamProfiles[normalizeTeam(args.homeTeamName)];
  if (!away || !home) return [quarterbackRow(args.awayQuarterback, args.homeQuarterback)];
  const modelRows = args.market === "total"
    ? [
        row("Outcome-model input · Prior scoring profile", scoringProfile(away), scoringProfile(home)),
        row("Outcome-model input · Offensive plays per game", fixedMetric(away, "pace", 1), fixedMetric(home, "pace", 1)),
        row("Outcome-model input · Explosive-play rate", percentMetric(away, "explosive"), percentMetric(home, "explosive")),
        row("Outcome-model input · Red-zone success rate", percentMetric(away, "red_zone_success"), percentMetric(home, "red_zone_success")),
      ]
    : args.market === "spread"
      ? [
          row("Outcome-model input · Prior scoring margin", signedMetric(away, "margin", 1), signedMetric(home, "margin", 1)),
          row("Outcome-model input · EPA/play", signedMetric(away, "epa_play", 3), signedMetric(home, "epa_play", 3)),
          row("Outcome-model input · Line yards per carry", fixedMetric(away, "line_yards", 2), fixedMetric(home, "line_yards", 2)),
          row("Outcome-model input · Team strength rating", fixed(away.elo, 0), fixed(home.elo, 0)),
        ]
      : [
          row("Outcome-model input · EPA/play", signedMetric(away, "epa_play", 3), signedMetric(home, "epa_play", 3)),
          row("Outcome-model input · Success rate", percentMetric(away, "success"), percentMetric(home, "success")),
          row("Outcome-model input · Early-down efficiency", signedMetric(away, "early_epa", 3), signedMetric(home, "early_epa", 3)),
          row("Outcome-model input · Team strength rating", fixed(away.elo, 0), fixed(home.elo, 0)),
        ];
  return [
    ...modelRows,
    row("Outcome-model input · Frozen sample", sampleLabel(away), sampleLabel(home)),
    quarterbackRow(args.awayQuarterback, args.homeQuarterback),
  ];
}

function currentNflContext(args: Parameters<typeof nflFootballEvidenceStats>[0]): MarketEdgeDto["keyStats"] {
  return [
    quarterbackRow(args.awayQuarterback, args.homeQuarterback),
    { label: "Current context · Venue and weather", awayValue: null, homeValue: weatherLabel(args.weather), source: "feature_snapshot" },
  ];
}

function quarterbackRow(
  away: { name: string | null; status: string },
  home: { name: string | null; status: string },
): MarketEdgeDto["keyStats"][number] {
  return row(
    "Current context · Expected quarterback",
    `${away.name ?? "Quarterback TBD"} · ${titleCase(away.status)}`,
    `${home.name ?? "Quarterback TBD"} · ${titleCase(home.status)}`,
  );
}

function weatherLabel(weather: Parameters<typeof nflFootballEvidenceStats>[0]["weather"]): string {
  if (weather.status === "controlled_indoor" || weather.roofType === "fixed") return `${weather.venueName} · controlled indoor`;
  if (!weather.forecast) return `${weather.venueName} · ${weather.status.replaceAll("_", " ")}`;
  const detail = [
    weather.forecast.conditions,
    weather.forecast.temperature_f === null ? null : `${Math.round(weather.forecast.temperature_f)}°F`,
    weather.forecast.wind_speed_mph === null ? null : `${Math.round(weather.forecast.wind_speed_mph)} mph wind`,
  ].filter(Boolean).join(" · ");
  return `${weather.venueName} · ${detail}`;
}

function row(label: string, awayValue: string, homeValue: string): MarketEdgeDto["keyStats"][number] {
  return { label, awayValue, homeValue, source: "feature_snapshot" };
}

function nflArtifactTeam(value: string): string {
  const team = value.trim().toUpperCase();
  return ({ LAR: "LA", WSH: "WAS" } as Record<string, string>)[team] ?? team;
}

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
}

function value(profile: CfbTeamProfile, metric: string): number | null {
  const result = profile.rolling[metric];
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

function fixedMetric(profile: CfbTeamProfile, metric: string, digits: number): string {
  const result = value(profile, metric);
  return result === null ? "Unavailable" : fixed(result, digits);
}

function signedMetric(profile: CfbTeamProfile, metric: string, digits: number): string {
  const result = value(profile, metric);
  return result === null ? "Unavailable" : signed(result, digits);
}

function percentMetric(profile: CfbTeamProfile, metric: string): string {
  const result = value(profile, metric);
  return result === null ? "Unavailable" : percent(result);
}

function scoringProfile(profile: CfbTeamProfile): string {
  const scored = value(profile, "points_for");
  const allowed = value(profile, "points_against");
  return scored === null || allowed === null ? "Unavailable" : `${scored.toFixed(1)} scored · ${allowed.toFixed(1)} allowed`;
}

function sampleLabel(profile: CfbTeamProfile): string {
  const date = profile.lastPlayedAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(profile.lastPlayedAt))
    : "date unavailable";
  return `${profile.priorGames} prior games · through ${date}`;
}

function nflSampleLabel(): string {
  const frozen = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(nflArtifact.generatedAt));
  return `Completed 2025 profile · frozen ${frozen}`;
}

function percent(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "Unavailable" : `${(value * 100).toFixed(1)}%`;
}

function fixed(value: number | undefined, digits: number): string {
  return value === undefined || !Number.isFinite(value) ? "Unavailable" : value.toFixed(digits);
}

function signed(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) return "Unavailable";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const __FOOTBALL_MEMBER_EVIDENCE_TEST__ = {
  cfbArtifactRelease: cfbArtifact.artifactRelease,
  nflArtifactRelease: nflArtifact.artifactRelease,
};
