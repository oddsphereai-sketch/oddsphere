# NFL player props point-in-time depth-role predeclaration

Date: 2026-10-08  
Status: frozen shadow follow-up; no production identifier reserved

## Hypothesis

The prior external and component tournaments improved established-player point forecasts but left
nine exact locked scopes without enough player history. Public depth charts supply the missing role
prior: starter/backup state, formation slot, depth within slot, and an observation timestamp from
2025 onward.

Add only these as-of-pregame role fields to the previously frozen opportunity × team-share ×
efficiency hierarchy. Train share and efficiency components on active players including career-first
and team-first appearances rather than requiring a prior roster game. Missing depth evidence remains
missing; it is not interpreted as inactive or zero opportunity.

## Frozen test

- The architecture, HGB hyperparameters, market-free contract, blend weights, and component bounds
  remain unchanged from the opportunity-efficiency predeclaration.
- Add the five depth-role fields to the applicable player component only.
- 2016-2023 is training, 2024 is selection, and 2025 is confirmation.
- Candidate evaluation against the released head remains on identical settled rows.
- For the already-opened 2026 Weeks 1-4 diagnostic, expand inference to active players with a
  pregame depth row even when the released eligibility rule lacks prior player history.
- Report how many previously unmatched exact scopes gain a projection and whether point,
  probability, direction, retention, and game-clustered intervals improve.

The candidate fails if it does not confirm in 2025, if it worsens either 2026 point metric versus
the locked independent projection, if its probability score remains materially worse than market,
or if it obtains apparent accuracy by losing cold-start coverage. Because 2026 has already been
inspected, even a passing diagnostic requires a later untouched confirmation window before release.
