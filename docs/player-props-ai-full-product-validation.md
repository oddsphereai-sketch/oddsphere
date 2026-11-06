# Player-prop AI product: full-scope offline validation

Starting base: `6b129bb07c7ae1d5dc64d1f8718b65b3a3fee416`.
Offline contract: `player_props_ai_offline_full_product_2026_11_06_r1`.

## Intended member experience

Assess each offered player individually, covering the complete required catalog in
`ops-local/player-props-ai/catalog.ts`. NBA has all eight current core markets,
including combinations. NFL includes its existing eight markets plus passing
touchdowns and interceptions as required additions. MLB includes seventeen main
pitcher/batter markets. Existing research-only markets remain explicitly inventoried.
Additional commonly offered markets have an expansion list; the catalog is not a
claim that all customers' preferences have been researched.

There are exactly two logical reviews per game, on the Eastern game date: an early
review and a final review before the existing lock. Both examine every covered
player and market. The final review receives refreshed evidence, not merely the
early review's prose. A game-level request shares context; it does not substitute
one assessment of the game for individual player assessments. Larger games may
eventually need request partitions within the same two logical slots; their cost
and completion must be measured before adopting them.

AI can propose substantive forecast changes. A sport-specific coherent numerical
forecast must turn accepted changes into probabilities for every line, related
combination and binary event. Calibration and exact executable prices determine
grades and stakes. Self-reported AI confidence is not a calibrated win probability.
Binary touchdowns/home runs cannot be inferred from mean yardage/hits. There is no
target ratio of Overs to Unders.

## Implemented offline components

The local CLI compiles available cached NBA/NFL exports into both logical review
slots. It preserves all offered player/market identities, retains a normalized raw
quote archive, and marks unavailable sources and unsupported model heads. Missing
future boards are not counted as zero workload. It performs no network or provider
calls, reads no credentials, and imports no production writer at runtime.

`market-report.ts` computes exact-book/line price pairs and alternate-ladder research
summaries. The AI input retains the full available chronology at each selected anchor
line and a report for every offered scope. Raw alternate traces remain in local
artifacts. The summaries retain earliest/latest pairs at the anchor, representative
observed ladder pairs, ages, coverage and nonmonotonicity counts. They do not claim
to preserve every alternate-line narrative, infer money/splits, or establish who
caused a move. Anchor inference is labelled when a timestamped model line is absent.
This summary is an experimental compression candidate and needs an accuracy
comparison against fuller evidence before product adoption.

An exact reversible codec then shares repeated fields and identical values. Tests
and the CLI prove normalized-packet roundtrip, including quote precision and order.
That proves data preservation, not that a cheap AI understands the codec or that
the summary preserves all predictive information. Readable tables versus encoded
inputs must be compared in paid evaluation. Structured output requires every
player/market and checks evidence references; fabricated evidence, omitted scopes,
refusals and incomplete responses cannot be accepted as completed reviews.

`core.ts` also includes a local joint-path reweighting/pricing primitive: probabilities,
combo projections and push-aware EV can be generated from one supplied joint law.
Its fixtures are synthetic. Real qualified NBA/NFL/MLB joint-law adapters, the bridge
from AI proposals to a calibrated law, and approved sport-specific grade policies
are not implemented here. The current response schema intentionally produces
research interpretations/directions rather than invented actionable probabilities.

`validation.ts` compares paired held-out forecasts by sport, market and exact release
pair, checks issue/lock/outcome timestamps, reports Brier/log loss/calibration,
direction accuracy, exact-price unit profit, promotions, demotions and side flips.
This descriptive report does not qualify a production release. Statistical
uncertainty must account for correlated props within a game, and model selection
must occur before the held-out interval. Archived exact locked values take precedence
over retrospective reconstruction when preparing evaluation inputs.

## Cost contract

The earlier narrow-market cost estimate is not a full-product estimate. Budget
validation requires all of the following:

1. A complete monthly calendar for every in-season covered sport, including heavy
   days, plus known upper bounds for added/postponed games and retries.
2. Complete individual-player evidence and all required markets; absent NFL heads,
   MLB-season workload or availability sources cannot disappear from the estimate.
3. Actual model-specific API input counts and observed total billed output, including
   reasoning and failed/incomplete attempts. Local `o200k_base` counts are proxies.
4. Demonstrated complete, useful output at the chosen token limits and quality
   comparison for the evidence compression and model choices.
5. A whole-month plan within the agreed ceiling with allowance and evaluation reserve.

The default planner prices one inexpensive early review and one stronger final
review for every game. It can also compare an explicit allocation in which a
stronger model replaces the inexpensive final review on at most 10% of games:
set each game's `finalModel` and `maxStrongFinalFraction: 0.1`. This still gives every
game exactly two reviews and every covered player an assessment. It is not an
automatic downgrade and does not add a third review. Either model allocation needs
its own output/accuracy proof; it cannot be selected merely because it fits the bill.
The planner reserves all final reviews first. It uses standard rates, accounts
for long-context pricing conservatively at 272K input tokens, assumes no cache or
Batch discount, and includes a default 20% allowance plus $5 evaluation reserve.
An allowance is not a guarantee against unknown demand. The planner does not enforce
a production cap or authorize stopping the product halfway through a month. A plan
that fails must be redesigned before launch. Output caps are spending bounds only;
they do not prove a review can finish or retain quality.

Rates were checked on 2026-11-06 against [official pricing](https://developers.openai.com/api/docs/pricing):
GPT-6 Luna $0.10 input/$0.50 output and GPT-6.1 Terra $1 input/$5 output per million
short-context standard tokens. [Reasoning tokens](https://developers.openai.com/api/docs/guides/reasoning)
are part of billed output. The final slot cannot rely on the
[Batch API's 24-hour completion window](https://developers.openai.com/api/docs/guides/batch).
Sports-data subscriptions, hosting/database, taxes and other AI products must be
budgeted separately rather than hidden in the player-prop token estimate.

## Reproduce locally

Use an existing read-only source export; these commands make no paid calls:

```bash
node --import tsx ops-local/player-props-ai/test.ts
node --import tsx ops-local/player-props-ai/cli.ts build \
  --input=/private/tmp/props-source.json \
  --out-dir=/private/tmp/props-full-product-new-run

# Optional local proxy tokenizer; tiktoken must be installed in the operator environment.
python3 ops-local/player-props-ai/count-tokens.py \
  /private/tmp/props-full-product-new-run/manifest.json

node --import tsx ops-local/player-props-ai/cli.ts plan \
  --input=/private/tmp/complete-month-plan.json \
  --out=/private/tmp/month-plan-result.json

node --import tsx ops-local/player-props-ai/cli.ts evaluate \
  --input=/private/tmp/paired-held-out-forecasts.json \
  --out=/private/tmp/paired-result.json
```

Plan and evaluation input types are exported by `validation.ts`; their shapes and
synthetic examples are exercised in `test.ts`. Output paths must be outside the
repository and must not already exist. Local artifacts can contain private player
research and production-derived information: they are not PR contents.

## Remaining evidence before live work

The current source adapter does not provide a qualified MLB packet source. NFL
lacks individual raw game logs and opponent history in this export, and passing-TD
and interception model heads need real implementations. NBA needs timestamped
injury/lineup evidence and verified historical stat availability times. Some current
exports cannot be used to reconstruct an earlier review; they are excluded at that
cutoff and labelled. Planned future slots are scenarios, not observations of future
day-of evidence. Missing split feeds remain missing; odds movement is not money.

There is no OpenAI API key configured in this workspace. No AI generation, actual
billed usage, model comprehension, latency/reliability or accuracy improvement has
been measured by this build. Connect credentials securely through the environment
before a separately bounded paid evaluation; never place a key in chat or source.
This CLI intentionally has no paid execution path or retry loop.

After evidence, forecast adapters and budget are complete, compare the full intended
product against the frozen independent model, current member decisions and a qualified
market baseline. Include full boards, heavy slates, both directions, binary/combination
markets, every grade and paired promotion/demotion impact. Do not tune on the holdout.
Improvement is not established by a more balanced board or convincing explanations.

Any eventual production integration must use the existing sport-scoped
`prediction_pipeline` lease and sole writer, bump the affected release identifiers,
follow `docs/model-change-safety.md`, and prove exact locked-record precedence. Do
not deploy this harness, a shadow model, or candidate predictions into a production
database/cron/member snapshot. Production work requires the full repository gates,
fresh-main PR integration checks and post-deployment verification.
