# UCL current source identity repair — November 3

Starting base: `c3b066a178070ccc69f0dd45aa9be8cc6d7583b9`.

The owner requested deeper review of the flat UCL board and18/18 Over2.5 and
BTTS Yes forecasts, then approved exactly one current Owls soccer odds read.
That request completed14:56:04 UTC (1552 events); no other current/history
request, manual collector cycle or production write was made for the audit.
The18-fixture bounded source receipt is frozen in the test fixture.

## Confirmed defects and repair

DraftKings soccer rows can omit league even when another positively labeled
book in the same response identifies the exact same native event/participants/
kickoff as Champions League. The old adapter discarded all such rows. UCL now
admits an unlabeled DraftKings event only with that positive exact-native witness;
explicit wrong leagues, other sports/books, different fixtures/IDs/kickoffs,
future quotes and stale quotes remain rejected. EPL's source gate is unchanged.
Original quote times, sides and actual Total lines are retained. At the frozen
receipt this restores quote families on seven fixtures, including both BTTS
sides and Double Chance for Galatasaray–Stuttgart and LASK–Slovan.

LASK–Slovan and Como–Lens have complementary native event catalogs. Collapsing
these to one eventId produced null and excluded their otherwise valid references.
Current UCL fixtures now attest each provider/book/market's unique native owner
following the exact participant/time/competition join. Duplicate ownership is
quarantined. The reader qualifies by that exact tuple rather than a guessed
universal ID; stored unattributed availability prices acquire no native identity.
The compatibility strict-ID path remains for legacy inputs. Provider namespaces
cannot cross, and execution-book exclusions and source-class rules remain intact.

## Release and product boundary

UCL model R14, grade/calibration R17, outcome R7, projected-score R5 and member
lifecycle R12 identify this source-input successor. Shared current-provider
telemetry R3 records UCL attestation; EPL coefficients, policies and output
behavior remain unchanged. Existing scoring equations, probability/grade floors,
source consensus/movement policy, exact-price EV, stake policy, sole soccer
writer/lease, jobs and request limits are unchanged. No forced Under/No, arbitrary
promotion or new score nudge. New received evidence can change future/unlocked
forecasts through the existing reader. Old locked predictions/grades/prices/
projection/evidence retain their exact stored payload first.

Same qualified tuple policy impact is zero promotions/demotions: no eligibility
rule changed; the existing symmetric Lean price/probability policy remains tested.
Current-source coverage and operational board impact must be reported separately
from predictive accuracy. The pre-repair saved board had15 Leans,28 Watchlists,
11 No Plays and no Best across54 main markets. Its grade policy has no Best-tier
production branch; this source repair does not silently invent one.

Separate identified limitation: current professional Total lines often lie at
3/3.25/3.5/3.75, while the product's existing binary arbitration accepts exact2.5
references only. These contracts are retained as their actual lines and never
relabeled as2.5. The existing three-book qualified binary consensus policy can
still leave a directional source as context; this source repair is not a claim
that the full reader architecture or the all-Yes discrimination problem is solved.

## Required verification

Focused tests use the actual18-fixture receipt, restoring all received DK market
families with original clocks, wrong fixture/league/sport/native/clock negatives,
exact retained thresholds, complementary catalog qualification, provider-namespace
rejection and duplicate book/market quarantine. Production/coherence and legacy
DB writer/reader lock tests must pass, followed by full model safety, type/lint/
production build, fresh-main overlap/ancestry, protected PR and exact remote tree.
Normal post-deploy publication must confirm the new releases, native references,
current market coverage/grades, model coherence and the saved immutable UCL lock
hashes. No preview-only all-clear or accuracy claim.
