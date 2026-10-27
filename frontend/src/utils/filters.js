// Normalize shared URL filters and serialize them consistently for navigation and API requests.

export const emptyView = () => ({ county: '', year: '', severity: [] });

// Preserve unknown values for API validation instead of silently choosing a different filter.
export function readView(search) {
  const p = new URLSearchParams(search);
  return {
    county: (p.get('county') || '').trim().toUpperCase(),
    year: p.get('year') || '',
    severity: [...new Set(p.getAll('severity').map(s => s.trim().toUpperCase()))].sort(),
  };
}

// Convert active filter state into URLSearchParams with deduplicated, sorted severities
export function filterQuery(view) {
  const p = new URLSearchParams();
  if (view.county) p.set('county', view.county);
  if (view.year) p.set('year', view.year);
  [...new Set(view.severity)].sort().forEach(s => p.append('severity', s));
  return p;
}

export function viewQuery(view) {
  return filterQuery(view).toString();
}
