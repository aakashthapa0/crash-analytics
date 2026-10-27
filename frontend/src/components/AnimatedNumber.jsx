import React, { useEffect, useRef, useState } from 'react';

/**
 * AnimatedNumber renders an accessible number counter that animates smoothly from 0
 * or previous count to target value using easeOutCubic.
 * 
 * Screen readers immediately read the true value via `.sr-only`, while visual
 * presentation animates smoothly without layout shift.
 */
export default function AnimatedNumber({
  value = 0,
  decimals = 0,
  delay = 0,
  duration,
  immediate = false,
}) {
  const numValue = typeof value === 'number' && !isNaN(value) ? value : 0;
  const element = useRef(null);
  const current = useRef(0);
  const mounted = useRef(false);
  const [visible, setVisible] = useState(Boolean(immediate));
  const [display, setDisplay] = useState(0);

  const format = amount =>
    amount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  // Animate once when scrolled into the viewport.
  // We use IntersectionObserver so numbers offscreen do not waste CPU cycles animating.
  useEffect(() => {
    if (immediate || !('IntersectionObserver' in window) || !element.current) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element.current);
    return () => observer.disconnect();
  }, [immediate]);

  useEffect(() => {
    if (!visible) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const finish = () => {
      window.cancelAnimationFrame(frame);
      current.current = numValue;
      setDisplay(numValue);
    };
    const onMotionChange = () => {
      if (motion.matches) finish();
    };
    if (motion.matches) {
      finish();
      return;
    }
    const from = current.current;
    const firstRun = !mounted.current;
    mounted.current = true;
    const animDuration = typeof duration === 'number' ? duration : (firstRun ? 750 : 380);
    const start = performance.now() + (firstRun ? delay : 0);
    const tick = now => {
      const progress = Math.max(0, Math.min(1, (now - start) / animDuration));
      const next = from + (numValue - from) * (1 - Math.pow(1 - progress, 3));
      current.current = next;
      setDisplay(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    motion.addEventListener('change', onMotionChange);
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      motion.removeEventListener('change', onMotionChange);
    };
  }, [numValue, visible, delay, duration]);

  return (
    <span className="animated-number" ref={element}>
      <span aria-hidden="true">{format(display)}</span>
      <span className="sr-only">{format(numValue)}</span>
    </span>
  );
}
