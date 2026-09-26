import { unstable_cache } from "next/cache";

import { PlaybookClient, type PlaybookResult } from "./playbookClient";
import type {
  PlaybookInjuriesResponse,
  PlaybookLeague,
  PlaybookLinesResponse,
  PlaybookSplitsHistoryResponse,
  PlaybookSplitsResponse,
  PlaybookVenueWeatherResponse,
} from "./types";

export const PLAYBOOK_REQUEST_EFFICIENCY_RELEASE =
  "playbook_request_efficiency_2026_09_26_r1_shared_fresh_reads" as const;

export const PLAYBOOK_CURRENT_CACHE_SECONDS = 10 * 60;
export const PLAYBOOK_HISTORY_CACHE_SECONDS = 24 * 60 * 60;
export const PLAYBOOK_INJURIES_CACHE_SECONDS = 15 * 60;

type ReadResult =
  | PlaybookResult<PlaybookSplitsResponse>
  | PlaybookResult<PlaybookSplitsHistoryResponse>
  | PlaybookResult<PlaybookLinesResponse>
  | PlaybookResult<PlaybookVenueWeatherResponse>
  | PlaybookResult<PlaybookInjuriesResponse>;

function productionClient(timeoutMs?: number): PlaybookClient {
  const apiKey = process.env.PLAYBOOK_API_KEY;
  if (!apiKey) throw new Error("missing PLAYBOOK_API_KEY");
  return new PlaybookClient(apiKey, timeoutMs === undefined ? undefined : { timeoutMs });
}

const cachedSplits = unstable_cache(
  async (league: string) => productionClient().splits(league),
  [PLAYBOOK_REQUEST_EFFICIENCY_RELEASE, "splits"],
  { revalidate: PLAYBOOK_CURRENT_CACHE_SECONDS, tags: ["playbook-current-splits"] },
);

const cachedLines = unstable_cache(
  async (league: string) => productionClient().lines(league),
  [PLAYBOOK_REQUEST_EFFICIENCY_RELEASE, "lines"],
  { revalidate: PLAYBOOK_CURRENT_CACHE_SECONDS, tags: ["playbook-current-lines"] },
);

const cachedSplitsHistory = unstable_cache(
  async (league: string, date: string) => productionClient().splitsHistory(league, date),
  [PLAYBOOK_REQUEST_EFFICIENCY_RELEASE, "splits-history"],
  { revalidate: PLAYBOOK_HISTORY_CACHE_SECONDS, tags: ["playbook-splits-history"] },
);

const cachedVenueWeather = unstable_cache(
  async (league: string) => productionClient().venueWeather(league),
  [PLAYBOOK_REQUEST_EFFICIENCY_RELEASE, "venue-weather"],
  { revalidate: PLAYBOOK_CURRENT_CACHE_SECONDS, tags: ["playbook-venue-weather"] },
);

const cachedInjuries = unstable_cache(
  async (league: string) => productionClient(2_500).injuries(league),
  [PLAYBOOK_REQUEST_EFFICIENCY_RELEASE, "injuries"],
  { revalidate: PLAYBOOK_INJURIES_CACHE_SECONDS, tags: ["playbook-injuries"] },
);

/**
 * Server-only Playbook reader. It preserves the typed client response while
 * coalescing identical calls in this process and, for the production key,
 * through Next's persistent data cache. Explicit audit keys bypass the shared
 * cache so operator probes continue to measure real provider behavior.
 */
export class PlaybookReadBroker {
  private readonly direct: PlaybookClient;
  private readonly useSharedCache: boolean;
  private readonly inFlight = new Map<string, Promise<ReadResult>>();

  constructor(apiKey: string, options?: { timeoutMs?: number; sharedCache?: boolean }) {
    this.direct = new PlaybookClient(apiKey, options?.timeoutMs === undefined
      ? undefined
      : { timeoutMs: options.timeoutMs });
    this.useSharedCache = options?.sharedCache !== false && apiKey === process.env.PLAYBOOK_API_KEY;
  }

  private read<T extends ReadResult>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const request = load();
    this.inFlight.set(key, request);
    const clear = (): void => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    };
    void request.then(clear, clear);
    return request;
  }

  private async sharedOrDirect<T extends ReadResult>(
    shared: () => Promise<T>,
    direct: () => Promise<T>,
  ): Promise<T> {
    if (!this.useSharedCache) return direct();
    try {
      return await shared();
    } catch (error) {
      // Operator scripts use the same production environment but run outside
      // Next's request runtime, where no Incremental Cache exists. Fall back
      // only for that framework invariant; provider failures must propagate
      // without a second paid request.
      if (error instanceof Error && error.message.includes("incrementalCache missing in unstable_cache")) {
        return direct();
      }
      throw error;
    }
  }

  splits(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookSplitsResponse>> {
    const normalized = String(league).toLowerCase();
    return this.read(`splits:${normalized}`, () => this.sharedOrDirect(
      () => cachedSplits(normalized),
      () => this.direct.splits(normalized),
    ));
  }

  lines(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookLinesResponse>> {
    const normalized = String(league).toLowerCase();
    return this.read(`lines:${normalized}`, () => this.sharedOrDirect(
      () => cachedLines(normalized),
      () => this.direct.lines(normalized),
    ));
  }

  splitsHistory(
    league: PlaybookLeague | string,
    date: string,
  ): Promise<PlaybookResult<PlaybookSplitsHistoryResponse>> {
    const normalized = String(league).toLowerCase();
    return this.read(`splits-history:${normalized}:${date}`, () => this.sharedOrDirect(
      () => cachedSplitsHistory(normalized, date),
      () => this.direct.splitsHistory(normalized, date),
    ));
  }

  venueWeather(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookVenueWeatherResponse>> {
    const normalized = String(league).toLowerCase();
    return this.read(`venue-weather:${normalized}`, () => this.sharedOrDirect(
      () => cachedVenueWeather(normalized),
      () => this.direct.venueWeather(normalized),
    ));
  }

  mlbVenueWeather(): Promise<PlaybookResult<PlaybookVenueWeatherResponse>> {
    return this.venueWeather("mlb");
  }

  injuries(league: PlaybookLeague | string): Promise<PlaybookResult<PlaybookInjuriesResponse>> {
    const normalized = String(league).toLowerCase();
    return this.read(`injuries:${normalized}`, () => this.sharedOrDirect(
      () => cachedInjuries(normalized),
      () => this.direct.injuries(normalized),
    ));
  }
}

export function playbookSplitsReadMode(
  slateDate: string,
  today: string,
): "current" | "history" {
  return slateDate >= today ? "current" : "history";
}
