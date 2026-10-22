# NBA player props portable frozen-artifact checksum r4

## Scope

- Sport/model family: private NBA player props only.
- Runtime artifact / decision releases:
  `nba_player_props_frozen_runtime_artifact_2026_10_22_r4_binary_checksum` /
  `nba_player_props_forward_decision_2026_10_22_r4_binary_checksum_disabled`.
- Writer, lease, cadence, product, lifecycle, model, grade, public gate, member
  navigation, and locked records remain unchanged.
- Starting production base: `5c40cb82e5cba7a2b4ec71b01c8c134582b5268f`.

## Production finding

The r3 source artifact and local optimized server bundle produced the same
canonical-key checksum. Both the custom production domain and the exact Vercel
deployment URL nevertheless failed closed with `last_known_good_preserved` and
an artifact checksum mismatch. No candidate snapshot was published and the
public gate remained false.

The remaining portability risk was textual decimal-number serialization across
Node/V8 runtimes. R4 retains sorted object keys and array order, but encodes each
finite number as its exact big-endian IEEE-754 bytes. Strings are UTF-8
byte-length-prefixed and every JSON type is tagged. Non-finite values fail
closed. Negative zero follows ordinary JSON semantics and is normalized to
zero.

## Model and board impact

Zero. The frozen coefficients, selected candidates, inputs, projections,
probabilities, sides, prices, grades, promotions, demotions, actionable count,
provider usage, and public surface are unchanged. The accepted r12/r11 replay
and its 137 actionables remain the governing model evidence.

## Required proof

Publication requires reordered-key and exact-number checksum tests, exact
2,657-row runtime parity, focused NBA player-props tests, TypeScript, the full
model-change gate, an optimized production build whose bundled artifact verifies
against its embedded checksum, latest-main integration safety, protected PR
checks, and a post-deploy leased refresh proving the r4 decision release in a
private snapshot with `publicEnabled=false`.

Rollback preserves the last known good private snapshot. No locked or public
row may be rewritten.
