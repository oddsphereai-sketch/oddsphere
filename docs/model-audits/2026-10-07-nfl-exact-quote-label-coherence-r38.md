# NFL exact-quote label coherence r38/r30

## Scope and authority

- Sport: NFL Daily Edge.
- Markets: displayed Spread and Total exact-price tuples; Moneyline was audited
  and is unchanged.
- Authoritative writer/model/decision: unchanged r53/r23/r28 production family
  under the existing `prediction_pipeline:nfl` lease.
- Fixture / compact snapshot:
  `nfl_weekly_member_fixture_2026_10_07_r38_exact_quote_label_coherence` and
  `nfl_forward_member_snapshot_2026_10_07_r30_exact_quote_label_coherence`.
- Availability predecessor: r37/r29 winner coherence.

## Confirmed defect

The decision already stored one coherent exact sportsbook tuple, but the member
fixture formed the Spread and Total text from a separate representative current
book. It then displayed the evaluated sportsbook's price beside that other
book's line. For PHI @ JAX, the decision was BetMGM JAX -7.5 at -105 while the
card rendered JAX -7 at -105.

## Repair

The member fixture now derives a Spread or Total label from
`decision.evaluatedQuote.line`, the same tuple that supplies sportsbook, price,
trail, probability, and grade economics. The opposing label is derived from
the exact complement. Moneyline labels are unchanged. There is no new copy,
label taxonomy, layout, provider request, writer, database loop, schedule,
lease, stake, grade rule, or prediction rule.

## Exact current-slate replay

Input: 2026 Week 5, 15 games / 45 markets. The repaired candidate has zero
unmatched sportsbook/line/price tuples. Nine labels change:

- TB @ DAL: DAL -8.5 to DAL -8 at Caesars -107.
- PHI @ JAX: JAX -7 to JAX -7.5 at BetMGM -105.
- HOU @ TEN: HOU -7 to HOU -7.5 at Caesars -104.
- CIN @ MIA: MIA +7.5 to MIA +7 at Caesars -105.
- CLE @ NYJ: CLE +1.5 to CLE +2.5 at DraftKings -112.
- CLE @ NYJ: Over 40.5 to Over 40 at Caesars -109.
- LV @ NE: Over 44.5 to Over 45 at Caesars -109.
- CHI @ GB: CHI -2.5 to CHI -3 at BetMGM -102.
- BAL @ ATL: ATL -3 to ATL -3.5 at Caesars +100.

Every score, prediction side, probability, exact price, sportsbook, verdict,
stake, lock, and tracking rule is unchanged. The board remains 18 actionable
markets. Promotions: zero. Demotions: zero.

## Verification and rollback

- `npx tsx scripts/test-nfl-week-one-held-member-fixture.ts`
- `npx tsx scripts/test-nfl-forward-member-snapshot.ts`
- `npx tsx --env-file=.env.local scripts/operator/audit-nfl-current-price-mapping.ts`
- `npm run verify:model-change`
- latest-main integration-safety and protected-PR checks

Roll back the fixture/snapshot publication identifiers to r37/r29 on an unmatched
tuple, prediction/grade/actionable drift, mixed current publication, reader
failure, lock failure, or writer overlap. Prior immutable locks remain unchanged.
