# NBA shared model and market-reader standard

Date: 2026-10-15  
Status: research contract; no production promotion authorized

## Decision

NBA must not grow a separate interpretation stack. It inherits the repository's strongest shared
contracts and adds only basketball-specific forecast features and empirically cleared NBA market
authority. The member card may remain visually simple, while every observation retains provider,
source book, source type, source-observed time, fetched time, exact line, exact price, freshness,
fallback status, and decision eligibility internally.

The required order is:

1. immutable timestamped source observations;
2. leakage-safe independent NBA score forecast;
3. calibrated joint score/margin/total distribution;
4. target-excluded, exact-line market state;
5. NBA-specific qualified authority or explicit unavailability;
6. exact-price EV and symmetric grade rules;
7. one coherent score/side/line/price tuple;
8. immutable pregame lock;
9. release-pure grading and residual ledgers.

Market evidence may confirm, resist, or leave the model-led decision unchanged. It cannot silently
become a model input, be called "sharp" without provenance, or overwrite a locked public record.

## Why the published r1 replay was not auditable enough

The published 2025-26 confirmation summary reported 1,230 games, 9.6001 team-score MAE, 10.9252
margin MAE, 15.6065 total MAE, and 64.80% winner accuracy. The audit operator printed only aggregate
metrics. It did not retain its temporary input, selected parameter artifact, game predictions, signed
residuals, or error cohorts. Therefore the exact 64.80% run cannot now be honestly divided into
systematic error and variance.

That is a process defect, not evidence that the result was invalid. The replacement tournament now
makes the following artifacts mandatory:

- one JSONL row per confirmation game, including selected pregame feature state;
- separate winner, spread, and total error ledgers;
- signed and absolute score, margin, and total residuals;
- month, predicted-margin, confidence, rest, error-context, and team cohorts;
- the 25 worst score, margin, and total misses;
- hashes and row counts in the parent report;
- no "luck" attribution without timestamp-valid postgame component evidence.

## Reconstructed r1 score-path evidence

The original temporary CSV is gone. A restricted reconstruction combines the same public odds
database schema used by the old replay for 2023-24 and 2024-25 with the complete 1,230-game BDL
2025-26 regular-season result capture. It has exact market rows for only 553 confirmation games, so
it is eligible for independent-score diagnosis only and is ineligible to restate season Spread or
Total performance.

The reconstruction selected a closely related residual state model and produced 9.511 team-score
MAE, 11.391 margin MAE, 15.050 total MAE, and 68.37% winner accuracy. Because this is not an exact
reproduction of the published aggregates, its cohorts are directional diagnostic evidence, not a
replacement claim about r1.

The most important findings are:

- Global signed bias is small: -0.26 points per team, -0.22 home-margin points, and -0.53 total
  points. A blanket score shift will not solve the error. The weakness is conditional error and
  outcome variance.
- October totals were underpredicted by 7.52 points on average with 18.22 total MAE across 80 games.
  This is a concrete early-season handoff defect to test, not a reason to add a universal total bump.
- December winner accuracy fell to 57.87% across 197 games, versus 75.31% in March. Month and season
  phase must be explicit validation cohorts.
- Games projected within three points were only 54.29% correct and had 12.08 margin MAE across 385
  games. These are uncertainty cases; the model should compress confidence rather than force a side.
- Games with projected margins of at least seven points had materially better winner direction
  (77.05% at 7-11.99; 83.87% at 12+), but still carried roughly 10.9-11.8 margin MAE. Winner direction
  and spread precision cannot share one confidence claim.
- The largest margin misses are blowout-tail events, while the largest total misses include both
  extreme shooting nights and extreme low totals. Result surprise alone cannot distinguish variance
  from a missed availability, rotation, pace, shooting, rebounding, or turnover state.

The next full replay must join postgame advanced and box components to the pregame ledger. It should
decompose large residuals into realized effective field-goal rate, turnover rate, offensive rebound
rate, free-throw rate, possessions, player availability, and rotation concentration. A miss may be
classified as outcome variance only when the pregame inputs were complete and the realized components
were themselves tail events. Otherwise it remains an unresolved model/data miss.

## Market-reader parity audit

| Contract | Strongest existing implementation | NBA now | Required NBA state |
| --- | --- | --- | --- |
| Exact same-book, same-line two-sided no-vig | WNBA target-excluded decision; CFB exact-price decision | Present in `coherentNoVigReference` | Keep and make target exclusion explicit for the evaluated book family |
| Immutable book-by-book price/number history | NFL market state and named sequence; WNBA price trail | Partial `line_history`; NBA adapter exposes earliest picked-side price only | Store/replay exact number and price per book, side, and timestamp |
| Opener vs first tracked | Market Intelligence v2 | NBA calls earliest observation an open price | Preserve basis and never relabel first-tracked as provider opener |
| Movement chronology, persistence, reversal, buyback | NFL professional authority | Absent | Reuse shared state representation and validate NBA thresholds in shadow |
| Source classes and named/retail breadth | NFL market state | Absent | Retain internal source class; unknown remains unknown |
| Target-book exclusion | WNBA and NFL | Absent from NBA read | Required before a market read can influence the evaluated quote |
| Split provenance and source-observed time | V2 observation schema; WNBA observation-only guard | NBA client says consensus-only although live feed is per-book; it uses fetched time | Correct provider contract and preserve source book/type/observed time/fetched time |
| Silent last-known-good split continuity | Shared public-split observations and line service carry-forward | Direct request; no persisted NBA fallback | Reuse persistent observations; UI may carry forward labeled-freshness state, decisions fail closed when stale |
| Honest decision eligibility | WNBA public context and NFL authority | Capability registry says audit-required, adapter says available when API key exists | One authoritative capability; availability is not qualification |
| Market confirmation vs model/market disagreement | NFL professional authority | `gradeNbaMarket` calls model edge "market support" | Separate model value, market flow support, resistance, and unavailable |
| One shared collection/resolution path | Market Intelligence v2 | V2 SharpAPI collector returns early for every sport except MLB | Add NBA collection through the shared writer/lease, not a second refresh path |
| Locked-reader precedence | Shared locked snapshot contract | Must be proven for any NBA reader migration | Render stored locked payload first; new semantics apply only to unlocked/future locks |

### Verified live provider facts

The 2026-10-15 read-only probe found SharpAPI NBA split rows for 18 event IDs. The feed is not one
consensus row per game: DraftKings supplied tickets and handle, while BetMGM supplied tickets with
handle missing in the sampled slate. NBA split history was available per sportsbook. Therefore:

- first-match-by-team is not a safe resolver;
- a missing handle must remain missing, not be inferred from tickets or another book;
- money-minus-ticket divergence is public/retail flow unless the provider proves distinct sharp-book
  provenance;
- per-book history should be retained even when the member UI shows one resolved pair of bars;
- split rows remain observation-only until NBA coverage, timestamp semantics, and incremental decision
  value clear chronological validation.

## Implementation boundary

The work is split into gates so NBA does not start over and does not promote an unvalidated reader:

1. **Capture parity:** route NBA odds, splits, and history into the shared timestamped observation
   schema under the existing writer and sport-scoped lease. Preserve provenance and silent continuity.
2. **Resolver parity:** build target-excluded exact-line state with opener basis, current quote,
   chronology, source class, freshness, persistence, reversal, buyback, and opposition. No grade effect.
3. **NBA shadow authority:** validate market-specific NBA thresholds. Unknown or incomplete evidence
   returns unavailable; it never becomes neutral confirmation.
4. **Independent tournament:** compare the feature-rich score model with rating and published-r1
   baselines on chronological selection and sealed confirmation seasons. Inspect every error ledger.
5. **Combined replay:** evaluate model-only, market-only, confirmation, resistance, and disagreement
   cohorts at the exact decision timestamp and price. Measure calibration, MAE, Brier/log loss,
   spread/total direction, CLV where valid, action counts, promotions, and demotions.
6. **Forward rehearsal:** run the rolling board and T-60 locks without member decision effect. Require
   complete data health, coherent quotes, stable job ownership, and immutable lock tests.
7. **Promotion:** bump every affected release, keep one writer, run the full model-change suite, verify
   board impact, publish only through an up-to-date protected PR, and verify live behavior after merge.

No production model, grade, or locked record is changed by this research contract.
