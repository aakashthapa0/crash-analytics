import React from 'react';
import { titleCase, isPartialYear } from '../utils/format.js';

// Metadata supplies the available choices; callbacks keep the page and map on the same filters.
export default function DashboardFilters({ metadata, view, severities, onCountyChange, onYearChange, onSeverityChange, onReset }) {
  const counties = metadata?.available_filters.counties ?? [];
  const years = metadata?.available_filters.years ?? [];
  const codes = view.severity;

  return (
    <section className="filter-panel" aria-label="Dashboard filters">
      <div className="filter-main">
        <div className="filter-field">
          <label htmlFor="county-filter">County</label>
          <select
            id="county-filter"
            value={view.county || 'all'}
            disabled={!metadata}
            onChange={event => onCountyChange(event.target.value)}
          >
            <option value="all">{metadata ? `All ${counties.length} counties` : 'All counties'}</option>
            {counties.map(name => (
              <option key={name} value={name}>
                {titleCase(name)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="year-filter">Timeline year</label>
          <select
            id="year-filter"
            value={view.year || 'all'}
            disabled={!metadata}
            onChange={event => onYearChange(event.target.value)}
          >
            <option value="all">All years</option>
            {years.map(val => (
              <option key={val} value={String(val)}>
                {val}
                {isPartialYear(val, metadata.coverage) ? ' · partial' : ''}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="severity-filter" disabled={!metadata}>
          <legend>Crash severity</legend>
          <div>
            {severities.map(item => {
              const isPressed = codes.includes(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  aria-pressed={isPressed}
                  onClick={() =>
                    onSeverityChange(
                      isPressed
                        ? codes.filter(c => c !== item.code)
                        : [...codes, item.code].sort()
                    )
                  }
                >
                  <span style={{ color: item.color }}>{item.code}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <button className="filter-reset" type="button" onClick={onReset}>
          Reset filters
        </button>
      </div>
    </section>
  );
}
