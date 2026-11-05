# CBB cached-clock handoff

Starting base: `fa2dbfbe3b5af052c16c33e150e9b32ae3e221be`.

After PR1033's approved normal refresh, the database published313 rolling
forecasts and43 complete priced November5 cards. Browser requests intermittently
showed temporarily unavailable. Actual Vercel logs repeatedly recorded
`[member-data] cbb-locked-member-precedence failed: CBB locked reader identity
mismatch or corrupt lock index`. The warm shared published cache retained the
old unlocked UIW23:00Z clock while the sole writer saved the corrected00:00Z
record. Fresh direct API and read-only overlay on the new board passed; a later
warm browser read restored43 cards, proving a publication/cache handoff failure.

Reader R1 reads the existing scalar identity index, then downloads full payloads
only for locked IDs or a changed unlocked start. It requires matching member ID,
external ID, original school names, internal snapshot/member chronology and the
indexed current start. The saved current DTO is authoritative; no prediction,
probability, score, grade, price, evidence or time is reconstructed. An existing
lock retains exact precedence. If locking races the index read, the full saved
locked record triggers the usual canonical-school/result read. Unchanged
unlocked rows incur no new full-history read. No provider, cron, writer, cache
TTL, model input, equation, grade, stake or stored record changes.

The actual old R20 UIW card replaces just that row in the current313-game saved
board for a SELECT-only reproduction. The repair serves313 games and the saved
00:00Z DTO without mutating its input; the former reader rejected this combination.
Focused tests cover this handoff, unchanged scalar-only path, wrong-school and
wrong-index-clock rejection and existing lock/writer/reader precedence. Independent
AI review found no remaining concrete blocker. Full model-change gate,
types/lint/build, fresh-main integration, protected PR and actual production
browser/API/normal-cycle verification are required before completion.
