import type { NflPreviewTeam } from "./balldontlieNflPreviewSlate";
import type {
  NflForwardRosterPlayer,
  NflForwardTeamDepthSnapshot,
} from "./nflForwardEvidence";

type JsonRecord = Record<string, unknown>;

const ROSTER_CONCURRENCY = 4;

export async function fetchBalldontlieNflTeamDepthSnapshots(args: {
  teams: NflPreviewTeam[];
  season: number;
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<{ byTeam: Record<string, NflForwardTeamDepthSnapshot>; requests: number }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const teams = [...new Map(args.teams.map((team) => [team.id, team])).values()];
  const byTeam: Record<string, NflForwardTeamDepthSnapshot> = {};
  let requests = 0;
  for (let index = 0; index < teams.length; index += ROSTER_CONCURRENCY) {
    await Promise.all(teams.slice(index, index + ROSTER_CONCURRENCY).map(async (team) => {
      requests += 1;
      const url = new URL(`https://api.balldontlie.io/nfl/v1/teams/${team.id}/roster`);
      url.searchParams.set("season", String(args.season));
      const response = await fetchImpl(url, {
        headers: { Authorization: args.apiKey, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`BALLDONTLIE NFL roster failed for ${team.abbreviation} with HTTP ${response.status}.`);
      const body = await response.json() as { data?: unknown };
      if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE NFL roster was malformed for ${team.abbreviation}.`);
      byTeam[team.abbreviation] = buildTeamDepthSnapshot({
        team: team.abbreviation,
        capturedAt: args.capturedAt,
        sourceSnapshotId: null,
        rows: body.data,
      });
    }));
  }
  return { byTeam, requests };
}

export function buildTeamDepthSnapshot(args: {
  team: string;
  capturedAt: string;
  sourceSnapshotId: string | null;
  rows: unknown[];
}): NflForwardTeamDepthSnapshot {
  const roster = args.rows
    .map(normalizeRosterPlayer)
    .filter((player): player is NflForwardRosterPlayer => player !== null)
    .sort(comparePlayers);
  const quarterbackDepth = roster.filter((player) => player.position === "QB");
  const confirmed = quarterbackDepth.find((player) => player.explicitStarter) ?? null;
  const projected = quarterbackDepth.find((player) => player.depthRank === 1) ?? null;
  return {
    provider: "balldontlie",
    team: args.team,
    capturedAt: args.capturedAt,
    sourceSnapshotId: args.sourceSnapshotId,
    starterStatus: confirmed ? "confirmed" : projected ? "projected" : "unknown",
    expectedStartingQuarterback: confirmed ?? projected ?? quarterbackDepth[0] ?? null,
    quarterbackDepth,
    roster,
  };
}

function normalizeRosterPlayer(value: unknown): NflForwardRosterPlayer | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as JsonRecord;
  const nested = row.player !== null && typeof row.player === "object" ? row.player as JsonRecord : {};
  const first = text(nested.first_name);
  const last = text(nested.last_name);
  const name = text(row.player_name) ?? [first, last].filter(Boolean).join(" ");
  if (!name) return null;
  const rawPosition = text(nested.position_abbreviation) ?? text(nested.position) ?? text(row.position);
  const rawDepth = text(row.depth) ?? text(row.depth_position) ?? numberText(row.depth);
  return {
    playerId: id(nested.id ?? row.player_id),
    name,
    position: normalizePosition(rawPosition),
    depth: rawDepth,
    depthRank: depthRank(rawDepth),
    injuryStatus: text(row.injury_status) ?? text(row.status),
    explicitStarter: row.starter === true || row.is_starter === true,
  };
}

function comparePlayers(first: NflForwardRosterPlayer, second: NflForwardRosterPlayer): number {
  const position = (first.position ?? "ZZ").localeCompare(second.position ?? "ZZ");
  if (position !== 0) return position;
  const depth = (first.depthRank ?? 99) - (second.depthRank ?? 99);
  return depth !== 0 ? depth : first.name.localeCompare(second.name);
}

function normalizePosition(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "QUARTERBACK" ? "QB" : normalized;
}

function depthRank(value: string | null): number | null {
  const parsed = value?.match(/\d+/)?.[0];
  return parsed ? Number(parsed) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberText(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}
