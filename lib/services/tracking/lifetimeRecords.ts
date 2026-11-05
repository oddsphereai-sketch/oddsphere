/** Pure lifetime policy shared by member and public tracking readers. No stored records are changed. */

type Metrics = {
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  pending: number;
  win_pct: number | null;
};

type SportMarketBucket = {
  sport: string;
  market: string;
  metrics: Metrics;
  bestAngles?: Metrics;
  leans?: Metrics;
};

type BaselineRow = {
  source_label?: string;
  sport: string;
  market: string;
  lifetime_wins: number;
  lifetime_total: number;
  lifetime_pct: number;
};

const MARKET_ORDER: Record<string, number> = {
  moneyline: 1, match_result: 1, total: 2, nrfi: 3, yrfi: 4, first_inning: 5, spread: 6, double_chance: 7, btts: 8,
};

const SPORT_ORDER: Record<string, number> = {
  mlb: 1,
  nba: 2, cbb: 3, wnba: 4,
  nfl: 5, cfb: 6,
  nhl: 7,
  epl: 8, soccer: 9, ucl: 10,
};

function fmtRecord(m: Metrics): string {
  return `${m.wins}-${m.losses}${m.pushes > 0 ? `-${m.pushes}` : ""}`;
}
function fmtPct(m: Metrics): string | null {
  if (m.win_pct === null) return null;
  return `${m.win_pct.toFixed(1)}%`;
}

// ─── Lifetime record merge ─────────────────────────────────────────────
/**
 * Single source-of-truth shape for the Lifetime Tracking section.
 *
 * Phase 6B.24 fix — when both a stored baseline AND live tracked picks
 * exist for the same category, MERGE them. Previously the page picked
 * one or the other, which silently discarded the live record under the
 * baseline (NRFI/YRFI showed only history) or discarded the baseline
 * under the live record (ML/OU showed only today's picks despite years
 * of historical baseline). Source type values:
 *
 *   "lifetime_merged"   — baseline + live decided picks combined.
 *   "lifetime_baseline" — only the imported historical baseline so far
 *                         (no live decided picks yet today).
 *   "since_launch"      — only live tracked picks (no baseline exists
 *                         for this category yet); label makes this
 *                         clear so members don't mistake "5-2 (71%)"
 *                         for an all-time lifetime number.
 */
export type LifetimeRecord = {
  sport: string;
  market: string;
  source_type: "lifetime_merged" | "lifetime_baseline" | "since_launch" | "release_separated" | "locked_lifetime";
  /** Display text for the record column. e.g. "1719/3043" or "5-2". */
  display_record: string;
  /** Display text for the win-rate column. e.g. "56.5%" or null. */
  display_pct: string | null;
  /** Total sample size for sort + footer rendering. */
  display_total: number;
  /** Only populated when live contributes. */
  pending: number;
  pushes: number;
  voids: number;
  /** How many of the live wins / losses are merged in (0 when none). */
  live_decided_contribution: number;
  /** Numeric record used by the same category chart as weekly/monthly. */
  metrics: Metrics;
  bestAngles?: Metrics;
  leans?: Metrics;
  /** UCL's row-level forward release cannot be blended with its aggregate-only
   * legacy import. Both remain visible on one category row. */
  historical_archive?: string;
};

function lifetimeRecordKey(sport: string, market: string): string {
  // UCL's legacy archive called the 1X2 market "moneyline" while the
  // released model records it as "match_result". They are the same member
  // category, so join the archive onto Match Result instead of rendering two
  // contradictory rows or leaving the current record detached.
  return `${sport}:${sport === "ucl" && market === "moneyline" ? "match_result" : market}`;
}

export function buildLifetimeRecords(
  bySportMarket: SportMarketBucket[],
  baselines: BaselineRow[],
  lockedHistory: SportMarketBucket[] = [],
): LifetimeRecord[] {
  const baseIdx = new Map<string, BaselineRow>();
  for (const b of baselines) baseIdx.set(lifetimeRecordKey(b.sport, b.market), b);
  const liveIdx = new Map<string, SportMarketBucket>();
  for (const b of bySportMarket) liveIdx.set(lifetimeRecordKey(b.sport, b.market), b);
  // Calendar history is deliberately used only for UCL. Its current-release
  // aggregate can legitimately be empty immediately after a model release,
  // but locked public results must not disappear from Lifetime as a result.
  // This is display-only: the exact stored wins/losses/pending values are
  // rendered without reconstruction or mutation.
  const lockedIdx = new Map<string, SportMarketBucket>();
  for (const b of lockedHistory) {
    if (b.sport === "ucl") lockedIdx.set(lifetimeRecordKey(b.sport, b.market), b);
  }

  const keys = new Set<string>([...baseIdx.keys(), ...liveIdx.keys(), ...lockedIdx.keys()]);
  const records: LifetimeRecord[] = [];
  for (const key of keys) {
    const [sport, market] = key.split(":");
    const base = baseIdx.get(key);
    const live = liveIdx.get(key);
    const locked = lockedIdx.get(key);
    const liveDecided = (live?.metrics.wins ?? 0) + (live?.metrics.losses ?? 0);
    const liveWins = live?.metrics.wins ?? 0;
    const livePending = live?.metrics.pending ?? 0;
    const lockedDecided = (locked?.metrics.wins ?? 0) + (locked?.metrics.losses ?? 0);

    if (sport === "ucl" && locked !== undefined && (lockedDecided > 0 || locked.metrics.pending > 0)) {
      // UCL Lifetime is the immutable public record across released locks.
      // Do not call it current-release accuracy and do not blend the older
      // aggregate-only import into these exact row-level results.
      records.push({
        sport, market,
        source_type: "locked_lifetime",
        display_record: lockedDecided > 0 ? fmtRecord(locked.metrics) : `${locked.metrics.pending} pending`,
        display_pct: lockedDecided > 0 ? fmtPct(locked.metrics) : null,
        display_total: locked.metrics.picks,
        pending: locked.metrics.pending,
        pushes: locked.metrics.pushes,
        voids: locked.metrics.voids,
        live_decided_contribution: lockedDecided,
        metrics: locked.metrics,
        bestAngles: locked.bestAngles,
        leans: locked.leans,
        historical_archive: base !== undefined
          ? `${base.lifetime_wins.toLocaleString()}/${base.lifetime_total.toLocaleString()} (${base.lifetime_pct.toFixed(1)}%)`
          : undefined,
      });
    } else if (base !== undefined && liveDecided > 0 && sport === "ucl") {
      records.push({
        sport, market,
        source_type: "release_separated",
        display_record: fmtRecord(live!.metrics),
        display_pct: fmtPct(live!.metrics),
        display_total: live!.metrics.picks,
        pending: livePending,
        pushes: live!.metrics.pushes,
        voids: live!.metrics.voids,
        live_decided_contribution: liveDecided,
        metrics: live!.metrics,
        bestAngles: live!.bestAngles,
        leans: live!.leans,
        historical_archive: `${base.lifetime_wins.toLocaleString()}/${base.lifetime_total.toLocaleString()} (${base.lifetime_pct.toFixed(1)}%)`,
      });
    } else if (base !== undefined && liveDecided > 0) {
      // MERGED — baseline + live decided picks combined.
      const mergedWins = base.lifetime_wins + liveWins;
      const mergedTotal = base.lifetime_total + liveDecided;
      const mergedPct = mergedTotal > 0 ? (mergedWins / mergedTotal) * 100 : 0;
      records.push({
        sport, market,
        source_type: "lifetime_merged",
        display_record: `${mergedWins.toLocaleString()}/${mergedTotal.toLocaleString()}`,
        display_pct: `${mergedPct.toFixed(1)}%`,
        display_total: mergedTotal,
        pending: livePending,
        pushes: live?.metrics.pushes ?? 0,
        voids: live?.metrics.voids ?? 0,
        live_decided_contribution: liveDecided,
        metrics: {
          picks: mergedTotal,
          wins: mergedWins,
          losses: mergedTotal - mergedWins,
          pushes: live?.metrics.pushes ?? 0,
          voids: live?.metrics.voids ?? 0,
          pending: livePending,
          win_pct: mergedPct,
        },
        bestAngles: live?.bestAngles,
        leans: live?.leans,
      });
    } else if (base !== undefined) {
      // Baseline only — live has no decided picks yet for this category.
      records.push({
        sport, market,
        source_type: "lifetime_baseline",
        display_record: `${base.lifetime_wins.toLocaleString()}/${base.lifetime_total.toLocaleString()}`,
        display_pct: `${base.lifetime_pct.toFixed(1)}%`,
        display_total: base.lifetime_total,
        pending: livePending,
        pushes: 0,
        voids: 0,
        live_decided_contribution: 0,
        metrics: {
          picks: base.lifetime_total,
          wins: base.lifetime_wins,
          losses: base.lifetime_total - base.lifetime_wins,
          pushes: 0,
          voids: 0,
          pending: livePending,
          win_pct: base.lifetime_pct,
        },
        bestAngles: live?.bestAngles,
        leans: live?.leans,
      });
    } else if (live !== undefined && liveDecided > 0) {
      // No baseline — live-only "since launch" record. Label clearly so
      // members don't read this as all-time history.
      records.push({
        sport, market,
        source_type: "since_launch",
        display_record: fmtRecord(live.metrics),
        display_pct: fmtPct(live.metrics),
        display_total: live.metrics.picks,
        pending: livePending,
        pushes: live.metrics.pushes,
        voids: live.metrics.voids,
        live_decided_contribution: liveDecided,
        metrics: live.metrics,
        bestAngles: live.bestAngles,
        leans: live.leans,
      });
    } else if (live !== undefined && live.metrics.pending > 0) {
      // Nothing decided yet for this category — surface the pending count
      // so members know the slate's live but nothing has settled.
      records.push({
        sport, market,
        source_type: "since_launch",
        display_record: `${live.metrics.pending} pending`,
        display_pct: null,
        display_total: live.metrics.pending,
        pending: live.metrics.pending,
        pushes: 0,
        voids: 0,
        live_decided_contribution: 0,
        metrics: live.metrics,
        bestAngles: live.bestAngles,
        leans: live.leans,
      });
    }
  }

  // MLB: drop the rolled-up first_inning row when NRFI and YRFI are
  // both first-class so we don't double-render the same picks.
  const mlbHasNrfiYrfi =
    records.some((r) => r.sport === "mlb" && r.market === "nrfi") &&
    records.some((r) => r.sport === "mlb" && r.market === "yrfi");
  const filtered = records.filter((r) => !(r.sport === "mlb" && r.market === "first_inning" && mlbHasNrfiYrfi));

  filtered.sort((a, b) => {
    const s = (SPORT_ORDER[a.sport] ?? 99) - (SPORT_ORDER[b.sport] ?? 99);
    if (s !== 0) return s;
    return (MARKET_ORDER[a.market] ?? 99) - (MARKET_ORDER[b.market] ?? 99);
  });

  return filtered;
}


export function lifetimeSourceLabel(record: LifetimeRecord): string {
  if (record.source_type === "locked_lifetime") {
    return record.historical_archive !== undefined
      ? `Locked lifetime · all released locks · earlier archive ${record.historical_archive}`
      : "Locked lifetime · all released locks";
  }
  if (record.source_type === "release_separated") {
    return `Current release · historical archive ${record.historical_archive}`;
  }
  if (record.source_type === "lifetime_merged") {
    return `Lifetime · live +${record.live_decided_contribution}`;
  }
  if (record.source_type === "since_launch") return "Since launch";
  return record.sport === "ucl" ? "Historical archive · aggregate-only legacy import" : "Lifetime";
}
