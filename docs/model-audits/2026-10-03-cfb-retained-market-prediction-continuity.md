# CFB retained market-prediction continuity

## Predeclaration

The production r31 evidence release correctly retains the latest verified sportsbook price and
line when a later provider cycle omits a market. The member surface nevertheless suppresses a
Spread or Total prediction after an unrelated ten-minute display timer, producing an internally
contradictory card: the exact verified line, price, and same-book trail remain visible while the
line-specific prediction is labeled unavailable.

The candidate changes only the member publication contract. When a retained market outlook has a
finite line and a real observation timestamp that is not in the future, publish the authoritative
joint-PMF prediction at that exact retained line. Preserve No Play whenever exact-price grading
requirements are incomplete. Do not change numerical projections, sides, probabilities, grades,
actionable counts, lock state, or tracking records.

Acceptance criteria:

- all 99 current games remain on the board;
- every market with a verified retained line and observation timestamp publishes its line-specific
  prediction;
- retained evidence keeps its real sportsbook, price, line, and observation time;
- missing lines still publish `market_data_unavailable`;
- all pre-existing locked games remain byte-for-byte terminal at their stored lock timestamp;
- focused CFB tests, TypeScript, model-change verification, and integration safety pass.

## Result

The candidate removes the independent ten-minute presentation expiry for already retained verified
market context. Current-board audit impact is exactly 15 Spread and 15 Total prediction surfaces
restored. Five games without a verified timestamped quote remain unavailable. Numerical forecasts,
picks, probabilities, grades, promotions, demotions, and actionable board counts do not change.
The missing-line fixture remains unavailable, and the 15-minute retained-quote fixture proves that
Moneyline, Spread, and Total predictions stay available without manufacturing a Bet selection or
grade.

## Verified-quote and schedule follow-up

The live r24 audit found five additional games whose verified price and line were still present but
whose current evidence row had no saved market outlook. Recomputing their line probability in the
member reader is rejected: compact evidence intentionally omits the PMF, so a reader-side estimate
would not be release-pure.

The follow-up instead repairs both legitimate continuity paths. The member reader may reuse an
already stored legacy market outlook only when its line exactly matches the selected verified
sportsbook quote. The writer also merges previously verified upcoming games back into refresh
planning when the current schedule response temporarily omits them, allowing the authoritative
writer—with the full PMF—to produce current outlooks. Current provider rows remain authoritative;
started/locked games are not rewritten.

No-write audit on production evidence: 99 games, 71 unlocked capture proposals, 142 evaluated
markets, 19 Best Angles, 65 Leans, 46 Watchlists, 12 No Plays, 71 exact-price holds, and zero capture
failures. The grade policy is unchanged. Existing locked rows remain terminal.

## One-sided verified context-line follow-up

Production r25 confirmed the four still-upcoming unresolved games were selected and written under
r45. Their provider rows contained verified one-sided main-line prices in `marketQuotes`, but the
outlook builder read only complete paired `spread` and `total` fields. It therefore retained the
real sportsbook line and price while omitting the line-specific PMF outlook.

The r32 evidence contract now permits a verified one-sided `main_line` quote to supply only the
context line and observation time for the authoritative PMF. It never supplies a no-vig benchmark
or exact-price grade; those markets remain held unless the existing paired-book requirements pass.
Playbook retains first priority, paired named-book fields retain second priority, and the strict
ESPN opening reference remains the final fallback.

No-write production-evidence audit: 99 games, 81 release-refresh captures, 148 evaluated markets,
19 Best Angles, 66 Leans, 48 Watchlists, 15 No Plays, 95 exact-price holds, and zero capture
failures. Numerical score, decision, and grade-policy releases remain unchanged, and terminal locks
continue to win over newer rows.
