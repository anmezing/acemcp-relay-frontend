export const MILLISECONDS_PER_SECOND = 1_000;
export const MILLISECONDS_PER_MINUTE = 60 * MILLISECONDS_PER_SECOND;
export const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
export const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

const MAX_LOCAL_DAY_SEARCH_MS = 2 * MILLISECONDS_PER_DAY;

function zonedDayParts(date: Date, timeZone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function zonedDayKey(date: Date, timeZone: string): string {
  const { year, month, day } = zonedDayParts(date, timeZone);
  return `${year}${month}${day}`;
}

export function nextZonedDayBoundary(now: Date, timeZone: string): Date {
  const currentDay = zonedDayKey(now, timeZone);
  let low = now.getTime();
  let high = low + MAX_LOCAL_DAY_SEARCH_MS;
  if (zonedDayKey(new Date(high), timeZone) === currentDay) {
    throw new Error(`Unable to resolve the next day boundary for ${timeZone}`);
  }
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (zonedDayKey(new Date(middle), timeZone) === currentDay) low = middle;
    else high = middle;
  }
  return new Date(high);
}
