<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Mandatory concurrent-work safety protocol

This repository is edited by multiple Codex tasks at the same time. Treat the shared primary
checkout as user-owned state: never build, commit, rebase, reset, switch branches, or publish
from it when it is dirty.

For every production change:

1. Resolve the latest remote `main` commit before editing. Create a dedicated `codex/*` branch
   in its own clean worktree from that exact commit. Do not reuse another task's branch or
   worktree.
2. Record the starting base SHA. Keep the commit limited to task-owned files and preserve all
   unrelated working-tree changes.
3. Immediately before publication, resolve remote `main` again. If it moved, integrate the new
   base into the task branch, review every overlapping hunk, and rerun all affected tests. A
   previously green preview is not valid after the base changes.
4. Run `node scripts/verify-integration-safety.mjs --base-ref=<latest-main-ref>` from a clean
   committed worktree. It must prove that the latest production base is an ancestor of the
   candidate and that no other local worktree has overlapping uncommitted changes. Reconcile
   overlapping open PRs through the same fresh-base step before either one merges.
5. Publish only through a pull request. GitHub protection for `main` must require the
   `current-main-ancestor` check and must prevent a merge when the head branch is behind `main`
   (enable **Require branches to be up to date before merging**, or use a merge queue that runs
   the required check on the merge group). The workflow resolves `origin/main` when it runs and
   also supports merge-queue checks, but a previously completed pull-request check cannot wake
   itself merely because `main` advanced. Confirm the PR is still up to date, all required checks
   are green, and the remote PR tree matches the locally verified tree before merging.
6. If another PR merges first, stop and repeat steps 3–5. Never force-update `main`, bypass a
   failed integration-safety check, or reconstruct a shared file from an older branch.
7. After merge, verify the production commit and the affected live behavior. Do not declare
   success from a branch preview alone.

An overlap is a coordination requirement, not permission to discard either task's work. Preserve
both changes in a fresh integration branch or stop and ask the user which behavior should win.

## Mandatory locked-record immutability protocol

A locked member snapshot is the public record. Do not mutate, replace, reinterpret, suppress, or
reconstruct any stored locked projection, probability, pick, grade, price, stake, or evidence field
merely because a newer model, DTO, or reader semantic exists. Reader migrations must render the
exact legacy locked payload first; new semantics apply only to unlocked rows and future locks.

If a locked payload is genuinely corrupt or incomplete, preserve it unchanged, document the
problem, and obtain explicit owner approval before publishing any correction or replacement.
Mathematical reconstruction is allowed only when the locked field was never stored, must be
clearly labeled, and cannot overwrite or take precedence over an existing locked value. Tests for
every lock-sensitive change must prove both writer immutability and reader precedence.

## Mandatory model-change safety protocol

Any change that can alter a prediction, probability, projection, grade, promotion/demotion,
stake, calibration, market selection, or model input must follow
[`docs/model-change-safety.md`](docs/model-change-safety.md). This applies to every sport,
market, operator script, cron, and Codex thread.

Before auditing or changing MLB or WNBA models, read
[`docs/current-model-releases.md`](docs/current-model-releases.md) and confirm its identifiers
against the exported runtime constants. That registry is the handoff contract for future Codex
threads: never restore a superseded rule or release merely because it appears in older audit notes.
Update the registry in the same commit as every production model change.

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
