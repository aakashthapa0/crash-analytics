import { titleCase, isPartialYear, yearRange } from './format.js';

// Build and download a summary CSV using the current filters, counts, and dataset metadata.
export function buildCSVContent({ view = {}, visibleSeverity = [], viewTotal = 0, factorData = null, metadata = null }) {
  const available = metadata?.available_filters;
  const countyLabel = view.county ? titleCase(view.county) + ' County'
    : available ? `All ${available.counties.length} Counties (District)` : 'All counties';
  const yearLabel = view.year ? String(view.year) : available?.years.length ? `All Years (${yearRange(metadata)})` : 'All years';
  const partialYears = (available?.years ?? []).filter(year => isPartialYear(year, metadata.coverage));
  const coverage = metadata?.coverage;
  const range = coverage?.first_date && coverage?.last_date
    ? `${coverage.first_date} through ${coverage.last_date}${partialYears.length ? ` (${partialYears.join(', ')} partial)` : ''}`
    : 'Not supplied';
  const codes = view.severity || [];
  const severityLabel = codes.length
    ? codes.map(c => available?.severities[c] || c).join(' + ')
    : 'All Injury Severities';

  const factorResults = factorData?.results || [];
  const noFactorCount = factorData?.no_recorded_factor ?? 0;
  const missingFactorCount = factorData?.missing_factor ?? 0;

  const rows = [
    ['Crash Analytics Data Export', ''],
    ['Export Date', new Date().toISOString().split('T')[0]],
    ['Data Range', range],
    ['Dataset Scope', metadata?.scope ?? 'Not supplied'],
    ['Counting Unit', metadata?.definitions.counting_unit ?? 'Not supplied'],
    ['', ''],
    ['ACTIVE SELECTION FILTERS', ''],
    ['County Filter', countyLabel],
    ['Year Filter', yearLabel],
    ['Severity Filter', severityLabel],
    ['Total Distinct Injury Crashes in Selection', viewTotal],
    ['', ''],
    ['SEVERITY BREAKDOWN', 'CRASH COUNT', 'PERCENTAGE OF SELECTION'],
    ...visibleSeverity.map(item => [
      item.label,
      item.count,
      viewTotal > 0 ? `${((item.count / viewTotal) * 100).toFixed(2)}%` : '0.00%',
    ]),
    ['', ''],
    ['CONTRIBUTING FACTORS IN SELECTION', 'CRASH COUNT', '% OF FILTERED CRASHES'],
    ['Explicit NONE Recorded', noFactorCount, viewTotal > 0 ? `${((noFactorCount / viewTotal) * 100).toFixed(2)}%` : '0.00%'],
    ['Missing Factor Field', missingFactorCount, viewTotal > 0 ? `${((missingFactorCount / viewTotal) * 100).toFixed(2)}%` : '0.00%'],
    ...factorResults.map(item => [
      item.factor,
      item.crashes,
      viewTotal > 0 ? `${((item.crashes / viewTotal) * 100).toFixed(2)}%` : '0.00%',
    ]),
  ];

  // Quote every field and escape embedded quotes so commas and newlines remain inside the cell.
  return rows
    .map(row => row.map(val => `"${String(val).replaceAll('"', '""')}"`).join(','))
    .join('\n');
}

// Generate dynamic download filename reflecting active selection
export function buildCSVFilename(view = {}, metadata = null) {
  const countyPart = view.county ? view.county.toLowerCase() : 'all-counties';
  const yearPart = view.year ? String(view.year) : yearRange(metadata);
  return `crashes-${countyPart}-${yearPart}.csv`;
}

export function exportCSV({ view, visibleSeverity, viewTotal, factorData, metadata }) {
  const csvContent = buildCSVContent({ view, visibleSeverity, viewTotal, factorData, metadata });
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildCSVFilename(view, metadata);
  link.click();
  // Give the browser time to start the download before releasing its temporary URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
