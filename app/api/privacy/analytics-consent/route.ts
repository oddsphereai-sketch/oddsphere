import { NextResponse } from "next/server";

import {
  ANALYTICS_CHOICE_COOKIE,
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_MAX_AGE_SECONDS,
  type AnalyticsConsentChoice,
  analyticsConsentFromCookieHeader,
  newAnalyticsConsentId,
  serializeAnalyticsConsent,
} from "@/lib/analytics/consent";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

function requestedChoice(value: unknown): AnalyticsConsentChoice | null {
  if (value === "granted" || value === "denied") return value;
  return null;
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }

  let choice: AnalyticsConsentChoice | null = null;
  try {
    choice = requestedChoice((await request.json() as { choice?: unknown }).choice);
  } catch {
    // The response below deliberately treats malformed JSON like any other invalid choice.
  }
  if (choice === null) {
    return Response.json({ error: "invalid_choice" }, { status: 400 });
  }

  const salt = process.env.CONVERSION_TRACKING_SALT;
  if (!salt || salt.length < 32) {
    return Response.json({ error: "analytics_consent_not_configured" }, { status: 503 });
  }

  const current = analyticsConsentFromCookieHeader(request.headers.get("cookie"), salt);
  const id = current?.id ?? newAnalyticsConsentId();
  const now = new Date().toISOString();
  const { data: existing, error: readError } = await supabase
    .from("analytics_consent_choices")
    .select("choice,granted_at,withdrawn_at")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    return Response.json({ error: "consent_read_failed" }, { status: 503 });
  }

  const { error: writeError } = await supabase
    .from("analytics_consent_choices")
    .upsert({
      id,
      choice,
      choice_set_at: now,
      granted_at: choice === "granted" ? now : existing?.granted_at ?? null,
      withdrawn_at: choice === "denied" ? now : null,
      updated_at: now,
    }, { onConflict: "id" });
  if (writeError) {
    return Response.json({ error: "consent_write_failed" }, { status: 503 });
  }

  const response = NextResponse.json({ choice });
  response.cookies.set(ANALYTICS_CONSENT_COOKIE, serializeAnalyticsConsent({ id, choice }, salt), {
    httpOnly: true,
    maxAge: ANALYTICS_CONSENT_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    priority: "high",
  });
  response.cookies.set(ANALYTICS_CHOICE_COOKIE, choice, {
    httpOnly: false,
    maxAge: ANALYTICS_CONSENT_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    priority: "high",
  });
  return response;
}
