# NFL Market Brain independent-review remediation

Status: local isolated branch only; not deployed, not production-authoritative, and not qualified to
change a prediction, probability, score, grade, stake, member card, tracking row, or locked record.

## Why this remediation exists

An independent code and statistical review found that the first foundation captured useful raw
evidence but still had causal-timing, target-leakage, chronology, evaluator-provenance, storage, and
context-depth gaps. Passing the original unit tests did not prove prediction improvement. This change
repairs those contracts before any fitted resolver or live influence is considered.

## Closed gaps

- Provider fetch, response receipt, ingestion, and inference availability are now distinct. Replay
  eligibility uses the availability boundary, including SharpAPI split-response receipt.
- Prior reuse is content-addressed by the exact artifact, including intrinsic availability, instead
  of assuming that a matching release string identifies identical bytes.
- Evaluated-family prices, splits, and missingness are removed per market before trainer features are
  built. Public aggregate splits with unknown target composition are excluded from target-safe input.
- Incomplete, stale, duplicate, and partial-price evidence remains as masked context. Conflicting
  immutable identities fail closed.
- Chronology considers the entire path: tied first movers may both lead, key crossings cannot vanish
  through an endpoint-only comparison, and price-only buyback can be represented without a line move.
- Candidate outputs bind frozen tournament, feature, training-manifest, fitted-weight, parameter-count,
  sequence, inference-time, and joint-posterior identities. Frozen objects are recursively immutable.
- Candidate joint Margin/Total distributions are scored directly. The incumbent's marginal-only prior
  is not converted into a fabricated joint distribution, so joint improvement remains unavailable
  until a coherent incumbent joint exists.
- Research summaries remain explicitly ineligible for qualification until exact-line Spread/Total,
  calibration/uncertainty, promotion/demotion plus board-balance, and release-pure economic gates exist.
- Player-level injury facts and numeric weather conditions are retained in the research tape rather
  than represented only by a count and a hash.
- Full-slate response bodies are not duplicated into every game. Each game stores its event rows plus
  whole-response digest/accounting, and unrelated-row growth is regression-tested.
- Research tapes are removed from the authoritative NFL payload before its append. Only after that
  succeeds is the bounded tape written to a separate append-only table. Research persistence errors
  are reported but cannot roll back authoritative evidence, member, tracking, or lock work. Capture
  is disabled unless `NFL_MARKET_BRAIN_SHADOW_CAPTURE_ENABLED=true`; both the lightweight continuity
  read and sidecar append have a two-second abort, and the cron reports sidecar health separately.
- Prior-artifact reuse is scoped to the exact shadow and evidence-contract releases. A newer contract
  cannot reference prior bytes that exist only in a superseded tape family.
- The append-only migration enforces the 96 KiB row limit and a transaction-serialized 256 MiB weekly
  raw-byte ceiling, records a 210-day expiry boundary, and grants the runtime no update/delete power.
- Source availability is now a chronological sequence across every eligible capture, rather than the
  latest snapshot. Outage, recovery, stale, incomplete, and duplicate transitions remain trainer
  tokens without source-manifest hashes.
- One-sided, timestamp-skewed, and conflicting observed prices that cannot form a no-vig pair remain
  explicit `unpaired_observed_quote` context tokens. A later causally observed row can replace its
  earlier provider-clock-skew `future` state.
- Simultaneous first movers with opposing directions and line/probability conflicts are labeled
  conflicted; lexicographic participant order cannot manufacture a leader direction.
- The trainer input is a branded, runtime-tagged object stripped of event, artifact, raw-row, player,
  and free-text identities. Future fitters must accept that boundary rather than the audit feature object.
- Research predictions must bind a validated persisted manifest containing fold identity, per-event
  first/last capture windows, and the opened-outcome registry. Evaluation refuses an event absent from
  its declared untouched partition, while run summaries permit different artifacts across genuine
  rolling-origin folds but reject mixed artifacts inside one fold. The manifest is appended to the
  dedicated immutable manifest table before the earliest untouched capture; only the database receipt can mint
  the runtime-attested manifest accepted by the evaluator and artifact binder. A receipt recorded at
  or after selection, confirmation, or prospective capture begins fails closed.
- The comparable frozen primary score is now Margin plus Total marginal log score. Candidate joint
  score remains an additional dependency diagnostic rather than a fabricated comparison against an
  incumbent that has no joint posterior. The evaluator also carries target-safe exact selection, line,
  price, and quote time outside trainer input and computes cover/over/push probability and settled units.
- The tournament now contains one implemented family rather than three prose-only families. Its exact
  96-feature vector, development-only standardization, marginal likelihood, regularization grid,
  deterministic optimizer, convergence rule, coherent score-state construction, seed, serialization,
  observed sample count, and parameter ceiling are executable. A fixed games-per-parameter cutoff was
  removed: limited history must be disclosed and reflected in uncertainty/prospective proof, not
  silently prevent research. Additional families may enter only in a new
  predeclared release with real trainer and inference code.
- The resolver no longer accepts an independent confirm/recenter/flip/fade probability head that can
  disagree with its score posterior. It emits the coherent joint posterior plus factual prior/posterior
  deltas and boundary-crossing state. The action stories remain an explicitly unpassed future fitted-
  resolver test corpus, not evidence that a model already behaves correctly.

## Third independent re-review closure

The third outside review found that important promises were still declarative or caller-trusted. This
revision closes those defects without enabling live influence:

- Exact evaluated targets are validated for pre-cutoff time, American-price semantics, market-specific
  selection, and line presence. Explicit `evaluated` and `same_family_as_evaluated` relations are
  excluded even when participant text is missing or inconsistent.
- Provider event identity is part of quote-path construction. Multiple provider event ids for one
  provider/book/market fail closed, and every intermediate line-versus-probability conflict remains a
  conflict token rather than disappearing into endpoint movement.
- SharpAPI pagination fails closed whenever provider metadata declares more rows, including a short
  page. Capture failures now make cron health partial and expose bounded failure reasons.
- Full research tapes have a bounded checksum-verifying reader. Repeated appends are idempotent and
  report inserted versus existing rows truthfully. Exact prior bytes are stored separately, verified
  cryptographically by the database, protected by foreign keys, and covered by row, weekly, season,
  artifact, and resolver-artifact storage ceilings.
- Research partition manifests bind each event's exact cutoff and complete capture window. Only a
  database receipt created before the earliest selection/confirmation/prospective capture can mint
  the private runtime attestation, and that attestation can be recreated after restart only by reading
  the exact stored row.
- The deterministic fitter consumes the complete attested development membership, rebuilds each
  feature object from its checksummed sequence, records an exact training-row digest, and cannot use
  selection or confirmation labels for fitting or calibration.
- Resolver inference no longer accepts caller-supplied score states. It reproduces one coherent NFL
  posterior from the fixed vectorizer and exact coefficient bytes. Artifact and coefficient payloads
  receive cryptographically checked append-only database receipts, and the receipt must predate every
  evaluated cutoff.

There are no hand-authored sportsbook weights, signal votes, movement thresholds, point awards,
signal-count quotas, or caps on learned evidence effects. “Weight-bound” in this audit means only that
the exact learned coefficient artifact—not caller-chosen output—must be provably responsible for a
posterior. Finite score support and storage ceilings are computational and cost safety boundaries,
not market interpretation rules.

The single executable residual family is a transparent research baseline, not a claim that a linear
coefficient model is the finished interpretive brain. The shared architecture preserves the complete
sequence so later sport-specific nonlinear or sequence-native candidates can compete without changing
the evidence contract. They must be implemented, predeclared, and tested on untouched chronology;
they cannot be added after inspecting confirmation misses.

## Cost and request envelope

Market Brain makes zero incremental provider requests; it reuses already-fetched writer evidence.
Each tape is capped at 96 KiB. Under the deliberately conservative assumption of 16 games and 168
captures per game per week, the uncompressed hard maximum is 252 MiB per week and 4.43 GiB across an
18-week regular season. Actual event-scoped tapes and database compression should be lower, but live
shadow activation must measure real p50/p95/p99 bytes and database growth before expanding retention.

## Evidence still required

No fitted resolver artifact exists and no predictive claim is made. Before any production proposal:

1. Fit the one executable predeclared family on release-pure rolling-origin partitions with a positive
   capture-window purge gap; do not add a second family without executable code and a new precommit.
2. Preserve untouched selection and confirmation windows, then precommit a prospective shadow window.
3. Compare against the exact incumbent release and the now-preserved exact evaluated line/price/time
   for every case.
4. Report all-game Brier/log loss, calibration, Margin/Total and joint scoring where comparable,
   line-specific cover/over probabilities, MAE, every changed pick, corrections, harms, actionables,
   promotions, demotions, board counts, ROI, and source/missingness regimes.
5. Reject any candidate that improves a headline metric by flattening the board, leaking the target
   family, mixing releases, using post-cutoff data, or failing important source-outage regimes.
6. Run a prospective no-authority probation and inspect every disagreement before a separate owner-
   approved production change is proposed.

Before shadow capture is enabled, schedule and verify the bounded database purge function. The
retention policy is implemented but deliberately not wired into the disabled production cron in this
branch; capture must not be enabled with an unenforced retention lifecycle.

This remediation makes the research foundation more honest and complete. It does not establish that
following or fading any market signal improves NFL predictions, and it does not authorize going live.
