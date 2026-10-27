// Shared display formatting keeps counts, labels, and coverage dates consistent across the dashboard.

export const fmt = n => new Intl.NumberFormat('en-US').format(n);
export const titleCase = text => text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// Treat date-only API values as UTC so local time zones cannot shift the displayed day.
export const formatDate = value => value
  ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`))
  : 'Not supplied';

// ISO dates sort chronologically, so coverage bounds identify incomplete years without date conversion.
export function isPartialYear(year, coverage) {
  if (!coverage?.first_date || !coverage?.last_date) return false;
  return `${year}-01-01` < coverage.first_date || `${year}-12-31` > coverage.last_date;
}

export function yearRange(metadata) {
  const years = metadata?.available_filters.years ?? [];
  return years.length ? years[0] === years.at(-1) ? String(years[0]) : `${years[0]}-${years.at(-1)}` : 'all-years';
}
