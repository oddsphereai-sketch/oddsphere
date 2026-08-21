import type { FootballGameIdentity, FootballLeague } from "./footballModelContract";

export const FOOTBALL_AS_OF_DATASET_RELEASE = "football_asof_dataset_2026_08_19_r1" as const;

export type AsOfFeatureObservation = {
  feature: string;
  value: number | string | boolean | null;
  firstKnownAt: string;
  source: string;
  sourceRecordId: string | null;
};

export type AsOfFootballGame = {
  datasetRelease: typeof FOOTBALL_AS_OF_DATASET_RELEASE;
  identity: FootballGameIdentity;
  decisionTimestamp: string;
  observations: AsOfFeatureObservation[];
  final: {
    homeScore: number;
    awayScore: number;
    finalizedAt: string;
  } | null;
};

export type AsOfIntegrityFinding = {
  severity: "warning" | "blocking";
  code:
    | "invalid_timestamp"
    | "decision_after_kickoff"
    | "future_feature"
    | "future_final"
    | "league_mismatch";
  detail: string;
};

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function auditAsOfFootballGame(game: AsOfFootballGame): AsOfIntegrityFinding[] {
  const findings: AsOfIntegrityFinding[] = [];
  const decision = timestamp(game.decisionTimestamp);
  const kickoff = timestamp(game.identity.scheduledStart);
  if (decision === null || kickoff === null) {
    findings.push({ severity: "blocking", code: "invalid_timestamp", detail: "Decision and kickoff timestamps must be valid ISO timestamps." });
    return findings;
  }
  if (decision > kickoff) {
    findings.push({ severity: "blocking", code: "decision_after_kickoff", detail: "Pregame decision timestamp occurs after scheduled kickoff." });
  }
  for (const observation of game.observations) {
    const known = timestamp(observation.firstKnownAt);
    if (known === null) {
      findings.push({ severity: "blocking", code: "invalid_timestamp", detail: `Feature ${observation.feature} has an invalid first-known timestamp.` });
    } else if (known > decision) {
      findings.push({ severity: "blocking", code: "future_feature", detail: `Feature ${observation.feature} was first known after the decision timestamp.` });
    }
  }
  if (game.final) {
    const finalized = timestamp(game.final.finalizedAt);
    if (finalized === null) {
      findings.push({ severity: "blocking", code: "invalid_timestamp", detail: "Final score has an invalid finalized timestamp." });
    } else if (finalized <= decision) {
      findings.push({ severity: "blocking", code: "future_final", detail: "Final score is attached to an as-of view from before the game was finalized." });
    }
  }
  return findings;
}

export function buildPregameFeatureSnapshot(game: AsOfFootballGame): Map<string, AsOfFeatureObservation> {
  const blocking = auditAsOfFootballGame(game).filter((finding) => finding.severity === "blocking");
  if (blocking.length > 0) {
    throw new Error(`Cannot build as-of snapshot: ${blocking.map((finding) => finding.code).join(",")}`);
  }
  const decision = Date.parse(game.decisionTimestamp);
  const snapshot = new Map<string, AsOfFeatureObservation>();
  for (const observation of game.observations) {
    if (Date.parse(observation.firstKnownAt) > decision) continue;
    const prior = snapshot.get(observation.feature);
    if (!prior || Date.parse(observation.firstKnownAt) >= Date.parse(prior.firstKnownAt)) {
      snapshot.set(observation.feature, observation);
    }
  }
  return snapshot;
}

export type ExpandingWindowFold = {
  league: FootballLeague;
  testSeason: number;
  testSeasonPhase: AsOfFootballGame["identity"]["seasonPhase"];
  testWeek: number;
  train: AsOfFootballGame[];
  test: AsOfFootballGame[];
};

/** Build week-level forward folds. Test games from a week never enter training. */
export function buildFootballExpandingWindowFolds(args: {
  games: AsOfFootballGame[];
  league: FootballLeague;
  minimumTrainingGames: number;
}): ExpandingWindowFold[] {
  const rows = args.games
    .filter((game) => game.identity.league === args.league)
    .filter((game) => game.final !== null)
    .sort((a, b) => Date.parse(a.identity.scheduledStart) - Date.parse(b.identity.scheduledStart));
  const buckets = new Map<string, AsOfFootballGame[]>();
  for (const row of rows) {
    const key = `${row.identity.season}:${row.identity.seasonPhase}:${row.identity.week}`;
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const ordered = [...buckets.values()].sort((a, b) => Date.parse(a[0].identity.scheduledStart) - Date.parse(b[0].identity.scheduledStart));
  const folds: ExpandingWindowFold[] = [];
  const train: AsOfFootballGame[] = [];
  for (const test of ordered) {
    if (train.length >= args.minimumTrainingGames) {
      folds.push({
        league: args.league,
        testSeason: test[0].identity.season,
        testSeasonPhase: test[0].identity.seasonPhase,
        testWeek: test[0].identity.week,
        train: [...train],
        test: [...test],
      });
    }
    train.push(...test);
  }
  return folds;
}
