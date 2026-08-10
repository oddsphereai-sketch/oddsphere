# OddSphere private product relaunch plan

## Release boundary

The work in this plan remains private until founder approval. No redesigned
surface replaces a member-facing or public route merely because its component
is complete. Prediction, calibration, grade, stake, publication, and tracking
logic remain outside this presentation project unless separately reviewed
under the model-change safety protocol.

## Product system

| Surface | Existing foundation | Private candidate objective | Promotion requirement |
| --- | --- | --- | --- |
| Daily Edge | Live multi-sport board, reader, model DTO, auth, tracking links | New information hierarchy and visual reader on the same authoritative state/data contracts | Cross-sport parity, responsive QA, load test, rollback flag, founder approval |
| Player Props | MLB Prop Researcher member dashboard with lazy research loading | Reduce scan friction while keeping prop-specific research, price, projection, and player context | Board/reader parity, payload budget, mobile QA, founder approval |
| Tracking | Live member tracking API and category/lifetime presentation | Improve hierarchy, comprehension, and visual consistency without changing recorded results | Record-count and metric parity, empty/error QA, founder approval |
| Homepage | Public marketing page, public tracking summary, older Daily Edge product preview | Present the approved OddSphere system accurately with current screenshots/previews | Claims audit, responsive/SEO/accessibility QA, approved imagery, founder approval |

## Daily Edge sport contract

One shared presentation registry now drives both the live sport rail and the
private redesign. Member-available surfaces are MLB, WNBA, World Cup, NBA, and
NHL. NFL, CFB, CBB, and UCL remain visible planned models. This registry affects
navigation labels only; it does not activate writers or alter model behavior.

Each available sport must pass the following independently:

- Correct sport-specific market names and tracked/context-only labels.
- Board card and exact market-pill selection parity.
- Quick Read, market movement, public consensus, sharp-book splits, key stats,
  deeper analysis, unavailable states, and lock behavior.
- Phone sheet, desktop reader, empty slate, loading, error, stale, and offseason
  behavior.
- Same canonical prediction, market, split, price, lock, and grade values as the
  current member response.

## Private promotion sequence

1. Daily Edge candidate integrated with shared live state contracts and reviewed
   underneath `/lab/daily-edge` using the off-by-default server candidate flag.
2. Daily Edge reviewed sport by sport with real or stored representative slates.
3. Player Props private candidate reviewed as its own product.
4. Tracking private candidate reviewed against unchanged tracking records.
5. Homepage copy and imagery updated only after member surfaces are approved.
6. Staging parity, responsiveness, accessibility, and concurrency tests.
7. Founder sign-off on a release-candidate deployment.
8. Controlled member rollout with a one-switch rollback; no automatic 100%
   promotion.

## Private review inventory

The authenticated `/dev/relaunch-review` route is the founder-review entry
point. It links to populated representative Daily Edge slates for every
member-available sport, the deterministic full Player Props fixture, live
Tracking, and the pre-login homepage candidate. Direct preview access in a
production-mode build requires `PRODUCT_EXPERIENCE_PREVIEW_ENABLED=true`.

Every replacement switch is independent and defaults off:

| Member/public route | Candidate switch | Private implementation |
| --- | --- | --- |
| `/lab/daily-edge` | `DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED` | `/dev/experience-preview` |
| `/mlb/props` | `PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED` | `/dev/mlb-props-preview` |
| `/lab/tracking` | `TRACKING_EXPERIENCE_CANDIDATE_ENABLED` | `/dev/tracking-preview` |
| `/` | `HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED` | `/dev/homepage-preview` |
| `/login` | `LOGIN_EXPERIENCE_CANDIDATE_ENABLED` | `/dev/login-preview` |

The first three keep the normal authentication gate. The homepage switch is a
separate public rewrite because the approved result must work before login.
Turning on one switch cannot replace another product.

## Current verification status

- Daily Edge response-contract readiness passes for MLB, WNBA, World Cup,
  NBA, and NHL representative slates.
- Daily Edge now shows cached, fail-closed injury/availability context for MLB
  and WNBA through a protected, non-blocking supplementary request. It does
  not imply equivalent coverage for NBA, NHL, or World Cup.
- The candidate reuses the live board's warm read path on sport changes; the
  private preview no longer forces a fresh uncached slate transformation for
  every tab click.
- Private review navigation is closed over the private routes: Daily Edge,
  Player Props, Tracking, the logo, and Review Hub cannot accidentally send a
  reviewer onto a live member route with a different operational state.
- Locked MLB movement keeps the sportsbook captured at lock, and the WNBA
  trail builder terminates on the latest same-book observation rather than
  looping back to its opener. Before cutover, every stored member-fast Daily
  Edge response snapshot must be republished with this DTO and audited for
  named-book movement completeness; deploying code without refreshing older
  snapshots is a failed release.
- Player Props preserves the current board and payload contracts; only the
  private candidate changes which controls are immediately visible. Candidate
  readers are URL-addressable through a preserved `reader` query parameter.
- Tracking renders the existing `tracking-foundation` payload and preserves
  all category, lifetime, recent-result, and methodology detail. The overview,
  yesterday, and category record stay immediate while Best Angles, result
  feeds, and methodology collapse into optional detail in the candidate.
- Homepage candidate reuses the current public tracking summary and approved
  Daily Edge reader image; it does not publish a new performance claim.
- Release-switch and authentication behavior is covered by the auth-gate
  suite, including default-off, isolation, and query preservation.
- Founder responsive visual approval, clean-commit build, staging performance,
  production smoke tests, fast-snapshot republish verification, and rollback
  rehearsal remain release gates.
- The current working tree passes TypeScript, the Next 16 production build,
  Daily Edge presentation/contract tests, Player Props launch tests, Tracking
  reconciliation tests, and auth/Whop gate tests. All four candidate switches
  remain unset and therefore off.
- The read-only Player Props operational readiness audit currently reports a
  publishable generated snapshot, but it is **not** ready to open as a live
  production surface. Refresh, tracking, and settlement operations are disabled
  in the audited environment, and the current persisted board still fails the
  recent-form, model-context, research-input, direct-matchup, and environment
  coverage gates. Those are existing product-operation gates, not redesign
  defects, and they must not be bypassed by turning on the candidate UI flag.

## Final founder review boundary

The private relaunch hub is ready to be used for product and visual review. A
founder approval of that presentation does not itself authorize deployment.
Promotion still requires a clean intentional release commit, staging data
parity and load results, a rollback rehearsal, and green operational readiness
for each surface being enabled. A surface may be held back independently; the
four candidate switches must never be treated as one all-or-nothing launch.
