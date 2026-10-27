// Prepare chart scales, calendar-month totals, and county shares from API results.

// Keep five integer tick marks even when a selection contains very few crashes.
export function chartScale(values) {
  const maximum = Math.max(1, ...values);
  const magnitude = 10 ** Math.floor(Math.log10(maximum / 4));
  const step = Math.max(1, Math.ceil(maximum / 4 / magnitude) * magnitude);
  return { maximum: step * 4, ticks: Array.from({ length: 5 }, (_, index) => index * step) };
}

// Combine the same calendar month across years; null means not supplied, distinct from a reported zero.
export function monthlyProfile(results) {
  const years = new Map();
  for (const row of results) {
    const [year, month] = row.period.split('-');
    if (!years.has(year)) years.set(year, { year, months: Array(12).fill(null), total: 0 });
    const series = years.get(year);
    series.months[Number(month) - 1] = row;
    series.total += row.crashes;
  }
  const series = [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
  if (!series.length) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const years = series.map(item => {
      const month = item.months[index];
      // Each year card uses that year's dated-crash total as its percentage denominator.
      return { year: item.year, crashes: month?.crashes ?? null,
        percentage: month ? item.total ? 100 * month.crashes / item.total : 0 : null,
        partial_period: month?.partial_period ?? false };
    });
    const supplied = years.filter(item => item.crashes !== null);
    return {
      period: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, index, 1))),
      crashes: supplied.length ? supplied.reduce((sum, item) => sum + item.crashes, 0) : null,
      partial_period: years.some(item => item.partial_period),
      years,
    };
  });
}

// Rank without mutating API results and retain all other counties in the total and percentage denominator.
export function countySlices(results, total) {
  const top = [...results].filter(row => row.crashes > 0)
    .sort((a, b) => b.crashes - a.crashes || a.county.localeCompare(b.county)).slice(0, 5);
  const remaining = total - top.reduce((sum, row) => sum + row.crashes, 0);
  if (remaining > 0) top.push({ county: 'Other counties', crashes: remaining });
  return top.map(row => ({ ...row, percentage: total > 0 ? 100 * row.crashes / total : 0 }));
}
