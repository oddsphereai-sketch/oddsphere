export const NFL_MARKET_BRAIN_BEHAVIOR_SCENARIO_RELEASE =
  "nfl_market_brain_behavior_scenarios_2026_10_26_r1" as const;

export type MarketBrainAction = "confirm" | "recenter" | "flip" | "fade_market" | "retain" | "stand_down";
export type NflMarketStory =
  | "genuine_discovery" | "follow_through" | "resistance" | "reversal_buyback"
  | "retail_only_steam" | "split_price_disagreement" | "cross_market_contradiction"
  | "news_sequence" | "source_outage" | "target_book_isolation" | "stale_evidence"
  | "key_number_transition";

export type NflMarketBrainBehaviorScenario = {
  id: string;
  story: NflMarketStory;
  market: "moneyline" | "spread" | "total" | "joint_side";
  observableStory: string[];
  context: string[];
  preferredAction: MarketBrainAction;
  acceptableActions: MarketBrainAction[];
  forbiddenActions: MarketBrainAction[];
  certainty: "increase" | "decrease" | "unchanged";
  rationale: string;
};

/** Frozen evaluation stories, not executable rules or a points table. */
export const NFL_MARKET_BRAIN_BEHAVIOR_SCENARIOS: NflMarketBrainBehaviorScenario[] = [
  {
    id: "professional_discovery_then_independent_follow_through", story: "genuine_discovery", market: "joint_side",
    observableStory: ["professional book moves first", "independent books follow later", "move persists", "moneyline and spread agree"],
    context: ["no material availability event precedes the move", "no late reversal or buyback"],
    preferredAction: "confirm", acceptableActions: ["confirm", "recenter"], forbiddenActions: ["fade_market"], certainty: "increase",
    rationale: "Observed leadership, independent follow-through, persistence, and cross-market coherence support the discovered side without requiring blind copying.",
  },
  {
    id: "professional_move_meets_broad_resistance", story: "resistance", market: "joint_side",
    observableStory: ["professional book moves", "target-excluded market does not follow", "other books improve the opposite side", "moneyline and spread remain opposed"],
    context: ["no identity or freshness defect explains the disagreement"],
    preferredAction: "stand_down", acceptableActions: ["stand_down", "retain", "fade_market"], forbiddenActions: ["flip"], certainty: "decrease",
    rationale: "A respected source is evidence, but verified resistance and cross-market disagreement make automatic following unjustified.",
  },
  {
    id: "steam_reverses_and_buys_back_to_open", story: "reversal_buyback", market: "spread",
    observableStory: ["early move away from opening", "later reversal", "market returns near opening", "late prices favor the original side"],
    context: ["chronology is same-event and same-book coherent"],
    preferredAction: "fade_market", acceptableActions: ["fade_market", "retain", "stand_down"], forbiddenActions: ["confirm"], certainty: "decrease",
    rationale: "The full path contradicts treating the first move as permanent information and can favor the independent forecast or no action.",
  },
  {
    id: "retail_only_steam_without_professional_confirmation", story: "retail_only_steam", market: "spread",
    observableStory: ["retail books move together", "professional books remain static", "retail price worsens after public concentration"],
    context: ["professional feeds are fresh rather than missing"],
    preferredAction: "retain", acceptableActions: ["retain", "stand_down", "fade_market"], forbiddenActions: ["flip"], certainty: "unchanged",
    rationale: "Retail synchronization alone is not proof of sharp discovery when fresh professional markets resist it.",
  },
  {
    id: "identified_money_split_opposes_price_path", story: "split_price_disagreement", market: "spread",
    observableStory: ["identified book reports more money than bets on one side", "that book's number and price move the other way"],
    context: ["absolute handle, ticket count, limits, and exact-line denominator are unknown"],
    preferredAction: "stand_down", acceptableActions: ["stand_down", "retain"], forbiddenActions: ["flip", "confirm"], certainty: "decrease",
    rationale: "Percentage splits without economic path confirmation cannot overrule price action or manufacture sharp authority.",
  },
  {
    id: "moneyline_favorite_strengthens_while_spread_moves_to_dog", story: "cross_market_contradiction", market: "joint_side",
    observableStory: ["favorite moneyline probability rises", "spread moves toward underdog", "both paths are fresh and target-excluded"],
    context: ["no key player or settlement difference explains the divergence"],
    preferredAction: "stand_down", acceptableActions: ["stand_down", "recenter"], forbiddenActions: ["flip", "confirm"], certainty: "decrease",
    rationale: "Winner and cover information differ; the resolver must preserve that distinction rather than forcing one directional vote.",
  },
  {
    id: "availability_news_precedes_market_move", story: "news_sequence", market: "joint_side",
    observableStory: ["verified quarterback status changes", "market moves after the report", "books follow with consistent timestamps"],
    context: ["independent prior has not incorporated the new availability state"],
    preferredAction: "recenter", acceptableActions: ["recenter", "flip", "stand_down"], forbiddenActions: ["fade_market"], certainty: "increase",
    rationale: "The sequence supports information-driven repricing, but magnitude and boundary crossing must come from the learned joint distribution.",
  },
  {
    id: "verified_news_and_joint_reprice_cross_the_prediction_boundary", story: "news_sequence", market: "joint_side",
    observableStory: ["independent forecast starts on home side", "verified quarterback downgrade arrives", "professional moneyline and spread reprice to away side", "independent books follow and hold"],
    context: ["news precedes the move", "target-excluded winner and cover states agree", "no reversal or buyback appears"],
    preferredAction: "flip", acceptableActions: ["flip", "recenter", "stand_down"], forbiddenActions: ["fade_market"], certainty: "increase",
    rationale: "A coherent information event can invalidate the original side; the resolver must be capable of crossing the prediction boundary when the learned posterior supports it.",
  },
  {
    id: "professional_split_source_missing_but_prices_cohere", story: "source_outage", market: "total",
    observableStory: ["identified split source unavailable", "fresh professional price books agree", "retail books follow", "total path persists"],
    context: ["missing split is explicit rather than zero", "price identities and timestamps are valid"],
    preferredAction: "confirm", acceptableActions: ["confirm", "recenter", "stand_down"], forbiddenActions: [], certainty: "increase",
    rationale: "A missing modality reduces information but does not veto coherent observable price discovery from the remaining sources.",
  },
  {
    id: "stale_split_disagrees_with_fresh_prices", story: "stale_evidence", market: "total",
    observableStory: ["old split points over", "fresh multi-book total path points under", "under move persists"],
    context: ["split age is known", "fresh prices are same-event and complete"],
    preferredAction: "confirm", acceptableActions: ["confirm", "recenter"], forbiddenActions: ["flip"], certainty: "increase",
    rationale: "Stale percentage evidence must not receive the same authority as the fresh economic path.",
  },
  {
    id: "evaluated_book_moves_alone", story: "target_book_isolation", market: "moneyline",
    observableStory: ["evaluated book changes price", "target-excluded books remain static", "no independent follow-through appears"],
    context: ["evaluated quote remains distinct from model evidence"],
    preferredAction: "retain", acceptableActions: ["retain", "stand_down"], forbiddenActions: ["flip", "confirm"], certainty: "unchanged",
    rationale: "An isolated target-book adjustment can change offered value without proving a new market state.",
  },
  {
    id: "spread_crosses_key_number_with_price_confirmation", story: "key_number_transition", market: "spread",
    observableStory: ["professional spread crosses a football key number", "price pressure precedes number move", "independent books follow", "new level holds"],
    context: ["no reversal or buyback", "moneyline winner direction is coherent"],
    preferredAction: "recenter", acceptableActions: ["recenter", "flip", "confirm"], forbiddenActions: ["fade_market"], certainty: "increase",
    rationale: "A persistent, economically confirmed key-number transition can justify a material distribution change without a fixed point award.",
  },
  {
    id: "professional_price_feed_missing_and_retail_books_disagree", story: "source_outage", market: "joint_side",
    observableStory: ["professional price feeds unavailable", "retail books disagree", "split books disagree", "target-excluded consensus is unstable"],
    context: ["missing sources are explicit", "independent prior remains available"],
    preferredAction: "stand_down", acceptableActions: ["stand_down", "retain"], forbiddenActions: ["flip", "confirm"], certainty: "decrease",
    rationale: "The correct response to an unidentifiable market state is uncertainty, not fabricated consensus or forced sharp alignment.",
  },
];
