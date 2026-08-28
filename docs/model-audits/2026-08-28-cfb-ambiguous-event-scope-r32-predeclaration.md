# CFB ambiguous canonical event scope r32 predeclaration

## Trigger

The first untouched natural cycle after r31 reached the deeper SharpAPI event pages, proving the pagination repair, then failed before append because provider game 458636 (UNH at UAlbany) matched two distinct canonical Sharp event IDs at the same exact teams and kickoff. This FCS game had no previously stored named-book pair. A market-evidence ambiguity for one game must not suppress the other 37 games or their 111 sibling market slots.

## Frozen change

- Keep exact normalized home/away identity and kickoff tolerance unchanged.
- Keep canonical event reuse across different scheduled games fatal.
- When one scheduled game has more than one exact canonical event ID, make that game's Sharp exact-price fallback market-scoped unavailable, request odds from neither ambiguous ID, and retain no synthetic line, price, probability, EV, or event identity.
- Return a structured `ambiguous` discovery status to the sole writer and stamp `sharpapi_canonical_event_ambiguous` in that game's availability warnings.
- Continue processing every unambiguous game and preserve the one all-game append after every forecast/coherence check passes.
- Preserve the 8-page per-date and 192-request all-run caps, repeated/non-advancing page guards, hourly active-slate collection cadence, T-60 capture, sole `prediction_pipeline:cfb` lease, and strict split matching.
- Apply the owner's collection contract: six-hour unlocked refreshes while a game is more than 24 hours away, hourly refreshes inside 24 hours, plus the event-triggered T-60 capture/lock. The scheduled 15-minute heartbeat may notice T-60 eligibility but is not a provider/write cadence.

Provider/decision/tuple/collector/member/writer/fixture releases advance to r10/r15/r9/r17/r19/r22/r23 respectively. PMF, calibration, thresholds, grade policy, public outcome contract, stakes, and tracking rules are unchanged. The complete r29 member wave remains the atomic fallback until one complete r32 wave exists.

## Acceptance

1. A two-event exact identity returns `ambiguous`, makes zero odds calls for those IDs, and does not throw.
2. An ambiguous game receives only real non-Sharp evidence available from the normal writer path and keeps all missing exact-price markets as public No Play with its independent forecast.
3. Other exact games still resolve their real named-book tuples; canonical event reuse across different games remains fatal.
4. Focused/full verification, build, integration safety, protected publication, untouched natural cycle, 38-game/114-slot SELECT-only replay, and signed-in QA pass.
