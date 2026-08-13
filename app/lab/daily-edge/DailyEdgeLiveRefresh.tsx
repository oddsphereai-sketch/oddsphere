"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const REFRESH_INTERVAL_MS = 60_000;
const RESUME_DEDUPE_MS = 15_000;

/**
 * Keeps the server-rendered Daily Edge candidate current while it remains
 * open. The previous client board polled automatically; the candidate route
 * lost that lifecycle when its snapshot loading moved to the server.
 *
 * router.refresh() merges the latest Server Component payload without
 * discarding reader state or making the existing page non-interactive.
 */
export default function DailyEdgeLiveRefresh() {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    lastRefreshAt.current = Date.now();

    function refresh(force = false) {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastRefreshAt.current < RESUME_DEDUPE_MS) return;
      lastRefreshAt.current = now;
      router.refresh();
    }

    const interval = window.setInterval(() => refresh(true), REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => refresh();
    const onFocus = () => refresh();
    const onOnline = () => refresh(true);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refresh(true);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);

  return null;
}
