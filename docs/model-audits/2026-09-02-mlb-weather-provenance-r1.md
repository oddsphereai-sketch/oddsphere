# MLB weather provenance and Playbook fallback audit — 2026-09-02

## Classification

This is a behavior-neutral provenance correction. It does not change a weather
value, model input, probability, score projection, side, grade, stake, provider
call, query count, writer, lease, schedule, or publication rule. The active MLB
full-game and first-inning model releases remain unchanged.

## Production finding

A SELECT-only review of the September 2 MLB slate found that all 15 prediction
payloads retained the weather values used by the model, but none retained the
standard `weather_forecasts.fetched_at` timestamp. The current weather table is
refreshed in place, so later successful refreshes prevent an exact historical
timestamp reconstruction for earlier or locked predictions.

The same review found 15 Playbook venue/weather rows marked stale and unapplied.
Their bounded provider response reported an embedded OpenWeather `429` request
limit failure. The model correctly continued with its already-loaded standard
weather snapshot. The normal `feature_coverage_refresh` path remained healthy;
the latest observed natural run completed successfully with 554 records and 60
calls. Therefore the issue was missing audit provenance, not a failed standard
weather input.

At the call-level failure boundary, the existing code also continued safely but
recorded only a server log. It did not attach a per-game explanation to the
prediction payload.

## Correction

- The existing `weather_forecasts` query selects its already-stored
  `fetched_at` column. The in-memory weather snapshot labels that row as
  `weather_forecasts`.
- The full-game and first-inning feature captures persist that source and
  timestamp under additive `fc_v2` and `fi_fc_v2` capture schemas.
- Playbook audit metadata classifies each row as `fresh`, `missing`, `stale`,
  `rate_limited`, `unavailable`, or `provider_error`, and records whether the
  unchanged fallback was `weather_forecasts`, a legacy weather snapshot, or
  unavailable.
- A call-level Playbook failure produces the same bounded per-game audit. The
  raw error is not persisted, and no credentials or provider response body are
  copied into model output.
- Fresh Playbook behavior is unchanged. Stale, missing, rate-limited, or failed
  Playbook data continues to leave the standard weather snapshot untouched.

## Failure and compatibility boundaries

Historical payloads and fixtures remain readable because standard-weather
provenance is optional on the in-memory snapshot. A missing standard row is
truthfully recorded as unavailable rather than synthesized. The correction
does not attempt to repair provider billing or account state and does not add a
retry or a second provider path.

Focused tests require:

- fresh Playbook rows retain existing application behavior;
- embedded and call-level `429` failures are classified as rate-limited;
- network/provider unavailability is separately classified;
- failed overlays retain the exact input snapshot;
- full-game and first-inning outputs are byte-identical after stripping only
  the newly added weather provenance fields.
