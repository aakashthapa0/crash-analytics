import React from 'react';
import Icon from './Icon.jsx';
import { fmt, formatDate } from '../utils/format.js';

// Show dataset coverage and enable CSV export only after the current selection has loaded.
export default function DashboardHeader({ metadata, metadataStatus, status, onExport }) {
  return (
    <header>
      <div>
        <h1>Crash Analytics</h1>
      </div>
      <div className="header-tools">
        <div className="snapshot-date-badge">
          <span className="snapshot-date">{metadata
            ? `${formatDate(metadata.coverage.first_date)} — ${formatDate(metadata.coverage.last_date)}`
            : metadataStatus === 'error' ? 'Dataset unavailable' : 'Loading dataset…'}</span>
          <div className="info-tooltip-anchor">
            <button
              type="button"
              className="info-icon-btn"
              aria-label="Export data coverage details"
              aria-describedby="date-coverage-tooltip"
            >
              <span className="notice-mark" aria-hidden="true">i</span>
            </button>
            <div id="date-coverage-tooltip" className="info-tooltip-popover" role="tooltip">
              <span className="info-tooltip-arrow" aria-hidden="true" />
              <b className="info-tooltip-title">Dataset coverage</b>
              <p className="info-tooltip-desc">
                {metadata ? `${metadata.scope}. ${fmt(metadata.crashes)} distinct crashes. ${metadata.definitions.coverage}` : 'Dataset information is not available yet.'}
              </p>
            </div>
          </div>
        </div>
        <button
          className="export"
          title="Export filtered data CSV"
          disabled={status !== 'ready'}
          onClick={onExport}
          type="button"
        >
          Export data <Icon name="arrow" />
        </button>
      </div>
    </header>
  );
}
