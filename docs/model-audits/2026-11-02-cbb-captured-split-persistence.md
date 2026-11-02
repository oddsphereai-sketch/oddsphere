# CBB captured split persistence

Starting base: `69e5499618ac46582f83e3312b200da7a228a67a`.

After r8 deployed, the 116-game board had 348 evaluated prices and 177 persisted
named split panels. The existing reader recovered 242 qualified panels from the
durable feed, without a provider call. The current provider response temporarily
omitted some games while their earlier complete observations remained valid
under the existing three-hour source window. Reader-only recovery would be
lost when a later immutable lock froze an incomplete writer DTO.

The sole writer now reads that existing feed once alongside its existing book
history read. It prepares real provisional DTOs using already computed model
outputs, applies the same pure reader rule once with the full board as identity
context, and supplies qualified sections to the existing per-game write. No
model is fitted twice and no additional provider call or writer is introduced.
Current complete higher-priority/newer source pairs retain precedence. Source
timestamps remain original; no last-known observation is made newly fresh.

The shared rule rejects incomplete axes, stale/future timestamps, wrong source
sport, dates, institutions and ambiguous full-board matches. Only Circa,
DraftKings and BetMGM named pairs qualify; consensus is never relabeled. A
locked payload returns before enrichment. A future lock freezes its existing
published evidence, including any qualified pair already published before the
cutoff. The stored DTO schema remains r2, allowing in-flight prior-deployment
readers to validate new records during rollout. Publisher r9 versions this
publication behavior; store and lock index use one compatibility list.

At 16:19 UTC, a new read-only captured-source replay recovers 177->235 complete
panels across 22 additional games, with all 348 decision tuples and both locked
payloads unchanged. An actual improved game (10882489) also persists its exact
qualified section through an in-memory invocation of the sole writer. There
are zero provider requests or external writes in this proof. Full-board source
qualification takes 3277 ms locally and is performed once per scheduled writer,
not once per game or member request. Counts differ from the earlier 242-panel
reader audit because eligibility follows the original source age at each cutoff.

Prediction, probability, projection, selected quote, grade, source hierarchy,
stake, provider budget, schedule and shared lease are unchanged. Paired
promotions/demotions and actionable-count impact are 0/0/0. Validate a captured
same-input replay, full reader/writer decision neutrality, future and existing
lock immutability, complete source guards, model safety, build/TS/lint and
latest-main protected integration before deployment. Verify normal leased
writer output, stored panels and live readers afterward.

Rollback publisher r9 without changing the compatible r2 store schema. Never
rewrite or suppress locks.
