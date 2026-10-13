# EPL coherent total/margin r20c candidate predeclaration

Date: 2026-10-13

Status: outcome-blind research candidate. No production authority.

R20a improved the independent margin and Match Result proper scores but
worsened the Total head. R20b's fitted matchup regression failed the score and
Match Result gates. Both remain rejected as complete replacements.

R20c tests the evidence-supported decomposition before opening another
holdout: retain the incumbent r19 projected Total exactly, blend only the team
margin toward r20a, and reconstruct nonnegative home/away lambdas from that one
Total and margin. All soccer markets are then re-derived from one Dixon-Coles
joint distribution. There is no post-hoc side override.

The r20a configuration is frozen from its 2024 selection:

- 365-day half-life;
- ten-match shrinkage;
- 20% xG target weight when available;
- 30% prior-match process weight; and
- Dixon-Coles tau -0.15.

Margin blend candidates are `[0.25, 0.50, 0.75, 1.00]` candidate weight,
selected on 2024 only. The Total remains 100% incumbent for every candidate.
The selected blend is opened once on 2025. Release gates and all unchanged
product boundaries remain those declared in the r20 and r20b predeclarations.
