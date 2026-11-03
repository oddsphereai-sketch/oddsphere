# CBB integrated market-interpretation candidate — November 3

Status: isolated, unmerged candidate. No production prediction, grade, lock,
stake or provider cadence was changed by this work.

## Scope and exact starting state

At 19:37 UTC, the latest completed CBB refresh was 19:32:33–19:33:00 UTC,
marked partial only because game 10882595 (New Orleans at LSU) remained an
internal incomplete evaluation. Eighteen member games were stored; all were
unlocked. The active releases were independent R3, received-market score R5,
grade R7, board R10, publisher R19, tracking R7 and adapter R8. The sole CBB
publisher runs under the existing sport-scoped prediction-pipeline lease.

## Reproduced Alabama State decision

At the 19:32:37 UTC decision, FanDuel offered Alabama State +32.5 at -110.
Its first recorded line was +27.5 at 06:17 UTC, +31.5 at 13:47 and +32.5 by
15:17. Current Playbook public consensus was 73% Texas A&M money and 70%
Texas A&M tickets. DraftKings network had 69% money and 55% tickets on Texas
A&M. Neither source establishes professional action. No verified Circa split
was present for this market.

Pinnacle, the target-excluded professional source, moved from Texas A&M -32.5
(-109/-111) at 15:59 UTC to -31.5 (-110/-110) by 19:32. Its later move favors
Alabama State at the current number. The R5 score therefore moved the
independent Texas A&M margin 26.010 to 25.072, and the displayed Alabama State
cover probability became 73.309%. R7 made +32.5 a Best Angle at -110 because
model EV was +39.954% and Pinnacle's exact-target value was positive. The
Pinnacle one-point price advantage transports to only 53.357% / +1.863% at
that target; it does not corroborate a 73% cover forecast. The historical
FanDuel move toward Texas A&M and later Pinnacle buyback are different source
paths and must both remain visible. The source reversal is completed support
for Alabama State, not automatic unresolved opposition.

## Candidate behavior

1. A physical professional source's coherent price/line path is classified
   relative to the independent score. A move toward that score without
   crossing it is confirmation without a second numerical shift. A move away
   remains corrective. A crossing applies only the part past the independent
   score. The receipt keeps the observed path and a distinct score consequence.
   Moneyline fallback uses the same independent-relative direction test; the
   original CBB log-odds transport remains for corrective moves.
2. Ordinary positive professional exact-target value may corroborate a Lean.
   The existing Best-level 8% EV reserve now also applies to the independent
   professional-price route; verified native same-market action remains a
   separate promotion route. This is an evidence-strength policy candidate,
   not a claim that 8% is an empirically optimal threshold.
3. The existing bounded Playbook read is moved before board grading. Already
   fetched direct Owls, canonical and DraftKings network splits become a
   separate typed decision input. It preserves source class, physical family,
   market, own line or its absence, money/ticket axes, source clock, availability
   clock and original receipt IDs. It deduplicates Owls and network DraftKings.
   Public consensus is an aggregate, not a named professional book. A network
   capture with no own contract cannot assert a same-book price reaction. These
   consumer contexts are classified at grade time; they are not added as
   invented score points or copied into the professional-flow path.
   Source-observed age, rather than a later database insertion, determines
   freshness when that clock exists. Physical-family deduplication follows
   provider chronology and quarantines conflicting same-time states. A
   money-only or tickets-only canonical pair retains its actual axis and a
   null for the other. A later DraftKings capture cannot renew an old table
   observation, and public-consensus sides from different source times cannot
   form one decision pair.
4. An identical later price recapture no longer suppresses a verified earlier
   pre-split price state; any intervening changed price still blocks that
   causal binding. A Duquesne–Rhode Island Circa replay now classifies the
   observed opposing-money pressure and unchanged quote as a held response,
   without claiming sharp confirmation or changing its numerical Lean. The
   member adapter now carries the actual observed professional path direction
   for confirming and corrective receipt reasons. Tracking recognizes prior
   R8 locked-grade lineage without rewriting a lock.
5. The same single CBB writer, provider calls, immutable first retained input,
   prelock cutoff and stored locked-reader precedence remain. New semantics
   apply only to future unlocked and future-locked rows under distinct releases.

## Replay and qualification limits

The 18-game frozen board replay reran the candidate runtime against the exact
19:32 stored source receipt and final independent score. Fourteen spread/Total
axis responses changed; five
of 54 market grades changed. Alabama State +32.5 fell from Best to Lean and
its counterfactual cover probability fell from 73.309% to about 70.7%.
Its Under 161.5 also fell Best to Lean. Both Alabama demotions arise from the
new Best-tier professional-value rule: professional exact-target EV remained
only +1.863% on the Spread and +1.04% on the Total, despite positive model EV.
The independent-relative score change separately reduced the two probabilities.
Sam Houston Total and Coppin State
Total fell Lean to No Play, while South Dakota State Total fell Watchlist to
No Play. There were zero selected-side flips. Board actionables moved 16 to
14, with zero observed promotions and zero Best. The exact replay report is
`/private/tmp/cbb-full-runtime-stored-replay-20261103.json`. It does not
simulate a fresh entire pipeline with the new source-context receipt, so its
count is a bounded prepublication estimate.

A second read-only check at 21:23 UTC found the normal 21:17 refresh still
partial solely because LSU–New Orleans lacks the current independent input;
the 18 stored games were all unlocked, used one R5/R7 release family and had
no new provider call or database write from this audit. Replaying those exact
18 stored receipts with this candidate changes three of 54 grades: one Lean
to Watchlist and two Lean to No Play. Actionables move 11 to 8, with zero
promotions or side flips. This changing board count is another reason the
19:32 impact cannot be treated as a quota or validated production outcome.

An exact-head offline LSU–New Orleans replay at 17:19 UTC with six eligible
canonical split contexts still gives New Orleans +27.5 at -110 a Lean with
79.915% modeled cover probability and +52.56% modeled EV. Pinnacle's
transported exact-target probability is 50.866% and target EV -2.89%. The
Circa New Orleans split is off contract at +28.5; the DraftKings named-book
split opposes New Orleans at the exact +27.5. Those source contexts are in
the receipt but do not change the grade or score numerically. This remains a
specific unresolved product decision, not a successful 19-game release
rehearsal. The read-only output is
`/private/tmp/cbb-lsu-pr974-exact-head-replay-20261103.json`.
An independent bounded source audit also recovered the latest complete
Playbook public capture (six sides fetched 17:15:24.948 UTC, inserted by
17:15:25.826, before the decision). Adding its three market contexts yields
nine split contexts and leaves every score, probability, EV and grade exact.
Its spread money/tickets favor LSU 72%/64%; the upstream source clock is null,
so the actual capture clock is only an upper bound. The only recoverable
DraftKings network durable capture was after the decision and cannot be
retimestamped into this replay.

On the already-opened November 2 105-game pro-path development cohort, the
independent-relative path idea improved margin MAE by approximately 0.044
points per game and Total MAE by approximately 0.004 versus raw R5 endpoint
transport. That small movement does not qualify the new grade policy or solve
current-level gaps. Separately, fitting one current-level correction on the
opened pro development partition collapsed the current board to two
actionables; a blind retail-level blend worsened later archived spread side
results from 114 to 104 correct. Neither is a release candidate. See the
whole-board audit for exact cohorts and source scope.

New Orleans–LSU remains the only priced omitted D1-versus-D1 game in the
checked 29-game source slate. The separate official venue-history recovery
would restore its independent forecast, but the first as-of replay still puts
New Orleans +27.5 near 80.8% versus roughly 50.9% Pinnacle fair probability.
This candidate has not qualified that starting-level disagreement or the new
game's actionable grade. An exact owner-reviewed provisional exception and a
completed board/lock/cron/live verification would be needed before release.

## Verification completed in the isolated worktree

- TypeScript type check passed.
- Focused CBB native path, behavior, grade, writer, tracking, pipeline and
  locked-record suite passed after the deliberate fixture expectation changes.
- New predecision split context fixture passed: source class, own line,
  physical-family deduplication, clocks and ambiguous-fixture rejection.
- No production writes, extra provider calls, second writer or schedule were
  made by the candidate/replay work.

The full `npm run verify:model-change` gate passed after integrating remote
main `6d4dbcd3`; the clean-worktree integration-safety check also passed at
local candidate `95350bf7`. Protected PR checks and live release proof remain
pending. The candidate must remain held until its board count, New Orleans
decision, release policy and complete predecision split behavior are
specifically accepted and verified.
