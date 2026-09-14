export function dateKeyInTimeZone(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "Unscheduled";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  } catch {
    return "Unscheduled";
  }
}

export function boardDateLabel(timestamp: string | null | undefined, timeZone: string): string {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "Date TBD";

  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(new Date(timestamp));
  } catch {
    return "Date TBD";
  }
}
