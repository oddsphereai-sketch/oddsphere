import assert from "node:assert/strict";
import {
  CFB_ESPN_INJURY_NEWS_MAX_REQUESTS,
  fetchCfbEspnInjuryNewsAvailability,
  parseCfbEspnInjuryNewsAvailability,
} from "../lib/services/football/cfbEspnInjuryNewsAvailability";
import { buildCfbGameAvailability } from "../lib/services/football/cfbGameAvailability";
import { cfbAvailabilityReportForModel } from "../lib/services/football/cfbForwardEvidenceWriter";
import type { NcaafGame } from "../lib/services/football/balldontlieNcaafSlate";

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const ohioStateGame = game("osu-week-8", 194, "Ohio State Buckeyes", "OSU", 84, "Indiana Hoosiers", "IU", "2026-10-24T19:30:00.000Z");
  const uclaGame = game("ucla-week-8", 26, "UCLA Bruins", "UCLA", 30, "USC Trojans", "USC", "2026-10-25T00:00:00.000Z");

  const accepted = parseCfbEspnInjuryNewsAvailability({
  games: [ohioStateGame, uclaGame],
  capturedAt: "2026-10-21T18:00:00.000Z",
  json: { articles: [
    article({
      headline: "Ohio State QB Julian Sayin out 'several weeks' with shoulder injury",
      description: "Ohio State's Julian Sayin will miss several weeks with an injury to his throwing shoulder.",
      published: "2026-10-21T15:55:30Z",
      teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
    }),
    article({
      headline: "UCLA QB Nico Iamaleava to undergo season-ending knee surgery",
      description: "UCLA quarterback Nico Iamaleava will sit out the rest of the season.",
      published: "2026-10-20T02:15:03Z",
      teams: [{ description: "UCLA Bruins", abbreviation: "UCLA", shortDisplayName: "UCLA" }],
    }),
    article({
      headline: "Indiana is no longer a team looking for moral victories",
      description: "The Hoosiers are out to prove a point.",
      published: "2026-10-21T10:00:00Z",
      teams: [{ description: "Indiana Hoosiers", abbreviation: "IU", shortDisplayName: "Indiana" }],
    }),
    article({
      headline: "Ohio State-Indiana preview: Who has the edge?",
      description: "The quarterback injury will shape Saturday's matchup.",
      published: "2026-10-21T11:00:00Z",
      teams: [
        { description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" },
        { description: "Indiana Hoosiers", abbreviation: "IU", shortDisplayName: "Indiana" },
      ],
    }),
  ] },
});
  assert.equal(accepted.requests, 0);
  assert.equal(accepted.articlesRead, 4);
  assert.equal(accepted.acceptedPlayers, 2);
  assert.deepEqual(accepted.reportsByGame[ohioStateGame.providerGameId]?.teams[0]?.players[0], {
  name: "Julian Sayin",
  status: "Out",
  detail: "Ohio State QB Julian Sayin out 'several weeks' with shoulder injury",
  position: "QB",
  reportedAt: "2026-10-21T15:55:30.000Z",
  });
  assert.equal(accepted.reportsByGame[uclaGame.providerGameId]?.teams[0]?.players[0]?.status, "Out");

  const questionable = parseCfbEspnInjuryNewsAvailability({
  games: [ohioStateGame],
  capturedAt: "2026-10-21T18:00:00.000Z",
  json: { articles: [article({
    headline: "Ohio State WR Jordan Receiver questionable with ankle injury",
    description: "Jordan Receiver is questionable for Saturday.",
    published: "2026-10-21T16:00:00Z",
    teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
  })] },
});
  assert.equal(questionable.reportsByGame[ohioStateGame.providerGameId]?.teams[0]?.players[0]?.status, "Questionable");

  const latestStatus = parseCfbEspnInjuryNewsAvailability({
    games: [ohioStateGame],
    capturedAt: "2026-10-21T18:00:00.000Z",
    json: { articles: [
      article({
        headline: "Ohio State WR Jordan Receiver out with ankle injury",
        description: "Jordan Receiver has been ruled out.",
        published: "2026-10-21T14:00:00Z",
        teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
      }),
      article({
        headline: "Ohio State WR Jordan Receiver available after ankle injury",
        description: "Jordan Receiver has been cleared to play.",
        published: "2026-10-21T17:00:00Z",
        teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
      }),
    ] },
  });
  assert.equal(latestStatus.reportsByGame[ohioStateGame.providerGameId]?.teams[0]?.players[0]?.status, "Available");

  const postKickoff = parseCfbEspnInjuryNewsAvailability({
  games: [ohioStateGame],
  capturedAt: "2026-10-25T00:00:00.000Z",
  json: { articles: [article({
    headline: "Ohio State QB Julian Sayin out with shoulder injury",
    description: "Julian Sayin is out.",
    published: "2026-10-24T20:00:00Z",
    teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
  })] },
});
  assert.deepEqual(postKickoff.reportsByGame, {}, "post-kickoff news cannot rewrite pregame evidence");

  const stale = parseCfbEspnInjuryNewsAvailability({
    games: [ohioStateGame],
    capturedAt: "2026-10-21T18:00:00.000Z",
    json: { articles: [article({
      headline: "Ohio State QB Julian Sayin out with shoulder injury",
      description: "Julian Sayin is out.",
      published: "2026-09-01T16:00:00Z",
      teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
    })] },
  });
  assert.deepEqual(stale.reportsByGame, {}, "ordinary statuses older than 21 days must fail closed");

  const ambiguous = parseCfbEspnInjuryNewsAvailability({
  games: [ohioStateGame],
  capturedAt: "2026-10-21T18:00:00.000Z",
  json: { articles: [article({
    headline: "QB Alex Example ruled out for Saturday",
    description: "Alex Example has been ruled out.",
    published: "2026-10-21T16:00:00Z",
    teams: [
      { description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" },
      { description: "Indiana Hoosiers", abbreviation: "IU", shortDisplayName: "Indiana" },
    ],
  })] },
});
  assert.deepEqual(ambiguous.reportsByGame, {}, "multi-team attribution without a unique headline team must fail closed");

  const publicNews = accepted.reportsByGame[ohioStateGame.providerGameId]!;
  assert.equal(buildCfbGameAvailability({
  game: ohioStateGame,
  capturedAt: "2026-10-21T18:00:00.000Z",
  playbookRows: [],
  publicNewsReport: publicNews,
  })?.source, "ESPN");
  const official = { ...publicNews, source: "Conference" as const, reportUpdatedAt: "2026-10-21T14:00:00.000Z" };
  assert.equal(buildCfbGameAvailability({
  game: ohioStateGame,
  capturedAt: "2026-10-21T18:00:00.000Z",
  playbookRows: [],
  conferenceReport: official,
  publicNewsReport: publicNews,
  })?.source, "Conference", "official conference evidence retains source precedence");
  assert.equal(buildCfbGameAvailability({
    game: ohioStateGame,
    capturedAt: "2026-10-21T18:00:00.000Z",
    playbookRows: [],
    publicNewsReport: publicNews,
    previous: official,
  })?.source, "Conference", "lower-authority news cannot displace retained official evidence");

  const national = { ...publicNews, source: "SportsDataIO" as const, reportUpdatedAt: "2026-10-21T17:00:00.000Z" };
  assert.equal(buildCfbGameAvailability({
    game: ohioStateGame,
    capturedAt: "2026-10-21T18:00:00.000Z",
    playbookRows: [],
    publicNewsReport: publicNews,
    nationalReport: national,
  })?.source, "ESPN", "public news precedes the optional national wire");
  assert.equal(cfbAvailabilityReportForModel(publicNews), null, "public injury news has zero model authority");
  assert.equal(cfbAvailabilityReportForModel(official), null, "conference panels retain zero model authority");
  assert.equal(cfbAvailabilityReportForModel(national), null, "optional national panels retain zero model authority");
  const playbook = { ...publicNews, source: "Playbook" as const };
  assert.equal(cfbAvailabilityReportForModel(playbook), playbook, "existing qualified Playbook authority is unchanged");

  let requests = 0;
  const fetched = await fetchCfbEspnInjuryNewsAvailability({
  games: [ohioStateGame],
  capturedAt: "2026-10-21T18:00:00.000Z",
  fetchImpl: async (_input, init) => {
    requests += 1;
    assert.equal(init?.cache, "no-store");
    return Response.json({ articles: [article({
      headline: "Ohio State QB Julian Sayin out 'several weeks' with shoulder injury",
      description: "Julian Sayin will miss several weeks.",
      published: "2026-10-21T15:55:30Z",
      teams: [{ description: "Ohio State Buckeyes", abbreviation: "OSU", shortDisplayName: "Ohio State" }],
    })] });
  },
  });
  assert.equal(requests, CFB_ESPN_INJURY_NEWS_MAX_REQUESTS);
  assert.equal(fetched.requests, CFB_ESPN_INJURY_NEWS_MAX_REQUESTS);
  assert.equal(fetched.acceptedPlayers, 1);

  console.log("CFB ESPN public injury-news availability tests passed.");
}

function article(args: {
  headline: string;
  description: string;
  published: string;
  teams: Array<{ description: string; abbreviation: string; shortDisplayName: string }>;
}): unknown {
  return {
    headline: args.headline,
    description: args.description,
    published: args.published,
    links: { web: { href: "https://www.espn.com/college-football/story/_/id/123/test" } },
    categories: args.teams.map((team) => ({ type: "team", description: team.description, team })),
  };
}

function game(
  providerGameId: string,
  awayId: number,
  awayName: string,
  awayAbbreviation: string,
  homeId: number,
  homeName: string,
  homeAbbreviation: string,
  scheduledStart: string,
): NcaafGame {
  return {
    providerGameId,
    providerWeek: 8,
    season: 2026,
    scheduledStart,
    status: "scheduled",
    awayScore: null,
    homeScore: null,
    away: { id: awayId, conferenceId: null, abbreviation: awayAbbreviation, name: awayName, fbs: true },
    home: { id: homeId, conferenceId: null, abbreviation: homeAbbreviation, name: homeName, fbs: true },
  };
}
