# CFB 2026 Total market-reading tournament — predeclaration

Status: SELECT-only research. No production forecast, score, side, probability, grade, stake,
writer, cadence, provider request, member presentation, lock or tracking behavior is authorized by
this document.

## Question

Can market evidence actually correct a wrong CFB Total forecast more often than it damages a right
one, while also preserving or improving absolute final-score Total error? The target is the complete
OddSphere marriage: the independent joint score distribution remains the starting point, and only
pre-kickoff, identity-valid, sport-specific evidence may confirm or replace its Total direction.

## Evidence boundary

- Season: 2026 only.
- One latest retained evidence row strictly before kickoff per game and release authority.
- A game must have an official final score, a pregame authoritative and independent expected Total,
  an exact current Total line, and the evidence required by the candidate being evaluated.
- The `cfbfec3` capture beginning September 26 is the first retained sample with the complete named
  same-book chronology needed for this tournament. Older 2026 games may describe baseline model
  performance, but cannot be represented as if the later movement/split evidence existed.
- A separate historical reconstruction may use The Odds API's paid point-in-time endpoint for the
  `americanfootball_ncaaf` and `americanfootball_ncaaf_fcs` sport keys. It is external historical
  evidence, not evidence the released model originally consumed, and must be labeled that way in
  the audit. It may validate a future integration rule; it cannot rewrite a prior lock or tracking
  result.
- Historical reconstruction requests only the `totals` market and at most ten explicitly named
  books per request, so each snapshot costs ten credits under the provider's published formula.
  Start with one ten-credit FBS coverage probe. Any season reconstruction must use a schedule-fixed
  opening/pre-kickoff sampling grid declared before results are read, remain below 800 credits, and
  preserve at least 18,000 credits. Stop immediately if response headers disagree with that cost or
  reserve.
- The reconstruction grid is schedule-derived and outcome-blind. For each distinct eligible
  kickoff, request the unique four-hour UTC boundary at or before kickoff minus 72 hours and the
  unique four-hour UTC boundary at or before kickoff minus 60 minutes. Duplicate targets are fetched
  once. All queried snapshots in between a game's first and final eligible observation may describe
  its path. FBS-involved games use `americanfootball_ncaaf`; FCS-only games may be added from
  `americanfootball_ncaaf_fcs` only if the combined declared grid stays under 800 credits.
- The historical book set is Pinnacle, DraftKings, FanDuel, BetMGM, BetRivers and BetOnline. The
  request is explicitly book-scoped rather than region-scoped. Pinnacle is evaluated separately as
  the originator-like channel; the five retail/offshore books form a source-counted consensus and
  are never presented as sharp splits. The provider documents Pinnacle as public-site odds that may
  carry delay, so timing claims use the returned bookmaker timestamp and remain conservative.
- Development dates are September 26–27. Confirmation dates are October 2–4. October 7 and later
  settled dates are the untouched forward holdout. Results are also reported date by date so a
  single Saturday cannot masquerade as independent evidence.

## Frozen candidates

Every movement is computed within one named sportsbook and one exact game/market identity.

1. Total-line movement of at least 0.5, 1.0 and 1.5 points, separated for Circa, Pinnacle and
   Bookmaker.
2. At an unchanged Total line, paired no-vig Over probability movement of at least 1.0, 1.5 and
   2.5 percentage points. This tests the price-movement channel omitted by a line-only audit.
3. Agreement of at least two named originators on the same line-or-price direction.
4. Named movement plus a same-direction named sharp money-minus-ticket gap of at least 10 points.
5. Named movement plus a same-direction lower-trust fallback money-minus-ticket gap of at least
   10 points. Named and fallback evidence remain separate; fallback is never relabeled as Circa.
6. Reverse-line movement: named movement against a public ticket advantage of at least 10 points.
7. Timing slices based on the retained current observation: within six hours and within two hours
   of kickoff. Missing or post-kickoff timestamps are ineligible, not neutral.

No candidate may use the evaluated book's target quote as independent confirmation. No outcome,
closing result, later capture, cross-book synthetic trail or unverified opening may enter a signal.

## Evaluation and promotion gates

For every candidate report coverage, wins/losses/pushes, authoritative disagreements,
corrections, harms and reflected-score Total MAE on those disagreements. A coherent counterfactual
reflects the authoritative expected Total across the exact market boundary while preserving the
authoritative margin; it does not apply a capped nudge or alter only the displayed side.

A candidate is eligible for a production proposal only if all of these hold:

1. it was selected without the holdout and improves net corrections over harms in both confirmation
   and holdout;
2. it does not worsen reflected Total MAE in either block;
3. it has at least 12 resolved games overall, four confirmation disagreements and two holdout
   disagreements across at least three distinct game dates;
4. the same fixed rule beats the released authoritative Total side overall and does not merely
   suppress losing picks;
5. paired board replay proves both promotions and demotions, reports actionable-count impact, and
   preserves one coherent score/probability/side tuple;
6. normal model-change, lock, tracking, one-writer, provider-budget and deployment checks pass.

Failure means retain the active CFB Total forecast and keep collecting the exact evidence. It does
not authorize a weaker threshold, a broad market anchor, blanket sharp following or outcome-picked
exceptions.
