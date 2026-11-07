import type { Evidence, Json, Sport } from "./evidenceContract";
import { stable } from "./evidence";

const object = (value: Json | undefined): Record<string, Json> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const team = (value: Json | undefined) => {
  const key = String(value ?? "").toUpperCase();
  return ({ JAC: "JAX", WSH: "WAS", LA: "LAR" } as Record<string, string>)[key] ?? key;
};
const NFL_FIELDS: Record<string, string[]> = {
  passing_attempts: ["passing_attempts", "attempts"],
  passing_completions: ["passing_completions", "completions"],
  passing_yards: ["passing_yards"], passing_tds: ["passing_tds", "passing_touchdowns"],
  interceptions: ["passing_interceptions", "interceptions"],
  rushing_attempts: ["rushing_attempts", "carries"], rushing_yards: ["rushing_yards"],
  receiving_targets: ["receiving_targets", "targets"], receptions: ["receptions"],
  receiving_yards: ["receiving_yards"], rushing_tds: ["rushing_tds", "rushing_touchdowns"],
  receiving_tds: ["receiving_tds", "receiving_touchdowns"],
};
const NBA_FIELDS = Object.fromEntries(["minutes", "points", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast"].map(key => [key, [key]]));

/** Multiple provider IDs for the same game must not become extra recent games. */
export function readerLogWindows(sport: Sport, logs: Evidence[], cutoff?: string) {
  const fields = sport === "nba" ? NBA_FIELDS : NFL_FIELDS;
  const games = new Map<string, { at: number; sources: string[]; values: Record<string, Set<number>> }>();
  for (const evidence of logs) {
    const value = object(evidence.value), game = object(value.game), box = object(value.box);
    const at = Date.parse(String(game.startTime ?? game.start ?? game.scheduledStart ?? box.scheduledStart ?? ""));
    // Equal start time and both team identities establish a cross-provider game join.
    // Incomplete identity stays separate; it cannot silently collapse two games.
    const home = team(game.homeTeam ?? game.home), away = team(game.awayTeam ?? game.away);
    const key = Number.isFinite(at) && home && away ? stable([at, home, away]) : `source:${evidence.id}`;
    const row = games.get(key) ?? { at: Number.isFinite(at) ? at : 0, sources: [], values: {} };
    row.sources.push(evidence.id);
    for (const [field, aliases] of Object.entries(fields)) {
      for (const alias of aliases) {
        const n = box[alias];
        if (typeof n === "number" && Number.isFinite(n)) (row.values[field] ??= new Set()).add(n);
      }
    }
    games.set(key, row);
  }
  const ordered = [...games.values()].sort((a, b) => b.at - a.at);
  const active = ordered.filter(row => sport !== "nba" || [...(row.values.minutes ?? [])].some(n => n > 0) ||
    ["points", "fgm", "fg3m", "ftm", "oreb", "dreb", "ast"].some(key => [...(row.values[key] ?? [])].some(n => n > 0)));
  const conflicts = ordered.flatMap(row => Object.entries(row.values).filter(([, values]) => values.size > 1).map(([field, values]) => ({
    sourceIds: row.sources, field, recordedValues: [...values],
  })));
  const windows = Object.fromEntries([1, 3, 5, 10].map(n => {
    const rows = active.slice(0, n);
    return [`last${n}`, { records: rows.length, statistics: Object.fromEntries(Object.keys(fields).flatMap(field => {
      const values = rows.flatMap(row => row.values[field]?.size === 1 ? [...row.values[field]] : []);
      return values.length ? [[field, { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length }]] : [];
    })) }];
  }));
  return {
    recordedSourceRows: logs.length, distinctGames: ordered.length, summarizedGames: active.length,
    newestGameAt:ordered[0]?.at?new Date(ordered[0].at).toISOString():null,
    oldestGameAt:ordered.at(-1)?.at?new Date(ordered.at(-1)!.at).toISOString():null,
    newestGameAgeDays:cutoff&&ordered[0]?.at?(Date.parse(cutoff)-ordered[0].at)/86400000:null,
    newestQualifyingGameAgeDays:cutoff&&active[0]?.at?(Date.parse(cutoff)-active[0].at)/86400000:null,
    windows, conflicts,
    denominator: sport === "nba"
      ? "Distinct games with positive minutes or nonzero recorded production; zero/unknown participation rows remain in raw evidence, excluded from conditional summaries"
      : "Distinct recorded player-game rows; zero production does not establish nonparticipation",
    reconciliation: "Equivalent team/start identities join provider aliases. Conflicting field values are reported and excluded from that field's means; no arbitrary provider winner.",
  };
}
