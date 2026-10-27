import { filterQuery } from '../utils/filters.js';

// Same-origin API paths let Vite and CloudFront route requests without environment-specific hosts.
const API_BASE = '/api/v1';
export const METADATA_URL = `${API_BASE}/metadata`;

export function endpoint(name, view, granularity = 'month') {
  const p = filterQuery(view);
  if (name === 'trends') p.set('granularity', granularity);
  return `${API_BASE}/${name}${p.size ? '?' + p : ''}`;
}
