# CFB official-availability source completeness

Date: 2026-10-17  
Status: owner-directed implementation candidate; production publication requires protected-PR gates

## Defect and scope

The production collector requested only SEC, ACC, Big Ten, and Big 12 reports. Its exact-game parser
and last-known continuity worked, but the American, MAC, Mountain West, CUSA, Sun Belt, and Pac-12
official public systems were never requested. Warning copy could describe that absence but could not
close it. This repair expands the existing collector and writer; it adds no cron, database writer,
prediction rule, market-reader rule, or inferred medical evidence.

## Predeclared invariants

- One authoritative CFB writer remains protected by `prediction_pipeline:cfb`.
- Stored evidence and locked member records are append-only and immutable.
- Attachment requires exactly one provider game with the same away team, home team, and Eastern
  game date. Ambiguity fails closed.
- Missing, pending, malformed, oversized, or failed sources produce no report and never imply a
  healthy player or team.
- Original source timestamps, status text, player name, and position are retained.
- Conference reports remain panel-only. The existing writer continues to exclude them from verified
  quarterback, projection, grade, stake, and lock authority.

## Source contract and bounded cost

The collector now supports ten conferences through three verified public contracts:

- HD Intelligence posts: SEC, ACC, Big Ten, Big 12, American, and MAC (six requests);
- conference-hosted JSON: Sun Belt and Pac-12 (two requests);
- signed Faktor embeds: Mountain West and CUSA. Each uses one official landing-page request and one
  embed request (four requests). The signed URL is never hard-coded and must resolve to the Faktor
  player-availability path.

Maximum cost is therefore 12 requests per due collector run. The existing six-hour ordinary and
one-hour final-pregame per-game cadence remains unchanged. Each response keeps the existing 10-second
timeout and 20 MB maximum. Provider failures are isolated and reported.

## Zero-write live evidence

At `2026-10-17T12:50:59.848Z`, the production-backed audit read 95 current-window games and wrote
zero rows. The old four-conference release had 26 exact live reports. The candidate made 12 requests
with zero failures and matched 32 exact reports, recovering six games absent from stored coverage:

- UNLV at Air Force (Mountain West);
- San Jose State at UTEP (Mountain West);
- Northern Illinois at Wyoming (Mountain West);
- Troy at Louisiana (Sun Belt);
- Louisiana Tech at UL Monroe (Sun Belt);
- Pittsburgh at Boston College (a newly published ACC update not yet stored).

The source breakdown was ACC 7, Big 12 6, Big Ten 7, Mountain West 3, Sun Belt 2, and SEC 7.
American and MAC reports were still officially `Report Pending`; CUSA exposed no current report.
The Pac-12 JSON matchups were not present in the current provider board. Those states correctly remain
unavailable until a report is published and an exact provider game exists. The candidate therefore
closes the ingestion-path gap without claiming that all 95 games have an official report.

## Releases, tests, and rollback

- official adapter: `cfb_official_conference_availability_2026_10_17_r2_all_published_fbs_feeds`;
- collector: `cfb_forward_evidence_collector_2026_10_17_r60_release_aware_availability_seed`;
- sole writer: `cfb_forward_evidence_writer_2026_10_17_r127_release_aware_availability_seed`.

Evidence schema, member, forecast, probability, calibration, decision, grade, market-reader, stake,
tracking, reader, snapshot, and lock releases remain unchanged. Focused tests cover all three feed
shapes, signed-URL validation, exact date/team rejection, Available-row filtering, HTML entity
decoding, status preservation, the 12-request ceiling, verified-clear replacement, and last-known
continuity. Full verification, integration safety, PR checks, and a natural post-deploy writer cycle
remain publication gates. Rollback restores adapter r1, collector r58, and writer r125 without
changing any stored or locked row.

## Post-deploy seeding correction

The first natural r59/r126 cycles proved the new collector and 12-request budget were live, but a
production read found that stored r58 request timestamps still satisfied the six-hour cadence check.
That delayed the first expanded-source attempt for already-polled games even though their preceding
attempt had queried only four conferences. R60/r127 makes the cadence marker collector-release aware:
only a successful attempt made by the current source set can suppress another request. Each game
therefore receives one bounded seed under r60, after which the unchanged ordinary/pregame cadence
applies. The regression test proves that a current-release attempt suppresses repeat polling while an
otherwise fresh older-release attempt does not. This changes no provider maximum, model authority,
locked row, or publication rule.
