# NFL player-prop review-window handoff

Base: `68e3c51b5bd2fb4cdfd80cf6b2de2d07a3964d98`.

The pre-activation live check exposed a scheduling gap: the existing NFL props
writer uses the last completed snapshot to decide whether fifteen minutes have
elapsed. A 2:36 p.m. collection finishing at 2:40 p.m. suppresses the 2:51 p.m.
heartbeat for a 4:05 p.m. game. The next 3:06 p.m. heartbeat is after the 3:05 p.m.
lock, missing the final window entirely. A durable pending AI job already exists;
its scheduling must not depend on the independent snapshot age.

R15/cadence R5 adds a SELECT-only, paid-gated hint to the existing sole writer.
It requires a matching enabled service control, current ET game day, pending state,
due_at <= now and lock_at > now. It never plans, claims, retries, generates or writes
a prediction. Zero rows, paid off, completed jobs and post-lock work do not force
the old cadence. Provider refresh remains the existing sport-leased writer only. A due review may
therefore run that collector on a heartbeat that snapshot age alone would skip;
the normal per-run provider limits remain unchanged. It does not run AI on every heartbeat.
Durable claims enforce two logical reviews, source completeness, spending and locks.

The owner authorized ordinary scheduled reviews, not additional paid tests. During
qualification the paid database control was set back off before the first attempt;
production review attempts were zero. All engineering tests use mock database or
inference responses. No result, stored lock, model law, grade formula, primary/strong
model, monthly wallet or provider budget is changed. Direct promotions/demotions and
row coverage changes for the same accepted inputs are zero; existing paired grade
fixtures remain valid. Existing independent sport release identifiers stay exact.

Required qualification: exact early/final clock tests including the 4:05 p.m. case,
feature-off zero I/O, control/version gating, completed/post-lock exclusion, read
failure behavior, focused source/publication/lock tests, full model-change gate,
TypeScript/build, fresh-main/overlap protected PR and live ordinary-cycle proof.
After protected deploy verify the pending job makes the existing writer due, then
observe completion/usage and the familiar member reader without an extra paid run.
