# NFL player props Anytime TD fixed independent ensemble result

Date: 2026-10-15
Decision: retain as research foundation; do not release because the external calibration gate fails

The fixed 50/50 direct-share/scorer-hurdle ensemble clears every historical development gate against
the released architecture, despite excluding the control's sportsbook-implied team score.

| Phase | Model | Brier | Log loss | AUC | Calibration gap |
|---|---|---:|---:|---:|---:|
| 2024 development | Released control | 0.073479 | 0.245190 | 0.850755 | 0.005611 |
| 2024 development | Fixed ensemble | **0.073056** | **0.238165** | **0.864300** | 0.008112 |
| 2025 development | Released control | 0.073090 | 0.244040 | 0.847060 | 0.005210 |
| 2025 development | Fixed ensemble | **0.072230** | **0.237939** | **0.857856** | **0.005041** |

The 2025 game-clustered Brier-delta interval is `[-0.001441, -0.000291]`. Every chronological
segment improves: Weeks 1–4 `-0.000981`, Weeks 5–9 `-0.001710`, Weeks 10–13 `-0.000499`, and
Weeks 14–18 `-0.000306`.

The complete immutable Week 5 2026 board contains 45 canonical Anytime TD scopes and 11 scorers.
The candidate improves Brier from `0.122582` to `0.108720`, log loss from `0.367081` to `0.329791`,
and AUC from `0.933155` to `0.959893`. It fails the fourth frozen external gate because calibration
gap worsens from `0.125268` to `0.143912`.

Those opened 45 outcomes cannot be used to refit calibration and then presented as confirmation.
No production probability, market residual, scorer selection, grade, stake, writer, lease, or
locked record changes. Board impact is zero. The independent team-budget/allocation architecture is
the strongest next forward candidate, but it requires a genuinely later calibration check.
