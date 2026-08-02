"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export const DEFAULT_DISPLAY_TIME_ZONE = "America/New_York";

type DateTimeStyle = "time" | "date-time";

const UserTimeZoneContext = createContext(DEFAULT_DISPLAY_TIME_ZONE);

export function UserTimeZoneProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore provides deterministic ET server HTML, then reads
  // the browser's zone after hydration without an effect-driven render loop.
  const timeZone = useSyncExternalStore(
    subscribeToTimeZone,
    browserTimeZone,
    serverTimeZone,
  );

  return (
    <UserTimeZoneContext.Provider value={timeZone}>
      {children}
    </UserTimeZoneContext.Provider>
  );
}

function subscribeToTimeZone(): () => void {
  // A browser timezone does not change during a normal page session.
  return () => undefined;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_DISPLAY_TIME_ZONE;
  } catch {
    return DEFAULT_DISPLAY_TIME_ZONE;
  }
}

function serverTimeZone(): string {
  return DEFAULT_DISPLAY_TIME_ZONE;
}

export function useUserTimeZone(): string {
  return useContext(UserTimeZoneContext);
}

export function formatZonedDateTime(
  value: string | null | undefined,
  timeZone: string,
  style: DateTimeStyle = "time",
  showTimeZone = true,
): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;

  try {
    return new Intl.DateTimeFormat("en-US", {
      ...(style === "date-time" ? { month: "short", day: "numeric" } : {}),
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(showTimeZone ? { timeZoneName: "short" as const } : {}),
      timeZone,
    }).format(new Date(timestamp));
  } catch {
    return null;
  }
}

export function LocalTime({
  value,
  style = "time",
  showTimeZone = true,
  fallback = "—",
  className,
}: {
  value: string | null | undefined;
  style?: DateTimeStyle;
  showTimeZone?: boolean;
  fallback?: string;
  className?: string;
}) {
  const timeZone = useUserTimeZone();
  const label = useMemo(
    () => formatZonedDateTime(value, timeZone, style, showTimeZone) ?? fallback,
    [fallback, showTimeZone, style, timeZone, value],
  );

  if (!value || !Number.isFinite(Date.parse(value))) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <time className={className} dateTime={value} title={timeZone}>
      {label}
    </time>
  );
}
