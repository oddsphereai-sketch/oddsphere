# CFB exact-price comparison-count blocker correction

Base: `bc66ac5a3356b34cf92ed7065bd40f2bac15571c`.

On October 29 Daniel Mengel explicitly approved putting the narrow correction
live without a large historical qualification project: absence of identical-line
comparison sportsbooks must not itself prevent an otherwise valid offer from
being graded. This supersedes the offline-only boundary of the preceding audit
for this correction only; it is not a profitability claim or authorization to
change other grade thresholds, scores, models, locks or safeguards.

## Frozen implementation

CFB Moneyline/Spread/Total only. Preserve every market already priceable under
the incumbent two-other-book check. If that lane has no valid decision, permit
one other complete fresh same-line book, otherwise the actual target book's
complete same-line paired-price context. Internally label the latter as
target-paired context with zero independent books, never independent consensus.
No fake line, probability interpolation, missing-pair acceptance or permanent
Watchlist ceiling. The existing authoritative PMF, exact price/push EV,
confidence, price-tier, market-resistance, verified-QB and anchorless caps remain.
Fallback targets/comparators must be exact-game main-line pairs, coherent,
pregame, observed before evaluation and within 60 minutes; capture-only Owls,
display-only targets and malformed price pairs remain excluded.

Keep forecast-seeding decisions explicitly on the incumbent price policy so
this grading repair cannot alter the score/reader distribution. Only final
grading uses the new context fallback. Preserve the sole authoritative writer
and `prediction_pipeline:cfb` lease. Existing locked rows must win verbatim
through release transitions; no locked payload correction is authorized.

Version calibration/grade/decision/tuple, writer and member cache identities;
preserve old release tuples without relabeling. Keep existing forecast model,
distribution and probability releases unchanged because their equations and
inputs are unchanged. Run a same-input sole-writer zero-write comparison,
report every promotion/demotion and board mix, test lock writer/reader
precedence, focused CFB tests, full model-change verification, lint/TypeScript,
latest-main integration safety, protected PR checks and production verification.
No extended historical tournament or threshold tuning is part of this request.
