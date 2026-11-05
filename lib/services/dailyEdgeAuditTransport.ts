export type DailyEdgeAuditHttpPayload = {
  ok?: boolean;
  result?: {
    ok?: boolean;
    summary?: { criticalIssues?: number; [key: string]: unknown };
    issues?: unknown[];
    [key: string]: unknown;
  };
  boards?: Record<string, Record<string, unknown>>;
};

export function resolveDailyEdgeAuditHttpPayload(args: {
  status: number;
  ok: boolean;
  payload: DailyEdgeAuditHttpPayload;
}): {
  boards: Record<string, Record<string, unknown>>;
  diagnosticResponse: boolean;
  upstreamResult: DailyEdgeAuditHttpPayload["result"] | null;
  hasCriticals: boolean;
} {
  const diagnosticResponse = args.status === 409;
  if ((!args.ok && !diagnosticResponse) || !args.payload.boards) {
    throw new Error(`Production board read failed: HTTP ${args.status}`);
  }
  if (diagnosticResponse && !args.payload.result) {
    throw new Error("Production diagnostic response omitted its audit result");
  }
  const upstreamResult = args.payload.result ?? null;
  const criticalIssues = upstreamResult?.summary?.criticalIssues;
  const hasCriticals = diagnosticResponse
    || upstreamResult?.ok === false
    || (typeof criticalIssues === "number" && criticalIssues > 0);
  return { boards: args.payload.boards, diagnosticResponse, upstreamResult, hasCriticals };
}
