import React from 'react';
import AnimatedNumber from './AnimatedNumber.jsx';

// Summarize distinct crash events; fatal counts describe crashes, not individual fatalities.
export default function SummaryMetrics({ viewTotal, seriousTotal, fatalTotal, factorData }) {
  return (
    <section className="metrics" aria-label="Crash summary">
      <article>
        <span>Distinct injury crashes</span>
        <strong>
          <AnimatedNumber value={viewTotal} delay={120} />
        </strong>
      </article>
      <article>
        <span>Fatal + serious injury crashes</span>
        <strong>
          <AnimatedNumber value={seriousTotal} delay={240} />
        </strong>
      </article>
      <article>
        <span>Fatal injury crashes</span>
        <strong>
          <AnimatedNumber value={fatalTotal} delay={360} />
        </strong>
      </article>
      <article>
        <span>Without a recorded factor</span>
        <strong>
          <AnimatedNumber value={factorData.no_recorded_factor + factorData.missing_factor} delay={480} />
        </strong>
      </article>
    </section>

  );
}
