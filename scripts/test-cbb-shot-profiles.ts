import assert from "node:assert/strict";
import { applyCbbShotHead, CBB_SHOT_FEATURE_NAMES, enrichCbbShotProfiles, fitCbbShotHead } from "../lib/cbb/shotProfileResearch";
import { CBB_DEVELOPMENT_UNCERTAINTY } from "../lib/cbb/evaluation";
import { CBB_CANDIDATES, cbbThresholdProbabilities, fitCbbRatings, forecastCbbGame } from "../lib/cbb/model";
import type { CbbBox, CbbTrainingGame } from "../lib/cbb/types";

const fixture = (id: number, date: string, season: number): CbbTrainingGame => ({ id, date, season, homeId: 1, awayId: 2,
  homeScore: 80, awayScore: 70, homeRegulation: 80, awayRegulation: 70, overtime: false, possessions: 70, tempo: 70, neutral: false,
  homeFactors: { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 },
  awayFactors: { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 } });
const history = [fixture(1, "2023-03-01T00:00:00Z", 2022), fixture(2, "2023-11-03T00:00:00Z", 2023),
  fixture(3, "2023-11-05T23:00:00Z", 2023), fixture(4, "2023-11-06T18:00:00Z", 2023), fixture(5, "2023-12-01T00:00:00Z", 2023)];
const boxes: CbbBox[] = history.flatMap(game => [1, 2].map(id => ({ game, team: { id, conference_id: 1, name: `Team ${id}`, full_name: `Team ${id}`, college: `Team ${id}`, abbreviation: `T${id}` },
  fgm: 25, fga: 60, fg3m: 8, fg3a: 24, ftm: 12, fta: 17, oreb: 10, dreb: 25, turnovers: 12 })));
const state = fitCbbRatings(history, { season: 2023, asOf: "2023-11-06T00:00:00Z", config: CBB_CANDIDATES[0] });
const row = { game: history[3], forecast: forecastCbbGame(state, history[3], CBB_DEVELOPMENT_UNCERTAINTY), features: [1, ...Array(18).fill(0)] };
const enriched = enrichCbbShotProfiles([row], history, boxes)[0];
assert.equal(enriched.features.length, 19 + CBB_SHOT_FEATURE_NAMES.length);
assert.ok(enriched.features.every(Number.isFinite));
const changedBoxes = boxes.map(box => box.game.id >= 3 ? { ...box, fg3a: 50, fg3m: 30, fga: 80, fgm: 45 } : box);
assert.deepEqual(enrichCbbShotProfiles([row], history, changedBoxes)[0].features, enriched.features, "six-hour unfinished, target and future outcomes cannot enter profiles");
const altered = boxes.map(box => box.game.id === 2 ? { ...box, fg3a: 40 } : box);
assert.notDeepEqual(enrichCbbShotProfiles([row], history, altered)[0].features, enriched.features, "eligible prior shooting mix must affect features");
assert.throws(() => enrichCbbShotProfiles([{ ...row, forecast: { ...row.forecast, asOf: "2023-11-07T00:00:00Z" } }], history, boxes), /as-of/);
const train = Array.from({ length: 220 }, (_, i) => ({ ...enriched, features: enriched.features.map((v, j) => j === 1 ? i % 10 : v) }));
const head = fitCbbShotHead(train, 2023, 10, "huber");
assert.throws(() => applyCbbShotHead([enriched], head), /in-sample/);
assert.throws(() => fitCbbShotHead(train, 2022, 10, "huber"), /chronology/);
assert.throws(() => fitCbbShotHead(train.map((r, i) => i ? r : { ...r, features: [NaN] }), 2023, 10, "huber"), /features/);
const evaluation = { ...enriched, game: { ...enriched.game, season: 2024 } };
const a = applyCbbShotHead([evaluation], head)[0].forecast;
assert.deepEqual(a, applyCbbShotHead([evaluation], JSON.parse(JSON.stringify(head)))[0].forecast);
assert.ok(Math.abs(a.homeScore + a.awayScore - a.total) < 1e-10);
assert.ok(Math.abs(a.homeScore - a.awayScore - a.margin) < 1e-10);
assert.ok(Math.abs(cbbThresholdProbabilities(a, "spread", 0).first - a.homeWinProbability) < 1e-10);
console.log("CBB shot profiles: chronology, six-hour holdback, current/future exclusion, causal sensitivity, serialization and coherent score/markets passed.");
