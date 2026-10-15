import assert from "node:assert/strict";
import {
  parseEspnNbaSeason,
  parseNbaScoreboardPayload,
} from "../lib/providers/real_api/_espnNbaScoreboardClient";
import { nbaGameSeasonIdentity } from "../lib/services/nba/seedNbaGamesService";

assert.deepEqual(parseEspnNbaSeason({ year: 2027, type: 1, slug: "preseason" }), {
  seasonYear: 2027,
  seasonType: "preseason",
});
assert.deepEqual(parseEspnNbaSeason({ year: 2027, type: 2, slug: "regular-season" }), {
  seasonYear: 2027,
  seasonType: "regular",
});
assert.deepEqual(parseEspnNbaSeason({ year: 2027, type: 3, slug: "post-season" }), {
  seasonYear: 2027,
  seasonType: "postseason",
});
assert.deepEqual(parseEspnNbaSeason({ year: 2027, type: 99, slug: "new-phase" }), {
  seasonYear: 2027,
  seasonType: null,
});

const events = parseNbaScoreboardPayload({
  events: [
    {
      id: "401908945",
      date: "2026-10-15T23:30:00.000Z",
      season: { year: 2027, type: 1, slug: "preseason" },
      status: { type: { name: "STATUS_SCHEDULED", description: "Scheduled" } },
      competitions: [{
        competitors: [
          { id: "1", homeAway: "home", team: { id: "1", abbreviation: "DET", displayName: "Detroit Pistons" } },
          { id: "2", homeAway: "away", team: { id: "2", abbreviation: "BOS", displayName: "Boston Celtics" } },
        ],
        notes: [],
      }],
    },
  ],
});

assert.equal(events.length, 1);
assert.equal(events[0]?.season_year, 2027);
assert.equal(events[0]?.season_type, "preseason");
assert.deepEqual(nbaGameSeasonIdentity(events[0]!), {
  season: 2027,
  seasonType: "preseason",
  postseason: false,
});

assert.deepEqual(nbaGameSeasonIdentity({
  season_year: null,
  season_type: null,
  start_time: "2026-06-10T00:00:00.000Z",
  postseason_note: "NBA Finals - Game 3",
}), {
  season: 2026,
  seasonType: "postseason",
  postseason: true,
});

console.log("NBA ESPN season identity tests passed.");
