import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKET_BRAIN_ACTIONS,
  NFL_MARKET_BRAIN_BEHAVIOR_SCENARIOS,
  type MarketBrainAction,
  type NflMarketStory,
} from "../lib/services/marketBrain/nflMarketBrainBehaviorScenarios";
import { evaluateBehaviorScenarioDistribution } from "../lib/services/marketBrain/nflMarketBrainResolverContract";

const scenarios = NFL_MARKET_BRAIN_BEHAVIOR_SCENARIOS;
assert.equal(new Set(scenarios.map((row) => row.id)).size, scenarios.length, "scenario ids must be unique");
const requiredStories: NflMarketStory[] = [
  "genuine_discovery", "resistance", "reversal_buyback", "retail_only_steam",
  "split_price_disagreement", "cross_market_contradiction", "news_sequence",
  "source_outage", "target_book_isolation", "stale_evidence", "key_number_transition",
];
for (const story of requiredStories) assert.ok(scenarios.some((row) => row.story === story), `missing story: ${story}`);
for (const scenario of scenarios) {
  assert.ok(scenario.observableStory.length > 0 && scenario.context.length > 0);
  assert.ok(scenario.acceptableActions.includes(scenario.preferredAction));
  assert.ok(scenario.forbiddenActions.every((action) => !scenario.acceptableActions.includes(action)));
  assert.ok(scenario.rationale.length > 40);
  const expectedMass = Object.values(scenario.expectedActionDistribution);
  assert.ok(expectedMass.every((probability) => probability > 0 && probability < 1),
    "scenario distributions must express uncertainty rather than one-hot rules");
  assert.ok(Math.abs(expectedMass.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-9);
  assert.deepEqual(Object.keys(scenario.expectedActionDistribution).sort(), [...MARKET_BRAIN_ACTIONS].sort());
  const score = evaluateBehaviorScenarioDistribution(scenario, scenario.expectedActionDistribution);
  assert.equal(score.passed, true);
  assert.equal(score.preferredIsJointMaximum, true);
  const forbiddenOnly = Object.fromEntries(MARKET_BRAIN_ACTIONS.map((action) =>
    [action, action === (scenario.forbiddenActions[0] ?? MARKET_BRAIN_ACTIONS.find((candidate) => candidate !== scenario.preferredAction)) ? 1 : 0],
  )) as typeof scenario.expectedActionDistribution;
  assert.equal(evaluateBehaviorScenarioDistribution(scenario, forbiddenOnly).passed, false,
    "a resolver cannot pass a frozen story by concentrating on a forbidden or non-preferred action");
}
const actions = new Set<MarketBrainAction>(scenarios.map((row) => row.preferredAction));
for (const action of ["confirm", "recenter", "flip", "fade_market", "retain", "stand_down"] as const) {
  assert.ok(actions.has(action), `behavior corpus must exercise ${action}`);
}
assert.ok(scenarios.some((row) => row.story === "source_outage" && row.preferredAction === "confirm"));
assert.ok(scenarios.some((row) => row.story === "source_outage" && row.preferredAction === "stand_down"),
  "missing data must be interpreted in context rather than mapped to one automatic action");

const source = readFileSync("lib/services/marketBrain/nflMarketBrainBehaviorScenarios.ts", "utf8");
assert.doesNotMatch(source, /(?:three|four|two)\s+(?:of|out of)\s+(?:three|four)|minimumSignals|signalCount|points?\s*[+=>]/i,
  "the behavior corpus must not become a disguised signal quota or points table");

console.log("NFL Market Brain frozen behavior scenarios: 13 probabilistic follow/fade/uncertainty stories without vote quotas passed");
