import { useEffect, useState } from 'react';

// Fetch a group of JSON responses together; cancel obsolete requests when URLs or the retry counter change.
const loading = { status: 'loading', data: null, error: '' };

export default function useApiData(urls, retry = 0) {
  // Compare URL contents so freshly created arrays do not trigger the same request again.
  const key = JSON.stringify([urls, retry]);
  const [result, setResult] = useState(loading);

  useEffect(() => {
    const abort = new AbortController();
    Promise.all(urls.map(async url => {
      const response = await fetch(url, { signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
      return body;
    }))
      .then(data => {
        if (!abort.signal.aborted) setResult({ key, status: 'ready', data, error: '' });
      })
      .catch(error => {
        if (!abort.signal.aborted) setResult({ key, status: 'error', data: null, error: error.message });
      });
    return () => abort.abort();
  }, [key]);

  // Effects run after rendering; hide the previous selection immediately.
  return result.key === key ? result : loading;
}
