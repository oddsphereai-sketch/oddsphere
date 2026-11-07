# Full-source player-prop forecast candidate

Candidate: `player_props_ai_2026_11_07_r11_bounded_physical_rows`, from
`e008a0fd4f22653a8fde8690b87d38d4d1ac3cf2`. This is an unactivated, local process/cost
candidate. Existing production model releases, predictions, grades, stakes and locked
records remain authoritative. No production writer, collector or cron is added here.

## Completion and coherent outcomes

Generation defaults to a bounded JSON response containing both the final output and
its usage receipt. Diagnostic streaming remains available; partial text without a
terminal receipt cannot qualify a review. Responses are bounded while reading, and
the reader is cancelled on completion/error. A timeout without billed usage retains
its full test reservation. There are no automatic paid retries in the test harness.

The wire law contains sixteen scenario rows in each player's declared column order.
Nonnegative coordinates encode dependent counts directly: NBA non-three points plus
made threes; NFL non-TD completions, passing TDs, interceptions and other incompletions;
MLB non-HR runs/RBIs plus HRs. Net yards use gained minus lost yards. Exact decoding
produces the existing canonical law. This is a change of coordinates, not clamping a
contradictory prediction or forcing a favored side. Existing canonical validators
still reject invalid outcomes. All related markets use the same decoded distribution.

`props_scenario_rows_2026_11_07_r2_physical_coordinates` is mandatory in new responses.
Legacy wire rows cannot be silently reinterpreted with new units. The canonical stored
law release remains unchanged; no stored accepted or locked record is reparsed or
rewritten. New semantics affect future candidate responses only.

Source records use a lossless dictionary for repeated records, strings and arrays.
Before sending, the encoder proves decoded equality against the complete current
readable input. Player/market coverage, source links, precision and clock provenance
remain the same as that input contract. This does not assert that the preexisting
market-summary compiler is lossless relative to every raw alternate tick.

Whole-game Standard rehearsals passed completion, required source-area coverage and
canonical mathematical checks in each of NBA, NFL and MLB. A complete NFL Flex rehearsal
also passed. The stronger model has a single-player schema/pricing smoke test, not a
verified full-game completion record. These checks do not prove accuracy, calibration,
perfect reasoning, vendor availability or future completion on every input. Quality
rejections and earlier unknown-charge reservations remain in the original private
ledger. No generation is accepted merely because it was charged.

## Current cost verification

`prepare-cost-cases.ts` rebuilds full-source cases using the current layout. Explicit
cutoff-invalid exclusions are recorded, not silently counted as smaller valid packets.
`profile-live.ts` measures model-specific input tokens without generating forecasts.
`fetch-cost-calendars.py` inventories published annual workloads, including NBA/NFL
preseason. MLB original and rescheduled dates are retained conservatively because
reviews may already have occurred on a postponed date.

`forecast-cost-report.ts` combines those exact counts with completed current-candidate
usage receipts. It reports twelve months by UTC review billing stage, including the
prior December 31 NBA boundary. A sixty-minute pregame lock is an illustrative timing
assumption; actual live locks must replace it. Published TBD/midnight placeholders
that cannot fit two same-day windows retain both cost obligations and appear as
scheduling exceptions. They cannot become executable paid jobs until resolved.

The report separates Standard observed-output estimates, capped-output envelopes,
every-game-at-the-largest-sampled-input stress and complete Flex-unavailability stress.
Capped envelopes include 2,048 input tokens of headroom per request and all 7,000
allowed output tokens. Stronger quotes use the full request bound, not a claim that
one-player output density generalizes to full games. Cache-read savings are excluded;
only a confirmed Flex receipt receives the Flex rate. Unknown tiers use Standard.
Prices: [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

The affordable policy uses Luna Flex early and Luna Standard for the final review.
Terra Standard can replace up to ten percent of final reviews, only after reserving
both full core reviews for every game, additional Standard attempts for ten percent
of early reviews, and a separate recovery reserve. No player or market is removed to
fund an upgrade. An unfunded primary plan remains explicitly unfunded; it does not
become valid by omitting late-month games. `forecast-cost-plan.test.ts` checks this
allocation, duplicate refusal, adverse upgrade costs and UTC stage boundaries.

Flex exchanges lower price for slower responses and occasional unavailable capacity:
[Flex processing](https://developers.openai.com/api/docs/guides/flex-processing).
The fallback allowance is finite and does not guarantee availability or every future
bill. Complete Flex unavailability can exceed the target. Unknown completions cannot
trigger blind fallback. Future source size/partitions, schedule changes and repairs
must be re-quoted against the remaining entire month before optional upgrades.
Sports-data subscriptions, hosting/database, taxes and other AI products are excluded.

All actual exports, full-source profiles, usage receipts, aggregate financial results
and the unchanged shared test ledger stay private outside Git. The test ceiling stays
at two dollars across all attempts, including failures and unknown-charge holds.

## Remaining activation work

The prototype SQL wallet's fixed per-sport reservations are obsolete for the measured
full-source layout. They are not evidence that this policy is deployed or funded.
Before activation, replace them with request envelopes for a complete live calendar,
persist tier/fallback eligibility in the atomic wallet, protect all remaining core
obligations before upgrades, and test safe deadline recovery. Full-game stronger
completion and NBA/MLB Flex behavior still require bounded validation or an explicit
Standard-only plan with its higher cost. No new paid tests are authorized by this doc.

Live source freshness, NFL additional-head executable prices, existing sole leased
writer integration, exact legacy lock precedence and the full model/integration/live
checks remain engineering gates. Retrospective superiority is not a launch gate under
the owner's process-first direction. A cost replay must not be called a deployed cap.

```bash
# No generation/network calls.
node --import tsx scripts/test-player-props-ai-core.ts
node --import tsx scripts/test-player-props-ai-reader.ts
node --import tsx scripts/test-player-props-ai-source-codec.ts
node --import tsx scripts/test-player-props-ai-openai.ts
node --import tsx ops-local/player-props-ai/forecast-cost-plan.test.ts

# Private measured profiles/calendar/receipts already exist; NEW private destination.
node --import tsx ops-local/player-props-ai/forecast-cost-report.ts \
  /private/tmp/PROFILES.json /private/tmp/CALENDAR.json /private/tmp/RECEIPTS \
  /private/tmp/PRIOR_DEC31_NBA.json /private/tmp/NEW_REPORT.json
```
