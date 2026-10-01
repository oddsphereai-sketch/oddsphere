# CFB r7 post-market Spread arbitration r8 — predeclaration

Date: 2026-10-01

Status: research-only; frozen before coherent final-score replay

## Baseline and evidence boundary

The independent baseline is the r7 cross-family domain-arbitrated score. The
market replay uses only immutable pre-kickoff Playbook splits and the stored T-60
line. It adds no provider request. Weeks 1–2 are the rule-selection block and
weeks 3–4 are repeated confirmation; the latter has already been opened by
earlier exploratory reports and is not represented as untouched evidence.

The selection-grid winner is fixed before this score replay: Spread only, at
least eight contributing books, at least a five percentage-point absolute
money-minus-ticket divergence, with no independent-edge ceiling. Moneyline and
Total split flips are ineligible because no rule improved both chronological
blocks. Pinnacle movement, Circa movement, RLM, and fallback sharp-split rows
remain reported but cannot independently flip this release because their
source-specific confirmation samples are too small or unstable.

## Coherent flip construction

When the qualified Spread signal disagrees with r7, reflect the independent
margin across the stored Spread line. If the original cover edge is `e`, the
final margin has cover edge `-e` on the other side. This is a real side flip,
not a capped nudge. Preserve the r7 Total, rebuild home and away scores from the
final margin and Total, then derive Moneyline, Spread, and Total sides from that
single score. A resulting Moneyline change is allowed only as the necessary
coherent consequence of the new margin; there is no independent ML split flip.

## Gates

On weeks 3–4, the final forecast must add Spread wins, not reduce ML wins or
Total wins, and not worsen margin MAE or team-score MAE by more than 0.10 points
on the same covered cohort. It must preserve every covered game and market.
All flips, promotions, demotions, and actionable board counts must be reported
before any production decision. Passing this replay does not by itself
authorize production; repository model-change and fresh-base release gates
still apply.
