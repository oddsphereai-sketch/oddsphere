# NHL structural actionability r21 — predeclaration — 2026-10-23

## Reason for a second, independent test

The first r21 grid selected a probability-only candidate on the first 70% of
eligible 2026 locks. It improved the combined final 30%, but failed the
market-specific gate because Total actionables fell from 12-13 to 1-6. That
candidate is rejected and will not be retuned against the opened confirmation
segment.

This second test is not selected from the 2026 locks. It freezes structural
boundaries already published from the chronological 2024 selection and untouched
2025 confirmation in
`nhl-research/nhl_professional_score_tournament_2026_09_29_r2.json` and
`docs/model-audits/2026-09-29-nhl-professional-architecture-market-marriage-r8.md`.
The 2026 locks are an opened current-era corroboration only.

## Frozen candidate

The candidate leaves scores, sides, probabilities, market-reader corrections,
lines, and prices untouched. It replaces the permissive raw-Lean pass-through
with these market-specific qualifications:

- Moneyline Lean: selected-side probability at least 58% (the start of the
  historically successful 8-12pp and 12pp+ conviction bands) and non-negative
  exact-price edge.
- Total Lean: absolute final projection-to-market-line gap at least 0.30 goal
  (the start of the stronger historical Total bands) and non-negative
  exact-price edge.
- puck-line Lean: selected-side probability at least 58% and exact-price edge
  at least 1.5pp, matching the released raw Lean boundary while removing its
  permissive `OR edge >= 5pp` bypass for sub-58% sides.
- Best Angle keeps the released market-specific 70% Moneyline, 65% Total, and
  70% puck-line confidence boundaries, the 5pp exact-price edge requirement,
  and the existing short-price downgrade. A failed Best Angle may remain a Lean
  only if it passes the corresponding Lean rule.
- Any Watchlist that passes the same Lean rule promotes to Lean. This is the
  paired promotion path; no quota is used.

Published historical direction evidence for those boundaries is:

- Moneyline 8-12pp conviction: 52.94% in 2024 and 63.29% in untouched 2025;
  12pp+: 66.89% and 62.79%.
- Total gap 0.30-0.50: 55.52% in 2024 and 54.95% in untouched 2025; 0.50+:
  54.39% and 64.49%.
- puck probability 58-64%: 66.67% in 2024 and 70.15% in untouched 2025;
  higher bands remained at least 61.49% in untouched 2025.

## Acceptance gates

On eligible r14-r20 immutable 2026 locks, both the first 70% and final 30% must:

1. improve or preserve actionable accuracy and exact-price units overall;
2. avoid a material accuracy or unit regression in any market with at least ten
   candidate actionables;
3. keep actionables above 25% of priced markets overall and retain every market
   family;
4. produce at least one actionable promotion as well as any actionable
   demotions;
5. improve grade ordering: actionable accuracy must exceed Watchlist accuracy,
   and Best Angle must not trail Lean when the sample is large enough;
6. preserve every locked row and use the existing sole NHL writer/lease.

Failure of any gate rejects the live change. No third threshold search against
the opened 2026 confirmation segment is permitted in this task.

