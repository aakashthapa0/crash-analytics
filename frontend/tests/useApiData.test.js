import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Resolve requests manually to verify cancellation, retries, and responses arriving out of order.
test('filter changes, failures, retries and late responses never expose old data', async () => {
  let state, dependency, pendingEffect, cleanup;
  const requests = [];
  const source = (await readFile(new URL('../src/hooks/useApiData.js', import.meta.url), 'utf8'))
    .replace(/^import .* from 'react';\n/, '').replace('export default function', 'function');
  const useApiData = new Function('useState', 'useEffect', 'fetch', `${source}\nreturn useApiData;`)(
    initial => [state ?? initial, value => { state = value; }],
    (effect, [key]) => {
      if (key !== dependency) {
        dependency = key;
        pendingEffect = effect;
      }
    },
    (url, { signal }) => new Promise(resolve => requests.push({ url, signal, resolve })),
  );
  const flush = () => {
    if (pendingEffect) {
      cleanup?.();
      cleanup = pendingEffect();
      pendingEffect = null;
    }
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const reply = (index, body, ok = true) => requests[index].resolve({ ok, status: ok ? 200 : 422, json: async () => body });

  assert.equal(useApiData(['/all']).status, 'loading');
  flush();
  reply(0, { total_crashes: 24261 });
  await settle();
  assert.equal(useApiData(['/all']).data[0].total_crashes, 24261);

  // Check the render before effects run, when stale data used to leak.
  assert.equal(useApiData(['/hale']).data, null);
  flush();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(useApiData(['/bad']).status, 'loading');
  flush();
  reply(1, { total_crashes: 22 });
  reply(2, { error: { message: 'Unknown county' } }, false);
  await settle();
  assert.deepEqual(useApiData(['/bad']), {
    key: JSON.stringify([['/bad'], 0]), status: 'error', data: null, error: 'Unknown county',
  });

  assert.equal(useApiData(['/bad'], 1).status, 'loading');
  flush();
  reply(3, { total_crashes: 0 });
  await settle();
  assert.equal(useApiData(['/bad'], 1).data[0].total_crashes, 0);
  assert.equal(requests.length, 4);
  cleanup();
});
