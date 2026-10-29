# Newly opened contract chart fallback

Starting production base: `9470157afe530f75e33e52dca161cf6a1803e909`.

Exact Cleveland–Atlanta total/spread contracts became available around
2026-10-29 09:49:19 Eastern. Read-only OWLS queries confirmed both series,
correct event identity and source open time. Initial stored totals had one
or two fresh bid/ask observations; some book quotes ended before that new
source window. The aligned comparison correctly refused a false overlap,
but the UI then reduced the section to a lone Kalshi point while suppressing
the real, older sportsbook history. This was an incomplete display state,
not evidence that either side's opening timestamps should be manufactured.

Display the actual same-book/same-side/same-line sportsbook graph while a
Kalshi contract is absent, new or non-overlapping. A current Kalshi quote may
be shown separately, explicitly not a plotted history. Restore the existing
aligned two-line comparison automatically when normal scheduled receipts
provide enough genuine shared history. No change to provider requests,
schedules, forecasts, prices, picks, grades, splits or model inputs.

Use the same compact mint/violet component, with a violet-only history axis
and an explicit source label. A real single sportsbook quote remains one
point, not an invented flat history. Old locked unavailable states are
preserved. Future pre-lock auxiliary receipts still pass the existing stored
book/line/quote precedence guard and every chart quote is capped at lock.
