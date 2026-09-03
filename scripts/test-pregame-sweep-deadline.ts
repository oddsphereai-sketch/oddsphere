import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SharpApiAbortError,
  SharpApiClient,
} from "../lib/providers/real_api/_sharpApiClient";
import { SharpAPIOddsProvider } from "../lib/providers/real_api/SharpAPIOddsProvider";
import {
  GAME_LINES_COMMIT_RESERVE_MS,
  GameLinesDeadlineError,
  assertGameLinesDeadlineBudget,
} from "../lib/services/linesService";

async function testPreAbortedRequestNeverStartsFetch(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("fetch must not start");
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    controller.abort(new Error("soft deadline"));
    await assert.rejects(
      new SharpApiClient("test-key").fetchAll({
        path: "/odds",
        signal: controller.signal,
      }),
      (error: unknown) =>
        error instanceof SharpApiAbortError &&
        error.message.includes("soft deadline"),
    );
    assert.equal(calls, 0, "an already-aborted deadline must perform zero HTTP calls");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRateLimitWaitIsAbortable(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", {
      status: 429,
      headers: { "retry-after": "60" },
    });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = new SharpApiClient("test-key").fetchAll({
      path: "/odds",
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error("soft deadline")), 10);
    await assert.rejects(pending, SharpApiAbortError);
    assert.ok(Date.now() - startedAt < 1_000, "429 backoff must abort before the platform deadline");
    assert.equal(calls, 1, "an aborted backoff must not issue the retry request");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testProviderPropagatesCallerSignal(): Promise<void> {
  class AbortingClient extends SharpApiClient {
    readonly signals: Array<AbortSignal | undefined> = [];

    override async fetchAll<T>(opts: {
      path: string;
      query?: Record<string, unknown>;
      maxPages?: number;
      signal?: AbortSignal;
    }): Promise<T[]> {
      this.signals.push(opts.signal);
      if (opts.signal?.aborted) {
        throw new SharpApiAbortError({ endpoint: opts.path, reason: opts.signal.reason });
      }
      return [];
    }
  }

  const client = new AbortingClient("test-key");
  const provider = new SharpAPIOddsProvider("test-key", async () => null, { client });
  const controller = new AbortController();
  controller.abort(new Error("soft deadline"));
  await assert.rejects(
    provider.getGameLinesV2("2026-09-03", "mlb", { signal: controller.signal }),
    SharpApiAbortError,
  );
  assert.ok(client.signals.length >= 1, "provider discovery must invoke the shared client");
  assert.ok(
    client.signals.every((signal) => signal === controller.signal),
    "every started discovery request must receive the exact caller-owned signal",
  );
}

async function testHealthySignalPreservesProviderCallTopology(): Promise<void> {
  class EmptyClient extends SharpApiClient {
    readonly requests: Array<{ path: string; signal?: AbortSignal }> = [];

    override async fetchAll<T>(opts: {
      path: string;
      query?: Record<string, unknown>;
      maxPages?: number;
      signal?: AbortSignal;
    }): Promise<T[]> {
      this.requests.push({ path: opts.path, signal: opts.signal });
      return [];
    }
  }

  const withoutDeadlineClient = new EmptyClient("test-key");
  const withDeadlineClient = new EmptyClient("test-key");
  const withoutDeadline = await new SharpAPIOddsProvider(
    "test-key",
    async () => null,
    { client: withoutDeadlineClient },
  ).getGameLinesV2("2026-09-03", "mlb");
  const signal = AbortSignal.timeout(5_000);
  const withDeadline = await new SharpAPIOddsProvider(
    "test-key",
    async () => null,
    { client: withDeadlineClient },
  ).getGameLinesV2("2026-09-03", "mlb", { signal });

  assert.deepEqual(withDeadline, withoutDeadline, "a healthy deadline cannot change provider output");
  assert.deepEqual(
    withDeadlineClient.requests.map(({ path }) => path),
    withoutDeadlineClient.requests.map(({ path }) => path),
    "a healthy deadline cannot add, remove, or reorder provider calls",
  );
  assert.ok(
    withDeadlineClient.requests.every((request) => request.signal === signal),
    "the same deadline signal must reach every healthy provider request",
  );
}

function testCommitReserveGuard(): void {
  const now = 1_000_000;
  assert.doesNotThrow(() =>
    assertGameLinesDeadlineBudget(
      now + GAME_LINES_COMMIT_RESERVE_MS,
      "before_current_line_commit",
      GAME_LINES_COMMIT_RESERVE_MS,
      now,
    ),
  );
  assert.throws(
    () =>
      assertGameLinesDeadlineBudget(
        now + GAME_LINES_COMMIT_RESERVE_MS - 1,
        "before_current_line_commit",
        GAME_LINES_COMMIT_RESERVE_MS,
        now,
      ),
    (error: unknown) =>
      error instanceof GameLinesDeadlineError &&
      error.stage === "before_current_line_commit",
  );
  assert.throws(
    () => assertGameLinesDeadlineBudget(now - 1, "before_provider", 1, now),
    GameLinesDeadlineError,
  );
  assert.doesNotThrow(() =>
    assertGameLinesDeadlineBudget(undefined, "before_provider", 1, now),
    "callers without a deadline retain the incumbent behavior",
  );
}

function testSourceOrderingAndLifecycleContract(): void {
  const service = readFileSync("lib/services/linesService.ts", "utf8");
  const v2Start = service.indexOf("async refreshGameLinesV2(");
  const v2End = service.indexOf("async refreshPlayerProps(", v2Start);
  const v2 = service.slice(v2Start, v2End);
  const commitGuard = v2.indexOf('"before_current_line_commit"');
  const replacement = v2.indexOf("replaceCurrentGameLinesBatched(");
  assert.ok(commitGuard >= 0 && replacement > commitGuard, "deadline guard must run before atomic current-line replacement");
  assert.match(v2, /signal:\s*providerSignal/, "the provider receives the caller-owned abort signal");

  const route = readFileSync("app/api/cron/pregame-sweep/route.ts", "utf8");
  assert.match(route, /export const maxDuration = 90/);
  assert.match(route, /PREGAME_SWEEP_SOFT_DEADLINE_MS = 55_000/);
  assert.match(route, /deadlineAtMs:\s*softDeadlineAtMs/);
  assert.match(route, /error instanceof GameLinesDeadlineError/);
  assert.match(route, /current_line_replacement_started:\s*false/);
  assert.match(route, /authoritative_lock_applied:\s*false/);
  assert.match(route, /next_scheduled_pregame_sweep/);
  const deadlineCatch = route.indexOf("error instanceof GameLinesDeadlineError");
  const predictionPass = route.indexOf("generatePredictionsForSlate", deadlineCatch);
  const lockPass = route.indexOf("await applyLocks", deadlineCatch);
  assert.ok(
    deadlineCatch >= 0 && predictionPass > deadlineCatch && lockPass > deadlineCatch,
    "the deadline exit must precede prediction and lock writes",
  );

  const cron = readFileSync("lib/cron/runCron.ts", "utf8");
  const finallyIndex = cron.indexOf("} finally {");
  const releaseIndex = cron.indexOf("await releaseCronJobLease", finallyIndex);
  assert.ok(finallyIndex >= 0 && releaseIndex > finallyIndex, "partial deadline return must release the shared lease in finally");
}

async function main(): Promise<void> {
  await testPreAbortedRequestNeverStartsFetch();
  await testRateLimitWaitIsAbortable();
  await testProviderPropagatesCallerSignal();
  await testHealthySignalPreservesProviderCallTopology();
  testCommitReserveGuard();
  testSourceOrderingAndLifecycleContract();

  console.log("PASS pregame-sweep soft deadline aborts before writes, preserves retry, and releases lifecycle ownership");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
