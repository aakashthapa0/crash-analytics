import useApiData from './useApiData.js';
import { endpoint, METADATA_URL } from '../api/urls.js';
import { severityColors } from '../constants/dashboard.js';

// Reuse metadata across filter changes and expose one loading/error state for the dashboard analytics.
export default function useDashboardData(view, retryCount) {
  const urls = ['severity', 'factors', 'counties'].map(name => endpoint(name, view));
  urls.push(...['year', 'month', 'day_of_week'].map(granularity => endpoint('trends', view, granularity)));
  const metadataRequest = useApiData([METADATA_URL], retryCount);
  const analytics = useApiData(urls, retryCount);
  const metadata = metadataRequest.data?.[0] ?? null;
  const { data } = analytics;
  const status = metadataRequest.status === 'ready' ? analytics.status : metadataRequest.status;
  const error = metadataRequest.status === 'error' ? `Dataset information unavailable: ${metadataRequest.error}` : analytics.error;
  const severities = Object.entries(metadata?.available_filters.severities ?? {}).map(([code, label]) => ({
    code, label, color: severityColors[code] || '#75978b',
  }));

  // Response positions must stay aligned with the URL order above.
  const severityData = data ? data[0] : null;
  const factorData = data ? data[1] : null;
  const countyData = data ? data[2] : null;
  const [yearData, monthData, weekdayData] = data ? data.slice(3, 6) : [];

  const currentSeverities = severities.map(cfg => {
    const found = severityData?.results?.find(r => r.severity === cfg.code);
    return {
      ...cfg,
      count: found ? found.crashes : 0,
      percent: found ? found.percentage : 0,
    };
  });

  const codes = view.severity;

  const visibleSeverity = currentSeverities.filter(
    item => codes.length === 0 || codes.includes(item.code)
  );

  const viewTotal = visibleSeverity.reduce((sum, item) => sum + item.count, 0);
  const seriousTotal = visibleSeverity
    .filter(item => item.code === 'K' || item.code === 'A')
    .reduce((sum, item) => sum + item.count, 0);
  const fatalTotal = visibleSeverity.find(item => item.code === 'K')?.count ?? 0;

  return { metadata, metadataStatus: metadataRequest.status, status, error, severities,
    severityData, factorData, countyData, yearData, monthData, weekdayData,
    visibleSeverity, viewTotal, seriousTotal, fatalTotal };
}
