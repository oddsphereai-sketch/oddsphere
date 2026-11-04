import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readCfbForwardMarketHistory,
  CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES,
  CFB_FORWARD_MARKET_HISTORY_RPC_PAGE_SIZE,
} from "../lib/services/football/cfbForwardEvidenceStore";

const rpcName = "cfb_forward_market_history_page";
const view = "cfb_forward_market_history_projection";
const release = CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES[0];
const after = "2026-11-02T00:00:00.000Z";
const rows = Array.from({ length: 501 }, (_, i) => ({
  id: `history-${i}`,
  evidence_release: release,
  provider_game_id: "100",
  stage: i === 0 ? "opening" : i === 1 ? "t60" : "unlocked",
  captured_at: new Date(
    Date.parse("2026-10-30T00:00:00Z") + i * 60_000,
  ).toISOString(),
  game_start_at: "2026-11-05T00:00:00.000Z",
  payload_sha256: "a".repeat(64),
  payload_schema_release: release,
  payload_provider_game_id: "100",
  payload_stage: i === 0 ? "opening" : i === 1 ? "t60" : "unlocked",
  payload_captured_at: new Date(
    Date.parse("2026-10-30T00:00:00Z") + i * 60_000,
  ).toISOString(),
  current: { spread: -3.5, price: -110 },
  current_books: [{ book: "original", price: -110 }],
  display_books: i % 2 ? null : [],
  provider_opening: { spread: -2.5 },
  operational_opening: { spread: -3 },
  playbook_splits: { tickets: 61 },
  sharp_api_splits: { money: 72 },
  request_budget: { originalReceipt: i },
  context_moneyline_families: [{ original: i }],
  context_spread_families: [],
  context_total_families: null,
  context_moneyline_target_excluded_families: ["original"],
  context_spread_target_excluded_families: [],
  context_total_target_excluded_families: null,
}));
type Failure = { code: string; message: string };
type Reply = { data: unknown; error: Failure | null };
type Args = Record<string, unknown>;

function clientFor(options: {
  rpc?: (args: Args) => Reply;
  legacy?: (table: string, offset: number, limit: number) => Reply;
}) {
  const calls: Array<{ kind: string; args: Args }> = [];
  const client = {
    ...(options.rpc
      ? {
          rpc(name: string, args: Args) {
            assert.equal(name, rpcName);
            calls.push({ kind: "rpc", args });
            return Promise.resolve(options.rpc!(args));
          },
        }
      : {}),
    from(table: string) {
      const args: Args = { table };
      const query = {
        select(value: string) {
          args.select = value;
          return query;
        },
        eq(key: string, value: unknown) {
          args[key] = value;
          return query;
        },
        in(key: string, value: unknown) {
          args[key] = value;
          return query;
        },
        or(value: string) {
          args.or = value;
          return query;
        },
        order(key: string, value: unknown) {
          args[`order_${key}`] = value;
          return query;
        },
        range(from: number, to: number) {
          calls.push({ kind: "legacy", args: { ...args, from, to } });
          assert(
            options.legacy,
            "a functioning RPC must never run a legacy scan",
          );
          return Promise.resolve(options.legacy(table, from, to - from + 1));
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

async function main() {
  assert.equal(CFB_FORWARD_MARKET_HISTORY_RPC_PAGE_SIZE, 250);
  const before = structuredClone(rows);
  const legacy = clientFor({
    legacy: (_, offset, limit) => ({
      data: rows.slice(offset, offset + limit),
      error: null,
    }),
  });
  const bounded = clientFor({
    rpc: (args) => ({
      data: rows.slice(
        Number(args.p_offset),
        Number(args.p_offset) + Number(args.p_limit),
      ),
      error: null,
    }),
  });
  const read = (client: SupabaseClient, ids = ["100", "100"]) =>
    readCfbForwardMarketHistory({
      client,
      season: 2026,
      providerGameIds: ids,
      capturedAfter: after,
    });
  const expected = await read(legacy.client);
  assert.deepEqual(
    await read(bounded.client),
    expected,
    "all legacy normalized values and ordering survive paging",
  );
  assert.equal(expected.length, 501);
  assert.equal(
    expected[0].stage,
    "opening",
    "the transport never removes an old opening",
  );
  assert.equal(
    expected[1].stage,
    "t60",
    "stored locked evidence retains its exact reader precedence",
  );
  assert.deepEqual(expected[1].payload.market.current, rows[1].current);
  assert.deepEqual(
    rows,
    before,
    "neither transport mutates the original snapshot objects",
  );
  assert.deepEqual(
    bounded.calls.map((c) => c.args.p_offset),
    [0, 250, 500],
  );
  for (const call of bounded.calls)
    assert.deepEqual(call.args, {
      p_season: 2026,
      p_releases: [...CFB_FORWARD_MARKET_HISTORY_COMPATIBLE_RELEASES],
      p_game_ids: ["100"],
      p_captured_after: after,
      p_offset: call.args.p_offset,
      p_limit: 250,
    });

  const batches = clientFor({ rpc: () => ({ data: [], error: null }) });
  const ids = Array.from({ length: 22 }, (_, i) => String(100 + i));
  await read(batches.client, [...ids].reverse().concat(ids));
  assert.deepEqual(
    batches.calls.map((c) => c.args.p_game_ids),
    [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20)],
  );
  const noWindow = clientFor({
    rpc: (args) => {
      assert.equal(args.p_captured_after, null);
      return { data: [], error: null };
    },
  });
  await readCfbForwardMarketHistory({
    client: noWindow.client,
    season: 2026,
    providerGameIds: ["100"],
  });

  for (const code of ["PGRST202", "42883"]) {
    for (const absentView of [false, true]) {
      const fallback = clientFor({
        rpc: () => ({
          data: null,
          error: { code, message: `missing ${rpcName}` },
        }),
        legacy: (table, offset, limit) =>
          table === view && absentView
            ? {
                data: null,
                error: { code: "PGRST205", message: `missing ${view}` },
              }
            : { data: rows.slice(offset, offset + limit), error: null },
      });
      assert.deepEqual(await read(fallback.client), expected);
      assert.equal(fallback.calls.filter((c) => c.kind === "rpc").length, 1);
      assert.equal(
        fallback.calls.at(-1)!.args.to,
        999,
        "fallback retains the old exact 1,000-row page",
      );
      assert.equal(
        fallback.calls.at(-1)!.args.or,
        `stage.eq.opening,captured_at.gte.${after}`,
      );
    }
  }
  for (const error of [
    { code: "57014", message: "statement timeout" },
    { code: "42501", message: `permission denied for ${rpcName}` },
    { code: "PGRST202", message: "missing unrelated function" },
    { code: "42883", message: "missing unrelated function" },
  ]) {
    const failure = clientFor({ rpc: () => ({ data: null, error }) });
    await assert.rejects(
      () => read(failure.client),
      /CFB forward market history read failed/,
    );
    assert.equal(
      failure.calls.length,
      1,
      "real failures must not amplify load with a scan retry",
    );
  }
  for (const data of [{ rows: [] }, "[]", Array(251).fill(rows[0])]) {
    const invalid = clientFor({ rpc: () => ({ data, error: null }) });
    await assert.rejects(() => read(invalid.client), /invalid bounded page/);
  }
  const corrupt = clientFor({
    rpc: () => ({
      data: [{ ...rows[1], payload_stage: "unlocked" }],
      error: null,
    }),
  });
  await assert.rejects(
    () => read(corrupt.client),
    /immutable payload identity contract/,
  );
  const limit = clientFor({
    rpc: () => ({ data: Array(250).fill(rows[0]), error: null }),
  });
  await assert.rejects(
    () => read(limit.client),
    /50000-row visible-board limit/,
  );
  assert.equal(
    limit.calls.length,
    200,
    "the existing hard limit fails closed, never silently truncates history",
  );
  console.log(
    "PASS CFB bounded history reader: exact legacy values/locks, complete paging, unchanged scope, safe migration fallback, real-error hold and global bound",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
