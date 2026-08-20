import { SharpApiClient } from "./_sharpApiClient";
import {
  normalizeDoubleChanceSelection,
  normalizeBttsSelection,
  normalizeMatchResultSelection,
  normalizeSharpApiMarketType,
  normalizeTotalSelection,
  validateNormalizedRecord,
  type NormalizedSoccerOddsRecord,
} from "./_soccerMarketNormalizer";
import type { SharpApiOddsRow } from "./SharpApiSoccerOddsProvider";

export const SHARP_EPL_LEAGUE = "england_-_premier_league" as const;
const SHARP_MARKET_TYPE = {
  match_result: "moneyline",
  double_chance: "double_chance",
  total: "total_goals",
  btts: "both_teams_to_score",
} as const;
const MAX_FALLBACK_MARKET_CALLS_PER_FIXTURE = 4;

type SharpEvent = {
  id?: string;
  league?: string;
  home_team?: string;
  away_team?: string;
  start_time?: string;
  market_count?: number;
  external_ids?: Record<string, string>;
};

export type EplSharpFixtureMarket = {
  eventId: string | null;
  odds: NormalizedSoccerOddsRecord[];
  splits: EplSharpSplitsEvent[];
  splitsState: "present" | "unavailable" | "error";
};

export type EplSharpSplitsEvent = {
  moneyline?: {
    bets_pct?: { home?: number | null; away?: number | null; draw?: number | null };
    handle_pct?: { home?: number | null; away?: number | null; draw?: number | null };
  } | null;
  total?: {
    bets_pct?: { over?: number | null; under?: number | null };
    handle_pct?: { over?: number | null; under?: number | null };
  } | null;
  btts?: {
    bets_pct?: { yes?: number | null; no?: number | null };
    handle_pct?: { yes?: number | null; no?: number | null };
  } | null;
  fetched_at?: string | null;
};

type RawEplSharpSplitsEvent = EplSharpSplitsEvent & {
  event_id?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  sportsbook?: string | null;
  markets?: Array<{
    key?: string | null;
    market_type?: string | null;
    outcomes?: Array<{
      name?: string | null;
      selection?: string | null;
      bet_percent?: number | null;
      bets_pct?: number | null;
      money_percent?: number | null;
      handle_percent?: number | null;
      handle_pct?: number | null;
    }>;
  }>;
  timestamp?: string | null;
};

const TEAM_ALIASES: Record<string, string[]> = {
  coventrycity: ["coventry"],
  crystalpalace: ["cpalace", "palace"],
  cpalace: ["crystalpalace", "palace"],
  manchesterunited: ["manunited", "manutd"],
  manchestercity: ["mancity"],
  nottinghamforest: ["nottmforest"],
  wolverhamptonwanderers: ["wolves", "wolverhampton"],
  tottenhamhotspur: ["tottenham", "spurs"],
  tottenham: ["tottenhamhotspur", "spurs"],
  spurs: ["tottenhamhotspur", "tottenham"],
};

function key(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function eplTeamsMatch(left: string, right: string): boolean {
  const a = key(left);
  const b = key(right);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return (TEAM_ALIASES[a] ?? []).includes(b) || (TEAM_ALIASES[b] ?? []).includes(a);
}

function eventScore(event: SharpEvent, fixture: { home: string; away: string; kickoff: string }): number {
  if (!eplTeamsMatch(event.home_team ?? "", fixture.home) || !eplTeamsMatch(event.away_team ?? "", fixture.away)) return -1;
  const deltaMinutes = Math.abs(Date.parse(event.start_time ?? "") - Date.parse(fixture.kickoff)) / 60_000;
  if (!Number.isFinite(deltaMinutes) || deltaMinutes > 90) return -1;
  // Sharp can expose sportsbook-specific duplicates and proposition shells
  // under the same teams/date. Full-game breadth is the strongest signal that
  // an event owns the four Daily Edge markets; external-id count is only a
  // tiebreaker and must never outrank an 80-market canonical event.
  const exactTeams = key(event.home_team ?? "") === key(fixture.home)
    && key(event.away_team ?? "") === key(fixture.away);
  return Number(exactTeams) * 1_000_000
    + (event.market_count ?? 0) * 100
    + Object.keys(event.external_ids ?? {}).length
    - deltaMinutes;
}

export class SharpApiEplMarketProvider {
  private readonly eventsByDate = new Map<string, Promise<SharpEvent[]>>();
  private leagueSplitsPromise: Promise<RawEplSharpSplitsEvent[]> | null = null;

  constructor(private readonly client: SharpApiClient) {}

  private events(date: string): Promise<SharpEvent[]> {
    const cached = this.eventsByDate.get(date);
    if (cached) return cached;
    const request = this.client.fetchAll<SharpEvent>({
      path: "/events",
      query: { sport: "soccer", league: SHARP_EPL_LEAGUE, date, limit: 100 },
      maxPages: 8,
    });
    this.eventsByDate.set(date, request);
    return request;
  }

  /** One league-wide request per slate assembly. Sharp's documented splits
   * response carries canonical event IDs, so per-fixture split calls only
   * burn quota without improving coverage. */
  private leagueSplits(): Promise<RawEplSharpSplitsEvent[]> {
    if (this.leagueSplitsPromise) return this.leagueSplitsPromise;
    this.leagueSplitsPromise = this.client.fetchAll<RawEplSharpSplitsEvent>({
      path: "/splits",
      // Sharp's public examples key splits by sport. Keep the canonical league
      // filter as well so a future non-empty response stays EPL-scoped.
      query: { sport: "soccer", league: SHARP_EPL_LEAGUE, limit: 200 },
      maxPages: 3,
    });
    return this.leagueSplitsPromise;
  }

  private async marketOdds(eventId: string, market: keyof typeof SHARP_MARKET_TYPE): Promise<SharpApiOddsRow[]> {
    // A single failed market request must not erase the three successful
    // markets for the fixture. Retry once for transient provider/network
    // failures, then return an empty market so duplicate-event fallback can
    // still repair the fixture and readiness can report any genuine gap.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.client.fetchAll<SharpApiOddsRow>({
          path: "/odds",
          query: { event_id: eventId, market_type: SHARP_MARKET_TYPE[market], limit: 200 },
          maxPages: 4,
        });
      } catch {
        if (attempt === 1) return [];
      }
    }
    return [];
  }

  async loadFixture(fixture: { home: string; away: string; kickoff: string }): Promise<EplSharpFixtureMarket> {
    const date = fixture.kickoff.slice(0, 10);
    const events = await this.events(date);
    const candidates = events
      .map((candidate) => ({ candidate, score: eventScore(candidate, fixture) }))
      .filter((candidate) => candidate.score >= 0 && typeof candidate.candidate.id === "string")
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((row) => row.candidate);
    if (candidates.length === 0) return { eventId: null, odds: [], splits: [], splitsState: "unavailable" };

    const bestByMarket = new Map<NormalizedSoccerOddsRecord["market"], { event: SharpEvent; rows: NormalizedSoccerOddsRecord[]; score: number }>();
    let fallbackOddsBudget = MAX_FALLBACK_MARKET_CALLS_PER_FIXTURE;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!candidate.id) continue;
      const marketsToFetch = (["match_result", "double_chance", "total", "btts"] as const)
        .filter((market) => !bestByMarket.has(market));
      if (marketsToFetch.length === 0) break;
      const permitted = index === 0
        ? marketsToFetch
        : marketsToFetch.slice(0, Math.max(0, fallbackOddsBudget));
      if (permitted.length === 0) break;
      if (index > 0) fallbackOddsBudget -= permitted.length;
      const fetched = await Promise.all(permitted.map(async (market) => ({
        market,
        raw: await this.marketOdds(candidate.id!, market),
      })));
      for (const { market, raw } of fetched) {
        const next = normalizeOdds(raw, candidate.id, { home: candidate.home_team ?? fixture.home, away: candidate.away_team ?? fixture.away });
        const rows = next.filter((row) => row.market === market);
        if (rows.length === 0) continue;
        const score = marketCoverageScore(rows);
        const incumbent = bestByMarket.get(market);
        if (!incumbent || score > incumbent.score || score === incumbent.score && rows.length > incumbent.rows.length) {
          bestByMarket.set(market, { event: candidate, rows, score });
        }
      }
      // Sharp can split one fixture into complementary event buckets (for
      // example, main 1X2/totals in one and BTTS/DC in another). Preserve one
      // coherent event identity inside each market instead of forcing every
      // market to come from one bucket or mixing sides across books.
      if (["match_result", "double_chance", "total", "btts"].every((market) => bestByMarket.has(market as NormalizedSoccerOddsRecord["market"]))) break;
    }
    const normalized = [...bestByMarket.values()].flatMap((entry) => entry.rows);
    const selected = bestByMarket.get("match_result")?.event ?? bestByMarket.values().next().value?.event ?? candidates[0];
    if (!selected?.id) return { eventId: null, odds: [], splits: [], splitsState: "unavailable" };
    const splitEventIds = new Set([selected.id, ...[...bestByMarket.values()].map((entry) => entry.event.id)].filter((id): id is string => Boolean(id)));
    let splitRows: EplSharpSplitsEvent[] = [];
    let splitErrored = false;
    try {
      const current = await this.leagueSplits();
      const matched = current.filter((row) =>
        row.event_id && splitEventIds.has(row.event_id) ||
        eplTeamsMatch(row.home_team ?? "", fixture.home) && eplTeamsMatch(row.away_team ?? "", fixture.away)
      );
      splitRows = normalizeEplSplits(matched, fixture);
    } catch {
      splitErrored = true;
    }
    return {
      eventId: selected.id,
      odds: normalized,
      splits: splitRows,
      splitsState: splitRows.length > 0 ? "present" : splitErrored ? "error" : "unavailable",
    };
  }
}

function marketCoverageScore(rows: NormalizedSoccerOddsRecord[]): number {
  const required = rows[0]?.market === "match_result" || rows[0]?.market === "double_chance" ? 3 : 2;
  const groups = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.sportsbook ?? "unknown"}:${row.market === "total" ? row.line ?? "none" : "main"}`;
    const selections = groups.get(key) ?? new Set<string>();
    selections.add(row.selection);
    groups.set(key, selections);
  }
  const coherentSelections = Math.max(0, ...[...groups.values()].map((selections) => selections.size));
  const complete = coherentSelections >= required;
  return Number(complete) * 10_000 + coherentSelections * 100 + rows.length;
}

function splitNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeEplSplits(rows: RawEplSharpSplitsEvent[], fixture: { home: string; away: string }): EplSharpSplitsEvent[] {
  return rows.flatMap((row) => {
    if (row.moneyline || row.total || row.btts) return [row];
    const result: EplSharpSplitsEvent = { fetched_at: row.fetched_at ?? row.timestamp ?? null };
    for (const market of row.markets ?? []) {
      const key = String(market.key ?? market.market_type ?? "").toLowerCase();
      if (key === "h2h" || key === "moneyline" || key === "match_result") {
        const bets: { home?: number | null; away?: number | null; draw?: number | null } = {};
        const handle: { home?: number | null; away?: number | null; draw?: number | null } = {};
        for (const outcome of market.outcomes ?? []) {
          const side = normalizeMatchResultSelection(String(outcome.selection ?? outcome.name ?? ""), { home_team: fixture.home, away_team: fixture.away });
          if (!side) continue;
          bets[side] = splitNumber(outcome.bet_percent ?? outcome.bets_pct);
          handle[side] = splitNumber(outcome.money_percent ?? outcome.handle_percent ?? outcome.handle_pct);
        }
        result.moneyline = { bets_pct: bets, handle_pct: handle };
      }
      if (key === "total" || key === "total_goals" || key === "totals") {
        const bets: { over?: number | null; under?: number | null } = {};
        const handle: { over?: number | null; under?: number | null } = {};
        for (const outcome of market.outcomes ?? []) {
          const side = normalizeTotalSelection(String(outcome.selection ?? outcome.name ?? ""));
          if (!side) continue;
          bets[side] = splitNumber(outcome.bet_percent ?? outcome.bets_pct);
          handle[side] = splitNumber(outcome.money_percent ?? outcome.handle_percent ?? outcome.handle_pct);
        }
        result.total = { bets_pct: bets, handle_pct: handle };
      }
      if (key === "both_teams_to_score" || key === "btts") {
        const bets: { yes?: number | null; no?: number | null } = {};
        const handle: { yes?: number | null; no?: number | null } = {};
        for (const outcome of market.outcomes ?? []) {
          const side = normalizeBttsSelection(String(outcome.selection ?? outcome.name ?? ""));
          if (!side) continue;
          bets[side] = splitNumber(outcome.bet_percent ?? outcome.bets_pct);
          handle[side] = splitNumber(outcome.money_percent ?? outcome.handle_percent ?? outcome.handle_pct);
        }
        result.btts = { bets_pct: bets, handle_pct: handle };
      }
    }
    return result.moneyline || result.total || result.btts ? [result] : [];
  });
}

function normalizeOdds(rows: SharpApiOddsRow[], eventId: string, fixture: { home: string; away: string }): NormalizedSoccerOddsRecord[] {
  const out: NormalizedSoccerOddsRecord[] = [];
  for (const row of rows) {
    const market = normalizeSharpApiMarketType(String(row.market_type ?? ""));
    if (market !== "match_result" && market !== "double_chance" && market !== "total" && market !== "btts") continue;
    const home = String(row.home_team || fixture.home);
    const away = String(row.away_team || fixture.away);
    const rawSelection = String(row.selection ?? row.selection_type ?? "");
    if (market === "double_chance" && /\b(over|under|goals?|score)\b/i.test(rawSelection)) continue;
    const selection = market === "match_result"
      ? normalizeMatchResultSelection(rawSelection, { home_team: home, away_team: away })
      : market === "double_chance"
        ? normalizeDoubleChanceSelection(rawSelection, { home_team: home, away_team: away })
      : market === "total"
        ? normalizeTotalSelection(rawSelection)
        : normalizeBttsSelection(rawSelection);
    if (!selection) continue;
    const record = validateNormalizedRecord({
      market,
      selection,
      line: market === "total" && typeof row.line === "number" ? row.line : null,
      odds_american: row.odds_american ?? null,
      odds_decimal: row.odds_decimal ?? null,
      sportsbook: row.sportsbook ?? null,
      provider: "sharpapi",
      provider_endpoint: `/odds?event_id=${eventId}`,
      fetched_at: row.timestamp ?? new Date().toISOString(),
      provider_event_id: eventId,
    });
    if (record) out.push(record);
  }
  return out;
}
