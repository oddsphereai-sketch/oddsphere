# Opening-to-lock prediction-market display

Starting production base: `48ad667d5e1bc585a2bf4a6281a6fbcff2d6c1de`.

Display-only follow-up to #867. Preserve the approved compact mint/violet
chart and all existing model releases, selections, public/sharp splits,
prediction leases and immutable locked member payloads.

Production verification found a scheduling issue: the candle helper re-sorted
the caller's selected-game priority by game date, allowing yesterday's failed
requests to starve tonight's readers. Preserve caller priority for unfilled
history; keep the existing three-public-request ceiling.

Book backfill includes the actual published movement-reference fallback when
it differs from the preferred sharp book and exists in OWLS discovery. This
uses the unchanged three-history-request cycle / 48-per-sport daily limits;
it does not splice Circa's opening into a BetMGM/DraftKings trace. Deferred
fallbacks rotate on later existing cycles.

The existing sole five-minute display capture additionally retains an auxiliary
receipt for each unlocked published selection. It contains only already-read
Kalshi and OWLS display evidence, with the actual capture time. No new provider
requests or prediction writer. After the authoritative lock, the prior receipt
cannot be refreshed; readers may use it only for the identical event, date,
orientation, market, pick, side and line, captured before the real lock time.

Stored locked sportsbook values always win. Only same-book/same-line archived
history may supplement the plot; every original stored quote and endpoint
retains exact precedence. A different book, missing stored trail, ambiguous
lock timestamp or retrospective capture cannot repair a locked record. Older
locks without an actual pre-lock receipt keep their exact prior behavior.
Source openings unavailable from a provider remain unavailable, not fabricated.
This is display context, not historical model-availability attestation.

Limitations: no time machine for old locked charts; no promise of contracts
where a provider has not listed one. A stored locked book different from the
captured display book remains the original book, even if that limits history.
The chart stops at the latest common actual observations before lock, rather
than inventing a quote at the lock instant. Selection changes require their
own pre-lock receipt. The normal five-minute cadence bounds terminal latency.

Read-only production proof: CAR–GB Over 47 was displayed with BetMGM, not
Circa. OWLS's exact BetMGM total history returned its own provider opening
Over 47 at -105 on October 25 21:55:28.071 UTC and 63 subsequent receipts.
The current production NFL Kalshi chart already spans more than six days;
the fallback backfill correction supplies the matching book's older leg.

Validation: eight focused chart/market/history suites, the new future-lock
writer-immutability and stored-reader-precedence suite, application TypeScript,
focused ESLint, production build and full `verify:model-change` passed. The
optional local PostgreSQL suite is unavailable without its configured URL.
No next real future lock has occurred during this morning verification;
future-lock behavior is fixture-tested, not falsely claimed as live-observed.
