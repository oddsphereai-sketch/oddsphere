# EPL operational-opening release v12

## Scope

- Projection release remains `epl_club_dixon_coles_2026_08_18_r8`.
- Calibration/runtime release is `epl_grade_policy_2026_08_19_v12`.
- Prediction probabilities, score projections, grading thresholds, market selections, and stakes are unchanged from v11.

## Tracking contract

The member Daily Edge `Opening` value is the provider-native opening quote when one exists. Otherwise it is the earliest verified stored quote for the same sportsbook and outcome. Its original timestamp, sportsbook, trail label, and source remain in the stored odds trail. `Prior` is not synthesized; it remains empty until another same-book observation is captured.

This removes the EPL-only `Provider open` / `First tracked` split from the reader and restores the shared four-stop Daily Edge presentation: `Opening`, `Prior`, `Current`, and `Locked`.

## Board impact

Expected board-count impact is zero because the grading path does not consume the opening price or movement presentation. The required release verification and live read-only candidate run must confirm that the v11 grade distribution is retained.

The same readiness pass also found that the Sharp duplicate-event fallback budget was shared across concurrent fixtures and that one rejected market request discarded every successful market in that fixture. v12 scopes the fallback allowance per fixture and retries each filtered market independently once. This changes provider resilience only; missing markets still fail closed and cannot create a grade without a coherent current price.

## Activation boundary

All EPL production, writer, publication, and member-reader flags remain disabled. Production activation still requires an intentional deployment followed by a hidden writer/lock verification before the member-reader flag is enabled.
