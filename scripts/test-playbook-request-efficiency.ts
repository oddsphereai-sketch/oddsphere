import assert from "node:assert/strict";

import {
  PLAYBOOK_CURRENT_CACHE_SECONDS,
  PlaybookReadBroker,
  playbookSplitsReadMode,
} from "../lib/providers/playbook/playbookReadBroker";
import {
  isPlaybookPregameCandidate,
  selectPlaybookObservationGames,
} from "../lib/services/syncPublicSplitsObservations";
import { normalizePlaybookInjuriesResponse } from "../lib/providers/playbook/playbookClient";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.PLAYBOOK_API_KEY;
let calls = 0;
let failNext = false;
const seenUrls: URL[] = [];

globalThis.fetch = async (input) => {
  calls += 1;
  if (failNext) {
    failNext = false;
    return new Response(JSON.stringify({ error: "temporary" }), { status: 503 });
  }
  const url = new URL(String(input));
  seenUrls.push(url);
  return new Response(JSON.stringify({
    league: url.searchParams.get("league"),
    count: 0,
    requestsRemaining: 100,
    data: [],
  }), { status: 200, headers: { "content-type": "application/json" } });
};

async function main(): Promise<void> {
try {
  const broker = new PlaybookReadBroker("unit-test-key", { sharedCache: false });
  const [first, second] = await Promise.all([
    broker.splits("wnba"),
    broker.splits("WNBA"),
  ]);
  assert.equal(calls, 1, "identical concurrent reads must share one upstream call");
  assert.equal(first.body.count, second.body.count);

  await broker.lines("wnba");
  await broker.splits("mlb");
  assert.equal(calls, 3, "different endpoint/league keys must remain isolated");

  const injuries = await broker.injuries("ncaaf");
  assert.equal(calls, 4);
  assert.equal(injuries.body.data.length, 0);
  assert.equal(seenUrls.at(-1)?.searchParams.get("league"), "NCAAF", "injury requests must use Playbook's canonical league identity");

  failNext = true;
  await assert.rejects(() => broker.splitsHistory("wnba", "2026-09-20"));
  await broker.splitsHistory("wnba", "2026-09-20");
  assert.equal(calls, 6, "a failed read must not poison the in-flight cache");

  process.env.PLAYBOOK_API_KEY = "unit-test-key";
  const sharedLeague = `unit-${Date.now()}`;
  const beforeShared = calls;
  await new PlaybookReadBroker("unit-test-key").splits(sharedLeague);
  await new PlaybookReadBroker("unit-test-key").splits(sharedLeague);
  assert.equal(calls - beforeShared, 2, "operator runtimes without Next cache must fall back to direct reads");

  assert.equal(playbookSplitsReadMode("2026-09-26", "2026-09-26"), "current");
  assert.equal(playbookSplitsReadMode("2026-09-27", "2026-09-26"), "current");
  assert.equal(playbookSplitsReadMode("2026-09-25", "2026-09-26"), "history");
  assert.ok(PLAYBOOK_CURRENT_CACHE_SECONDS < 15 * 60, "current cache must stay inside split freshness");

  const normalizedInjuries = normalizePlaybookInjuriesResponse({
    league: "NCAAF",
    last_updated: "2026-10-09T18:00:00Z",
    teams: [{
      team: "Florida State Seminoles",
      abbr: "FSU",
      injuries: [{
        player: "Example Quarterback",
        status: "Questionable",
        injury: "Shoulder",
        details: "Limited in practice",
        updated: "2026-10-09T17:30:00Z",
      }],
    }],
  });
  assert.deepEqual(normalizedInjuries.data, [{
    teamAbbr: "FSU",
    teamName: "Florida State Seminoles",
    players: [{ name: "Example Quarterback", status: "Questionable", reason: "Limited in practice" }],
    updatedAt: "2026-10-09T17:30:00.000Z",
    reportDate: null,
    modelAuthorityEligible: false,
  }]);
  assert.equal(normalizePlaybookInjuriesResponse({
    league: "NCAAF",
    updatedAt: "2026-10-09T18:15:00Z",
    teams: [{ team: "Empty Team", abbr: "EMP", injuries: [] }],
  }).data[0]?.updatedAt, "2026-10-09T18:15:00.000Z", "documented updatedAt sync metadata must remain supported");

  const now = new Date("2026-09-26T16:00:00Z");
  assert.equal(isPlaybookPregameCandidate({
    gameDate: "2026-09-26T17:00:00Z", status: "scheduled", seasonType: "regular",
  }, "mlb", now), true);
  assert.equal(isPlaybookPregameCandidate({
    gameDate: "2026-09-26T15:00:00Z", status: "scheduled", seasonType: "regular",
  }, "mlb", now), false, "started games must not trigger paid polling");
  assert.equal(isPlaybookPregameCandidate({
    gameDate: "2026-09-26T17:00:00Z", status: "FUT", seasonType: "preseason",
  }, "nhl", now), false, "NHL preseason must not trigger the regular product's paid polling");
  assert.equal(isPlaybookPregameCandidate({
    gameDate: "2026-09-26T17:00:00Z", status: "FUT", seasonType: "regular",
  }, "nhl", now), true);

  const startedGame = {
    id: 1,
    key: "AWAY@HOME",
    gameDate: "2026-09-25T17:00:00Z",
    status: "final",
    seasonType: "regular",
  };
  assert.equal(
    selectPlaybookObservationGames([startedGame], "mlb", now, "2026-09-25", "2026-09-26").length,
    1,
    "explicit historical repair runs must retain frozen-history coverage",
  );
  assert.equal(
    selectPlaybookObservationGames([startedGame], "mlb", now, "2026-09-26", "2026-09-26").length,
    0,
    "current slates must not keep polling after games start",
  );

  console.log("playbook request efficiency tests passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.PLAYBOOK_API_KEY;
  else process.env.PLAYBOOK_API_KEY = originalApiKey;
}
}

void main();
