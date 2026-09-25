# NFL possession-efficiency 2026 forward replay result

Date: 2026-09-25

Verdict: rejected for production

The frozen r3 recipe was replayed against 32 immutable Week 1-2 evidence rows
using only team state that existed before each week. It improved the published
release's moneyline direction from 22/32 to 23/32, but spread was 14/32 and
total was 8/32. Team-score, margin, and total MAE all remained worse than the
market anchor. The total action lane was 1-6 (-5.02 units).

This failure rules out using the simple possession/efficiency estimate as the
complete score engine. It does not authorize a side flip, grade suppression,
historical rewrite, or member-facing change.
