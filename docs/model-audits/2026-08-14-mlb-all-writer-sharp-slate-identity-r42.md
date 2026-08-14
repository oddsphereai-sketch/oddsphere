# MLB r42 all-writer SharpAPI slate identity

Date: 2026-08-14

Previous release: `mlb_daily_edge_decision_2026_08_14_r41`
New release: `mlb_daily_edge_decision_2026_08_14_r42`
Rule bundle: `mlb_daily_edge_rule_bundle_v41_2026_08_14`
Grade policy: `mlb_public_grade_policy_v32_all_writer_sharp_slate_identity_2026_08_14`

## Post-r41 live finding

R41 correctly rejected the partial/stale SharpAPI payload in the recommendation
signal provider. The first required live audit then showed that the independent
Market Intelligence v2 observation collector had rebuilt 606 SharpAPI rows for
the repeated MIL-LAD matchup from that same payload. This collector feeds
source-aware reader and snapshot context, so leaving it open would permit false
evidence to re-enter downstream decisions or display despite the protected
signal provider.

## Completion correction

The observation collector now applies the same whole-payload schedule identity
contract before it builds either current or history observations: at least 70%
of unique matchup pairs must resolve on the requested slate, and the payload
must fit that slate better than the previous slate. Rejected payloads write zero
SharpAPI observations and make zero split-history requests. Playbook consensus
and canonical price observations are unaffected.

This adds no writer or timer and preserves the existing `prediction_pipeline`
lease. It is an identity correction rather than a fitted promotion/demotion
rule. Any action that disappears depended on invalid cross-slate evidence; no
replacement is manufactured to preserve board count.

Rollback is r41 only for a runtime failure or mixed release. Never restore the
invalid observation rows. Deployment requires the full model safety suite,
focused Market Intelligence tests, exact cleanup, an authoritative slate-cycle
publish, and a second live audit.
