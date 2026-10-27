import React, { useRef, useState } from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';
import Icon from './Icon.jsx';

// Rank supplied factors, initially showing five; expansion and row highlighting stay local to this card.
export default function FactorExplorer({ factorData, totalDistrictCrashes }) {
  const [active, setActive] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);

  // Use selected crashes as the denominator; crashes can contribute to more than one factor.
  const rawFactors = factorData?.results || [];
  const denominator = totalDistrictCrashes > 0 ? totalDistrictCrashes : 1;
  const factors = rawFactors.map(f => {
    const rawVal = (f.crashes / denominator) * 100;
    const isSubCent = f.crashes > 0 && rawVal < 0.005;
    return {
      label: f.factor,
      count: f.crashes,
      percent: rawVal.toFixed(2),
      isSubCent,
    };
  });

  const visibleFactors = expanded ? factors : factors.slice(0, 5);

  return (
    <section className="factor-explorer" id="factors" aria-labelledby="factors-title">
      <div className="card-head">
        <div>
          <span className="eyebrow">Contributing factors</span>
          <h2 id="factors-title">The patterns behind the crashes.</h2>
        </div>
      </div>

      {factors.length === 0 ? (
        <div style={{ padding: '24px 4px', color: '#8d9389', fontSize: '13px' }}>
          {factorData ? 'No recorded factors in this selection.' : 'Loading factors…'}
        </div>
      ) : (
        <div
          className="factor-bar-list"
          id="factor-options"
          ref={listRef}
          role="group"
          aria-label="Scrollable contributing factors"
          tabIndex={0}
        >
          {visibleFactors.map((factor, index) => {
            const isSelected = active === index;
            const isExtra = index >= 5;
            const delay = isExtra ? 0 : index * 40;
            return (
              <button
                key={factor.label}
                className={`factor-bar-row ${isSelected ? 'selected' : ''}`}
                onClick={() => setActive(isSelected ? null : index)}
                aria-pressed={isSelected}
                type="button"
              >
                <span className="factor-bar-heading">
                  <span className="factor-rank">{String(index + 1).padStart(2, '0')}</span>
                  <b>{factor.label}</b>
                  <strong>
                    <AnimatedNumber
                      value={factor.count}
                      delay={delay}
                      duration={isExtra ? 350 : 500}
                      immediate={isExtra}
                    />
                  </strong>
                  <em>
                    {factor.isSubCent ? (
                      '<0.01%'
                    ) : (
                      <>
                        <AnimatedNumber
                          value={Number(factor.percent)}
                          decimals={2}
                          delay={delay}
                          duration={isExtra ? 350 : 500}
                          immediate={isExtra}
                        />%
                      </>
                    )}
                  </em>
                </span>
                <span className="factor-bar-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0.5, Number(factor.percent)))}%`,
                      animationDelay: `${delay}ms`,
                      animationDuration: isExtra ? '0.35s' : '0.6s',
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="factor-list-footer">
        <span aria-live="polite">
          Showing {visibleFactors.length} of {factors.length} supplied factors
          {expanded ? ' · scroll to explore' : ''}
        </span>
        {factors.length > 5 && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="factor-options"
            onClick={() => {
              setExpanded(!expanded);
              if (expanded) {
                listRef.current?.scrollTo({ top: 0 });
                if (active !== null && active > 4) setActive(null);
              }
            }}
          >
            {expanded ? 'See less' : `See more (${factors.length - 5})`}
            <Icon name="arrow" />
          </button>
        )}
      </div>
    </section>
  );
}
