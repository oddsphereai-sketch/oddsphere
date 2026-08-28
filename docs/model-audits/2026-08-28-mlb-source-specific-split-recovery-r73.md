# MLB source-specific split recovery r73

## Scope

This release repairs a member-evidence omission without changing the MLB
prediction or decision engine. The live San Diego–Tampa Bay Total had a valid
current DraftKings two-sided split pair in the canonical source-aware store,
but the member DTO retained only Playbook consensus and Circa. Because Circa's
provider rows were unsupported exact endpoints, the reader correctly withheld
those percentages but incorrectly omitted the valid named-book fallback.

## Provider evidence

A bounded read-only SharpAPI event probe on August 28 returned:

- DraftKings Total: Over 57% tickets / 20% handle; Under 43% tickets / 80% handle.
- Circa Total: Over 100% tickets / 100% handle; Under 0% tickets / 0% handle.
- BetMGM: ticket shares only, with handle shares absent.

SharpAPI exposes percentages but no sample-count field. The existing r71
boundary therefore continues to reject the unsupported exact Circa endpoints.
DraftKings is the current complete fallback; BetMGM remains ineligible until it
supplies both sides of both ticket and handle shares.

## Release contract

1. Circa is always evaluated first and automatically displaces a fallback once
   it supplies a fresh, complete, verified two-sided ticket-and-handle pair.
2. DraftKings is the first fallback; BetMGM is second and subject to the same
   completeness and endpoint validation.
3. The fallback is explicitly source-labeled in the existing Market Splits
   panel and never called Circa data.
4. The fallback is display-only. It is not passed into `sharpBookSplits` and
   cannot alter Market Read, recommendation copy, grade, stake, or tracking.
5. Playbook public consensus remains separate. No sources are blended and no
   percentages are synthesized.

## Board impact

Before and after grade counts, picks, probabilities, exact tuples, and stakes
are byte-for-byte identical. Promotions: 0. Demotions: 0. The only intended
member change is recovery of a real source-labeled split panel when Circa is
temporarily incomplete.

## Rollback

Restore shared member presentation r10 and remove the optional
`sportsbookSplits` DTO field. Retain MLB decision r72 and every r71/r72 writer,
mirror, last-known-good, lock, and member endpoint-integrity guard.
