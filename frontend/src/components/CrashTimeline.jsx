import React, { useState } from 'react';
import { chartScale, monthlyProfile } from '../utils/charts.js';
import { fmt } from '../utils/format.js';

// Switch between year, calendar-month, and weekday counts while preserving API reporting flags.
const views = [['year', 'Year'], ['month', 'Months'], ['day_of_week', 'Day of the week']];
function PeriodChart({ data, mode }) {
  const rows = mode === 'month' ? monthlyProfile(data.results) : data.results;
  const last = rows.length - 1;
  const peak = rows.reduce((best, row, index) => row.crashes > (rows[best]?.crashes ?? 0) ? index : best, 0);
  // Start months at the busiest month; year and weekday views start at their final period.
  const [active, setActive] = useState(mode === 'month' ? peak : Math.max(0, last));
  if (!rows.length) return <p className="comparison-empty">No dated crashes in this selection.</p>;
  const index = Math.min(active, last);
  const selected = rows[index];
  const total = rows.reduce((sum, row) => sum + (row.crashes ?? 0), 0);
  const percentage = selected.percentage ?? (total ? 100 * selected.crashes / total : 0);
  const scale = chartScale(rows.map(row => row.crashes ?? 0));
  const barWidth = mode === 'year' ? 64 : 42;
  const x = i => 95 + (last ? i / last : 0.5) * 835;
  const y = value => 290 - value / scale.maximum * 255;
  const stride = Math.max(1, Math.ceil(rows.length / 7));
  const periodType = mode === 'year' ? 'year' : mode === 'month' ? 'month' : 'day';

  return (
    <>
      <div className="timeline-summary" aria-live="polite"><div>
        <strong>{selected.crashes === null ? 'Not supplied' : <>{fmt(selected.crashes)} <span className="month-share-bracket">({percentage.toFixed(2)}%)</span></>}</strong>
        <span>{selected.period}{selected.partial_period ? mode === 'month' ? ' · includes partial reporting' : ` · partial ${periodType}` : ''}</span>
      </div></div>
      <div className="timeline-scroll">
        <svg className="timeline-svg" viewBox="0 0 1000 320" role="img"
          aria-label={`${views.find(([value]) => value === mode)[1]} crash counts from ${rows[0].period} to ${rows[last].period}. Use the slider below for each period’s count.`}>
          {scale.ticks.map(value => <g key={value}>
            <line x1="65" x2="960" y1={y(value)} y2={y(value)} className="gridline" />
            <text x="55" y={y(value) + 3} textAnchor="end" className="timeline-axis">{fmt(value)}</text>
          </g>)}
          <text x="65" y="16" className="timeline-axis">CRASHES</text>
          {rows.map((row, i) => row.crashes !== null && <rect key={row.period}
            x={x(i) - barWidth / 2} y={y(row.crashes)} width={barWidth} height={290 - y(row.crashes)}
            fill={i === index ? '#df6334' : '#75978b'}
            stroke={row.partial_period ? '#345543' : undefined} strokeWidth="2" strokeDasharray={row.partial_period ? '4 3' : undefined}>
            <title>{`${row.period}: ${fmt(row.crashes)} crashes${row.partial_period ? ' (includes partial reporting)' : ''}`}</title></rect>
          )}
          {rows.map((row, i) => (mode === 'month' || i === last || (i % stride === 0 && last - i >= stride / 2)) &&
            <text key={row.period} x={x(i)} y="310" textAnchor="middle" className="timeline-axis">{mode === 'month' ? row.period.slice(0, 3) : row.period}</text>)}
          <rect x="65" y="24" width="895" height="266" fill="transparent" aria-hidden="true"
            onPointerMove={event => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setActive(Math.max(0, Math.min(last, Math.round((event.clientX - bounds.left) / bounds.width * last))));
            }} />
        </svg>
      </div>
      <div className="timeline-scrubber">
        <label htmlFor="crash-period">Explore {periodType}</label>
        <input id="crash-period" type="range" min="0" max={last} value={index}
          onChange={event => setActive(Number(event.target.value))}
          aria-valuetext={`${selected.period}, ${selected.crashes === null ? 'not supplied' : `${selected.crashes} crashes`}${selected.partial_period ? ', includes partial reporting' : ''}`} />
        <span>{selected.period}</span>
      </div>
      {mode === 'month' && <div className="comparison-details" aria-label={`${selected.period} crash counts by year`}>
        {selected.years.map(item => <div key={item.year}>
          <span>{item.year}</span><strong>{item.crashes === null ? '—' : <>
            <span>{fmt(item.crashes)}</span><span className="month-share-bracket">({item.percentage.toFixed(2)}%)</span>
          </>}</strong>
          <small>{item.crashes === null ? 'Not supplied' : item.partial_period ? 'Partial month' : 'Crashes'}</small>
        </div>)}
      </div>}
      {data.excluded_invalid_dates > 0 && <p className="timeline-caption">{fmt(data.excluded_invalid_dates)} crashes with invalid dates are excluded.</p>}
    </>
  );
}

export default function CrashTimeline({ yearData, monthData, weekdayData, mode = 'year', onModeChange }) {
  const data = { year: yearData, month: monthData, day_of_week: weekdayData }[mode];
  return (
    <section className="crash-timeline" id="timeline" aria-labelledby="timeline-title">
      <div className="card-head">
        <div>
          <span className="eyebrow">Crashes through time</span>
          <div className="timeline-heading">
            <h2 id="timeline-title">When did crashes occur?</h2>
            <div className="info-tooltip-anchor">
              <button type="button" className="info-icon-btn" aria-label="What do dashed bars mean?" aria-describedby="timeline-reporting-tooltip">
                <span className="notice-mark" aria-hidden="true">i</span>
              </button>
              <div id="timeline-reporting-tooltip" className="info-tooltip-popover" role="tooltip">
                <span className="info-tooltip-arrow" aria-hidden="true" />
                <b className="info-tooltip-title">Partial reporting</b>
                <p className="info-tooltip-desc">Dashed bar outlines mark incomplete reporting periods. A dashed year or month includes only the available dates, so its total may not represent the full period.</p>
              </div>
            </div>
          </div>
        </div>
        <div className="timeline-controls timeline-view-field">
          <select id="timeline-view" aria-label="Chart view" value={mode} onChange={event => onModeChange(event.target.value)}>
            {views.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
      </div>
      <PeriodChart key={mode} data={data} mode={mode} />
    </section>
  );
}
