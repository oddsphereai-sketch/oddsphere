# Generated artifact typecheck memory containment

Date: 2026-10-16

## Scope

The production deployment for the merged NBA independent-first reader r3 release
(`e6f200e9d39fee496d37b8469a28cc0d0b6025f1`) compiled successfully and then
failed during Next.js TypeScript validation with an out-of-memory SIGKILL. The
model release itself had already passed its historical audit, focused tests,
full model-change verification, and protected merge checks.

This repair changes only how immutable generated JSON artifacts enter the
TypeScript program and which repository files the Next.js deploy checker owns.
It does not change any artifact byte, model input, forecast equation, market
reader rule, projection, probability, side, grade, price, stake, writer, lease,
cadence, or locked record.

## Root cause and containment

Static JSON-module imports caused TypeScript to materialize millions of literal
types for multi-megabyte generated model payloads. The largest contributors
included the NFL player-props tree artifacts and NBA/CFB bootstrap artifacts.
The runtime modules now use fixed-path CommonJS loads with explicit existing
artifact contracts. These paths remain statically visible to Next.js output
tracing while the checker validates the executable API instead of expanding
every generated tree node into a unique compile-time literal type.

Next.js now uses its documented `typescript.tsconfigPath` support with
`tsconfig.build.json`. That configuration includes every deployable `app`,
`lib`, proxy, and generated route-type module, including their complete
transitive dependency graph. It excludes standalone operator, research, and
test entry points from the deploy worker. It does not set
`ignoreBuildErrors`; production TypeScript errors still fail the build. The
broader repository remains covered by the explicit full-repository `tsc`
check, executable focused tests, and `npm run verify:model-change`.

## Release and board impact

- No generated JSON artifact changed.
- No model, calibration, probability, grade-policy, decision, reader, or writer
  release identifier changed.
- No prediction-writing path or sport-scoped lease changed.
- No promotion or demotion rule changed; board-count impact is exactly zero by
  construction.
- Locked writer and reader precedence are unchanged.

A model release bump is therefore neither required nor allowed for this repair:
the executable artifacts and all selection semantics are identical. A release
bump would falsely describe an unchanged model as a new predictive release.

## Verification

Before containment, the application type graph exceeded 4.1 GB and the merged
Vercel deployment died during `Running TypeScript`. After containment:

- the deployable application typecheck completed at approximately 1.68 GB;
- `NODE_OPTIONS=--max-old-space-size=3072 npm run build` completed compilation,
  production TypeScript, all 108 static pages, and route finalization;
- `NODE_OPTIONS=--max-old-space-size=5120 npx tsc --noEmit --incremental false`
  passed the complete repository configuration;
- NBA professional bootstrap parity and opening-night scoring passed;
- NFL player-props runtime parity, production lifecycle, history, and inference
  context passed;
- NFL r6 artifact parity and fail-closed decision boundaries passed;
- CFB weekly score, decision, final-winner coordinator, and production contract
  tests passed;
- football member evidence and product preview tests passed;
- the complete `npm run verify:model-change` suite passed;
- ESLint completed with no errors and `git diff --check` passed.

Publication still requires latest-main integration safety, protected pull-request
checks, successful Vercel production deployment, and live NBA release/reader
verification. Any runtime parity failure, release identity drift, lock mutation,
or prediction difference blocks publication.
