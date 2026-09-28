export type BrowserAnalyticsChoice = "granted" | "denied";

export const ANALYTICS_CHOICE_COOKIE = "oddsphere_analytics_choice";

export function browserAnalyticsChoice(cookieHeader: string): BrowserAnalyticsChoice | null {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0 || part.slice(0, separator).trim() !== ANALYTICS_CHOICE_COOKIE) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value === "granted" || value === "denied" ? value : null;
  }
  return null;
}

export function analyticsBrowserTagAllowed(
  choice: BrowserAnalyticsChoice | null,
  measurementId: string | null,
): boolean {
  return choice === "granted" && measurementId !== null && /^G-[A-Z0-9]+$/.test(measurementId);
}
