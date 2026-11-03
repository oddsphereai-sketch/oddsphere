# CBB retail response receipt correction — November 3

Base: `8f830095c544af456f2ba7f2d15d5668a6fa6a61`, including CBB PR976 and NHL PR977.
The owner authorized immediate deployment, actual market spot checks and fixes.

The first production refresh published R10/R12 at23:02:38 UTC to15 unlocked
games. Ten are on today's slate. Seven7PM games crossed T60 before deployment
and retained the earlier R5 public snapshot. The128 locked member payloads and
381 tracking rows include the unchanged original121/360 predeploy baseline.

Independent source/decision spot reviews of Alabama State–Texas A&M,
Drexel–Virginia, Sam Houston–Alabama and Lipscomb–Iowa reproduced the stored
professional price effects, native Circa holds, final probabilities and grades.
All30 current unlocked today-market probabilities/EVs agree with the final law.
SDSU's margin also responds19.36→16.10 to professional weakening. These are
functional checks, not settled predictive qualification.

The operator then traced zero normalized retail context pairs to actual stored
rows. BetMGM observations6181174–6181179 have ingestion-run start
23:00:24.995, fetched_at23:00:25.594 (actual response completion), and
inserted_at23:00:26.547529. The existing collector deliberately passes
retailFetchedAt after the response. The consumer required run-start equality,
so it rejected valid retail history before pressure interpretation.

The repair allows ordered run-start≤response-completion≤insertion for typed
retail price rows only. It keeps both original clocks, exact native opposing
sides, original provider observation, immutable IDs/hashes, source identity and
DB availability upper bound. Future provider updates after response completion,
backward clocks and cross-response splices remain invalid. Professional price
and split clock contracts remain unchanged. Retail stays pressure context and
cannot become a professional numeric source.

Model R11 /grade R13 /receipt R7 /board R14 /publisher R23 /tracking R11
/adapter R12 /canonical evidence R4 version this change. Existing R10/R12/R6
locks, tracking labels, reader explanations and original unlocked anchors retain
their exact released lineage. The independent R3 artifact, score law, pricing,
grade reserves, provider cadence, sole leased writer and stakes are unchanged.

Focused clock/lineage tests exercise actual response-later-than-start clocks,
rejected future/backward/split responses, R10 writer/reader/tracking precedence
and R6 anchor reuse. Existing end-to-end promotion and demotion cases remain
mandatory alongside the full model-change gate. A stored current-board capture
and comparison records source coverage and board-count impact before publication.

The actual stored10-game/30-market comparison now admits631 retail context
pairs (previously zero). It changes0 scores,0 sides and0 grades on these saved
decisions:5 actionables remain5, with0 promotions and0 demotions. Existing
qualified-action promotion and source-resistance demotion tests pass; no board
quota manufactures a balancing pick. This file-only comparison joins only saved
receipt/current targets plus newly qualified stored history, not a replacement
provider response. Actual production refresh verification remains required.

Full `npm run verify:model-change`, focused CBB producer→native consumer clocks,
market/grade/lock/pipeline checks and TypeScript pass. Local PostgreSQL proof is
unset; the prior PR976 hosted PostgreSQL proof is green, and this follow-up must
pass its affected hosted integration/build checks. The real collector→consumer
regression uses different actual run-start/response clocks, so it reproduces the
defect rather than testing only synthetic equal timestamps.
