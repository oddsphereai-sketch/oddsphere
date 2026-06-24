/**
 * WNBA Playbook Step A route smoke (READ-ONLY).
 *
 * Calls the real /api/lab/daily-edge GET handler against the configured DB:
 *   - WNBA returns cards with Playbook-backed publicSplits on ML.
 *   - MLB still renders through the unchanged route path.
 *   - Soccer/World Cup path still returns cleanly.
 *
 * No DB writes, no provider writes, no browser required.
 */

import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
process.env.PRODUCTION_DATA_MODE = process.env.PRODUCTION_DATA_MODE ?? "true";

type MarketLike = {
  publicSplits?: Array<{
    side?: string | null;
    label?: string | null;
    moneyPct?: number | null;
    betsPct?: number | null;
    observedAt?: string | null;
    isStale?: boolean | null;
  }>;
};

type GameLike = {
  awayTeam?: string;
  homeTeam?: string;
  markets?: {
    moneyline?: MarketLike;
    total?: MarketLike;
    first_inning?: MarketLike;
  };
};

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function ok(message: string, condition: boolean): void {
  if (!condition) fail(message);
  console.log(`✓ ${message}`);
}

function gamesFrom(body: unknown): GameLike[] {
  const b = body as { games?: unknown; cards?: unknown };
  const games = Array.isArray(b.games) ? b.games : Array.isArray(b.cards) ? b.cards : [];
  return games as GameLike[];
}

async function route(sport: string, date?: string): Promise<{ status: number; body: unknown; games: GameLike[] }> {
  const { GET } = await import("../../app/api/lab/daily-edge/route");
  const url = new URL("https://x/api/lab/daily-edge");
  url.searchParams.set("sport", sport);
  if (date) url.searchParams.set("date", date);
  const res = await GET(new Request(url));
  const body = await res.json();
  return { status: res.status, body, games: gamesFrom(body) };
}

(async () => {
  const wnbaDate = process.argv.includes("--date")
    ? process.argv[process.argv.indexOf("--date") + 1]
    : "2026-06-24";

  const wnba = await route("wnba", wnbaDate);
  ok(`WNBA route ${wnbaDate} returns 200`, wnba.status === 200);
  ok(`WNBA route ${wnbaDate} returns games`, wnba.games.length > 0);
  const wnbaWithMlSplits = wnba.games.filter(
    (g) => (g.markets?.moneyline?.publicSplits ?? []).length >= 2
  );
  ok(
    `WNBA ML publicSplits present on every returned game (${wnbaWithMlSplits.length}/${wnba.games.length})`,
    wnbaWithMlSplits.length === wnba.games.length
  );
  for (const g of wnba.games) {
    const splits = g.markets?.moneyline?.publicSplits ?? [];
    ok(
      `WNBA ${g.awayTeam ?? "?"}@${g.homeTeam ?? "?"} ML splits have numeric bet/money pct`,
      splits.every(
        (s) =>
          (s.betsPct === null || typeof s.betsPct === "number") &&
          (s.moneyPct === null || typeof s.moneyPct === "number")
      )
    );
  }

  const mlb = await route("mlb", wnbaDate);
  ok(`MLB route ${wnbaDate} returns 200`, mlb.status === 200);
  ok(`MLB route ${wnbaDate} still returns games`, mlb.games.length > 0);

  const soccer = await route("soccer", wnbaDate);
  ok(`Soccer/World Cup route ${wnbaDate} returns 200`, soccer.status === 200);
  console.log(`Soccer/World Cup route games=${soccer.games.length} (0 is acceptable if no visible slate)`);

  const wnbaDefault = await route("wnba");
  ok("WNBA default-date route returns 200", wnbaDefault.status === 200);
  console.log(`WNBA default-date route games=${wnbaDefault.games.length}`);

  console.log("\nWNBA Playbook route smoke passed.");
})().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
