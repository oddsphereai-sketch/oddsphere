# NHL Playbook split identity repair (reader r10)

## Scope

The September 30 production NHL slate had complete Playbook money-and-ticket
splits for PIT-PHI, NYI-TOR, and LAK-COL, but the observation writer persisted
zero Playbook rows. Database teams use canonical abbreviations while Playbook
uses full team names. The shared observation join used a generic nickname key,
so values such as `NYI@TOR` and `Islanders@Leafs` did not match.

Reader r10 uses the existing NHL team normalizer on both sides of that join.
It does not add a provider request, writer, schedule, lease, label, copy, or
layout. Playbook remains the independent Public Consensus source; SharpAPI
named-book evidence remains in Sharp Book Splits. Failed provider refreshes
still preserve the last complete stored observation.

## Model and board impact

Public splits do not enter the r10 NHL score equation or play-grade equation.
For identical captured prediction inputs, projected scores, sides,
probabilities, prices, grades, stakes, locks, and tracking are unchanged. The
three-game board and all nine market slots remain present, with zero promotions,
demotions, or actionable-count changes. The intended display-only impact is
that the six complete Playbook rows per game can populate Public Consensus
independently of the named-book Sharp panel.

## Validation and rollback

Required validation includes the NHL focused suite, split overlay suites,
TypeScript, full model-change verification, integration safety against the
latest production main, protected-PR checks, and a production refresh proving
18 Playbook cells persisted and the live reader shows distinct Public and
Sharp sections. Roll back reader r10 and the NHL-specific join branch if the
repair changes any prediction output, reduces board coverage, or duplicates a
source across the two split panels.
