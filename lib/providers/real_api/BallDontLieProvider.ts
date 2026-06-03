/**
 * BallDontLieProvider — IPlayerStatsProvider implementation backed by the
 * Ball Don't Lie MLB GOAT API. Phase 1 (Gate B.1).
 *
 * Verified by Gate A probe (scripts/probe-balldontlie.ts) — endpoint paths,
 * field names with `pitching_*` / `batting_*` prefixes, paginated meta
 * cursor, and 600/window quota all confirmed live.
 *
 * Discipline:
 *   • No DB imports — pure data transform from BDL API to provider records
 *   • No service imports
 *   • Constructor takes the API key only (key never logged)
 *   • Defensive nulls for every optional field — never throws on partial data
 *   • NotFound on getPlayer → null (caller's expected contract)
 *   • Empty list when an endpoint returns no rows
 */

import type { Sport } from "../../types/domain/Sport";
import type { BatsHand, ThrowsHand } from "../../types/domain/Player";
import type {
  IPlayerStatsProvider,
  StatsPlayerRecord,
  StatsLineupRecord,
  StatsInjuryRecord,
  StatsSeasonRecord,
  StatsSplitRecord,
  PitcherPitchRecord,
  HitterPitchRecord,
} from "../interfaces/IPlayerStatsProvider";
import { BdlClient, BdlNotFoundError } from "./_bdlClient";

// ─────────────────────────────────────────────────────────────
// Internal raw shapes (loose — BDL may add fields; we read what we need)
// ─────────────────────────────────────────────────────────────

/**
 * Raw BDL /players row.
 *
 * Phase 4.2.C.1.M correction — the BDL MLB API actually returns:
 *   • `dob` (string, MM/DD/YY)
 *   • `age` (number)
 *   • `birth_place` (single string, e.g. "Linden, CA")
 *   • `bats_throws` (combined string, e.g. "R/R")
 * The old field names below (`birth_date`, `birth_city/state/country`,
 * separate `bats`/`throws`) were never populated by BDL. Kept as optional
 * here only as defensive aliases — if BDL ever adds them, we still read
 * them as a fallback.
 */
type RawPlayer = {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  jersey?: string | null;
  dob?: string | null;
  age?: number | null;
  birth_place?: string | null;
  bats_throws?: string | null;
  height?: string | null;
  weight?: string | number | null;
  debut_year?: number | null;
  draft?: string | null;
  team?: { id?: number; abbreviation?: string | null } | null;
  team_id?: number | null;
  active?: boolean | null;
  // Legacy / defensive aliases (BDL may add these in future).
  birth_date?: string | null;
  birth_city?: string | null;
  birth_state?: string | null;
  birth_country?: string | null;
  bats?: string | null;
  throws?: string | null;
  draft_round?: number | null;
  draft_pick?: number | null;
  draft_year?: number | null;
};

type RawSeasonStats = {
  player_id: number;
  team_id?: number | null;
  season: number;
  season_type?: string | null;
  postseason?: boolean | null;
  // batting
  batting_gp?: number | null;
  batting_ab?: number | null;
  batting_r?: number | null;
  batting_h?: number | null;
  batting_avg?: number | null;
  batting_2b?: number | null;
  batting_3b?: number | null;
  batting_hr?: number | null;
  batting_rbi?: number | null;
  batting_tb?: number | null;
  batting_bb?: number | null;
  batting_so?: number | null;
  batting_sb?: number | null;
  batting_obp?: number | null;
  batting_slg?: number | null;
  batting_ops?: number | null;
  batting_war?: number | null;
  batting_pa?: number | null;
  batting_hbp?: number | null;
  batting_sf?: number | null;
  // pitching
  pitching_gp?: number | null;
  pitching_gs?: number | null;
  pitching_qs?: number | null;
  pitching_w?: number | null;
  pitching_l?: number | null;
  pitching_era?: number | null;
  pitching_sv?: number | null;
  pitching_hld?: number | null;
  pitching_ip?: number | null;
  pitching_h?: number | null;
  pitching_er?: number | null;
  pitching_hr?: number | null;
  pitching_bb?: number | null;
  pitching_whip?: number | null;
  pitching_k?: number | null;
  pitching_k_per_9?: number | null;
  pitching_war?: number | null;
};

type RawSplit = {
  player_id: number;
  season: number;
  split_type?: string | null;
  ab?: number | null;
  h?: number | null;
  avg?: number | null;
  obp?: number | null;
  slg?: number | null;
  ops?: number | null;
  hr?: number | null;
  rbi?: number | null;
  so?: number | null;
  bb?: number | null;
  tb?: number | null;
  pa?: number | null;
};

type RawPitcherPitch = {
  player_id: number;
  season: number;
  pitch_type?: string | null;
  count?: number | null;
  pct_of_total?: number | null;
  avg_velo_mph?: number | null;
  whiff_rate?: number | null;
  k_rate?: number | null;
  contact_rate?: number | null;
};

type RawHitterPitch = {
  player_id: number;
  season: number;
  pitch_type?: string | null;
  pa?: number | null;
  ab?: number | null;
  h?: number | null;
  hr?: number | null;
  so?: number | null;
  bb?: number | null;
  avg?: number | null;
  slg?: number | null;
  ops?: number | null;
  whiff_rate?: number | null;
  contact_rate?: number | null;
};

type RawLineup = {
  game_id: number;
  team_id: number;
  player_id: number;
  batting_order?: number | null;
  position?: string | null;
  is_confirmed?: boolean | null;
  is_dh?: boolean | null;
};

type RawInjury = {
  player?: { id?: number } | null;
  player_id?: number | null;
  injury_date?: string | null;
  return_date?: string | null;
  type?: string | null;
  detail?: string | null;
  side?: string | null;
  status?: string | null;
  long_comment?: string | null;
  short_comment?: string | null;
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asBoolOrFalse(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * BDL returns position strings like "Pitcher", "Starting Pitcher",
 * "Catcher", "First Base", "Shortstop", etc. Map to the short codes the
 * downstream code uses ("P", "SP", "RP", "C", "1B", "SS", ...).
 */
function shortPositionAbbr(position: string | null): string | null {
  if (position === null) return null;
  const p = position.toLowerCase();
  if (p.includes("starting pitcher")) return "SP";
  if (p.includes("relief pitcher")) return "RP";
  if (p.includes("pitcher")) return "P";
  if (p.includes("catcher")) return "C";
  if (p.includes("first base")) return "1B";
  if (p.includes("second base")) return "2B";
  if (p.includes("third base")) return "3B";
  if (p.includes("shortstop")) return "SS";
  if (p.includes("left field")) return "LF";
  if (p.includes("center field")) return "CF";
  if (p.includes("right field")) return "RF";
  if (p.includes("outfield")) return "OF";
  if (p.includes("designated hitter")) return "DH";
  // Already abbreviated values come through unchanged.
  if (/^[A-Z0-9]{1,3}$/.test(position)) return position;
  return null;
}

function isPitcherFromPosition(positionAbbr: string | null): boolean {
  if (positionAbbr === null) return false;
  return positionAbbr === "P" || positionAbbr === "SP" || positionAbbr === "RP";
}

function buildBirthPlace(raw: RawPlayer): string | null {
  const direct = asStringOrNull(raw.birth_place);
  if (direct !== null) return direct;
  const parts = [raw.birth_city, raw.birth_state, raw.birth_country]
    .map(asStringOrNull)
    .filter((s): s is string => s !== null);
  return parts.length === 0 ? null : parts.join(", ");
}

function buildDraftString(raw: RawPlayer): string | null {
  const direct = asStringOrNull(raw.draft);
  if (direct !== null) return direct;
  const year = asNumberOrNull(raw.draft_year);
  const round = asNumberOrNull(raw.draft_round);
  const pick = asNumberOrNull(raw.draft_pick);
  if (year === null && round === null && pick === null) return null;
  const parts: string[] = [];
  if (year !== null) parts.push(String(year));
  if (round !== null) parts.push(`R${round}`);
  if (pick !== null) parts.push(`#${pick}`);
  return parts.join(" ");
}

function ageFromDob(dob: string | null): number | null {
  if (dob === null) return null;
  const t = Date.parse(dob);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms <= 0) return null;
  return Math.floor(ms / (365.25 * 24 * 3600 * 1000));
}

/**
 * Convert BDL's raw `dob` string to ISO `YYYY-MM-DD`.
 *
 * BDL's MLB API uses TWO date formats, observed empirically:
 *   • `DD/MM/YYYY` or `D/M/YYYY` (4-digit year, day-first) — used for
 *     most modern player entries, e.g. "21/6/1999" (Crochet),
 *     "14/11/1993" (Lindor), "6/8/1999" (Hunter Greene).
 *   • `MM/DD/YY` (2-digit year, month-first) — used for some older
 *     entries and some name-collision-prone players, e.g. "04/26/92"
 *     (Aaron Judge), "07/05/94" (Ohtani), "01/04/97" (Davis Martin).
 *
 * Disambiguation rule:
 *   • If the year group is 4 digits → treat the leading two groups as
 *     day-then-month (DD/MM/YYYY family). The year is unambiguous.
 *   • If the year group is 2 digits → treat as MM/DD/YY and use BDL's
 *     `age` field to pick century (2000+YY vs 1900+YY).
 *   • ISO `YYYY-MM-DD` is passed through unchanged.
 *
 * Returns null on malformed input or out-of-range day/month. Exported
 * for direct unit-testing in scripts/test-provider-mapping.ts.
 */
export function bdlDobToIso(
  raw: string | null,
  age: number | null,
  now: Date = new Date()
): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();

  // 1. ISO passthrough
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso !== null) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 2. Modern BDL: D/M/YYYY .. DD/MM/YYYY (year always 4 digits)
  const ymd = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ymd !== null) {
    const day = Number(ymd[1]);
    const month = Number(ymd[2]);
    const year = Number(ymd[3]);
    if (
      month < 1 || month > 12 ||
      day < 1 || day > 31 ||
      !Number.isFinite(year)
    ) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  // 3. Legacy BDL: MM/DD/YY (year always 2 digits)
  const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m === null) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const yy = Number(m[3]);
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    !Number.isFinite(yy)
  ) {
    return null;
  }
  const currentYear = now.getUTCFullYear();
  let year = 2000 + yy;
  if (age !== null) {
    const age2000 = currentYear - year;
    const age1900 = currentYear - (1900 + yy);
    if (Math.abs(age1900 - age) < Math.abs(age2000 - age)) {
      year = 1900 + yy;
    }
  } else if (year > currentYear) {
    year = 1900 + yy;
  }
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Parse BDL's combined `bats_throws` string (e.g. "R/R", "L/R", "S/R").
 * Falls back to separate `bats` / `throws` fields if combined is absent.
 */
function parseBatsThrows(
  combined: string | null | undefined,
  fallbackBats: string | null | undefined,
  fallbackThrows: string | null | undefined
): { bats: BatsHand | null; throws: ThrowsHand | null } {
  const s = asStringOrNull(combined);
  let batsRaw: string | null | undefined = fallbackBats;
  let throwsRaw: string | null | undefined = fallbackThrows;
  if (s !== null) {
    const parts = s.split("/");
    if (parts.length === 2) {
      batsRaw = parts[0];
      throwsRaw = parts[1];
    }
  }
  const batsU =
    batsRaw === null || batsRaw === undefined ? null : batsRaw.trim().toUpperCase();
  const throwsU =
    throwsRaw === null || throwsRaw === undefined ? null : throwsRaw.trim().toUpperCase();
  return {
    bats: batsU === "L" || batsU === "R" || batsU === "S" ? (batsU as BatsHand) : null,
    throws: throwsU === "L" || throwsU === "R" ? (throwsU as ThrowsHand) : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────

function mapPlayer(raw: RawPlayer, defaultSport: Sport): StatsPlayerRecord {
  const firstName = asStringOrNull(raw.first_name) ?? "";
  const lastName = asStringOrNull(raw.last_name) ?? "";
  const fullName = `${firstName} ${lastName}`.trim();
  const position = asStringOrNull(raw.position);
  const positionAbbr = shortPositionAbbr(position);
  const teamExternalId =
    asNumberOrNull(raw.team?.id) ?? asNumberOrNull(raw.team_id);
  // Prefer BDL's actual field names (dob, age, birth_place, bats_throws).
  // Legacy field names are kept as fallbacks for forward-compat.
  const rawDob = asStringOrNull(raw.dob) ?? asStringOrNull(raw.birth_date);
  const rawAge = asNumberOrNull(raw.age);
  const isoDob = bdlDobToIso(rawDob, rawAge);
  const { bats, throws } = parseBatsThrows(raw.bats_throws, raw.bats, raw.throws);
  return {
    external_id: raw.id,
    sport: defaultSport,
    team_external_id: teamExternalId,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    jersey: asStringOrNull(raw.jersey),
    position,
    position_abbr: positionAbbr,
    is_pitcher: isPitcherFromPosition(positionAbbr),
    active: raw.active === false ? false : true,
    bats,
    throws,
    birth_place: buildBirthPlace(raw),
    dob: isoDob,
    age: rawAge ?? ageFromDob(isoDob),
    height: asStringOrNull(raw.height),
    weight:
      raw.weight === null || raw.weight === undefined
        ? null
        : String(raw.weight),
    debut_year: asNumberOrNull(raw.debut_year),
    draft: buildDraftString(raw),
    provider_ids: { balldontlie: raw.id },
  };
}

function mapSeasonStats(raw: RawSeasonStats): StatsSeasonRecord {
  return {
    player_external_id: raw.player_id,
    team_external_id: asNumberOrNull(raw.team_id),
    season: raw.season,
    season_type: asStringOrNull(raw.season_type) ?? "regular",
    postseason: asBoolOrFalse(raw.postseason),
    // batting
    batting_gp: asNumberOrNull(raw.batting_gp),
    batting_ab: asNumberOrNull(raw.batting_ab),
    batting_r: asNumberOrNull(raw.batting_r),
    batting_h: asNumberOrNull(raw.batting_h),
    batting_avg: asNumberOrNull(raw.batting_avg),
    batting_2b: asNumberOrNull(raw.batting_2b),
    batting_3b: asNumberOrNull(raw.batting_3b),
    batting_hr: asNumberOrNull(raw.batting_hr),
    batting_rbi: asNumberOrNull(raw.batting_rbi),
    batting_tb: asNumberOrNull(raw.batting_tb),
    batting_bb: asNumberOrNull(raw.batting_bb),
    batting_so: asNumberOrNull(raw.batting_so),
    batting_sb: asNumberOrNull(raw.batting_sb),
    batting_obp: asNumberOrNull(raw.batting_obp),
    batting_slg: asNumberOrNull(raw.batting_slg),
    batting_ops: asNumberOrNull(raw.batting_ops),
    batting_war: asNumberOrNull(raw.batting_war),
    batting_pa: asNumberOrNull(raw.batting_pa),
    batting_hbp: asNumberOrNull(raw.batting_hbp),
    batting_sf: asNumberOrNull(raw.batting_sf),
    // pitching
    pitching_gp: asNumberOrNull(raw.pitching_gp),
    pitching_gs: asNumberOrNull(raw.pitching_gs),
    pitching_qs: asNumberOrNull(raw.pitching_qs),
    pitching_w: asNumberOrNull(raw.pitching_w),
    pitching_l: asNumberOrNull(raw.pitching_l),
    pitching_era: asNumberOrNull(raw.pitching_era),
    pitching_sv: asNumberOrNull(raw.pitching_sv),
    pitching_hld: asNumberOrNull(raw.pitching_hld),
    pitching_ip: asNumberOrNull(raw.pitching_ip),
    pitching_h: asNumberOrNull(raw.pitching_h),
    pitching_er: asNumberOrNull(raw.pitching_er),
    pitching_hr: asNumberOrNull(raw.pitching_hr),
    pitching_bb: asNumberOrNull(raw.pitching_bb),
    pitching_whip: asNumberOrNull(raw.pitching_whip),
    pitching_k: asNumberOrNull(raw.pitching_k),
    pitching_k_per_9: asNumberOrNull(raw.pitching_k_per_9),
    pitching_war: asNumberOrNull(raw.pitching_war),
  };
}

function mapSplit(raw: RawSplit): StatsSplitRecord {
  return {
    player_external_id: raw.player_id,
    season: raw.season,
    split_type: (asStringOrNull(raw.split_type) ?? "") as StatsSplitRecord["split_type"],
    ab: asNumberOrNull(raw.ab),
    h: asNumberOrNull(raw.h),
    avg: asNumberOrNull(raw.avg),
    obp: asNumberOrNull(raw.obp),
    slg: asNumberOrNull(raw.slg),
    ops: asNumberOrNull(raw.ops),
    hr: asNumberOrNull(raw.hr),
    rbi: asNumberOrNull(raw.rbi),
    so: asNumberOrNull(raw.so),
    bb: asNumberOrNull(raw.bb),
    tb: asNumberOrNull(raw.tb),
    pa: asNumberOrNull(raw.pa),
  };
}

function mapPitcherPitch(raw: RawPitcherPitch): PitcherPitchRecord {
  return {
    player_external_id: raw.player_id,
    season: raw.season,
    pitch_type: asStringOrNull(raw.pitch_type) ?? "",
    count: asNumberOrNull(raw.count),
    pct_of_total: asNumberOrNull(raw.pct_of_total),
    avg_velo_mph: asNumberOrNull(raw.avg_velo_mph),
    whiff_rate: asNumberOrNull(raw.whiff_rate),
    k_rate: asNumberOrNull(raw.k_rate),
    contact_rate: asNumberOrNull(raw.contact_rate),
  };
}

function mapHitterPitch(raw: RawHitterPitch): HitterPitchRecord {
  return {
    player_external_id: raw.player_id,
    season: raw.season,
    pitch_type: asStringOrNull(raw.pitch_type) ?? "",
    pa: asNumberOrNull(raw.pa),
    ab: asNumberOrNull(raw.ab),
    h: asNumberOrNull(raw.h),
    hr: asNumberOrNull(raw.hr),
    so: asNumberOrNull(raw.so),
    bb: asNumberOrNull(raw.bb),
    avg: asNumberOrNull(raw.avg),
    slg: asNumberOrNull(raw.slg),
    ops: asNumberOrNull(raw.ops),
    whiff_rate: asNumberOrNull(raw.whiff_rate),
    contact_rate: asNumberOrNull(raw.contact_rate),
  };
}

function mapLineup(raw: RawLineup): StatsLineupRecord {
  const positionRaw = asStringOrNull(raw.position);
  const startingPosition =
    shortPositionAbbr(positionRaw) ?? positionRaw;
  return {
    game_external_id: raw.game_id,
    team_external_id: raw.team_id,
    player_external_id: raw.player_id,
    batting_position: asNumberOrNull(raw.batting_order),
    starting_position: startingPosition,
    is_confirmed: asBoolOrFalse(raw.is_confirmed),
    is_dh: asBoolOrFalse(raw.is_dh),
  };
}

function mapInjury(raw: RawInjury): StatsInjuryRecord | null {
  const playerExt =
    asNumberOrNull(raw.player?.id) ?? asNumberOrNull(raw.player_id);
  if (playerExt === null) return null;
  return {
    player_external_id: playerExt,
    injury_date: asStringOrNull(raw.injury_date),
    return_date: asStringOrNull(raw.return_date),
    type: asStringOrNull(raw.type),
    detail: asStringOrNull(raw.detail),
    side: asStringOrNull(raw.side),
    status: asStringOrNull(raw.status),
    long_comment: asStringOrNull(raw.long_comment),
    short_comment: asStringOrNull(raw.short_comment),
    is_active: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export class BallDontLieProvider implements IPlayerStatsProvider {
  private readonly client: BdlClient;

  constructor(apiKey: string) {
    this.client = new BdlClient(apiKey);
  }

  /** Test/diagnostic accessor — never called by services. */
  getClient(): BdlClient {
    return this.client;
  }

  async getPlayers(teamExternalId?: number): Promise<StatsPlayerRecord[]> {
    const query: Record<string, string | number | number[]> = { per_page: 100 };
    if (teamExternalId !== undefined) {
      query["team_ids[]"] = [teamExternalId];
    }
    const rows = await this.client.fetchAll<RawPlayer>({
      path: "/players",
      query,
      maxPages: 20,
    });
    return rows.map((r) => mapPlayer(r, "mlb"));
  }

  async getPlayer(
    playerExternalId: number
  ): Promise<StatsPlayerRecord | null> {
    try {
      const res = await this.client.fetch<RawPlayer>({
        path: `/players/${playerExternalId}`,
      });
      const data = res.data as unknown as RawPlayer | RawPlayer[] | null;
      // BDL may return either { data: {...} } or { data: [{...}] } depending
      // on endpoint convention. Defend against both.
      if (data === null || data === undefined) return null;
      if (Array.isArray(data)) {
        return data.length === 0 ? null : mapPlayer(data[0]!, "mlb");
      }
      return mapPlayer(data, "mlb");
    } catch (e) {
      if (e instanceof BdlNotFoundError) return null;
      throw e;
    }
  }

  /**
   * Phase 4.2.C.1.M — name-based search for provider ID mapping.
   *
   * Calls BDL `/players?search=<query>` and returns every candidate
   * matching the search term (typically a last name). Used by
   * `providerMappingService` to find BDL candidates for an MLB Stats
   * person profile, then filter by DOB / city / team on the caller
   * side.
   *
   * Returns full `StatsPlayerRecord` shape so the matcher can compare
   * dob, birth_place, throws, bats, position, height, weight all in one
   * call. Empty array when BDL returns no candidates.
   *
   * Pagination: BDL search results are typically small (<25). We page
   * up to 2 pages × 100 = 200 results as a defensive ceiling — searching
   * for a common last name like "Rodriguez" still fits well under that.
   */
  async searchPlayersByName(query: string): Promise<StatsPlayerRecord[]> {
    const trimmed = query.trim();
    if (trimmed === "") return [];
    const rows = await this.client.fetchAll<RawPlayer>({
      path: "/players",
      query: { search: trimmed, per_page: 100 },
      maxPages: 2,
    });
    return rows.map((r) => mapPlayer(r, "mlb"));
  }

  async getPlayerSeasonStats(
    playerExternalId: number,
    seasons: number[]
  ): Promise<StatsSeasonRecord[]> {
    const out: StatsSeasonRecord[] = [];
    for (const season of seasons) {
      try {
        const rows = await this.client.fetchAll<RawSeasonStats>({
          path: "/season_stats",
          query: { player_id: playerExternalId, season, per_page: 100 },
          maxPages: 5,
        });
        for (const r of rows) out.push(mapSeasonStats(r));
      } catch (e) {
        if (e instanceof BdlNotFoundError) continue;
        throw e;
      }
    }
    return out;
  }

  async getPlayerSplits(
    playerExternalId: number,
    season: number
  ): Promise<StatsSplitRecord[]> {
    try {
      const rows = await this.client.fetchAll<RawSplit>({
        path: "/players/splits",
        query: { player_id: playerExternalId, season, per_page: 100 },
        maxPages: 5,
      });
      return rows.map(mapSplit);
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }

  async getPitcherPitchStats(
    pitcherExternalId: number,
    season: number
  ): Promise<PitcherPitchRecord[]> {
    try {
      const rows = await this.client.fetchAll<RawPitcherPitch>({
        path: "/pitcher_pitch_type_season_stats",
        query: { player_id: pitcherExternalId, season, per_page: 100 },
        maxPages: 5,
      });
      return rows.map(mapPitcherPitch);
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }

  async getHitterPitchStats(
    hitterExternalId: number,
    season: number
  ): Promise<HitterPitchRecord[]> {
    try {
      const rows = await this.client.fetchAll<RawHitterPitch>({
        path: "/hitter_pitch_type_season_stats",
        query: { player_id: hitterExternalId, season, per_page: 100 },
        maxPages: 5,
      });
      return rows.map(mapHitterPitch);
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }

  async getLineups(gameExternalId: number): Promise<StatsLineupRecord[]> {
    try {
      const rows = await this.client.fetchAll<RawLineup>({
        path: "/lineups",
        query: { "game_ids[]": [gameExternalId], per_page: 100 },
        maxPages: 5,
      });
      return rows.map(mapLineup);
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }

  async getInjuries(_sport?: Sport): Promise<StatsInjuryRecord[]> {
    // BDL MLB endpoint is sport-scoped at the base URL — sport param is
    // informational only.
    void _sport;
    try {
      const rows = await this.client.fetchAll<RawInjury>({
        path: "/player_injuries",
        query: { per_page: 100 },
        maxPages: 20,
      });
      const out: StatsInjuryRecord[] = [];
      for (const r of rows) {
        const mapped = mapInjury(r);
        if (mapped !== null) out.push(mapped);
      }
      return out;
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }
}
