import { readLatestLabResponseSnapshot, upsertLabResponseSnapshot } from "../../lib/services/labResponseSnapshots";

const SPORT = "cfb" as const;
const RELEASE = "owls_current_splits_2026_10_27_r1_complete_named_book" as const;
const SNAPSHOT_KEY = `daily-edge::named-book-current-splits::${SPORT}::${RELEASE}`;
const OBSERVED_AT = "2026-10-27T21:44:55.596Z";
const LOCKED_AT = "2026-10-27T22:00:15.640Z";

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(value: unknown): string {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function main(): Promise<void> {
  if (Date.parse(OBSERVED_AT) > Date.parse(LOCKED_AT)) throw new Error("Recovery evidence is not pre-lock.");
  const stored = await readLatestLabResponseSnapshot<Json>(SNAPSHOT_KEY);
  const payload = record(stored?.payload);
  if (payload.source !== "owls_current_splits" || payload.release !== RELEASE || !Array.isArray(payload.rows)) {
    throw new Error("Owls CFB durable split snapshot is unavailable or incompatible.");
  }
  const rows = payload.rows.filter((row): row is Json => row !== null && typeof row === "object" && !Array.isArray(row));
  const existing = rows.find((row) =>
    normalize(row.sportsbook) === "circa" &&
    normalize(row.away_team).includes("delaware") &&
    normalize(row.home_team).includes("westernkentucky")
  );
  if (!existing) throw new Error("Current Owls DEL@WKU Circa identity is unavailable; refusing a synthetic event match.");
  if (rows.some((row) => text(row.event_id) === text(existing.event_id) && text(row.sportsbook) === text(existing.sportsbook) && text(row.fetched_at) === OBSERVED_AT)) {
    console.log(JSON.stringify({ restored: false, reason: "already_present", snapshotKey: SNAPSHOT_KEY }));
    return;
  }

  const recovered: Json = {
    event_id: existing.event_id,
    league: existing.league,
    home_team: existing.home_team,
    away_team: existing.away_team,
    sportsbook: existing.sportsbook,
    fetched_at: OBSERVED_AT,
    moneyline: {
      bets_pct: { away: 0.40, home: 0.60 },
      handle_pct: { away: 0.96, home: 0.04 },
    },
    spread: {
      bets_pct: { away: 0.41, home: 0.59 },
      handle_pct: { away: 0.03, home: 0.97 },
    },
    total: {
      bets_pct: { over: 0.53, under: 0.47 },
      handle_pct: { over: 0.44, under: 0.56 },
    },
    _oddsphere_source_provider: "owls",
    _oddsphere_recovery_context: "documented_prelock_observation_restore",
    _oddsphere_market_fetched_at: {
      moneyline: OBSERVED_AT,
      spread: OBSERVED_AT,
      total: OBSERVED_AT,
    },
  };
  const next = { ...payload, rows: [...rows, recovered] };
  const result = await upsertLabResponseSnapshot({
    snapshotKey: SNAPSHOT_KEY,
    kind: "daily_edge",
    payload: next,
    ttlMs: 5 * 60 * 1000,
    staleMs: 10 * 24 * 60 * 60 * 1000,
    sport: SPORT,
    source: "owls_current_splits_incident_recovery",
    payloadVersion: RELEASE,
  });
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify({ restored: true, snapshotKey: SNAPSHOT_KEY, observedAt: OBSERVED_AT, lockedAt: LOCKED_AT }));
}

void main();
