# MLB Sharp-context health availability classification

## Scope

This is a behavior-neutral monitoring correction. It does not change a prediction,
projection, probability, side, grade, stake, writer, repair path, provider call,
reader response, or database schema.

`sharp_context_unavailable_current_source` now follows the evidence object's
`sourceMissingMateriality`: ordinary current-source absence is a medium availability
warning, while an explicitly high-materiality contract remains high. Sharp mapping,
persistence, exact-price, same-release, and model-coherence findings retain their
existing independent high or blocking classifications.

## Production evidence before the correction

The natural 2026-09-03 08:35 UTC `daily_edge_data_health` cycle completed in about
two seconds with 11 unresolved high findings: nine Moneyline rows and two Total rows
(`SF@PIT` and `BOS@BAL`). Every finding had the same exact code,
`ml_total_sharp_context_missing`, and none was repair-eligible.

The rows retained coherent current prices, model probabilities, consensus evidence,
release stamps, weather provenance, and decision tuples. The upstream Sharp split
refresh truthfully rejected cross-date event rows and retained prior valid data; it
did not supply current Sharp context for these rows. The evidence builder already
classified this absence as medium materiality. One affected Total was actionable,
so the warning must remain visible, but source absence alone was not evidence that
the forecast tuple or public reader was corrupt.

## Safety boundary

- No missing Sharp row is relabeled as present.
- No synthetic split, line, movement, or price evidence is created.
- No prediction is promoted, demoted, flipped, repaired, or rewritten.
- A high-materiality evidence contract still produces a high finding.
- Mapping and persistence gaps remain on their prior high-severity paths.
- The health report remains fail-closed for genuine same-release, price, edge,
  lock, and model-coherence defects.

The intended operational result is truthful separation: external/current-source
availability remains a visible medium warning, while `safeForNormalReaderDisplay`
is reserved for actual high or blocking integrity findings.
