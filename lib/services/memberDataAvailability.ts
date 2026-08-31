export const MEMBER_DATA_READ_TIMEOUT_MS = 8_000;

export type MemberDataReadResult<T> = {
  value: T;
  unavailable: boolean;
  reason: "ok" | "timeout" | "error";
};

/**
 * Bound member-facing reads so an upstream data outage cannot leave a streamed
 * route suspended indefinitely. This wrapper is intentionally read-only and
 * does not retry, write, or alter any model output.
 */
export async function readMemberDataWithDeadline<T>({
  label,
  read,
  fallback,
  timeoutMs = MEMBER_DATA_READ_TIMEOUT_MS,
}: {
  label: string;
  read: () => Promise<T>;
  fallback: T;
  timeoutMs?: number;
}): Promise<MemberDataReadResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const timedOut = new Promise<MemberDataReadResult<T>>((resolve) => {
    timeout = setTimeout(() => {
      console.error(`[member-data] ${label} timed out after ${timeoutMs}ms`);
      resolve({ value: fallback, unavailable: true, reason: "timeout" });
    }, timeoutMs);
  });

  const completed = Promise.resolve()
    .then(read)
    .then((value) => ({ value, unavailable: false, reason: "ok" }) as const)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[member-data] ${label} failed: ${message}`);
      return { value: fallback, unavailable: true, reason: "error" } as const;
    });

  try {
    return await Promise.race([completed, timedOut]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
