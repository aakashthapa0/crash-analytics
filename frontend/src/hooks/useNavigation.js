import { useEffect, useRef, useState } from 'react';

// Coordinate sidebar visibility, keyboard focus, smooth scrolling, and the active section.
export default function useNavigation() {
  const [sidebarHidden, setSidebarHidden] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)').matches : false
  );
  const [activeSection, setActiveSection] = useState('overview');

  const hideButton = useRef(null);
  const showButton = useRef(null);
  const isNavigatingRef = useRef(false);
  const navigationTimeoutRef = useRef(null);

  const toggleSidebar = hidden => {
    setSidebarHidden(hidden);
    window.requestAnimationFrame(() => (hidden ? showButton.current : hideButton.current)?.focus());
  };

  useEffect(() => {
    if (sidebarHidden) return;
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setSidebarHidden(true);
        window.requestAnimationFrame(() => showButton.current?.focus());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sidebarHidden]);

  // Scroll Spy: dynamically highlight active section in sidebar as user scrolls
  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (isNavigatingRef.current) return;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          ticking = false;
          if (isNavigatingRef.current) return;

          const scrollY = window.scrollY;
          const windowHeight = window.innerHeight;
          const scrollBottom = scrollY + windowHeight;
          const docHeight = document.documentElement.scrollHeight;

          // If scrolled near page bottom, highlight the bottom-most section
          if (scrollBottom >= docHeight - 80) {
            setActiveSection('district-map');
            return;
          }

          // If near the top, highlight overview
          if (scrollY < 180) {
            setActiveSection('overview');
            return;
          }

          const factorsEl = document.getElementById('factors');
          const severityEl = document.getElementById('severity');
          const timelineEl = document.getElementById('timeline');
          const mapEl = document.getElementById('district-map');
          const countyEl = document.getElementById('top-counties');

          const getTop = el => (el ? el.getBoundingClientRect().top + scrollY : Infinity);

          const factorsTop = getTop(factorsEl);
          const severityTop = getTop(severityEl);
          const timelineTop = getTop(timelineEl);
          const mapTop = getTop(mapEl);
          const countyTop = getTop(countyEl);

          // Trigger line: 32% down from viewport top
          const triggerY = scrollY + windowHeight * 0.32;

          if (triggerY >= mapTop) {
            setActiveSection('district-map');
          } else if (triggerY >= timelineTop) {
            const sideBySide = Math.abs(timelineTop - countyTop) < 1;
            if (!sideBySide && triggerY >= countyTop) {
              setActiveSection('top-counties');
            } else {
              setActiveSection(prev => sideBySide && prev === 'top-counties' ? 'top-counties' : 'timeline');
            }
          } else if (triggerY >= Math.min(factorsTop, severityTop)) {
            const isStacked = window.innerWidth <= 1150;
            if (isStacked && triggerY >= severityTop) {
              setActiveSection('severity');
            } else {
              setActiveSection(prev => (prev === 'severity' && !isStacked ? 'severity' : 'factors'));
            }
          } else {
            setActiveSection('overview');
          }
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);
    };
  }, []);

  // Keep the clicked item active while smooth scrolling passes other sections.
  const navigate = id => {
    setActiveSection(id);
    isNavigatingRef.current = true;
    if (navigationTimeoutRef.current) clearTimeout(navigationTimeoutRef.current);

    if (id === 'overview') {
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    } else {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          block: 'start',
        });
      }
    }

    navigationTimeoutRef.current = setTimeout(() => {
      isNavigatingRef.current = false;
    }, 850);

    if (window.matchMedia('(max-width: 720px)').matches) toggleSidebar(true);
  };

  return { sidebarHidden, activeSection, hideButton, showButton, toggleSidebar, navigate };
}
