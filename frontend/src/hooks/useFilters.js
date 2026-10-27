import { useEffect, useState } from 'react';
import { readView, viewQuery } from '../utils/filters.js';

// Own shareable filters and restore the selection when browser Back/Forward changes the URL.
export default function useFilters() {
  const [view, setView] = useState(() => readView(window.location.search));

  // Share filters without adding a history entry for every change.
  useEffect(() => {
    const q = viewQuery(view);
    const newUrl = `${window.location.pathname}${q ? '?' + q : ''}`;
    if (window.location.search !== (q ? '?' + q : '')) {
      window.history.replaceState(null, '', newUrl);
    }
  }, [view]);

  useEffect(() => {
    const onPopState = () => setView(readView(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return [view, setView];
}
