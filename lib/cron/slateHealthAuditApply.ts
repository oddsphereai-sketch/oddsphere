export function resolveSlateHealthAuditApply(
  requested: string | null,
  envDefault: string | undefined,
): boolean {
  if (requested !== null) return requested === "true";
  return envDefault === "true";
}
