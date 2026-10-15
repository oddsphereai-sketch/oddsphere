# NFL player props Anytime TD independent-allocation result

Date: 2026-10-15
Decision: frozen winner rejected; complete Week 5 board remains unopened

Both independent football-allocation identities beat the released market-implied-team-score
architecture on aggregate 2024 and 2025 probability accuracy and discrimination. The 2024 winner
was direct expected touchdown share.

| Phase | Model | Brier | Log loss | AUC |
|---|---|---:|---:|---:|
| 2024 selection | Released control | 0.073479 | 0.245190 | 0.850755 |
| 2024 selection | Direct share | **0.073167** | **0.238392** | **0.863689** |
| 2025 confirmation | Released control | 0.073090 | 0.244040 | 0.847060 |
| 2025 confirmation | Direct share | **0.072466** | **0.238871** | **0.856013** |

The frozen direct-share winner nevertheless fails the stability gate. Its 2025 game-clustered
Brier-delta interval is `[-0.001296, +0.000034]`, and Weeks 10–13 regress by `+0.000035` Brier.
The predeclared scorer-hurdle alternative is stable in every 2025 segment with interval
`[-0.001331, -0.000235]`, but it was not the 2024 winner and cannot be substituted after opening
confirmation.

The cached historical market-context CSV was absent. The control was reconstructed from the exact
archived nflverse PBP `spread_line`, `total_line`, home-team, and away-team game fields: 2,761 games
with zero missing spread/total rows. This preserves the disclosed market-anchored control rather
than weakening it.

Chronology stops before the complete immutable Week 5 2026 board is opened. No live probability,
grade, stake, writer, lease, or locked row changes; board impact is zero.
