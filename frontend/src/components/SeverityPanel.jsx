import React from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';
import { fmt } from '../utils/format.js';

// Highlight a severity within the current selection without changing the dashboard filters.
export default function SeverityPanel({ visibleSeverity, viewTotal, seriousTotal, focusedSeverity, onFocusChange, codes }) {
  const selectedSeverityItem = visibleSeverity.find(item => item.code === focusedSeverity);
  const share = count => (viewTotal > 0 ? ((count / viewTotal) * 100).toFixed(2) : '0.00');

  return (
    <div className="outcome-panel" id="severity">
      <div className="card-head">
        <div>
          <span className="eyebrow">Crash severity</span>
          <h2>How severe were the crashes?</h2>
        </div>
      </div>

      <div className="outcome-story" aria-live="polite">
        <strong>
          <AnimatedNumber
            value={Number(
              share(selectedSeverityItem ? selectedSeverityItem.count : seriousTotal)
            )}
            decimals={2}
            delay={200}
          />
          %
        </strong>
        <div>
          <b>
            {selectedSeverityItem
              ? selectedSeverityItem.label
              : 'Fatal or serious injury'}
          </b>
          <span>
            {selectedSeverityItem
              ? `${fmt(selectedSeverityItem.count)} distinct crashes`
              : `${fmt(seriousTotal)} of ${fmt(viewTotal)} selected crashes`}
          </span>
        </div>
      </div>

      <div
        className="severity-stack"
        key={codes.join('')}
        aria-label="Severity distribution"
      >
        {visibleSeverity.map(item => (
          <button
            key={item.code}
            type="button"
            style={{ flex: item.count, background: item.color }}
            onClick={() =>
              onFocusChange(
                focusedSeverity === item.code ? null : item.code
              )
            }
            aria-label={`${item.label}: ${fmt(item.count)} crashes, ${share(
              item.count
            )}% of selection`}
            aria-pressed={focusedSeverity === item.code}
          />
        ))}
      </div>

      <div className="outcome-rows">
        {visibleSeverity.map((item, index) => (
          <button
            key={item.code}
            className={`outcome-row ${
              focusedSeverity === item.code ? 'chosen' : ''
            }`}
            onClick={() =>
              onFocusChange(
                focusedSeverity === item.code ? null : item.code
              )
            }
            aria-pressed={focusedSeverity === item.code}
            type="button"
          >
            <span className="severity-code" style={{ color: item.color }}>
              {item.code}
            </span>
            <b>{item.label}</b>
            <strong>
              <AnimatedNumber value={item.count} delay={250 + index * 100} />
            </strong>
            <em>
              <AnimatedNumber
                value={Number(share(item.count))}
                decimals={2}
                delay={250 + index * 100}
              />
              %
            </em>
          </button>
        ))}
      </div>
    </div>
  );
}
