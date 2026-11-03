/** A migration may lag the application; other RPC errors must remain errors. */
export function isMissingRpcFunction(
  error: { code?: string; message?: string } | null,
  functionName: string,
): boolean {
  return error !== null
    && (error.code === "PGRST202" || error.code === "42883")
    && (error.message ?? "").includes(functionName);
}
