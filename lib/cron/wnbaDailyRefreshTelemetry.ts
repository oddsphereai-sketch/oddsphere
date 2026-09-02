export const WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_LENGTH = 1500;
const WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_ITEMS = 5;

export type WnbaDailyRefreshStageError = {
  stage: string;
  message: string;
};

function sanitizeWnbaDailyRefreshError(value: string): string {
  const sanitized = value
    .replace(
      /((?:api[-_ ]?key|authorization|token|secret|password)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|bearer\s+[^\s,;|]+|[^\s,;|]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/\bbearer\s+[^\s,;|]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[-_]?key|token|secret|password)=)[^&\s,;|]+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "error";
}

export function summarizeWnbaDailyRefreshErrors(
  errors: readonly WnbaDailyRefreshStageError[],
): string | null {
  if (errors.length === 0) return null;
  const visible = errors.slice(0, WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_ITEMS).map(({ stage, message }) =>
    `[${stage}] ${sanitizeWnbaDailyRefreshError(message)}`,
  );
  if (errors.length > visible.length) visible.push(`[summary] ${errors.length - visible.length} more error(s)`);
  return visible.join(" | ").slice(0, WNBA_DAILY_REFRESH_ERROR_MESSAGE_MAX_LENGTH) || "[unknown] error";
}
