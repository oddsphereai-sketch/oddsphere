import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ESPN_NHL_AVAILABILITY_CONCURRENCY,
  ESPN_NHL_AVAILABILITY_MAX_EVENTS,
  fetchEspnNhlSlateAvailability,
} from "../lib/services/nhl/espnNhlAvailability";

async function main(): Promise<void> {
  const requests: string[] = [];
  const reports = await fetchEspnNhlSlateAvailability("2026-10-17", async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("scoreboard")) {
      return Response.json({ events: [event("401", "NJ", "WSH", "Jake Allen", "expected", "Logan Thompson", "confirmed")] });
    }
    return Response.json({ injuries: [
      { team: { abbreviation: "NJ", displayName: "New Jersey Devils" }, injuries: [] },
      {
        team: { abbreviation: "WSH", displayName: "Washington Capitals" },
        injuries: [{
          status: "Out",
          date: "2026-10-16T16:11:00Z",
          athlete: { displayName: "Pierre-Luc Dubois", position: { abbreviation: "LW" } },
          details: { type: "Illness" },
        }],
      },
    ] });
  });
  assert.equal(ESPN_NHL_AVAILABILITY_MAX_EVENTS, 20);
  assert.equal(ESPN_NHL_AVAILABILITY_CONCURRENCY, 4);
  assert.equal(requests.length, 2);
  assert.equal(reports?.length, 1);
  const report = reports?.[0];
  assert.ok(report);
  assert.equal(report.awayTeam, "NJD");
  assert.equal(report.homeTeam, "WSH");
  assert.equal(report.publishedGoalies.find((goalie) => goalie.team === "NJD")?.name, "Jake Allen");
  assert.equal(report.publishedGoalies.find((goalie) => goalie.team === "WSH")?.status, "confirmed");
  assert.deepEqual(report.teams[0]?.players.map((player) => player.status), ["Expected starter"]);
  assert.deepEqual(report.teams[1]?.players.map((player) => player.status), ["Confirmed starter", "Out"]);
  assert.equal(report.reportUpdatedAt, "2026-10-16T16:11:00.000Z");

  const unverifiedInjuries = await fetchEspnNhlSlateAvailability("2026-10-17", async (input) => {
    if (String(input).includes("scoreboard")) {
      return Response.json({ events: [event("402", "LA", "SJ", "Darcy Kuemper", "expected", "Yaroslav Askarov", "expected")] });
    }
    throw new Error("summary unavailable");
  });
  assert.deepEqual(unverifiedInjuries, [], "goalie rows cannot certify a missing injury report");

  const oneSided = await fetchEspnNhlSlateAvailability("2026-10-17", async (input) => {
    if (String(input).includes("scoreboard")) {
      return Response.json({ events: [event("403", "LA", "SJ", "Darcy Kuemper", "expected", "Yaroslav Askarov", "expected")] });
    }
    return Response.json({ injuries: [{ team: { abbreviation: "LA", displayName: "Los Angeles Kings" }, injuries: [] }] });
  });
  assert.deepEqual(oneSided, [], "both exact matchup teams must publish injury groups");

  const tooMany = await fetchEspnNhlSlateAvailability("2026-10-17", async () =>
    Response.json({ events: Array.from({ length: 21 }, (_, index) => event(String(index), "NJ", "WSH", "A", "expected", "B", "expected")) }));
  assert.equal(tooMany, null);

  for (const path of [
    "app/api/cron/nhl-daily-refresh/route.ts",
    "app/api/cron/pregame-sweep/route.ts",
    "scripts/operator/nhl/write-nhl-prediction-records.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /current_roster_prior_gp/);
    assert.doesNotMatch(source, /goalieSource:\s*"default_most_playoff_gp"/);
  }
  assert.match(
    readFileSync("app/api/cron/nhl-daily-refresh/route.ts", "utf8"),
    /nhl_daily_refresh_schedule_2026_10_27_r14_owls_current_odds/,
  );

  console.log("ESPN NHL availability tests passed");
}

function event(
  id: string,
  away: string,
  home: string,
  awayGoalie: string,
  awayStatus: string,
  homeGoalie: string,
  homeStatus: string,
) {
  const competitor = (homeAway: "home" | "away", abbreviation: string, goalie: string, status: string) => ({
    homeAway,
    team: { abbreviation, displayName: abbreviation },
    probables: [{
      name: "probableStartingGoalie",
      athlete: { displayName: goalie, position: "G" },
      status: { type: status, name: status },
    }],
  });
  return {
    id,
    competitions: [{ competitors: [
      competitor("home", home, homeGoalie, homeStatus),
      competitor("away", away, awayGoalie, awayStatus),
    ] }],
  };
}

void main();
