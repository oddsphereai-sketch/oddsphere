# NFL player props distribution robustness amendment

Date: 2026-10-08  
Parent: `2026-10-08-nfl-player-props-independent-distribution-release-predeclaration.md`  
Status: frozen after the first declared split result and before robustness implementation

The first fixed Weeks 1-9 / Weeks 10-18 selector advanced Passing Attempts and Receptions on its
2025 validation window. On the already-opened 2026 replay, Receptions passed every gate, while
Passing Attempts and Receiving Yards failed probability direction and/or Brier despite retaining
their point-error gains. That result is retained and is not overwritten.

One follow-up selector is authorized to test whether the failure came from a single fragile season
split rather than the independent point heads. It adds no model feature, market input, distribution
family, or mixture weight. For every already-declared candidate:

- score four chronological out-of-fold blocks: Weeks 7-9 after fitting calibration on Weeks 1-6,
  Weeks 10-12 after fitting Weeks 1-9, Weeks 13-15 after fitting Weeks 1-12, and Weeks 16-18 after
  fitting Weeks 1-15;
- require aggregate out-of-fold Brier and log loss to improve over the frozen foundation and
  aggregate probability-selected direction not to regress;
- require Brier improvement in at least three of four blocks and permit no block to regress by more
  than 0.005;
- choose the eligible candidate with the smallest worst-block Brier delta, then aggregate Brier,
  log loss, and the simpler identity calibration as tie-breakers; and
- refit only that frozen calibration on all 2025 threshold rows before rerunning the same explicitly
  opened 2026 replay.

The original production and lock gates remain unchanged. If this robustness selector cannot carry
the historical improvement into the current-season replay, the affected market does not ship.
