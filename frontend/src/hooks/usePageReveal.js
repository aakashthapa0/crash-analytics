import { useLayoutEffect } from 'react';

// Prepare card visibility before paint; reveal in page order and honor reduced motion after loading changes.
export default function usePageReveal(status) {
  useLayoutEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const elements = Array.from(document.querySelectorAll(
      '.filter-panel, .metrics article, .visual-grid > *, .crash-timeline, #district-map'
    ));

    // If user prefers reduced motion or observer is unavailable, show all cards immediately
    if (motion.matches || !('IntersectionObserver' in window)) {
      elements.forEach(el => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        // Observer entries may arrive out of order; stagger according to the document instead.
        entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => elements.indexOf(a.target) - elements.indexOf(b.target))
          .forEach((entry, index) => {
            entry.target.style.setProperty('--reveal-delay', `${index * 70}ms`);
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          });
      },
      { threshold: 0.08 }
    );

    elements.forEach(el => {
      el.classList.add('load-reveal');
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      elements.forEach(el => {
        el.classList.remove('load-reveal', 'is-visible');
        el.style.removeProperty('--reveal-delay');
      });
    };
  }, [status]);
}
