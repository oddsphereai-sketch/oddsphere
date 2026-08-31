import assert from "node:assert/strict";
import { readMemberDataWithDeadline } from "../lib/services/memberDataAvailability";

async function main() {
  const success = await readMemberDataWithDeadline({
    label: "test-success",
    fallback: "fallback",
    timeoutMs: 50,
    read: async () => "ready",
  });
  assert.deepEqual(success, { value: "ready", unavailable: false, reason: "ok" });

  const failure = await readMemberDataWithDeadline({
    label: "test-error",
    fallback: "fallback",
    timeoutMs: 50,
    read: async () => { throw new Error("upstream unavailable"); },
  });
  assert.deepEqual(failure, { value: "fallback", unavailable: true, reason: "error" });

  const started = Date.now();
  const timeout = await readMemberDataWithDeadline({
    label: "test-timeout",
    fallback: "fallback",
    timeoutMs: 20,
    read: () => new Promise<string>(() => undefined),
  });
  assert.deepEqual(timeout, { value: "fallback", unavailable: true, reason: "timeout" });
  assert.ok(Date.now() - started < 250, "deadline should return without waiting for the stuck read");

  console.log("member data availability: PASS");
}

void main();
