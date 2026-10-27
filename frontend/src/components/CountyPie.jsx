import React, { useState } from 'react';
import { countySlices } from '../utils/charts.js';
import { fmt, titleCase } from '../utils/format.js';

// Show the top five counties plus the remaining share, with details available by mouse or keyboard.
const colors = ['#244b3e', '#e96535', '#c69c48', '#75978b', '#786487', '#b8b4aa'];

export default function CountyPie({ data }) {
  const slices = countySlices(data.results, data.total_crashes);
  const [active, setActive] = useState(null);
  const selected = slices.find(row => row.county === active);
  const interactions = row => ({
    'data-active': row.county === active,
    'aria-describedby': row.county === active ? 'county-pie-tooltip' : undefined,
    onMouseEnter: () => setActive(row.county),
    onMouseLeave: event => { if (!event.currentTarget.matches(':focus')) setActive(null); },
    onFocus: () => setActive(row.county),
    onBlur: () => setActive(null),
    onClick: () => setActive(row.county),
    onKeyDown: event => {
      if (event.key === 'Escape') { setActive(null); event.stopPropagation(); }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActive(row.county); }
    },
  });
  let angle = -Math.PI / 2;

  return (
    <section className="county-pie crash-timeline" id="top-counties" aria-labelledby="top-counties-title">
      <div className="card-head"><div>
        <span className="eyebrow">Crashes by county</span>
        <h2 id="top-counties-title">Top 5 counties</h2>
      </div></div>
      {!slices.length ? <p className="comparison-empty">No crashes in this selection.</p> : <>
        <div className="county-pie-plot">
          <svg viewBox="0 0 360 360" className="county-pie-svg" role="group" aria-label="County crash distribution">
            {slices.map((row, index) => {
              const start = [180 + 170 * Math.cos(angle), 180 + 170 * Math.sin(angle)];
              angle += row.percentage / 100 * 2 * Math.PI;
              const end = [180 + 170 * Math.cos(angle), 180 + 170 * Math.sin(angle)];
              const props = { ...interactions(row), className: 'county-pie-slice', fill: colors[index],
                tabIndex: 0, role: 'button', 'aria-label': `${titleCase(row.county)} crash details` };
              // A full SVG arc ends where it starts, so use a circle for a single-county selection.
              return row.percentage === 100
                ? <circle key={row.county} cx="180" cy="180" r="170" {...props} />
                : <path key={row.county} d={`M180,180 L${start} A170,170 0 ${row.percentage > 50 ? 1 : 0},1 ${end} Z`} {...props} />;
            })}
          </svg>
          {selected && <div id="county-pie-tooltip" role="tooltip" className="county-pie-tooltip">
            <strong>{titleCase(selected.county)}</strong>
            <span>{fmt(selected.crashes)} crashes · {selected.percentage.toFixed(2)}%</span>
          </div>}
        </div>
        <ul className="county-pie-legend" aria-label="County legend">
          {slices.map((row, index) => <li key={row.county}>
            <button type="button" {...interactions(row)}>
              <span className="county-pie-swatch" style={{ background: colors[index] }} aria-hidden="true" />
              {titleCase(row.county)}
            </button>
          </li>)}
        </ul>
      </>}
    </section>
  );
}
