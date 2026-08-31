import type { NcaafGame, NcaafTeam } from "./balldontlieNcaafSlate";
import type { CfbForwardPlaybookLine, CfbForwardPlaybookSplit, CfbForwardPlaybookSplitSet } from "./cfbForwardEvidence";

type JsonRecord = Record<string, unknown>;

const CFB_PLAYBOOK_ALIASES_BY_BDL_TEAM_ID: Readonly<Record<number, readonly string[]>> = {
  75: ["Sam Houston State Bearkats"],
  123: ["Appalachian State Mountaineers"],
  133: ["Southern Mississippi Golden Eagles"],
  160: ["Albany"],
  188: ["Youngstown St Penguins"],
  191: ["LIU Sharks"],
  231: ["Citadel Bulldogs"],
  236: ["Houston Baptist Huskies"],
  240: ["Nicholls State Colonels"],
  242: ["Southeastern Louisiana Lions"],
};

export type CfbPlaybookMatchedEvidence = {
  eventId: string;
  lineRow: unknown;
  splitRow: unknown;
};

export function matchCfbPlaybookRow(game: NcaafGame, value: unknown): boolean {
  const row = record(value);
  const start = String(row.startTime ?? row.startTimeEst ?? "");
  return teamMatches(row.homeTeamName ?? row.homeTeam, game.home) &&
    teamMatches(row.awayTeamName ?? row.awayTeam, game.away) &&
    Number.isFinite(Date.parse(start)) &&
    Math.abs(Date.parse(start) - Date.parse(game.scheduledStart)) <= 3 * 60 * 60_000;
}

export function resolveCfbPlaybookRow(game: NcaafGame, values: readonly unknown[]): unknown | null {
  const matches = values.flatMap((value) => {
    if (!matchCfbPlaybookRow(game, value)) return [];
    const eventId = playbookEventId(value);
    return eventId ? [{ eventId, value }] : [];
  });
  const eventIds = new Set(matches.map((match) => match.eventId));
  return eventIds.size === 1 ? matches[0]!.value : null;
}

export function resolveCfbPlaybookEvidence(args: {
  game: NcaafGame;
  lines: readonly unknown[];
  splits: readonly unknown[];
}): CfbPlaybookMatchedEvidence | null {
  const lineRow = resolveCfbPlaybookRow(args.game, args.lines);
  const splitRow = resolveCfbPlaybookRow(args.game, args.splits);
  const lineEventId = playbookEventId(lineRow);
  const splitEventId = playbookEventId(splitRow);
  return lineRow && splitRow && lineEventId && lineEventId === splitEventId
    ? { eventId: lineEventId, lineRow, splitRow }
    : null;
}

export function normalizeCfbPlaybookLine(value: unknown, capturedAt: string): CfbForwardPlaybookLine | null {
  const row = record(value);
  const lines = record(row.lines);
  const spread = record(lines.spread);
  const moneyline = record(lines.moneyline);
  const result = { provider: "playbook" as const, capturedAt, sourceTier: text(row.lineSourceTier), homeMoneyline: number(moneyline.home), awayMoneyline: number(moneyline.away), homeSpread: number(spread.home), awaySpread: number(spread.away), total: number(lines.total) };
  return Object.values(result).some((item) => typeof item === "number") ? result : null;
}

export function normalizeCfbPlaybookSplits(value: unknown, capturedAt: string): CfbForwardPlaybookSplitSet | null {
  const row = record(value);
  const splits = record(row.splits);
  const sourceBooks = (market: JsonRecord) => integer(record(market.source).booksUsed);
  const binary = (marketName: string, first: string, second: string): CfbForwardPlaybookSplit => {
    const market = record(splits[marketName]);
    const bets = record(market.bets);
    const money = record(market.money);
    const firstCap = first[0]!.toUpperCase() + first.slice(1);
    const secondCap = second[0]!.toUpperCase() + second.slice(1);
    return { provider: "playbook", capturedAt, booksUsed: sourceBooks(market), homeMoneyPct: number(money[`${first}Percent`]), awayMoneyPct: number(money[`${second}Percent`]), homeBetsPct: number(bets[`${first}Percent`]), awayBetsPct: number(bets[`${second}Percent`]), overMoneyPct: firstCap === "Over" ? number(money.overPercent) : null, underMoneyPct: secondCap === "Under" ? number(money.underPercent) : null, overBetsPct: firstCap === "Over" ? number(bets.overPercent) : null, underBetsPct: secondCap === "Under" ? number(bets.underPercent) : null };
  };
  const moneyline = binary("moneyline", "home", "away");
  const spread = binary("spread", "home", "away");
  const total = binary("total", "over", "under");
  const normalizedTotal = { ...total, homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null };
  return [moneyline, spread, normalizedTotal].some((market) => Object.entries(market).some(([key, item]) => key.endsWith("Pct") && typeof item === "number")) ? { moneyline, spread, total: normalizedTotal } : null;
}

function teamMatches(value: unknown, team: NcaafTeam): boolean {
  const candidate = normalize(typeof value === "string" ? value : "");
  if (!candidate) return false;
  return [team.name, team.abbreviation, ...(CFB_PLAYBOOK_ALIASES_BY_BDL_TEAM_ID[team.id] ?? [])]
    .some((identity) => normalize(identity) === candidate);
}

function playbookEventId(value: unknown): string | null {
  const id = record(value).gameId;
  return typeof id === "string" && id.trim()
    ? id.trim()
    : typeof id === "number" && Number.isSafeInteger(id)
      ? String(id)
      : null;
}

function normalize(value: string): string { return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^hawai i\b/, "hawaii").replace(/^massachusetts\b/, "umass").replace(/^ualbany\b/, "albany"); }
function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function integer(value: unknown): number | null { const parsed = number(value); return parsed !== null && Number.isInteger(parsed) ? parsed : null; }

export const __TEST__ = { CFB_PLAYBOOK_ALIASES_BY_BDL_TEAM_ID, playbookEventId, teamMatches };
