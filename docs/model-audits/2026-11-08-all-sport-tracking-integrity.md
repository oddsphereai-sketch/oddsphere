# November 8 all-sport tracking integrity audit

Starting production base: `045b233e9fee95022a0b2c94ec149622fb7706f6`. Integrated newer protected release `68e3c51b5bd2fb4cdfd80cf6b2de2d07a3964d98` before final validation.

## Evidence and scope

Complete ordered ledger reads examined 13,415 stored rows and 11,928 canonical market rows across 3,929 games. The audit uses the canonical grading policy, including WNBA legacy slate voids and immutable FI snapshot precedence. Counts below are the November 8 audit baseline before the nine approved CFB corrections; pending future games are expected.

| Sport | Best Angles + Leans | Settled | Future pending | Missing terminal grades |
|---|---:|---:|---:|---:|
| mlb | 1683 | 1683 | 0 | 0 |
| nba | 136 | 136 | 0 | 0 |
| nhl | 482 | 482 | 0 | 0 |
| soccer | 37 | 37 | 0 | 0 |
| wnba | 184 | 184 | 0 | 0 |
| epl | 90 | 87 | 3 | 0 |
| cfb | 957 | 957 | 0 | 0 |
| ucl | 23 | 23 | 0 | 0 |
| nfl | 156 | 155 | 1 | 0 |
| cbb | 257 | 257 | 0 | 0 |

Independent saved-source census: CBB 257 actionable locks matched; WNBA 181 matched; NFL 154 matched, with six previously owner-approved released supersessions; CFB 981 matched, with the nine newly approved exact-source corrections. No retrospective forecast or current price is used to invent a historical call.

## Repairs and limits

- CFB season identity pagination already repaired by #1059. This release preserves that path and prevents read failures masquerading as an empty grade ledger.
- Nine approved October 24/31 CFB corrections append exact saved T60 tuples, pinned to source ID and SHA-256. All nine positive real-source proofs passed, including original prices/probabilities, causal quote timestamps and final score grading: Best Angle 1–0; Leans 7–1. Originals remain unchanged. Canonical CFB r155 materializes them under its existing sport lease; the reviewed operator grades only their new IDs under that same lease.
- Original MLB FI snapshot precedence restores eight existing public grades (1 Best, 7 Leans) hidden by contradictory indexed Held fields. It writes no original payload. Seven have stored W/L results. The July 11 Toronto–San Diego Lean has a historical Void despite a frozen NRFI pick and two first-inning runs; separate owner approval is pending before any correction. A June 24 nonactionable legacy row lacks first-inning score evidence; its existing Void remains unchanged.
- Historical CFB 847 and NFL 11 result differences reflect canonical games regressed to scheduled status, while their terminal results/final scores remain stored. The audit reports these as source-status regressions and never downgrades a final result to pending.
- Seven June World Cup Caution voids and six WNBA ET-slate voids retain their original legacy settlement semantics. No bulk historical regrade.
- Existing late legacy locks remain visible as historical evidence; no timestamps are rewritten.

## Prevention

The existing hourly tracking-refresh owner reconciles every sport against saved lock manifests, then compares canonical settlement. Missing entire markets, missing locked rows, overdue results and true terminal result differences produce a partial cron result with persisted concise error identifiers. A private authenticated read-only endpoint exposes the same report. Reads are bounded, ordered and projected; failures abort rather than publishing empty healthy output. There is no new schedule or independent prediction writer.

Future current-board grade promotions/demotions: 0/0. Historical visibility is reported separately. Reader caches and stored snapshot keys are versioned; current-release performance does not blend correction wrappers with newer models.

Validation: focused tracking integrity, aggregation, official markets, refresh, page, winner scorecards and CFB production contracts; mandatory full model gate; production build and TypeScript; fresh-main integration guard and protected PR; postmerge exact production commit, natural writer, scoped new-ID settlement, original full-row hashes and live reader/cron report. Deployment results must be added after production proof.
