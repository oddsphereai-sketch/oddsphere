<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Mandatory model-change safety protocol

Any change that can alter a prediction, probability, projection, grade, promotion/demotion,
stake, calibration, market selection, or model input must follow
[`docs/model-change-safety.md`](docs/model-change-safety.md). This applies to every sport,
market, operator script, cron, and Codex thread.

At minimum, before deployment:

1. Bump the affected model/calibration release identifier; never change model behavior under
   an existing identifier.
2. Keep one authoritative runtime/version path. Do not add an independent refresh or writer.
3. Preserve the shared sport-scoped `prediction_pipeline` lease for prediction-writing jobs.
4. Evaluate results by release identifier and locked timestamp. Never blend releases and call
   the blend current-model performance.
5. Pair every proposed actionable demotion with a tested actionable promotion rule and report
   board-count impact. A flatter board is not an acceptable hidden side effect.
6. Run `npm run verify:model-change` and the affected model's focused tests.
7. Deploy from a clean, intentional commit, then verify the live release identifier, cron
   health, model coherence, data coverage, and reader snapshot before declaring success.

If any item cannot be verified, keep the change in shadow/audit mode and do not alter live
grades or stakes.
