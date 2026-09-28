"use client";

import Script from "next/script";
import { useState, useSyncExternalStore } from "react";

import {
  type BrowserAnalyticsChoice,
  analyticsBrowserTagAllowed,
  browserAnalyticsChoice,
} from "@/lib/analytics/consentBrowser";

type Props = {
  measurementId: string | null;
};

function expireCookie(name: string, domain?: string): void {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
}

function clearGoogleAnalyticsCookies(measurementId: string | null): void {
  const names = ["_ga"];
  if (measurementId && /^G-[A-Z0-9]+$/.test(measurementId)) names.push(`_ga_${measurementId.slice(2)}`);
  const hostname = window.location.hostname;
  const analyticsDomain = hostname === "oddsphereai.com" || hostname.endsWith(".oddsphereai.com")
    ? ".oddsphereai.com"
    : null;
  for (const name of names) {
    expireCookie(name);
    if (analyticsDomain) expireCookie(name, analyticsDomain);
  }
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

export default function AnalyticsConsent({ measurementId }: Props) {
  const choice = useSyncExternalStore(
    subscribeToNothing,
    () => browserAnalyticsChoice(document.cookie),
    () => null,
  );
  const hydrated = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState<BrowserAnalyticsChoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(choice: BrowserAnalyticsChoice) {
    setSaving(choice);
    setError(null);
    try {
      const response = await fetch("/api/privacy/analytics-consent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ choice }),
      });
      if (!response.ok) throw new Error("Could not save your analytics choice. Please try again.");
      if (choice === "denied") clearGoogleAnalyticsCookies(measurementId);
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your analytics choice.");
      setSaving(null);
    }
  }

  if (!hydrated) return null;

  const open = choice === null || settingsOpen;
  const analyticsEnabled = analyticsBrowserTagAllowed(choice, measurementId);
  return (
    <>
      {analyticsEnabled ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('js',new Date());gtag('config','${measurementId}',{allow_google_signals:false,allow_ad_personalization_signals:false});`}
          </Script>
        </>
      ) : null}
      {open ? (
        <section
          aria-labelledby="analytics-choice-title"
          aria-live="polite"
          className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-violet-400/30 bg-gray-950/95 p-5 shadow-2xl shadow-black/50 backdrop-blur sm:bottom-5 sm:p-6"
          role="dialog"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="analytics-choice-title" className="text-base font-black text-white">
                Optional analytics
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-300">
                Choose whether OddSphere may use Google Analytics for site usage and confirmed
                trial and first-payment measurement. Declining does not affect membership access,
                checkout, billing, or the product.
              </p>
              <p className="mt-2 text-xs font-semibold text-gray-400">
                Current choice: {choice === "granted" ? "Accepted" : choice === "denied" ? "Declined" : "No choice"}
              </p>
              <a
                className="mt-2 inline-block text-xs font-semibold text-violet-300 underline underline-offset-2 hover:text-violet-200"
                href="/legal/privacy"
              >
                Read the privacy policy
              </a>
            </div>
            {choice !== null ? (
              <button
                aria-label="Close analytics choices"
                className="rounded-md px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white"
                onClick={() => setSettingsOpen(false)}
                type="button"
              >
                ×
              </button>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              className="rounded-xl border border-gray-600 px-5 py-2.5 text-sm font-bold text-gray-100 transition hover:border-gray-400 hover:bg-white/5 disabled:opacity-60"
              disabled={saving !== null}
              onClick={() => save("denied")}
              type="button"
            >
              {saving === "denied" ? "Saving…" : "Decline"}
            </button>
            <button
              className="rounded-xl bg-violet-500 px-5 py-2.5 text-sm font-black text-white transition hover:bg-violet-400 disabled:opacity-60"
              disabled={saving !== null}
              onClick={() => save("granted")}
              type="button"
            >
              {saving === "granted" ? "Saving…" : "Accept"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm font-semibold text-red-300">{error}</p> : null}
        </section>
      ) : (
        <button
          className="fixed bottom-3 right-3 z-[90] rounded-full border border-gray-700 bg-gray-950/95 px-3 py-2 text-xs font-bold text-gray-200 shadow-lg transition hover:border-violet-400/60 hover:text-white sm:bottom-5 sm:right-5"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          Analytics choices
        </button>
      )}
    </>
  );
}
