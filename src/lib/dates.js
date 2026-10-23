// Date helpers. All dates in the knowledge base are YYYY-MM-DD strings in UTC.

export function isoDate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function monthId(d = new Date()) {
  return isoDate(d).slice(0, 7);
}

// The first `weekday` (0 = Sunday) of the given month, as a UTC Date.
export function firstWeekdayOfMonth(year, monthIndex, weekday) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, monthIndex, 1 + offset));
}

// Cron can't say "first Tuesday", so the workflow runs every Tuesday and asks this.
export function isFirstWeekdayOfMonth(date, weekday) {
  const d = new Date(date);
  return d.getUTCDay() === weekday && d.getUTCDate() <= 7;
}

export function daysBetween(a, b) {
  const ms = new Date(b).setUTCHours(0, 0, 0, 0) - new Date(a).setUTCHours(0, 0, 0, 0);
  return Math.round(ms / 86_400_000);
}

export function isStale(lastConfirmed, staleAfterDays, today = new Date()) {
  if (!lastConfirmed) return true;
  return daysBetween(lastConfirmed, today) > staleAfterDays;
}

export function inWindow(date, from, to) {
  return date >= from && date < to;
}

export function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function prettyMonth(id) {
  const d = new Date(`${id}-15T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
