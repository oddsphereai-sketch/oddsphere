import type { SupabaseClient } from "@supabase/supabase-js";

export const CFB_CURRENT_ADVANCED_STATE_RELEASE =
  "cfb_current_advanced_state_2026_10_01_r2_deterministic_primary_passer" as const;
export const CFB_CURRENT_ADVANCED_REFRESH_HOURS = 12 as const;

const BASE = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download";
const SOURCES = [
  ["adv_team", "espn_cfb_adv_team", "adv_team"],
  ["adv_situational", "espn_cfb_adv_situational", "adv_situational"],
  ["adv_drives", "espn_cfb_adv_drives", "adv_drives"],
  ["adv_turnover", "espn_cfb_adv_turnover", "adv_turnover"],
  ["adv_passing", "espn_cfb_adv_passing", "adv_passing"],
  ["schedules", "espn_cfb_schedules", "cfb_schedule"],
] as const;

export type CfbCurrentAdvancedMetrics = Record<string, number | null>;

export type CfbCurrentAdvancedGame = {
  sourceGameId: string;
  season: number;
  week: number;
  scheduledStart: string;
  neutralSite: boolean;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeMetrics: CfbCurrentAdvancedMetrics;
  awayMetrics: CfbCurrentAdvancedMetrics;
};

export type CfbCurrentAdvancedState = {
  release: typeof CFB_CURRENT_ADVANCED_STATE_RELEASE;
  season: number;
  updatedAt: string;
  games: CfbCurrentAdvancedGame[];
};

export type CfbCurrentAdvancedRefresh = {
  state: CfbCurrentAdvancedState | null;
  refreshed: boolean;
  requests: number;
  error: string | null;
};

type Row = Record<string, string>;

export async function readCfbCurrentAdvancedState(args: {
  client: SupabaseClient;
  season: number;
}): Promise<CfbCurrentAdvancedState | null> {
  const { data, error } = await args.client
    .from("lab_response_snapshots")
    .select("payload")
    .eq("snapshot_key", snapshotKey(args.season))
    .maybeSingle();
  if (error) throw new Error(`CFB current advanced-state read failed: ${error.message}`);
  return parseState(data?.payload, args.season);
}

export async function loadCfbCurrentAdvancedState(args: {
  client: SupabaseClient;
  season: number;
  now: string;
  apply: boolean;
  fetchImpl?: typeof fetch;
}): Promise<CfbCurrentAdvancedRefresh> {
  const previous = await readCfbCurrentAdvancedState(args);
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) throw new Error("CFB current advanced-state time is invalid.");
  const previousMs = previous ? Date.parse(previous.updatedAt) : NaN;
  if (previous && Number.isFinite(previousMs) && nowMs - previousMs < CFB_CURRENT_ADVANCED_REFRESH_HOURS * 3_600_000) {
    return { state: previous, refreshed: false, requests: 0, error: null };
  }
  try {
    const state = await fetchCfbCurrentAdvancedState({
      season: args.season,
      now: args.now,
      fetchImpl: args.fetchImpl,
    });
    if (args.apply) await writeCfbCurrentAdvancedState({ client: args.client, state });
    return { state, refreshed: true, requests: SOURCES.length, error: null };
  } catch (error) {
    return {
      state: previous,
      refreshed: false,
      requests: SOURCES.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function fetchCfbCurrentAdvancedState(args: {
  season: number;
  now: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbCurrentAdvancedState> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const rows = await Promise.all(SOURCES.map(async ([name, tag, asset]) => {
    const url = `${BASE}/${tag}/${asset}_${args.season}.csv`;
    const response = await fetchImpl(url, { headers: { "User-Agent": "OddSphere-CFB-runtime" } });
    if (!response.ok) throw new Error(`CFB ${name} source failed with HTTP ${response.status}.`);
    return [name, parseCsv(await response.text())] as const;
  }));
  const bySource = Object.fromEntries(rows) as Record<(typeof SOURCES)[number][0], Row[]>;
  const byTeamGame = (source: Row[]) => new Map(source.map((row) => [metricKey(row.game_id, row.pos_team), row]));
  const adv = byTeamGame(bySource.adv_team);
  const situational = byTeamGame(bySource.adv_situational);
  const drives = byTeamGame(bySource.adv_drives);
  const turnover = byTeamGame(bySource.adv_turnover);
  const passing = new Map<string, Row>();
  for (const row of bySource.adv_passing) {
    const key = metricKey(row.game_id, row.pos_team);
    const incumbent = passing.get(key);
    const attempts = number(row.Att);
    const incumbentAttempts = number(incumbent?.Att);
    if (
      !incumbent || attempts > incumbentAttempts ||
      (attempts === incumbentAttempts && normalizeName(row.passer_player_name ?? "") > normalizeName(incumbent.passer_player_name ?? ""))
    ) passing.set(key, row);
  }
  const metricsFor = (gameId: string, team: string): CfbCurrentAdvancedMetrics => {
    const key = metricKey(gameId, team);
    const teamRow = adv.get(key) ?? {};
    const situation = situational.get(key) ?? {};
    const drive = drives.get(key) ?? {};
    const turnovers = turnover.get(key) ?? {};
    const passer = passing.get(key) ?? {};
    const plays = nullableNumber(teamRow.scrimmage_plays);
    const specialPlays = nullableNumber(teamRow.special_teams_plays);
    const attempts = nullableNumber(passer.Att);
    return {
      epa_play: nullableNumber(teamRow.EPA_per_play),
      pass_epa: nullableNumber(teamRow.EPA_passing_per_play),
      rush_epa: nullableNumber(teamRow.EPA_rushing_per_play),
      explosive: nullableNumber(teamRow.EPA_explosive_rate),
      success: nullableNumber(teamRow.first_downs_created_rate),
      early_epa: nullableNumber(situation.EPA_early_down_per_play),
      early_success: nullableNumber(situation.EPA_success_early_down_rate),
      red_zone_success: nullableNumber(situation.EPA_success_rate_rz),
      third_success: nullableNumber(situation.EPA_success_rate_third),
      pace: plays,
      drives: nullableNumber(drive.drives),
      yards_drive: nullableNumber(drive.yards_per_drive),
      field_position: nullableNumber(drive.avg_field_position),
      line_yards: nullableNumber(teamRow.line_yards_per_carry),
      stuff_rate: nullableNumber(teamRow.rushing_stuff_rate),
      opportunity_rate: nullableNumber(teamRow.rushing_opportunity_rate),
      special_teams_epa: ratio(nullableNumber(teamRow.EPA_special_teams), specialPlays),
      penalty_yards: ratio(nullableNumber(teamRow.penalty_yards), plays),
      expected_turnovers: nullableNumber(turnovers.expected_turnovers),
      turnover_luck: nullableNumber(turnovers.turnover_luck),
      qb_epa: ratio(nullableNumber(passer.qbr_epa), attempts),
      qb_success: nullableNumber(passer.SR_qb ?? passer.SR),
    };
  };
  const games = bySource.schedules.flatMap((row): CfbCurrentAdvancedGame[] => {
    if (!/FINAL/i.test(row.status ?? "")) return [];
    const homeScore = nullableNumber(row.home_score);
    const awayScore = nullableNumber(row.away_score);
    if (homeScore === null || awayScore === null || !row.home_team || !row.away_team || !row.game_date) return [];
    return [{
      sourceGameId: row.game_id,
      season: Math.trunc(number(row.season)),
      week: Math.trunc(number(row.week)),
      scheduledStart: new Date(row.game_date).toISOString(),
      neutralSite: /^true$/i.test(row.neutral_site ?? ""),
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore,
      awayScore,
      homeMetrics: metricsFor(row.game_id, row.home_team),
      awayMetrics: metricsFor(row.game_id, row.away_team),
    }];
  }).filter((game) => game.season === args.season)
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.sourceGameId.localeCompare(second.sourceGameId));
  if (games.length < 100) throw new Error(`CFB current advanced-state coverage is implausibly low (${games.length} games).`);
  return { release: CFB_CURRENT_ADVANCED_STATE_RELEASE, season: args.season, updatedAt: args.now, games };
}

export async function writeCfbCurrentAdvancedState(args: {
  client: SupabaseClient;
  state: CfbCurrentAdvancedState;
}): Promise<void> {
  const { error } = await args.client.from("lab_response_snapshots").upsert({
    snapshot_key: snapshotKey(args.state.season),
    kind: "daily_edge",
    sport: "cfb",
    slate_date: null,
    payload: args.state,
    payload_version: CFB_CURRENT_ADVANCED_STATE_RELEASE,
    source: CFB_CURRENT_ADVANCED_STATE_RELEASE,
    generated_at: args.state.updatedAt,
    expires_at: new Date(Date.parse(args.state.updatedAt) + 370 * 86_400_000).toISOString(),
    stale_until: new Date(Date.parse(args.state.updatedAt) + 370 * 86_400_000).toISOString(),
    updated_at: args.state.updatedAt,
  }, { onConflict: "snapshot_key" });
  if (error) throw new Error(`CFB current advanced-state write failed: ${error.message}`);
}

function parseState(value: unknown, season: number): CfbCurrentAdvancedState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<CfbCurrentAdvancedState>;
  return state.release === CFB_CURRENT_ADVANCED_STATE_RELEASE && state.season === season &&
    typeof state.updatedAt === "string" && Array.isArray(state.games)
    ? state as CfbCurrentAdvancedState
    : null;
}

function snapshotKey(season: number): string {
  return `cfb:current-advanced:${season}:${CFB_CURRENT_ADVANCED_STATE_RELEASE}`;
}

function metricKey(gameId: string | undefined, team: string | undefined): string {
  return `${gameId ?? ""}:${normalizeName(team ?? "")}`;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replaceAll("'", "").replaceAll(".", "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ");
}

function number(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "" || /^(nan|null|na)$/i.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator !== null && denominator !== null && Math.abs(denominator) > 1e-9 ? numerator / denominator : null;
}

function parseCsv(input: string): Row[] {
  const cells: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); cells.push(row); row = []; cell = ""; }
    else cell += character;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell.replace(/\r$/, "")); cells.push(row); }
  const headers = cells.shift() ?? [];
  return cells.filter((values) => values.some((value) => value.length > 0)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}
