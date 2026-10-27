# Owls professional-basketball team-identity repair

Date: 2026-10-27

## Production failure

After the initial Owls cutover, the live NBA reader rendered `Sharp Splits — Limited` without
percentages. A live Owls request returned the current games and complete Circa Moneyline, Total,
and Spread money/ticket pairs. The overlay nevertheless populated zero current games because Owls
uses full team names (`Detroit Pistons`, `New York Knicks`) while the member response uses
abbreviations (`DET`, `NY`). The generic normalized-string comparison rejected the pair.

## Bounded repair

For NBA and WNBA only, the response overlay resolves both provider and member team identities with
the existing `playbookTeamNormalizer` canonical registry. It then retains every prior exact sport,
date, away/home orientation, complete two-sided pair, freshness, and unique-match gate. No fuzzy
matching is introduced; unknown or ambiguous teams fail closed. The CFB, NFL, NHL, and MLB matchers
are unchanged.

Playbook remains the Public Consensus authority. Owls remains the source-specific Sharp Book Splits
authority, preferring Circa. This repair does not make Owls an odds-history provider and does not
change the existing same-book opening/prior/current price trail.

## Releases and immutability

- Member presentation: `daily_edge_member_presentation_2026_10_27_r29_owls_pro_team_identity`
- Market Intelligence capture: `market_intelligence_v2_shadow_capture_2026_10_27_r7_owls_pro_team_identity`
- Immediate predecessor: r28 presentation / r6 capture
- Existing locked snapshots remain exact and are never overlaid.
- Picks, probabilities, evaluated prices, grades, stakes, tracking rows, writer ownership,
  schedules, provider budgets, and sport-scoped leases are unchanged.

## Evidence

The focused fixture proves full-name-to-abbreviation identity for all five games returned by the
live NBA endpoint, the WNBA resolver path, and a UTC `20261028` provider event matching the same
2026-10-27 Eastern slate game.

A read-only rehearsal cloned the production NBA response, fetched the live Owls rows, applied the
candidate overlay, and aligned the final sections into the internal reader. The four current member
games received 12 complete sections: Moneyline, Total, and Spread for each game. All 12 sections
were mirrored into the internal market read. A before/after comparison of pick, probability,
market probability, current price, grade, stake, lock, and tracking fields reported zero changes.

Same-input promotions, demotions, side changes, probability changes, grade changes, and actionable
count changes are therefore zero by contract.

The separate live CFB rehearsal read the current 100-game published member board and the 56 games
currently exposed by Owls. The existing canonical college-team resolver matched all 56 Owls games;
none was lost to an abbreviation or school-name mismatch. Owls populated 162 new Moneyline/Total/
Spread sections, and exact-game continuity brought the final internal reader to 168 aligned
sections, again with zero writer-owned field changes. The other 44 board games have no Owls event
at this observation time; they are upstream coverage gaps and must remain explicitly unavailable
unless an exact verified fallback exists.

## Rollback

Roll back future-unlocked presentation/capture to r28/r5 if a row crosses game identity, an unknown
team is accepted, a partial pair is presented as complete, any locked payload changes, or current
coverage regresses. Do not rewrite or delete previously stored evidence or locked records.
