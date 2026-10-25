# NFL two-source flow and winner-preserving Spread boundary predeclaration

Date: 2026-10-25

Status: predeclared production candidate for future unlocked games only

Starting production base: `7e4153df597334d1658ffca4ade10b1a68e7433a`

## Defect

The r34 three-state reader correctly requires persistent, unreversed target-excluded Circa/Pinnacle
movement, but reuses the generic market-state split threshold of 8 percentage points for public
consensus and 10 points for a named-book split. The immutable October 25 Baltimore and San
Francisco locks show the failure: both Playbook and SharpAPI agreed with the named-book move, but
their money-minus-ticket gaps were 2/5 and 2/3 points. r34 therefore returned
`no_independent_flow_confirmation` for both games.

The San Francisco lock also exposes a second boundary defect. When target-excluded Moneyline
consensus preserves the independent winner but the qualified side read opposes the independent
Spread, the r34 reflection can cross zero and is then rejected. The coherent state—SF remains the
narrow outright winner while Atlanta +2.5 covers—is therefore unavailable.

## Candidate

For Moneyline/Spread side arbitration only:

1. keep the complete r34 authority path unchanged, including its existing generic material-flow
   qualification and winner-preserving reflection;
2. only when that existing flow path is unavailable, allow the persistent and unreversed available
   target-excluded Circa/Pinnacle move to qualify through two fresh independent flow sources:
   Playbook consensus plus a non-owning SharpAPI book. Both must agree with the named move, each
   must have an absolute money-minus-ticket gap of at least two percentage points, and any opposing
   source vetoes;
3. keep the three-family target-excluded no-vig 50% Moneyline boundary as the only authority that
   may flip the outright winner;
4. for the new two-source fallback only, when that boundary preserves the independent winner,
   place the categorical margin halfway between zero and the target-excluded Spread boundary only
   if this preserves the winner and flips the Spread side toward the qualified authority;
5. preserve the r34 grade firewall and freeze Total behavior.

This is not scalar market weighting. The rule selects one of three categorical states and one
winner-preserving Spread interval. Locked rows retain exact stored precedence and are never
recomputed, regraded, or replaced.

## Required evidence and gates

- Exact immutable replay must report winner, Spread, +3/+6, exact-price board, MAE, promotions,
  demotions, corrections, and harms against r34 on the identical cohort.
- Baltimore must enter `outcome_correction`; San Francisco must enter `value_resistance`, preserve
  SF as the projected winner, select Atlanta against the Spread, and demote the resisted SF
  Moneyline.
- No Total side, probability, grade, or stake may change.
- The current unlocked board must be rehearsed read-only with release and health reporting.
- Focused NFL tests, TypeScript, ESLint, `npm run verify:model-change`, latest-main integration
  safety, protected PR checks, and live release/health verification must pass.

Rollback restores the r34/r29/r28/r37/r66/r49/r41 release family for future unlocked rows only.
