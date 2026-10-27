# NFL Market Brain independent-prior lineage — frozen predeclaration

Date: 2026-10-27

Status: research-only contract correction; no production authority, prediction, grade, stake, lock, or member change.

## Failure being corrected

The Market Brain content-addresses the prior Margin and Total distributions, but the artifact does not
content-address the inputs that produced those distributions. A release label and a `targetFree` boolean
cannot prove that the independent prior is market-free or that later context/market evidence is genuinely
incremental. In particular, an external projection with undocumented upstream methodology must not be
treated as independently market-free merely because Oddsphere does not pass a line into its local adapter.

## Frozen correction

Every new Margin/Total prior artifact must carry a canonical, content-addressed input-lineage object that:

1. identifies the event, model path, source components, component releases, availability times, and hashes;
2. declares each component's relationship to market information;
3. derives qualification from a versioned contract-owned model-path registry rather than accepting a
   caller-authored `targetFree`, policy, or component-relationship claim;
4. qualifies only when the registered model path prohibits market inputs, its exact release/component
   manifest is attested, and every component is explicitly excluded from market information;
5. marks external/unknown methodology ineligible; and
6. remains part of the prior artifact hash and therefore of every downstream sequence, feature, research
   input, artifact, prediction, and evaluation identity.

The frozen Week 1 artifact may qualify only when its exact event row and stored Margin/Total PMFs match.
The NFL exact-provider score remains auditable but ineligible for executable research until a persisted
deterministic replay receipt binds its exact dynamic input bytes to its output PMFs. The BALLDONTLIE weekly projection is external methodology and
must remain `unknown`/ineligible unless the provider supplies a verifiable market-input contract. An
ineligible prior may be retained for audit, but the sequence exporter, trainer, resolver, and evaluator must
not qualify it as proof of incremental Market Brain value.

## Acceptance tests

- a qualified exact-provider/static-artifact lineage survives capture, reference hydration, sequence, and
  feature export with identical lineage hashes;
- changing a component hash, release, event, availability time, or market relation invalidates the prior;
- relabeling `external_projection` or `other` as prohibited/all-excluded remains ineligible and fails the
  complete case-to-sequence-to-feature path;
- relabeling arbitrary PMFs as a registered frozen-artifact path fails exact event membership/output-byte
  verification; the dynamic exact-provider path fails closed without a replay receipt;
- `unknown` or market-containing lineage builds an auditable artifact but cannot enter executable research;
- reference hydration proves the same lineage hash as the content-addressed artifact;
- evaluation recomputes the complete sequence checksum and repeats the registered NFL lineage attestation;
- live/authoritative NFL payload bytes remain unchanged with Market Brain disabled;
- a stored collector-r28 slate follows normal cadence and does not trigger a research-only provider refresh;
- all affected semantic releases advance; existing locked member payloads retain exact precedence.

This correction advances MB-016/MB-021 but does not close them. Full no-double-count closure still requires
attested runtime inputs, family ablations, and untouched evidence showing incremental benefit over the
strongest non-market comparator.
