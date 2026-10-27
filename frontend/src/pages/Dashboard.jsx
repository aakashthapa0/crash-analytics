import React, { useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import DashboardHeader from '../components/DashboardHeader.jsx';
import DashboardFilters from '../components/DashboardFilters.jsx';
import SummaryMetrics from '../components/SummaryMetrics.jsx';
import FactorExplorer from '../components/FactorExplorer.jsx';
import SeverityPanel from '../components/SeverityPanel.jsx';
import CountyMap from '../components/CountyMap.jsx';
import CrashTimeline from '../components/CrashTimeline.jsx';
import CountyPie from '../components/CountyPie.jsx';
import useFilters from '../hooks/useFilters.js';
import useDashboardData from '../hooks/useDashboardData.js';
import useNavigation from '../hooks/useNavigation.js';
import usePageReveal from '../hooks/usePageReveal.js';
import { emptyView } from '../utils/filters.js';
import { exportCSV } from '../utils/csv.js';

// Keep filters shared across cards, map, and export; individual components own their presentation.
export default function Dashboard() {
  const [view, setView] = useFilters();
  const [focusedSeverity, setFocusedSeverity] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [timelineMode, setTimelineMode] = useState('year');
  const navigation = useNavigation();
  const { metadata, metadataStatus, status, error, severities, severityData, factorData, countyData,
    yearData, monthData, weekdayData, visibleSeverity, viewTotal, seriousTotal, fatalTotal } = useDashboardData(view, retryCount);
  usePageReveal(status);

  const setSeveritySelection = next => {
    setView(v => ({ ...v, severity: next }));
    setFocusedSeverity(null);
  };

  const handleCountyChange = nextCounty => {
    setView(v => ({
      ...v,
      county: nextCounty === 'all' || !nextCounty ? '' : nextCounty.toUpperCase(),
    }));
  };

  const handleYearChange = nextYear => {
    setView(v => ({ ...v, year: nextYear === 'all' ? '' : nextYear }));
  };

  const resetAllFilters = () => {
    setView(emptyView());
    setFocusedSeverity(null);
  };

  return (
    <div className={`app-shell${navigation.sidebarHidden ? ' sidebar-hidden' : ''}`}>
      <Sidebar {...navigation} metadata={metadata} />
      <main id="overview" aria-busy={status === 'loading'}>
        <DashboardHeader metadata={metadata} metadataStatus={metadataStatus} status={status}
          onExport={() => exportCSV({ view, visibleSeverity, viewTotal, factorData, metadata })} />
        <DashboardFilters metadata={metadata} view={view} severities={severities}
          onCountyChange={handleCountyChange} onYearChange={handleYearChange}
          onSeverityChange={setSeveritySelection} onReset={resetAllFilters} />

        {status !== 'ready' && (
          <div className="request-status" role={status === 'error' ? 'alert' : 'status'}>
            {status === 'error' ? (
              <>{error} <button type="button" onClick={() => setRetryCount(n => n + 1)}>Retry</button></>
            ) : metadataStatus === 'ready' ? 'Loading crash statistics…' : 'Loading dataset information…'}
          </div>
        )}

        {status === 'ready' && <>
          <SummaryMetrics viewTotal={viewTotal} seriousTotal={seriousTotal} fatalTotal={fatalTotal} factorData={factorData} />
          <section className="visual-grid">
            <FactorExplorer factorData={factorData} totalDistrictCrashes={severityData?.total_crashes || 0} />
            <SeverityPanel visibleSeverity={visibleSeverity} viewTotal={viewTotal} seriousTotal={seriousTotal}
              focusedSeverity={focusedSeverity} onFocusChange={setFocusedSeverity} codes={view.severity} />
          </section>
          <div className="time-county-row">
            <CrashTimeline yearData={yearData} monthData={monthData} weekdayData={weekdayData}
              mode={timelineMode} onModeChange={setTimelineMode} />
            <CountyPie data={countyData} />
          </div>
        </>}

        {metadata && <CountyMap metadata={metadata}
          selectedCounty={view.county} onCountySelect={handleCountyChange}
          selectedYear={view.year || 'all'} onYearSelect={handleYearChange}
          selectedSeverities={view.severity} onSeveritySelect={setSeveritySelection} />}
      </main>
    </div>
  );
}
