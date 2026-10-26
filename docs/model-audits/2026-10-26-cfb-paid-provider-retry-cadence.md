# CFB paid-provider retry cadence

Date: 2026-10-26

## Owner direction

Daniel Mengel directed Oddsphere to stop avoidable Playbook overage without
making odds, prices, locks, or other data late. The change must be isolated
from concurrent work and must preserve the five-minute T-60 scheduling window.

## Incident and root cause

The CFB cron intentionally wakes every five minutes so games entering the T-60
window receive multiple lock attempts. A separate FCS market-gap trigger could
also wake the complete provider collection immediately. When The Odds API
fallback was evaluated but did not make a request—for example because its
credit reserve or credential gate blocked the call—the resulting row recorded
zero requests. The next five-minute run therefore misclassified the same row
as never evaluated and repeated the complete provider collection, including
Playbook lines, weighted splits, and venue/weather reads.

Production evidence showed the amplification clearly: on October 26 through
the audit time, all 149 CFB cron runs entered a full provider cycle and all 149
were partial; on October 25, 242 of 287 runs entered a full cycle. This was not
fresh-data cadence. It was a retry-state defect around an unavailable fallback.

## Repair

The sole CFB writer advances from
`cfb_forward_evidence_writer_2026_10_24_r137_complete_current_school_identity`
to
`cfb_forward_evidence_writer_2026_10_26_r138_paid_provider_retry_cadence`.

An upcoming FCS row with a persistent price gap and no recorded successful The
Odds API request may request another provider-seed cycle only after the latest
complete capture reaches the existing fallback's 60-minute cadence. A completed
capture is the durable evidence that the fallback gate was evaluated even when
the gate correctly made zero requests.

The following behavior is explicitly unchanged:

- initial opening collection and its provider seed;
- the ordinary hourly unlocked refresh;
- due T-60 collection and immutable lock priority;
- reference-line completion batches;
- the 15-minute public-splits refresh and its pregame-only guard;
- every model, calibration, forecast, decision, grade, stake, reader, and
  provider-selection rule;
- the sole `prediction_pipeline:cfb` lease and append-only evidence writer.

The cron remains scheduled every five minutes. Runs inside the paid-provider
cooldown perform the existing no-collection path, so member snapshot and
tracking maintenance continue without repeating the full provider bundle.

## Board and lock impact

The rule changes no same-input decision and creates no promotion, demotion,
side change, probability change, or actionable-count change. It only removes
provider cycles that occur earlier than the already documented hourly fallback
cadence. Existing locked payloads remain byte-for-byte authoritative, and no
stored row is updated, replaced, or reinterpreted.

## Verification and rollback

Required verification:

- a recent zero-request FCS gap does not create `provider_seed_due`;
- the same gap becomes eligible at 60 minutes;
- a due T-60 capture still outranks the retry cooldown;
- ordinary hourly collection remains due on schedule;
- the focused CFB production suite, TypeScript, `npm run verify:model-change`,
  and latest-main integration safety pass.

Roll back only the r138 writer trigger to r137 if a due opening, ordinary hourly
refresh, or T-60 capture is delayed; if provider calls exceed the existing
bounded cadence; or if any locked row changes. Never rewrite evidence or locks
created before or after rollback.
