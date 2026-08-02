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

export function zonedWallTimeToIso(
  dateValue: string | null | undefined,
  timeValue: string | null | undefined,
  timeZone: string,
): string | null {
  const dateMatch = dateValue?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeValue?.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour12 = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;

  const hour = (hour12 % 12) + (timeMatch[3].toUpperCase() === "PM" ? 12 : 0);
  const desiredWallTime = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredWallTime;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    });

    // Resolve the zone offset for this exact date. A second pass handles an
    // offset change between the initial UTC guess and the desired wall time.
    for (let pass = 0; pass < 2; pass++) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(candidate))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      const observedWallTime = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
      );
      if (!Number.isFinite(observedWallTime)) return null;
      candidate += desiredWallTime - observedWallTime;
    }

    return new Date(candidate).toISOString();
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
