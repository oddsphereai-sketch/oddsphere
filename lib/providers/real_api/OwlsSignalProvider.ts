import type { ISharpSignalProvider, SharpSignalRecord } from "../interfaces/ISharpSignalProvider";
import { OwlsInsightClient } from "../owls/owlsInsightClient";
import {
  normalizeOwlsSharpBookSplits,
  type NormalizedOwlsSplitObservation,
  type RawOwlsSplitsResponse,
} from "../owls/owlsSharpBookSplits";
import { normalizeMlbTeamName } from "./_teamNameNormalizer";
import type { SharpApiGameResolver } from "./SharpAPIOddsProvider";
import { verifiedUnitSplitPct } from "../../services/splitEvidenceQuality";

function selectCoherentNamedBookPair(
  observations: readonly NormalizedOwlsSplitObservation[],
  providerEventId: string,
  market: "moneyline" | "spread" | "total",
): NormalizedOwlsSplitObservation[] {
  for (const sourceBook of ["circa", "draftkings", "betmgm"] as const) {
    const pair = observations.filter((row) =>
      row.providerEventId === providerEventId
      && row.market === market
      && row.sourceBook === sourceBook
      && (row.betsPct !== null || row.moneyPct !== null),
    );
    if (
      pair.length === 2
      && pair[0]?.observedAt === pair[1]?.observedAt
      && pair.every((row) => {
        const ageMs = Date.now() - Date.parse(row.observedAt);
        return ageMs >= -5 * 60 * 1000 && ageMs <= 3 * 60 * 60 * 1000;
      })
    ) return pair;
  }
  return [];
}

/** Owls named-book splits adapter for the legacy sharp_signals storage shape. */
export class OwlsSignalProvider implements ISharpSignalProvider {
  private readonly client: OwlsInsightClient;

  constructor(
    apiKey: string,
    private readonly resolveGame: SharpApiGameResolver,
    opts: { client?: OwlsInsightClient } = {},
  ) {
    this.client = opts.client ?? new OwlsInsightClient(apiKey);
  }

  async getSharpSignals(date: string, gameExternalId?: number): Promise<SharpSignalRecord[]> {
    const response = await this.client.splits<RawOwlsSplitsResponse>("mlb");
    const coverage = normalizeOwlsSharpBookSplits(response.body, "mlb");
    const records: SharpSignalRecord[] = [];
    const eventIds = [...new Set(coverage.observations.map((row) => row.providerEventId))];

    for (const providerEventId of eventIds) {
      const sample = coverage.observations.find((row) => row.providerEventId === providerEventId);
      if (!sample) continue;
      const home = normalizeMlbTeamName(sample.homeTeam);
      const away = normalizeMlbTeamName(sample.awayTeam);
      if (!home || !away) continue;
      const resolved = await this.resolveGame("mlb", date, home, away, sample.observedAt, null);
      if (resolved === null || (gameExternalId !== undefined && resolved !== gameExternalId)) continue;

      for (const market of ["moneyline", "spread", "total"] as const) {
        const pair = selectCoherentNamedBookPair(coverage.observations, providerEventId, market);
        for (const row of pair) {
          const betting = verifiedUnitSplitPct(row.betsPct);
          const money = verifiedUnitSplitPct(row.moneyPct);
          records.push({
            game_external_id: resolved,
            market_type: market,
            side: row.side,
            pinnacle_fair_probability: null,
            is_plus_ev: false,
            ev_pct: null,
            has_steam_move: false,
            steam_detected_at: null,
            steam_books_count: null,
            has_reverse_line_movement: false,
            rlm_direction: null,
            public_betting_pct: betting === null ? null : betting * 100,
            public_money_pct: money === null ? null : money * 100,
            signal_strength: null,
            signal_summary: null,
            computed_at: row.observedAt,
          });
        }
      }
    }
    return records;
  }
}
