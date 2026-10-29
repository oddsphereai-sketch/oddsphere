# NBA consumer execution-line authority predeclaration

Date: 2026-10-29  
Status: candidate only until clean PR, production deploy, leased refresh, and live verification

## Owner finding

The October 29 r23 repair truthfully rendered Circa's ATL pick'em quote, but
that solved the wrong product problem. Circa and Pinnacle are sharp evidence;
they are not automatically representative of the regulated consumer line a
member can actually bet. The live retail market contained real ATL -1 and
-1.5 offers while the member card displayed ATL PK.

No line may be rounded, shifted, or fabricated. The repair must restore two
separate authorities:

1. a real consumer-book quote owns the displayed line, exact-price grade, and
   future unlocked tracking tuple;
2. Circa/Pinnacle remain available to the existing professional reader for
   movement, resistance, confirmation, and qualified score correction.

## Candidate

- BALLDONTLIE GOAT supplies complete current Moneyline, Spread, and Total
  pairs from real retail books.
- Bet365, BetMGM, BetRivers, Caesars, DraftKings, Fanatics, FanDuel, and Hard
  Rock identities are eligible to own member execution. A source not returned
  by the provider is never invented.
- The broader truthful retail cohort remains stored for context, while Kalshi
  and Polymarket remain excluded from sportsbook authority.
- A complete production scope requires both a consumer execution pair and a
  Circa/Pinnacle reader pair. Partial provider cycles preserve the prior
  complete scope.
- Consensus chooses an actual offered consumer line. Exact-price selection is
  restricted to that line; it cannot improve model EV by silently switching
  to a different handicap.
- When real non-zero consumer Spread quotes exist, a sharp or consumer PK row
  cannot own the live card. No synthetic -1 or -1.5 conversion is permitted.
- Existing locked records keep exact stored precedence.

Candidate releases:

- model / prediction record: `nba_professional_unified_2026_10_29_r24_consumer_execution_authority`;
- market marriage: `nba_market_marriage_2026_10_29_r25_consumer_execution_authority`;
- grade policy: `nba_grade_policy_2026_10_29_r15_consumer_execution_authority`;
- line refresh: `nba_daily_refresh_schedule_2026_10_29_r20_consumer_execution_authority`;
- locked member snapshot: `nba_locked_member_snapshot_2026_10_29_r6_consumer_execution_authority`;
- member lock publication: `nba_member_lock_publication_2026_10_29_r8_consumer_execution_authority`.

The independent coefficients, residual calibration, injury inputs, reader
thresholds, reader correction bounds, lease, sole writer, lock time, stakes,
and settlement logic do not change.

## Gates

- exact-date BALLDONTLIE game identity must match stored home, away, and start
  time before any quote enters the board;
- every book/market must be a coherent two-sided pair;
- all nine current markets must have consumer and sharp coverage;
- no provider errors or incomplete groups;
- no score-projection change from source separation alone;
- no actionable demotion; every promotion must be stated explicitly;
- focused parser, pair, execution, reader, writer, T-60, and lock-immutability
  tests plus TypeScript and `npm run verify:model-change` must pass;
- latest-main integration safety, protected PR checks, merge, production
  release verification, and a successful leased refresh are mandatory.

Rollback future unlocked evaluation to r23/r24/r14 and r19 if consumer coverage
contracts, a sharp quote reclaims member authority, a displayed line is not an
exact provider offer, a locked payload changes, or the live board differs from
the reviewed tuple.
