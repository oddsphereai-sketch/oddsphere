# NFL player props Anytime TD independent calibration result

Date: 2026-10-15
Decision: retain the fixed independent ensemble as the research foundation; no calibrator selected

## Result

No predeclared calibrator cleared the 2024 selection gate, so the frozen 2025 confirmation and the
already-open Week 5 2026 external gate were not used to substitute a method. The live model,
probability, grade, stake, writer, lease, board, and every locked record remain unchanged.

| 2024 method | Brier | Log loss | AUC | Calibration gap | Selectable |
| --- | ---: | ---: | ---: | ---: | --- |
| Released market-anchored control | 0.073479 | 0.245190 | 0.850755 | 0.005611 | control |
| Fixed independent ensemble | **0.073056** | 0.238165 | **0.864300** | 0.008112 | control |
| Global Platt | 0.073161 | 0.238196 | **0.864300** | 0.007950 | no |
| Global beta | 0.073058 | **0.237976** | **0.864300** | **0.006822** | no |
| Global isotonic | 0.073614 | 0.239828 | 0.862659 | 0.011237 | no |
| Position Platt | 0.073278 | 0.238857 | 0.863437 | 0.009182 | no |
| Position beta | 0.073144 | 0.238666 | 0.863291 | 0.006992 | no |
| Position isotonic | 0.074618 | 0.253251 | 0.862082 | 0.012174 | no |

Global beta was the nearest miss. Relative to the fixed ensemble it improved log loss by
`0.000190`, reduced calibration gap by `0.001291`, and preserved ranking exactly, but worsened
Brier by `0.00000215`. The predeclaration required both Brier and log loss to improve; the method
therefore has no authority despite the tiny Brier difference.

For diagnostic context only, applying the same frozen identities to 2025 leaves global beta at
`0.072274` Brier, `0.237789` log loss, `0.857856` AUC, and `0.006640` calibration gap, versus the
fixed ensemble's `0.072230`, `0.237939`, `0.857856`, and `0.005041`. It again improves log loss but
does not solve calibration consistently. Isotonic variants lose discrimination through tied
predictions and perform materially worse with this sample.

## Safety and board impact

The complete Week 5 board was not reopened for calibrator selection or fitting. Production writes:
zero. Promotions: zero. Demotions: zero. Side changes: zero. Actionable-count change: zero. Locked
rows mutated: zero. Market reading remains separate and disabled as forecast override authority.

The useful conclusion is narrower than a release: the independent allocation improves proper
scoring and ranking, but its current-season calibration shift is not repaired by a stable global or
position post-hoc map learned from the immediately preceding season. The next Anytime TD evidence
must be a genuinely later forward board or a separately predeclared structural team-budget/base-rate
repair, not a Week 5 refit.
