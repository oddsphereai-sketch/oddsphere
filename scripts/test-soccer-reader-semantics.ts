import assert from "node:assert/strict";
import type { DailyEdgeGameDto, MarketEdgeDto } from "../app/lab/lib/labTypes";
import { soccerForecastSemantics } from "../app/lab/lib/soccerForecastSemantics";

const game = {
  awayTeam: "MAN",
  homeTeam: "HUL",
  soccerProjection: {
    matchResultOutlook: {
      expectedGoals: { away: 1.11, home: 1.24 },
      likelyScore: { away: 1, home: 1 },
      likelyScoreProbability: 0.132,
      medianTotal: 2,
      mostLikelyTotal: 2,
    },
    expectedGoals: { away: 2.03, home: 0.89 },
    goalOutlookProbabilities: {
      away: 0.6292,
      draw: 0.2247,
      home: 0.1461,
      over25: 0.5583,
      under25: 0.4417,
      bttsYes: 0.5211,
      bttsNo: 0.4789,
    },
    likelyScore: { away: 2, home: 0 },
    likelyScoreProbability: 0.1113,
    representativeScore: { away: 3, home: 0 },
    representativeScoreProbability: 0.0754,
    medianTotal: 3,
    mostLikelyTotal: 2,
  },
} satisfies Pick<DailyEdgeGameDto, "awayTeam" | "homeTeam" | "soccerProjection">;

const matchResult = {
  soccerMatchResultContext: {
    model: { away: 0.4613, draw: 0.2671, home: 0.2716 },
    market: null,
    edge_pp: null,
    displayed_side: "away",
    note: "",
  },
} satisfies Pick<MarketEdgeDto, "soccerMatchResultContext">;

const mr = soccerForecastSemantics(game, matchResult, "moneyline");
assert.equal(mr.tone, "warning", "a 16.8pp result-head gap must be visible");
assert.equal(mr.label, "Forecast heads differ");
assert.match(mr.summary ?? "", /Goal outlook: MAN 62\.9% · Match Result: MAN 46\.1%/);
assert.match(mr.explanation, /Match Result probabilities—not the goal outlook—set the result pick and grade/);

const total = soccerForecastSemantics(game, {
  soccerTotalContext: {
    projected_total: 2.92,
    line: 2.5,
    over_p: 0.5578,
    under_p: 0.4422,
    edge_pp: null,
    displayed_side: "over",
    mean_direction_side: "over",
    mean_vs_probability_disagree: false,
    note: "",
    provider_divergence: false,
  },
}, "total");
assert.equal(total.tone, "neutral", "closely aligned Total heads should be explained without an alarm");
assert.match(total.summary ?? "", /Goal outlook: Over 2\.5 55\.8% · Total: Over 2\.5 55\.8%/);
assert.match(total.explanation, /dedicated Total probabilities independently set the pick and grade/);

const btts = soccerForecastSemantics(game, {
  soccerBttsContext: {
    yes_p: 0.4778,
    no_p: 0.5222,
    market_yes: null,
    edge_pp: null,
    displayed_side: "no",
    scoring_context: "",
    note: "",
  },
}, "first_inning");
assert.equal(btts.tone, "warning", "opposite BTTS directions must remain visible even around 50%");
assert.match(btts.summary ?? "", /Goal outlook: BTTS Yes 52\.1% · BTTS: BTTS No 52\.2%/);
assert.match(btts.explanation, /BTTS probabilities—not the goal outlook—set the pick and grade/);

const legacy = soccerForecastSemantics({ ...game, soccerProjection: { ...game.soccerProjection, goalOutlookProbabilities: null } }, {}, "moneyline");
assert.equal(legacy.tone, "neutral");
assert.equal(legacy.summary, null);
assert.match(legacy.explanation, /goal outlook is scoring context/i);

console.log("Soccer reader semantics: 14 checks passed.");
