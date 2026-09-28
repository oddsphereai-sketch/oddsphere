import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ANALYTICS_CONSENT_COOKIE = "oddsphere_analytics_consent";
export const ANALYTICS_CHOICE_COOKIE = "oddsphere_analytics_choice";
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type AnalyticsConsentChoice = "granted" | "denied";

export type AnalyticsConsent = {
  id: string;
  choice: AnalyticsConsentChoice;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signature(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("base64url");
}

export function newAnalyticsConsentId(): string {
  return randomUUID();
}

export function serializeAnalyticsConsent(
  consent: AnalyticsConsent,
  salt: string,
): string {
  if (salt.length < 32) throw new Error("Conversion tracking salt must be at least 32 characters");
  if (!UUID_PATTERN.test(consent.id)) throw new Error("Analytics consent id must be a UUID");
  const unsigned = `v1.${consent.id}.${consent.choice}`;
  return `${unsigned}.${signature(unsigned, salt)}`;
}

export function parseAnalyticsConsent(
  value: string | null | undefined,
  salt: string | null | undefined,
): AnalyticsConsent | null {
  if (!value || !salt || salt.length < 32) return null;
  const [version, id, choice, supplied, extra] = value.split(".");
  if (extra !== undefined || version !== "v1" || !UUID_PATTERN.test(id ?? "")) return null;
  if (choice !== "granted" && choice !== "denied") return null;
  if (!supplied) return null;
  const unsigned = `${version}.${id}.${choice}`;
  const expected = signature(unsigned, salt);
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, suppliedBuffer)) return null;
  return { id: id!, choice };
}

export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export function analyticsConsentFromCookieHeader(
  cookieHeader: string | null,
  salt: string | null | undefined,
): AnalyticsConsent | null {
  return parseAnalyticsConsent(cookieValue(cookieHeader, ANALYTICS_CONSENT_COOKIE), salt);
}

export function analyticsAllowed(
  consent: AnalyticsConsent | null,
): consent is AnalyticsConsent & { choice: "granted" } {
  return consent?.choice === "granted";
}

export function googleAnalyticsCookieNames(measurementId: string | null | undefined): string[] {
  const names = ["_ga"];
  if (measurementId && /^G-[A-Z0-9]+$/.test(measurementId)) {
    names.push(`_ga_${measurementId.slice(2)}`);
  }
  return names;
}
